// 魚群の試作（handoff_gyogun1 0章〜0e。ゲーム本体には入れない）: 実際の対戦を止めた1コマ（tools/gyogun_bg.mts で層ごとに撮る）を背景に、キャラの群れを窓全体の canvas に描いて横切らせる
// 開き方: 開発サーバーで /gyogun.html?v=<場面>&play=<案の名前>（場面: mobile_ally・mobile_solo・pc_ally・pc_solo。&rec=1 でボタンを隠す、&area=1 で演出用エリアを緑で見せる、&at=<秒> でその時刻に止める）。今の魚群・特別な魚群・全回転（DOM のまま）も出せる
// 層: 背景（立ち絵・反対側の枠を消した画面）→ 群れの canvas（窓全体）→ 立ち絵・反対側の枠（0d: 群れはその奥を走る）
// 演出用エリア（0c・0d）＝ 左右・上下の余白の全部 ＋ ゲーム画面の中の「真っ暗で表示の無い所」
//   ゲーム画面の中: 地図の外のタイル（霧の下で真っ暗に見える所）から、チームの共有視界（撮った時点の視界ポリゴンの和集合。霧のマスクと同じ形）・HUD・ボタン・ミニマップ・キルログ域・バフ欄・実況の字幕を抜き、さらに PAD だけ内側へ縮める
//   床・壁は霧の下でも薄く見える（霧は黒の 0.85）ので、エリアに入らない
// 時間（0b）: 先頭は 0.5秒で窓の端から端へ（窓の幅で数える）。その後 0.5秒はエリアの全部が埋まる。最後尾が抜けるまで 1.5秒
// 並べ方（0e）: 段は v2 の2倍（段の間＝体の高さの 0.45倍。上下に重なる）、上の段ほど奥（先に描く）、横の間隔は体の幅の 0.75倍、ところどころ抜け
import { CONFIG as C } from '../src/shared/config';
import { ModernFx } from '../src/client/slot_modern_fx';

const W = C.VIEW_W, H = C.VIEW_H, KL = C.SLOT_MODERN.area.killLog, SEC = C.SLOT_MODERN.reach.fish.sec;
const q = new URLSearchParams(location.search), view = q.get('v') ?? 'mobile_ally';
const CHARS = ['kiritan', 'zunko', 'itako', 'zundamon']; // 陣営のプレイヤー（仮）。群れはこの4人を混ぜる
const DOT = (k: string, f: string) => `assets/gen/dot/${k}/${f}.png`;
const CROSS = 0.5, FULL = 0.5, PAD = 4; // PAD: 表示類・見えている所から離す CSS px
const BG = '/verify/evidence/gyogun1/v3/bg';

