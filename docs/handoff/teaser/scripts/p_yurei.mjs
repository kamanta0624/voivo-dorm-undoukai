// (f) ユーレイ: 敵に悪行を貯めさせて指名手配→ジャッジメントで即死
import { launch, joinPractice, snap, sleep, Mover, Watcher, navTo, setPractice, goTo } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const NAME = 'p_yurei';
mkdirSync(`/tmp/teaser-videos/${NAME}`, { recursive: true });
const out = { name: NAME };
const { browser, context, page, t0, errors } = await launch(`/tmp/teaser-videos/${NAME}`);
out.errors = errors;
const watcher = new Watcher(page, t0).start(300);
const mover = new Mover(page);
const foeOf = (s) => s.players.find((p) => p.team !== s.me.team && !p.assist) || null;
try {
  await joinPractice(page, 'yurei', 'aru');
  watcher.log('playing', {});
  const spOk = await setPractice(page, { foe: 'aru', mode: 'bot' });
  watcher.log('setPractice', { ok: spOk });
  const deadline = Date.now() + 420000;
  let myKos = 0, lastAlive = true, shotDone = false;
  while (Date.now() < deadline && !shotDone) {
    const s = await snap(page); if (!s || !s.me) { await sleep(300); continue; }
    if (lastAlive && !s.me.alive) { myKos++; watcher.log('myKoCount', { n: myKos }); }
    lastAlive = s.me.alive;
    const foeTeam = 1 - s.me.team;
    const wantedId = s.teams[foeTeam] && s.teams[foeTeam].wanted;
    const foe = foeOf(s);
    if (wantedId && foe && foe.id === wantedId) {
      // 手配犯が視界内にいる: 距離を詰めてジャッジメント
      const d = Math.hypot(foe.x - s.me.x, foe.y - s.me.y);
      watcher.log('wantedInSight', { d: Math.round(d), foeBad: foe.bad, foeHp: foe.hp });
      if (d > 240) { await navTo(page, mover, (ss) => { const f = foeOf(ss); return f ? { x: f.x, y: f.y } : null; }, { stopDist: 210, timeoutMs: 6000 }); continue; }
      // 狙撃: 敵の画面位置へマウス
      const sx = Math.max(20, Math.min(1260, 640 + (foe.x - s.me.x) * 2));
      const sy = Math.max(20, Math.min(700, 360 + (foe.y - s.me.y) * 2));
      await page.mouse.move(sx, sy);
      await sleep(120);
      watcher.log('judgmentFire', { d: Math.round(d), sx: Math.round(sx), sy: Math.round(sy) });
      await page.keyboard.down('r'); await sleep(200); await page.keyboard.up('r');
      await sleep(1500);
      const s2 = await snap(page);
      const foe2 = foeOf(s2);
      watcher.log('afterShot', { foeAlive: foe2 ? foe2.alive : 'gone', foeHp: foe2 ? foe2.hp : null });
      if (!foe2 || !foe2.alive) { shotDone = true; out.success = true; }
      else await sleep(9000); // CT待ち（手配は維持される想定）
      continue;
    }
    if (wantedId && !foe) { // 手配済みだが視界外: 敵陣方面へ探しに行く
      await goTo(page, mover, 1900, 784, { timeoutMs: 40000, shouldStop: async () => { const s2 = await snap(page); return !!foeOf(s2); } });
      continue;
    }
    // まだ手配でない: 敵陣へ進んで交戦し、倒される（手配条件づくり）
    if (!foe) { await goTo(page, mover, 1830, 784, { timeoutMs: 40000, shouldStop: async () => { const s2 = await snap(page); return !!foeOf(s2); } }); continue; }
    const d = Math.hypot(foe.x - s.me.x, foe.y - s.me.y);
    if (d > 120) { await navTo(page, mover, (ss) => { const f = foeOf(ss); return f ? { x: f.x, y: f.y } : null; }, { stopDist: 90, timeoutMs: 5000 }); }
    else { await mover.stop(); await sleep(600); } // 殴られ続ける
  }
  await sleep(1500);
} catch (e) { out.fatal = String(e && e.message || e); }
watcher.stop();
out.events = watcher.events;
await context.close();
out.video = await page.video().path().catch(() => null);
await browser.close();
writeFileSync(`/tmp/teaser-videos/${NAME}/result.json`, JSON.stringify(out, null, 2));
console.log('DONE', NAME, 'success=', !!out.success, 'fatal=', out.fatal || 'none');
