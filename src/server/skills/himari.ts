// 冥鳴ひまり: 死神の鎌（透明化 → 範囲に入った対象へ自動で鎌。当てたら攻撃の向きへ跳ぶ）
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
  const c = room.bodyOf(p); // 扇の要と相手は体の中心
  for (const t of room.enemyThings(p.team)) {
    if (!room.bodyCircles(t).some((q) => room.inArc({ ...p, ...c }, q.x, q.y, q.r, a, S.range, S.arc)) || !room.reach(p, t)) continue; // 相手は体の箱（hitbox1）
    hit = true;
    room.hitThing(p, t, t.k === 'boss' ? S.bossDmg : t.k === 'p' && t.o.assist ? S.dmg * S.assistMult : S.dmg);
  }
  room.fxAtBody(p, 'arc', { a, r: S.range, arc: S.arc, color: 'scythe' });
  if (!hit) return;
  p.st.leap = { until: Infinity, lock: true, noAttack: true, cancel: true };
  p.sk.leap = { a, left: S.jump };
}

// 跳ぶ: 決めた向きへ通常移動の jumpSpeed 倍。jump px 進むか壁で止まったら終わり
function leap(room: GameRoom, p: Player, dt: number) {
  const l = p.sk.leap;
  if (!p.st.leap) return;
  const step = Math.min(room.speedOf(p) * S.jumpSpeed * dt, l.left), x0 = p.x, y0 = p.y;
  Object.assign(p, moveBody(p.x, p.y, Math.cos(l.a) * step, Math.sin(l.a) * step, C.PLAYER_RADIUS, room.obstacles(), false, (q) => room.noteJump(`p:${p.id}`, p, q)));
  l.left -= step;
  if (l.left <= 0 || Math.hypot(p.x - x0, p.y - y0) < step - 0.5) delete p.st.leap;
}

const skill: Skill = {
  use(room, p) {
    p.st.cloak = { until: room.now + S.dur, hidden: true, fragile: true, noAuto: true };
  },
  // 透明化中の通常攻撃は鎌（オートアタックはしない。tick が範囲に入ったときだけ振る）
  attack(room, p, a) {
    if (!room.stat(p, 'cloak')) return false;
    scythe(room, p, a);
    return true;
  },
  afterMove: (room, p, dt) => leap(room, p, dt),
  ended: (room, p, dt) => leap(room, p, dt),
  // 透明化中に対象が鎌の範囲に入ったら自動で振る（人間・Bot とも。近づくのは移動操作／Bot の戦闘の動き）
  tick(room, p) {
    if (room.stat(p, 'cloak') && p.tgt && room.bodyCircles(p.tgt).some((q) => room.inArc({ ...p, ...room.bodyOf(p) }, q.x, q.y, q.r, room.aimOf(p), S.range, S.arc))) room.attack(p.id, room.aimOf(p));
  },
  botUse: (room, p) => room.nearFoe(p, C.BOT_SKILL_SENSE, (t) => t.k === 'p' || t.k === 'boss'),
  statuses: ['cloak', 'leap'],
};
export default skill;
