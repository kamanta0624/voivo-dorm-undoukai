// 猫使ビィ: オーバードライブ（加速中は足元に光の輪、残像（おとり）はビィのドットを水色で半透明に、予約した敵の頭上に印、終了時のポーズは万歳のコマ、爆発の色）
import type Phaser from 'phaser';
import type { ClientSkill } from './index';
import { CONFIG as C } from '../../shared/config';

const MARK_UP = 42 * C.DOT_SCALE * 0.85 + 16; // 予約の印の高さ（足元から、HPバーの上）
const decoys = new Map<number, { im: Phaser.GameObjects.Image; seen: number }>(); // 残像の id → 表示中の画像
const skill: ClientSkill = {
  status: {
    overload: {
      mark(g, { x, y, time }) {
        const k = 0.5 + 0.5 * Math.sin(time / 60);
        g.lineStyle(2, 0x9ad0ff, 0.6 + 0.4 * k).strokeEllipse(x, y, 26 + 4 * k, 10 + 2 * k);
      },
    },
    overloadPose: { frame: 'banzai' },
  },
  ents: {
    // 残像: 置いた位置にビィのドット（向きは置いたときの向き）。消えたら frame で片付ける
    biiDecoy: {
      layer: 'ground',
      draw(g, e, time) {
        let d = decoys.get(e.id);
        if (!d) {
          const im = g.scene.add.image(e.x, e.y, 'bii_walk1').setOrigin(0.5, 0.85).setScale(C.DOT_SCALE).setFlipX(Math.cos(e.a) > 0.01).setAlpha(0.55).setTintFill(0x9ad0ff).setDepth(10 + e.y / 10000 - 0.0001);
          decoys.set(e.id, (d = { im, seen: time }));
        }
        d.seen = time;
        d.im.setPosition(Math.round(e.x), Math.round(e.y));
      },
    },
    // 予約の印: 予約した敵の頭上に赤い照準（大将は体の大きさに合わせて上へ）。位置は対象の描画位置（補間）
    overload: {
      layer: 'fx',
      draw(g, e, time, _tc, pos) {
        for (const m of e.v ?? []) {
          const q = pos(m.id);
          if (!q) continue;
          const x = q.x, y = q.y - (m.r > C.PLAYER_RADIUS ? m.r * 2.2 : MARK_UP), r = 6 + Math.sin(time / 90);
          g.lineStyle(2, 0xff3030, 0.95).strokeCircle(x, y, r).lineBetween(x - r - 3, y, x + r + 3, y).lineBetween(x, y - r - 3, x, y + r + 3);
        }
      },
    },
  },
  // 見えなくなった（消えた・視界の外）残像の画像を消す
  frame(_g, time) {
    for (const [id, d] of decoys) if (time - d.seen > 100) { d.im.destroy(); decoys.delete(id); }
  },
  colors: { boom: 0xff8040 },
};
export default skill;
