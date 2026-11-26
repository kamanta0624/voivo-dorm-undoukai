// 戦闘画面の文字の大きさ（handoff_font1）: 文字サイズに UI_FONT_SCALE を掛け、論理サイズで UI_FONT_MIN 未満なら引き上げる
import { CONFIG as C } from '../shared/config';

export const uf = (px: number) => +Math.max(px * C.UI_FONT_SCALE, C.UI_FONT_MIN).toFixed(2);
// CSS の font・font-size の値の大きさに uf を掛ける（vh は倍率だけ）。max(Npx, …) の先頭（タッチ用の物理 px の下限）はそのまま。
// scope: 対象のルールか（セレクタで判定）。CSS を作る所で1回だけ通す
export function ufCss(css: string, scope: (sel: string) => boolean = () => true) {
  const size = (v: string) => v.replace(/(max\(\s*)?(\d+(?:\.\d+)?)(px|vh)/g, (m, mx, n, u) => (mx ? m : u === 'vh' ? `${+(Number(n) * C.UI_FONT_SCALE).toFixed(2)}vh` : `${uf(Number(n))}px`));
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (all, sel: string, body: string) => (scope(sel) ? `${sel}{${body.replace(/(font(?:-size)?\s*:)([^;]*)/g, (_, k, v) => k + size(v))}}` : all));
}
