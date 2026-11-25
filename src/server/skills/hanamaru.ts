// 満別花丸: 花丸パンチ（CT 明けから自動でチャージ。発動で向きを決め、レベル2以上は溜めてから拳を発射。前方へ直進、キャラにダメージ・壁は1発1段階進め、壊れたら貫通。チャージのレベルで大きさ・威力・弾速が変わる）。パッシブ: 壁へ押し込み続けると一気に壊す。Bot は拳1発で壊れる壁（中破）なら壊して近道する
import type { GameRoom, Player, Ent } from '../GameRoom';
import { unbreakable, thingId } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C, Pt, Rect } from '../../shared/config';
import { CHARS } from '../../shared/chars';
import { circleRect, circleBody } from '../../shared/geom';
import { findPath } from '../pathfind';

const H = CHARS.hanamaru.skill, T = C.TILE;

// 前方の壁（幅 w × 奥行 d タイル）。外周の壁は除く
// from: 壊し始める壁タイル（なければ p の正面 reach マス以内の最初の壁）
function breakTiles(room: GameRoom, p: Pt, a: number, from?: number[]): number[][] {
  const [dx, dy] = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a)) ? [Math.sign(Math.cos(a)), 0] : [0, Math.sign(Math.sin(a))];
  let sx: number, sy: number;
  if (from) [sx, sy] = from;
  else {
    const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
    let k = 1;
    while (k <= H.reach && room.tiles[ty + dy * k]?.[tx + dx * k] !== '#') k++;
    if (k > H.reach) return [];
    sx = tx + dx * k; sy = ty + dy * k;
  }
  const out: number[][] = [];
  for (let j = 0; j < H.d; j++) {
    for (let i = -Math.floor(H.w / 2); i <= Math.floor(H.w / 2); i++) {
      const x = sx + dx * j + (dy ? i : 0), y = sy + dy * j + (dx ? i : 0);
      if (room.tiles[y]?.[x] === '#' && !unbreakable(x, y)) out.push([x, y]);
    }
  }
  return out;
}

// 拳: 直進し（f.sp px/秒）、キャラ（1体1回）に f.dmg、壁（半径 f.r）は1発で1マス1段階進め、壊れたら貫通。射程を飛ぶか、芯（半径 H.core、タメで変わらない）が壊せない壁・壊れずに残った壁に触れると消える
// 芯の外側だけが壊せない壁に触れているなら壊さずに飛び続ける（狭い通路でも撃てる）。結果画面では壁を壊さない
function updateFist(room: GameRoom, f: Ent, dt: number) {
  const owner = room.players.get(f.owner);
  let step = Math.min(f.sp * dt, f.left), gone = !owner;
  while (step > 0 && !gone) {
    const d = Math.min(8, step);
    f.x += Math.cos(f.a) * d; f.y += Math.sin(f.a) * d; f.left -= d; step -= d;
    const tiles: number[][] = [];
    for (let ty = Math.floor((f.y - f.r) / T); ty <= Math.floor((f.y + f.r) / T); ty++) for (let tx = Math.floor((f.x - f.r) / T); tx <= Math.floor((f.x + f.r) / T); tx++) {
      const b = { x: tx * T, y: ty * T, w: T, h: T };
      if (room.tiles[ty]?.[tx] !== '#' || !circleRect(f.x, f.y, f.r, b)) continue;
      if (!unbreakable(tx, ty)) tiles.push([tx, ty]);
      else if (circleRect(f.x, f.y, H.core, b)) gone = true;
    }
    if (gone) break;
    if (tiles.length && room.phase === 'playing') {
      const adv = room.hitWalls(tiles, f.wallHit);
      if (adv.length) room.addFx(f, 'wall', { tiles: adv, r: 0 });
      if (adv.length && !f.broke) { f.broke = true; room.addToku(f.team, owner!, 'wall'); } // 1回の技につき1回
      if (tiles.some(([tx, ty]) => room.tiles[ty][tx] === '#' && circleRect(f.x, f.y, H.core, { x: tx * T, y: ty * T, w: T, h: T }))) { gone = true; break; } // 壊れずに残った壁に芯が触れた: 消える
    }
    for (const t of room.enemyThings(f.team)) {
      if ((t.k !== 'p' && t.k !== 'boss') || f.hit.has(thingId(t)) || Math.hypot(t.x - f.x, t.y - f.y) > f.r + t.r) continue;
      f.hit.add(thingId(t));
      room.hitThing(owner!, t, f.dmg);
    }
  }
  if (gone || f.left <= 0) room.removeEnt(f);
}

