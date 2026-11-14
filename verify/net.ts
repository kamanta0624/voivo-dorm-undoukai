// 通信遅延つきで、自キャラ・他キャラがワープして見えないかを確かめる（ブラウザなし）。実行: npm run test:server
// サーバー（GameRoom）とクライアントの予測・補間（src/shared/netcode.ts）を、遅延と揺らぎのある仮想の通信でつなぐ
import { GameRoom } from '../src/server/GameRoom';
import { CONFIG as C } from '../src/shared/config';
import { Predictor, Interp } from '../src/shared/netcode';
import { cage } from '../src/shared/geom';

let fails = 0;
const ok = (name: string, cond: boolean, detail: any = '') => {
  if (!cond) fails++;
  console.log(cond ? 'PASS' : 'FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail));
};

// 自キャラが動ける場面（開始前のカウント中と終了後は部屋の中だけ）
const MOVE = ['countdown', 'playing', 'ended'];
function run(label: string, seconds: number, lat: number, jit: number, keys: (t: number, rnd: () => number) => number[]) {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const FRAME = 1000 / 60, STEP = C.NET_STEP * 1000;
  let now = 0;
  // 通信: 送った順に届く（WebSocket と同じ）。届くまでの時間に揺らぎを入れる
  const pipe = () => { let last = 0; const q: { at: number; m: any }[] = []; return { q, send: (m: any) => { last = Math.max(last, now + lat + (rnd() * 2 - 1) * jit); q.push({ at: last, m: JSON.parse(JSON.stringify(m)) }); } }; };
  const down = pipe(), up = pipe();
  const r: any = new (GameRoom as any)();
  r.setSimulationInterval = () => {}; r.lock = () => {};
  const fake = { sessionId: 'me', send: (t: string, m: any) => { if (t === 's') down.send(m); } };
  Object.defineProperty(r, 'clients', { value: [fake] });
  r.onCreate(); r.onJoin(fake); r.players.get('me').char = 'sayo';
  // 開始前に待機画面で WAIT 秒過ごす（試合の時間が止まっている間もスナップショットは届く）
  const WAIT = 5000;
  const begin = () => {
    r.startMatch(); r.beginPlay();
    // 敵Botは消す（はじき・突撃などの正当な大移動を混ぜない）。味方Botは動かして他キャラの描画を見る
    for (const p of r.players.values()) if (p.team === 1) { p.alive = false; p.respawnAt = 1e9; p.x = p.y = -999; }
  };
  const obsOf = (_snap: any, m: any) => [...r.walls, ...(m.cage ? cage(m.cage) : [])];
  const pred = new Predictor(), interp = new Interp();
  let snap: any = null, acc = 0, nextTick = 0;
  let measured = 0, selfWarps = 0, selfMax = 0, otherWarps = 0, otherMax = 0, diffMax = 0;
  const prevSelf = { x: NaN, y: NaN }, prevOther = new Map<string, { x: number; y: number; t: number }>();
  // サーバー側の本当の位置の履歴（他キャラの描画と比べる）
  const truth = new Map<string, { t: number; x: number; y: number }[]>();
  // t0〜t1 の間にサーバーで実際に動いた道のり（突撃などの速い移動も含める）
  const truthLen = (id: string, t0: number, t1: number) => { const h = (truth.get(id) ?? []).filter((e) => e.t > t0 && e.t < t1); const pts = [truthAt(id, t0), ...h, truthAt(id, t1)].filter((e) => e); let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return len; };
  const truthAt = (id: string, T: number) => { const h = truth.get(id) ?? []; let a = h[0]; for (const e of h) { if (e.t > T) { const k = a && e.t > a.t ? (T - a.t) / (e.t - a.t) : 1; return a ? { x: a.x + (e.x - a.x) * k, y: a.y + (e.y - a.y) * k } : e; } a = e; } return a; };
  for (let f = 0; now < seconds * 1000 + WAIT; f++) {
    now = f * FRAME;
    if (r.phase === 'waiting' && now >= WAIT) begin();
    while (nextTick <= now) {
      while (up.q.length && up.q[0].at <= nextTick) r.messages.input(fake, up.q.shift()!.m);
      r.tick(C.NET_STEP); nextTick += STEP;
      for (const p of r.players.values()) { if (!truth.has(p.id)) truth.set(p.id, []); truth.get(p.id)!.push({ t: r.elapsed, x: p.x, y: p.y }); }
    }
    while (down.q.length && down.q[0].at <= now) {
      snap = down.q.shift()!.m;
      interp.push(snap.t, now, snap.players.filter((p: any) => p.id !== 'me'));
      const m = snap.players.find((p: any) => p.id === 'me');
      if (!m.alive || !MOVE.includes(snap.phase)) pred.reset(m.x, m.y); else pred.reconcile(m.x, m.y, m.ack, m.spd, obsOf(snap, m));
    }
    if (!snap) continue;
    const m = snap.players.find((p: any) => p.id === 'me');
    const [dx, dy] = keys(now / 1000, rnd);
    acc += FRAME;
    while (acc >= STEP) { acc -= STEP; up.send(pred.step(dx, dy, m.spd, obsOf(snap, m), m.alive && MOVE.includes(snap.phase))); }
    const me = pred.render(acc / STEP, FRAME);
    if (!Number.isNaN(prevSelf.x)) {
      const j = Math.hypot(me.x - prevSelf.x, me.y - prevSelf.y);
      if (j < C.NET_SNAP) { selfMax = Math.max(selfMax, j); if (j > 10) selfWarps++; } // NET_SNAP 以上は復活などの正当な移動
    }
    Object.assign(prevSelf, me);
    const server = r.players.get('me');
    if (MOVE.includes(snap.phase)) diffMax = Math.max(diffMax, Math.hypot(server.x - pred.x, server.y - pred.y));
    for (const p of snap.players) {
      if (p.id === 'me') continue;
      const q = interp.at(p.id, now);
      if (!q) continue;
      const pv = prevOther.get(p.id), T = interp.renderTime(now);
      if (pv) {
        // サーバーで実際に動いた量より大きく飛んで見えたらワープ（突撃・加速などの速い移動は正当）
        measured++;
        const j = Math.hypot(q.x - pv.x, q.y - pv.y), real = truthLen(p.id, pv.t, T);
        if (real < C.NET_SNAP && j < C.NET_SNAP) { otherMax = Math.max(otherMax, j - real); if (j > 10 && j > real + 6) otherWarps++; } // NET_SNAP 以上は復活などの正当な移動
      }
      prevOther.set(p.id, { ...q, t: T });
    }
  }
  console.log(`  ${label}: 自キャラ 1フレーム最大${selfMax.toFixed(1)}px（10px超 ${selfWarps}回）/ 他キャラ 実際の移動より飛んだ量 最大${otherMax.toFixed(1)}px（ワープ ${otherWarps}回）/ 予測とサーバーの差 最大${diffMax.toFixed(0)}px（他キャラの計測 ${measured}フレーム）`);
  return { selfWarps, otherWarps };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]];
