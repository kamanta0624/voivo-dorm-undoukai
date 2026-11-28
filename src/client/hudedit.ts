// HUD の簡易エディタ（hudedit1）: 開発版で URL に ?hudedit=1 を付けた時だけ読み込む（main.ts。本番ビルドには入らない）
// 戦闘中の HUD の要素（client/hud_layout.ts の HUD_TARGETS）を、枠をドラッグで移動、右下のつまみで大きさ（倍率）を変える。マウスでも指でも動く
// 「コピー」: 変えた要素の値だけを文字列にする（Code に貼って「反映して」と言えば hud_layout.ts の HUD_LAYOUT に書き戻す）。色・文言は対象外。元に戻す・保存は無い
import { HUD_LAYOUT, HUD_TARGETS, hudLayoutCss } from './hud_layout';

export function startHudEdit(fx: HTMLElement) {
  const L: typeof HUD_LAYOUT = JSON.parse(JSON.stringify(HUD_LAYOUT)), changed = new Set<string>();
  const style = document.createElement('style'); document.head.append(style);
  const apply = () => { style.textContent = hudLayoutCss(L).replace(/#fx /g, '#fx.hudedit '); }; // 元の値の style より強く効かせる（同じ値を書き戻せば通常画面と同じ位置）
  fx.classList.add('hudedit');
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;font:12px sans-serif';
  ui.innerHTML = '<div class="he-bar" style="position:fixed;left:50%;top:4px;transform:translateX(-50%);display:flex;gap:6px;pointer-events:auto"><button class="he-copy">コピー</button><button class="he-close">閉じる</button></div><textarea class="he-out" readonly style="position:fixed;left:4px;bottom:4px;width:60%;height:4.5em;display:none;pointer-events:auto;font:11px monospace"></textarea>';
  document.body.append(ui);
  const boxes = new Map<string, HTMLElement>();
  for (const k of Object.keys(HUD_TARGETS)) {
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;border:1px dashed #0ff;background:#0ff2;pointer-events:auto;touch-action:none;cursor:move;box-sizing:border-box';
    b.innerHTML = `<span style="position:absolute;left:0;top:-14px;color:#0ff;text-shadow:0 0 2px #000;white-space:nowrap">${k}</span><i style="position:absolute;right:-9px;bottom:-9px;width:18px;height:18px;background:#0ff;border-radius:50%;cursor:nwse-resize;touch-action:none"></i>`;
    ui.append(b); boxes.set(k, b);
    const zoom = () => parseFloat(getComputedStyle(fx).getPropertyValue('--z')) || 1, el = () => fx.querySelector<HTMLElement>(HUD_TARGETS[k]);
    // つかんで動かす（枠）・大きさを変える（右下のつまみ。つかんだ所からの距離の比で倍率）
    b.addEventListener('pointerdown', (e) => {
      const e0 = el(); if (!e0) return;
      e.preventDefault(); b.setPointerCapture(e.pointerId);
      const v = (L[k] ??= {}), x0 = v.x ?? 0, y0 = v.y ?? 0, s0 = v.s ?? 1, px = e.clientX, py = e.clientY, z = zoom(), resize = (e.target as HTMLElement).tagName === 'I';
      const r = b.getBoundingClientRect(), d0 = Math.hypot(px - r.left, py - r.top);
      const move = (m: PointerEvent) => {
        if (resize) v.s = Math.max(0.2, Math.round(((s0 * Math.hypot(m.clientX - r.left, m.clientY - r.top)) / Math.max(1, d0)) * 100) / 100);
        else { v.x = Math.round((x0 + (m.clientX - px) / z) * 10) / 10; v.y = Math.round((y0 + (m.clientY - py) / z) * 10) / 10; }
        changed.add(k); apply();
      };
      const up = () => { b.removeEventListener('pointermove', move); b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up); };
      b.addEventListener('pointermove', move); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    });
  }
  // 枠を要素に重ねる（見えていない要素は隠す）
  let on = true;
  const follow = () => {
    if (!on) return;
    for (const [k, b] of boxes) {
      const e = fx.querySelector<HTMLElement>(HUD_TARGETS[k]), r = e?.getBoundingClientRect();
      if (!r || !r.width || !r.height) { b.style.display = 'none'; continue; }
      Object.assign(b.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    }
    requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  const out = ui.querySelector<HTMLTextAreaElement>('.he-out')!;
  ui.querySelector<HTMLButtonElement>('.he-copy')!.onclick = async () => {
    const text = `HUD_LAYOUT（hud_layout.ts）に反映: ${JSON.stringify(Object.fromEntries([...changed].map((k) => [k, L[k]])))}`;
    out.style.display = 'block'; out.value = text; out.focus(); out.select(); // クリップボードが使えない時（http の LAN など）はここから手でコピー
    try { await navigator.clipboard.writeText(text); out.value = `${text}\n（クリップボードに入れた）`; } catch {}
  };
  ui.querySelector<HTMLButtonElement>('.he-close')!.onclick = () => { on = false; ui.remove(); fx.classList.remove('hudedit'); };
  apply();
}
