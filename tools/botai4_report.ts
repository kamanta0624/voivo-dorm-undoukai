// botai4 の集計: logs/botai4/*.jsonl → markdown の表を標準出力（soracannon の比較・基準のそら入り std・じゃんけん）
// 実行: npx tsx tools/botai4_report.ts > logs/botai4/tables.md
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const DIR = 'logs/botai4', ms: any[] = [];
if (existsSync(DIR)) for (const f of readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort()) for (const l of readFileSync(`${DIR}/${f}`, 'utf8').split('\n')) if (l.trim()) ms.push(JSON.parse(l));
const wilson = (w: number, n: number) => { if (!n) return [0, 1]; const z = 1.96, p = w / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return [(c - h) / d, (c + h) / d]; };
const pct = (x: number) => `${Math.round(x * 100)}%`, r1 = (x: number) => Math.round(x * 10) / 10;
const side = (m: any, a: string, b: string) => (m.teams[0].macro === a && m.teams[1].macro === b ? 0 : m.teams[1].macro === a && m.teams[0].macro === b ? 1 : -1);
const rate = (a: string, b: string) => { let n = 0, w = 0; for (const m of ms) { const t = side(m, a, b); if (t < 0) continue; n++; w += m.winner === t ? 1 : m.winner === 2 ? 0.5 : 0; } const ci = wilson(w, n); return { n, w, p: n ? w / n : 0, ci, txt: `${n ? pct(w / n) : '−'}（${pct(ci[0])}〜${pct(ci[1])}${ci[0] > 0.5 || ci[1] < 0.5 ? '' : '、差が分からない'}、${n}試合）` }; };
const out: string[] = [`試合数 ${ms.length}（logs/botai4、物理はすべて中）\n`];
// じゃんけん
const j1 = rate('rush', 'std'), j2 = rate('std', 'counter'), j3 = rate('counter', 'rush');
out.push(`## じゃんけん（rush ＞ std、std ＞ counter、counter ≧ rush）\n`);
out.push(`- rush 対 std: rush の勝率 ${j1.txt}`, `- std 対 counter: std の勝率 ${j2.txt}`, `- counter 対 rush: counter の勝率 ${j3.txt}`, '');
// 比較の表
const PAIRS: [string, string][] = [['soracannon', 'rush'], ['soracannon', 'rush+w'], ['soracannon', 'std'], ['soracannon', 'steal'], ['std+s', 'rush']];
out.push('## soracannon の比較（基準: そら入りの std＝std+s 対 rush）\n');
out.push('| マクロ | 相手 | 試合 | 勝率 | 95%区間 | 大将ダメージ（キャラ／アシスト） | デス | 徳の増減 | スロット当たり | 大将撃破で勝ち／負け | 発射まで行った | 発射時のチャージ秒（平均） | 発射時の敵の大将の残りHP（平均） | そら砲の大将ダメージ（平均） | そら役の撤退（平均） | 発射前に自陣の大将を倒された | 撃てない（うち敵の大将が library） | 作戦をやめた |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const lossRows: string[] = [];
for (const [a, b] of PAIRS) {
  let n = 0, w = 0; const S: Record<string, number> = {}, ad = (k: string, v: number) => (S[k] = (S[k] ?? 0) + v); const fireC: number[] = [], fireHp: number[] = [];
  const loss = { ownBoss: 0, retreat: 0, short: 0, miss: 0, other: 0 };
  for (const m of ms) {
    const t = side(m, a, b); if (t < 0) continue;
    n++; const win = m.winner === t ? 1 : m.winner === 2 ? 0.5 : 0; w += win;
    const cs = m.chars.filter((c: any) => c.team === t);
    ad('boss', cs.reduce((q: number, c: any) => q + c.dmg.boss, 0)); ad('aboss', m.series.assistBossDmg[t].reduce((q: number, x: number) => q + x, 0));
    ad('deaths', cs.reduce((q: number, c: any) => q + c.deaths, 0)); ad('toku', cs.reduce((q: number, c: any) => q + c.tokuGain - c.tokuLoss, 0));
    ad('slot', m.spins.filter((s: any) => s.team === t && s.out === 'win').length);
    ad('bw', m.kind === 'boss' && m.winner === t ? 1 : 0); ad('bl', m.kind === 'boss' && m.winner === 1 - t ? 1 : 0);
    const sc = m.teams[t].sc;
    if (sc) {
      ad('fired', sc.fired ? 1 : 0); if (sc.fired) { fireC.push(sc.charge); fireHp.push(sc.foeHp); }
      ad('scdmg', sc.dmg); ad('scdeaths', sc.deaths); ad('nospot', sc.noSpot ? 1 : 0); ad('lib', sc.foeLib ? 1 : 0); ad('abort', sc.abort ? 1 : 0);
      ad('ownBossFirst', !sc.fired && m.kind === 'boss' && m.winner === 1 - t ? 1 : 0);
      if (win < 1) { // 負け（引き分けを含む）の内訳
        if (!sc.fired && m.kind === 'boss' && m.winner === 1 - t) loss.ownBoss++;
        else if (sc.abort) loss.retreat++;
        else if (sc.fired && sc.dmg <= 0) loss.miss++;
        else if (sc.fired) loss.short++;
        else loss.other++;
      }
    }
  }
  if (!n) continue;
  const ci = wilson(w, n), f = (k: string) => r1((S[k] ?? 0) / n), avg = (a: number[]) => (a.length ? r1(a.reduce((x, y) => x + y, 0) / a.length) : '−');
  const scOn = a === 'soracannon';
  out.push(`| ${a} | ${b} | ${n} | ${pct(w / n)} | ${pct(ci[0])}〜${pct(ci[1])}${ci[0] > 0.5 || ci[1] < 0.5 ? '' : '（差が分からない）'} | ${Math.round(S.boss / n)}／${Math.round(S.aboss / n)} | ${f('deaths')} | ${(S.toku >= 0 ? '+' : '') + f('toku')} | ${f('slot')} | ${pct(S.bw / n)}／${pct(S.bl / n)} | ${scOn ? pct((S.fired ?? 0) / n) : '−'} | ${scOn ? avg(fireC) : '−'} | ${scOn ? avg(fireHp) : '−'} | ${scOn ? f('scdmg') : '−'} | ${scOn ? f('scdeaths') : '−'} | ${scOn ? pct((S.ownBossFirst ?? 0) / n) : '−'} | ${scOn ? `${pct((S.nospot ?? 0) / n)}（${pct((S.lib ?? 0) / n)}）` : '−'} | ${scOn ? pct((S.abort ?? 0) / n) : '−'} |`);
  if (scOn) lossRows.push(`| ${b} | ${loss.ownBoss} | ${loss.retreat} | ${loss.short} | ${loss.miss} | ${loss.other} |`);
}
out.push('', '## soracannon の負け（引き分けを含む）の内訳（試合数）\n', '| 相手 | 自陣の大将が先に倒された | そら役が撤退して作戦をやめた | 撃ったが足りなかった | 外した（撃ったが大将に入らず） | その他（撃たずに時間切れなど） |', '|---|---|---|---|---|---|', ...lossRows);
console.log(out.join('\n'));
