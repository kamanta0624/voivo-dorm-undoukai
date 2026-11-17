// 東北イタコ: 狐火（ヒトダマ風の火の玉。キツネの絵の代わりの仮置き）。通常攻撃（キツネ）も同じ火の玉が前方へ飛び出す
import type Phaser from 'phaser';
import type { ClientSkill } from './index';
import { CONFIG as C } from '../../shared/config';

const CORE = 0xe8f6ff, FLAME = 0x7fc8ff, GLOW = 0x4a7dff;
// ヒトダマ: 丸い芯と、進む向きと逆へ揺れながら伸びる炎の尾。a: 尾の向き（尾は a の方向へ伸びる）
function hitodama(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, a: number, time: number, al = 1) {
  const w = Math.sin(time / 90 + x * 0.05) * 0.35;
  for (let i = 4; i >= 1; i--) { // 尾: 先ほど細く薄い
    const d = (i / 4) * r * 2.2, b = a + w * (i / 4);
    g.fillStyle(FLAME, 0.22 * al * (1 - i / 5)).fillCircle(x + Math.cos(b) * d, y + Math.sin(b) * d, r * (1 - i / 6));
  }
  g.fillStyle(GLOW, 0.25 * al).fillCircle(x, y, r * 1.5);
  g.fillStyle(FLAME, 0.85 * al).fillCircle(x, y, r);
  g.fillStyle(CORE, al).fillCircle(x - r * 0.2, y - r * 0.2, r * 0.55);
}

const skill: ClientSkill = {
  ents: {
    foxfire: {
      layer: 'fx',
      // 回っている間は尾を上へ、ホーミング中は進む向きと逆へ
      draw(g, e, time) { hitodama(g, e.x, e.y - 10, e.r, e.a ? e.a + Math.PI : -Math.PI / 2, time); },
    },
  },
  fx: {
    // 通常攻撃: 火の玉が前方の射程まで飛び出して消える
    kitsune: {
      ms: C.SLASH_MS * 1.5,
      draw(g, f, time, k) {
        const d = f.r * Math.min(1, k * 1.6);
        hitodama(g, f.x + Math.cos(f.a) * d, f.y - 8 + Math.sin(f.a) * d, 6, f.a + Math.PI, time, 1 - k * 0.8);
      },
    },
  },
};
export default skill;
