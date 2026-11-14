import { CONFIG as C, Rect, Pt } from '../shared/config';
import { circleRect } from '../shared/geom';

const wallMasks = new WeakMap<Rect[], Uint8Array>(); // 壁の一覧ごと（壁破壊で一覧が変わる）
function mask(W: number, H: number, S: number, r: number, obstacles: Rect[], edge: boolean) {
  const m = new Uint8Array(W * H);
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const x = gx * S + S / 2, y = gy * S + S / 2;
      if ((edge && (x < r || y < r || x > C.MAP_W - r || y > C.MAP_H - r)) || obstacles.some((o) => circleRect(x, y, r, o))) m[gy * W + gx] = 1;
    }
  }
  return m;
}

// グリッド上の A*（8方向、角のすり抜けなし）。戻り値は経由点の列（最後は目標座標そのもの）
export function findPath(from: Pt, to: Pt, obstacles: Rect[], walls: Rect[] = C.WALLS): Pt[] {
  const S = C.GRID_CELL, W = Math.ceil(C.MAP_W / S), H = Math.ceil(C.MAP_H / S);
  const r = C.PLAYER_RADIUS + 4;
  // 固定の壁は初回だけ判定し、それ以外（バリケード）を毎回足す
  const wallSet = new Set(walls);
  const dyn = obstacles.filter((o) => !wallSet.has(o));
  if (!wallMasks.has(walls)) wallMasks.set(walls, mask(W, H, S, r, walls, true));
  const blocked = wallMasks.get(walls)!.slice();
  if (dyn.length) mask(W, H, S, r, dyn, false).forEach((v, i) => (blocked[i] |= v));
  const cell = (p: Pt) => Math.min(H - 1, Math.max(0, Math.floor(p.y / S))) * W + Math.min(W - 1, Math.max(0, Math.floor(p.x / S)));
  const start = cell(from), goal = cell(to);
  blocked[start] = 0;
  blocked[goal] = 0;
  const g = new Float32Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const h = (i: number) => Math.hypot((i % W) - (goal % W), Math.floor(i / W) - Math.floor(goal / W));
  const open: { i: number; f: number }[] = [{ i: start, f: h(start) }];
  g[start] = 0;
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
    const { i } = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) break;
    const x = i % W, y = Math.floor(i / W);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (blocked[n] || closed[n]) continue;
        if (dx && dy && (blocked[y * W + nx] || blocked[ny * W + x])) continue;
        const ng = g[i] + (dx && dy ? Math.SQRT2 : 1);
        if (ng < g[n]) {
          g[n] = ng;
          prev[n] = i;
          open.push({ i: n, f: ng + h(n) });
        }
      }
    }
  }
  if (prev[goal] === -1 && goal !== start) return [];
  const pts: Pt[] = [];
  for (let i = prev[goal]; i !== -1 && i !== start; i = prev[i]) pts.unshift({ x: (i % W) * S + S / 2, y: Math.floor(i / W) * S + S / 2 });
  pts.push({ x: to.x, y: to.y });
  return pts;
}
