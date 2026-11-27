// (i) きりたん全弾斉射 v5: 棒立ちの相手に settle→ロックオン→斉射。弾は ents(kind=missile) で数える
import { launch, joinPractice, snap, sleep, Mover, Watcher, navTo, setPractice, goTo, settle } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const NAME = 'p_kiritan2';
mkdirSync(`/tmp/teaser-videos/${NAME}`, { recursive: true });
const out = { name: NAME };
const { browser, context, page, t0, errors } = await launch(`/tmp/teaser-videos/${NAME}`);
out.errors = errors;
const watcher = new Watcher(page, t0).start(300);
const mover = new Mover(page);
const foeOf = (s) => s.players.find((p) => p.team !== s.me.team && !p.assist) || null;
// 生 snap から自分の st（lockon 等）と missile 数を読む
const rawState = () => page.evaluate(() => {
  const s = window.snap; if (!s) return null;
  const me = s.players.find((p) => p.id === s.me);
  return {
    lockon: me && me.st ? me.st.lockon || null : null,
    missiles: (s.ents || []).filter((e) => e.kind === 'missile').length,
  };
}).catch(() => null);
try {
  await joinPractice(page, 'kiritan', 'metan');
  watcher.log('playing', {});
  const spOk = await setPractice(page, { mode: 'stand' });
  watcher.log('setPractice', { ok: spOk });
  // 相手スポーン (1928,784) の 170px 西で停止
  await goTo(page, mover, 1758, 784, { timeoutMs: 40000 });
  await settle(mover, 2400);
  watcher.log('settled', {});
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline && !out.success) {
    const s = await snap(page); if (!s || !s.me) { await sleep(300); continue; }
    const foe = foeOf(s);
    if (!foe) { await goTo(page, mover, 1758, 784, { timeoutMs: 20000 }); await settle(mover, 1500); continue; }
    const d = Math.hypot(foe.x - s.me.x, foe.y - s.me.y);
    watcher.log('inPosition', { d: Math.round(d), foe: foe.char, foePos: [foe.x, foe.y], mePos: [s.me.x, s.me.y] });
    if (d > 195) { await navTo(page, mover, (ss) => { const f = foeOf(ss); return f ? { x: f.x, y: f.y } : null; }, { stopDist: 160, timeoutMs: 6000 }); await settle(mover, 1200); continue; }
    // ロック開始
    await page.keyboard.down('r'); await sleep(130); await page.keyboard.up('r');
    await sleep(900);
    const rs = await rawState();
    watcher.log('lockCheck', { lockon: rs && rs.lockon });
    if (!rs || !rs.lockon || !rs.lockon.marks || rs.lockon.marks.length < 1) {
      watcher.log('lockFailed', {});
      await sleep(8000); // CT（時間切れ含む）待ち
      continue;
    }
    // 発射
    watcher.log('volleyFired', { marks: rs.lockon.marks.length });
    await page.keyboard.down('r'); await sleep(130); await page.keyboard.up('r');
    let maxM = 0;
    for (let i = 0; i < 16; i++) { const r2 = await rawState(); if (r2) maxM = Math.max(maxM, r2.missiles); await sleep(200); }
    watcher.log('volleyObserved', { maxMissiles: maxM });
    if (maxM >= 6) out.success = true;
    else await sleep(8000);
  }
  await sleep(1200);
} catch (e) { out.fatal = String(e && e.message || e); }
watcher.stop();
out.events = watcher.events;
await context.close();
out.video = await page.video().path().catch(() => null);
await browser.close();
writeFileSync(`/tmp/teaser-videos/${NAME}/result.json`, JSON.stringify(out, null, 2));
console.log('DONE', NAME, 'success=', !!out.success, 'fatal=', out.fatal || 'none');
