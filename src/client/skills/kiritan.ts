// 東北きりたん: きりたん砲飛行（足元の影と浮いた輪）
import type { ClientSkill } from './index';

const COLOR = 0x9fdcff;
const skill: ClientSkill = {
  status: { fly: { mark: (g, { x: cx, y: cy }) => { g.fillStyle(COLOR, 0.35).fillEllipse(cx, cy + 4, 26, 8).lineStyle(1, COLOR).strokeEllipse(cx, cy - 6, 30, 12); } } },
  colors: { fly: COLOR },
};
export default skill;
