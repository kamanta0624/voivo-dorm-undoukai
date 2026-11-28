// 魚群の試作（handoff_gyogun1 0章・0b。ゲーム本体には入れない）: 実際の戦闘画面のスクショを背景に、キャラの群れを canvas に描いて横切らせる
// 開き方: 開発サーバーで /gyogun.html?v=mobile|pc&play=<案の名前>（&rec=1 でボタンを隠す、&area=1 で演出用エリアを緑で見せる）。今の魚群・特別な魚群・全回転（DOM のまま）も出せる
// 0b の決まり: 群れを描くのは「演出用エリア」だけ＝画面から、視界の円・HUD・ボタン・ミニマップ・キルログ域・バフ欄・実況の字幕（実際の位置＋余白）を抜いた所
//   先頭は 0.5秒で端から端へ。その後 0.5秒はエリアの全部が埋まる（群れの長さ＝速さ×1秒）。最後尾が抜けるまで 1.5秒
import { CONFIG as C } from '../src/shared/config';
import { ModernFx } from '../src/client/slot_modern_fx';

const W = C.VIEW_W, H = C.VIEW_H, VR = C.VISION_RADIUS * C.VISION_SCALE, KL = C.SLOT_MODERN.area.killLog, SEC = C.SLOT_MODERN.reach.fish.sec;
const q = new URLSearchParams(location.search), view = q.get('v') ?? 'mobile';
const CHARS = ['kiritan', 'zunko', 'itako', 'zundamon']; // 陣営のプレイヤー（仮）。群れはこの4人を混ぜる
const DOT = (k: string, f: string) => `assets/gen/dot/${k}/${f}.png`;
const CROSS = 0.5, FULL = 0.5, V = W / CROSS; // 速さ（論理 px/秒）: 0.5秒で端から端