const info = await (await fetch(`${BG}/bg.json`)).json(), R = info[view];
const stage = document.getElementById('stage')!, cv = document.getElementById('fxc') as HTMLCanvasElement, fxl = document.getElementById('fxl')!, fg = document.getElementById('fg') as HTMLImageElement;
stage.style.backgroundImage = `url(${BG}/${view}_base.png)`; fg.src = `${BG}/${view}_fg.png`;
const sx = innerWidth / R.vw; // 撮った窓 → 今の窓
const box = { x: R.x * sx, y: R.y * sx, w: R.w * sx, h: R.h * sx }, k = box.w / W; // k: 論理 px → CSS px
Object.assign(fxl.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
const dpr = devicePixelRatio || 1, CW = Math.round(innerWidth * dpr), CH = Math.round(innerHeight * dpr);
cv.width = CW; cv.height = CH;
const g = cv.getContext('2d')!; g.imageSmoothingEnabled = false;
const VW = innerWidth, V = VW / CROSS; // 速さ（CSS px/秒）: 0.5秒で窓の端から端

// 演出用エリアのマスク（窓全体、実画素）
const mask = document.createElement('canvas'); mask.width = CW; mask.height = CH;
{
  const t = document.createElement('canvas'); t.width = CW; t.height = CH; const tg = t.getContext('2d', { willReadFrequently: true })!;
  tg.fillStyle = '#fff'; tg.fillRect(0, 0, CW, CH); tg.scale(dpr * sx, dpr * sx); tg.clearRect(R.x, R.y, R.w, R.h); // 余白は全部エリア
  for (const [x, y, w, h] of R.outs as number[][]) tg.fillRect(x, y, w, h); // ゲーム画面の中は地図の外のタイルだけ
  tg.setTransform(1, 0, 0, 1, 0, 0);
  const px = tg.getImageData(0, 0, CW, CH).data, m = new Uint8Array(CW * CH);
  const bx0 = Math.round(box.x * dpr), by0 = Math.round(box.y * dpr), bx1 = Math.round((box.x + box.w) * dpr), by1 = Math.round((box.y + box.h) * dpr);
  for (let i = 0; i < m.length; i++) m[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  // 共有視界のポリゴンと表示類を抜く
  tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, CW, CH); tg.fillStyle = '#fff'; tg.scale(dpr * sx, dpr * sx);
  tg.beginPath(); tg.rect(R.x, R.y, R.w, R.h); tg.clip(); // 抜くのはゲーム画面の中だけ（視界ポリゴンは画面の外まで伸びる）
  for (const pl of R.polys as number[][][]) { tg.beginPath(); pl.forEach(([x, y], i) => (i ? tg.lineTo(x, y) : tg.moveTo(x, y))); tg.closePath(); tg.fill(); }
  const L = (r: { x: number; y: number; w: number; h: number }) => ({ x: R.x + r.x * (R.w / W), y: R.y + r.y * (R.w / W), w: r.w * (R.w / W), h: r.h * (R.w / W) }); // 論理 → 撮った窓の CSS px
  for (const r of [...R.hud, L(KL), L({ x: 8, y: 112, w: 84, h: 34 }), L({ x: W * 0.22, y: H - 30, w: W * 0.56, h: 26 })]) tg.fillRect(r.x, r.y, r.w, r.h);
  const cut = tg.getImageData(0, 0, CW, CH).data;
  for (let i = 0; i < m.length; i++) if (cut[i * 4 + 3] > 0) m[i] = 0;
  // PAD だけ縮める（窓の外はエリア扱い）。横・縦の順に最小値
  const r = Math.round(PAD * dpr), e = new Uint8Array(m.length);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { let v = 1; for (let d = -r; d <= r && v; d++) { const xx = x + d; if (xx >= 0 && xx < CW && !m[y * CW + xx]) v = 0; } e[y * CW + x] = v; }
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { let v = 1; for (let d = -r; d <= r && v; d++) { const yy = y + d; if (yy >= 0 && yy < CH && !e[yy * CW + x]) v = 0; } m[y * CW + x] = v; }
  const mg = mask.getContext('2d')!, id = mg.createImageData(CW, CH);
  let inGame = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) { id.data[i * 4 + 3] = 255; const x = i % CW, y = (i / CW) | 0; if (x >= bx0 && x < bx1 && y >= by0 && y < by1) inGame++; }
  mg.putImageData(id, 0, 0);
  (window as any).areaStat = { inGame: inGame / ((bx1 - bx0) * (by1 - by0)), all: m.reduce((a, b) => a + b, 0) / m.length };
}

const imgs: Record<string, HTMLImageElement> = {};
await Promise.all(CHARS.flatMap((c) => ['walk1', 'walk2'].map((f) => new Promise<void>((ok) => { const i = new Image(); i.onload = () => ok(); i.onerror = () => ok(); i.src = DOT(c, f); imgs[`${c}/${f}`] = i; }))));

