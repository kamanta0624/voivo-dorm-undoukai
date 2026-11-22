// あいえるたん: アップグレード（発動時に広がる二重の輪と放射状の線、効果中は足元の輪と上へ流れる矢印。技が使える間は本人の画面に範囲と、範囲内の味方の頭上に▼）
import type { ClientSkill } from './index';
import { CONFIG as C, bodyUp } from '../../shared/config';
import { CHARS } from '../../shared/chars';

const COLOR = 0xffe060, S = CHARS.ierutan.skill;
const skill: ClientSkill = {
  status: {
    upgrade: {
      mark(g, { x, y, time }) {
        g.lineStyle(2, COLOR, 0.9).strokeEllipse(x, y, 28, 11);
        for (let i = 0; i < 2; i++) { // 上へ流れる矢印
          const t = ((time / 500 + i / 2) % 1), yy = y - 4 - t * 22, al = 0.9 * (1 - t);
          g.lineStyle(2, COLOR, al).lineBetween(x - 5, yy + 4, x, yy).lineBetween(x, yy, x + 5, yy + 4);
        }
      },
    },
  },
  colors: { upgrade: COLOR },
  // 技が使える間: アップグレードの範囲（体の中心・半径 r）を半透明の円で、範囲内の味方（プレイヤー・アシスト。体の中心どうしの距離。自分は除く）の頭上に小さな▼
  self(g, { me, s, myTeam, time, pos }) {
    const cx = me.x, cy = me.y - bodyUp();
    g.fillStyle(COLOR, 0.07).fillCircle(cx, cy, S.r).lineStyle(1, COLOR, 0.45).strokeCircle(cx, cy, S.r);
    const bob = Math.sin(time / 180) * 1.5;
    for (const p of s.players) {
      if (p.id === s.me || p.team !== myTeam || !p.alive) continue;
      const q = pos(p.id) ?? p, sc = p.assist ? C.ASSIST.scale : 1;
      if (Math.hypot(q.x - cx, q.y - bodyUp(sc) - cy) > S.r) continue;
      const y = q.y - (42 * C.DOT_SCALE * sc * 0.85 + 14) + bob; // 頭の上（HPバーの上）
      g.fillStyle(COLOR, 0.95).fillTriangle(q.x - 4, y - 4, q.x + 4, y - 4, q.x, y + 2).lineStyle(1, 0x000000, 0.6).strokeTriangle(q.x - 4, y - 4, q.x + 4, y - 4, q.x, y + 2);
    }
  },
  fx: {
    upgrade: {
      ms: 700,
      draw(g, f, _time, k) {
        const r1 = f.r * Math.min(1, k * 1.6), r2 = f.r * Math.max(0, Math.min(1, k * 1.6 - 0.3));
        g.fillStyle(COLOR, 0.18 * (1 - k)).fillCircle(f.x, f.y, r1);
        g.lineStyle(4, COLOR, 0.9 * (1 - k)).strokeCircle(f.x, f.y, r1).lineStyle(2, 0xffffff, 0.8 * (1 - k)).strokeCircle(f.x, f.y, r2);
        for (let i = 0; i < 12; i++) { // 放射状の線
          const a = (i / 12) * Math.PI * 2, u0 = r1 * 0.55, u1 = r1 * 0.85;
          g.lineStyle(2, COLOR, 0.8 * (1 - k)).lineBetween(f.x + Math.cos(a) * u0, f.y + Math.sin(a) * u0, f.x + Math.cos(a) * u1, f.y + Math.sin(a) * u1);
        }
      },
    },
  },
};
export default skill;