const info = await (await fetch('/verify/evidence/gyogun1/bg.json')).json(), R = info[view];
const stage = document.getElementById('stage')!, cv = document.getElementById('fxc') as HTMLCanvasElement, fxl = document.getElementById('fxl')!;
stage.style.backgroundImage = `url(/verify/evidence/gyogun1/bg_${view}.png)`;
const sx = innerWidth / R.vw, sy = innerHeight / R.vh;
const box = { x: R.x * sx, y: R.y * sy, w: R.w * sx, h: R.h * sy };
for (const e of [cv, fxl]) Object.assign(e.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
const dpr = devicePixelRatio || 1; cv.width = Math.round(box.w * dpr); cv.height = Math.round(box.h * dpr);
const g = cv.getContext('2d')!; g.imageSmoothingEnabled = false;
const K = cv.width / W;

// 潰さない表示（論理座標）: 実際に測った HUD・ボタン・ミニマップと、キルログ域・バフ欄・実況の字幕（出ていない時は測れないので CSS・設定の位置）。余白 PAD
const PAD = 4;
const keep: { x: number; y: number; w: number; h: number }[] = [...R.hud, { ...KL }, { x: 8, y: 112, w: 84, h: 34 }, { x: W * 0.22, y: H - 30, w: W * 0.56, h: 26 }].map((r: any) => ({ x: r.x - PAD, y: r.y - PAD, w: r.w + PAD * 2, h: r.h + PAD * 2 }));
function clipArea(half: boolean) { // 演出用エリア: 画面 − 視界の円 − 潰さない表示（half: 下半分だけ）
  if (half) { g.beginPath(); g.rect(0, H / 2, W, H / 2); g.clip(); }
  g.beginPath(); g.rect(0, 0, W, H); g.arc(W / 2, H / 2, VR, 0, Math.PI * 2); g.clip('evenodd');
  for (const r of keep) { g.beginPath(); g.rect(0, 0, W, H); g.rect(r.x, r.y, r.w, r.h); g.clip('evenodd'); }
}

const imgs: Record<string, HTMLImageElement> = {};
await Promise.all(CHARS.flatMap((k) => ['walk1', 'walk2'].map((f) => new Promise<void>((ok) => { const i = new Image(); i.onload = () => ok(); i.onerror = () => ok(); i.src = DOT(k, f); imgs[`${k}/${f}`] = i; }))));

// 案: s＝体の倍率（ドット 32×42 の何倍）、half＝下半分だけ、waves＝波の数（3秒の中で 1.5秒ごと）、glow＝金の光
type Plan = { name: string; label: string; s: number; half: boolean; waves: number; glow: boolean };
const PLANS: Plan[] = [
  { name: 'N_half_s2', label: '通常（差1）: 演出用エリアの下半分・2倍・波1回', s: 2, half: true, waves: 1, glow: false },
  { name: 'N_full_s2', label: '通常（差2）: 演出用エリアの全部・2倍・波1回', s: 2, half: false, waves: 1, glow: false },
  { name: 'N_full_s25', label: '通常（差2）: 全部・2.5倍・波1回（残り1.5秒は何もしない）', s: 2.5, half: false, waves: 1, glow: false },
  { name: 'N_full_s25_w2', label: '通常（差2）: 全部・2.5倍・波2回（3秒を埋める）', s: 2.5, half: false, waves: 2, glow: false },
  { name: 'N_full_s3', label: '通常（差2）: 全部・3倍・波1回', s: 3, half: false, waves: 1, glow: false },
  { name: 'SP_full_s25', label: '特別（差1）: 演出用エリアの全部・2.5倍・波1回', s: 2.5, half: false, waves: 1, glow: false },
  { name: 'SP_s3_w2_glow', label: '特別（差2）: 全部・3倍・波2回・金の光', s: 3, half: false, waves: 2, glow: true },
];
// 段: 体の高さの 0.9 倍ごと（段の間を詰めすぎない）。横の間隔は体の幅の 0.6 倍（隣と半分以上は重ならない）。段ごとに開始を少しずらす
function layout(p: Plan) {
  const w = 32 * p.s, h = 42 * p.s, pitch = h * 0.9, gap = w * 0.6, len = V * (CROSS + FULL); // 群れの長さ: 0.5秒で端に届き、さらに0.5秒エリアを埋め続ける
  const y0 = p.half ? H / 2 - h * 0.3 : -h * 0.3, rowsN = Math.ceil((H - y0 + h * 0.3) / pitch);
  const out: { x: number; y: number; k: string; ph: number }[] = [];
  for (let r = 0; r < rowsN; r++) { const off = (((r * 37) % 11) / 11) * gap; for (let i = 0; i * gap < len; i++) out.push({ x: off + i * gap, y: y0 + r * pitch + (((i * 5 + r * 3) % 5) - 2), k: CHARS[(i + r) % CHARS.length], ph: (i + r) % 2 }); }
  return { w, h, out, len };
}
let run: { p: Plan; t0: number; L: ReturnType<typeof layout> } | null = null, done: (() => void) | null = null;
const waveSec = CROSS + FULL + CROSS; // 1波: 先頭が入る〜最後尾が抜ける（1.5秒）
function frame(now: number) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  if (run) {
    const t = (now - run.t0) / 1000, p = run.p, L = run.L;
    if (t > Math.max(SEC, p.waves * waveSec)) { run = null; done?.(); done = null; }
    else {
      const wave = Math.floor(t / waveSec), tw = t - wave * waveSec;
      if (wave < p.waves) {
        g.save(); g.scale(K, K); clipArea(p.half);
        if (p.glow) { g.shadowColor = '#ffd700'; g.shadowBlur = 8; }
        for (const c of L.out) {
          const x = W + c.x - V * tw; // 右の外から左へ。先頭は 0.5秒で左端
          if (x < -L.w || x > W) continue;
          const im = imgs[`${c.k}/${Math.floor(tw * 10 + c.ph) % 2 ? 'walk2' : 'walk1'}`]; if (im?.naturalWidth) g.drawImage(im, Math.round(x), Math.round(c.y), L.w, L.h);
        }
        g.restore();
      }
    }
  }
  if (q.has('area')) { g.save(); g.scale(K, K); clipArea(false); g.fillStyle = '#0f08'; g.fillRect(0, 0, W, H); g.restore(); } // 確認用: 演出用エリアを緑で
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const play = (name: string) => new Promise<void>((ok) => {
  const p = PLANS.find((x) => x.name === name);
  document.getElementById('cap')!.textContent = p ? p.label : name;
  if (p) { run = { p, t0: performance.now(), L: layout(p) }; done = ok; return; }
  fxl.replaceChildren(); const layer = document.createElement('div'); layer.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;transform:scale(${box.w / W})`; fxl.append(layer);
  const hud = document.createElement('div'); hud.style.display = 'none'; document.body.append(hud);
  const f = new ModernFx(hud, layer, CHARS, CHARS, '#f80'); f.sound = false;
  if (name === 'allSpin') f.allSpinFx('kiritan', C.SLOT_MODERN.allSpinSec); else f.reach(name, 'kiritan', SEC, true);
  setTimeout(ok, (name === 'allSpin' ? C.SLOT_MODERN.allSpinSec : SEC) * 1000 + 300);
});
(window as any).play = play; (window as any).PLANS = PLANS.map((p) => ({ name: p.name, label: p.label, n: layout(p).out.length }));
const ui = document.getElementById('ui')!;
for (const [n, l] of [...PLANS.map((p) => [p.name, p.name] as const), ['fish', '今の魚群'], ['fishSp', '今の特別'], ['allSpin', '全回転']] as const) { const b = document.createElement('button'); b.textContent = l; b.onclick = () => play(n); ui.append(b); }
if (q.has('rec')) ui.style.display = 'none';
if (q.get('play')) play(q.get('play')!);
