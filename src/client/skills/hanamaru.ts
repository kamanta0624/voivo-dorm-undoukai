// 満別花丸: 花丸パンチ（タメ中は頭上にゲージとレベルの玉。拳は半透明の大きな拳（陣営色）で、大きさはタメのレベル（サーバーの r）。後ろに流れる線と光）
import Phaser from 'phaser';
import type { ClientSkill } from './index';
import { CHARS } from '../../shared/chars';
import { CONFIG as C } from '../../shared/config';

const H: any = CHARS.hanamaru.skill, LV = H.lv as { t: number }[];
const LV_COLOR = [0xffffff, 0xffe14a, 0xff6a00]; // レベル1〜3のゲージの色
const GAUGE = { w: 26, h: 4, up: 42 * C.DOT_SCALE * 0.85 + 12 }; // ゲージの幅・高さ、足元からの高さ（HPバーの上）
const skill: ClientSkill = {
  status: {
    // タメ中: 頭上に次のレベルまでのゲージと、到達したレベルの玉（最後のレベルは点滅）
    fistCharge: {
      hud: 'タメ',
      fx(g, { x, y, time, v }) {
        const t = v.t ?? 0, lv = LV.reduce((k, l, i) => (t >= l.t ? i : k), 0), next = LV[lv + 1];
        const k = next ? (t - LV[lv].t) / (next.t - LV[lv].t) : 1, gx = x - GAUGE.w / 2, gy = y - GAUGE.up;
        g.fillStyle(0x000000, 0.65).fillRect(gx - 1, gy - 1, GAUGE.w + 2, GAUGE.h + 2);
        const max = !next && Math.floor(time / 120) % 2 === 0;
        g.fillStyle(max ? 0xffffff : LV_COLOR[lv], 1).fillRect(gx, gy, GAUGE.w * Math.min(1, k), GAUGE.h);
        for (let i = 0; i < LV.length; i++) g.fillStyle(i <= lv ? LV_COLOR[i] : 0x333333, 1).fillCircle(gx + 4 + i * 9, gy - 5, 3).lineStyle(1, 0x000000, 0.8).strokeCircle(gx + 4 + i * 9, gy - 5, 3);
      },
    },
  },
  ents: {
    fist: {
      layer: 'fx',
      draw(g, { x, y, a, r: R }, time, c) {
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
