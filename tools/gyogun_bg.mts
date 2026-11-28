// 魚群の試作（gyogun1 0c〜0e）の背景を撮る: 実際の対戦（Bot 戦）を止めた1コマを、層ごとに撮る。ゲーム本体には入れない
// 実行: npx tsx tools/gyogun_bg.mts（dist をビルド済みで。E2E_HOOKS・SERVE_DIST のサーバーを別ポートで立てる）
// 出すもの（verify/evidence/gyogun1/v4/bg/）: <場面>_base.png（立ち絵・反対側の枠を消した画面）、<場面>_fg.png（立ち絵・枠だけ。透明の背景）、<場面>_full.png（そのまま）、bg.json（キャンバスの位置・表示類の枠・共有視界のポリゴン・地図の外のタイル。窓の CSS px）
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { CONFIG as C } from '../src/shared/config';
const port = process.env.GAME_PORT ?? '2654', OUT = 'verify/evidence/gyogun1/v4/bg';
mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const srv = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env: { ...process.env, E2E_HOOKS: '1', SERVE_DIST: '1', GAME_PORT: port }, stdio: 'ignore' });
for (;;) { try { if ((await fetch(`http://localhost:${port}/status`)).ok) break; } catch {} await sleep(250); }
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const info: any = {};
for (const [view, vp, mob] of [['mobile', { width: 852, height: 393 }, true], ['pc', { width: 1280, height: 720 }, false]] as const) {
  for (const scene of ['ally', 'solo'] as const) {
    const tag = `${view}_${scene}`;
    const page = await (await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mob, hasTouch: mob })).newPage();
    await page.addInitScript("window.__name = (f) => f"); // tsx が名前付きの関数に付ける __name をページでも通す
    await page.goto(`http://localhost:${port}/?e2e=gy${tag}${Date.now()}`); await page.waitForFunction(() => (window as any).snap && (window as any).room);
    const send = (t: string, d: any = {}) => page.evaluate(([t, d]) => (window as any).room.send(t, d), [t, d] as const);
    await send('e2eBossGuard', { on: true }); await send('e2eSlotMiss', { on: true }); await send('go', { char: 'kiritan' });
    for (let i = 0; i < 60 && (await page.evaluate(() => (window as any).snap.phase)) !== 'playing'; i++) { await send('e2eSkipIntro'); await sleep(250); }
    await sleep(3000);
    // ally: 味方の横 220（画面内に味方の視界が入る）。solo: 味方・大将から遠い所
    const mates = async () => page.evaluate(() => { const S = (window as any).snap, me = S.players.find((p: any) => p.id === S.me); return { alive: me.alive && ![...document.querySelectorAll<HTMLElement>('#fx .fall')].some((e) => e.getBoundingClientRect().width > 0), me: { x: me.x, y: me.y }, o: [...S.players.filter((p: any) => p.team === me.team && p.id !== S.me && p.alive), ...S.bosses.filter((x: any) => x.team === me.team)].map((p: any) => ({ x: p.x, y: p.y })), W: (window as any).game.scene.scenes[0].cameras.main.getBounds?.() }; });
    let ok = false;
    for (let tries = 0; tries < 40 && !ok; tries++) {
      const m = await mates();
      if (scene === 'ally') { const a = m.o[0]; await send('e2eTeleport', { x: a.x + 220, y: a.y }); }
      else await send('e2eTeleport', { x: 300 + ((tries * 733) % 2400), y: 300 + ((tries * 457) % 1400) });
      await sleep(1500);
      const n = await mates();
      const near = n.o.filter((p) => Math.abs(p.x - n.me.x) < 360 + 200 && Math.abs(p.y - n.me.y) < 200 + 200).length;
      ok = n.alive && (scene === 'ally' ? n.o.some((p) => Math.abs(p.x - n.me.x) < 300 && Math.abs(p.y - n.me.y) < 160) : near === 0);
    }
    if (!ok) console.error(`${tag}: 場面が作れなかった（そのまま撮る）`);
    await page.evaluate(() => { document.getElementById('side2')!.classList.add('on'); }); await sleep(300);
    if (!(await mates()).alive) console.error(`${tag}: 止める時に自キャラが倒されていた`);
    await page.evaluate(() => (window as any).game.loop.sleep()); await sleep(200);
    await page.screenshot({ path: `${OUT}/${tag}_full.png` });
    info[tag] = await page.evaluate((T) => {
      const w = window as any, cr = w.game.canvas.getBoundingClientRect(), k = cr.width / 640, sc = w.game.scene.scenes.find((x: any) => x.visDrawn !== undefined), cam = sc.cameras.main, wv = cam.worldView;
      const hud: any[] = [];
      const sel = '#fx .bar, #fx .timer, #fx .tk, #fx .roster, #fx .me, #fx .buffs, #fx .kills, #fx .skill, #fx .tb, #fx .mm, #fx .cmsub, #fx .notes, #fx .fever';
      for (const e of document.querySelectorAll<HTMLElement>(sel)) {
        const cls = e.className.split(' ')[0];
        let r = e.getBoundingClientRect();
        if (cls === 'cmsub' && !r.width) { const t = e.textContent; e.textContent = 'ずんだもん、コツコツ徳を積んでいます'; r = e.getBoundingClientRect(); e.textContent = t; } // 字幕は出ている時の位置で
        if (!r.width || !r.height || getComputedStyle(e).display === 'none') continue;
        hud.push({ k: cls, x: r.left, y: r.top, w: r.width, h: r.height });
      }
      // ミニマップ（Phaser で描く絵）
      { const mb = sc.miniImg.getBounds(); hud.push({ k: 'minimap', x: cr.left + mb.x * k, y: cr.top + mb.y * k, w: mb.width * k, h: mb.height * k }); }
      // ゲーム画面の上に見えている DOM の表示すべて（名前・浮き字・お知らせなど。演出の層 .mfxl と、画面の半分より大きい入れ物は除く）
      for (const e of document.querySelectorAll<HTMLElement>('#fx *')) {
        if (e.closest('.mfxl')) continue;
        const cs = getComputedStyle(e), b0 = e.getBoundingClientRect();
        let x0 = b0.left, y0 = b0.top, x1 = b0.right, y1 = b0.bottom; // 親の overflow で切られた分は見えないので、見えている大きさにする
        for (let a = e.parentElement; a; a = a.parentElement) { const ac = getComputedStyle(a); if (ac.overflow !== 'visible' || ac.overflowX !== 'visible') { const ab = a.getBoundingClientRect(); x0 = Math.max(x0, ab.left); y0 = Math.max(y0, ab.top); x1 = Math.min(x1, ab.right); y1 = Math.min(y1, ab.bottom); } }
        const r = { left: x0, top: y0, right: x1, bottom: y1, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
        if (!r.width || !r.height || r.width * r.height > cr.width * cr.height * 0.5 || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
        if (r.right <= cr.left || r.left >= cr.right || r.bottom <= cr.top || r.top >= cr.bottom) continue;
        const ink = (e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) || e.tagName === 'IMG' || e.tagName === 'BUTTON' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0;
        if (ink) hud.push({ k: 'dom:' + (String(e.className).split(' ')[0] || e.tagName.toLowerCase()), x: r.left, y: r.top, w: r.width, h: r.height });
      }
      // 余白にある表示（立ち絵・枠のほかに何があるか）
      const margin: string[] = [];
      for (const e of document.querySelectorAll<HTMLElement>('body *')) { const r = e.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(e).visibility === 'hidden') continue; if (r.right <= cr.left || r.left >= cr.right) margin.push(`${e.tagName.toLowerCase()}#${e.id}.${String(e.className).split(' ')[0]}`); }
      const toCss = (p: any) => [cr.left + (p.x - wv.x) * cam.zoom * k, cr.top + (p.y - wv.y) * cam.zoom * k];
      const polys = (sc.visDrawn?.polys ?? []).map((pl: any[]) => pl.map(toCss));
      // 地図の外のタイル（0=外。霧の下で真っ暗に見える所）。画面に入る分だけ
      const outs: number[][] = [], tk: number[][] = sc.tileKinds;
      for (let ty = Math.floor(wv.y / T); ty * T < wv.bottom; ty++) for (let tx = Math.floor(wv.x / T); tx * T < wv.right; tx++) if ((tk[ty]?.[tx] ?? 0) === 0) { const [x, y] = toCss({ x: tx * T, y: ty * T }); outs.push([x, y, T * cam.zoom * k, T * cam.zoom * k]); }
      return { vw: innerWidth, vh: innerHeight, x: cr.left, y: cr.top, w: cr.width, h: cr.height, hud, polys, outs, margin: [...new Set(margin)] };
    }, C.TILE);
    await page.addStyleTag({ content: '#side,#side2{visibility:hidden!important}' });
    await page.screenshot({ path: `${OUT}/${tag}_base.png` });
    await page.addStyleTag({ content: 'html,body{background:transparent!important}body>*{visibility:hidden!important}#side,#side2,#side *,#side2 *{visibility:visible!important}' });
    await page.screenshot({ path: `${OUT}/${tag}_fg.png`, omitBackground: true });
    console.log(tag, ok, 'hud', info[tag].hud.length, 'polys', info[tag].polys.length, 'outs', info[tag].outs.length, 'margin', info[tag].margin.join(' '));
    await page.context().close();
  }
}
writeFileSync(`${OUT}/bg.json`, JSON.stringify(info));
await b.close(); srv.kill(); process.exit(0);
