// あいえるたん: 加速（半径 r の味方と自分が dur 秒、移動が速くなり少しずつ回復）
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';

const S = CHARS.ierutan.skill;
const skill: Skill = {
  use(room, p) {
    for (const q of room.players.values()) if (q.team === p.team && q.alive && Math.hypot(q.x - p.x, q.y - p.y) <= S.r) q.st.accel = { until: room.now + S.dur, speed: S.speed, regen: S.regen };
    room.addFx(p, 'aura', { r: S.r, color: 'accel' });
  },
  botUse: (room, p) => room.nearFoe(p, C.BOT_SKILL_SENSE, (t) => t.k === 'p' || t.k === 'boss'),
  statuses: ['accel'],
};
export default skill;
