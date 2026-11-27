// botai1 の集計: logs/botai/*.jsonl → 表（markdown を標準出力）と logs/botai/compare.json（tools/matchlog_report.ts の HTML が読む）
// 実行: npx tsx tools/botai_report.ts > logs/botai/tables.md
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import NAMES from '../src/shared/chars.json';

const DIR = 'logs/botai';
const ms: any[] = [];
if (existsSync(DIR)) for (const f of readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort()) for (const l of readFileSync(`${DIR}/${f}`, 'utf8').split('\n')) if (l.trim()) ms.push(JSON.parse(l));
const PH: Record<string, string> = { strong: '強', mid: '中', weak: '弱' };
const side = (m: any, t: number) => `${m.chars.find((c: any) => c.team === t)?.phys ?? 'mid'}/${m.teams[t].macro}`;
const label = (s: string) => { const [p, m] = s.split('/'); return `${PH[p] ?? p}・${m}`; };
// Wilson の 95% 区間
const wilson = (w: number, n: number) => { if (!n) return [0, 1]; const z = 1.96, p = w / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [(c - h) / d, (c + h) / d]; };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const r1 = (x: number) => Math.round(x * 10) / 10;

// 組み合わせ（順不同にまとめる。a 側の勝ち＝1、引き分け＝0.5）
type Row = { a: string; b: string; n: number; w: number; d: number; aSide0: number; kinds: Record<string, number>; ci: number[]; stats: Record<string, any> };
const rows = new Map<string, Row>();
for (const m of ms) {
  const s0 = side(m, 0), s1 = side(m, 1), [a, b] = [s0, s1].sort(), k = `${a}|${b}`;
  const r = rows.get(k) ?? { a, b, n: 0, w: 0, d: 0, aSide0: 0, kinds: {}, ci: [0, 1], stats: {} };
  r.n++; r.kinds[m.kind] = (r.kinds[m.kind] ?? 0) + 1;
  const at = s0 === a ? 0 : 1; if (at === 0) r.aSide0++;
  if (m.winner === 2) r.d++; else if (m.winner === at) r.w++;
  for (const t of [0, 1]) { const sk = t === at ? 'a' : 'b'; const st = (r.stats[sk] ??= { kills: 0, deaths: 0, boss: 0, toku: 0, n: 0 }); for (const c of m.chars.filter((c: any) => c.team === t)) { st.kills += c.kills; st.deaths += c.deaths; st.boss += c.dmg.boss; st.toku += c.tokuGain - c.tokuLoss; } st.n++; }
  rows.set(k, r);
}
for (const r of rows.values()) r.ci = wilson(r.w + r.d / 2, r.n);
const order = (r: Row) => (r.a.split('/')[1] === r.b.split('/')[1] ? 0 : r.a.split('/')[0] === r.b.split('/')[0] ? 1 : 2);
const list = [...rows.values()].sort((u, v) => order(u) - order(v) || u.a.localeCompare(v.a) || u.b.localeCompare(v.b));
const out: string[] = [];
out.push(`試合数 ${ms.length}（logs/botai）\n`);
out.push('| 組み合わせ（A vs B） | 試合 | A の勝率 | 95%区間 | 引き分け | 決着（大将撃破／時間切れ） | 1試合1チームあたり A キル・デス・大将ダメージ・徳 | B キル・デス・大将ダメージ・徳 |');
out.push('|---|---|---|---|---|---|---|---|');
for (const r of list) {
  const f = (s: any) => `${r1(s.kills / s.n)}・${r1(s.deaths / s.n)}・${Math.round(s.boss / s.n)}・${r1(s.toku / s.n)}`;
  out.push(`| ${label(r.a)} vs ${label(r.b)} | ${r.n} | ${pct((r.w + r.d / 2) / r.n)} | ${pct(r.ci[0])}〜${pct(r.ci[1])}${r.ci[0] > 0.5 || r.ci[1] < 0.5 ? '' : '（差が分からない）'} | ${r.d} | ${r.kinds.boss ?? 0}／${r.kinds.timeout ?? 0} | ${f(r.stats.a)} | ${f(r.stats.b)} |`);
}
// マクロ（中どうし）の総合: 各マクロの対戦成績の合計
const mac = new Map<string, { w: number; n: number }>();
for (const r of list.filter((r) => r.a.startsWith('mid/') && r.b.startsWith('mid/'))) {
  for (const [s, w] of [[r.a, r.w + r.d / 2], [r.b, r.n - r.w - r.d / 2]] as [string, number][]) { const x = mac.get(s) ?? { w: 0, n: 0 }; x.w += w; x.n += r.n; mac.set(s, x); }
}
out.push('\n## マクロ（中どうし）の総合勝率\n');
out.push('| マクロ | 試合 | 勝率 | 95%区間 |\n|---|---|---|---|');
for (const [s, x] of [...mac].sort((u, v) => v[1].w / v[1].n - u[1].w / u[1].n)) { const ci = wilson(x.w, x.n); out.push(`| ${s.split('/')[1]} | ${x.n} | ${pct(x.w / x.n)} | ${pct(ci[0])}〜${pct(ci[1])} |`); }
// キャラ別: フィジカル強・弱で、そのキャラの1試合あたりの成績（同じマクロ std）
const ch = new Map<string, Record<string, { n: number; kills: number; deaths: number; boss: number; win: number }>>();
for (const m of ms) for (const c of m.chars) {
  if (m.teams[c.team].macro !== 'std') continue;
  const e = (ch.get(c.char) ?? {}) as any, x = (e[c.phys] ??= { n: 0, kills: 0, deaths: 0, boss: 0, win: 0 });
  x.n++; x.kills += c.kills; x.deaths += c.deaths; x.boss += c.dmg.boss; if (m.winner === c.team) x.win++;
  ch.set(c.char, e);
}
out.push('\n## キャラ別（マクロ std の試合。フィジカルごとの1試合あたり）\n');
out.push('| キャラ | 強: 出場・勝率・キル・デス・大将ダメ | 中 | 弱 |\n|---|---|---|---|');
for (const [k, e] of [...ch].sort()) out.push(`| ${(NAMES as any)[k]?.name ?? k} | ${['strong', 'mid', 'weak'].map((p) => { const x = e[p]; return x ? `${x.n}・${pct(x.win / x.n)}・${r1(x.kills / x.n)}・${r1(x.deaths / x.n)}・${Math.round(x.boss / x.n)}` : '−'; }).join(' | ')} |`);
// マクロ別のキャラ（中、各マクロでそのキャラがいたチームの勝率）
const cm = new Map<string, Record<string, { n: number; win: number; boss: number }>>();
for (const m of ms) for (const c of m.chars) {
  if (c.phys !== 'mid') continue;
  const e = (cm.get(c.char) ?? {}) as any, x = (e[m.teams[c.team].macro] ??= { n: 0, win: 0, boss: 0 });
  x.n++; x.boss += c.dmg.boss; if (m.winner === c.team) x.win++;
  cm.set(c.char, e);
}
const MAC = ['std', 'rush', 'farm', 'guard', 'adv'];
out.push('\n## キャラ別（フィジカル中。マクロごとの出場・チームの勝率・大将ダメ）\n');
out.push(`| キャラ | ${MAC.join(' | ')} |\n|---|${MAC.map(() => '---').join('|')}|`);
for (const [k, e] of [...cm].sort()) out.push(`| ${(NAMES as any)[k]?.name ?? k} | ${MAC.map((mc) => { const x = e[mc]; return x ? `${x.n}・${pct(x.win / x.n)}・${Math.round(x.boss / x.n)}` : '−'; }).join(' | ')} |`);
// 必要な試合数の目安（勝率の差 Δ を 95% で見分ける: 片側の勝率 50%±Δ の区間が 50% をまたがない）
out.push('\n## 必要な試合数の目安（勝率 50% からの差 Δ を 95%区間で見分ける）\n');
out.push('| Δ | 試合数 |\n|---|---|');
for (const d of [0.05, 0.1, 0.15, 0.2]) out.push(`| ${Math.round(d * 100)}% | ${Math.ceil((1.96 * 0.5 / d) ** 2)} |`);
console.log(out.join('\n'));
writeFileSync(`${DIR}/compare.json`, JSON.stringify({ n: ms.length, rows: list.map((r) => ({ a: label(r.a), b: label(r.b), n: r.n, rate: (r.w + r.d / 2) / r.n, ci: r.ci })), macros: [...mac].map(([s, x]) => ({ m: s.split('/')[1], n: x.n, rate: x.w / x.n, ci: wilson(x.w, x.n) })) }));
