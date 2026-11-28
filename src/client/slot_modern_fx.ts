// モダンのスロットの演出（handoff_slot2 D章）。DOM だけで描く（試合の HUD #fx にも載せられるように）
// hud: リール・保留・モード表示を入れる要素。syms: リールの絵柄 1〜9 のキャラ（添字＋1が番号）。chars: 魚群のキャラ（陣営のプレイヤー）。layer: 論理解像度 VIEW_W×VIEW_H の演出用の要素（拡大は呼び出し側）。演出は視界の円・キルログ域を抜いたマスクの中だけに出る（special は視界の円だけ抜く）
// 素材は加工しない（表示時の拡大・位置のみ）
import { CONFIG as C } from '../shared/config';
import type { Hold, Mode } from '../shared/slot_modern';
// 効果音（public/assets/se/。ニコニ・コモンズ nc498075＝先バレ、nc356453＝当選）
const SE = { saki: 'assets/se/nc498075.mp3', win: 'assets/se/nc356453.mp3' };
const SE_EL: Partial<Record<keyof typeof SE, HTMLAudioElement>> = {};

const M = C.SLOT_MODERN, W = C.VIEW_W, H = C.VIEW_H;
const DOT = (k: string, f = 'idle') => `assets/gen/dot/${k}/${f}.png`;
export const HOLD_COLORS = ['#e8e8e8', '#3d8bff', '#3ccf5a', '#ff3b3b', 'conic-gradient(#f33,#fd3,#3f6,#3cf,#a3f,#f33)'];

export const CSS = `
.mfx-hud{display:flex;flex-direction:column;align-items:center;gap:3px;font:bold 7px sans-serif;color:#fff;text-shadow:0 0 2px #000}
.mfx-sl{position:relative;display:flex;gap:1px;background:#1b1b28;border:2px solid var(--c);padding:1px;border-radius:3px}
.mfx-sl.reach{animation:mfxreach .25s steps(2) infinite}
.mfx-sl.win{border-color:#ffd700;box-shadow:0 0 6px #ffd700}
.mfx-sl.flash{animation:mfxflash .5s ease-out}
.mfx-ic{position:relative;width:15px;height:15px;background:#000 no-repeat -9px -4px;image-rendering:pixelated;border:1px solid #555;box-sizing:border-box;contain:layout size} /* 回転中は番号（::after）が毎回変わってレイアウトが起きるので、範囲を枠の中だけにする */
.mfx-ic[data-n]::after{content:attr(data-n);position:absolute;right:0;bottom:-1px;font:900 6px sans-serif;color:#fff;-webkit-text-stroke:.4px #000}
.mfx-ic.good[data-n]::after{color:#ffd700}
.mfx-ic.pen{background:#400;color:#f66;text-align:center;line-height:13px;font-size:10px}
.mfx-holds{display:flex;gap:3px;align-items:center}
.mfx-h{position:relative;width:7px;height:7px;border-radius:50%;border:1px solid #000a}
.mfx-h.cur{width:9px;height:9px;outline:1px solid #fff}
.mfx-h.high{border-radius:1px;transform:rotate(45deg)}
.mfx-h.saki::after{content:'★';position:absolute;left:50%;top:-8px;transform:translateX(-50%);color:#ffe14d;font-size:7px;text-shadow:0 0 3px #ff0}
.mfx-mode{white-space:nowrap}
.mfx-mode .ct{color:#ffd700}.mfx-mode .mback{color:#ff8080}
.mfx-label{position:absolute;left:100%;top:50%;transform:translate(4px,-50%);white-space:nowrap;font:900 7px sans-serif;color:#ffd700;text-shadow:0 0 3px #000,0 0 3px #000}
.mfx-toast{position:absolute;left:50%;top:44%;transform:translateX(-50%);white-space:pre;text-align:center;font:900 12px sans-serif;color:#ffd700;-webkit-text-stroke:.5px #000;text-shadow:0 0 4px #000;animation:mfxfade 1.6s linear forwards;pointer-events:none}
.mfx-toast.bad{color:#ff6060}
.mfx-fx{position:absolute;inset:0;pointer-events:none;overflow:hidden;-webkit-mask-size:100% 100%;mask-size:100% 100%}
.mfx-fx img{position:absolute;image-rendering:pixelated}
.mfx-bang{position:absolute;font:900 16px sans-serif;color:#fff;-webkit-text-stroke:.6px #000;animation:mfxpop .3s ease-out}
.mfx-rainbow{position:absolute;inset:0;overflow:hidden}
.mfx-rainbow::before{content:'';position:absolute;left:50%;top:50%;width:${Math.ceil(Math.hypot(W, H))}px;height:${Math.ceil(Math.hypot(W, H))}px;margin:-${Math.ceil(Math.hypot(W, H)) / 2}px;background:conic-gradient(#f336,#fd36,#3f66,#3cf6,#a3f6,#f336);animation:mfxspin 1.2s linear infinite} /* 回すのは transform だけ（角度の変数を毎フレーム変えると再計算・描き直しになる。perf6）。正方形は画面の対角線の大きさ */
@keyframes mfxreach{0%{border-color:#ff3030;box-shadow:0 0 5px #ff3030}100%{border-color:#ffd700;box-shadow:none}}
@keyframes mfxflash{0%{box-shadow:0 0 16px 6px #fff;background:#fff}100%{box-shadow:none}}
@keyframes mfxfade{0%,80%{opacity:1}100%{opacity:0}}
@keyframes mfxin{0%{transform:translateX(-120%)}100%{transform:none}}
@keyframes mfxpop{0%{transform:scale(2.5);opacity:0}100%{transform:none;opacity:1}}
@keyframes mfxspin{to{transform:rotate(360deg)}}
`;

