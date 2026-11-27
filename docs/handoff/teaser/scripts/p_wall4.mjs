// (c) 壁破壊 v4: カメラ settle ルール適用 — 壁の手前で静止→settle→短距離で押し破って通過→静止
import { launch, joinPractice, snap, brokenAll, sleep, Mover, Watcher, settle } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const NAME = 'p_wall4';
mkdirSync(`/tmp/teaser-videos/${NAME}`, { recursive: true });
const out = { name: NAME };
const { browser, context, page, t0, errors } = await launch(`/tmp/teaser-videos/${NAME}`);
out.errors = errors;
const watcher = new Watcher(page, t0).start(300);
const mover = new Mover(page);
try {
  await joinPractice(page, 'hanamaru', 'metan');
  watcher.log('playing', {});
  // 壁 (x=1344) の少し手前 x≈1290 まで歩く
  for (let i = 0; i < 24; i++) {
    const s = await snap(page); if (!s || !s.me) break;
    if (Math.abs(s.me.x - 1290) < 20 && Math.abs(s.me.y - 784) < 20) break;
    const keys = [];
    if (s.me.x < 1270) keys.push('d'); else if (s.me.x > 1310) keys.push('a');
    if (s.me.y < 764) keys.push('s'); else if (s.me.y > 804) keys.push('w');
    if (!keys.length) break;
    await mover.set(keys); await sleep(200);
  }
  await settle(mover, 2600); // カメラを中央に落ち着かせる
  const s0 = await snap(page);
  watcher.log('settled', { me: s0 && s0.me });
  const b0 = (await brokenAll(page)).length;
  watcher.log('pushStart', {});
  await mover.set(['d']);
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const s = await snap(page); if (!s || !s.me) { await sleep(150); continue; }
    if (s.me.x > 1440) { out.success = true; watcher.log('passedThrough', { x: s.me.x }); break; }
    await sleep(150);
  }
  await settle(mover, 1600); // 抜けた先で静止してカメラを寄せる
  const b1 = await brokenAll(page);
  watcher.log('brokenTiles', { count: b1.length - b0, tiles: [...new Set(b1.slice(b0).map((e) => e.t.join(',')))] });
} catch (e) { out.fatal = String(e && e.message || e); }
watcher.stop();
out.events = watcher.events;
await context.close();
out.video = await page.video().path().catch(() => null);
await browser.close();
writeFileSync(`/tmp/teaser-videos/${NAME}/result.json`, JSON.stringify(out, null, 2));
console.log('DONE', NAME, 'success=', !!out.success, 'fatal=', out.fatal || 'none');
