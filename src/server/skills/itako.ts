// 東北イタコ: 狐火（自分の周りを時計回りに回る火の玉。展開中に再発動で、最寄りの敵へ9時の位置から順にホーミング）
import type { GameRoom, Player, Ent } from '../GameRoom';
import { thingId } from '../GameRoom';
import type { Skill } from './index';
import { CHARS } from '../../shared/chars';
import { inRect } from '../../shared/geom';

const S = CHARS.itako.skill;
const TAU = Math.PI * 2;

const balls = (room: GameRoom, p: Player, mode: string) => room.ents.filter((e) => e.kind === 'foxfire' && e.owner === p.id && e.mode === mode);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
// 標的にできる敵（射程内・見える・対象にできる）の最寄り
const nearest = (room: GameRoom, p: Player) => room.enemyThings(p.team)
  .filter((t) => (t.k === 'p' || t.k === 'boss') && room.targetable(t) && dist(t, p) <= S.range + t.r && room.reach(p, t))
  .sort((u, v) => dist(u, p) - dist(v, p))[0];
const find = (room: GameRoom, team: number, id: string) => room.enemyThings(team).find((t) => thingId(t) === id && room.targetable(t));

// 回っている火の玉が消えたら CT を始める
function endOrbit(room: GameRoom, p: Player) {
  if (p.sk.foxUntil == null) return;
  p.sk.foxUntil = null;
  p.skillReadyAt = room.now + S.ct;
}

function update(room: GameRoom, e: Ent, dt: number) {
  const o = room.players.get(e.owner);
  if (!o) return room.removeEnt(e);
  if (e.mode !== 'home') {
    if (!o.alive || room.now >= e.until) { // 倒れた・時間切れ: 消える
      room.removeEnt(e);
      if (!balls(room, o, 'orbit').length && !balls(room, o, 'wait').length) endOrbit(room, o);
      return;
    }
    const prev = e.ang;
    e.ang = (e.ang + S.spin * dt) % TAU; // 時計回り（画面は y が下向き）
    if (e.mode === 'wait') {
      const t = find(room, e.team, e.tgt);
      if (!t) return room.removeEnt(e); // 標的が倒れた・見えなくなった: 離れる前の火の玉は消える
      const at9 = Math.atan2(t.y - o.y, t.x - o.x) - Math.PI / 2; // 標的の方向を12時としたときの9時
      if ((((at9 - prev) % TAU) + TAU) % TAU <= S.spin * dt) { // この tick で9時を通った: 円から離れる（接線＝標的の方向）
        e.ang = at9; e.mode = 'home'; e.a = at9 + Math.PI / 2; e.t = 0;
      }
    }
    e.x = o.x + Math.cos(e.ang) * S.r; e.y = o.y + Math.sin(e.ang) * S.r;
    if (e.mode !== 'home') { // 回っている間: 触れた敵にダメージ（同じ相手には rehit 秒おき）
      for (const t of room.enemyThings(e.team)) {
        const id = thingId(t);
        if (dist(t, e) > t.r + e.r || room.now < (e.hits[id] ?? 0) || !room.reach(e, t)) continue;
        e.hits[id] = room.now + S.rehit;
        room.hitThing(o, t, S.dmg);
      }
      return;
    }
  }
  // ホーミング: 標的へ向きを turn ずつ変えて進む。命中で消える。標的が消えたらそのまま直進し、寿命・壁で消える
  e.t += dt;
  if (e.t > S.life) return room.removeEnt(e);
  const t = find(room, e.team, e.tgt);
  if (t) {
    const want = Math.atan2(t.y - e.y, t.x - e.x), d = ((((want - e.a) % TAU) + TAU + Math.PI) % TAU) - Math.PI, k = S.turn * dt;
    e.a += Math.max(-k, Math.min(k, d));
  }
  let step = S.homeSpeed * dt;
  while (step > 0) {
    const m = Math.min(8, step);
    e.x += Math.cos(e.a) * m; e.y += Math.sin(e.a) * m; step -= m;
    if (room.walls.some((w) => inRect(e.x, e.y, w))) return room.removeEnt(e);
    if (t && dist(t, e) <= t.r + e.r) { room.hitThing(o, t, S.homeDmg); return room.removeEnt(e); }
  }
}

const skill: Skill = {
  use(room, p) {
    const orbit = balls(room, p, 'orbit');
    if (orbit.length) { // 展開中の再発動: 最寄りの敵を標的に（いなければ何もしない）。CT はここから
      const t = nearest(room, p);
      if (!t) return false;
      for (const e of orbit) Object.assign(e, { mode: 'wait', tgt: thingId(t), until: Infinity });
      p.sk.foxUntil = null;
      p.skillReadyAt = room.now + S.ct;
      return false;
    }
    for (let i = 0; i < S.n; i++) {
      const ang = (i / S.n) * TAU;
      room.ents.push({ id: room.nextId++, kind: 'foxfire', team: p.team, owner: p.id, x: p.x + Math.cos(ang) * S.r, y: p.y + Math.sin(ang) * S.r, r: S.ballR, body: null, mode: 'orbit', ang, until: room.now + S.dur, hits: {}, a: 0, t: 0 });
    }
    p.sk.foxUntil = room.now + S.dur;
    return false; // CT は再発動か時間切れから
  },
  tick(room, p) {
    if (p.sk.foxUntil != null && room.now >= p.sk.foxUntil) endOrbit(room, p);
  },
  // Bot: 近くに敵がいれば展開。展開中は、最寄りの敵が円の外にいるか、時間切れが近ければ撃ち出す
  botUse(room, p) {
    if (!balls(room, p, 'orbit').length) return room.nearFoe(p, S.r + 40, (t) => t.k === 'p' || t.k === 'boss');
    const t = nearest(room, p);
    return !!t && (dist(t, p) > S.r + t.r + S.ballR || room.now >= p.sk.foxUntil - 1);
  },
  ents: { foxfire: { update, fog: true } },
};
export default skill;
