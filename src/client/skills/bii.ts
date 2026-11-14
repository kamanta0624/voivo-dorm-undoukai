// 猫使ビィ: 罠（床に置かれたトゲ（陣営色の縁取り）、向きの扇形（射程）をうっすら、耐久バー）
import Phaser from 'phaser';
import type { ClientSkill } from './index';
import { CHARS } from '../../shared/chars';

const B = CHARS.bii.skill, COLOR = 0xc8a0ff;
const skill: ClientSkill = {
  ents: {
    trap: {
      layer: 'ground',
      draw(g, t, _time, tc) {
        g.fillStyle(COLOR, 0.08).slice(t.x, t.y, B.range, t.a - B.arc / 2, t.a + B.arc / 2).fillPath();
        const pts: Phaser.Math.Vector2[] = [], r = B.r * 0.8;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2, d = i % 2 ? r * 0.45 : r;
          pts.push(new Phaser.Math.Vector2(t.x + Math.cos(a) * d, t.y + Math.sin(a) * d));
        }
        g.fillStyle(0x8c8c96, 1).fillPoints(pts, true).lineStyle(1.5, tc, 1).strokePoints(pts, true);
        g.fillStyle(0x000000, 0.6).fillRect(t.x - 10, t.y - 18, 20, 3).fillStyle(0xffffff).fillRect(t.x - 10, t.y - 18, 20 * Math.max(0, t.hp / B.hp), 3);
      },
    },
  },
  colors: { trap: COLOR },
};
export default skill;
