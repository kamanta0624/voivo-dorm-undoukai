// 小夜: 疾風乱舞（攻撃範囲の円。周期ダメージごとに円内へ斬線（閃光→残光）、当たった敵に斬撃の印）
import type { ClientSkill } from './index';
import { CONFIG as C, bodyUp } from '../../shared/config';
import { CHARS } from '../../shared/chars';

const S = CHARS.sayo.skill, COLOR = 0xff7fbf, LINES = 5;
const rnd = (seed: number, i: number) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); }; // fx ごとに決まった乱数
const skill: ClientSkill = {
  status: { dance: { mark: (g, { x, y }) => { g.lineStyle(1, COLOR, 0.5).strokeCircle(x, y - bodyUp(), S.r); } } }, // 範囲は体の中心（サーバーの判定と同じ）
  fx: {
    dance: {
      ms: 500,
      draw(g, f, _time, k, s) {
        g.lineStyle(3, COLOR, 0.8 * (1 - k)).strokeCircle(f.x, f.y, f.r);
        for (let i = 0; i < LINES; i++) { // 斬線: 円を横切る弦。始めは白く太い閃光、だんだん細い桃色の残光
          const a = rnd(f.id, i) * Math.PI, off = (rnd(f.id, i + 9) - 0.5) * f.r, l = Math.sqrt(Math.max(0, f.r * f.r - off * off)) * Math.min(1, k * 4);
          const cx = f.x - Math.sin(a) * off, cy = f.y + Math.cos(a) * off, dx = Math.cos(a) * l, dy = Math.sin(a) * l;
          if (k < 0.25) g.lineStyle(5, 0xffffff, 1).lineBetween(cx - dx, cy - dy, cx + dx, cy + dy);
          else g.lineStyle(2.5 * (1 - k) + 0.5, COLOR, 0.9 * (1 - k)).lineBetween(cx - dx, cy - dy, cx + dx, cy + dy);
        }
        // 当たった敵（周期ダメージの瞬間に円の中にいた敵）に斬撃の印
        f.hits ??= s.players.filter((p: any) => p.team !== f.team && p.alive && Math.hypot(p.x - f.x, p.y - f.y) <= f.r + C.PLAYER_RADIUS).map((p: any) => p.id);
        for (const id of f.hits) {
          const p = s.players.find((q: any) => q.id === id);
          if (!p) continue;
          const r = 10 + k * 6, y = p.y - 14;
          g.lineStyle(3, 0xffffff, 1 - k).lineBetween(p.x - r, y - r, p.x + r, y + r).lineBetween(p.x - r, y + r, p.x + r, y - r);
          g.lineStyle(1.5, COLOR, 1 - k).strokeCircle(p.x, y, r * 0.8);
        }
      },
    },
  },
};
export default skill;
