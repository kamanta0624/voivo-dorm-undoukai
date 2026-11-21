import { CONFIG, Rect } from './config';

export function circleRect(x: number, y: number, r: number, b: Rect): boolean {
  const cx = Math.max(b.x, Math.min(x, b.x + b.w));
  const cy = Math.max(b.y, Math.min(y, b.y + b.h));
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
}

// 丸めた凸角の中心と半径（点がその角の範囲にあるとき。m は移動の当たり判定の形）
function roundCorner(x: number, y: number, m: NonNullable<Rect['m']>) {
  const k = Math.min(CONFIG.WALL_EDGE.round, m.w / 2, m.h / 2);
  const left = x < m.x + k, right = x > m.x + m.w - k, top = y < m.y + k, bottom = y > m.y + m.h - k;
  const bit = top && left ? 1 : top && right ? 2 : bottom && right ? 4 : bottom && left ? 8 : 0;
  if (!(m.k & bit)) return null;
  return { cx: left ? m.x + k : m.x + m.w - k, cy: top ? m.y + k : m.y + m.h - k, k };
}

// 移動の当たり判定（キャラ・大将・コバコ・場の物の移動と押し出し）: 壁は終端を短く、凸角を丸めた形（m）。m のない障害物は長方形のまま
export function circleBody(x: number, y: number, r: number, b: Rect): boolean {
  const m = b.m;
  if (!m) return circleRect(x, y, r, b);
  const c = roundCorner(x, y, m);
  return c ? Math.hypot(x - c.cx, y - c.cy) - c.k < r : circleRect(x, y, r, m);
}

function blocked(ox: number, oy: number, nx: number, ny: number, r: number, obstacles: Rect[]): boolean {
  if (nx < r || ny < r || nx > CONFIG.MAP_W - r || ny > CONFIG.MAP_H - r) return true;
  // 元から重なっている障害物は無視
  return obstacles.some((b) => circleBody(nx, ny, r, b) && !circleBody(ox, oy, r, b));
}

// 軸ごとに移動して壁で止める。丸めた凸角に当たったら、止まらず接線の向きへ同じ速さで滑る
export function moveCircle(x: number, y: number, dx: number, dy: number, r: number, obstacles: Rect[]) {
  let nx = x, ny = y;
  if (!blocked(x, y, x + dx, y, r, obstacles)) nx += dx;
  if (!blocked(nx, y, nx, y + dy, r, obstacles)) ny += dy;
  if (nx === x + dx && ny === y + dy) return { x: nx, y: ny };
  for (const b of obstacles) {
    const c = b.m && circleBody(x + dx, y + dy, r, b) ? roundCorner(x + dx, y + dy, b.m) : null;
    if (!c) continue;
    const l = Math.hypot(dx, dy), d = Math.hypot(x - c.cx, y - c.cy) || 1, ux = (x - c.cx) / d, uy = (y - c.cy) / d, dot = dx * ux + dy * uy;
    if (dot >= 0) continue;
    const tx = dx - dot * ux, ty = dy - dot * uy, tl = Math.hypot(tx, ty);
    if (tl < 1e-9) continue;
    // 接線の向きへ同じ距離だけ進め、角の丸みの外側へ戻す（直線で進むと丸みに少し食い込むため）
    let sx = x + (tx / tl) * l, sy = y + (ty / tl) * l;
    const e = Math.hypot(sx - c.cx, sy - c.cy) || 1, out = c.k + r + 1e-6;
    if (e < out) { sx = c.cx + ((sx - c.cx) / e) * out; sy = c.cy + ((sy - c.cy) / e) * out; }
    if (!blocked(x, y, sx, sy, r, obstacles)) return { x: sx, y: sy };
  }
  return { x: nx, y: ny };
}

function segSeg(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (d === 0) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function segHitsRect(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  const x2 = r.x + r.w, y2 = r.y + r.h;
  return (
    segSeg(ax, ay, bx, by, r.x, r.y, x2, r.y) ||
    segSeg(ax, ay, bx, by, x2, r.y, x2, y2) ||
    segSeg(ax, ay, bx, by, x2, y2, r.x, y2) ||
    segSeg(ax, ay, bx, by, r.x, y2, r.x, r.y)
  );
}

export function lineOfSight(ax: number, ay: number, bx: number, by: number, obstacles: Rect[]): boolean {
  return !obstacles.some((r) => segHitsRect(ax, ay, bx, by, r));
}

export function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function overlaps(x: number, y: number, r: number, obstacles: Rect[]): boolean {
  return obstacles.some((b) => circleBody(x, y, r, b));
}

// キャラ・大将・ファンネルの位置を変える唯一の関数。細かく刻んで動かし、壁を通り抜けない
// slide=true: 通常移動（壁に沿って滑る）／ false: 強制移動（はじき・突撃。途中で当たったらそこで止まる）
export function moveBody(x: number, y: number, dx: number, dy: number, r: number, obstacles: Rect[], slide = true, corrected?: (p: { x: number; y: number }) => void) {
  const start = pushOut(x, y, r, obstacles);
  if (start.x !== x || start.y !== y) corrected?.(start);
  ({ x, y } = start); // 重なった状態から動くと、その壁を無視して抜けてしまうため
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
  for (let i = 0; i < n; i++) {
    const m = moveCircle(x, y, dx / n, dy / n, r, obstacles);
    if (!slide && (Math.abs(m.x - x - dx / n) > 1e-9 || Math.abs(m.y - y - dy / n) > 1e-9)) break;
    x = m.x; y = m.y;
  }
  return { x, y };
}

// 壁と重なっていれば、最寄りの空き位置へ押し出す（重なっていなければそのまま）
export function pushOut(x: number, y: number, r: number, obstacles: Rect[]) {
  if (!overlaps(x, y, r, obstacles)) return { x, y };
  for (let d = 2; d <= 96; d += 2) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d;
      if (nx >= r && ny >= r && nx <= CONFIG.MAP_W - r && ny <= CONFIG.MAP_H - r && !overlaps(nx, ny, r, obstacles)) return { x: nx, y: ny };
    }
  }
  return { x, y };
}

// 部屋の内側 r から出られないようにする壁（r の外側を囲む4つの長方形）
export function cage(r: Rect): Rect[] {
  const B = 4096;
  return [{ x: r.x - B, y: r.y - B, w: r.w + B * 2, h: B }, { x: r.x - B, y: r.y + r.h, w: r.w + B * 2, h: B }, { x: r.x - B, y: r.y, w: B, h: r.h }, { x: r.x + r.w, y: r.y, w: B, h: r.h }];
}

// アルの突撃のエフェクト（＝攻撃判定）: 雫を寸詰まりにして横に倒した形。(x, y) は自キャラ、a は進行方向
// 頭（半径 w/2 の円）の中心が進行方向へ head 前、全体の長さ len、尾は頭の中心から後ろへ細くなる。margin だけ広げて判定する。S: 形（技の定義の w・head・len）
export function inDashShape(S: Record<string, number>, px: number, py: number, x: number, y: number, a: number, margin = 0) {
  const R = S.w / 2, ux = Math.cos(a), uy = Math.sin(a);
  const rx = px - x, ry = py - y, along = rx * ux + ry * uy, side = Math.abs(-rx * uy + ry * ux);
  if (Math.hypot(along - S.head, side) <= R + margin) return true;
  const tail = S.head + R - S.len; // 尾の端（自キャラから見た進行方向の位置。負なら後ろ）
  return along >= tail - margin && along <= S.head && side <= (R * (along - tail)) / (S.head - tail) + margin;
}
