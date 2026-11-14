import { CONFIG, Rect } from './config';

export function circleRect(x: number, y: number, r: number, b: Rect): boolean {
  const cx = Math.max(b.x, Math.min(x, b.x + b.w));
  const cy = Math.max(b.y, Math.min(y, b.y + b.h));
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
}

function blocked(ox: number, oy: number, nx: number, ny: number, r: number, obstacles: Rect[]): boolean {
  if (nx < r || ny < r || nx > CONFIG.MAP_W - r || ny > CONFIG.MAP_H - r) return true;
  // 元から重なっている障害物（足元に置いたバリケード等）は無視
  return obstacles.some((b) => circleRect(nx, ny, r, b) && !circleRect(ox, oy, r, b));
}

// 軸ごとに移動して壁で止める
export function moveCircle(x: number, y: number, dx: number, dy: number, r: number, obstacles: Rect[]) {
  if (!blocked(x, y, x + dx, y, r, obstacles)) x += dx;
  if (!blocked(x, y, x, y + dy, r, obstacles)) y += dy;
  return { x, y };
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
  return obstacles.some((b) => circleRect(x, y, r, b));
}

// キャラ・大将・ファンネルの位置を変える唯一の関数。細かく刻んで動かし、壁・バリケードを通り抜けない
// slide=true: 通常移動（壁に沿って滑る）／ false: 強制移動（はじき・突撃。途中で当たったらそこで止まる）
export function moveBody(x: number, y: number, dx: number, dy: number, r: number, obstacles: Rect[], slide = true) {
  ({ x, y } = pushOut(x, y, r, obstacles)); // 重なった状態から動くと、その壁を無視して抜けてしまうため
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
  for (let i = 0; i < n; i++) {
    const m = moveCircle(x, y, dx / n, dy / n, r, obstacles);
    if (!slide && (Math.abs(m.x - x - dx / n) > 1e-9 || Math.abs(m.y - y - dy / n) > 1e-9)) break;
    x = m.x; y = m.y;
  }
  return { x, y };
}

// 壁・バリケードと重なっていれば、最寄りの空き位置へ押し出す（重なっていなければそのまま）
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

// 罠・バリケードを置けるか（キャラ・大将・ファンネルと重なる位置には置けない）
export function canPlace(kind: string, x: number, y: number, bodies: { x: number; y: number; r: number }[]): boolean {
  const s = CONFIG.BARRICADE_SIZE;
  return !bodies.some((b) => (kind === 'trap' ? Math.hypot(b.x - x, b.y - y) < CONFIG.TRAP_RADIUS + b.r : circleRect(b.x, b.y, b.r, { x: x - s / 2, y: y - s / 2, w: s, h: s })));
}

// 部屋の内側 r から出られないようにする壁（r の外側を囲む4つの長方形）
export function cage(r: Rect): Rect[] {
  const B = 4096;
  return [{ x: r.x - B, y: r.y - B, w: r.w + B * 2, h: B }, { x: r.x - B, y: r.y + r.h, w: r.w + B * 2, h: B }, { x: r.x - B, y: r.y, w: B, h: r.h }, { x: r.x + r.w, y: r.y, w: B, h: r.h }];
}

// アルの突撃のエフェクト（＝攻撃判定）: 雫を寸詰まりにして横に倒した形。(x, y) は自キャラ、a は進行方向
// 頭（半径 w/2 の円）の中心が進行方向へ head 前、全体の長さ len、尾は頭の中心から後ろへ細くなる。margin だけ広げて判定する
export function inDashShape(px: number, py: number, x: number, y: number, a: number, margin = 0) {
  const S = CONFIG.SKILLS.aru, R = S.w / 2, ux = Math.cos(a), uy = Math.sin(a);
  const rx = px - x, ry = py - y, along = rx * ux + ry * uy, side = Math.abs(-rx * uy + ry * ux);
  if (Math.hypot(along - S.head, side) <= R + margin) return true;
  const tail = S.head + R - S.len; // 尾の端（自キャラから見た進行方向の位置。負なら後ろ）
  return along >= tail - margin && along <= S.head && side <= (R * (along - tail)) / (S.head - tail) + margin;
}
