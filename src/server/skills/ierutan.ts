// あいえるたん: アップグレード（自分の体の中心から半径 r の円の中の味方と自分が dur 秒、通常攻撃の間隔が cd 倍になり少しずつ回復。間隔はアシストには掛けない）
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';

const S = CHARS.ierutan.skill;
const skill: Skill = {
  use(room, p) {
    const c = room.bodyOf(p); // 範囲は体の中心（味方も体の中心で測る）
    const who: string[] = []; // 効果を受けたキャラ（p:id。発動のエフェクトで対象に印を出す。ierutan3）
    for (const q of room.players.values()) { const b = room.bodyOf(q); if (q.team === p.team && q.alive && Math.hypot(b.x - c.x, b.y - c.y) <= S.r) { q.st.upgrade = { until: room.now + S.dur, cd: S.cd, regen: S.regen }; who.push(`p:${q.id}`); } }
    room.fxAtBody(p, 'aura', { r: S.r, color: 'upgrade', who });
  },
  botUse: (room, p) => room.nearFoe(p, C.BOT_SKILL_SENSE, (t) => t.k === 'p' || t.k === 'boss'),
  statuses: ['upgrade'],
};
export default skill;