let kd = [1, -1], kNext = 0;
const random = (t: number, rnd: () => number) => { if (t >= kNext) { kd = DIRS[Math.floor(rnd() * DIRS.length)]; kNext = t + 0.2 + rnd() * 0.8; } return kd; };
// study の東壁の扉（x=27タイル、y=10〜12）の角をかすめて annexN へ抜け、角に沿って戻る
const corner = (t: number) => (t % 6) < 1.8 ? [1, -1] : (t % 6) < 2.6 ? [1, 0] : (t % 6) < 3.4 ? [-1, 1] : (t % 6) < 4.4 ? [-1, -1] : (t % 6) < 5.2 ? [1, -1] : [-1, 1];

console.log('--- 通信遅延つきのワープ（1フレームで10px超を数える）');
for (const [lat, jit] of [[0, 0], [100, 50], [150, 100]]) {
  kNext = 0;
  const a = run(`ランダム移動60秒 遅延${lat}ms 揺らぎ${jit}ms`, 60, lat, jit, random);
  const b = run(`扉の角に沿う移動30秒 遅延${lat}ms 揺らぎ${jit}ms`, 30, lat, jit, corner);
  ok(`遅延${lat}ms・揺らぎ${jit}ms で自キャラ・他キャラがワープしない`, a.selfWarps + b.selfWarps + a.otherWarps + b.otherWarps === 0);
}
console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
