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
if (!off) for (const l of r.cm.log) console.log(l);
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`# 実況${off ? 'なし' : 'あり'}: ${times.length}tick 平均${avg.toFixed(3)}ms 中央値${times[times.length >> 1].toFixed(3)}ms 99%${times[Math.floor(times.length * 0.99)].toFixed(3)}ms 最大${times[times.length - 1].toFixed(3)}ms 試合時間${r.now.toFixed(0)}秒 勝者${r.winner}`);
