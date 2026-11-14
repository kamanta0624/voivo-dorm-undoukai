// 猫使ビィ: 罠設置（向いた方向の扇形にいる敵を一定間隔で攻撃し続ける。時間でも耐久が減る）
import type { GameRoom, Ent } from '../GameRoom';
import { isUnit } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';
import { lineOfSight } from '../../shared/geom';

const B = CHARS.bii.skill;

function updateTrap(room: GameRoom, tr: Ent, dt: number) {
  const owner = room.players.get(tr.owner);
  tr.hp! -= B.decay * dt;
  if (tr.hp! <= 0 || !owner) return room.removeEnt(tr);
  if (room.now < tr.nextAtk) return;
  const hits = room.enemyThings(tr.team).filter((t) => isUnit(t) && room.inArc({ ...owner, x: tr.x, y: tr.y }, t.x, t.y, t.r, tr.a, B.range, B.arc) && lineOfSight(tr.x, tr.y, t.x, t.y, room.obstacles()));
  if (!hits.length) return;
  tr.nextAtk = room.now + B.every;
  hits.forEach((t) => room.hitThing(owner, t, B.dmg));
  room.addFx(tr, 'arc', { a: tr.a, r: B.range, arc: B.arc, color: 'trap' });
}

const skill: Skill = {
  // 向いている方向に置く（前がキャラで塞がっていれば足元）。同時に max 個まで、超えたら古い方が消える
  use(room, p) {
    let x = p.x + Math.cos(p.face) * C.PLACE_DIST, y = p.y + Math.sin(p.face) * C.PLACE_DIST;
    if (room.bodies().filter((b) => b.x !== p.x || b.y !== p.y).some((b) => Math.hypot(b.x - x, b.y - y) < B.r + b.r)) { x = p.x; y = p.y; }
    room.ents.push({ id: room.nextId++, kind: 'trap', team: p.team, owner: p.id, x, y, r: B.r, body: 'struct', hp: B.hp, a: p.face, nextAtk: room.now });
    const mine = room.ents.filter((e) => e.kind === 'trap' && e.owner === p.id);
    if (mine.length > B.max) room.removeEnt(mine[0]);
    room.addFx({ x, y, team: p.team }, 'arc', { a: p.face, r: B.range, arc: B.arc, color: 'trap' });
  },
  botUse: (room, p) => room.nearFoe(p, B.range, (t) => t.k === 'p' || t.k === 'boss'),
  ents: { trap: { update: updateTrap, fog: false } },
};
export default skill;
