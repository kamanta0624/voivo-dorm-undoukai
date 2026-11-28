// HUD の配置の調整（hudedit1）: 戦闘中の HUD の要素ごとに、元の位置（main.ts の CSS）からのずらし x・y（論理 px。画面の拡大 --z が掛かる）と大きさの倍率 s
// 開発版の ?hudedit=1（client/hudedit.ts）で動かし、「コピー」で出た文字列を Code に貼ると、ここに書き戻す。値が無い要素は元の CSS のまま（何も足さない）
export const HUD_LAYOUT: Record<string, { x?: number; y?: number; s?: number }> = {};

// 動かせる要素（名前 → #fx の中のセレクタ）。.me・.buffs（一覧の下から JS で置く）とミニマップ（Phaser が描く）は対象外
export const HUD_TARGETS: Record<string, string> = {
  bar0: '.bar.b0', bar1: '.bar.b1', timer: '.timer', tk: '.tk', roster0: '.roster.r0', roster1: '.roster.r1', kills: '.kills', notes: '.notes', fever: '.fever', banner: '.banner', aband: '.aband', cmsub: '.cmsub',
  skill: '.skill', recall: '.tb.rc', aim: '.tb.aimb', down: '.down', killer: '.killer', kohow: '.kohow',
};

// 値 → CSS（translate・scale は transform と別の指定なので、元の transform・アニメーションと重なる）
export function hudLayoutCss(L: typeof HUD_LAYOUT) {
  return Object.entries(L).filter(([k]) => HUD_TARGETS[k]).map(([k, v]) => {
    const x = v.x ?? 0, y = v.y ?? 0, s = v.s ?? 1;
    return `#fx ${HUD_TARGETS[k]}{${x || y ? `translate:calc(var(--z) * ${x}px) calc(var(--z) * ${y}px);` : ''}${s !== 1 ? `scale:${s};` : ''}}`;
  }).join('\n');
}
