// もち子: ファンネル（n 機。経路で届く敵を囲む位置へ移動 → 止まって射撃 → 次の位置へ）
import type { GameRoom, Ent } from '../GameRoom';
import { thingId, pathLength } from '../GameRoom';
import type { Skill } from './index';
import { CHARS } from '../../shared/chars';
import { moveBody, lineOfSight } from '../../shared/geom';
import { findPath } from '../pathfind';

const F = CHARS.mochiko.skill;

function updateFunnel(room: GameRoom, f: Ent, dt: number) {
  if (room.now >= f.until) return room.removeEnt(f);
  const obs = room.obstacles();
  const owner = room.players.get(f.owner);
  const find = (id: string | null) => (id ? room.enemyThings(f.team).find((t) => thingId(t) === id && (t.k === 'p' || t.k === 'boss') && room.targetable(t)) : undefined);
  let tgt = find(f.tgt);
  if (room.now >= f.retargetAt || !tgt) {
    f.retargetAt = room.now + F.retarget;
    // 近い順に、経路長が上限以下の敵（壁の向こうで回り道が長すぎる敵は選ばない）
    const near = room.enemyThings(f.team).filter((t) => (t.k === 'p' || t.k === 'boss') && room.targetable(t) && Math.hypot(t.x - f.x, t.y - f.y) <= F.sense)
      .sort((u, v) => Math.hypot(u.x - f.x, u.y - f.y) - Math.hypot(v.x - f.x, v.y - f.y)).slice(0, 2);
    tgt = near.find((t) => pathLength(f, t, obs, room.walls) <= F.pathMax);
    f.tgt = tgt ? thingId(tgt) : null;
    const to = tgt ? { x: tgt.x + Math.cos(f.slot) * F.ring, y: tgt.y + Math.sin(f.slot) * F.ring } : owner;
    f.path = to ? findPath(f, to, obs, room.walls) : [];
  }
  const slot = tgt ? { x: tgt.x + Math.cos(f.slot) * F.ring, y: tgt.y + Math.sin(f.slot) * F.ring } : null;
  const to = slot ?? (owner?.alive ? owner : null);
  if (!to) return;
  const stop = slot ? 3 : 40;
  if (Math.hypot(to.x - f.x, to.y - f.y) > stop) {
    // 移動中（射撃しない）: 経路の次の点、なければ目的地へ
    while (f.path.length > 1 && Math.hypot(f.path[0].x - f.x, f.path[0].y - f.y) < 6) f.path.shift();
    const n = f.path.length > 1 ? f.path[0] : to, d = Math.hypot(n.x - f.x, n.y - f.y) || 1, m = Math.min(F.speed * dt, d);
    Object.assign(f, moveBody(f.x, f.y, ((n.x - f.x) / d) * m, ((n.y - f.y) / d) * m, F.radius, obs));
  } else if (tgt && room.now >= f.nextAtk && Math.hypot(tgt.x - f.x, tgt.y - f.y) <= F.range && lineOfSight(f.x, f.y, tgt.x, tgt.y, obs)) {
    // 止まって射撃し、次の射撃位置へ回り込む
    f.nextAtk = room.now + F.every;
    if (owner) room.hitThing(owner, tgt, F.dmg);
    room.addFx(f, 'beam', { x2: tgt.x, y2: tgt.y });
    if (owner && Math.hypot(f.x - owner.x, f.y - owner.y) >= F.leash) return room.removeEnt(f); // 有効射程: 撃った時にもち子から leash px 以上離れていたら、この攻撃で消える
    f.slot += F.slotStep;
    f.retargetAt = 0;
  }
}

const skill: Skill = {
  use(room, p) {
    for (let i = 0; i < F.n; i++) {
      const ang = (i / F.n) * Math.PI * 2;
      room.ents.push({ id: room.nextId++, kind: 'funnel', team: p.team, owner: p.id, x: p.x + Math.cos(ang) * 20, y: p.y + Math.sin(ang) * 20, r: F.radius, body: 'unit', hp: F.hp, until: room.now + F.life, nextAtk: room.now, slot: ang, tgt: null, path: [], retargetAt: 0 });
    }
    room.fxAtBody(p, 'aura', { r: 30, color: 'funnel' });
  },
  botUse: (room, p) => room.nearFoe(p, F.sense, (t) => t.k === 'p' || t.k === 'boss'),
  ents: { funnel: { update: updateFunnel, fog: true } },
};
export default skill;
