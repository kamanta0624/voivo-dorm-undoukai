// 猫使ビィ: 再現江湖（敵へ残像を残して高速移動 → 当たればさらに進み、止まった瞬間に相手を中心に爆発。範囲の壁も壊す）
import type { GameRoom, Player } from '../GameRoom';
import { PERIMETER, thingId } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';
import { moveBody, cage, circleRect } from '../../shared/geom';

const B = CHARS.bii.skill, T = C.TILE;

// 爆発: (x, y) 中心の半径 r の敵にダメージ、範囲の壁を壊す（外周は除く）
function explode(room: GameRoom, p: Player, x: number, y: number) {
  for (const t of room.enemyThings(p.team)) if (Math.hypot(t.x - x, t.y - y) <= B.r + t.r) room.hitThing(p, t, t.k === 'boss' ? B.bossDmg : B.dmg);
  const tiles: number[][] = [];
  for (let ty = Math.floor((y - B.r) / T); ty <= Math.floor((y + B.r) / T); ty++) for (let tx = Math.floor((x - B.r) / T); tx <= Math.floor((x + B.r) / T); tx++) {
    if (room.tiles[ty]?.[tx] === '#' && !PERIMETER[ty][tx] && circleRect(x, y, B.r, { x: tx * T, y: ty * T, w: T, h: T })) tiles.push([tx, ty]);
  }
  if (tiles.length) { room.breakWalls(tiles); room.addToku(p.team, p, 'wall'); room.addFx({ x, y, team: p.team }, 'wall', { tiles, r: 0 }); }
  room.addFx({ x, y, team: p.team }, 'aura', { r: B.r, color: 'boom' });
}

// 高速移動の1tick。結果画面では部屋の中を動くだけ（当たり・爆発なし）
function step(room: GameRoom, p: Player, dt: number) {
  const ph = p.sk.phantom;
  if (!p.st.phantom) return;
  const ended = room.phase === 'ended', obs = ended ? [...room.obstacles(), ...cage(room.cageOf(p)!)] : room.obstacles();
  const d = Math.min(B.speed * dt, ph.left), x0 = p.x, y0 = p.y;
  Object.assign(p, moveBody(p.x, p.y, Math.cos(ph.a) * d, Math.sin(ph.a) * d, C.PLAYER_RADIUS, obs, false));
  ph.left -= d;
  const blocked = Math.hypot(p.x - x0, p.y - y0) < d - 0.5;
  if (!ended && !ph.hit) {
    const t = room.enemyThings(p.team).find((t) => (t.k === 'p' || t.k === 'boss') && room.targetable(t) && Math.hypot(t.x - p.x, t.y - p.y) <= t.r + C.PLAYER_RADIUS);
    if (t) { ph.hit = thingId(t); ph.hx = t.x; ph.hy = t.y; ph.left = B.extra; } // 当たったらさらに extra 進む
  }
  if (ph.left > 0 && !blocked) return;
  delete p.st.phantom;
  if (!ph.hit) return; // 空振り: 爆発なし
  const t = room.enemyThings(p.team).find((t) => thingId(t) === ph.hit);
  explode(room, p, t?.x ?? ph.hx, t?.y ?? ph.hy); // 当てた相手を中心に（倒れていれば当てた位置）
}

const skill: Skill = {
  // 対象: 射程内の敵（照準モードに従う。いなければ向いている方向）
  use(room, p) {
    const t = room.pickTarget(p, B.range);
    const a = t ? Math.atan2(t.y - p.y, t.x - p.x) : p.face;
    p.st.phantom = { until: Infinity, lock: true, noAttack: true, cancel: true, view: () => ({ a }) };
    p.sk.phantom = { a, left: B.range, hit: null };
  },
  afterMove: (room, p, dt) => step(room, p, dt),
  ended: (room, p, dt) => step(room, p, dt),
  botUse: (room, p) => room.nearFoe(p, B.range, (t) => t.k === 'p' || t.k === 'boss'),
  statuses: ['phantom'],
};
export default skill;
