// マップのチップ描画（本体 main.ts と試験ページ /maptest で共通）。素材は包み public/assets/mapchip.bin（管理外。mapchip/pack.ts。加工せず描画時に切り出す）
import MAP from '../../shared/map.json';
import { KIND, ROOMS, FLOOR_DEFAULT, OUTSIDE, OUTSIDE_TONE, OUTSIDE_TONES, RUGS, WALL, type OutsideTone } from './chips';
import { ITEMS, PLACE } from './furniture';

const T = MAP.tileSize; // 16px（チップと同じ）
export const CHIP_FILES = { base: 'BaseChip_nimono.png', ceiling: WALL.ceiling, atrium: WALL.atrium, dark: WALL.dark, glass: WALL.glass };
export type Pics = Record<keyof typeof CHIP_FILES, CanvasImageSource>;
export const PLAIN = ['#1a1a1a', '#b9b2a2', '#4a423a']; // 素材がないときの単色（外・床・壁）

const key = (x: number, y: number) => `${x},${y}`;
const GLASS = new Set(MAP.clear.glass.map(([x, y]) => key(x, y))), FENCE = new Set(MAP.clear.fence.map(([x, y]) => key(x, y)));
const atrium = MAP.rooms.find((r) => r.id === 'entrance')!.rect;
const atriumWall = (x: number, y: number) => x >= atrium[0] && x <= atrium[2] && y >= atrium[1] && y <= atrium[3];
// 床のタイルが属する部屋。内側にない（扉の穴・壊れた壁の跡など）なら null。ただし同じ名前の部屋どうしの境目（道場・茶室の撤去した壁）は先の部屋
const roomAt = (x: number, y: number) => {
  const r = MAP.rooms.find((q) => x > q.rect[0] && x < q.rect[2] && y > q.rect[1] && y < q.rect[3]);
  if (r) return ROOMS[r.id] ?? null;
  const on = MAP.rooms.filter((q) => x >= q.rect[0] && x <= q.rect[2] && y >= q.rect[1] && y <= q.rect[3] && ROOMS[q.id]);
  return on.length === 2 && ROOMS[on[0].id].name === ROOMS[on[1].id].name ? ROOMS[on[0].id] : null;
};
const floorOf = (rm: ReturnType<typeof roomAt>) => (rm ? rm.floor ?? KIND[rm.kind].floor : FLOOR_DEFAULT);
const faceOf = (rm: ReturnType<typeof roomAt>) => (rm ? rm.face ?? KIND[rm.kind].face : KIND.open.face);

