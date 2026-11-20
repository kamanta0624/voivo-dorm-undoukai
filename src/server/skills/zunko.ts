// 東北ずん子: ずんだアロー（発射時の照準の対象1体を追う矢。曲がれるのは毎秒 turn まで。対象が倒れたら直進。当たった敵はずんだ餅: 移動が遅くなり技を使えず、与えるダメージが減る。無敵の相手には効かない）
import type { Skill } from './index';
import { thingId } from '../GameRoom';
import { CHARS } from '../../shared/chars';

const S = CHARS.zunko.skill;
const skill: Skill = {
  use(room, p) {
    const t = room.pickTarget(p, S.range), id = t ? thingId(t) : null;
    const sh = room.shoot(p, 'arrow', t ? Math.atan2(t.y - p.y, t.x - p.x) : p.face, S.arrowSpeed * S.life, 0, S.arrowSpeed);
    let orphan = !id; // 目標を失ったら（倒れた・対象にならない）その後は直進
    sh.steer = (s, dt) => {
      if (orphan) return;
      const q = room.enemyThings(p.team).find((u) => thingId(u) === id && room.targetable(u));
      if (!q) { orphan = true; return; }
      const a = Math.atan2(s.vy, s.vx), d = Math.atan2(Math.sin(Math.atan2(q.y - s.y, q.x - s.x) - a), Math.cos(Math.atan2(q.y - s.y, q.x - s.x) - a)), na = a + Math.sign(d) * Math.min(Math.abs(d), S.turn * dt);
      s.vx = Math.cos(na) * s.sp; s.vy = Math.sin(na) * s.sp;
    };
    sh.onHit = (u) => {
      if (u.k === 'p' && !room.effect(u.o, 'invincible') && room.phase === 'playing') u.o.st.mochi = { until: room.now + S.dur, speed: S.speed, noSkill: true, atk: S.atk };
    };
  },
  botUse: (room, p) => room.nearFoe(p, S.range, (t) => t.k === 'p'),
  statuses: ['mochi'],
};
export default skill;
