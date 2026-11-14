// あいえるたん: 加速（足元の黄色い輪）
import type { ClientSkill } from './index';

const COLOR = 0xffe060;
const skill: ClientSkill = {
  status: { accel: { mark: (g, { x, y }) => { g.lineStyle(2, COLOR, 0.9).strokeEllipse(x, y, 28, 11); } } },
  colors: { accel: COLOR },
};
export default skill;
