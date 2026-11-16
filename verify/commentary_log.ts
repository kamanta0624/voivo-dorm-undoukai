// Bot戦1試合の実況ログ（時刻・フォーカス対象・注目度・イベントキー）とサーバーの1tickあたりの処理時間。実行: npx tsx verify/commentary_log.ts [--off]
// --off: 実況ディレクターを止めて計測（導入前後の比較用）
import { GameRoom } from '../src/server/GameRoom';
import { CONFIG as C } from '../src/shared/config';

const off = process.argv.includes('--off');
const r: any = new (GameRoom as any)();
r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
Object.defineProperty(r, 'clients', { value: [] });
r.onCreate(); r.notice = () => {};
for (let t = 0; t < 2; t++) for (let i = 0; i < C.TEAM_SIZE; i++) r.addPlayer(`g${t}${i}`, t, true);
r.startMatch(); r.beginPlay();
if (off) { for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(r.cm))) if (typeof r.cm[k] === 'function' && k !== 'constructor') r.cm[k] = () => {}; }
else r.cm.log = [];
const DT = 1 / C.TICK_HZ, times: number[] = [];
while (r.phase === 'playing') {
  const t0 = process.hrtime.bigint();
  r.tick(DT, false);
  times.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
const tickTimes = [...times];
for (let i = 0; i < 40 / DT && r.phase === 'ended'; i++) r.tick(DT, false); // 試合後の実況（決着→総評→活躍キャラ→締め）を流す
if (!off) {
  for (const l of r.cm.log) console.log(l);
  // タイムライン: 重なり（言い終わる前に次が始まった）、試合中の無音の最長（つなぎの候補が尽きた間を除く）、つなぎの回数、セリフの途中で起きたフォーカスの移動
  const L = r.cm.log.map((x: string) => JSON.parse(x)), says = L.filter((x: any) => x.keys), none = L.filter((x: any) => x.fillNone).map((x: any) => x.c);
  const overlap = says.filter((x: any, i: number) => i && x.c < says[i - 1].end - 1e-6).length;
  let gap = 0, at = 0;
  for (let i = 1; i < says.length; i++) { const a = says[i - 1].end, b = says[i].c; if (b - a > gap && !none.some((c: number) => c >= a && c <= b)) { gap = b - a; at = a; } }
  const mid = L.filter((x: any) => x.focusChange && says.some((s: any) => x.c > s.c + 1e-6 && x.c < s.end - 1e-6)).length;
  const keys = says.flatMap((x: any) => x.keys), fill = says.filter((x: any) => x.fill), fk = fill.map((x: any) => `${x.keys[0]}`);
  console.log(`# タイムライン: 発話${says.length} 重なり${overlap} 無音の最長${gap.toFixed(2)}秒（${at.toFixed(1)}秒の時点、候補切れを除く） 候補切れ${none.length}回 つなぎ${fill.length}回（盤面${fk.filter((k: string) => k.startsWith('idle_')).length}・雑談${fk.filter((k: string) => k.startsWith('chat:')).length}） 同じつなぎの繰り返し${fill.length - new Set(fill.map((x: any) => JSON.stringify([x.keys, x.ps, x.as]))).size} セリフの途中のフォーカス移動${mid} 試合後: ${keys.filter((k: string) => /^(end_|rev_|mvp_|close)/.test(k)).join('→')}`);
}
times.splice(0, times.length, ...tickTimes); times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`# 実況${off ? 'なし' : 'あり'}: ${times.length}tick 平均${avg.toFixed(3)}ms 中央値${times[times.length >> 1].toFixed(3)}ms 99%${times[Math.floor(times.length * 0.99)].toFixed(3)}ms 最大${times[times.length - 1].toFixed(3)}ms 試合時間${r.now.toFixed(0)}秒 勝者${r.winner}`);
