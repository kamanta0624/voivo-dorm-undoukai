// あいえるたん: アップグレード（発動時に広がる二重の長方形と放射状の線、効果中は足元の輪と上へ流れる矢印。技が使える間は本人の画面に範囲と、範囲内の味方の頭上に▼）
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
  // 技が使える間: アップグレードの範囲（体の中心・横 w・縦 h の長方形）を半透明の長方形で、範囲内の味方（プレイヤー・アシスト。体の中心どうしの距離。自分は除く）の頭上に小さな▼
  self(g, { me, s, myTeam, time, pos }) {
    const cx = me.x, cy = me.y - bodyUp();
    g.fillStyle(COLOR, 0.07).fillRect(cx - S.w / 2, cy - S.h / 2, S.w, S.h).lineStyle(1, COLOR, 0.45).strokeRect(cx - S.w / 2, cy - S.h / 2, S.w, S.h);
    const bob = Math.sin(time / 180) * 1.5;
    for (const p of s.players) {
      if (p.id === s.me || p.team !== myTeam || !p.alive) continue;
      const q = pos(p.id) ?? p, sc = p.assist ? C.ASSIST.scale : 1;
      if (Math.abs(q.x - cx) > S.w / 2 || Math.abs(q.y - bodyUp(sc) - cy) > S.h / 2) continue;
      const y = q.y - (42 * C.DOT_SCALE * sc * 0.85 + 14) + bob; // 頭の上（HPバーの上）
      g.fillStyle(COLOR, 0.95).fillTriangle(q.x - 4, y - 4, q.x + 4, y - 4, q.x, y + 2).lineStyle(1, 0x000000, 0.6).strokeTriangle(q.x - 4, y - 4, q.x + 4, y - 4, q.x, y + 2);
    }
  },
  fx: {
    upgrade: {
      ms: 700,
      draw(g, f, _time, k) { // 長方形が中心から広がる（二重の枠と、中心から外へ向かう線）
        const a = Math.min(1, k * 1.6), b = Math.max(0, Math.min(1, k * 1.6 - 0.3)), w = f.w ?? S.w, h = f.h ?? S.h;
        const rect = (u: number) => [f.x - (w / 2) * u, f.y - (h / 2) * u, w * u, h * u] as const;
        g.fillStyle(COLOR, 0.18 * (1 - k)).fillRect(...rect(a));
        g.lineStyle(4, COLOR, 0.9 * (1 - k)).strokeRect(...rect(a)).lineStyle(2, 0xffffff, 0.8 * (1 - k)).strokeRect(...rect(b));
        for (let i = 0; i < 12; i++) { // 放射状の線（長方形の形に合わせて縦横に伸ばす）
          const t = (i / 12) * Math.PI * 2, cx = Math.cos(t) * (w / 2) * a, cy = Math.sin(t) * (h / 2) * a;
          g.lineStyle(2, COLOR, 0.8 * (1 - k)).lineBetween(f.x + cx * 0.55, f.y + cy * 0.55, f.x + cx * 0.85, f.y + cy * 0.85);
        }
      },
    },
  },
};
export default skill;
