// 記録・再生（refac3 で作成）: クライアントの切り出し・描画の変更の前後で、同じ場面が同じに描かれるかを比べる
// record: 本物のサーバーにつなぎ、サーバーから届いたフレームを「何コマ目に渡したか」と一緒に記録（時計は固定してコマ送り、乱数も固定）
// replay: 記録したフレームを同じコマに渡して再生し、決めたコマでスクショと WebGL の呼び出し数を取る（サーバーにはつながない）
// 実行: npx tsx verify/replay.ts record <out.json> | replay <rec.json> <outDir> <pc|mobile>（E2E_HOOKS の開発版を GAME_PORT・CLIENT_PORT で起動しておく。記録は変える前に1回、再生を前後で流してスクショ・呼び出し数を比べる。通信の形式が変わったら記録し直す）
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const GAME_PORT = Number(process.env.GAME_PORT ?? 2611), CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 5211);
const [mode, file, outDir, vp] = process.argv.slice(2);
const FRAME = 1000 / 60;
type Frame = { step: number; b64: string; bin: boolean };
type Act = { step: number; kind: string; arg?: any };
type Http = { key: string; status: number; headers: Record<string, string>; b64: string };
const rec: { frames: Frame[]; acts: Act[]; http: Http[]; end: number; url?: string } = mode === 'replay' ? JSON.parse(readFileSync(file, 'utf8')) : { frames: [], acts: [], http: [], end: 0 };

const INIT = `(() => {
  let seed = 12345; Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__wsN = 0; const O = window.WebSocket;
  window.WebSocket = class extends O { constructor(...a) { super(...a); this.addEventListener('message', () => { window.__wsN++; }); } };
  window.__wsM = 0; const D = EventTarget.prototype.dispatchEvent; EventTarget.prototype.dispatchEvent = function (e) { const r = D.call(this, e); if (e.type === 'message' && typeof this.send === 'function' && 'binaryType' in this && String(this.url).includes(':' + GP + '/')) window.__wsM++; return r; };
  window.__gl = { draw: 0, bytes: 0 };
  const wrap = (P) => { if (!P) return; for (const k of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) { const f = P[k]; if (f) P[k] = function (...a) { window.__gl.draw++; return f.apply(this, a); }; }
    for (const k of ['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D']) { const f = P[k]; if (f) P[k] = function (...a) { for (const x of a) { if (x && typeof x.byteLength === 'number') window.__gl.bytes += x.byteLength; else if (x && x.width && x.height) window.__gl.bytes += x.width * x.height * 4; } return f.apply(this, a); }; } };
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype); wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
})();`;

const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await b.newContext(vp === 'mobile' ? { viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.addInitScript(INIT.replace('GP', String(GAME_PORT)));
await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
page.on('pageerror', (e) => console.log('pageerror', e.message));
if (process.env.DEBUG) page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)));

let pending = 0, touched = false;
page.on('request', () => { pending++; touched = true; });
page.on('requestfinished', () => { pending--; });
page.on('requestfailed', () => { pending--; });

// ゲームサーバーへの http（matchmake・status）
const httpQ = new Map<string, Http[]>();
for (const h of rec.http) { if (!httpQ.has(h.key)) httpQ.set(h.key, []); httpQ.get(h.key)!.push(h); }
await page.route(new RegExp(`//localhost:(${GAME_PORT}/|${CLIENT_PORT}/status)`), async (route) => {
  const u = new URL(route.request().url()), key = `${route.request().method()} ${u.pathname}`;
  if (mode !== 'replay') {
    const r = await route.fetch(); const body = await r.body();
    rec.http.push({ key, status: r.status(), headers: r.headers(), b64: body.toString('base64') });
    await route.fulfill({ status: r.status(), headers: r.headers(), body });
  } else {
    const h = httpQ.get(key)?.shift();
    if (!h) { console.log('http なし', key); await route.abort(); return; }
    await route.fulfill({ status: h.status, headers: h.headers, body: Buffer.from(h.b64, 'base64') });
  }
});

// ゲームサーバーの WebSocket
let ws: any = null; const queue: (string | Buffer)[] = [];
await page.routeWebSocket(new RegExp(`:${GAME_PORT}/`), (w) => {
  ws = w; if (process.env.DEBUG) { console.log('ws open', w.url()); w.onClose((c: any, r: any) => console.log('ws close', c, r)); }
  if (mode !== 'replay') { const s = w.connectToServer(); w.onMessage((m) => s.send(m)); s.onMessage((m) => queue.push(m)); }
  else w.onMessage(() => {});
});

