// (g) そら ソーラーキャノン: 練習で相手を棒立ちにし、294秒超チャージ→東へ照射
import { launch, joinPractice, snap, sleep, Mover, Watcher, setPractice } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const NAME = 'p_sora';
mkdirSync(`/tmp/teaser-videos/${NAME}`, { recursive: true });
const out = { name: NAME };
const { browser, context, page, t0, errors } = await launch(`/tmp/teaser-videos/${NAME}`);
out.errors = errors;
const watcher = new Watcher(page, t0).start(500);
const mover = new Mover(page);
try {
  await joinPractice(page, 'sora', 'metan');
  watcher.log('playing', {});
  const spOk = await setPractice(page, { mode: 'stand' });
  watcher.log('setPracticeStand', { ok: spOk });
  // 東を向く（face を東に）
  await mover.set(['d']); await sleep(350); await mover.stop();
  // チャージ待ち: snap.t が 297 を超えるまで待つ（自分は死なない＝チャージ維持）
  const deadline = Date.now() + 420000;
  let fired = false;
  while (Date.now() < deadline) {
    const s = await snap(page); if (!s || !s.me) { await sleep(1000); continue; }
    if (s.t >= 297) {
      watcher.log('firing', { t: s.t, ack: s.me.ack, brokenBefore: s.broken, me: { x: s.me.x, y: s.me.y, face: s.me.face } });
      await page.mouse.move(940, 360);
      await page.keyboard.down('r'); await sleep(200); await page.keyboard.up('r');
      await sleep(8000); // delay + 照射5秒 + 余韻
      const s2 = await snap(page);
      watcher.log('afterBeam', { broken: s2.broken, players: s2.players });
      out.success = s2.broken > s.broken;
      fired = true;
      break;
    }
    if (!s.me.alive) watcher.log('unexpectedDeath', { t: s.t });
    await sleep(2000);
  }
  out.fired = fired;
} catch (e) { out.fatal = String(e && e.message || e); }
watcher.stop();
out.events = watcher.events;
await context.close();
out.video = await page.video().path().catch(() => null);
await browser.close();
writeFileSync(`/tmp/teaser-videos/${NAME}/result.json`, JSON.stringify(out, null, 2));
console.log('DONE', NAME, 'success=', !!out.success, 'fired=', !!out.fired, 'fatal=', out.fatal || 'none');
