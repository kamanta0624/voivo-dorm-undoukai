// 猫使アル: 突撃。タメ中（charge）は白く点滅し、予測進路の警告（敵からも視界内なら見える）。突撃中（rush）は渦と煙
import Phaser from 'phaser';
import type { ClientSkill } from './index';
import { CHARS } from '../../shared/chars';
import { inDashShape } from '../../shared/geom';

const AR: any = CHARS.aru.skill, AF = AR.fx;
let smoke: { x: number; y: number; t0: number }[] = []; // 煙の粒
const frame = (x: number, y: number, a: number) => {
  const ux = Math.cos(a), uy = Math.sin(a);
  return { ux, uy, at: (u: number, v: number) => new Phaser.Math.Vector2(x + ux * u - uy * v, y + uy * u + ux * v) };
};

const skill: ClientSkill = {
  status: {
    charge: {
      mark: (_g, { sp, time }) => { if (Math.floor(time / AF.blinkMs) % 2) sp.setTintFill(0xffffff); },
      fx(g, { x, y, time, v }) {
        const { at } = frame(x, y, v.a), h = AR.w / 2;
        const band = [at(0, -h), at(v.len, -h), at(v.len, h), at(0, h)];
        g.fillStyle(0xff2020, 0.18 + 0.14 * (Math.floor(time / AF.warnBlinkMs) % 2)).fillPoints(band, true).lineStyle(2, 0x8b0000, 0.95).strokePoints(band, true);
        for (let i = 0; i < AF.arrows; i++) { const u = (v.len * (i + 0.5)) / AF.arrows, tri = [at(u + 10, 0), at(u - 6, -9), at(u - 6, 9)]; g.fillStyle(0xffffff, 0.9).fillTriangle(tri[0].x, tri[0].y, tri[1].x, tri[1].y, tri[2].x, tri[2].y); }
      },
    },
    rush: {
      // 渦: 頭の中心付近から尾へ、半径が広がりながら回り込む7本の筋。雫の形の外は描かない
      fx(g, { x, y, time, v }) {
        const a = v.a, { ux, uy, at } = frame(x, y, a);
        const spin = (time / 1000) * AR.spin;
        for (let i = 0; i < AF.strands; i++) {
          const [col, wd, al] = AF.lines[i % 2];
          g.lineStyle(wd, col, al);
          let prev: Phaser.Math.Vector2 | null = null;
          for (let k = 0; k <= 40; k++) {
            const t = k / 40, th = spin + (i * Math.PI * 2) / AF.strands + t * AF.turn, rr = AF.r0 + t * (AF.r1 - AF.r0), back = t * AF.back;
            const q = at(AR.head - back + Math.cos(th) * rr, Math.sin(th) * rr);
            const inside = inDashShape(AR, q.x, q.y, x, y, a);
            if (inside && prev) g.lineBetween(prev.x, prev.y, q.x, q.y);
            prev = inside ? q : null;
          }
        }
        smoke.push({ x: x - ux * 12 + (Math.random() - 0.5) * 10, y: y - uy * 12 + 2 + (Math.random() - 0.5) * 6, t0: time });
      },
    },
  },
  frame(g, time) {
    smoke = smoke.filter((m) => time - m.t0 < AR.smoke * 1000);
    for (const m of smoke) { const k = (time - m.t0) / (AR.smoke * 1000); g.fillStyle(0x9a9a9a, 0.5 * (1 - k)).fillCircle(m.x, m.y, 3 + k * 9); }
  },
};
export default skill;
