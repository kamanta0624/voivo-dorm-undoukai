// 猫使ビィ: オーバードライブ（加速中は足元に光の輪、残像（おとり）はビィのドットを水色で半透明に、予約した敵の頭上に爆弾マークと爆発までの残り秒、終了時のポーズは万歳のコマ、爆発の色）
import type Phaser from 'phaser';
import type { ClientSkill } from './index';
import { CONFIG as C } from '../../shared/config';

const MARK_UP = 42 * C.DOT_SCALE * 0.85 + 16; // 予約の印の高さ（足元から、HPバーの上）
const decoys = new Map<number, { im: Phaser.GameObjects.Image; seen: number }>(); // 残像の id → 表示中の画像
const counts = new Map<string, { tx: Phaser.GameObjects.Text; seen: number }>(); // 予約（ビィの進行の id＋対象）→ 残り秒の文字
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
    // 予約の印: 予約した敵の頭上に爆弾マークと爆発までの残り秒（切り上げ）。位置は対象の描画位置（補間）。大将は体の大きさに合わせて上へ
    overload: {
      layer: 'fx',
      draw(g, e, time, _tc, pos) {
        for (const m of e.v ?? []) {
          const q = pos(m.id);
          if (!q) continue;
          const x = q.x, y = q.y - (m.r > C.PLAYER_RADIUS ? m.r * 2.2 : MARK_UP), sec = Math.max(0, Math.ceil(m.left - 1e-6)), hot = m.left < 1;
          g.fillStyle(0x202020).fillCircle(x, y, 7).lineStyle(1, hot ? 0xff3030 : 0x888888).strokeCircle(x, y, 7); // 爆弾
          g.fillStyle(0xffffff, 0.6).fillCircle(x - 2.5, y - 2.5, 1.5); // 光沢
          g.lineStyle(1.5, 0xc0a060).lineBetween(x + 4, y - 5, x + 7, y - 9); // 導火線
          if (Math.floor(time / 80) % 2) g.fillStyle(0xffd040).fillCircle(x + 7.5, y - 9.5, 2).fillStyle(0xff6020).fillCircle(x + 7.5, y - 9.5, 1); // 火花
          const key = `${e.id}:${m.id}`;
          let c = counts.get(key);
          if (!c) counts.set(key, (c = { tx: g.scene.add.text(x, y, '', { fontFamily: 'sans-serif', fontSize: '9px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setOrigin(0.5).setResolution(4).setDepth(21), seen: time }));
          c.seen = time;
          c.tx.setPosition(Math.round(x), Math.round(y)).setText(String(sec)).setColor(hot ? '#ff5050' : '#ffffff');
        }
      },
    },
  },
  // 見えなくなった（消えた・視界の外）残像の画像・予約の数字を消す
  frame(_g, time) {
    for (const [id, d] of decoys) if (time - d.seen > 100) { d.im.destroy(); decoys.delete(id); }
    for (const [k, c] of counts) if (time - c.seen > 100) { c.tx.destroy(); counts.delete(k); } // 不発・相手の撃破・爆発で消えた予約の数字
  },
  colors: { boom: 0xff8040 },
};
export default skill;