// 視界の円（画面中央・半径 VISION_RADIUS×VISION_SCALE）とキルログ域。試合は setArea で実際の視界・キルログ域に差し替える
const VIS0 = `<circle cx="${W / 2}" cy="${H / 2}" r="${C.VISION_RADIUS * C.VISION_SCALE}" fill="black"/>`;
const rectSvg = (k: { x: number; y: number; w: number; h: number }) => `<rect x="${k.x}" y="${k.y}" width="${k.w}" height="${k.h}" fill="black"/>`;
// holes（黒で描いた図形）を抜いたマスク（SVG）
function maskUrl(holes: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><mask id="m"><rect width="${W}" height="${H}" fill="white"/>${holes}</mask><rect width="${W}" height="${H}" fill="white" mask="url(#m)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export class ModernFx {
  sl: HTMLElement; reelEls: HTMLElement[]; holdsEl: HTMLElement; modeEl: HTMLElement; label: HTMLElement;
  normal: HTMLElement; special: HTMLElement; // 演出の層（マスク違い）
  spinning = [false, false, false]; allSpin = false; allSpinFrom = 1; spinAt = 0;
  shown = [NaN, NaN, NaN]; // 各リールに今出している番号（setReel の k）。同じなら書き直さない
  sound = true; sakiOn = true; // 先バレの音・表示（カスタム）

  constructor(public hud: HTMLElement, public layer: HTMLElement, public syms: string[], public chars: string[], color: string) {
    if (!document.getElementById('mfx-css')) { const st = document.createElement('style'); st.id = 'mfx-css'; st.textContent = CSS; document.head.append(st); }
    hud.classList.add('mfx-hud');
    hud.innerHTML = `<div class="mfx-sl" style="--c:${color}"><span class="mfx-ic"></span><span class="mfx-ic"></span><span class="mfx-ic"></span><span class="mfx-label"></span></div><div class="mfx-holds"></div><div class="mfx-mode"></div>`;
    this.sl = hud.querySelector('.mfx-sl')!; this.reelEls = [...hud.querySelectorAll<HTMLElement>('.mfx-ic')]; this.label = hud.querySelector('.mfx-label')!;
    this.holdsEl = hud.querySelector('.mfx-holds')!; this.modeEl = hud.querySelector('.mfx-mode')!;
    const mk = () => { const d = document.createElement('div'); d.className = 'mfx-fx'; layer.append(d); return d; };
    this.normal = mk(); this.special = mk();
    this.setArea(VIS0, M.area.killLog);
  }

  // 演出を出せる範囲: vis＝視界（黒で描いた SVG の図形）、kill＝キルログ域。通常の演出は両方の外、特別な演出（special）は視界の外
  setArea(vis: string, kill: { x: number; y: number; w: number; h: number }) {
    const n = maskUrl(vis + rectSvg(kill)), sp = maskUrl(vis);
    this.normal.style.maskImage = this.normal.style.webkitMaskImage = n;
    this.special.style.maskImage = this.special.style.webkitMaskImage = sp;
  }

  private setReel(i: number, k: number) {
    const e = this.reelEls[i];
    this.shown[i] = k;
    if (k < 0) { e.className = 'mfx-ic pen'; e.textContent = '×'; delete e.dataset.n; e.style.backgroundImage = ''; (e as any)._bg = ''; return; }
    const n = this.syms.length, no = ((((k - 1) % n) + n) % n) + 1; // 回転中は番号を巡回
    const cls = `mfx-ic${M.reel.group[no - 1] !== 'even' ? ' good' : ''}`, bg = `url(${DOT(this.syms[no - 1])})`; // 変わった所だけ書く
    if (e.className !== cls) e.className = cls; if (e.textContent) e.textContent = ''; if (e.dataset.n !== String(no)) e.dataset.n = String(no); if ((e as any)._bg !== bg) { (e as any)._bg = bg; e.style.backgroundImage = bg; }
  }

  // リールの回転（毎フレーム）。回っているリールは SLOT_REEL_MS ごとに絵柄が変わる。全回転は3つとも同じ絵柄
  frame(now: number) {
    const k = Math.floor((now - this.spinAt) / C.SLOT_REEL_MS);
    this.spinning.forEach((s, i) => { const v = this.allSpin ? this.allSpinFrom + k : 1 + k + i * 3; if (s && v !== this.shown[i]) this.setReel(i, v); }); // 番号が変わった時だけ DOM を書く
  }

  // 回転開始: リーチは2つそろえて3つ目だけ回す。全回転は3つ同じ絵柄で回す。結果まで回すだけ（結果は stop）
  spin(now: number, reels: number[], act: string | null) {
    this.spinAt = now; this.allSpin = act === 'allSpin'; this.allSpinFrom = reels[0]; // 全回転はそろう絵柄から3つ同じまま回る this.label.textContent = '';
    this.sl.classList.remove('win', 'reach');
    if (act && act !== 'allSpin') { this.setReel(0, reels[0]); this.setReel(1, reels[1]); this.spinning = [false, false, true]; this.sl.classList.add('reach'); this.label.textContent = 'リーチ！'; }
    else this.spinning = [true, true, true];
  }
  stop(reels: number[], outcome: string) {
    this.spinning = [false, false, false]; this.allSpin = false;
    reels.forEach((k, i) => this.setReel(i, k));
    this.sl.classList.remove('reach'); this.sl.classList.toggle('win', outcome === 'win');
    this.label.textContent = outcome === 'win' ? '当選！' : outcome === 'fall' ? '転落' : outcome === 'pen' ? '罰' : '';
  }
  // 結果を見せたあと、次の抽選まで回して見せる
  idle(now: number) { this.spinAt = now; this.spinning = [true, true, true]; this.label.textContent = ''; this.sl.classList.remove('win'); }

  // 保留4つ（先頭が次に回る）と、今回っている保留
  holds(hs: Hold[], cur: Hold | null) {
    const one = (h: Hold, c = '') => `<span class="mfx-h${c}${h.high ? ' high' : ''}${h.saki && this.sakiOn ? ' saki' : ''}" style="background:${HOLD_COLORS[h.color]}"></span>`;
    this.holdsEl.innerHTML = (cur ? one(cur, ' cur') : '<span class="mfx-h cur" style="background:#333"></span>') + hs.map((h) => one(h)).join('');
  }
  mode(m: Mode, backLeft: number, lv: string) {
    this.modeEl.innerHTML = (m === 'ct' ? '<span class="ct">フィーバータイム！</span>' : m === 'back' ? `<span class="mback">引き戻し 残り${backLeft}</span>` : '通常') + ` ／ ${lv}`;
  }

  // 先バレ: 枠が一瞬光る＋音（カスタムで OFF なら何もしない）
  sakibare() {
    if (!this.sakiOn) return;
    this.sl.classList.remove('flash'); void this.sl.offsetWidth; this.sl.classList.add('flash');
    if (this.sound) this.se('saki');
  }
  // 効果音（handoff_se1）: saki＝先バレ音、win＝試合の当選音。鳴っている途中なら頭から鳴らし直す
  se(kind: keyof typeof SE) {
    const a = (SE_EL[kind] ??= new Audio(SE[kind]));
    a.volume = C.SE_VOLUME; a.currentTime = 0;
    a.play().catch(() => {});
  }

  toast(text: string, bad = false) {
    const e = document.createElement('div'); e.className = `mfx-toast${bad ? ' bad' : ''}`; e.textContent = text; this.layer.append(e); setTimeout(() => e.remove(), 1700);
  }

  // リーチ演出（sec 秒）。char: リーチの絵柄のキャラ。win: 当否（見た目の差に使う）
  reach(act: string, char: string, sec: number, win: boolean) {
    const el = (html: string, layer = this.normal) => { const d = document.createElement('div'); d.innerHTML = html; const n = d.firstElementChild as HTMLElement; layer.append(n); setTimeout(() => n.remove(), sec * 1000); return n; };
    if (act === 'chibi') { // ちびキャラ: 左下の隅をトコトコ歩いて、止まって何かを見つける
      const im = el(`<img src="${DOT(char, 'walk1')}" style="left:-34px;top:${H - 44}px">`) as HTMLImageElement;
      const walk = sec * 0.6, t0 = performance.now();
      let f0 = -1; const tick = () => { const p = (performance.now() - t0) / 1000; if (!im.isConnected) return; if (p < walk) { im.style.transform = `translateX(${(60 * p) / walk}px)`; const f = Math.floor(p * 6) % 2; if (f !== f0) { f0 = f; im.src = DOT(char, f ? 'walk2' : 'walk1'); } requestAnimationFrame(tick); } else { im.src = DOT(char, win ? 'banzai' : 'idle'); el(`<span class="mfx-bang" style="left:30px;top:${H - 64}px;color:${win ? '#ffd700' : '#bbb'}">${win ? '!!' : '?'}</span>`); } };
      requestAnimationFrame(tick);
    } else if (act === 'fish') { // 魚群: 陣営のキャラの群れが下の端を横切る
      const F = M.fish, t0 = performance.now(), ims = Array.from({ length: F.n }, (_, i) => el(`<img src="${DOT(this.chars[i % this.chars.length], 'walk1')}" style="top:${H - 42 - (i % 2) * 10}px;left:${W + i * F.gap}px">`) as HTMLImageElement);
      const fr = ims.map(() => -1), tick = () => { const p = (performance.now() - t0) / 1000; if (!ims[0].isConnected) return; ims.forEach((im, i) => { im.style.transform = `translateX(${-F.speed * p}px)`; const f = Math.floor(p * 6 + i) % 2; if (f !== fr[i]) { fr[i] = f; im.src = DOT(this.chars[i % this.chars.length], f ? 'walk2' : 'walk1'); } }); requestAnimationFrame(tick); }; // 位置は transform（初めの位置は left）、絵はコマが変わった時だけ（perf6）
      requestAnimationFrame(tick);
    } else if (act === 'fishSp') { // 特別な魚群（special）: 大きな群れが画面全体の視界外（上下2列）を横切る
      const F = M.fishSp, t0 = performance.now(), sz = [32 * F.scale, 42 * F.scale];
      const ims = F.rows.flatMap((y, r) => Array.from({ length: F.n }, (_, i) => el(`<img src="${DOT(this.chars[(i + r) % this.chars.length], 'walk1')}" style="left:0;width:${sz[0]}px;height:${sz[1]}px;top:${y - sz[1] / 2 + (i % 2) * 8}px">`, this.special) as HTMLImageElement));
      const fr = ims.map(() => -1), tick = () => { const p = (performance.now() - t0) / 1000; if (!ims[0].isConnected) return; ims.forEach((im, j) => { const i = j % F.n, r = Math.floor(j / F.n), x = r ? -sz[0] - i * F.gap + F.speed * p : W + i * F.gap - F.speed * p; im.style.transform = `translateX(${x}px)${r ? ' scaleX(-1)' : ''}`; const f = Math.floor(p * 6 + i) % 2; if (f !== fr[j]) { fr[j] = f; im.src = DOT(this.chars[(i + r) % this.chars.length], f ? 'walk2' : 'walk1'); } }); requestAnimationFrame(tick); }; // 位置は transform、絵はコマが変わった時だけ（perf6）
      requestAnimationFrame(tick);
    }
    // plain（リーチのみ）は HUD の「リーチ！」だけ
  }

  // 全回転（特別な演出）: 画面全体の視界外に虹の光と、そろう絵柄の大きなドット
  allSpinFx(char: string, sec: number) {
    const d = document.createElement('div');
    d.innerHTML = `<div class="mfx-rainbow"></div>` + [[4, 4], [W - 68, 4], [4, H - 88], [W - 68, H - 88]].map(([x, y]) => `<img src="${DOT(char, 'banzai')}" style="left:${x}px;top:${y}px;width:64px;height:84px">`).join('');
    const box = document.createElement('div'); box.style.cssText = 'position:absolute;inset:0'; box.append(...d.childNodes); this.special.append(box); setTimeout(() => box.remove(), sec * 1000);
  }

  clearFx() { this.normal.replaceChildren(); this.special.replaceChildren(); }
}
