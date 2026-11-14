// WhiteCUL: 吹雪（前方の長方形にダメージとはじき）
import type { Skill } from './index';
import { CHARS } from '../../shared/chars';

const S = CHARS.whitecul.skill;
const skill: Skill = {
  use(room, p, a) {
    const ux = Math.cos(a), uy = Math.sin(a);
    for (const t of room.inRectAhead(p, a, S.len, S.w)) { room.hitThing(p, t, S.dmg); room.push(t, ux, uy, S.push); }
    room.addFx(p, 'rect', { a, len: S.len, w: S.w });
  },
  botUse: (room, p) => room.inRectAhead(p, room.aimOf(p), S.len, S.w).some((t) => room.reach(p, t)),
};
export default skill;
