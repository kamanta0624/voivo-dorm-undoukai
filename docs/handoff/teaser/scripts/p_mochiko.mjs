// (h) もち子ファンネル: 練習で展開→囲んで射撃
import { launch, joinPractice, snap, sleep, Mover, Watcher, navTo, setPractice, goTo } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const NAME = 'p_mochiko';
mkdirSync(`/tmp/teaser-videos/${NAME}`, { recursive: true });
const out = { name: NAME };
const { browser, context, page, t0, errors } = await launch(`/tmp/teaser-videos/${NAME}`);
out.errors = errors;
const watcher = new Watcher(page, t0).start(300);
const mover = new Mover(page);
const foeOf = (s) => s.players.find((p) => p.team !== s.me.team && !p.assist) || null;
try {
  await joinPractice(page, 'mochiko', 'metan');
  watcher.log('playing', {});
  const spOkM = await setPractice(page, { mode: 'bot' }); watcher.log('setPractice', { ok: spOkM });
  const deadline = Date.now() + 240000;
  let deployed = false;
  while (Date.now() < deadline && !deployed) {
    const s = await snap(page); if (!s || !s.me) { await sleep(300); continue; }
    const foe = foeOf(s);
    if (!foe) { await goTo(page, mover, 1900, 784, { timeoutMs: 40000, shouldStop: async () => { const s2 = await snap(page); return !!foeOf(s2); } }); continue; }
    const d = Math.hypot(foe.x - s.me.x, foe.y - s.me.y);
    if (d > 210) { await navTo(page, mover, (ss) => { const f = foeOf(ss); return f ? { x: f.x, y: f.y } : null; }, { stopDist: 170, timeoutMs: 8000 }); continue; }
    watcher.log('deploy', { d: Math.round(d), entsBefore: s.ents });
    await page.keyboard.down('r'); await sleep(150); await page.keyboard.up('r');
    await sleep(1200);
    const s2 = await snap(page);
    watcher.log('afterDeploy', { ents: s2.ents, skillCd: s2.me.skillCd });
    if (s2.ents.length > 0 || s2.me.skillCd > 3) {
      deployed = true; out.success = true;
      // 12秒間、敵の近くに留まってファンネルの射撃を撮る
      const until = Date.now() + 12000;
      while (Date.now() < until) {
        const s3 = await snap(page); if (!s3) break;
        watcher.log('funnelWatch', { ents: s3.ents.length, shots: s3.shots, foeHp: foeOf(s3) ? foeOf(s3).hp : null });
        await navTo(page, mover, (ss) => { const f = foeOf(ss); return f ? { x: f.x, y: f.y } : null; }, { stopDist: 150, timeoutMs: 1500 });
      }
    } else await sleep(3000);
  }
} catch (e) { out.fatal = String(e && e.message || e); }
watcher.stop();
out.events = watcher.events;
await context.close();
out.video = await page.video().path().catch(() => null);
await browser.close();
writeFileSync(`/tmp/teaser-videos/${NAME}/result.json`, JSON.stringify(out, null, 2));
console.log('DONE', NAME, 'success=', !!out.success, 'fatal=', out.fatal || 'none');
