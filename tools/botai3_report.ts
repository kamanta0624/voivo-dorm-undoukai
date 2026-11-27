// botai3 の集計: logs/botai3/*.jsonl → markdown の表を標準出力（対 rush・対 std）
// 実行: npx tsx tools/botai3_report.ts > logs/botai3/tables.md
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const DIR = 'logs/botai3', ms: any[] = [];
if (existsSync(DIR)) for (const f of readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort()) for (const l of readFileSync(`${DIR}/${f}`, 'utf8').split('\n')) if (l.trim()) ms.push(JSON.parse(l));
const wilson = (w: number, n: number) => { if (!n) return [0, 1]; const z = 1.96, p = w / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [(c - h) / d, (c + h) / d]; };
const pct = (x: number) => `${Math.round(x * 100)}%`, r1 = (x: number) => Math.round(x * 10) / 10;
const PAIRS: [string, string][] = [...['steal', 'counter', 'counter+w', 'split', 'rush+w', 'std', 'farm'].map((m): [string, string] => [m, 'rush']), ...['steal', 'counter', 'counter+w', 'split', 'rush+w'].map((m): [string, string] => [m, 'std'])];
const out: string[] = [`試合数 ${ms.length}（logs/botai3、物理はすべて中）\n`];
for (const opp of ['rush', 'std']) {
  out.push(`## 対 ${opp}\n`);
  out.push(`| マクロ | 試合 | 勝率（対 ${opp}） | 95%区間 | 大将ダメージ（キャラ／アシスト） | デス | 徳の増減 | スロット当たり | 大将撃破で勝ち／負け | 時間の割合（攻め／資材／守り・構え／撤退中） | 拾った資材（コバコ／敵陣裏／自陣裏／表） | 逆襲に入った回数（逆襲中の大将ダメージ） |`);
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [a, b] of PAIRS.filter(([, o]) => o === opp)) {
    let n = 0, w = 0; const S: Record<string, number> = {};
    const ad = (k: string, v: number) => (S[k] = (S[k] ?? 0) + v);
    for (const m of ms) {
      const t = m.teams[0].macro === a && m.teams[1].macro === b ? 0 : m.teams[1].macro === a && m.teams[0].macro === b ? 1 : -1;
      if (t < 0 || (a === b)) continue;
      n++; w += m.winner === t ? 1 : m.winner === 2 ? 0.5 : 0;
      const cs = m.chars.filter((c: any) => c.team === t), st = (k: string) => cs.reduce((q: number, c: any) => q + (c.states[k] ?? 0), 0), tot = cs.reduce((q: number, c: any) => q + Object.values(c.states as Record<string, number>).reduce((x, y) => x + y, 0), 0) || 1;
      ad('boss', cs.reduce((q: number, c: any) => q + c.dmg.boss, 0)); ad('aboss', m.series.assistBossDmg[t].reduce((q: number, x: number) => q + x, 0));
      ad('deaths', cs.reduce((q: number, c: any) => q + c.deaths, 0)); ad('toku', cs.reduce((q: number, c: any) => q + c.tokuGain - c.tokuLoss, 0));
      ad('slot', m.spins.filter((s: any) => s.team === t && s.out === 'win').length);
      ad('bw', m.kind === 'boss' && m.winner === t ? 1 : 0); ad('bl', m.kind === 'boss' && m.winner === 1 - t ? 1 : 0);
      ad('atk', (st('raid') + st('boss') + st('ultraid')) / tot); ad('gather', st('gather') / tot); ad('guard', st('guard') / tot); ad('dead', st('dead') / tot);
      const mt = m.teams[t].mats; for (const k of ['big', 'backEnemy', 'backOwn', 'front']) ad(k, mt[k] ?? 0);
      ad('cn', m.teams[t].counterN ?? 0); ad('cb', m.teams[t].counterBoss ?? 0);
    }
    if (!n) continue;
    const ci = wilson(w, n), f = (k: string) => r1((S[k] ?? 0) / n);
    out.push(`| ${a} | ${n} | ${pct(w / n)} | ${pct(ci[0])}〜${pct(ci[1])}${ci[0] > 0.5 || ci[1] < 0.5 ? '' : '（差が分からない）'} | ${Math.round(S.boss / n)}／${Math.round(S.aboss / n)} | ${f('deaths')} | ${(S.toku >= 0 ? '+' : '') + f('toku')} | ${f('slot')} | ${pct(S.bw / n)}／${pct(S.bl / n)} | ${['atk', 'gather', 'guard', 'dead'].map((k) => pct((S[k] ?? 0) / n)).join('／')} | ${['big', 'backEnemy', 'backOwn', 'front'].map(f).join('／')} | ${S.cn ? `${f('cn')}（${Math.round(S.cb / n)}）` : '−'} |`);
  }
  out.push('');
}
console.log(out.join('\n'));
