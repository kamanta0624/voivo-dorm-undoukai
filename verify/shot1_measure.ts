// shot1 の計測: 固定シードの Bot 戦で、通常攻撃の弾の結果（当たった／届かずに消えた／壁で止まった）をキャラ別に数える
// 実行: npx tsx verify/shot1_measure.ts [試合数=30]。表は標準出力（markdown）
import { GameRoom } from '../src/server/GameRoom';
import NAMES from '../src/shared/chars.json';

const N = Number(process.argv[2] ?? 30), SEEDS = Array.from({ length: N }, (_, i) => 9300 + i);
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sum: Record<string, { hit: number; miss: number; wall: number }> = {};
GameRoom.logFile = ''; GameRoom.matchlogDir = '';
for (const seed of SEEDS) {
  Math.random = rng(seed); GameRoom.matchSeed = seed;
  const room: any = new (GameRoom as any)(); room.setSimulationInterval = () => {}; room.lock = () => {}; room.unlock = () => {};
  Object.defineProperty(room, 'clients', { value: [] }); room.onCreate(); room.notice = () => {};
  room.startMatch();
  while (room.phase !== 'ended') room.tick(0.05, false);
  for (const c of room.rec.summary().chars) { const a = (sum[c.char] ??= { hit: 0, miss: 0, wall: 0 }); for (const k of ['hit', 'miss', 'wall'] as const) a[k] += c.shots[k]; }
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
const out = [`固定シード ${N}試合（${SEEDS[0]}〜${SEEDS[N - 1]}）。通常攻撃の弾（パワーアップの遠距離の形を含む）\n`, '| キャラ | 弾の数 | 当たった | 届かずに消えた | 壁で止まった |', '|---|---|---|---|---|'];
for (const [k, a] of Object.entries(sum).sort()) { const n = a.hit + a.miss + a.wall; if (n) out.push(`| ${(NAMES as any)[k]?.name ?? k} | ${n} | ${pct(a.hit / n)} | ${pct(a.miss / n)} | ${pct(a.wall / n)} |`); }
console.log(out.join('\n'));
process.exit(0);
