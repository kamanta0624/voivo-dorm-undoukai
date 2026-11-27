// ティザー撮影ドライバ共通部: 起動（relay経由）・入室・スナップ監視・移動・技
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/home/hatch/work/voisq/package.json');
const { chromium } = require('playwright-core');

// マップタイル（BFS ルーティング用）。'#' のみ通行不可とする
const MAP = JSON.parse(readFileSync('/home/hatch/work/voisq/src/shared/map.json', 'utf8'));
const TILES = MAP.tiles, MW = TILES[0].length, MH = TILES.length, TS = 16;
const blocked = (tx, ty) => tx < 0 || ty < 0 || tx >= MW || ty >= MH || TILES[ty][tx] === '#';
function losClear(x0, y0, x1, y1) { // タイル単位の視線（壁をかすめる場合は不可寄り）
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4);
  for (let i = 0; i <= steps; i++) {
    const x = x0 + (x1 - x0) * (i / steps), y = y0 + (y1 - y0) * (i / steps);
    if (blocked(Math.floor(x / TS), Math.floor(y / TS))) return false;
  }
  return true;
}
// BFS で経路を作り、視線の通る範囲でウェイポイントを間引く
export function planRoute(fx, fy, tx, ty) {
  const sx = Math.floor(fx / TS), sy = Math.floor(fy / TS);
  let gx = Math.floor(tx / TS), gy = Math.floor(ty / TS);
  if (blocked(gx, gy)) { // 目標が壁内なら近くの空きタイルへ
    outer: for (let r = 1; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!blocked(gx + dx, gy + dy)) { gx += dx; gy += dy; break outer; }
  }
  const key = (x, y) => y * MW + x;
  const prev = new Map([[key(sx, sy), -1]]);
  const q = [[sx, sy]];
  while (q.length) {
    const [cx, cy] = q.shift();
    if (cx === gx && cy === gy) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (blocked(nx, ny) || prev.has(key(nx, ny))) continue;
      if (dx && dy && (blocked(cx + dx, cy) || blocked(cx, cy + dy))) continue; // 角を切らない
      prev.set(key(nx, ny), key(cx, cy)); q.push([nx, ny]);
    }
  }
  if (!prev.has(key(gx, gy))) return null;
  const cells = [];
  for (let k = key(gx, gy); k !== -1; k = prev.get(k)) cells.push([k % MW, Math.floor(k / MW)]);
  cells.reverse();
  const pts = cells.map(([cx, cy]) => ({ x: cx * TS + 8, y: cy * TS + 8 }));
  pts[pts.length - 1] = { x: tx, y: ty };
  const out = [];
  let anchor = { x: fx, y: fy };
  for (let i = 1; i < pts.length; i++) {
    if (!losClear(anchor.x, anchor.y, pts[i].x, pts[i].y)) { out.push(pts[i - 1]); anchor = pts[i - 1]; }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// 計画した経路を辿る。到達 / 中断 / 詰まり（再計画は呼び出し側）
export async function followRoute(page, mover, route, { timeoutMs = 90000, shouldStop = null, arriveDist = 30 } = {}) {
  const t0 = Date.now();
  let wi = 0, lastPos = null, lastMoveAt = Date.now();
  while (Date.now() - t0 < timeoutMs && wi < route.length) {
    if (shouldStop && (await shouldStop())) { await mover.stop(); return 'stopped'; }
    const s = await snapLite(page); if (!s || !s.me) { await sleep(100); continue; }
    if (lastPos && Math.hypot(s.me.x - lastPos.x, s.me.y - lastPos.y) > 5) lastMoveAt = Date.now();
    lastPos = { x: s.me.x, y: s.me.y };
    if (Date.now() - lastMoveAt > 3500) { await mover.stop(); return 'stuck'; }
    const wp = route[wi];
    const dx = wp.x - s.me.x, dy = wp.y - s.me.y, dist = Math.hypot(dx, dy);
    const isLast = wi === route.length - 1;
    if (dist <= (isLast ? arriveDist : 26)) { wi++; continue; }
    const keys = [];
    if (Math.abs(dx) > 10) keys.push(dx > 0 ? 'd' : 'a');
    if (Math.abs(dy) > 10) keys.push(dy > 0 ? 's' : 'w');
    await mover.set(keys.length ? keys : ['d']);
    await sleep(90);
  }
  await mover.stop();
  return wi >= route.length ? 'arrived' : 'timeout';
}

// 現在地から目標へ BFS 経路で移動（詰まったら1回だけ再計画）
export async function goTo(page, mover, tx, ty, opts = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await snapLite(page); if (!s || !s.me) return 'no-snap';
    const route = planRoute(s.me.x, s.me.y, tx, ty);
    if (!route) return 'no-route';
    const r = await followRoute(page, mover, route, opts);
    if (r !== 'stuck') return r;
  }
  return 'stuck';
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const URL = 'https://vv.club-daiman.com/';
export const CHROME = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell';

export async function launch(videoDir) {
  const t0 = Date.now();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], proxy: { server: 'http://127.0.0.1:18080' } });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'ja-JP',
    ignoreHTTPSErrors: true,
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // snap.broken は差分配列なので、setter を横取りして全破壊タイルを蓄積する
  await page.addInitScript(`
    window.__brokenAll = [];
    (() => { let v; Object.defineProperty(window, 'snap', {
      configurable: true,
      get() { return v; },
      set(nv) { v = nv; try { if (nv && Array.isArray(nv.broken)) for (const t of nv.broken) window.__brokenAll.push({ t, at: performance.now() }); } catch (e) {} },
    }); })();
  `);
  return { browser, context, page, t0, errors };
}

