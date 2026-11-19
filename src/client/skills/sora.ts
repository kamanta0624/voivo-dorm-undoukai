// 九州そら: ソーラーキャノン（照射中は向いている方向へ光の帯。チャージ glow[0] 秒で小さな光が1つ回り、glow[1] 秒以降は光がたくさんちらつく。爆発の色）
import type { ClientSkill } from './index';
import { CHARS } from '../../shared/chars';
import { CONFIG as C } from '../../shared/config';

const S: any = CHARS.sora.skill;
const BODY = 42 * C.DOT_SCALE * 0.85; // 体の高さ（足元から頭まで）
const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const skill: ClientSkill = {
  status: {
    // 照射: 外側の光・芯の白い帯・先端の光。v.k（チャージの割合）で太く
    solar: {
      fx(g, { x, y, time, v }) {
        const ux = Math.cos(v.a), uy = Math.sin(v.a), cy = y - BODY / 2, ex = x + ux * v.len, ey = cy + uy * v.len;
        const w = v.w * (1 + v.k), f = 0.85 + 0.15 * Math.sin(time / 30);
        g.lineStyle(w * 2.2, 0xffb020, 0.25 * f).lineBetween(x, cy, ex, ey);
        g.lineStyle(w, 0xffe066, 0.7 * f).lineBetween(x, cy, ex, ey);
        g.lineStyle(w * 0.4, 0xffffff, 0.95).lineBetween(x, cy, ex, ey);
        g.fillStyle(0xffffff, 0.9).fillCircle(x + ux * 10, cy + uy * 10, w * 0.7).fillStyle(0xffe066, 0.6).fillCircle(ex, ey, w * (0.9 + 0.3 * Math.sin(time / 40)));
      },
    },
    // チャージの光
    solarCharge: {
      fx(g, { x, y, time, v }) {
        const c = Number(v) || 0;
        if (c < S.glow[0]) return;
        const cy = y - BODY * 0.6;
        if (c < S.glow[1]) { // 小さな光が1つ、体のまわりを回る
          const a = time / 500, px = x + Math.cos(a) * 13, py = cy + Math.sin(a) * 6;
          g.fillStyle(0xffe066, 0.35).fillCircle(px, py, 4).fillStyle(0xffffff, 0.95).fillCircle(px, py, 1.6);
          return;
        }
        const n = 14, slot = Math.floor(time / 90); // たくさんの光がちらつく（90ms ごとに場所と明るさが変わる）
        for (let i = 0; i < n; i++) {
          if (rnd(i, slot) < 0.35) continue;
          const px = x + (rnd(i + 30, slot) - 0.5) * 34, py = cy + (rnd(i + 60, slot) - 0.5) * BODY * 1.1, s = 1 + rnd(i + 90, slot) * 2.2;
          g.fillStyle(0xffe066, 0.4).fillCircle(px, py, s * 2).fillStyle(0xffffff, 0.95).fillCircle(px, py, s * 0.7);
        }
      },
    },
  },
  colors: { solar: 0xffc030 },
};
export default skill;
