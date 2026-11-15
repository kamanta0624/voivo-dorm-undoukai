// 東北ずん子: ずんだアロー（光る大きな矢と緑の光の粒の尾。当たった敵はずんだ餅の姿、技ボタンに「餅」）
import type { ClientSkill } from './index';

const TRAIL_MS = 350; // 尾の粒が消えるまで
let trail: { x: number; y: number; t0: number }[] = [];
const skill: ClientSkill = {
  status: {
    mochi: {
      mark(g, { x: cx, y: cy, sp }) {
        sp.setVisible(false);
        g.fillStyle(0x4f9f2f).fillEllipse(cx, cy - 5, 24, 17).fillStyle(0x8fdf5f).fillEllipse(cx, cy - 6, 20, 13).fillStyle(0xd8f5b0).fillEllipse(cx - 4, cy - 9, 7, 4);
      },
      hud: '餅',
    },
  },
  shots: {
    arrow(g, sh, time) {
      const l = Math.hypot(sh.vx, sh.vy) || 1, ux = sh.vx / l, uy = sh.vy / l, nx = -uy, ny = ux;
      trail.push({ x: sh.x - ux * 18 + (Math.random() - 0.5) * 6, y: sh.y - uy * 18 + (Math.random() - 0.5) * 6, t0: time });
      g.fillStyle(0x8fdf5f, 0.35).fillCircle(sh.x, sh.y, 9); // 光
      g.lineStyle(4, 0x2f8f1f).lineBetween(sh.x - ux * 24, sh.y - uy * 24, sh.x, sh.y); // 矢柄
      g.fillStyle(0xd8f5b0).fillTriangle(sh.x + ux * 8, sh.y + uy * 8, sh.x + nx * 5, sh.y + ny * 5, sh.x - nx * 5, sh.y - ny * 5); // 矢じり
      const bx = sh.x - ux * 22, by = sh.y - uy * 22; // 矢羽
      g.fillStyle(0x4fbf2f).fillTriangle(bx, by, bx - ux * 6 + nx * 5, by - uy * 6 + ny * 5, bx - ux * 6 - nx * 5, by - uy * 6 - ny * 5);
    },
  },
  frame(g, time) {
    trail = trail.filter((m) => time - m.t0 < TRAIL_MS);
    for (const m of trail) { const k = (time - m.t0) / TRAIL_MS; g.fillStyle(0xb8f08a, 0.8 * (1 - k)).fillCircle(m.x, m.y, 3 * (1 - k) + 1); }
  },
};
export default skill;
