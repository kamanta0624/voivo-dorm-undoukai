// 送ったスナップショットのハッシュ（refac1 で作成）: 固定シードの Bot 戦＋観戦者・各陣営の視点で、送った全スナップショットのハッシュを出す。サーバーの切り出し・整理の前後で一致を見る
// 実行: npx tsx verify/snaphash.ts（変える前と後の両方で流し、最後の行 all の値を比べる。送る中身を変える修正では一致しないのが正しい）
import { createHash } from 'node:crypto';
import { GameRoom } from '../src/server/GameRoom';
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const MATCHES = [
  { seed: 1, teams: [['hanamaru', 'whitecul', 'sayo', 'metan'], ['mochiko', 'aru', 'bii', 'ierutan']] },
  { seed: 2, teams: [['zunko', 'kiritan', 'himari', 'aru'], ['hanamaru', 'whitecul', 'sayo', 'metan']] },
  { seed: 3, teams: [['itako', 'yurei', 'mochiko', 'bii'], ['ierutan', 'zunko', 'itako', 'yurei']] },
  { seed: 4, teams: [['sora', 'hanamaru', 'bii', 'kiritan'], ['himari', 'yurei', 'sora', 'metan']] },
];
const all = createHash('sha256'); let n = 0;
for (const m of MATCHES) {
  Math.random = rng(m.seed);
  const h = createHash('sha256');
  const send = (sid: string) => (type: string, msg: unknown) => { const s = `${sid} ${type} ${JSON.stringify(msg)}`; h.update(s); n++; };
  const clients = ['spec', 'spec0', 'own0', 'own1'].map((sid) => ({ sessionId: sid, send: send(sid) }));
  const r: any = new (GameRoom as any)();
  r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: clients });
  r.onCreate(); r.notice = () => {}; r.broadcast = (type: string, msg: unknown) => { h.update(`* ${type} ${JSON.stringify(msg)}`); };
  m.teams.forEach((list, team) => list.forEach((ch, i) => { r.addPlayer(`g${team}${i}`, team, true).char = ch; }));
  r.specView.set('spec0', 0);
  r.startMatch(); r.owners.set('own0', 'g00'); r.owners.set('own1', 'g13');
  for (let i = 0; r.phase !== 'ended' && i < 20 * 150; i++) r.tick(0.05, true);
  const d = h.digest('hex'); all.update(d); console.log('match', m.seed, d.slice(0, 16));
}
console.log('sends', n, 'all', all.digest('hex'));
