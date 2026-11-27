// あいえるたん: アップグレード（発動時は範囲の円をその場に縁が強く内へ薄れる光で出し、効果を受けたキャラに光の柱。効果中は足元の輪と上へ流れる矢印。技が使える間は本人の画面に範囲と、範囲内の味方の頭上に▼）
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
  // 技が使える間: アップグレードの範囲（体の中心から半径 r の円）を半透明の円で、範囲内の味方（プレイヤー・アシスト。体の中心どうしの距離。自分は除く）の頭上に小さな▼
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
      // 発動した時点の範囲（体の中心から半径 r の円）をその場に出す（広がらない）。縁が一番強く、内側へ薄れる（中心付近はほぼ透明）。効果を受けたキャラ（who）には、体を包む光の柱（足元の輪・上へ流れる矢印の mark とは別）。後半でフェードアウト（ierutan3）
      draw(g, f, _time, k, s, pos) {
        const fade = k < 0.5 ? 1 : Math.max(0, 1 - (k - 0.5) / 0.5), r = f.r ?? S.r, N = 16, step = (r * 0.6) / N; // 縁から内側へ、半径の6割まで薄れる（中心付近は透明）
        for (let i = 0; i < N; i++) { const u = 1 - i / N; g.lineStyle(step + 1, COLOR, 0.4 * u * u * u * fade).strokeCircle(f.x, f.y, r - step * (i + 0.5)); } // 縁から内へ薄れる帯
        g.lineStyle(2, 0xffffff, 0.8 * fade).strokeCircle(f.x, f.y, r); // 縁
        for (const id of f.who ?? []) {
          const q = pos(id);
          if (!q) continue;
          const sc = s.players.find((p: any) => `p:${p.id}` === id)?.assist ? C.ASSIST.scale : 1, bh = 42 * C.DOT_SCALE * 0.85 * sc + 10, cw = 22 * sc * (1 - 0.4 * k); // 体の高さ＋少し（アシストは表示倍率ぶん大きい）。光の柱は時間とともに細くなる
          for (let i = 0; i < 4; i++) { const ww = cw * (1 - i / 4); g.fillStyle(i === 3 ? 0xffffff : COLOR, (0.22 + i * 0.12) * fade).fillRect(q.x - ww / 2, q.y - bh, ww, bh + 4); }
        }
      },
    },
  },
};
export default skill;
