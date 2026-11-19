// 九州そら: ソーラーキャノン（試合開始から自動でチャージ。発射するとその場で止まり、向いている方向へ一定時間ビームを照射。キャラを貫通して多段ヒット、壊せる壁は壊して進む。チャージが多いと爆発も起きる）
import type { GameRoom, Player, Thing } from '../GameRoom';
import { PERIMETER, thingId } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C, Rect } from '../../shared/config';
import { CHARS } from '../../shared/chars';
import { circleRect } from '../../shared/geom';

const S = CHARS.sora.skill, T = C.TILE, K = S.keys as number[][];
const BOSS_LAST = S.bossMax / (C.DAMAGE_MULT * C.ATTACKER_BOSS_MULT); // 最大チャージの大将への総ダメージ（倍率を掛ける前）。全倍率の後で bossMax になる

// チャージ秒 → キーフレームの線形補間。col: 1=総ダメージ 2=射程 3=爆発半径。boss: 大将への総ダメージ（最後のキーフレームだけ BOSS_LAST）
export function solarAt(charge: number, col: number, boss = false) {
  const v = (i: number) => (boss && col === 1 && i === K.length - 1 ? BOSS_LAST : K[i][col]);
  if (charge <= K[0][0]) return v(0);
  for (let i = 1; i < K.length; i++) if (charge <= K[i][0]) return v(i - 1) + ((v(i) - v(i - 1)) * (charge - K[i - 1][0])) / (K[i][0] - K[i - 1][0]);
  return v(K.length - 1);
}

// 照射の状態（発射時に決める）
type Beam = { a: number; charge: number; range: number; boomR: number; boom: boolean; len: number; walls0: Rect[]; next: Record<string, number>; seen: Set<string>; boomed: Set<string>; wallsBoomed: Set<number>; endBoom: boolean; broke: boolean; pending: { x: number; y: number }[] }; // pending: このtickに起こす爆発の位置

// 総ダメージの配分: ビームの1ヒット・爆発（大将は別の値）
const hitDmg = (b: Beam, t: Thing) => (solarAt(b.charge, 1, t.k === 'boss') * (b.boom ? S.beamShare : 1)) / Math.round(S.dur / S.every);
const boomDmg = (b: Beam, t: Thing) => solarAt(b.charge, 1, t.k === 'boss') * (1 - S.beamShare);

// 壁を壊す（外周は除く）。1回の照射につき徳は1回
function breakTiles(room: GameRoom, p: Player, b: Beam, tiles: number[][], at: { x: number; y: number }) {
  if (!tiles.length || room.phase !== 'playing') return;
  room.breakWalls(tiles);
  room.addFx({ x: at.x, y: at.y, team: p.team }, 'wall', { tiles, r: 0 });
  if (!b.broke) { b.broke = true; room.addToku(p.team, p, 'wall'); }
}

// 爆発: (x, y) 中心の半径 boomR の敵に、1照射1回だけダメージ。範囲の壁も壊す
function explode(room: GameRoom, p: Player, b: Beam, x: number, y: number) {
  for (const t of room.enemyThings(p.team)) {
    const id = thingId(t);
    if (b.boomed.has(id) || Math.hypot(t.x - x, t.y - y) > b.boomR + t.r) continue;
    b.boomed.add(id);
    if (t.k === 'boss') t.o.holdUntil = Math.max(t.o.holdUntil, room.now + S.every); // ビームが当たっている間は拠点移動しない
    room.hitThing(p, t, boomDmg(b, t));
  }
  const tiles: number[][] = [];
  for (let ty = Math.floor((y - b.boomR) / T); ty <= Math.floor((y + b.boomR) / T); ty++) for (let tx = Math.floor((x - b.boomR) / T); tx <= Math.floor((x + b.boomR) / T); tx++) {
    if (room.tiles[ty]?.[tx] === '#' && !PERIMETER[ty][tx] && circleRect(x, y, b.boomR, { x: tx * T, y: ty * T, w: T, h: T })) tiles.push([tx, ty]);
  }
  breakTiles(room, p, b, tiles, { x, y });
  room.addFx({ x, y, team: p.team }, 'aura', { r: Math.max(b.boomR, 12), color: 'solar' });
}

