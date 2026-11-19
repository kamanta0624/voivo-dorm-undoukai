// ユーレイちゃん: ジャッジメント（先頭の光弾と、螺旋を描きながら後ろに続く光弾）
import type { ClientSkill } from './index';
import { CHARS } from '../../shared/chars';

const S = CHARS.yurei.skill, COLOR = 0xff5a7a, CORE = 0xfff0f4;
const skill: ClientSkill = {
  ents: {
    enma: {
      layer: 'fx',
      draw(g, e, time) {
        const ux = Math.cos(e.a), uy = Math.sin(e.a), y0 = e.y - 10;
        for (let i = S.orbs - 1; i >= 0; i--) { // 進む向きに沿って後ろへ並べ、横に螺旋（半径 spiralR、1周 spiralLen）
          const back = i * (S.spiralLen / S.orbs), ph = time / 60 - (back / S.spiralLen) * Math.PI * 2, side = Math.sin(ph) * (i ? S.spiralR : 0);
          const x = e.x - ux * back - uy * side, y = y0 - uy * back + ux * side, r = i ? S.r * 0.6 : S.r;
          g.fillStyle(COLOR, 0.35).fillCircle(x, y, r * 1.6);
          g.fillStyle(COLOR, 0.9).fillCircle(x, y, r);
          g.fillStyle(CORE).fillCircle(x, y, r * 0.5);
        }
      },
    },
  },
};
export default skill;
