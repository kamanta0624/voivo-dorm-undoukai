// 九州そら: ソーラーキャノン（試合開始から自動でチャージ。発射するとその場で止まり、向いている方向へ一定時間ビームを照射。キャラを貫通して多段ヒット、壊せる壁は1照射1段階進め、壊れたら進む（残った壁で止まる）。チャージが多いと爆発も起きる）
import type { GameRoom, Player, Thing } from '../GameRoom';
import { PERIMETER, thingId } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C, Rect } from '../../shared/config';
import { CHARS } from '../../shared/chars';
import { circleRect } from '../../shared/geom';
import { solarAt } from '../../shared/solar';

const S = CHARS.sora.skill, T = C.TILE, K = S.keys as number[][];
export { solarAt }; // 補間は shared/solar.ts（技ボタンの％と共通）

// 照射の状態（発射時に決める）。start: ビームが出る時刻（発射から delay 秒後。チャージ keys の最後から2番目の秒数を超えた発射は遅れなし）
type Beam = { a: number; start: number; charge: number; dur: number; range: number; boomR: number; boom: boolean; len: number; walls0: Rect[]; next: Record<string, number>; seen: Set<string>; boomed: Set<string>; wallsBoomed: Set<number>; endBoom: boolean; toku: number; wallHit: Set<number>; hits: number; pending: { x: number; y: number }[] }; // pending: このtickに起こす爆発の位置。wallHit: この照射で段階を進めた壁のマス。toku: この照射で入れた壁破壊の徳の回数。hits: 壁を一度に進める段階（チャージ keys の最後から2番目の秒数を超えた発射は即破壊）

// 総ダメージの配分: ビームの1ヒット（照射秒で多段の回数が変わる）・爆発（大将は別の値）
const hitDmg = (b: Beam, t: Thing) => (solarAt(b.charge, 1, t.k === 'boss') * (b.boom ? S.beamShare : 1)) / Math.round(b.dur / S.every);
const boomDmg = (b: Beam, t: Thing) => solarAt(b.charge, 1, t.k === 'boss') * (1 - S.beamShare);

// 壁の段階を進める（外周は除く。1回の照射で同じマスは1段階まで）。徳は1回の照射で、進めた段階が一番多いマスの段階数分（即破壊は残っていた段階の分）。at があればエフェクトを出す。進めたマスを返す
function breakTiles(room: GameRoom, p: Player, b: Beam, tiles: number[][], at?: { x: number; y: number }) {
  if (!tiles.length || room.phase !== 'playing') return [];
  const adv = room.hitWalls(tiles, b.wallHit, b.hits);
  if (!adv.length) return adv;
  if (at) room.addFx({ x: at.x, y: at.y, team: p.team }, 'wall', { tiles: adv, r: 0 });
  const d = Math.max(...adv.map((t) => t[2]));
  if (d > b.toku) { room.addToku(p.team, p, 'wall', undefined, d - b.toku); b.toku = d; }
  return adv;
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
  if (room.now < b.start - 1e-9) return; // 発生の遅れの間はビームを出さない（向きも変えない）。1e-9: 時刻の足し算の誤差
  // 向き: 移動入力の方へ毎秒 turn まで
  const [ix, iy] = room.moveIntent(p);
  if (ix || iy) { const d = Math.atan2(Math.sin(Math.atan2(iy, ix) - b.a), Math.cos(Math.atan2(iy, ix) - b.a)); b.a += Math.sign(d) * Math.min(Math.abs(d), S.turn * dt); }
  const ux = Math.cos(b.a), uy = Math.sin(b.a), hw = S.w / 2, play = room.phase === 'playing';
  // ビームを伸ばす（4px 刻み）。壊せる壁は段階を進め、壊れたら進む。壊れずに残った壁・外壁で止まる（結果画面では壊さず止まる）
  let len = 0, stop = false;
  const tiles: number[][] = [];
  for (let s = 0; s <= b.range && !stop; s += 4) {
    const x = p.x + ux * s, y = p.y + uy * s, here: number[][] = [];
    for (let ty = Math.floor((y - hw) / T); ty <= Math.floor((y + hw) / T) && !stop; ty++) for (let tx = Math.floor((x - hw) / T); tx <= Math.floor((x + hw) / T); tx++) {
      if (room.tiles[ty]?.[tx] !== '#' || !circleRect(x, y, hw, { x: tx * T, y: ty * T, w: T, h: T })) continue;
      if ((PERIMETER[ty]?.[tx] ?? true) || !play) { stop = true; break; }
      here.push([tx, ty]);
      // 壁の爆発: 照射開始時の壁の長方形ごとに1回
      const wi = b.walls0.findIndex((w) => tx * T >= w.x && tx * T < w.x + w.w && ty * T >= w.y && ty * T < w.y + w.h);
      if (b.boom && wi >= 0 && !b.wallsBoomed.has(wi)) { b.wallsBoomed.add(wi); b.pending.push({ x, y }); }
    }
    tiles.push(...breakTiles(room, p, b, here));
    if (here.some(([tx, ty]) => room.tiles[ty][tx] === '#')) stop = true; // 壊れずに残った壁で止まる
    if (!stop) len = s;
  }
  b.len = len;
  if (tiles.length) room.addFx({ x: p.x + ux * len, y: p.y + uy * len, team: p.team }, 'wall', { tiles, r: 0 });
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
    const c = p.sk.charge ?? 0, a = room.skillAim(p, solarAt(c, 2)), start = room.now + (c > K[K.length - 2][0] ? 0 : S.delay);
    p.sk.beam = { a, start, charge: c, dur: solarAt(c, 4), range: solarAt(c, 2), boomR: solarAt(c, 3), boom: c >= S.boomFrom, len: 0, walls0: room.walls, next: {}, seen: new Set(), boomed: new Set(), wallsBoomed: new Set(), endBoom: false, toku: 0, wallHit: new Set(), hits: c > K[K.length - 2][0] ? C.WALL_HITS : 1, pending: [] };
    p.sk.charge = 0;
    p.st.solar = { until: start + p.sk.beam.dur, lock: true, still: true, noAttack: true, cancel: true, view: () => ({ a: p.sk.beam?.a ?? a, len: p.sk.beam?.len ?? 0, w: S.w, k: Math.min(1, c / K[K.length - 1][0]), pre: room.now < start - 1e-9 ? solarAt(c, 2) : 0 }) }; // pre: 発生の遅れの間の射線の予兆の長さ（発射時の射程。出ていなければ0）
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
  arrow: (_room, p) => ({ R: solarAt(p.sk.charge ?? 0, 2) }),
  statuses: ['solar', 'solarCharge'],
};
export default skill;
