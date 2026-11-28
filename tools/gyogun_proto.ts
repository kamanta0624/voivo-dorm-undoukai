// 魚群の試作（handoff_gyogun1 0章。ゲーム本体には入れない）: 実際の戦闘画面のスクショを背景に、キャラの群れを canvas に描いて横切らせる
// 開き方: 開発サーバーで /gyogun.html?v=mobile|pc&play=<案の名前>。案はボタンからも出せる。全回転と、今の魚群・特別な魚群（DOM のまま）も出せる
import { CONFIG as C } from '../src/shared/config';
import { ModernFx } from '../src/client/slot_modern_fx';

const W = C.VIEW_W, H = C.VIEW_H, VR = C.VISION_RADIUS * C.VISION_SCALE, KL = C.SLOT_MODERN.area.killLog, SEC = C.SLOT_MODERN.reach.fish.sec;
const q = new URLSearchParams(location.search), view = q.get('v') ?? 'mobile';
const CHARS = ['kiritan', 'zunko', 'itako', 'zundamon']; // 陣営のプレイヤー（仮）。群れはこの4人を混ぜる
const DOT = (k: string, f: string) => `assets/gen/dot/${k}/${f}.png`;

// 背景（verify/evidence/gyogun1/bg_*.png）と、ゲームの canvas の位置（bg.json）
const info = await (await fetch('/verify/evidence/gyogun1/bg.json')).json(), R = info[view];
const stage = document.getElementById('stage')!, cv = document.getElementById('fxc') as HTMLCanvasElement, fxl = document.getElementById('fxl')!;
stage.style.backgroundImage = `url(/verify/evidence/gyogun1/bg_${view}.png)`;
const sx = innerWidth / R.vw, sy = innerHeight / R.vh; // 背景を窓に合わせた拡大
const box = { x: R.x * sx, y: R.y * sy, w: R.w * sx, h: R.h * sy };
for (const e of [cv, fxl]) Object.assign(e.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
const dpr = devicePixelRatio || 1; cv.width = Math.round(box.w * dpr); cv.height = Math.round(box.h * dpr);
const g = cv.getContext('2d')!; g.imageSmoothingEnabled = false;
const K = cv.width / W; // 論理座標 → canvas の画素

// 絵（歩き2コマ）
const imgs: Record<string, HTMLImageElement> = {};
await Promise.all(CHARS.flatMap((k) => ['walk1', 'walk2'].map((f) => new Promise<void>((ok) => { const i = new Image(); i.onload = () => ok(); i.onerror = () => ok(); i.src = DOT(k, f); imgs[`${k}/${f}`] = i; }))));

// 群れの作り: 段（y・倍率・速さ・体数・間隔）を並べる。dir: 1＝右から左（今と同じ）
type Row = { y: number; s: number; v: number; n: number; gap: number; off: number };
type Plan = { name: string; label: string; rows: Row[]; clip: 'out' | 'band'; alpha: number; dir: 1 | -1; end: number }; // end: 全員が抜けるまでの秒
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
// rows 段を y0〜y1 に並べ、合計 total 体。段ごとに速さ ±15%・開始位置をずらす。前後の段が少し重なるくらいに詰める
function rows(total: number, nRow: number, y0: number, y1: number, s: number, baseV: number, dense = 1): Row[] {
  seed = total * 31 + nRow; const per = Math.ceil(total / nRow);
  return Array.from({ length: nRow }, (_, i) => ({ y: nRow === 1 ? (y0 + y1) / 2 : y0 + ((y1 - y0) * i) / (nRow - 1), s, v: baseV * (0.85 + rnd() * 0.3), n: per, gap: (32 * s * 0.55) / dense, off: rnd() * 60 }));
}
// 速さ: 3秒（演出の秒数）で群れの最後尾まで画面を抜ける
const crossV = (r: Row[]) => Math.max(...r.map((x) => (W + x.n * x.gap + 40 * x.s + x.off) / SEC));
const mk = (name: string, label: string, rs: Row[], clip: Plan['clip'], alpha = 1, dir: 1 | -1 = 1): Plan => { const v = crossV(rs), mx = Math.max(...rs.map((y) => y.v)), rows = rs.map((x) => ({ ...x, v: v * (x.v / mx) })); return { name, label, rows, clip, alpha, dir, end: Math.max(...rows.map((x) => (W + x.off + x.n * x.gap + 32 * x.s) / x.v)) }; };
const PLANS: Plan[] = [
  mk('A30', '案A 通常: 視界の外だけ・30体・3段', rows(30, 3, 40, 320, 1, 1), 'out'),
  mk('A50', '案A 通常: 視界の外だけ・50体・5段（ぎっしり）', rows(50, 5, 30, 330, 1, 1, 1.4), 'out'),
  mk('B30', '案B 通常: 画面を横切る帯（3段）・30体・そのまま', rows(30, 3, 150, 230, 1, 1), 'band'),
  mk('B30h', '案B 通常: 画面を横切る帯（3段）・30体・半透明', rows(30, 3, 150, 230, 1, 1), 'band', 0.55),
  mk('SpA90', '案A 特別: 視界の外だけ・90体・7段・1.3倍', rows(90, 7, 20, 340, 1.3, 1, 1.3), 'out'),
  mk('SpB90', '案B・C 特別: 画面の大半を埋める・90体・7段・1.3倍・そのまま', rows(90, 7, 30, 330, 1.3, 1, 1.3), 'band'),
  mk('SpB90h', '案B・C 特別: 画面の大半を埋める・90体・7段・1.3倍・半透明', rows(90, 7, 30, 330, 1.3, 1, 1.3), 'band', 0.55),
  mk('SpB140', '案B・C 特別（ぎっしり）: 140体・9段・1.5倍・そのまま', rows(140, 9, 20, 345, 1.5, 1, 1.6), 'band'),
];

// 描く: 視界の外（out）は、画面から視界の円とキルログ域を抜いた範囲に切り抜く。band は全面（HUD は背景の絵なので、帯は HUD の上に出る点に注意）
let run: { p: Plan; t0: number } | null = null;
function frame(now: number) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  if (run) {
    const t = (now - run.t0) / 1000, p = run.p;
    if (t > p.end) { run = null; done?.(); done = null; }
    else {
      g.save(); g.scale(K, K);
      if (p.clip === 'out') { g.beginPath(); g.rect(0, 0, W, H); g.arc(W / 2, H / 2, VR, 0, Math.PI * 2); g.clip('evenodd'); g.beginPath(); g.rect(0, 0, W, H); g.rect(KL.x, KL.y, KL.w, KL.h); g.clip('evenodd'); } // 視界の円の外、かつキルログ域の外
      g.globalAlpha = p.alpha;
      p.rows.forEach((r, ri) => {
        const w = 32 * r.s, h = 42 * r.s;
        for (let i = 0; i < r.n; i++) {
          const x0 = W + r.off + i * r.gap, x = x0 - r.v * t; // 右の外から左へ
          if (x < -w || x > W) continue;
          const k = CHARS[(i + ri) % CHARS.length], f = Math.floor(t * 8 + i * 0.7) % 2 ? 'walk2' : 'walk1', yy = r.y - h / 2 + ((i * 7 + ri * 3) % 9) - 4; // 段の中で少し上下にばらす
          const im = imgs[`${k}/${f}`]; if (im?.naturalWidth) g.drawImage(im, Math.round(x), Math.round(yy), w, h);
        }
      });
      g.restore();
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
let done: (() => void) | null = null;
const play = (name: string) => new Promise<void>((ok) => {
  const p = PLANS.find((x) => x.name === name);
  document.getElementById('cap')!.textContent = p ? p.label : name;
  if (p) { run = { p, t0: performance.now() }; done = ok; return; }
  // 今の DOM の演出（比較用）と全回転: ゲームと同じ ModernFx を、論理解像度の層に重ねて出す
  fxl.replaceChildren(); const layer = document.createElement('div'); layer.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;transform:scale(${box.w / W})`; fxl.append(layer);
  const hud = document.createElement('div'); hud.style.display = 'none'; document.body.append(hud);
  const f = new ModernFx(hud, layer, CHARS, CHARS, '#f80'); f.sound = false;
  if (name === 'allSpin') f.allSpinFx('kiritan', C.SLOT_MODERN.allSpinSec); else f.reach(name, 'kiritan', SEC, true);
  setTimeout(ok, (name === 'allSpin' ? C.SLOT_MODERN.allSpinSec : SEC) * 1000 + 300);
});
(window as any).play = play; (window as any).PLANS = PLANS.map((p) => ({ name: p.name, label: p.label, total: p.rows.reduce((a, r) => a + r.n, 0) }));
const ui = document.getElementById('ui')!;
for (const [n, l] of [...PLANS.map((p) => [p.name, p.name] as const), ['fish', '今の魚群'], ['fishSp', '今の特別'], ['allSpin', '全回転']] as const) { const b = document.createElement('button'); b.textContent = l; b.onclick = () => play(n); ui.append(b); }
if (q.has('rec')) ui.style.display = 'none'; // 録画の時はボタンを隠す
if (q.get('play')) play(q.get('play')!);
