// 魚群の試作の録画・静止画・エリアの確認画像（verify/evidence/gyogun1/v3/）。開発サーバー（vite）を別ポートで立ててから: CLIENT_PORT=5226 npx tsx tools/gyogun_rec.mts [場面...]
import { mkdirSync, renameSync } from 'node:fs';
import { chromium } from 'playwright-core';
const port = process.env.CLIENT_PORT ?? '5226', OUT = 'verify/evidence/gyogun1/v3';
mkdirSync(OUT, { recursive: true });
const VP: Record<string, { width: number; height: number }> = { mobile: { width: 852, height: 393 }, pc: { width: 1280, height: 720 } };
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : ['mobile_ally', 'mobile_solo', 'pc_ally', 'pc_solo'];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const url = (v: string, x = '') => `http://localhost:${port}/gyogun.html?v=${v}&rec=1${x}`;
for (const v of scenes) {
  const vp = VP[v.split('_')[0]], mob = v.startsWith('mobile');
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mob, hasTouch: mob });
  const page = await ctx.newPage();
  await page.goto(url(v, '&area=1')); await page.waitForFunction(() => (window as any).ready, null, { timeout: 60000 }); await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${v}_area.png` });
  const plans: { name: string; n: number }[] = await page.evaluate(() => (window as any).PLANS);
  console.log(v, JSON.stringify(await page.evaluate(() => (window as any).areaStat)), plans.map((p) => `${p.name}:${p.n}`).join(' '));
  for (const p of plans) { await page.goto(url(v, `&play=${p.name}&at=0.75`)); await page.waitForFunction(() => (window as any).ready); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${v}_${p.name}.png` }); }
  await ctx.close();
  const rc = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mob, hasTouch: mob, recordVideo: { dir: `${OUT}/_tmp`, size: mob ? { width: vp.width * 2, height: vp.height * 2 } : vp } });
  for (const p of plans) {
    const pg = await rc.newPage();
    await pg.goto(url(v)); await pg.waitForFunction(() => (window as any).ready, null, { timeout: 60000 }); await pg.waitForTimeout(500);
    await pg.evaluate((n) => (window as any).play(n), p.name); await pg.waitForTimeout(400);
    const vid = pg.video()!; await pg.close(); renameSync(await vid.path(), `${OUT}/${v}_${p.name}.webm`);
  }
  await rc.close();
}
await b.close(); process.exit(0);
