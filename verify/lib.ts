// 実クライアント(http://localhost:5173)を Playwright の実キー入力で操作するための補助
// GAME_PORT・CLIENT_PORT: 別のポートで起動した dev（公開中のサーバーとぶつけないとき）に繋ぐ
import { chromium, Page, Browser } from 'playwright-core';
import { mkdirSync, appendFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { CONFIG as C } from '../src/shared/config';
import { findPath } from '../src/server/pathfind';

export const GAME_PORT = Number(process.env.GAME_PORT) || 2567, CLIENT_PORT = Number(process.env.CLIENT_PORT) || 5173;
export const RUN = Date.now().toString(36); // この実行の e2e の部屋
export const OUT = `verify/evidence/${new Date().toISOString().replace(/[:.]/g, '-')}`; // 実行ごとに分ける
mkdirSync(OUT, { recursive: true });
// 実行ごとの日時名のフォルダは直近3個だけ残す（溜まると数GBになる。作業名のフォルダ verify/evidence/<名前> には触らない）
{ const runs = readdirSync('verify/evidence').filter((d) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(d)).sort(); for (const d of runs.slice(0, -3)) rmSync(`verify/evidence/${d}`, { recursive: true, force: true }); }
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
export function log(...a: any[]) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(line);
  appendFileSync(`${OUT}/log.txt`, line + '\n');
}
export function check(name: string, ok: boolean, detail: any = '') {
  log(ok ? 'PASS' : 'FAIL', name, detail);
  if (!ok) failed++;
}
export const failures = () => failed;

// src・index.html を変えた直後は、dev（tsx watch のサーバー再起動・vite の再読み込み）が収まるまで待つ
// vite の HMR（再読み込みの通知）を受け、最後の変更・通知から QUIET_MS 何も来なくなるまで待つ。vite は変更から通知まで10秒以上かかることがあるので、
// クライアントが読むファイル（src/client・src/shared・index.html）を RECENT_MS 以内に変えていたら、その通知が届くまで（最大 NOTIFY_MAX_MS）待ってから数える
const QUIET_MS = 3000, RECENT_MS = 60000, NOTIFY_MAX_MS = 30000;
const newest = (dir: string): number => readdirSync(dir, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(`${dir}/${e.name}`) : statSync(`${dir}/${e.name}`).mtimeMs), 0);
const clientFiles = () => Math.max(newest('src/client'), newest('src/shared'), statSync('index.html').mtimeMs);
async function settle() {
  const t0 = Date.now(); let last = 0, notified = false;
  const ws = await new Promise<WebSocket | null>((ok) => { try { const w = new WebSocket(`ws://localhost:${CLIENT_PORT}/`, 'vite-hmr'); w.onopen = () => ok(w); w.onerror = () => ok(null); } catch { ok(null); } });
  if (ws) ws.onmessage = (e) => { const t = JSON.parse(String(e.data)).type; if (t !== 'connected' && t !== 'ping') { last = Date.now(); notified = true; } };
  const changed = clientFiles();
  const needNotify = !!ws && Date.now() - changed < RECENT_MS;
  for (;;) {
    const quietFrom = Math.max(last, newest('src'), statSync('index.html').mtimeMs);
    if ((!needNotify || notified || Date.now() - t0 > NOTIFY_MAX_MS) && Date.now() - quietFrom >= QUIET_MS) break;
    await sleep(200);
  }
  ws?.close();
  if (Date.now() - t0 > 300) log(`  ファイルを変えた直後なので、dev の再読み込みが収まるまで ${((Date.now() - t0) / 1000).toFixed(1)}秒待った`);
}

export async function launch(): Promise<Browser> {
  await settle();
  return chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
}

