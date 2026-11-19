// ユーレイちゃん: ジャッジメント（螺旋を描く光弾が直進。当たり判定は先頭の光弾だけ。ダメージは当たった敵の悪行量に比例、指名手配中は即死）
import type { GameRoom, Ent, Thing } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';
import { inRect } from '../../shared/geom';

const S = CHARS.yurei.skill;

// 当たった敵へのダメージ（基本値。全体の倍率などは hitThing が掛ける）
export function enmaDmg(room: GameRoom, t: Thing) {
  if (t.k !== 'p') return S.minDmg; // 大将・場の物には悪行がない
  if (room.teams[t.o.team].wanted === t.o.id) return S.killDmg;
  return Math.max(S.minDmg, S.maxDmg * Math.min(1, t.o.bad / C.WANTED_MIN));
}

function update(room: GameRoom, e: Ent, dt: number) {
  const o = room.players.get(e.owner);
  if (!o) return room.removeEnt(e);
  let step = Math.min(S.speed * dt, e.left);
  while (step > 0) {
    const m = Math.min(8, step);
    e.x += Math.cos(e.a) * m; e.y += Math.sin(e.a) * m; e.left -= m; step -= m;
    if (room.walls.some((w) => inRect(e.x, e.y, w))) return room.removeEnt(e);
    const t = room.enemyThings(e.team).find((t) => Math.hypot(t.x - e.x, t.y - e.y) <= t.r + e.r);
    if (t) { room.hitThing(o, t, enmaDmg(room, t)); return room.removeEnt(e); }
  }
  if (e.left <= 0) room.removeEnt(e);
}

const skill: Skill = {
  use(room, p) {
    const a = room.skillAim(p, S.range);
    room.ents.push({ id: room.nextId++, kind: 'enma', team: p.team, owner: p.id, x: p.x, y: p.y, r: S.r, body: null, a, left: S.range });
  },
  // Bot: 射程内に悪行のある（または指名手配中の）敵がいれば撃つ
  botUse: (room, p) => room.nearFoe(p, S.range, (t) => t.k === 'p' && (t.o.bad > 0 || room.teams[t.o.team].wanted === t.o.id)),
  ents: { enma: { update, fog: true } },
};
export default skill;
