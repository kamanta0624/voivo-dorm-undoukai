// 猫使ビィ: 再現江湖（高速移動の残像、爆発の色）
import type { ClientSkill } from './index';
import { CONFIG as C } from '../../shared/config';

const GHOST_PX = 14, FADE_MS = 300; // 残像を出す移動量の間隔・消えるまで
const LAG_MS = C.NET_INTERP_DELAY * 1000 + 150; // スプライトは補間で遅れて動くので、状態を見てからこの時間は動きに合わせて残像を出す
const skill: ClientSkill = {
  status: {
    phantom: {
      mark(_g, { sp, time }) {
        const on = (sp.getData('phantomEnd') ?? 0) > time;
        sp.setData('phantomEnd', time + LAG_MS);
        if (on) return;
        let lx = sp.x, ly = sp.y;
        const tick = () => {
          if (!sp.active || sp.scene.time.now > sp.getData('phantomEnd')) { sp.scene?.events.off('update', tick); return; }
          if (Math.hypot(sp.x - lx, sp.y - ly) < GHOST_PX) return;
          lx = sp.x; ly = sp.y;
          const gh = sp.scene.add.image(sp.x, sp.y, sp.texture.key, sp.frame.name).setOrigin(sp.originX, sp.originY).setScale(sp.scaleX, sp.scaleY).setFlipX(sp.flipX).setDepth(sp.depth - 0.0001).setAlpha(0.55).setTintFill(0x9ad0ff);
          sp.scene.tweens.add({ targets: gh, alpha: 0, duration: FADE_MS, onComplete: () => gh.destroy() });
        };
        sp.scene.events.on('update', tick);
      },
    },
  },
  colors: { boom: 0xff8040 },
};
export default skill;
