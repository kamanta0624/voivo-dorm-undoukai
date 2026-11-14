// 東北きりたん: 全弾斉射（ロックした敵のマーカー、ホーミング弾）
import type { ClientSkill } from './index';

const skill: ClientSkill = {
  status: {
    lockon: {
      // ロック中: 自分の周りの点線の輪と、ロックした敵に回る照準
      fx(g, { x, y, time, v }) {
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + time / 600; g.lineStyle(2, 0xff3030, 0.8).beginPath().arc(x, y - 14, 20, a, a + 0.25).strokePath(); }
        for (const m of v.marks) {
          const r = 12, a = time / 200;
          g.lineStyle(2, 0xff3030, 0.95).strokeCircle(m.x, m.y - 10, r);
          for (let i = 0; i < 4; i++) { const b = a + (i * Math.PI) / 2; g.lineBetween(m.x + Math.cos(b) * (r - 5), m.y - 10 + Math.sin(b) * (r - 5), m.x + Math.cos(b) * (r + 5), m.y - 10 + Math.sin(b) * (r + 5)); }
        }
      },
    },
  },
  ents: {
    // ホーミング弾: 尾を引く小さな弾
    missile: {
      layer: 'fx',
      draw(g, e) {
        const ux = Math.cos(e.a), uy = Math.sin(e.a);
        g.lineStyle(2, 0xffd0a0, 0.6).lineBetween(e.x - ux * 14, e.y - uy * 14, e.x, e.y);
        g.fillStyle(0xc87a3a).fillCircle(e.x, e.y, e.r).lineStyle(1, 0x5a3010).strokeCircle(e.x, e.y, e.r);
      },
    },
  },
};
export default skill;
