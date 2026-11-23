// ルール説明（public/rules.html）のマップ全体図を描く: tools/render_rules_map.ts <出力png>
// 試合と同じ paintMap（src/client/mapchip/paint.ts）を、vite の開発サーバー経由でブラウザ（e2e と同じ Chrome）の canvas に描き、下端の空白だけ切って保存する（建物のある最後のタイル行の下端＋半タイル。手で置いた 3104×1480 と同じ切り方）
// マップチップ（public/assets/mapchip/）が要る。新しい依存は使わない（vite・playwright-core は既存）
import { writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? 'public/assets/rules/map.png';
const vite = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error' }); // 再読み込みで描画が途切れないように HMR・依存の事前バンドルはしない
await vite.listen();
const url = vite.resolvedUrls!.local[0];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url + 'patchnotes.md'); // 同じオリジンで import するため（HTML だとゲームが起動するので静的ファイルを開く）
  const png = await page.evaluate(async () => {
    const MAP = (await import('/src/shared/map.json' as any)).default, { paintMap, CHIP_FILES } = await import('/src/client/mapchip/paint.ts' as any);
    const T = MAP.tileSize, names = Object.keys(CHIP_FILES);
    const imgs = await Promise.all(names.map((k) => new Promise<HTMLImageElement>((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ng(new Error('マップチップがない: ' + CHIP_FILES[k])); i.src = '/assets/mapchip/' + CHIP_FILES[k]; })));
    const c = document.createElement('canvas'); c.width = MAP.width * T; c.height = MAP.height * T;
    const g = c.getContext('2d')!;
    paintMap(g, Object.fromEntries(names.map((k, i) => [k, imgs[i]])), MAP.tiles);
    const last = MAP.tiles.findLastIndex((r: string) => /[^ ]/.test(r)), h = Math.min(c.height, (last + 1) * T + T / 2); // ' ' は建物の外
    const o = document.createElement('canvas'); o.width = c.width; o.height = h; o.getContext('2d')!.drawImage(c, 0, 0);
    return o.toDataURL('image/png');
  });
  writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  console.log(out);
} finally {
  await browser.close();
  await vite.close();
}
