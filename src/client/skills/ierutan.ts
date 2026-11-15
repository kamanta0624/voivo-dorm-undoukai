// あいえるたん: 加速（発動時に広がる二重の輪と放射状の線、効果中は足元の輪と上へ流れる矢印）
import type { ClientSkill } from './index';

const COLOR = 0xffe060;
const skill: ClientSkill = {
  status: {
    accel: {
      mark(g, { x, y, time }) {
        g.lineStyle(2, COLOR, 0.9).strokeEllipse(x, y, 28, 11);
        for (let i = 0; i < 2; i++) { // 上へ流れる矢印
          const t = ((time / 500 + i / 2) % 1), yy = y - 4 - t * 22, al = 0.9 * (1 - t);
          g.lineStyle(2, COLOR, al).lineBetween(x - 5, yy + 4, x, yy).lineBetween(x, yy, x + 5, yy + 4);
        }
      },
    },
  },
  colors: { accel: COLOR },
  fx: {
    accel: {
      ms: 700,
      draw(g, f, _time, k) {
        const r1 = f.r * Math.min(1, k * 1.6), r2 = f.r * Math.max(0, Math.min(1, k * 1.6 - 0.3));
        g.fillStyle(COLOR, 0.18 * (1 - k)).fillCircle(f.x, f.y, r1);
        g.lineStyle(4, COLOR, 0.9 * (1 - k)).strokeCircle(f.x, f.y, r1).lineStyle(2, 0xffffff, 0.8 * (1 - k)).strokeCircle(f.x, f.y, r2);
        for (let i = 0; i < 12; i++) { // 放射状の線
          const a = (i / 12) * Math.PI * 2, u0 = r1 * 0.55, u1 = r1 * 0.85;
          g.lineStyle(2, COLOR, 0.8 * (1 - k)).lineBetween(f.x + Math.cos(a) * u0, f.y + Math.sin(a) * u0, f.x + Math.cos(a) * u1, f.y + Math.sin(a) * u1);
        }
      },
    },
  },
};
export default skill;
