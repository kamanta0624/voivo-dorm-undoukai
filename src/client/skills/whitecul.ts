// WhiteCUL: 吹雪（前方の長方形に雪の粒と白い筋が吹き抜ける）
import type { ClientSkill } from './index';

const FLAKES = 26, STREAKS = 7;
const rnd = (seed: number, i: number) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };
const skill: ClientSkill = {
  fx: {
    blizzard: {
      ms: 650,
      draw(g, f, _time, k) {
        const ux = Math.cos(f.a), uy = Math.sin(f.a), h = f.w / 2;
        const at = (u: number, v: number) => ({ x: f.x + ux * u - uy * v, y: f.y + uy * u + ux * v });
        const c = [at(0, -h), at(f.len, -h), at(f.len, h), at(0, h)];
        g.fillStyle(0x9fe8ff, 0.35 * (1 - k)).fillPoints(c as any, true).lineStyle(2, 0xdff8ff, 0.8 * (1 - k)).strokePoints(c as any, true);
        for (let i = 0; i < STREAKS; i++) { // 白い筋（前へ流れる）
          const v = (rnd(f.id, i) - 0.5) * f.w, u = ((rnd(f.id, i + 50) + k * 1.6) % 1) * f.len, p0 = at(u, v), p1 = at(Math.min(f.len, u + 34), v);
          g.lineStyle(2, 0xffffff, 0.7 * (1 - k)).lineBetween(p0.x, p0.y, p1.x, p1.y);
        }
        for (let i = 0; i < FLAKES; i++) { // 雪の粒（根元から先へ、少し揺れながら）
          const v = (rnd(f.id, i + 100) - 0.5) * f.w + Math.sin(k * 9 + i) * 4, u = Math.min(f.len, (rnd(f.id, i + 200) * 0.4 + k) * f.len), p = at(u, v);
          g.fillStyle(0xffffff, 0.95 * (1 - k * 0.7)).fillCircle(p.x, p.y, 1.5 + rnd(f.id, i + 300) * 2);
        }
      },
    },
  },
};
export default skill;