// カメラ settle: 静止して lerp 追随を落ち着かせる（低fps環境では追いつきに数秒かかる）
export async function settle(mover, ms = 2300) {
  await mover.stop();
  await sleep(ms);
}

// 蓄積された破壊タイル [{t:[x,y], at}] を取る
export async function brokenAll(page) {
  return page.evaluate(() => window.__brokenAll || []).catch(() => []);
}

// window.snap の要約を取る（失敗時は null）
export async function snap(page) {
  return withTimeout(page.evaluate(() => {
    const s = window.snap; if (!s) return null;
    const me = s.players.find((p) => p.id === s.me) || null;
    return {
      phase: s.phase, t: s.t, timeLeft: s.timeLeft, winner: s.winner, finale: !!s.finale, practice: !!s.practice, practiceMode: s.practice ? s.practice.mode : null, practiceFoe: s.practice ? s.practice.foe : null,
      me: me ? { id: me.id, char: me.char, team: me.team, x: Math.round(me.x), y: Math.round(me.y), hp: me.hp, maxHp: me.maxHp, alive: me.alive, ko: me.ko, respawnIn: me.respawnIn, skillCd: me.skillCd, bad: me.bad, tier: me.tier, ult: !!me.ult, assist: !!me.assist, ack: me.ack, lock: me.lock, face: me.face } : null,
      teams: (s.teams || []).map((t) => ({ toku: t.toku, wanted: t.wanted, reflect: t.reflect, bossHpRatio: t.bossHpRatio, chain: t.m ? t.m.chain : null, cur: t.m ? !!t.m.cur : null })),
      bosses: (s.bosses || []).map((b) => ({ team: b.team, x: Math.round(b.x), y: Math.round(b.y), hp: b.hp, base: b.base })),
      broken: (s.broken || []).length,
      brokenTiles: (s.broken || []).slice(-6),
      players: (s.players || []).map((p) => ({ id: p.id, team: p.team, char: p.char, bot: !!p.bot, assist: !!p.assist, alive: p.alive, hp: p.hp, x: Math.round(p.x), y: Math.round(p.y), bad: p.bad, ult: !!p.ult, tier: p.tier })),
      wanted: s.wanted || [],
      shots: (s.shots || []).length,
      shotKinds: (s.shots || []).map((sh) => sh.kind),
      ents: (s.ents || []).map((e) => ({ kind: e.kind, team: e.team })),
    };
  }).catch(() => null));
}