// マス [x0..x1]×[y0..y1] の範囲だけ描き直す（g はマップ全体・1倍）。tiles は試合中のタイル（壊れた壁は '.'）。p なしは単色。tone: 建物の外の色調
export function paintMap(g: CanvasRenderingContext2D, p: Pics | null, tiles: string[], x0 = 0, y0 = 0, x1 = MAP.width - 1, y1 = MAP.height - 1, tone: OutsideTone = OUTSIDE_TONE) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(MAP.width - 1, x1); y1 = Math.min(MAP.height - 1, y1);
  g.save(); g.beginPath(); g.rect(x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T); g.clip();
  // 範囲の1マス外まで回す（壁の正面は1マス下へはみ出す）
  const each = (f: (x: number, y: number) => void) => { for (let y = Math.max(0, y0 - 1); y <= Math.min(MAP.height - 1, y1 + 1); y++) for (let x = Math.max(0, x0 - 1); x <= Math.min(MAP.width - 1, x1 + 1); x++) f(x, y); };
  const wall = (x: number, y: number) => tiles[y]?.[x] === '#';
  if (!p) { each((x, y) => { const ch = tiles[y][x]; g.fillStyle = PLAIN[ch === '#' ? 2 : ch === '.' ? 1 : 0]; g.fillRect(x * T, y * T, T, T); }); g.restore(); return; }
  // 壊れない壁（ゲームの PERIMETER と同じ: 周り8マスに建物の外 ' ' がある壁）
  const perimeter = (x: number, y: number) => wall(x, y) && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (tiles[y + dy]?.[x + dx] ?? ' ') === ' '));
  // 壁の正面: 部屋・廊下から見て北側の横向きの壁（真下が床で、左右どちらかに壁が続く）。見た目だけで、当たり判定は壁のマスのまま
  // 縦の壁の扉の真上は正面にしない（はみ出しが扉に重なって通れないように見えるので。天井のオートタイルで描く）
  const doorBelow = (x: number, y: number) => {
    if (tiles[y + 1]?.[x - 1] !== '.' || tiles[y + 1]?.[x + 1] !== '.') return false;
    let k = y + 1; while (tiles[k]?.[x] === '.') k++;
    return wall(x, k) && wall(x, k + 1) && !wall(x - 1, k) && !wall(x + 1, k);
  };
  const front = (x: number, y: number) => wall(x, y) && tiles[y + 1]?.[x] === '.' && (wall(x - 1, y) || wall(x + 1, y)) && !doorBelow(x, y);
  const chip = (cr: [number, number], x: number, y: number, h = 1) => g.drawImage(p.base, cr[0] * T, cr[1] * T, T, T * h, x * T, y * T, T, T * h);
  // WOLF 形式のオートタイル: 4分割した角ごとに、横・縦・斜めの隣が壁かでパーツを選ぶ（0=孤立 1=縦 2=横 3=内角 4=全面）
  const auto = (img: CanvasImageSource, x: number, y: number) => {
    for (const dy of [0, 1]) for (const dx of [0, 1]) {
      const hx = x + (dx ? 1 : -1), vy = y + (dy ? 1 : -1), h = wall(hx, y), v = wall(x, vy), d = wall(hx, vy);
      const part = !h && !v ? 0 : v && !h ? 1 : h && !v ? 2 : !d ? 3 : 4, H = T / 2;
      g.drawImage(img, dx * H, part * T + dy * H, H, H, x * T + dx * H, y * T + dy * H, H, H);
    }
  };
  // 床・建物の外（壁の下も土にしておく: 柵・ガラスの透ける所）
  each((x, y) => chip(tiles[y][x] === '.' ? floorOf(roomAt(x, y)) : OUTSIDE, x, y));
  // 立ち入り不可（建物の外と、柵・ガラスの下に透ける土）の色調: 彩度を落とす・暗くする・斜線
  const tn = OUTSIDE_TONES[tone];
  each((x, y) => {
    if (tiles[y][x] === '.') return;
    if (tn.sat) { g.globalCompositeOperation = 'saturation'; g.fillStyle = '#808080'; g.fillRect(x * T, y * T, T, T); g.globalCompositeOperation = 'source-over'; }
    g.fillStyle = `rgba(0,0,0,${tn.dim})`; g.fillRect(x * T, y * T, T, T);
    if (tn.hatch) { g.save(); g.beginPath(); g.rect(x * T, y * T, T, T); g.clip(); g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2; g.beginPath(); for (let k = -T; k <= T; k += 8) { g.moveTo(x * T + k, y * T + T); g.lineTo(x * T + k + T, y * T); } g.stroke(); g.restore(); }
  });
  // 絨毯（9分割。部屋の内側から inset マス空ける）
  for (const [id, rug] of Object.entries(RUGS)) {
    const r = MAP.rooms.find((q) => q.id === id)!, rx0 = r.rect[0] + rug.inset, ry0 = r.rect[1] + rug.inset, rx1 = r.rect[2] - rug.inset, ry1 = r.rect[3] - rug.inset;
    each((x, y) => { if (x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1 && tiles[y][x] === '.') chip([rug.chip[0] + (x === rx0 ? 0 : x === rx1 ? 2 : 1), rug.chip[1] + (y === ry0 ? 0 : y === ry1 ? 2 : 1)], x, y); });
  }
  // 壁（正面以外）: ガラス・柵・壊れない壁（暗い）・それ以外（白っぽい）
  each((x, y) => {
    if (!wall(x, y) || (front(x, y) && !GLASS.has(key(x, y)))) return;
    if (GLASS.has(key(x, y))) auto(p.glass, x, y);
    else if (FENCE.has(key(x, y))) chip(wall(x, y - 1) || wall(x, y + 1) ? WALL.fencePost : WALL.fenceRail, x, y);
    else auto(perimeter(x, y) ? p.dark : atriumWall(x, y) ? p.atrium : p.ceiling, x, y);
  });
  // 壁の正面（2マス高）: 上を壁のマス、下を部屋側の床のマスに重ねる。列は左端・中・右端・1マスだけ（隣も正面かで選ぶ）
  each((x, y) => {
    if (!front(x, y) || GLASS.has(key(x, y))) return;
    const l = front(x - 1, y), r = front(x + 1, y), fence = FENCE.has(key(x, y));
    const col = l && r ? 1 : r ? 0 : l ? 2 : fence ? 1 : 3; // 柵は「1マスだけ」が無いので中
    const f = fence ? WALL.fenceFace : perimeter(x, y) ? WALL.darkFace : faceOf(roomAt(x, y + 1));
    chip([f[0] + col, f[1]], x, y, 2);
    if (!fence && !perimeter(x, y) && atriumWall(x, y)) auto(p.atrium, x, y);
  });
  // 家具・小物（当たり判定なし）。位置は部屋の内側の左上からのマス、負の数は右端・下端から
  for (const [id, list] of Object.entries(PLACE)) {
    const r = MAP.rooms.find((q) => q.id === id)!, ix0 = r.rect[0] + 1, iy0 = r.rect[1] + 1, ix1 = r.rect[2] - 1, iy1 = r.rect[3] - 1;
    for (const [name, fx, fy, n = 1, sx0 = 0, sy0 = 0] of list) for (let k = 0; k < n; k++) {
      const [sx, sy, w, h] = ITEMS[name], x = fx + sx0 * k, y = fy + sy0 * k;
      const dx = x >= 0 ? (ix0 + x) * T : (ix1 + 2 + x) * T - w, dy = y >= 0 ? (iy0 + y) * T : (iy1 + 2 + y) * T - h;
      if (dx + w > x0 * T && dx < (x1 + 1) * T && dy + h > y0 * T && dy < (y1 + 1) * T) g.drawImage(p.base, sx, sy, w, h, dx, dy, w, h);
    }
  }
  g.restore();
}
