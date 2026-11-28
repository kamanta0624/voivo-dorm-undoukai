// perfgate（verify/perfgate.ts）がページに注入する計測。window.__pg に場面ごとの集計を積む。計測の時だけ有効（P.on）
// 数えるもの: 要素ごとの DOM の書き換え（transform だけの書き換えは別に数える）・書き換えたフレームの数、強制レイアウト（書いた後の読み取り）、WebGL の drawcall・テクスチャの転送量、書いた所・読んだ所（関数名）
// 4つの定義（handoff_perfgate1）用: same＝同じ値の書き込み、forcedBy＝強制レイアウト、inst＝要素1つずつのレイアウトを起こす書き込みの回数（文字・クラス・innerHTML・transform と opacity 以外の style。子の追加・削除は除く）、elFrameA＝属性・文字が変わったフレームの数（子の追加・削除は除く。動きの判定）、anims＝transform・opacity 以外を動かす CSS アニメーション
(() => {
  const P = (window.__pg = { on: false, frame: 0, dirty: false });
  const fresh = () => ({ frames: 0, frameMs: 0, mut: 0, mutTf: 0, el: {}, elFrame: {}, elLast: {}, elFrameA: {}, elLastA: {}, inst: {}, forced: 0, forcedFrames: 0, forcedLast: -1, forcedBy: {}, wr: {}, same: {}, anims: {}, draw: 0, texBytes: 0 });
  P.cur = fresh();
  const desc = (n) => { if (n && n.nodeType !== 1) n = n.parentElement; if (!n) return '?'; const id = n.id ? '#' + n.id : ''; const cl = typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; const pa = n.parentElement; const pd = pa ? (pa.id ? '#' + pa.id : typeof pa.className === 'string' && pa.className.trim() ? '.' + pa.className.trim().split(/\s+/)[0] : pa.tagName.toLowerCase()) : ''; return `${pd}>${n.tagName.toLowerCase()}${id}${cl}`; };
  const caller = () => { for (const l of (new Error().stack || '').split('\n')) { if (!l || /^Error/.test(l) || /\b(caller|mark|__pg[A-Za-z]*)\b/.test(l)) continue; const m = l.match(/at (?:async )?(?:Object\.)?([\w$.<>]+) \(/) || l.match(/^([\w$.<>]+)@/); return m ? m[1].replace(/^GameScene\./, '') : '(無名)'; } return '?'; };
  // style 属性の書き換えが transform だけか（前後の宣言を比べる）
  const decl = (s) => { const o = {}; for (const part of (s || '').split(';')) { const i = part.indexOf(':'); if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim(); } return o; };
  const tfOnly = (a, b) => { const x = decl(a), y = decl(b); for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[k] !== y[k] && k !== 'transform' && k !== 'translate') return false; return true; };
  new MutationObserver((list) => {
    if (!P.on) return; const c = P.cur;
    for (const m of list) {
      if (m.type === 'attributes' && m.attributeName === 'style' && tfOnly(m.oldValue, m.target.getAttribute('style'))) { c.mutTf++; continue; }
      c.mut++; const k = desc(m.target); c.el[k] = (c.el[k] || 0) + 1;
      if (c.elLast[k] !== P.frame) { c.elLast[k] = P.frame; c.elFrame[k] = (c.elFrame[k] || 0) + 1; }
      if (m.type !== 'childList') { const ka = k + '#' + idOf(m.type === 'characterData' ? m.target.parentElement || m.target : m.target); if (c.elLastA[ka] !== P.frame) { c.elLastA[ka] = P.frame; c.elFrameA[ka] = (c.elFrameA[ka] || 0) + 1; } }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
  // 書いた所（要素 ← 関数）と、レイアウトを汚したか（値が変わる書き込みだけ）
  const ids = new WeakMap(); let idN = 0; const idOf = (el) => { let i = ids.get(el); if (!i) { i = ++idN; ids.set(el, i); } return i; }; // 要素1つずつを区別する番号
  const TREE = /^(append|appendChild|replaceChildren|remove|insertBefore|removeChild)$/, MOVE = /^style\.(transform|opacity|translate|rotate|scale)$/;
  const mark = (el, what, changed) => { if (changed) P.dirty = true; if (!P.on) return; const k = `${desc(el)} ${what} ← ${caller()}`, m = changed ? P.cur.wr : P.cur.same; m[k] = (m[k] || 0) + 1; if (changed && !TREE.test(what) && !MOVE.test(what)) { const o = (P.cur.inst[k] ??= {}), i = idOf(el); o[i] = (o[i] || 0) + 1; } }; // same: 書く前と後で値が同じ書き込み
  const setter = (proto, name, what, cmp) => { const d = Object.getOwnPropertyDescriptor(proto, name); if (!d || !d.set) return; Object.defineProperty(proto, name, { ...d, set: function __pgSet(v) { mark(this, what, cmp ? d.get.call(this) !== String(v) : true); return d.set.call(this, v); } }); };
  setter(Element.prototype, 'innerHTML', 'innerHTML', true); setter(Node.prototype, 'textContent', 'text', true); setter(Element.prototype, 'className', 'class', true);
  setter(HTMLImageElement.prototype, 'src', 'src', true);
  { const f = Element.prototype.setAttribute; Element.prototype.setAttribute = function __pgAttr(k, v) { mark(this, '@' + k, this.getAttribute(k) !== String(v)); return f.call(this, k, v); }; }
  for (const n of ['append', 'appendChild', 'replaceChildren', 'remove', 'insertBefore', 'removeChild']) { const proto = n === 'appendChild' || n === 'insertBefore' || n === 'removeChild' ? Node.prototype : Element.prototype; const f = proto[n]; if (f) proto[n] = function __pgTree(...a) { mark(this, n, true); return f.apply(this, a); }; }
  { const d = Object.getOwnPropertyDescriptor(Element.prototype, 'classList'), own = new WeakMap(); Object.defineProperty(Element.prototype, 'classList', { ...d, get() { const l = d.get.call(this); own.set(l, this); return l; } });
    const T = DOMTokenList.prototype; for (const n of ['add', 'remove', 'toggle']) { const f = T[n]; T[n] = function __pgCls(...a) { const el = own.get(this), before = this.value, r = f.apply(this, a); if (el) mark(el, 'classList.' + n, this.value !== before); return r; }; } }
  { const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style'), own = new WeakMap(); Object.defineProperty(HTMLElement.prototype, 'style', { ...d, get() { const s = d.get.call(this); own.set(s, this); return s; } });
    const S = CSSStyleDeclaration.prototype, sp = S.setProperty; S.setProperty = function __pgProp(k, v, ...a) { const el = own.get(this); if (el) mark(el, 'style.' + k, this.getPropertyValue(k) !== String(v)); return sp.call(this, k, v, ...a); };
    for (const n of ['transform', 'left', 'top', 'right', 'bottom', 'width', 'height', 'display', 'visibility', 'opacity', 'backgroundImage', 'background', 'maskImage', 'webkitMaskImage', 'cssText', 'marginLeft', 'marginTop', 'filter', 'color']) {
      let proto = S, d = Object.getOwnPropertyDescriptor(proto, n); if (!d) { proto = Object.getPrototypeOf(S); d = proto && Object.getOwnPropertyDescriptor(proto, n); } if (!d || !d.set) continue;
      Object.defineProperty(S, n, { ...d, set: function __pgStyle(v) { const el = own.get(this); if (el) mark(el, 'style.' + n, d.get.call(this) !== String(v)); return d.set.call(this, v); } }); } }
  // 強制レイアウト: 書いた後（まだ描画の更新が来ていない間）のレイアウトの読み取り
  const reader = (proto, name, getter) => { const d = Object.getOwnPropertyDescriptor(proto, name); if (!d) return; const f = getter ? d.get : d.value;
    const w = function __pgRead(...a) { if (P.dirty) { P.dirty = false; if (P.on) { const c = P.cur; c.forced++; if (c.forcedLast !== P.frame) { c.forcedLast = P.frame; c.forcedFrames++; } const k = `${name} ${desc(this === window ? document.documentElement : this)} ← ${caller()}`; c.forcedBy[k] = (c.forcedBy[k] || 0) + 1; } } return f.apply(this, a); };
    Object.defineProperty(proto, name, getter ? { ...d, get: w } : { ...d, value: w }); };
  // ResizeObserver の呼び出しはレイアウトの後（描画の前）。中での読み取りは強制レイアウトにならないので、汚れを消してから呼ぶ（dom1）
  { const RO = window.ResizeObserver; if (RO) window.ResizeObserver = class extends RO { constructor(cb) { super((...a) => { P.dirty = false; return cb(...a); }); } }; }
  reader(Element.prototype, 'getBoundingClientRect'); reader(Element.prototype, 'getClientRects');
  for (const n of ['offsetHeight', 'offsetWidth', 'offsetTop', 'offsetLeft']) reader(HTMLElement.prototype, n, true);
  for (const n of ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft']) reader(Element.prototype, n, true);
  reader(window, 'getComputedStyle');
  // フレーム: rAF の頭で数え、描画の更新の後（メッセージ）で汚れを消す
  const raf = window.requestAnimationFrame.bind(window), mc = new MessageChannel(); let last = 0;
  mc.port1.onmessage = () => { P.dirty = false; };
  (function loop() { raf((ts) => { P.frame++; if (P.on) { P.cur.frames++; if (last) P.cur.frameMs += ts - last; } last = ts; mc.port2.postMessage(0); loop(); }); })();
  for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!G) continue; const p = G.prototype;
    for (const n of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) { const f = p[n]; if (f) p[n] = function (...a) { if (P.on) P.cur.draw++; return f.apply(this, a); }; }
    for (const n of ['texImage2D', 'texSubImage2D']) { const f = p[n]; if (f) p[n] = function (...a) { if (P.on) { const s = a[a.length - 1]; P.cur.texBytes += s && s.width && s.height ? s.width * s.height * 4 : a.length >= 9 ? a[3] * a[4] * 4 : 0; } return f.apply(this, a); }; } }
  // 動いている CSS アニメーション・トランジションのうち、transform・opacity 以外を動かしているもの（0.25秒ごとに見る）
  setInterval(() => { if (!P.on || !document.getAnimations) return; for (const a of document.getAnimations()) { if (a.playState !== 'running') continue; const ef = a.effect, kf = ef && ef.getKeyframes ? ef.getKeyframes() : []; const props = new Set(); for (const f of kf) for (const k of Object.keys(f)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(k)) props.add(k); const bad = [...props].filter((k) => k !== 'transform' && k !== 'opacity' && k !== 'translate' && k !== 'rotate' && k !== 'scale'); if (!bad.length) continue; const k = `${desc(ef.target)} ${a.animationName || a.transitionProperty || 'anim'} [${bad.join(',')}]`; P.cur.anims[k] = (P.cur.anims[k] || 0) + 1; } }, 250);
  P.start = () => { P.cur = fresh(); P.on = true; };
  P.stop = () => { P.on = false; const c = P.cur; delete c.elLast; delete c.elLastA; delete c.forcedLast; for (const k in c.inst) c.inst[k] = Math.max(...Object.values(c.inst[k])); const fa = {}; for (const [k, n] of Object.entries(c.elFrameA)) { const d = k.replace(/#\d+$/, ''); fa[d] = Math.max(fa[d] || 0, n); } c.elFrameA = fa; return c; };
  P.counts = () => ({ nodes: document.getElementsByTagName('*').length, textures: window.game ? Object.keys(window.game.textures.list).length : 0 });
})();
