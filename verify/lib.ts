// 実クライアント(http://localhost:5173)を Playwright の実キー入力で操作するための補助
import { chromium, Page, Browser } from 'playwright-core';
import { mkdirSync, appendFileSync } from 'node:fs';
import { CONFIG as C } from '../src/shared/config';
import { findPath } from '../src/server/pathfind';

export const OUT = `verify/evidence/${new Date().toISOString().replace(/[:.]/g, '-')}`; // 実行ごとに分ける
mkdirSync(OUT, { recursive: true });
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

export async function launch(): Promise<Browser> {
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
      await page.routeWebSocket(/:2567/, (ws) => {
        const server = ws.connectToServer(), up = delay(), down = delay();
        ws.onMessage((m) => up(() => server.send(m)));
        server.onMessage((m) => down(() => ws.send(m)));
      });
    }
    page.on('pageerror', (e) => log('pageerror', name, e.message));
    page.on('console', (m) => { if (m.type() === 'error') log('console.error', name, m.text()); });
    page.on('response', (r) => { if (r.status() >= 400) log('http', r.status(), name, r.url()); });
    await page.goto('http://localhost:5173/?e2e=1'); // 普段のプレイの部屋と混ざらないように
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
    // 照準を「手動」にする（Tabで 一番近い敵→HP→大将優先→手動）。自動攻撃が検証の前提を崩さないように
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
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
