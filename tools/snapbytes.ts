// スナップショットの大きさの内訳（sync2 の計測）: 固定シードの4vs4（人間の枠1人＝Bot に操作を任せる・観戦1人）を1試合まわし、送ったスナップショットを Colyseus と同じ詰め方（msgpackr）で測る
// 実行: npx tsx tools/snapbytes.ts [シード（既定 1）]。出力: クライアントごとの平均・最大・毎秒の合計、項目ごとの割合（上位）、players の項目ごとの割合
import { Packr } from 'msgpackr';
import { GameRoom } from '../src/server/GameRoom';

const packr = new Packr({ useRecords: false }), size = (v: unknown) => packr.pack(v).length;
let seed = Number(process.argv[2] ?? 1);
Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const per: Record<string, { n: number; sum: number; max: number }> = {}, keys: Record<string, number> = {}, pkeys: Record<string, number> = {};
let total = 0, enemyP = 0, ownP = 0;
const STATIC = ['roster', 'bossRooms', 'broken', 'materials', 'items'], PSTATIC = ['char', 'team', 'bot', 'assist', 'tier', 'maxHp', 'cdMax'], FOE = ['skillCd', 'cd', 'aim', 'tgt', 'spd', 'ack', 'bad'];
let dyn = 0, trim = 0, own = 0;
const send = (sid: string) => (type: string, m: any) => {
  if (type !== 's' || m.phase !== 'playing') return;
  const b = size(m) + 3; total += b;
  if (sid === 'own') {
    own += b;
    const d: any = { ...m }; for (const k of STATIC) delete d[k]; d.players = m.players.map((p: any) => { const q = { ...p }; for (const k of PSTATIC) delete q[k]; return q; }); dyn += size(d) + 3; // 変わった時だけ送る候補を抜いた分（目安）
    const t: any = { ...m, players: m.players.map((p: any) => { if (p.team === 0) return p; const q = { ...p }; for (const k of FOE) delete q[k]; return q; }) }; trim += size(t) + 3; // 敵向けの候補を抜いた分（目安）
  }
  const x = (per[sid] ??= { n: 0, sum: 0, max: 0 }); x.n++; x.sum += b; x.max = Math.max(x.max, b);
  for (const k in m) keys[k] = (keys[k] ?? 0) + size({ [k]: m[k] }) - 1;
  for (const p of m.players) { for (const k in p) pkeys[k] = (pkeys[k] ?? 0) + size({ [k]: p[k] }) - 1; if (sid === 'own' && p.team !== 0) enemyP += size(p); else if (sid === 'own') ownP += size(p); }
};
const r: any = new (GameRoom as any)();
r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
Object.defineProperty(r, 'clients', { value: [{ sessionId: 'own', send: send('own') }, { sessionId: 'spec', send: send('spec') }] });
r.onCreate(); r.notice = () => {}; r.pub = false; // 常設の部屋は「観戦者だけ（人間の枠が Bot）」で打ち切りになるので外す（計測だけ）
const teams = [['aru', 'hanamaru', 'sayo', 'metan'], ['zunko', 'bii', 'himari', 'kiritan']];
teams.forEach((list, t) => list.forEach((ch, i) => { r.addPlayer(`g${t}${i}`, t, true).char = ch; }));
r.startMatch(); r.owners.set('own', 'g00');
let ticks = 0; for (; r.phase !== "ended" && ticks < 20 * 400; ticks++) { r.tick(0.05, true); if (process.env.DEBUG && ticks % 400 === 0) console.log(ticks, r.phase, Object.keys(per)); }
const sec = r.elapsed, sum = Object.values(keys).reduce((a, b) => a + b, 0), psum = Object.values(pkeys).reduce((a, b) => a + b, 0);
const pct = (o: Record<string, number>, s: number) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${((v / s) * 100).toFixed(1)}%`).join('・');
console.log(`試合 ${sec.toFixed(0)}秒（playing の間だけ数える）`);
for (const [sid, x] of Object.entries(per)) console.log(`${sid === 'own' ? '人間の枠' : '観戦'}: 平均 ${(x.sum / x.n).toFixed(0)} B・最大 ${x.max} B・毎秒 ${(x.sum / x.n * 20 / 1024).toFixed(1)} KB（${x.n}回）`);
console.log(`全クライアントの毎秒の合計（2人）: ${(total / (Object.values(per)[0].n / 20) / 1024).toFixed(1)} KB`);
console.log(`項目ごとの割合: ${pct(keys, sum)}`);
console.log(`players の項目ごとの割合: ${pct(pkeys, psum)}`);
console.log(`人間の枠の目安: 変わった時だけ送る候補（${STATIC.join('・')}、players の ${PSTATIC.join('・')}）を抜くと ${((1 - dyn / own) * 100).toFixed(0)}% 減。敵向けの候補（${FOE.join('・')}）を抜くと ${((1 - trim / own) * 100).toFixed(1)}% 減`);
console.log(`人間の枠に送った players のうち敵の分: ${((enemyP / (enemyP + ownP)) * 100).toFixed(0)}%`);
