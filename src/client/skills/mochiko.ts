// もち子: ファンネル（陣営色の三角。発動時に放射状に展開）
import type { ClientSkill } from './index';

const skill: ClientSkill = {
  ents: {
    funnel: {
      layer: 'fx',
      draw(g, f, _time, tc) {
        const r = f.r;
        g.fillStyle(tc).fillTriangle(f.x, f.y - r - 2, f.x - r, f.y + r, f.x + r, f.y + r).lineStyle(1, 0xffffff).strokeTriangle(f.x, f.y - r - 2, f.x - r, f.y + r, f.x + r, f.y + r);
      },
    },
  },
  colors: { funnel: 0xff9ad5 },
  fx: {
    // 発動: 6機がもち子から放射状に飛び出す（光の輪・6本の軌跡・広がる三角）
    funnel: {
      ms: 600,
      draw(g, f, _time, k) {
        const R = 10 + 46 * Math.min(1, k * 1.8);
        g.lineStyle(3, 0xff9ad5, 0.9 * (1 - k)).strokeCircle(f.x, f.y, R).fillStyle(0xff9ad5, 0.15 * (1 - k)).fillCircle(f.x, f.y, R);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2, x = f.x + Math.cos(a) * R, y = f.y + Math.sin(a) * R, s = 6;
          g.lineStyle(2, 0xffffff, 0.8 * (1 - k)).lineBetween(f.x + Math.cos(a) * 8, f.y + Math.sin(a) * 8, x, y);
          g.fillStyle(0xff9ad5, 1 - k).fillTriangle(x + Math.cos(a) * s, y + Math.sin(a) * s, x + Math.cos(a + 2.4) * s, y + Math.sin(a + 2.4) * s, x + Math.cos(a - 2.4) * s, y + Math.sin(a - 2.4) * s);
        }
      },
    },
  },
};
export default skill;