// イベント監視: 遷移を検出して events に {at(録画開始からの秒), type, data} を積む
export class Watcher {
  constructor(page, t0) { this.page = page; this.t0 = t0; this.events = []; this.prev = null; this.timer = null; }
  now() { return (Date.now() - this.t0) / 1000; }
  log(type, data) { this.events.push({ at: this.now(), type, data }); }
  start(intervalMs = 200) {
    this.timer = setInterval(async () => {
      const s = await snap(this.page); if (!s) return;
      const p = this.prev;
      if (p) {
        if (s.phase !== p.phase) this.log('phase', { from: p.phase, to: s.phase });
        s.bosses.forEach((b, i) => { const pb = p.bosses[i]; if (pb && b.base !== pb.base) this.log('bossBaseChange', { team: b.team, from: pb.base, to: b.base, hp: b.hp }); });
        if (s.broken > p.broken) this.log('wallBreak', { add: s.broken - p.broken, total: s.broken, tiles: s.brokenTiles });
        if (s.me && p.me) {
          if (p.me.alive && !s.me.alive) this.log('meKo', { char: s.me.char });
          if (!p.me.alive && s.me.alive) this.log('meRespawn', {});
          if (!p.me.ult && s.me.ult) this.log('meUlt', {});
        }
        const prevIds = new Map(p.players.map((q) => [q.id, q]));
        for (const q of s.players) {
          const pq = prevIds.get(q.id);
          if (!pq && q.assist) this.log('assistAppear', { team: q.team, char: q.char });
          if (pq && !pq.ult && q.ult) this.log('ultAppear', { team: q.team, char: q.char, me: s.me && q.id === s.me.id });
          if (pq && pq.alive && !q.alive) this.log('playerKo', { team: q.team, char: q.char, me: s.me && q.id === s.me.id });
        }
        s.teams.forEach((t, i) => { const pt = p.teams[i]; if (pt && t.wanted !== pt.wanted) this.log('wantedChange', { team: i, from: pt.wanted, to: t.wanted }); });
        if (!p.finale && s.finale) this.log('finale', { winner: s.winner });
      }
      this.prev = s;
    }, intervalMs);
    return this;
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}

// キーボード移動ヘルパ（押下中キーの差分管理）
export class Mover {
  constructor(page) { this.page = page; this.held = new Set(); }
  async set(keys) {
    for (const k of [...this.held]) if (!keys.includes(k)) { await this.page.keyboard.up(k); this.held.delete(k); }
    for (const k of keys) if (!this.held.has(k)) { await this.page.keyboard.down(k); this.held.add(k); }
  }
  async stop() { await this.set([]); }
}

// evaluate が稀に返らないことがあるので、タイムアウトで null を返すレースを噛ませる
export function withTimeout(promise, ms = 4000) {
  return Promise.race([promise, new Promise((res) => setTimeout(() => res(null), ms))]);
}

// 軽量スナップ（移動用: 自分と全員の位置だけ）
export async function snapLite(page) {
  return withTimeout(page.evaluate(() => {
    const s = window.snap; if (!s) return null;
    const me = s.players.find((p) => p.id === s.me) || null;
    return {
      phase: s.phase, t: s.t,
      me: me ? { id: me.id, team: me.team, x: Math.round(me.x), y: Math.round(me.y), hp: me.hp, alive: me.alive, char: me.char } : null,
      players: (s.players || []).map((p) => ({ id: p.id, team: p.team, char: p.char, assist: !!p.assist, alive: p.alive, x: Math.round(p.x), y: Math.round(p.y), hp: p.hp })),
      bosses: (s.bosses || []).map((b) => ({ team: b.team, x: Math.round(b.x), y: Math.round(b.y), hp: b.hp, base: b.base })),
    };
  }).catch(() => null));
}

// 目標座標へ貪欲に移動。距離の縮み具合で詰まりを判定する
export async function navTo(page, mover, getTarget, { stopDist = 40, timeoutMs = 60000, shouldStop = null } = {}) {
  const t0 = Date.now();
  let bestDist = Infinity, bestAt = Date.now(), escapeIdx = 0, escapeUntil = 0;
  const escapes = [['w'], ['d'], ['s'], ['a'], ['w', 'd'], ['s', 'd'], ['s', 'a'], ['w', 'a']];
  while (Date.now() - t0 < timeoutMs) {
    if (shouldStop && (await shouldStop())) { await mover.stop(); return 'stopped'; }
    const s = await snapLite(page); if (!s || !s.me) { await sleep(120); continue; }
    const tgt = await getTarget(s); if (!tgt) { await mover.stop(); return 'no-target'; }
    const dx = tgt.x - s.me.x, dy = tgt.y - s.me.y, dist = Math.hypot(dx, dy);
    if (dist <= stopDist) { await mover.stop(); return 'arrived'; }
    if (dist < bestDist - 8) { bestDist = dist; bestAt = Date.now(); }
    if (Date.now() < escapeUntil) { await sleep(100); continue; }
    if (Date.now() - bestAt > 2600) { // 距離が縮まない: 短く横へ逃がす
      await mover.set(escapes[escapeIdx % escapes.length]); escapeIdx++;
      escapeUntil = Date.now() + 480; bestAt = Date.now();
      await sleep(100); continue;
    }
    const keys = [];
    if (Math.abs(dx) > 14) keys.push(dx > 0 ? 'd' : 'a');
    if (Math.abs(dy) > 14) keys.push(dy > 0 ? 's' : 'w');
    await mover.set(keys.length ? keys : ['d']);
    await sleep(100);
  }
  await mover.stop();
  return 'timeout';
}

// 技: マウスで方角を示して R を押して離す。screenPt は viewport 座標
export async function skillAt(page, x, y, holdMs = 250) {
  await page.mouse.move(x, y);
  await sleep(60);
  await page.keyboard.down('r');
  await sleep(holdMs);
  await page.keyboard.up('r');
}
// 自分（画面中央）から見た世界方向へ技
export async function skillDir(page, dx, dy, holdMs = 250) {
  const l = Math.hypot(dx, dy) || 1;
  await skillAt(page, 640 + (dx / l) * 160, 360 + (dy / l) * 160, holdMs);
}

// タイトルのボタンはポーリング再描画で差し替わるため、入室できるまでクリックを繰り返す
async function clickUntilIn(page, selector) {
  for (let i = 0; i < 8; i++) {
    const inGame = await page.evaluate(() => typeof window.snap !== 'undefined' && !!window.snap).catch(() => false);
    if (inGame) return true;
    await page.click(selector, { timeout: 5000 }).catch(() => {});
    await sleep(2500);
  }
  return page.evaluate(() => typeof window.snap !== 'undefined' && !!window.snap).catch(() => false);
}

// ロビーの状態（selMode は #lobby の className に入る）
async function lobbyState(page) {
  return page.evaluate(() => {
    const l = document.querySelector('#lobby');
    return { cls: l ? l.className : '', phase: window.snap ? window.snap.phase : null, ttl: (document.querySelector('#lobby .ttl') || {}).textContent || '' };
  }).catch(() => ({ cls: '', phase: null, ttl: '' }));
}
async function jsClickCard(page, key) {
  await page.evaluate((k) => { const els = [...document.querySelectorAll(`.card[data-k="${k}"]`)]; const c = els[Math.floor(els.length / 2)] || els[0]; if (c) c.click(); }, key).catch(() => {});
}
async function jsClickOk(page) { await page.evaluate(() => { const b = document.getElementById('okbtn'); if (b) b.click(); }).catch(() => {}); }

// 1キャラ分: カードを押して confirm まで進め、OK を押す。until(st) が真になったら止める（段階の行き過ぎ防止）
export async function pickChar(page, key, { until = null } = {}) {
  for (let i = 0; i < 14; i++) {
    const st = await lobbyState(page);
    if (st.phase === 'playing' || st.phase === 'intro') return true;
    if (until && until(st)) return true;
    if (st.cls.includes('go')) return true;
    if (st.cls.includes('confirm') || st.cls.includes('sortie')) { await jsClickOk(page); await sleep(700); continue; }
    await jsClickCard(page, key); // browse: 1回で表示、同じキャラをもう1回で confirm
    await sleep(500);
  }
  const st = await lobbyState(page);
  return st.phase === 'playing' || st.phase === 'intro' || st.cls.includes('go') || (until ? until(st) : false);
}

// 練習パネルで相手キャラ・モードを試合中に設定し、snap で確認する
export async function setPractice(page, { foe = null, mode = null } = {}) {
  for (let i = 0; i < 6; i++) {
    const s = await snap(page);
    const foeOk = !foe || (s && s.practiceFoe === foe);
    const modeOk = !mode || (s && s.practiceMode === mode);
    if (foeOk && modeOk) return true;
    await page.evaluate(({ foe, mode }) => {
      if (foe) { const sel = document.querySelector('.pfoe'); if (sel && sel.value !== foe) { sel.value = foe; sel.dispatchEvent(new Event('change', { bubbles: true })); } }
      if (mode) { const b = document.querySelector(`.prp [data-mode="${mode}"]`); if (b) b.click(); }
    }, { foe, mode }).catch(() => {});
    await sleep(800);
  }
  const s = await snap(page);
  return (!foe || (s && s.practiceFoe === foe)) && (!mode || (s && s.practiceMode === mode));
}

// 練習に入る: 自分と相手のキャラを選んで playing まで
export async function joinPractice(page, myChar, foeChar) {
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('.practice', { timeout: 30000 });
  await sleep(1500);
  if (!(await clickUntilIn(page, '.practice'))) throw new Error('practice join failed');
  await page.waitForFunction(() => window.snap && window.snap.phase === 'waiting', null, { timeout: 30000 });
  await sleep(600);
  await pickChar(page, myChar, { until: (st) => st.ttl.includes('相手') }); // 自分: confirm→OK で相手選択へ
  await pickChar(page, foeChar); // 相手: confirm→OK→sortie→OK で開始
  await page.waitForFunction(() => window.snap && (window.snap.phase === 'playing' || window.snap.phase === 'intro'), null, { timeout: 60000 });
  await page.waitForFunction(() => window.snap && window.snap.phase === 'playing', null, { timeout: 60000 }).catch(() => {});
}

// 部屋1に入る（本戦）
export async function joinRoom(page, myChar) {
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#title .rooms .room:not([disabled])', { timeout: 30000 });
  await sleep(1500);
  if (!(await clickUntilIn(page, '#title .rooms .room[data-id]:not([disabled])'))) throw new Error('room join failed');
  await page.waitForFunction(() => window.snap && window.snap.phase === 'waiting', null, { timeout: 30000 });
  await sleep(600);
  await pickChar(page, myChar);
  await page.waitForFunction(() => window.snap && (window.snap.phase === 'playing' || window.snap.phase === 'intro'), null, { timeout: 120000 });
}
