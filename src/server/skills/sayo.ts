// 小夜: 疾風乱舞（dur 秒、移動が速くなり、一定間隔で自分中心の円にダメージ）
import type { Skill } from './index';
import { CHARS } from '../../shared/chars';
import { isUnit } from '../GameRoom';

const S = CHARS.sayo.skill;
const skill: Skill = {
  use(room, p) {
    p.st.dance = { until: room.now + S.dur, speed: S.speed };
    p.sk.danceNext = room.now;
  },
  tick(room, p) {
    if (!room.stat(p, 'dance') || room.now < p.sk.danceNext) return;
    p.sk.danceNext += S.every;
    room.inCircle(p, p.x, p.y, S.r).forEach((t) => room.hitThing(p, t, S.dmg));
    room.addFx(p, 'ring', { r: S.r });
  },
  ended(room, p) {
    if (room.stat(p, 'dance') && room.now >= p.sk.danceNext) { p.sk.danceNext += S.every; room.addFx(p, 'ring', { r: S.r }); }
  },
  botUse: (room, p) => room.nearFoe(p, S.r + 10, isUnit),
  statuses: ['dance'],
};
export default skill;