export class Tab {
  held = new Set<string>();
  constructor(public page: Page, public name: string) {}
  // lag: [遅延ms, 揺らぎms] を指定すると、このタブの通信（WebSocket）に往復で遅延を入れる（送った順に届く）
  static async open(b: Browser, name: string, lag?: [number, number]) {
    const page = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
    if (lag) {
      const delay = () => { let last = 0; return (f: () => void) => { const at = Math.max(last, Date.now() + (lag[0] + (Math.random() * 2 - 1) * lag[1]) / 2); last = at; setTimeout(f, at - Date.now()); }; };
      await page.routeWebSocket(new RegExp(`:${GAME_PORT}/`), (ws) => {
        const server = ws.connectToServer(), up = delay(), down = delay();
        ws.onMessage((m) => up(() => server.send(m)));
        server.onMessage((m) => down(() => ws.send(m)));
      });
    }
    // ページの二重読み込み（クライアントのファイルを変えた直後の vite の再読み込みなど）は、入室や画面の状態が途中で作り直されて確認の前提が崩れるので、失敗として止める
    let navs = 0;
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame() || ++navs <= 1) return;
      log('FAIL', `タブ${name}: ページが再読み込みされた（${f.url()}）。確認の前提（1回の読み込み）が崩れるので中止する。クライアントのファイルを変えた直後なら、少し待ってから流し直す`);
      process.exit(1);
    });
    page.on('pageerror', (e) => log('pageerror', name, e.message));
    page.on('console', (m) => { if (m.type() === 'error') log('console.error', name, m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) log('http', r.status(), name, r.url()); });
    await page.goto(`http://localhost:${CLIENT_PORT}/?e2e=${RUN}`); // 普段のプレイの部屋と混ざらないように。実行ごとに別の部屋（前の実行の再接続待ちのタブと混ざらないように）
    const t = new Tab(page, name);
    await page.waitForFunction(() => (window as any).snap);
    // 受信したスナップショットを記録（検証用。アプリ側のコードは変えない）
    await page.evaluate(() => {
      const w = window as any;
      w.hist = [];
      w.room.onMessage('s', (s: any) => w.hist.push({
        t: s.timeLeft, me: s.me, couriers: s.couriers, phase: s.phase, teams: s.teams, bosses: s.bosses,
        items: s.items, mats: s.materials.map((m: any) => [m.id, m.x, m.y]), roster: s.roster, broken: s.broken, reveal: s.reveal,
        players: s.players.map((p: any) => ({ id: p.id, team: p.team, char: p.char, bot: p.bot, x: p.x, y: p.y, hp: p.hp, alive: p.alive, rage: p.rage, respawnIn: p.respawnIn, ult: p.ult, assist: p.assist })),
      }));
    });
    // 自動攻撃を止める（e2e 専用の仕掛け）。自動攻撃が検証の前提を崩さないように
    await page.evaluate(() => (window as any).room.send('e2eNoAuto', { on: true }));
    return t;
  }
  hist(): Promise<any[]> { return this.page.evaluate(() => (window as any).hist); }
  snap(): Promise<any> { return this.page.evaluate(() => (window as any).snap); }
  hud(): Promise<string> { return this.page.evaluate(() => document.getElementById('info')!.textContent!); }
  async me() { const s = await this.snap(); return s.players.find((p: any) => p.id === s.me); }
  async shot(file: string) { await this.page.screenshot({ path: `${OUT}/${file}.png` }); log(`  screenshot: ${OUT}/${file}.png`); }
  async until(pred: (s: any) => boolean, ms: number) {
    const t = Date.now();
    while (Date.now() - t < ms) { if (pred(await this.snap())) return true; await sleep(50); }
    return false;
  }
  // 方向キーの押下状態を (dx, dy) に合わせる
  async keys(dx: number, dy: number) {
    const want = new Set<string>();
    if (dx > 0.3) want.add('d'); if (dx < -0.3) want.add('a');
    if (dy > 0.3) want.add('s'); if (dy < -0.3) want.add('w');
    for (const k of [...this.held]) if (!want.has(k)) { await this.page.keyboard.up(k); this.held.delete(k); }
    for (const k of want) if (!this.held.has(k)) { await this.page.keyboard.down(k); this.held.add(k); }
  }
  async hold(key: string, ms: number) { await this.page.keyboard.down(key); await sleep(ms); await this.page.keyboard.up(key); }
  async press(key: string) { await this.page.keyboard.press(key); }
  // A* で経路を引いてキー入力で移動。到達/死亡/タイムアウトで戻る
  async goto(x: number, y: number, tol = 10, ms = 20000): Promise<boolean> {
    const t0 = Date.now();
    let path: { x: number; y: number }[] = [];
    let at = 0;
    try {
      while (Date.now() - t0 < ms) {
        const s = await this.snap();
        const m = s.players.find((p: any) => p.id === s.me);
        if (!m || !m.alive || s.phase !== 'playing') return false;
        if (Math.hypot(x - m.x, y - m.y) <= tol) return true;
        if (Date.now() - at > 500) { path = findPath(m, { x, y }, C.WALLS); at = Date.now(); }
        while (path.length > 1 && Math.hypot(path[0].x - m.x, path[0].y - m.y) < 12) path.shift();
        const n = path[0] ?? { x, y };
        const d = Math.hypot(n.x - m.x, n.y - m.y) || 1;
        await this.keys((n.x - m.x) / d, (n.y - m.y) / d);
        await sleep(30);
      }
      return false;
    } finally { await this.keys(0, 0); }
  }
  // 目標方向を向く（一瞬だけキーを押す）
  async face(x: number, y: number) {
    const m = await this.me();
    const d = Math.hypot(x - m.x, y - m.y) || 1;
    await this.keys((x - m.x) / d, (y - m.y) / d);
    await sleep(40);
    await this.keys(0, 0);
    await sleep(60);
  }
}
