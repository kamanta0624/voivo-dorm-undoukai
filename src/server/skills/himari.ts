// 冥鳴ひまり: 死神の鎌（透明化 → Space で鎌。当てたら攻撃の向きへ跳ぶ）
import type { GameRoom, Player } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';
import { moveBody } from '../../shared/geom';

const S = CHARS.himari.skill;

// 鎌: 透明化を解き、前方の扇形の敵に当てる。当てたら跳ぶ
function scythe(room: GameRoom, p: Player, a: number) {
  delete p.st.cloak;
  let hit = false;
  for (const t of room.enemyThings(p.team)) {
    if (!room.inArc(p, t.x, t.y, t.r, a, S.range, S.arc) || !room.reach(p, t)) continue;
    hit = true;
    room.hitThing(p, t, t.k === 'boss' ? S.bossDmg : S.dmg);
  }
  room.addFx(p, 'arc', { a, r: S.range, arc: S.arc, color: 'scythe' });
  if (!hit) return;
  p.st.leap = { until: Infinity, lock: true, noAttack: true, cancel: true };
  p.sk.leap = { a, left: S.jump };
}

// 跳ぶ: 決めた向きへ通常移動の jumpSpeed 倍。jump px 進むか壁で止まったら終わり
function leap(room: GameRoom, p: Player, dt: number) {
  const l = p.sk.leap;
  if (!p.st.leap) return;
  const step = Math.min(room.speedOf(p) * S.jumpSpeed * dt, l.left), x0 = p.x, y0 = p.y;
  Object.assign(p, moveBody(p.x, p.y, Math.cos(l.a) * step, Math.sin(l.a) * step, C.PLAYER_RADIUS, room.obstacles(), false));
  l.left -= step;
  if (l.left <= 0 || Math.hypot(p.x - x0, p.y - y0) < step - 0.5) delete p.st.leap;
}

const skill: Skill = {
  use(room, p) {
    p.st.cloak = { until: room.now + S.dur, hidden: true, fragile: true, noAuto: true };
  },
  // 透明化中の通常攻撃は鎌（オートアタックはしない）
  attack(room, p, a) {
    if (!room.stat(p, 'cloak')) return false;
    scythe(room, p, a);
    return true;
  },
  afterMove: (room, p, dt) => leap(room, p, dt),
  ended: (room, p, dt) => leap(room, p, dt),
  // Bot: 透明化中に対象が鎌の範囲に入ったら振る（近づくのは通常の戦闘の動き）
  tick(room, p) {
    if (p.bot && room.stat(p, 'cloak') && p.tgt && room.inArc(p, p.tgt.x, p.tgt.y, p.tgt.r, room.aimOf(p), S.range, S.arc)) room.attack(p.id, room.aimOf(p));
  },
  botUse: (room, p) => room.nearFoe(p, C.BOT_SKILL_SENSE, (t) => t.k === 'p' || t.k === 'boss'),
  statuses: ['cloak', 'leap'],
};
export default skill;
