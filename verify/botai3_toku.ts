// botai3 の「0. 徳の入り方」: 固定シードの Bot 戦で、徳の入り方を種類ごとに数える（ゲームのコードは変えず外から包む）
// 実行: npx tsx verify/botai3_toku.ts [マクロA] [マクロB]（既定 std std）。表は標準出力（markdown）
import { GameRoom } from '../src/server/GameRoom';
import { CONFIG as C } from '../src/shared/config';

const MA = process.argv[2] ?? 'std', MB = process.argv[3] ?? 'std', SEEDS = Array.from({ length: 20 }, (_, i) => 9100 + i);
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = GameRoom.prototype as any;
let room: any;
const sum: Record<string, number[]> = {}; // key → [陣営Aの合計, 陣営Bの合計]（試合をまたいで、マクロごと）
const add = (k: string, team: number, v: number) => { (sum[k] ??= [0, 0])[room.macroSide[team]] += v; };
const at0 = R.addToku; R.addToku = function (this: any, team: number, p: any, key: string, text?: string, n = 1) { const b = this.teams[team].toku; const r = at0.call(this, team, p, key, text, n); if (this === room && this.phase === 'playing') { add(`徳 ${key}`, team, this.teams[team].toku - b); add(`回数 ${key}`, team, p?.assist ? 0 : 1); } return r; };
const rf0 = R.updateReflect; R.updateReflect = function (this: any, dt: number) { const b = this.teams.map((t: any) => t.toku); rf0.call(this, dt); if (this === room) this.teams.forEach((t: any, i: number) => add('徳 反省中', i, t.toku - b[i])); };
for (const [i, seed] of SEEDS.entries()) {
  Math.random = rng(seed);
  room = new (GameRoom as any)(); room.setSimulationInterval = () => {}; room.lock = () => {}; room.unlock = () => {};
  Object.defineProperty(room, 'clients', { value: [] }); room.onCreate(); room.notice = () => {};
  const swap = i % 2 === 1; room.macros = swap ? [MB, MA] : [MA, MB]; room.macroSide = swap ? [1, 0] : [0, 1];
  room.startMatch();
  while (room.phase !== 'ended') room.tick(0.05, false);
  const s = room.rec.summary();
  for (const t of [0, 1]) for (const [k, v] of Object.entries(s.teams[t].mats)) add(`拾った ${k}`, t, v as number);
}
const n = SEEDS.length, r2 = (x: number) => Math.round(x * 100) / 100;
const MATS: [string, string, number][] = [['big', 'コバコが中立に配る資材（高性能の徳）', C.TOKU.materialBig], ['backEnemy', '敵陣の裏側の資材', C.TOKU.materialBack], ['backOwn', '自陣の裏側の資材', C.TOKU.materialBack], ['front', '表側（食堂・中央）の資材', C.TOKU.material]];
const out = [`固定シード ${n}試合（${MA} vs ${MB}、陣営を入れ替えて半分ずつ）。1試合1チームあたり\n`, `| 資材の種類 | 1個の徳 | ${MA} の取得数 | 徳 | ${MB} の取得数 | 徳 |`, '|---|---|---|---|---|---|'];
for (const [k, name, v] of MATS) { const c = sum[`拾った ${k}`] ?? [0, 0]; out.push(`| ${name} | ${v} | ${r2(c[0] / n)} | ${r2((c[0] * v) / n)} | ${r2(c[1] / n)} | ${r2((c[1] * v) / n)} |`); }
out.push(`\n| 徳の増減（1試合1チーム） | ${MA} | ${MB} |\n|---|---|---|`);
for (const k of Object.keys(sum).filter((k) => k.startsWith('徳 ')).sort()) out.push(`| ${k.slice(2)} | ${r2(sum[k][0] / n)} | ${r2(sum[k][1] / n)} |`);
console.log(out.join('\n'));