// パッシブ: 壁へ押し込み続ける（移動入力の向きに壁があって進めない）と、push 秒でその壁を壊す。触れた瞬間では壊れない
// 対象は移動を実際に止めている壁タイル（進む向きに少しずらした体が触れる壁タイルのうち、移動の当たり判定の形（終端を短く・凸角を丸めた形）で新たに重なる壁の長方形に属するもので、体の中心に一番近いもの）
function pushWall(room: GameRoom, p: Player, px: number, py: number) {
  const [ix, iy] = room.moveIntent(p);
  if (!ix && !iy) { p.sk.pushTile = null; return; }
  const [dx, dy] = Math.abs(ix) >= Math.abs(iy) ? [Math.sign(ix), 0] : [0, Math.sign(iy)];
  const moved = dx ? Math.abs(p.x - px) : Math.abs(p.y - py), R = C.PLAYER_RADIUS, nx = p.x + dx * 4.5, ny = p.y + dy * 4.5; // 4.5: 移動の1ステップ（最大4px）より少し先
  const blockers: number[][] = [];
  for (let ty = Math.floor((ny - R) / T); ty <= Math.floor((ny + R) / T); ty++) {
    for (let tx = Math.floor((nx - R) / T); tx <= Math.floor((nx + R) / T); tx++) {
      const b = { x: tx * T, y: ty * T, w: T, h: T };
      const w = room.tiles[ty]?.[tx] === '#' && !unbreakable(tx, ty) && circleRect(nx, ny, R, b) ? room.walls.find((o) => b.x >= o.x && b.x < o.x + o.w && b.y >= o.y && b.y < o.y + o.h) : undefined;
      if (w && circleBody(nx, ny, R, w) && !circleBody(p.x, p.y, R, w)) blockers.push([tx, ty]);
    }
  }
  const hit = blockers.sort((u, v) => Math.hypot((u[0] + 0.5) * T - p.x, (u[1] + 0.5) * T - p.y) - Math.hypot((v[0] + 0.5) * T - p.x, (v[1] + 0.5) * T - p.y))[0];
  if (!hit || moved > 0.5) { p.sk.pushTile = null; return; }
  const key = `${hit[0]},${hit[1]}`;
  if (p.sk.pushTile !== key) { p.sk.pushTile = key; p.sk.pushAt = room.now; return; }
  if (room.now - p.sk.pushAt < H.push) return;
  const tiles = breakTiles(room, p, Math.atan2(dy, dx), hit);
  p.sk.pushTile = null;
  if (!tiles.length) return;
  const adv = room.hitWalls(tiles, new Set(), C.WALL_HITS); // 一気に破壊
  room.addToku(p.team, p, 'wall', undefined, Math.max(...adv.map((t) => t[2]))); // 残っていた段階の分（一番多いマス）
  room.addFx(p, 'wall', { tiles, r: 0 });
}

// チャージの秒数 → レベル（lv の添字）
const fistLevel = (held: number) => H.lv.reduce((k: number, l: any, i: number) => (held >= l.t - 1e-9 ? i : k), 0); // 1e-9: 時刻の足し算の誤差

// 自動チャージ: CT 明けから進み、発射（CT）・撤退で0に戻る。今のチャージ秒数
function charge(room: GameRoom, p: Player) {
  if (p.sk.koAt === undefined) p.sk.koAt = p.koAt;
  else if (p.sk.koAt !== p.koAt) { p.sk.koAt = p.koAt; p.sk.from = room.now; } // 撤退から戻った: 0から
  return Math.max(0, room.now - Math.max(p.skillReadyAt, p.sk.from ?? -Infinity));
}

// 拳を出す（命中・破壊は updateFist）。lv: チャージのレベル（lv の添字）、a: 向き
function fire(room: GameRoom, p: Player, lv: number, a: number) {
  const L = H.lv[lv];
  if (process.env.E2E_HOOKS) room.e2eFists.set(p.id, (room.e2eFists.get(p.id) ?? 0) + 1); // e2e: 拳を出した回数（すぐ壁に当たって消えた拳もスナップショットに関係なく数える）
  room.ents.push({ id: room.nextId++, kind: 'fist', team: p.team, owner: p.id, x: p.x, y: p.y, r: H.r * L.size, body: null, a, left: H.range, sp: H.speed * L.speed, dmg: H.dmg * L.dmg, hit: new Set(), broke: false, wallHit: new Set() });
}

