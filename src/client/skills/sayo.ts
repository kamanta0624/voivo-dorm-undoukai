// 小夜: 疾風乱舞（攻撃範囲の円）
import type { ClientSkill } from './index';
import { CHARS } from '../../shared/chars';

const S = CHARS.sayo.skill;
const skill: ClientSkill = {
  status: { dance: { mark: (g, { x, y }) => { g.lineStyle(1, 0xff7fbf, 0.5).strokeCircle(x, y, S.r); } } }, // 色は ring のエフェクトと同じ
};
export default skill;
