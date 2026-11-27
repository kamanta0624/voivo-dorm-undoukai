// 本戦（部屋1・4v4想定）: (a) 選択→出撃 (b) スロット (d) 決着 (e) 第2形態 (j) 復帰 を狙う
// 使い方: node r_match.mjs <名前> <キャラ> [最大秒]
import { launch, joinRoom, snap, snapLite, sleep, Mover, Watcher, goTo, navTo } from './lib.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const NAME = process.argv[2] || 'r_match1';
const CHAR = process.argv[3] || 'aru';
const MAXS = Number(process.argv[4] || 500);
mkdirSync(`/tmp/teaser-videos/${NAME}`, { recursive: true });
const out = { name: NAME, needs: { slotWinMine: false, slotWinEnemy: false, bossForm2: false, victory: false, defeat: false, koRespawn: false } };
const { browser, context, page, t0, errors } = await launch(`/tmp/teaser-videos/${NAME}`);
out.errors = errors;
const watcher = new Watcher(page, t0, (type, data) => {
  if ((type === 'ultAppear' || type === 'assistAppear')) { if (data.team === 0) out.needs.slotWinMine = true; else out.needs.slotWinEnemy = true; }
  if (type === 'bossBaseChange' && data.team === 1) out.needs.bossForm2 = true;
  if (type === 'finale') { if (data.winner === 0) out.needs.victory = true; else if (data.winner === 1) out.needs.defeat = true; }
  if (type === 'meRespawn' && out._wasKo) { out.needs.koRespawn = true; }
  if (type === 'meKo') out._wasKo = true;
}).start(300);
const mover = new Mover(page);

// 敵陣の大将候補部屋の中心（巡回用）
const MAP = JSON.parse(readFileSync('/home/hatch/work/voisq/src/shared/map.json', 'utf8'));
const CAND = ['bath', 'library', 'kitchen', 'svcA', 'svcB', 'svcC'];
const patrol = MAP.rooms.filter((r) => r.id.endsWith('_R') && CAND.includes(r.id.split('_')[0]))
  .map((r) => ({ name: r.id, x: Math.round((r.rect[0] + r.rect[2]) / 2 * 16), y: Math.round((r.rect[1] + r.rect[3]) / 2 * 16) }));
patrol.push({ name: 'dining_R', x: 1928, y: 784 });

try {
  await joinRoom(page, CHAR);
  watcher.log('matchStart', {});
  const myTeam = 0, foeTeam = 1;
  let lastBossPos = null, lastBossSeenAt = 0, patrolIdx = 0, endedAt = 0;
  const deadline = Date.now() + MAXS * 1000;
  while (Date.now() < deadline) {
    const s = await snapLite(page);
    if (!s) { await sleep(400); continue; }
    if (s.phase === 'ended') { if (!endedAt) { endedAt = Date.now(); watcher.log('ended', {}); } if (Date.now() - endedAt > 6000) break; await sleep(600); continue; }
    if (s.phase !== 'playing' && s.phase !== 'finale') { await sleep(400); continue; }
    if (s.phase === 'finale') { await mover.stop(); await sleep(800); continue; }
    const boss = s.bosses.find((b) => b.team === foeTeam);
    const bossVisible = boss && s.me && Math.hypot(boss.x - s.me.x, boss.y - s.me.y) < 290;
    if (boss && bossVisible) { lastBossPos = { x: boss.x, y: boss.y }; lastBossSeenAt = Date.now(); }
    if (!s.me || !s.me.alive) { await mover.stop(); await sleep(600); continue; }
    if (bossVisible) {
      const d = Math.hypot(boss.x - s.me.x, boss.y - s.me.y);
      if (d > 120) await navTo(page, mover, (s2) => { const b = s2.bosses.find((bb) => bb.team === foeTeam); return b ? { x: b.x, y: b.y } : null; }, { stopDist: 95, timeoutMs: 5000 });
      else { await mover.stop(); await sleep(500); } // 近距離で通常攻撃に任せる
      continue;
    }
    // 大将が見えない: 最後に見た位置→候補部屋を巡回
    const target = (Date.now() - lastBossSeenAt < 20000 && lastBossPos) ? lastBossPos : patrol[patrolIdx % patrol.length];
    if (!(Date.now() - lastBossSeenAt < 20000 && lastBossPos)) patrolIdx++;
    watcher.log('seekBoss', { target });
    await goTo(page, mover, target.x, target.y, { timeoutMs: 45000, shouldStop: async () => { const s2 = await snapLite(page); const b = s2 && s2.bosses.find((bb) => bb.team === foeTeam); return !!(b && s2.me && Math.hypot(b.x - s2.me.x, b.y - s2.me.y) < 290); } });
  }
} catch (e) { out.fatal = String(e && e.message || e); }
watcher.stop();
delete out._wasKo;
out.events = watcher.events;
await context.close();
out.video = await page.video().path().catch(() => null);
await browser.close();
writeFileSync(`/tmp/teaser-videos/${NAME}/result.json`, JSON.stringify(out, null, 2));
console.log('DONE', NAME, JSON.stringify(out.needs), 'fatal=', out.fatal || 'none');
