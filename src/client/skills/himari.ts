// 冥鳴ひまり: 死神の鎌（透明化中は目だけ、跳ぶ間は歩きなし、鎌の色）
import type { ClientSkill } from './index';

const skill: ClientSkill = {
  status: {
    cloak: { frame: 'eyes', bare: true },
    leap: { frame: 'idle' },
  },
  colors: { scythe: 0x9a4dff },
  frames: ['eyes'],
};
export default skill;
