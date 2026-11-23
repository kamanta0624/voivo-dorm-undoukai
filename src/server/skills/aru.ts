// 猫使アル: 突撃（タメ → 決めた方向へ突進。範囲の壁を壊し、触れた敵に1回ずつ当たる。タメ中・突撃中は動けず攻撃しない、突撃中は無敵）
import type { GameRoom, Player } from '../GameRoom';
import { unbreakable, thingId } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';
import { moveBody, cage, inDashShape } from '../../shared/geom';

const S = CHARS.aru.skill, T = C.TILE;

// 状態: charge=タメ中、rush=突撃中
// タメが終わったら突撃を始め、突撃中は決めた方向へ進み続ける
function step(room: GameRoom, p: Player, dt: number) {
  const c = p.st.charge;
  if (c && room.now - c.at! >= S.windup) {
    delete p.st.charge;
    p.st.rush = { until: room.now + S.dur, lock: true, noAttack: true, invincible: true, noPush: true, cancel: true, view: () => ({ a: p.sk.a }) };
    Object.assign(p.sk, { hit: new Set(), broke: false });
  }
  if (room.stat(p, 'rush')) dashStep(room, p, dt);
}

// 突撃の1tick: 決めた方向へ進み、垂直方向は移動入力で少し動ける。エフェクトの範囲の壁を壊し、触れた敵に1回ずつ当たる
function dashStep(room: GameRoom, p: Player, dt: number) {
  const a = p.sk.a, ux = Math.cos(a), uy = Math.sin(a), sp = room.speedOf(p);
  const [ix, iy] = room.moveIntent(p), il = Math.hypot(ix, iy) || 1;
  const side = Math.max(-1, Math.min(1, (-ix * uy + iy * ux) / il)); // 移動入力の垂直成分
  const nx = p.x + ux * sp * S.speed * dt - uy * side * sp * S.side * dt, ny = p.y + uy * sp * S.speed * dt + ux * side * sp * S.side * dt;
  if (room.phase === 'ended') { Object.assign(p, moveBody(p.x, p.y, nx - p.x, ny - p.y, C.PLAYER_RADIUS, [...room.obstacles(), ...cage(room.cageOf(p)!)], false)); return; } // 結果画面: 部屋の中を動くだけ
  // 進んだ先のエフェクトの範囲に入る壁タイル（壊せない壁は壊さずに無視する）
  const tiles: number[][] = [];
  const R = S.len + S.w;
  for (let ty = Math.floor((ny - R) / T); ty <= Math.floor((ny + R) / T); ty++) for (let tx = Math.floor((nx - R) / T); tx <= Math.floor((nx + R) / T); tx++) {
    if (room.tiles[ty]?.[tx] !== '#' || !inDashShape(S, tx * T + T / 2, ty * T + T / 2, nx, ny, a, T / 2)) continue;
    if (!unbreakable(tx, ty)) tiles.push([tx, ty]);
  }
  if (tiles.length) { room.breakWalls(tiles); if (!p.sk.broke) { p.sk.broke = true; room.addToku(p.team, p, 'wall'); } }
  // 体が壁に止められたら壁に沿って滑る（正面なら前に進まず、dur まで突撃を続ける）
  Object.assign(p, moveBody(p.x, p.y, nx - p.x, ny - p.y, C.PLAYER_RADIUS, room.obstacles(), true, (q) => room.noteJump(`p:${p.id}`, p, q)));
  for (const t of room.enemyThings(p.team)) {
    if (p.sk.hit.has(thingId(t)) || !inDashShape(S, t.x, t.y, p.x, p.y, a, t.r)) continue;
    p.sk.hit.add(thingId(t));
    room.hitThing(p, t, S.dmg);
  }
}

const skill: Skill = {
  // タメに入る。方向: 人間は矢印の向き（タメ中に矢印で変えられる。突撃開始時点の向きで確定）、Bot はこの瞬間に決める（移動入力 → 照準の対象 → 向いている方向）
  use(room, p, a) {
    const [ix, iy] = room.moveIntent(p), at = room.now;
    p.st.charge = { until: Infinity, at, lock: true, still: true, noAttack: true, cancel: true, view: () => ({ a: p.sk.a, len: room.speedOf(p) * S.speed * S.dur, left: S.windup - (room.now - at) }) };
    p.sk.a = !p.bot ? room.skillAim(p, room.speedOf(p) * S.speed * S.dur) : ix || iy ? Math.atan2(iy, ix) : a;
  },
  arrow: (room, p) => ({ R: room.speedOf(p) * S.speed * S.dur, a: p.st.charge ? p.sk.a : undefined }),
  reAim(_room, p, a) {
    if (!p.st.charge) return false;
    if (a !== undefined) p.sk.a = a;
    return true;
  },
  afterMove: (room, p, dt) => step(room, p, dt),
  ended: (room, p, dt) => step(room, p, dt),
  botUse: (room, p) => { const d = p.dx || p.dy ? Math.atan2(p.dy, p.dx) : room.aimOf(p); return room.inRectAhead(p, d, S.speed * room.speedOf(p) * S.dur, S.w).some((t) => t.k === 'p' || t.k === 'boss'); }, // 予測進路に敵か敵大将
  statuses: ['charge', 'rush'],
};
export default skill;
