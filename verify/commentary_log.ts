// Bot戦1試合の実況ログ（時刻・フォーカス対象・注目度・イベントキー）とサーバーの1tickあたりの処理時間。実行: npx tsx verify/commentary_log.ts [--off]
// --off: 実況ディレクターを止めて計測（導入前後の比較用）
import { GameRoom } from '../src/server/GameRoom';
import { CONFIG as C } from '../src/shared/config';
import { clips } from '../src/shared/commentary';

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
  // フォーカス変更の場所のセリフ: 型1（状況→場所）・型2（場所→状況）・単独の回数。フォーカス外で言えなかった状況のセリフ（held）が、その対象へのフォーカス変更（drop 秒以内）の直後の発話に入らず捨てられた回数
  const preU = says.filter((x: any) => x.keys.some((k: string) => k.startsWith('pre_')));
  const t1 = preU.filter((x: any) => x.keys.length > 1 && x.keys.at(-1) === 'pre_t1').length, t2 = preU.filter((x: any) => x.keys.length > 1 && x.keys[0] === 'pre_t2').length, alone = preU.filter((x: any) => x.keys.length === 1).length;
  let withHeld = 0, dropped = 0;
  for (const fc of L.filter((x: any) => x.focusChange && x.to)) {
    const h = L.filter((x: any) => x.held && x.ids.includes(fc.to) && x.c <= fc.c && fc.c - x.c < C.CM.drop).at(-1);
    if (!h) continue;
    withHeld++;
    const next = says.find((x: any) => x.c >= fc.c - 1e-6);
    if (!next || !h.held.some((k: string) => next.keys.includes(k))) dropped++;
  }
  const ninU = says.filter((x: any) => x.keys.includes('idle_reflect') && x.ps[x.keys.indexOf('idle_reflect')] === 1), ninBad = ninU.length;
  for (const x of ninU) { const i = x.keys.indexOf('idle_reflect'), a = x.as[i]; console.log(`# 人数: n=${a.n} → ${clips({ k: 'idle_reflect', p: 1, a }).map((c) => c.text).join('|')}`); }
  const cools = L.filter((x: any) => x.heldUse === false).length;
  console.log(`# フォーカス変更: 型1（状況→場所）${t1} 型2（場所→状況）${t2} 場所だけ${alone} 状況のセリフが取ってあったフォーカス変更${withHeld} うち捨てられた${dropped}（話題のクールタイム中で捨てた${cools}） 「n人で戦っています」${ninBad}回`);
  console.log(`# タイムライン: 発話${says.length} 重なり${overlap} 無音の最長${gap.toFixed(2)}秒（${at.toFixed(1)}秒の時点、候補切れを除く） 候補切れ${none.length}回 つなぎ${fill.length}回（盤面${fk.filter((k: string) => k.startsWith('idle_')).length}・雑談${fk.filter((k: string) => k.startsWith('chat:')).length}） 同じつなぎの繰り返し${fill.length - new Set(fill.map((x: any) => JSON.stringify([x.keys, x.ps, x.as]))).size} セリフの途中のフォーカス移動${mid} 試合後: ${keys.filter((k: string) => /^(end_|rev_|mvp_|close)/.test(k)).join('→')}`);
}
times.splice(0, times.length, ...tickTimes); times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`# 実況${off ? 'なし' : 'あり'}: ${times.length}tick 平均${avg.toFixed(3)}ms 中央値${times[times.length >> 1].toFixed(3)}ms 99%${times[Math.floor(times.length * 0.99)].toFixed(3)}ms 最大${times[times.length - 1].toFixed(3)}ms 試合時間${r.now.toFixed(0)}秒 勝者${r.winner}`);
