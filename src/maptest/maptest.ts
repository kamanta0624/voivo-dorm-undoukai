// マップチップ試験（/maptest）: map.json の間取りをチップで描く（本体と同じ mapchip/paint.ts）。現行の単色描画と切り替えて比べる
import MAP from '../shared/map.json';
import { ROOMS, OUTSIDE_TONE, OUTSIDE_TONES, type OutsideTone } from '../client/mapchip/chips';
import { paintMap, CHIP_FILES, Pics } from '../client/mapchip/paint';
import { CHIP_PACK, loadChipImages } from '../client/mapchip/pack';

const T = MAP.tileSize;
// 1倍の絵を作る（p なし: 現行の単色、p あり: チップ）。tone: 建物の外の色調
function paint(p: Pics | null, tone: OutsideTone = OUTSIDE_TONE) {
  const c = document.createElement('canvas');
  c.width = MAP.width * T; c.height = MAP.height * T;
  paintMap(c.getContext('2d')!, p, MAP.tiles, undefined, undefined, undefined, undefined, tone);
  return c;
}

const cv = document.getElementById('cv') as HTMLCanvasElement, ctx = cv.getContext('2d')!;
const modeBtn = document.getElementById('mode')!, info = document.getElementById('info')!;
const q = new URLSearchParams(location.search);
let tiled = q.get('mode') !== 'current', zoom = Number(q.get('z')) || 1, labels = q.get('labels') !== '0';
const TONES = Object.keys(OUTSIDE_TONES) as OutsideTone[], toneBtn = document.getElementById('tone')!;
let tone: OutsideTone = TONES.includes(q.get('tone') as OutsideTone) ? (q.get('tone') as OutsideTone) : OUTSIDE_TONE, chips: Pics | null = null;
let pics: { current: HTMLCanvasElement; tiled: HTMLCanvasElement | null } = { current: paint(null), tiled: null };

function draw() {
  const src = tiled && pics.tiled ? pics.tiled : pics.current;
  cv.width = src.width * zoom; cv.height = src.height * zoom;
  ctx.imageSmoothingEnabled = false; // ニアレスト
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  // 部屋名（chips.ts の新しい割り当て。廊下は出さない）
  if (labels) {
    ctx.font = `bold ${10 + 2 * zoom}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3;
    for (const q of MAP.rooms) {
      const rm = ROOMS[q.id];
      if (!rm || rm.name === '廊下') continue;
      const cx = ((q.rect[0] + q.rect[2] + 1) / 2) * T * zoom, cy = ((q.rect[1] + q.rect[3] + 1) / 2) * T * zoom, t = `${rm.name}（${q.id}）`;
      ctx.strokeStyle = '#000'; ctx.strokeText(t, cx, cy); ctx.fillStyle = '#fff'; ctx.fillText(t, cx, cy);
    }
  }
  modeBtn.textContent = tiled ? 'チップ表示（Tで現行へ）' : '現行の単色（Tでチップへ）';
  toneBtn.textContent = `外の色調: ${OUTSIDE_TONES[tone].name}（${tone}${tone === OUTSIDE_TONE ? '・試合' : ''}。Cで切替）`;
  info.textContent = `${MAP.width}×${MAP.height}マス・1マス${T}px・${zoom}倍`;
  document.body.dataset.ready = pics.tiled ? '1' : '0';
}
modeBtn.onclick = () => { tiled = !tiled; draw(); };
const nextTone = () => { tone = TONES[(TONES.indexOf(tone) + 1) % TONES.length]; if (chips) pics.tiled = paint(chips, tone); draw(); };
toneBtn.onclick = nextTone;
addEventListener('keydown', (e) => { if (e.key === 't' || e.key === 'T') { tiled = !tiled; draw(); } if (e.key === 'n' || e.key === 'N') { labels = !labels; draw(); } if (e.key === 'c' || e.key === 'C') nextTone(); });
document.getElementById('labels')!.onclick = () => { labels = !labels; draw(); };
document.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) => (b.onclick = () => { zoom = Number(b.dataset.z); draw(); }));
draw();
const names = Object.keys(CHIP_FILES) as (keyof typeof CHIP_FILES)[];
loadChipImages('/' + CHIP_PACK) // 本体と同じ包み（mapcrypt1）
  .then((m) => { if (names.some((k) => !m.has(CHIP_FILES[k]))) throw new Error('包みにない絵がある'); chips = Object.fromEntries(names.map((k) => [k, m.get(CHIP_FILES[k])!])) as Pics; pics.tiled = paint(chips, tone); draw(); })
  .catch((e) => { info.textContent = `素材を読めない: ${e.message}（public/assets/mapchip.bin を確認。npm run mapchip）`; });
