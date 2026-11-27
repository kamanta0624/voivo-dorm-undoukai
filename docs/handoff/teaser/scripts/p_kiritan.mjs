// (i) きりたん全弾斉射: 練習でロックオン→斉射（BFS ルーティングで敵陣へ）
import { launch, joinPractice, snap, sleep, Mover, Watcher, navTo, setPractice, goTo } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const NAME = 'p_kiritan';
mkdirSync(`/tmp/teaser-videos/${NAME}`, { recursive: true });
const out = { name: NAME };
const { browser, context, page, t0, errors } = await launch(`/tmp/teaser-videos/${NAME}`);
out.errors = errors;
const watcher = new Watcher(page, t0).start(300);
const mover = new Mover(page);
const foeOf = (s) => s.players.find((p) => p.team !== s.me.team && !p.assist) || null;
try {
  await joinPractice(page, 'kiritan', 'metan');
  watcher.log('playing', {});
  const spOkK = await setPractice(page, { mode: 'bot' }); watcher.log('setPractice', { ok: spOkK });
  const deadline = Date.now() + 240000;
  let lastBeat = 0;
  while (Date.now() < deadline && !out.success) {
    const s = await snap(page); if (!s || !s.me) { await sleep(300); continue; }
    if (Date.now() - lastBeat > 10000) { watcher.log('beat', { x: s.me.x, y: s.me.y, foeVis: s.players.filter((p) => p.team !== s.me.team && !p.assist).length }); lastBeat = Date.now(); }
    const foe = foeOf(s);
    if (!foe) { await goTo(page, mover, 1900, 784, { timeoutMs: 40000, shouldStop: async () => { const s2 = await snap(page); return !!foeOf(s2); } }); continue; }
    const d = Math.hypot(foe.x - s.me.x, foe.y - s.me.y);
    if (d > 185) { await navTo(page, mover, (ss) => { const f = foeOf(ss); return f ? { x: f.x, y: f.y } : null; }, { stopDist: 150, timeoutMs: 8000 }); continue; }
    // 射程内: 1回目タップでロックオン
    watcher.log('lockStart', { d: Math.round(d), foe: foe.char });
    await page.keyboard.down('r'); await sleep(130); await page.keyboard.up('r');
    await sleep(1400);
    const s2 = await snap(page);
    watcher.log('lockState', { me: s2 && s2.me ? { lock: s2.me.lock, skillCd: s2.me.skillCd } : null, foe: foeOf(s2) });
    // 2回目タップで発射
    await page.keyboard.down('r'); await sleep(130); await page.keyboard.up('r');
    watcher.log('volleyFired', {});
    let maxShots = 0;
    for (let i = 0; i < 12; i++) { const s3 = await snap(page); if (s3) maxShots = Math.max(maxShots, s3.shots); await sleep(250); }
    watcher.log('volleyObserved', { maxShots });
    if (maxShots >= 4) out.success = true;
    else { watcher.log('retryVolley', {}); await sleep(6000); } // CT待ち
  }
  await sleep(2000);
} catch (e) { out.fatal = String(e && e.message || e); }
watcher.stop();
out.events = watcher.events;
await context.close();
out.video = await page.video().path().catch(() => null);
await browser.close();
writeFileSync(`/tmp/teaser-videos/${NAME}/result.json`, JSON.stringify(out, null, 2));
console.log('DONE', NAME, 'success=', !!out.success, 'fatal=', out.fatal || 'none');