let step = 0, delivered = 0; const t0 = Date.now();
const byStep = new Map<number, Frame[]>();
for (const f of rec.frames) { if (!byStep.has(f.step)) byStep.set(f.step, []); byStep.get(f.step)!.push(f); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function tick() {
  if (mode !== 'replay') { while (queue.length) { const m = queue.shift()!; rec.frames.push({ step, b64: Buffer.from(m as any).toString('base64'), bin: typeof m !== 'string' }); ws.send(m); delivered++; } }
  else for (const f of byStep.get(step) ?? []) { for (let i = 0; !ws && i < 500; i++) await sleep(20); if (!ws) { console.log('ws なし', step); process.exit(1); } ws.send(f.bin ? Buffer.from(f.b64, 'base64') : Buffer.from(f.b64, 'base64').toString()); delivered++; }
  if (delivered) for (let i = 0; i < 2000 && (await page.evaluate((m) => (window as any)[m], mode !== 'replay' ? '__wsN' : '__wsM')) < delivered; i++) await sleep(2);
  for (let i = 0; pending > 0 && i < 400; i++) await sleep(10);
  if (touched) { touched = false; await sleep(250); for (let i = 0; pending > 0 && i < 400; i++) await sleep(10); }
  for (let i = 0; i < 500 && (await page.evaluate(() => { const g = (window as any).game; return document.fonts.status === 'loading' || (!!g && (!g.isRunning || g.scene.scenes.some((x: any) => x.load?.isLoading?.() || (x.load && x.load.inflight?.size > 0)))); })); i++) await sleep(20); // 素材の読み込み中は時計を進めない
  if (mode !== 'replay') { const lag = t0 + step * FRAME - Date.now(); if (lag > 0) await sleep(lag); } // 記録は実時間に合わせる（サーバーは実時間で進む）
  await page.clock.runFor(FRAME);
  step++;
}
async function act(kind: string, arg?: any) {
  if (mode !== 'replay') rec.acts.push({ step, kind, arg });
  if (kind === 'click') await page.click(arg, { timeout: 5000, noWaitAfter: true } as any).catch((e) => console.log('click', arg, e.message.split('\n')[0]));
  else if (kind === 'down') await page.keyboard.down(arg);
  else if (kind === 'up') await page.keyboard.up(arg);
  else if (kind === 'send') await page.evaluate(([t, m]) => (window as any).room?.send(t, m), arg);
}
const snap = () => page.evaluate(() => { const s = (window as any).snap; if (!s) return null; const me = s.players?.find((p: any) => p.id === s.me); return { phase: s.phase, me: me && { alive: me.alive, team: me.team, ult: !!me.ult } }; });
async function shotAt(name: string) {
  if (mode !== 'replay') return;
  await page.screenshot({ path: `${outDir}/${String(step).padStart(5, '0')}_${name}.png`, animations: 'disabled', caret: 'hide' });
  const gl = await page.evaluate(() => (window as any).__gl);
  writeFileSync(`${outDir}/gl.txt`, `${step} ${name} draw=${gl.draw} bytes=${gl.bytes}\n`, { flag: 'a' });
}

if (mode === 'replay') {
  mkdirSync(outDir, { recursive: true }); writeFileSync(`${outDir}/gl.txt`, '');
  const acts = new Map<number, Act[]>(); for (const a of rec.acts) { if (!acts.has(a.step)) acts.set(a.step, []); acts.get(a.step)!.push(a); }
  const shots = new Set(rec.acts.filter((a) => a.kind === 'shot').map((a) => a.step));
  await page.goto(rec.url ?? `http://localhost:${CLIENT_PORT}/?e2e=replay`, { waitUntil: 'load' }); await sleep(3000); // 時計を止めたまま、読み込みと Phaser の起動（rAF 前まで）を落ち着かせる
  const MAX = Number(process.env.MAXSTEP ?? rec.end), T0 = Date.now();
  while (step <= Math.min(rec.end, MAX)) {
    if (process.env.DEBUG && step % 10 === 0) console.log('step', step, Date.now() - T0, 'pending', pending, 'ws', delivered, await page.evaluate(() => [(window as any).__wsN, (window as any).__wsM]));
    for (const a of acts.get(step) ?? []) { if (a.kind === 'shot') await shotAt(a.arg); else await act(a.kind, a.arg); }
    if (step % 30 === 0 && !shots.has(step)) await shotAt('t');
    await tick();
  }
} else if (mode === 'record2') {
  rec.url = `http://localhost:${CLIENT_PORT}/`;
  await page.goto(rec.url, { waitUntil: 'load' }); await sleep(3000);
  const until = async (f: (s: any) => boolean, max: number) => { for (let i = 0; i < max; i++) { const s = await snap(); if (s && f(s)) return true; await tick(); } return false; };
  const run = async (n: number) => { for (let i = 0; i < n; i++) await tick(); };
  const shot = async (name: string) => { rec.acts.push({ step, kind: 'shot', arg: name }); console.log(step, name, JSON.stringify(await snap())); };
  await run(60); await shot('title');
  await act('click', '.room.practice');
  await until((s) => s.phase === 'waiting', 3000); await run(60); await shot('p_select');
  await act('click', '.card[data-k="aru"]'); await run(20); await act('click', '#okbtn'); await run(10); await act('click', '#okbtn');
  await until((s) => s.phase === 'playing', 1200); await run(60); await shot('p_play');
  await act('send', ['pr', { op: 'mode', mode: 'stand' }]); await run(30);
  for (let k = 0; k < 3; k++) { await act('send', ['pr', { op: 'power', who: 'me', d: 1 }]); await run(60); }
  await shot('p_power');
  await act('send', ['e2eReveal', { on: true }]); await run(10);
  for (let i = 0; i < 300 && !(await page.evaluate(() => (window as any).snap?.players?.some((p: any) => p.id === 'foe'))); i++) await tick();
  const foe = await page.evaluate(() => { const s = (window as any).snap; const f = s.players.find((p: any) => p.id === 'foe'); return f && { x: f.x, y: f.y }; });
  console.log('foe', foe, await page.evaluate(() => { const s = (window as any).snap; return [s.reveal, s.players.map((p: any) => p.id), typeof (window as any).room]; }));
  if (foe) await act('send', ['e2eTeleport', { x: foe.x - 30, y: foe.y }]);
  await run(60); await shot('p_near');
  let dead = false; const fs = () => page.evaluate(() => { const s = (window as any).snap; const f = s.players.find((p: any) => p.id === 'foe'), m = s.players.find((p: any) => p.id === s.me); return { f: f && { alive: f.alive, hp: f.hp, x: f.x, y: f.y }, m: m && { x: m.x, y: m.y, cd: m.skillCd } }; });
  let hp0 = (await fs()).f?.hp ?? 0;
  const runW = async (n: number) => { for (let i = 0; i < n && !dead; i++) { await tick(); if (i % 2 === 0) { const st = await fs(); if (!st.f || st.f.alive === false || st.f.hp > hp0) dead = true; else hp0 = st.f.hp; } } };
  for (let k = 0; k < (foe ? 60 : 0) && !dead; k++) {
    const st = await fs();
    if (k % 10 === 0) console.log('fight', k, JSON.stringify(st));
    if (st.f && st.m) { const key = st.f.x > st.m.x + 20 ? 'd' : st.f.x < st.m.x - 20 ? 'a' : null; if (key) { await act('down', key); await runW(6); await act('up', key); } }
    if (st.m && st.m.cd <= 0 && !dead) { await act('down', 'r'); await runW(20); await act('up', 'r'); }
    await runW(10);
  }
  console.log('dead', dead, step);
  await act('send', ['e2eReveal', { on: false }]);
  await run(4); await shot('p_ko0'); await run(40); await shot('p_ko1'); await run(80); await shot('p_ko2');
  rec.end = step;
  writeFileSync(file, JSON.stringify(rec));
  console.log('recorded', { steps: step, frames: rec.frames.length, http: rec.http.length });
} else {
  await page.goto(`http://localhost:${CLIENT_PORT}/?e2e=rec${Date.now().toString(36)}`, { waitUntil: 'load' }); await sleep(3000);
  const until = async (f: (s: any) => boolean, max: number) => { for (let i = 0; i < max; i++) { const s = await snap(); if (s && f(s)) return true; await tick(); } return false; };
  const run = async (n: number) => { for (let i = 0; i < n; i++) await tick(); };
  const shot = async (name: string) => { rec.acts.push({ step, kind: 'shot', arg: name }); console.log(step, name, JSON.stringify(await snap())); };
  await until((s) => s.phase === 'waiting', 3000); await run(60); await shot('lobby');
  await act('send', ['e2eBossGuard', { on: true }]);
  await act('click', '.card[data-k="aru"]'); await run(20); await shot('select'); await act('click', '#okbtn'); await run(10); await act('click', '#okbtn');
  await until((s) => s.phase === 'intro' || s.phase === 'countdown' || s.phase === 'playing', 600); await run(60); await shot('intro');
  await act('send', ['e2eSkipIntro', {}]); await until((s) => s.phase === 'playing', 600); await run(120); await shot('play');
  await act('down', 'd'); await run(60); await act('up', 'd'); await run(30); await shot('walk');
  const team = (await snap())?.me?.team ?? 0;
  for (let k = 0; k < 4; k++) { await act('send', ['e2eSlot', { team, win: true }]); await run(90); await shot(`slotwin${k}`); await run(300); await shot(`slotafter${k}`); }
  await act('send', ['e2eWarp', {}]); await run(60); await shot('warp');
  await act('down', 'r'); await run(30); await act('up', 'r'); await run(120); await shot('fight1'); await run(240); await shot('fight2'); await run(240); await shot('fight3');
  await act('send', ['e2eKill', {}]); await run(20); await shot('koed0'); await run(60); await shot('koed1'); await run(120); await shot('koed2');
  await until((s) => s.me?.alive, 1200); await run(60); await shot('respawn');
  await act('send', ['e2eTimeLeft', { sec: 2 }]); await until((s) => s.phase === 'finale', 600); await run(30); await shot('finale');
  await until((s) => s.phase === 'ended', 1200); await run(240); await shot('result');
  rec.end = step;
  writeFileSync(file, JSON.stringify(rec));
  console.log('recorded', { steps: step, frames: rec.frames.length, http: rec.http.length });
}
await b.close();
