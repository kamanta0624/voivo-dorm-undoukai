// 整理の前後で挙動が変わっていないかの照合（ブラウザ・通信なし）。実行: npx tsx verify/golden.ts [--write]
// Math.random を固定シードの擬似乱数に差し替え、Botだけの4vs4を試合内120秒まわす。毎秒の状態を1行にし、全行のハッシュを verify/golden.txt と比べる
// --write: 今の結果で verify/golden.txt を書き直す（整理前のコードでだけ使う）
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { GameRoom } from '../src/server/GameRoom';

const FILE = 'verify/golden.txt';
const SEC = 120, DT = 0.05;
// プレイアブル10キャラ全員が出る編成（2試合目は1試合目の陣営0を陣営1へ入れ替え、残りの2キャラを加える）
const MATCHES = [
  { seed: 1, teams: [['hanamaru', 'whitecul', 'sayo', 'metan'], ['mochiko', 'aru', 'bii', 'ierutan']] },
  { seed: 2, teams: [['zunko', 'kiritan', 'mochiko', 'aru'], ['hanamaru', 'whitecul', 'sayo', 'metan']] },
];

// mulberry32
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function run(m: (typeof MATCHES)[number]): string[] {
  Math.random = rng(m.seed);
  const r: any = new (GameRoom as any)();
  r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [] });
  r.onCreate(); r.notice = () => {};
  m.teams.forEach((list, team) => list.forEach((ch, i) => { r.addPlayer(`g${team}${i}`, team, true).char = ch; }));
  r.startMatch();
  const lines: string[] = [];
  for (let i = 0; r.phase !== 'ended' && r.now < SEC; i++) {
    r.tick(DT, false);
    if (r.phase !== 'playing' || Math.round(r.now / DT) % 20) continue;
    const players = [...r.players.values()].map((p: any) => [p.id, p.char, p.x, p.y, p.hp, p.alive, Math.max(0, p.skillReadyAt - r.now)]);
    lines.push(JSON.stringify({ t: +r.now.toFixed(2), players, bosses: r.bosses.map((b: any) => b.hp), toku: r.teams.map((t: any) => t.toku), broken: r.broken.length }));
  }
  return lines;
}

const out: string[] = [];
const dump = process.argv.indexOf('--dump'); // --dump <ファイル>: 毎秒の行を書き出す（不一致の原因探し用）
for (const m of MATCHES) {
  const lines = run(m);
  if (dump > 0) writeFileSync(`${process.argv[dump + 1]}.${m.seed}`, lines.join('\n') + '\n');
  const hash = createHash('sha256').update(lines.join('\n')).digest('hex');
  out.push(`match seed=${m.seed} teams=${JSON.stringify(m.teams)} lines=${lines.length} sha256=${hash}`);
}
const all = createHash('sha256').update(out.join('\n')).digest('hex');
out.push(`all sha256=${all}`);
console.log(out.join('\n'));
if (process.argv.includes('--write')) { writeFileSync(FILE, out.join('\n') + '\n'); console.log(`wrote ${FILE}`); }
else {
  const want = readFileSync(FILE, 'utf8').trim();
  const same = want === out.join('\n');
  console.log(same ? 'PASS golden 一致' : `FAIL golden 不一致\n--- golden.txt\n${want}`);
  if (!same) process.exit(1);
}
