// 四国めたん: ドリル（前方の扇形にダメージ、自分から離れる向きへはじく）
import type { Skill } from './index';
import { CHARS } from '../../shared/chars';

const S = CHARS.metan.skill;
const skill: Skill = {
  use(room, p, a) {
    for (const t of room.enemyThings(p.team)) {
      if (!room.inArc(p, t.x, t.y, t.r, a, S.range, S.arc)) continue;
      room.hitThing(p, t, S.dmg);
      const d = Math.hypot(t.x - p.x, t.y - p.y) || 1;
      room.push(t, (t.x - p.x) / d, (t.y - p.y) / d, S.push);
    }
    room.addFx(p, 'arc', { a, r: S.range, arc: S.arc });
  },
  botUse: (room, p) => { const a = room.aimOf(p); return room.enemyThings(p.team).some((t) => room.inArc(p, t.x, t.y, t.r, a, S.range, S.arc) && room.reach(p, t)); },
};
export default skill;
