// botai2 の集計: logs/botai2/*.jsonl（各マクロ vs std）→ markdown の表を標準出力
// 実行: npx tsx tools/botai2_report.ts > logs/botai2/tables.md
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const DIR = 'logs/botai2', ms: any[] = [];
if (existsSync(DIR)) for (const f of readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort()) for (const l of readFileSync(`${DIR}/${f}`, 'utf8').split('\n')) if (l.trim()) ms.push(JSON.parse(l));
const wilson = (w: number, n: number) => { if (!n) return [0, 1]; const z = 1.96, p = w / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [(c - h) / d, (c + h) / d]; };
const pct = (x: number) => `${Math.round(x * 100)}%`, r1 = (x: number) => Math.round(x * 10) / 10;
type A = Record<string, number>;
const stat = new Map<string, A>();
const add = (a: A, k: string, v: number) => (a[k] = (a[k] ?? 0) + v);
for (const m of ms) for (const t of [0, 1]) {
  const mc = m.teams[t].macro, other = m.teams[1 - t].macro;
  if (mc === 'std' && other === 'std') continue;
  const key = mc === 'std' ? `std（相手 ${other}）` : mc;
  if (mc === 'std') continue; // std 側は相手の裏返しなので表に出さない
  const a = stat.get(key) ?? {}; stat.set(key, a);
  const cs = m.chars.filter((c: any) => c.team === t);
  add(a, 'n', 1); add(a, 'w', m.winner === t ? 1 : m.winner === 2 ? 0.5 : 0);
  add(a, 'boss', cs.reduce((q: number, c: any) => q + c.dmg.boss, 0)); add(a, 'aboss', m.series.assistBossDmg[t].reduce((q: number, x: number) => q + x, 0));
  add(a, 'deaths', cs.reduce((q: number, c: any) => q + c.deaths, 0)); add(a, 'toku', cs.reduce((q: number, c: any) => q + c.tokuGain - c.tokuLoss, 0));
  add(a, 'slot', m.spins.filter((s: any) => s.team === t && s.out === 'win').length);
  add(a, 'bossWin', m.kind === 'boss' && m.winner === t ? 1 : 0); add(a, 'bossLose', m.kind === 'boss' && m.winner === 1 - t ? 1 : 0);
  const tot = cs.reduce((q: number, c: any) => q + Object.values(c.states as A).reduce((x, y) => x + y, 0), 0) || 1, st = (k: string) => cs.reduce((q: number, c: any) => q + (c.states[k] ?? 0), 0);
  add(a, 'atk', (st('raid') + st('boss')) / tot); add(a, 'gather', st('gather') / tot); add(a, 'guard', st('guard') / tot); add(a, 'escort', st('escort') / tot); add(a, 'ultraid', st('ultraid') / tot); add(a, 'dead', st('dead') / tot);
  add(a, 'ultraidSec', st('ultraid')); add(a, 'escortSec', st('escort'));
  if (m.teams[t].endDefend) { add(a, 'def', 1); add(a, 'defW', m.winner === t ? 1 : m.winner === 2 ? 0.5 : 0); }
}
const order = ['std+uae', 'rush', 'rush+uae', 'farm', 'farm+uae', 'std+u', 'std+a', 'std+e'];
const out: string[] = [`試合数 ${ms.length}（logs/botai2、すべて相手は std＝今の本番。物理はすべて中）\n`];
out.push('| マクロ | 試合 | 勝率（対 std） | 95%区間 | 大将ダメージ（キャラ／アシスト） | デス | 徳の増減 | スロット当たり | 大将撃破で勝ち／負け | 時間の割合（攻め／資材／パワーアップ中の攻め／同行／守り／撤退中） | パワーアップ中に攻めていた時間 | 同行していた時間 | 終盤の守りに入った試合（その時の勝率） |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const k of order) {
  const a = stat.get(k); if (!a) continue;
  const n = a.n, ci = wilson(a.w, n), f = (x: string) => r1((a[x] ?? 0) / n);
  out.push(`| ${k} | ${n} | ${pct(a.w / n)} | ${pct(ci[0])}〜${pct(ci[1])}${ci[0] > 0.5 || ci[1] < 0.5 ? '' : '（差が分からない）'} | ${Math.round(a.boss / n)}／${Math.round(a.aboss / n)} | ${f('deaths')} | ${(a.toku / n >= 0 ? '+' : '') + f('toku')} | ${f('slot')} | ${pct((a.bossWin ?? 0) / n)}／${pct((a.bossLose ?? 0) / n)} | ${['atk', 'gather', 'ultraid', 'escort', 'guard', 'dead'].map((x) => pct((a[x] ?? 0) / n)).join('／')} | ${Math.round((a.ultraidSec ?? 0) / n)}秒（4人の合計） | ${Math.round((a.escortSec ?? 0) / n)}秒（4人の合計） | ${a.def ? `${pct(a.def / n)}（${pct((a.defW ?? 0) / a.def)}）` : '−'} |`);
}
console.log(out.join('\n'));
