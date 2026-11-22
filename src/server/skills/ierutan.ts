// あいえるたん: アップグレード（半径 r の味方と自分が dur 秒、通常攻撃の間隔が cd 倍になり少しずつ回復。間隔はアシストには掛けない）
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';

const S = CHARS.ierutan.skill;
const skill: Skill = {
  use(room, p) {
    const c = room.bodyOf(p); // 範囲と輪は体の中心（味方も体の中心で測る）
    for (const q of room.players.values()) { const b = room.bodyOf(q); if (q.team === p.team && q.alive && Math.hypot(b.x - c.x, b.y - c.y) <= S.r) q.st.upgrade = { until: room.now + S.dur, cd: S.cd, regen: S.regen }; }
    room.fxAtBody(p, 'aura', { r: S.r, color: 'upgrade' });
  },
  botUse: (room, p) => room.nearFoe(p, C.BOT_SKILL_SENSE, (t) => t.k === 'p' || t.k === 'boss'),
  statuses: ['upgrade'],
};
export default skill;
