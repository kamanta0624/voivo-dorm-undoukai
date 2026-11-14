// 東北きりたん: きりたん砲飛行（dur 秒、移動が速いが通常攻撃は近接のモード（包丁）だけ）
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';

const S = CHARS.kiritan.skill;
const skill: Skill = {
  use(room, p) {
    p.st.fly = { until: room.now + S.dur, speed: S.speed, meleeOnly: true };
    room.addFx(p, 'aura', { r: 30, color: 'fly' });
  },
  botUse: (room, p) => room.nearFoe(p, C.BOT_SKILL_SENSE, (t) => t.k === 'p' || t.k === 'boss'),
  statuses: ['fly'],
};
export default skill;
