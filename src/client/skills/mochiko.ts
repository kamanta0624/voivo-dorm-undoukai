// もち子: ファンネル（陣営色の三角）
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
};
export default skill;
