// 四国めたん: ドリル（前方に回転するドリル。螺旋の縞が先端へ流れ、先端に火花）
import Phaser from 'phaser';
import type { ClientSkill } from './index';
import { CHARS } from '../../shared/chars';

const S = CHARS.metan.skill;
const BASE = 8, STRIPES = 6, SPIN_MS = 260; // 根元の自キャラからの距離、縞の本数、縞が1本ぶん流れる時間
const skill: ClientSkill = {
  status: {
    drill: {
      fx(g, { x, y, time, v }) {
        const ux = Math.cos(v.a), uy = Math.sin(v.a), h = S.w / 2;
        const at = (u: number, s: number) => new Phaser.Math.Vector2(x + ux * u - uy * s, y - 8 + uy * u + ux * s); // u: 根元→先端、s: 横（先端へ細くなる）
        const half = (u: number) => h * (1 - (u - BASE) / (S.len - BASE));
        g.fillStyle(0xb8b8c8, 0.95).fillPoints([at(BASE, -h), at(S.len, 0), at(BASE, h)], true);
        g.fillStyle(0x80808f, 0.95).fillPoints([at(BASE, 0), at(S.len, 0), at(BASE, h)], true); // 影の側
        const ph = (time % SPIN_MS) / SPIN_MS;
        for (let i = 0; i < STRIPES; i++) { // 螺旋の縞（斜めの線が先端へ流れる）
          const u = BASE + ((i + ph) / STRIPES) * (S.len - BASE), w = half(u), d = 6 * (w / h);
          g.lineStyle(3, 0xff5fa8, 0.9).lineBetween(at(u - d, -w).x, at(u - d, -w).y, at(u + d, w).x, at(u + d, w).y);
        }
        g.lineStyle(1.5, 0x404050, 1).strokePoints([at(BASE, -h), at(S.len, 0), at(BASE, h)], true);
        g.fillStyle(0x6a3a8a, 1).fillRect(at(BASE - 3, 0).x - 4, at(BASE - 3, 0).y - 4, 8, 8); // 握り
        for (let i = 0; i < 4; i++) { // 先端の火花
          const a = v.a + (Math.random() - 0.5) * 2.2, l = 6 + Math.random() * 10, tip = at(S.len, 0);
          g.lineStyle(2, i % 2 ? 0xffe14a : 0xffffff, 0.9).lineBetween(tip.x, tip.y, tip.x + Math.cos(a) * l, tip.y + Math.sin(a) * l);
        }
      },
    },
  },
};
export default skill;