// 案: s＝体の倍率（ドット 32×42 の何倍。ゲーム画面の論理 px で）、half＝下半分だけ、waves＝波の数（1.5秒ごと）、glow＝金の光、chars＝群れのキャラ（1人だけの魚群は1人）
type Plan = { name: string; label: string; s: number; half: boolean; waves: number; glow: boolean; chars: string[] };
const P = (name: string, label: string, s: number, half: boolean, waves: number, glow: boolean, chars = CHARS): Plan => ({ name, label, s, half, waves, glow, chars });
const PLANS: Plan[] = [
  P('N_half_s2', '通常（差1）: 演出用エリアの下半分・2倍・波1回', 2, true, 1, false),
  P('N_full_s2', '通常（差2）: 演出用エリアの全部・2倍・波1回', 2, false, 1, false),
  P('N_full_s25', '通常（差2）: 全部・2.5倍・波1回（残り1.5秒は何もしない）', 2.5, false, 1, false),
  P('N_full_s25_w2', '通常（差2）: 全部・2.5倍・波2回（3秒を埋める）', 2.5, false, 2, false),
  P('N_full_s3', '通常（差2）: 全部・3倍・波1回', 3, false, 1, false),
  P('SP_full_s25', '特別（差1）: 演出用エリアの全部・2.5倍・波1回', 2.5, false, 1, false),
  P('SP_s3_w2_glow', '特別（差2）: 全部・3倍・波2回・金の光', 3, false, 2, true),
  P('ONE_kiritan', '1人だけ（きりたん）: 全部・2.5倍・波1回', 2.5, false, 1, false, ['kiritan']),
  P('ONE_zundamon', '1人だけ（ずんだもん）: 全部・2.5倍・波1回', 2.5, false, 1, false, ['zundamon']),
  P('ONE_itako', '1人だけ（イタコ）: 全部・2.5倍・波1回', 2.5, false, 1, false, ['itako']),
];
const hash = (a: number, b: number) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// 段: 体の高さの 0.45倍ごと（v2 の2倍の段数）。横の間隔は体の幅の 0.75倍。抜け: 1割強を単発で、ところどころ2〜4体まとめて
function layout(p: Plan) {
  const w = 32 * p.s * k, h = 42 * p.s * k, pitch = h * 0.45, gap = w * 0.75, len = V * (CROSS + FULL); // 群れの長さ: 0.5秒で端に届き、さらに0.5秒エリアを埋め続ける
  const top = p.half ? innerHeight / 2 : 0, y0 = top - h * 0.5, rowsN = Math.ceil((innerHeight - y0) / pitch);
  const out: { x: number; y: number; c: string; ph: number }[] = []; // 上の段から順（奥から手前）
  for (let r = 0; r < rowsN; r++) {
    const off = hash(r, 7) * gap; let skip = 0;
    for (let i = 0; i * gap < len; i++) {
      if (skip > 0) { skip--; continue; }
      const u = hash(r, i);
      if (u < 0.04) { skip = 1 + Math.floor(hash(i, r) * 3); continue; } // まとまった抜け
      if (u < 0.16) continue; // 単発の抜け
      out.push({ x: off + i * gap + (hash(i + 99, r) - 0.5) * gap * 0.3, y: y0 + r * pitch + (hash(r + 50, i) - 0.5) * h * 0.08, c: p.chars[Math.floor(hash(i, r + 3) * p.chars.length)], ph: (i + r) % 2 });
    }
  }
  return { w, h, out, len };
}
let run: { p: Plan; t0: number; L: ReturnType<typeof layout> } | null = null, done: (() => void) | null = null;
const waveSec = CROSS + FULL + CROSS; // 1波: 先頭が入る〜最後尾が抜ける（1.5秒）
function frame(now: number) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, CW, CH);
  let drew = false;
  if (run) {
    const t = q.has('at') ? Number(q.get('at')) : (now - run.t0) / 1000, p = run.p, L = run.L;
    if (t > Math.max(SEC, p.waves * waveSec)) { run = null; done?.(); done = null; }
    else {
      const wave = Math.floor(t / waveSec), tw = t - wave * waveSec;
      if (wave < p.waves) {
        g.save(); g.scale(dpr, dpr);
        if (p.half) { g.beginPath(); g.rect(0, innerHeight / 2, VW, innerHeight / 2); g.clip(); }
        if (p.glow) { g.shadowColor = '#ffd700'; g.shadowBlur = 8 * k; }
        for (const c of L.out) {
          const x = VW + c.x - V * tw; // 右の外から左へ。先頭は 0.5秒で左端
          if (x < -L.w || x > VW) continue;
          const im = imgs[`${c.c}/${Math.floor(tw * 10 + c.ph) % 2 ? 'walk2' : 'walk1'}`]; if (im?.naturalWidth) g.drawImage(im, Math.round(x), Math.round(c.y), L.w, L.h);
        }
        g.restore(); drew = true;
      }
    }
  }
  if (q.has('area')) { g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0f08'; g.fillRect(0, 0, CW, CH); drew = true; } // 確認用: 演出用エリアを緑で
  if (drew) { g.globalCompositeOperation = 'destination-in'; g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(mask, 0, 0); g.globalCompositeOperation = 'source-over'; } // エリアの外を消す
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
(window as any).ready = true;
if (q.get('play')) play(q.get('play')!);