// 毎tick: 溜めが終わったら発射。CT 明けはチャージの見た目（fistCharge）を付ける
function step(room: GameRoom, p: Player) {
  const w = p.st.fistWind;
  if (w && room.now - w.at! >= H.lv[p.sk.flv].wind - 1e-9) { delete p.st.fistWind; fire(room, p, p.sk.flv, p.sk.fa); }
  charge(room, p);
  if (room.now >= p.skillReadyAt && !p.st.fistWind) p.st.fistCharge ??= { until: Infinity, view: () => ({ t: charge(room, p) }) };
  else delete p.st.fistCharge;
}

const skill: Skill = {
  // 発動: 今のチャージのレベルで、向きを決めて溜め（lv[].wind 秒、移動不可。溜め中は矢印で向きを変えられ、発射時点の向きで確定）→ 発射。CT はここから。Bot の壁破壊はチャージによらずレベル1で即発射
  use(room, p) {
    delete p.st.fistCharge;
    if (p.sk.wallAim !== undefined) { fire(room, p, 0, p.sk.wallAim); p.sk.wallAim = undefined; return; }
    const lv = fistLevel(charge(room, p)), a = room.skillAim(p, H.range);
    if (!H.lv[lv].wind) { fire(room, p, lv, a); return; }
    Object.assign(p.sk, { flv: lv, fa: a });
    p.st.fistWind = { until: Infinity, at: room.now, lock: true, still: true, cancel: true, view: () => ({ a: p.sk.fa, lv: p.sk.flv }) };
  },
  arrow: (room, p) => ({ R: H.range, a: p.st.fistWind ? p.sk.fa : undefined }),
  reAim(_room, p, a) {
    if (!p.st.fistWind) return false;
    if (a !== undefined) p.sk.fa = a;
    return true;
  },
  tick: (room, p) => { step(room, p); },
  ended: (room, p) => { step(room, p); },
  afterMove(room, p, _dt, px, py, locked) {
    if (!locked && room.now >= p.stunUntil) pushWall(room, p, px, py);
  },
  botUse: (room, p) => room.inRectAhead(p, room.skillAim(p, H.range), H.range, H.r * 2).some((t) => (t.k === 'p' || t.k === 'boss') && room.reach(p, t)), // 拳の進路に敵
  // 壁を壊すと目的地への経路が大きく短くなるなら壁破壊（その方向を向いて使う）
  botMove(room, p, to: Pt, obs: Rect[]) {
    if (room.phase !== 'playing' || room.now < p.skillReadyAt || p.st.fistWind || room.effect(p, 'noSkill') || room.now < (p.sk.wallCheckAt ?? 0)) return false;
    p.sk.wallCheckAt = room.now + H.botCheck;
    const base = findPath(p, to, obs, room.walls).length;
    if (!base) return false;
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const ts = breakTiles(room, p, a);
      if (!ts.length || ts.some(([x, y]) => room.wallStage(x, y) < C.WALL_HITS - 1)) continue; // 拳1発（1段階）で壊れきる壁（中破）だけ
      // 壊した後の経路長 ≒ 壁の向こうの床からの経路長 + 壁までと壁の厚み
      const dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a)), tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
      let k = 1;
      while (room.tiles[ty + dy * k]?.[tx + dx * k] !== '#') k++;
      const bx = tx + dx * (k + H.d), by = ty + dy * (k + H.d);
      if (room.tiles[by]?.[bx] !== '.') continue; // 壁が厚くて抜けない
      const rest = findPath({ x: bx * T + T / 2, y: by * T + T / 2 }, to, obs, room.walls).length;
      const len = rest && rest + k + H.d;
      if (len && (base - len) * C.GRID_CELL >= H.botSave) {
        p.face = a; p.tgt = null; p.sk.wallAim = a; // 壁の方向へ使う（レベル1・溜めなし）
        room.skill(p.id);
        p.sk.wallAim = undefined;
        return true;
      }
    }
    return false;
  },
  statuses: ['fistCharge', 'fistWind'],
  ents: { fist: { update: updateFist, fog: true } },
};
export default skill;
