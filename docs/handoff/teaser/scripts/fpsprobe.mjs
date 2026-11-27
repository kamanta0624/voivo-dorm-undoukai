// viewport / 録画有無で rAF fps を比較
import { createRequire } from 'node:module';
const require = createRequire('/home/hatch/work/voisq/package.json');
const { chromium } = require('playwright-core');
import { joinPractice, sleep, Mover, CHROME, URL } from './lib.mjs';

const [w, h, rec] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4] === 'rec'];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], proxy: { server: 'http://127.0.0.1:18080' } });
const ctxOpts = { viewport: { width: w, height: h }, locale: 'ja-JP', ignoreHTTPSErrors: true };
if (rec) ctxOpts.recordVideo = { dir: '/tmp/teaser-videos/fpsprobe', size: { width: w, height: h } };
const context = await browser.newContext(ctxOpts);
const page = await context.newPage();
await page.addInitScript(`window.__raf=[]; const __l=(t)=>{window.__raf.push(t); requestAnimationFrame(__l);}; requestAnimationFrame(__l);`);
await joinPractice(page, 'aru', 'metan');
const mover = new Mover(page);
const r0 = await page.evaluate(() => window.__raf.length), p0 = await page.evaluate(() => performance.now());
for (const k of ['d', 's', 'a', 'w']) { await mover.set([k]); await sleep(5000); }
await mover.stop();
const r1 = await page.evaluate(() => window.__raf.length), p1 = await page.evaluate(() => performance.now());
console.log(`viewport ${w}x${h} rec=${rec} fps=${((r1 - r0) / ((p1 - p0) / 1000)).toFixed(1)}`);
await context.close();
await browser.close();
