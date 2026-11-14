// 満別花丸: 巨大拳（半透明の大きな拳（陣営色）。後ろに流れる線と光）
import Phaser from 'phaser';
import type { ClientSkill } from './index';
import { CHARS } from '../../shared/chars';

const R = CHARS.hanamaru.skill.r;
const skill: ClientSkill = {
  ents: {
    fist: {
      layer: 'fx',
      draw(g, { x, y, a }, time, c) {
        const ux = Math.cos(a), uy = Math.sin(a);
        const at = (u: number, v: number) => new Phaser.Math.Vector2(x + ux * u - uy * v, y + uy * u + ux * v);
        for (let i = 0; i < 5; i++) { const v = (i - 2) * R * 0.35, l = R * (1.6 + ((time / 40 + i * 37) % 10) / 10); const p0 = at(-R * 0.6, v), p1 = at(-R * 0.6 - l, v); g.lineStyle(3, c, 0.35).lineBetween(p0.x, p0.y, p1.x, p1.y); } // 流れる線
        g.fillStyle(c, 0.18).fillCircle(x, y, R * 1.35); // 光
        const palm = [at(-R * 0.7, -R * 0.75), at(R * 0.35, -R * 0.8), at(R * 0.35, R * 0.8), at(-R * 0.7, R * 0.75)];
        g.fillStyle(c, 0.55).fillPoints(palm, true).lineStyle(2, 0xffffff, 0.6).strokePoints(palm, true);
        for (let i = 0; i < 4; i++) { const k = at(R * 0.5, (i - 1.5) * R * 0.42); g.fillStyle(c, 0.65).fillCircle(k.x, k.y, R * 0.24).lineStyle(1.5, 0xffffff, 0.6).strokeCircle(k.x, k.y, R * 0.24); } // 指の関節
        const th = [at(-R * 0.1, -R * 0.8), at(R * 0.35, -R * 0.95), at(R * 0.2, -R * 0.55)]; // 親指
        g.fillStyle(c, 0.65).fillTriangle(th[0].x, th[0].y, th[1].x, th[1].y, th[2].x, th[2].y);
      },
    },
  },
};
export default skill;
