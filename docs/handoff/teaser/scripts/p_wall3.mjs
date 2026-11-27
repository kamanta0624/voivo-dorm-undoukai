// (c) 壁破壊 v3: 花丸のパッシブ（壁に押し込む）で割って通り抜ける
import { launch, joinPractice, snap, brokenAll, sleep, Mover, Watcher } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const NAME = 'p_wall3';
mkdirSync(`/tmp/teaser-videos/${NAME}`, { recursive: true });
const out = { name: NAME };
const { browser, context, page, t0, errors } = await launch(`/tmp/teaser-videos/${NAME}`);
out.errors = errors;
const watcher = new Watcher(page, t0).start(300);
const mover = new Mover(page);
try {
  await joinPractice(page, 'hanamaru', 'metan');
  watcher.log('playing', {});
  const b0 = (await brokenAll(page)).length;
  // 東の壁 (x=1344) へまっすぐ押し込む。壁が割れたらそのまま東へ抜ける
  watcher.log('pushStart', {});
  await mover.set(['d']);
  const deadline = Date.now() + 25000;
  let lastLog = 0;
  while (Date.now() < deadline) {
    const s = await snap(page); if (!s || !s.me) { await sleep(200); continue; }
    if (Date.now() - lastLog > 2000) { watcher.log('pushing', { x: s.me.x, y: s.me.y, bad: s.me.bad }); lastLog = Date.now(); }
    if (s.me.x > 1440) { out.success = true; watcher.log('passedThrough', { x: s.me.x }); break; }
    await sleep(200);
  }
  await mover.stop();
  const b1 = await brokenAll(page);
  watcher.log('brokenTiles', { count: b1.length - b0, tiles: b1.slice(b0).map((e) => e.t) });
  await sleep(1500);
} catch (e) { out.fatal = String(e && e.message || e); }
watcher.stop();
out.events = watcher.events;
await context.close();
out.video = await page.video().path().catch(() => null);
await browser.close();
writeFileSync(`/tmp/teaser-videos/${NAME}/result.json`, JSON.stringify(out, null, 2));
console.log('DONE', NAME, 'success=', !!out.success, 'fatal=', out.fatal || 'none');
