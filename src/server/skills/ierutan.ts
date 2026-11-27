// あいえるたん: アップグレード（自分の体の中心を中心とする横 w・縦 h の長方形の中の味方と自分が dur 秒、通常攻撃の間隔が cd 倍になり少しずつ回復。間隔はアシストには掛けない）
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';

const S = CHARS.ierutan.skill;
const skill: Skill = {
  use(room, p) {
    const c = room.bodyOf(p); // 範囲は体の中心（味方も体の中心で測る）
    for (const q of room.players.values()) { const b = room.bodyOf(q); if (q.team === p.team && q.alive && Math.abs(b.x - c.x) <= S.w / 2 && Math.abs(b.y - c.y) <= S.h / 2) q.st.upgrade = { until: room.now + S.dur, cd: S.cd, regen: S.regen }; }
    room.fxAtBody(p, 'aura', { r: Math.hypot(S.w, S.h) / 2, w: S.w, h: S.h, color: 'upgrade' }); // r: 長方形を囲む円（見える範囲の判定など r を使う所用）
  },
  botUse: (room, p) => room.nearFoe(p, C.BOT_SKILL_SENSE, (t) => t.k === 'p' || t.k === 'boss'),
  statuses: ['upgrade'],
};
export default skill;
