// GAME_PORT=2672 CLIENT_PORT=5272 node --import tsx verify/netmeasure_browser.ts [perf]
// E2E_HOOKS=1 の開発サーバー専用。既存の検証用APIと実キー入力を使用。
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { launch, OUT, sleep } from './lib';
const browser = await launch();
const deadline = setTimeout(() => { void browser.close(); }, 45000);
const PORT = Number(process.env.CLIENT_PORT) || 5272, GAME = Number(process.env.GAME_PORT) || 2672;
const perfOnly = process.argv.includes('perf');
const roomId = `measure-${Date.now()}`;
const pages = [];
try {
  for (let i = 0; i < 2; i++) {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
    await page.addInitScript('window.__name = (fn) => fn'); // tsx の関数名保持ヘルパー
    page.on('pageerror', (e) => { throw e; });
    if (!perfOnly) await page.routeWebSocket(new RegExp(`:${GAME}/`), (ws) => {
      const server = ws.connectToServer();
      const pipe = () => { let last = 0; return (f: () => void) => { const at = Math.max(last, Date.now() + 50); last = at; setTimeout(f, at - Date.now()); }; };
      const up = pipe(), down = pipe(); ws.onMessage((m) => up(() => server.send(m))); server.onMessage((m) => down(() => ws.send(m)));
    });
    await page.goto(`http://localhost:${PORT}/?e2e=${roomId}&perf=1`);
    await page.waitForFunction(() => (window as any).snap);
    pages.push(page); console.log('connected', i);
  }
  const [a, b] = pages;
  const send = async (page: typeof a, type: string, data = {}) => page.evaluate(([type, data]) => (window as any).room.send(type, data), [type, data] as const);
  await send(a, 'e2eBossGuard', { on: true }); await send(a, 'e2eSlotMiss', { on: true });
  await send(a, 'e2eNoAuto', { on: true }); await send(b, 'e2eNoAuto', { on: true });
  await send(a, 'go', { char: 'aru' }); await send(b, 'go', { char: 'ierutan' }); await sleep(200);
  await send(a, 'e2eSkipIntro');
  await a.waitForFunction(() => (window as any).snap.phase === 'playing');
  await send(a, 'e2eTeleport', { x: 1450, y: 900 }); await send(b, 'e2eTeleport', { x: 1490, y: 900 });
  await sleep(1000); console.log('positioned');
  if (perfOnly) {
    for (const page of pages) await page.evaluate(() => { const scene = (window as any).game.scene.scenes.find((s: any) => s.perf); Object.assign(scene.perf, { n: 0, ray: 0, rayMax: 0, frame: 0, frameMax: 0 }); });
    await sleep(15000);
    const result = await Promise.all(pages.map((page) => page.evaluate(() => { const w = window as any; return { enabled: !!w.snap.netMeasure, ...w.perf, average: w.perf.frame / w.perf.n }; })));
    writeFileSync(`${OUT}/perf.json`, JSON.stringify(result, null, 2)); console.log('PERF', JSON.stringify(result), OUT);
  } else {
    const target = await b.evaluate(() => (window as any).snap.me);
    await send(b, 'e2eChar', { char: 'ierutan' }); await send(b, 'e2eReady');
    await send(b, 'skill');
    await b.waitForFunction(() => (window as any).snap.players.find((p: any) => p.id === (window as any).snap.me)?.st.upgrade, null, { timeout: 4000 });
    await send(b, 'e2eChar', { char: 'metan' }); // アップグレードを保ち、低HPの大ヒット演出で汗が隠れない相手にする
    await b.waitForFunction(() => (window as any).snap.players.find((p: any) => p.id === (window as any).snap.me)?.char === 'metan');
    assert.ok(await b.evaluate(() => (window as any).snap.players.find((p: any) => p.id === (window as any).snap.me).st.upgrade));
    // 両画面で、動いている対象の汗が実際の描画位置と一致したフレームを止めて撮影。
    const watches = pages.map((page) => page.evaluate((id) => new Promise<any>((resolve, reject) => {
      const w = window as any, start = performance.now(); let previousX: number | null = null;
      const check = () => {
        const scene = w.game.scene.scenes.find((s: any) => s.sweatFx);
        const f = scene?.sweatFx.find((f: any) => f.target === `p:${id}`);
        const p = w.snap.players.find((p: any) => p.id === id), unit = scene?.units.get(id)?.s;
        const moved = unit && previousX !== null && Math.abs(unit.x - previousX) > .1; previousX = unit?.x ?? null;
        if (f && unit && moved && p?.st.upgrade && scene.time.now - f.born >= 100 && performance.now() - start > 300) {
          const result = { self: w.snap.me === id, target: id, speed: p.spd, moving: moved, targetX: unit.x, targetY: unit.y, serverX: p.x, sweatX: f.sp.x, sweatY: f.sp.y, alpha: f.sp.alpha };
          w.game.loop.sleep(); resolve(result); return;
        }
        if (performance.now() - start > 12000) { reject(new Error('アップグレード中の対象に汗が出なかった')); return; }
        requestAnimationFrame(check);
      }; requestAnimationFrame(check);
    }), target));
    await a.keyboard.down('d'); await b.keyboard.down('d'); await sleep(250); await send(a, 'e2eNoAuto', { on: false });
    const evidence = await Promise.all(watches);
    for (let i = 0; i < pages.length; i++) {
      assert.ok(Math.abs(evidence[i].sweatX - evidence[i].targetX - 9) < .01);
      assert.ok(evidence[i].sweatY - evidence[i].targetY >= -30.1 && evidence[i].sweatY - evidence[i].targetY <= -21.9);
      await pages[i].screenshot({ path: `${OUT}/${i ? 'victim' : 'attacker'}.png` });
      await pages[i].keyboard.up('d');
    }
    writeFileSync(`${OUT}/sweat.json`, JSON.stringify(evidence, null, 2)); console.log('SWEAT', JSON.stringify(evidence), OUT);
    for (const page of pages) await page.evaluate(() => (window as any).game.loop.wake());
    await send(a, 'e2eNoAuto', { on: true });
    await send(b, 'e2eKill'); await sleep(150);
    await b.waitForFunction(() => !(window as any).snap.players.find((p: any) => p.id === (window as any).snap.me).alive);
    await b.waitForFunction((id) => !(window as any).game.scene.scenes.find((s: any) => s.sweatFx).sweatFx.some((f: any) => f.target === `p:${id}`), target, { timeout: 3000 });
    assert.equal(await b.evaluate((id) => (window as any).game.scene.scenes.find((s: any) => s.sweatFx).sweatFx.some((f: any) => f.target === `p:${id}`), target), false);
    console.log('PASS sweat death suppression');
  }
  await send(a, 'e2eTimeLeft', { sec: 0 }); await sleep(3000);
  for (const page of pages) {
    const report = await page.evaluate(() => { const s = (window as any).game.scene.scenes.find((s: any) => s.sweatFx); return { sent: s.measureSent, report: s.measure?.report(), enabled: !!(window as any).snap.netMeasure }; });
    if (report.enabled) { assert.equal(report.sent, true); assert.ok(report.report.rtt.n > 0); }
  }
} finally { clearTimeout(deadline); await browser.close(); }
console.log('ALL PASS browser', OUT);
