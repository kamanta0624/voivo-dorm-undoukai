// 東北ずん子: ずんだアロー（当たった敵はずんだ餅: 移動が遅くなり技を使えない。無敵の相手には効かない）
import type { Skill } from './index';
import { CHARS } from '../../shared/chars';

const S = CHARS.zunko.skill;
const skill: Skill = {
  use(room, p, a) {
    room.shoot(p, 'arrow', a, S.range, 0).onHit = (t) => {
      if (t.k === 'p' && !room.effect(t.o, 'invincible') && room.phase === 'playing') t.o.st.mochi = { until: room.now + S.dur, speed: S.speed, noSkill: true };
    };
  },
  botUse: (room, p) => room.nearFoe(p, S.range, (t) => t.k === 'p'),
  statuses: ['mochi'],
};
export default skill;
