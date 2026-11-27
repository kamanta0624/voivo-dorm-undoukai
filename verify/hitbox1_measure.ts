// hitbox1 の計測: 固定シードの Bot 戦で、通常攻撃の弾の結果（shot1 と同じ）と、キャラ別の与ダメ・キル・デス、試合時間を数える
// 実行: npx tsx verify/hitbox1_measure.ts [試合数=30]。表は標準出力（markdown）
import { GameRoom } from '../src/server/GameRoom';
import NAMES from '../src/shared/chars.json';

const N = Number(process.argv[2] ?? 30), SEEDS = Array.from({ length: N }, (_, i) => 9300 + i);
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sum: Record<string, Record<string, number>> = {};
let sec = 0; const kinds: Record<string, number> = {};
GameRoom.logFile = ''; GameRoom.matchlogDir = '';
// 対大将のダメージの内訳（通常攻撃／それ以外＝技・場の物）。hitThing を外から包む（ゲームのコードは変えない）
const bossBy: Record<string, [number, number]> = {};
const H = (GameRoom.prototype as any).hitThing;
(GameRoom.prototype as any).hitThing = function (this: any, p: any, t: any, dmg: number, aa?: boolean) { const b = t?.k === 'boss' ? t.o : null, h0 = b?.hp; const r = H.call(this, p, t, dmg, aa); if (b && p && !p.assist) (bossBy[p.char] ??= [0, 0])[aa ? 0 : 1] += h0 - b.hp; return r; };
for (const seed of SEEDS) {
  Math.random = rng(seed); GameRoom.matchSeed = seed;
  const room: any = new (GameRoom as any)(); room.setSimulationInterval = () => {}; room.lock = () => {}; room.unlock = () => {};
  Object.defineProperty(room, 'clients', { value: [] }); room.onCreate(); room.notice = () => {};
  room.startMatch();
  while (room.phase !== 'ended') room.tick(0.05, false);
  const r = room.rec.summary(); sec += r.sec; kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  for (const c of r.chars) {
    const a = (sum[c.char] ??= {});
    const add = (k: string, v: number) => (a[k] = (a[k] ?? 0) + v);
    add('n', 1); add('hit', c.shots.hit); add('miss', c.shots.miss); add('wall', c.shots.wall);
    add('dmgChar', c.dmg.char); add('dmgBoss', c.dmg.boss); add('kills', c.kills); add('deaths', c.deaths);
  }
}
const pct = (x: number) => `${Math.round(x * 100)}%`, r1 = (x: number) => Math.round(x * 10) / 10, nm = (k: string) => (NAMES as any)[k]?.name ?? k;
const out = [`固定シード ${N}試合（${SEEDS[0]}〜${SEEDS[N - 1]}）。平均試合時間 ${r1(sec / N)}秒、決着 ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join('・')}\n`, '| キャラ | 弾の数 | 当たった | 届かずに消えた | 壁で止まった |', '|---|---|---|---|---|'];
for (const [k, a] of Object.entries(sum).sort()) { const n = a.hit + a.miss + a.wall; if (n) out.push(`| ${nm(k)} | ${n} | ${pct(a.hit / n)} | ${pct(a.miss / n)} | ${pct(a.wall / n)} |`); }
out.push('', '| キャラ | 出場 | 与ダメ 対キャラ | 対大将 | キル | デス |（1試合あたり）', '|---|---|---|---|---|---|');
for (const [k, a] of Object.entries(sum).sort()) out.push(`| ${nm(k)} | ${a.n} | ${r1(a.dmgChar / a.n)} | ${r1(a.dmgBoss / a.n)} | ${r1(a.kills / a.n)} | ${r1(a.deaths / a.n)} |`);
out.push('', '| キャラ | 対大将 通常攻撃 | 対大将 技・場の物 |（1試合あたり。hitThing 経由の分）', '|---|---|---|');
for (const [k, a] of Object.entries(sum).sort()) { const v = bossBy[k] ?? [0, 0]; out.push(`| ${nm(k)} | ${r1(v[0] / a.n)} | ${r1(v[1] / a.n)} |`); }
console.log(out.join('\n'));
process.exit(0);