// 照射の1tick: 向きを少し変え、ビームを伸ばして（壊せる壁は壊し、外壁・射程の端で止まる）、当たったキャラに多段ヒット・爆発
function beam(room: GameRoom, p: Player, dt: number) {
  const b: Beam | undefined = p.sk.beam;
  if (!b || !p.st.solar) return;
  if (!room.stat(p, 'solar')) { delete p.st.solar; p.sk.beam = undefined; return; }
  // 向き: 移動入力の方へ毎秒 turn まで
  const [ix, iy] = room.moveIntent(p);
  if (ix || iy) { const d = Math.atan2(Math.sin(Math.atan2(iy, ix) - b.a), Math.cos(Math.atan2(iy, ix) - b.a)); b.a += Math.sign(d) * Math.min(Math.abs(d), S.turn * dt); }
  const ux = Math.cos(b.a), uy = Math.sin(b.a), hw = S.w / 2, play = room.phase === 'playing';
  // ビームを伸ばす（4px 刻み）。壊せる壁は壊して進む（結果画面では壊さず止まる）
  let len = 0, stop = false;
  const tiles: number[][] = [];
  for (let s = 0; s <= b.range && !stop; s += 4) {
    const x = p.x + ux * s, y = p.y + uy * s;
    for (let ty = Math.floor((y - hw) / T); ty <= Math.floor((y + hw) / T) && !stop; ty++) for (let tx = Math.floor((x - hw) / T); tx <= Math.floor((x + hw) / T); tx++) {
      if (room.tiles[ty]?.[tx] !== '#' || tiles.some(([a, c]) => a === tx && c === ty) || !circleRect(x, y, hw, { x: tx * T, y: ty * T, w: T, h: T })) continue;
      if ((PERIMETER[ty]?.[tx] ?? true) || !play) { stop = true; break; }
      tiles.push([tx, ty]);
      // 壁の爆発: 照射開始時の壁の長方形ごとに1回
      const wi = b.walls0.findIndex((w) => tx * T >= w.x && tx * T < w.x + w.w && ty * T >= w.y && ty * T < w.y + w.h);
      if (b.boom && wi >= 0 && !b.wallsBoomed.has(wi)) { b.wallsBoomed.add(wi); b.pending.push({ x, y }); }
    }
    if (!stop) len = s;
  }
  b.len = len;
  breakTiles(room, p, b, tiles, { x: p.x + ux * len, y: p.y + uy * len });
  // 射程の端・外壁に着いた点で1回爆発
  if (b.boom && !b.endBoom) { b.endBoom = true; b.pending.push({ x: p.x + ux * len, y: p.y + uy * len }); }
  // キャラ: ビーム（線分、幅 w）に触れた敵へ every 秒おきにダメージ。初めて触れたキャラ（プレイヤー・大将）で1回爆発
  for (const t of room.enemyThings(p.team)) {
    const rx = t.x - p.x, ry = t.y - p.y, along = rx * ux + ry * uy;
    if (along < -t.r || along > len + t.r || Math.abs(-rx * uy + ry * ux) > hw + t.r) continue;
    const id = thingId(t);
    if (t.k === 'boss') t.o.holdUntil = Math.max(t.o.holdUntil, room.now + S.every); // ビームが当たっている間は拠点移動しない
    if (b.boom && (t.k === 'p' || t.k === 'boss') && !b.seen.has(id)) { b.seen.add(id); b.pending.push({ x: t.x, y: t.y }); }
    if (room.now < (b.next[id] ?? -Infinity) - 1e-9) continue; // 1e-9: 時刻の足し算の誤差
    b.next[id] = room.now + S.every;
    room.hitThing(p, t, hitDmg(b, t));
  }
  for (const q of b.pending.splice(0)) explode(room, p, b, q.x, q.y);
}

// チャージ: 試合中だけ進む。撤退（撃破）で0から
function charge(room: GameRoom, p: Player, dt: number) {
  if (p.sk.koAt !== p.koAt) { p.sk.koAt = p.koAt; p.sk.charge = 0; }
  p.sk.charge = (p.sk.charge ?? 0) + dt;
  p.st.solarCharge ??= { until: Infinity, view: () => p.sk.charge }; // 光の見た目（復活で状態は消えるので付け直す）
}

const skill: Skill = {
  use(room, p) {
    const c = p.sk.charge ?? 0, a = room.skillAim(p, solarAt(c, 2));
    p.sk.beam = { a, charge: c, range: solarAt(c, 2), boomR: solarAt(c, 3), boom: c >= S.boomFrom, len: 0, walls0: room.walls, next: {}, seen: new Set(), boomed: new Set(), wallsBoomed: new Set(), endBoom: false, broke: false, pending: [] };
    p.sk.charge = 0;
    p.st.solar = { until: room.now + S.dur, lock: true, noAttack: true, cancel: true, view: () => ({ a: p.sk.beam?.a ?? a, len: p.sk.beam?.len ?? 0, w: S.w, k: Math.min(1, c / K[K.length - 1][0]) }) };
  },
  tick(room, p, dt) {
    if (room.phase === 'playing') charge(room, p, dt);
    beam(room, p, dt);
  },
  ended: (room, p, dt) => beam(room, p, dt),
  // Bot: チャージ botMin 秒以上で、ビームの線上に敵か大将がいれば撃つ
  botUse(room, p) {
    const c = p.sk.charge ?? 0, R = solarAt(c, 2);
    return c >= S.botMin && room.inRectAhead(p, room.skillAim(p, R), R, S.w).some((t) => (t.k === 'p' || t.k === 'boss') && room.targetable(t));
  },
  statuses: ['solar', 'solarCharge'],
};
export default skill;
