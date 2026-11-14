// 東北ずん子: ずんだ餅（緑の餅に変化。技ボタンは「餅」）
import type { ClientSkill } from './index';

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
};
export default skill;
