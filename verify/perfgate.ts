// 負荷の検証（handoff_perfgate1）: 決まった場面を通して DOM の書き換え・強制レイアウト・再計算・層・WebGL を数え、絶対の決まりと verify/perf_budget.json の上限で合否を出す
// 実行: npx tsx verify/perfgate.ts [--dir <リポジトリのフォルダ（既定: ここ）>] [--port 2641] [--out <結果の JSON>]
//   dir の src を E2E_HOOKS=1 SERVE_DIST=1 で別ポートに立て、dir/dist に圧縮なしでビルドしたクライアント（関数名が残る）をスマホの画面（852×393 DPR3）の Chromium と WebKit で同時に開く
//   終了コード 0=合格、1=不合格（不合格の項目と、書いている要素・関数を表示）。計測の注入は verify/perfgate_probe.js
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, webkit, type Page, type BrowserContext } from 'playwright-core';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIR = resolve(arg('--dir', '.')), PORT = arg('--port', '2641'), HERE = resolve(import.meta.dirname, '..');
const OUT = arg('--out', `${HERE}/verify/evidence/perfgate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const SEC = 5; // 1場面の秒数
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();

// 1. ビルド（圧縮なし: 書いた関数の名前を出すため）とサーバー
execSync('npx vite build --minify false', { cwd: DIR, stdio: 'ignore' });
const srv = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { cwd: DIR, env: { ...process.env, E2E_HOOKS: '1', SERVE_DIST: '1', GAME_PORT: PORT, NET_MEASURE: '0' }, stdio: 'ignore' });
process.on('exit', () => srv.kill());
for (let i = 0; ; i++) { try { if ((await fetch(`http://localhost:${PORT}/status`)).ok) break; } catch {} if (i > 160) throw new Error('サーバーが起動しない'); await sleep(250); }

type Scene = { name: string; secs: number; c: any; cdp?: any; layers?: { n: number; full: number; mb: number } };
async function run(engine: 'chromium' | 'webkit') {
  const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(readFileSync(`${HERE}/verify/perfgate_probe.js`, 'utf8'));
  const page: Page = await ctx.newPage();
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const cdp = engine === 'chromium' ? await ctx.newCDPSession(page) : null;
  let layers: any[] = [];
  if (cdp) { await cdp.send('Performance.enable'); cdp.on('LayerTree.layerTreeDidChange', (e: any) => { if (e.layers) layers = e.layers; }); }
  const metrics = async () => (cdp ? Object.fromEntries(((await cdp.send('Performance.getMetrics')) as any).metrics.map((m: any) => [m.name, m.value])) : null);
  await page.goto(`http://localhost:${PORT}/?e2e=perfgate-${engine}-${Date.now()}`);
  await page.waitForFunction(() => (window as any).snap && (window as any).room, null, { timeout: 30000 });
  const send = (t: string, d: any = {}) => page.evaluate(([t, d]) => (window as any).room.send(t, d), [t, d] as const);
  const snap = (f: string) => page.evaluate(`(() => { const s = window.snap, me = s.players.find((p) => p.id === s.me); return ${f}; })()`) as Promise<any>;
  const scenes: Scene[] = [];
  const measure = async (name: string, act: () => Promise<void> = async () => {}) => {
    const m0 = await metrics(); await page.evaluate(() => (window as any).__pg.start());
    const at = Date.now(); await act(); await sleep(Math.max(0, SEC * 1000 - (Date.now() - at)));
    const c = await page.evaluate(() => (window as any).__pg.stop()), m1 = await metrics(), secs = (Date.now() - at) / 1000;
    const vw = 852 * 393, ly = layers.filter((l: any) => l.drawsContent);
    scenes.push({ name, secs, c, ...(m0 && m1 ? { cdp: { recalc: (m1.RecalcStyleCount - m0.RecalcStyleCount) / secs, layout: (m1.LayoutCount - m0.LayoutCount) / secs, recalcMs: ((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / secs, layoutMs: ((m1.LayoutDuration - m0.LayoutDuration) * 1000) / secs }, layers: { n: ly.length, full: ly.filter((l: any) => l.width * l.height >= vw * 0.9).length, mb: ly.reduce((a: number, l: any) => a + l.width * l.height * 4, 0) / 1e6 } } : {}) });
  };
  const keys = async (k: string, ms: number) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); };
  const startMatch = async () => {
    await page.waitForFunction(() => (window as any).snap.phase === 'waiting', null, { timeout: 60000 });
    await send('e2eBossGuard', { on: true }); await send('e2eSlotMiss', { on: true }); await send('go', { char: 'kiritan' });
    for (let i = 0; i < 60 && (await snap('s.phase')) !== 'playing'; i++) { await send('e2eSkipIntro'); await sleep(250); }
    await sleep(1500);
  };
  const endMatch = async () => { await send('e2eTimeLeft', { sec: 0.3 }); await page.waitForFunction(() => (window as any).snap.phase === 'ended', null, { timeout: 60000 }); };
  // 2. 場面（1試合目）
  await startMatch();
  if (cdp) { await cdp.send('LayerTree.enable'); await sleep(500); } // 層の一覧（試合の画面になってから。前に有効にすると届かない）
  const myTeam = await snap('me.team'), counts1 = await page.evaluate(() => (window as any).__pg.counts()), layers1 = layers.length;
  await measure('立ち止まる');
  await measure('歩く', async () => { for (const k of ['d', 's', 'a', 'w', 'd']) await keys(k, 1000); });
  // スロットの演出: 次の保留を演出つきに差し替え、演出が出てから測る（演出は3秒）
  const slotFx = async (name: string, act: string, win: boolean, sel: string) => {
    await send('e2eSlot', { team: myTeam, win, act });
    if (!(await page.waitForFunction((q) => !!document.querySelector(q), sel, { timeout: 30000 }).then(() => true, () => false))) { errors.push(`場面「${name}」の演出が出ない（e2eSlot が演出の種類 act を受けない古い版など）`); return; }
    await measure(name);
  };
  await slotFx('リーチ ちびキャラ', 'chibi', false, '.mfxl .mfx-fx img');
  await slotFx('リーチ 魚群', 'fish', false, '.mfxl .mfx-fx img');
  await slotFx('リーチ 特別な魚群', 'fishSp', false, '.mfxl .mfx-fx img');
  await slotFx('全回転→当選・パワーアップ', 'allSpin', true, '.mfxl .mfx-rainbow');
  await measure('スロット 罰', async () => { await send('e2eSlot', { team: myTeam, pen: true }); }); // classic はその場で回る（罰の通知・減速）
  await measure('技のクールタイム中', async () => { await send('e2eReady'); await send('skill'); });
  await measure('被撃破・反省中', async () => { await send('e2eClearUlt'); await send('e2eKill'); });
  await page.waitForFunction(() => { const s = (window as any).snap; return s.players.find((p: any) => p.id === s.me)?.alive; }, null, { timeout: 60000 });
  await measure('復帰の後', async () => { await keys('d', 2000); });
  await measure('決着〜結果画面', async () => { await endMatch(); });
  await send('back');
  // 3. 連戦（2試合目はすぐ終える、3試合目で増え続けていないか）
  await startMatch(); await endMatch(); await send('back');
  await startMatch();
  await measure('3試合目 立ち止まる');
  const counts3 = await page.evaluate(() => (window as any).__pg.counts()), layers3 = layers.length;
  await browser.close();
  return { engine, scenes, growth: { nodes: [counts1.nodes, counts3.nodes], textures: [counts1.textures, counts3.textures], ...(cdp ? { layers: [layers1, layers3] } : {}) }, errors };
}

const results = await Promise.all([run('chromium'), run('webkit')]);
srv.kill();

// 4. 判定（handoff_perfgate1）: 合否は「不要な書き換え」の4つの定義（例外は verify/perf_budget.json の exceptions。足すのは本人の了承がある時だけ）と、連戦で増え続けないか・ページのエラー
//   参考値（層・全画面の層・drawcall・テクスチャの転送量）は budget.ref の上限（基準値＋余裕）で見る
const budgetFile = `${HERE}/verify/perf_budget.json`, budget = JSON.parse(readFileSync(budgetFile, 'utf8'));
const top = (o: Record<string, number>, n: number, div = 1) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / div).toFixed(1)} ${k}`);
const exc = (rule: string, key: string) => (budget.exceptions as any[]).find((e) => e.rule === rule && key.includes(e.match));
const nOf = (key: string) => (budget.n as any[]).find((e) => key.includes(e.match))?.n ?? budget.nDefault; // 定義3の N（毎秒。表示の値が実際に変わる回数の上限）
const fails: string[] = [], table: any[] = [];
for (const r of results) {
  for (const s of r.scenes) {
    const c = s.c, fr = Math.max(1, c.frames), sec = s.secs;
    const row = { engine: r.engine, scene: s.name, fps: c.frames / sec, mut: c.mut / sec, mutTf: c.mutTf / sec, forced: c.forced / sec, forcedFrac: c.forcedFrames / fr, maxElFrac: Math.max(0, ...Object.values(c.elFrameA as Record<string, number>).map((n) => n / fr)), ...(s.cdp ?? {}), ...(s.layers ? { layers: s.layers.n, fullLayers: s.layers.full, layerMB: s.layers.mb } : {}), draw: c.draw / sec, texKB: c.texBytes / 1024 / sec, frameMs: c.frameMs / fr };
    table.push(row);
    const at = `${r.engine} ${s.name}`;
    // 1. 同じ値の書き込み: 0回
    for (const [k, n] of Object.entries(c.same as Record<string, number>)) if (!exc('same', k)) fails.push(`[定義1 同じ値の書き込み] ${at}: ${(n / sec).toFixed(1)}/秒 ${k}`);
    // 2. 強制レイアウト: 0回（例外は max 回/秒まで）
    for (const [k, n] of Object.entries(c.forcedBy as Record<string, number>)) { const e = exc('forced', k); if (!e || n / sec > e.max) fails.push(`[定義2 強制レイアウト] ${at}: ${(n / sec).toFixed(1)}/秒 ${k}`); }
    // 3. レイアウトを起こす書き込み: 要素1つあたり毎秒 N 回まで（測る時間の端で1回多く数える分は許す）
    for (const [k, n] of Object.entries(c.inst as Record<string, number>)) { const lim = nOf(k); if (n > lim * sec + 1) fails.push(`[定義3 レイアウトを起こす書き込み] ${at}: 1要素 ${(n / sec).toFixed(1)}/秒 > N=${lim} ${k}`); }
    // 4. 動き: transform・opacity 以外の書き換えが budget.motionFrac を超えるフレームにある要素（例外は maxFrac まで）、transform・opacity 以外を動かす CSS アニメーション
    for (const [k, n] of Object.entries(c.elFrameA as Record<string, number>)) { const f = n / fr, e = exc('motion', k); if (f > (e ? e.maxFrac : budget.motionFrac)) fails.push(`[定義4 動き] ${at}: ${Math.round(f * 100)}%のフレームで書き換え ${k}`, ...top(c.wr, 3, sec).map((x) => `    書いた所 ${x}/秒`)); }
    for (const k of Object.keys(c.anims as Record<string, number>)) if (!exc('motion', k)) fails.push(`[定義4 動き] ${at}: transform・opacity 以外を動かす CSS アニメーション ${k}`);
    // 参考値の上限
    const ref = budget.ref?.[r.engine]?.[s.name];
    if (ref) for (const [k, lim] of Object.entries(ref as Record<string, number>)) if ((row as any)[k] > lim) fails.push(`[参考値の上限] ${at}: ${k} ${(row as any)[k].toFixed(2)} > ${lim}`);
  }
  const g = r.growth as any;
  for (const k of ['nodes', 'textures', 'layers']) if (g[k] && g[k][1] > g[k][0] * 1.1 + 20) fails.push(`[連戦] ${r.engine}: ${k} が 1試合目 ${g[k][0]} → 3試合目 ${g[k][1]}`);
  if (r.errors.length) fails.push(`[ページのエラー] ${r.engine}: ${[...new Set(r.errors)].slice(0, 3).join(' / ')}`);
}
mkdirSync(resolve(OUT, '..'), { recursive: true });
writeFileSync(OUT, JSON.stringify({ dir: DIR, build: readFileSync(`${DIR}/dist/build.txt`, 'utf8').trim(), table, results, fails }, null, 1));
const cols = ['engine', 'scene', 'fps', 'mut', 'mutTf', 'forced', 'maxElFrac', 'recalc', 'layout', 'layers', 'fullLayers', 'draw', 'texKB', 'frameMs'];
console.log(cols.join('\t'));
for (const r of table) console.log(cols.map((k) => (typeof r[k] === 'number' ? r[k].toFixed(k.endsWith('Frac') ? 2 : 1) : r[k] ?? '-')).join('\t'));
console.log(results.map((r) => `${r.engine} 連戦 ${JSON.stringify(r.growth)}`).join('\n'));
console.log(`結果: ${OUT}（${((Date.now() - t0) / 1000).toFixed(0)}秒）`);
if (fails.length) { console.log('不合格'); for (const f of fails) console.log(f); process.exit(1); }
console.log('合格');
process.exit(0);
