// 誰もいない時の Bot 戦（handoff_botsim1）: 通信・描画なしで GameRoom を直接 tick し、実時間を待たずに早回しする。記録は記録部（src/server/matchlog.ts）が logs/matchlog/YYYYMMDD_bot.jsonl へ書く
// 実行: npx tsx tools/botsim.ts [--now] [--matches N] [--max-min M] [--port 2567]（既定は CONFIG.BOTSIM。--now: 前回からの間隔を待たない）
// 始めない・途中で止める: 公開サーバー（/status）に人間（プレイヤー・観戦）がいる部屋がある／/status が読めない／e2e（verify/e2e.ts）が動いている。途中で止めた試合は捨てる（書かない）
import { execSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setPriority } from 'node:os';
import { CONFIG as C } from '../src/shared/config';
import { GameRoom } from '../src/server/GameRoom';

const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const MATCHES = arg('--matches', C.BOTSIM.matches), MAX_MS = arg('--max-min', C.BOTSIM.maxMin) * 60_000, PORT = arg('--port', C.PORT);
const LOCK = 'logs/botsim.lock', LAST = 'logs/botsim.last', DT = 1 / C.TICK_HZ, CHECK_MS = 2000;
const log = (s: string) => console.log(`${new Date().toISOString()} [botsim] ${s}`);

// 人間がいるか（始めない・止める理由。なければ null）
async function busy(): Promise<string | null> {
  try { execSync('pgrep -f verify/e2e', { stdio: 'ignore' }); return 'e2e が動いている'; } catch {}
  let err: unknown;
  for (let i = 0; i < 3; i++) { // 読めなければ1秒おきに3回まで（接続の使い回しが切れた直後などの一時的な失敗）
    try {
      const s: any = await (await fetch(`http://localhost:${PORT}/status`, { signal: AbortSignal.timeout(3000) })).json();
      const r = s.rooms?.find((r: any) => r.humans > 0 || r.spec > 0);
      return r ? `部屋${r.no}に人間（${r.humans}人・観戦${r.spec}人）` : null;
    } catch (e) { err = e; await new Promise((ok) => setTimeout(ok, 1000)); }
  }
  return `/status が読めない（ポート${PORT}: ${(err as any)?.cause?.code ?? (err as any)?.name ?? err}）`;
}

// mulberry32（試合ごとの種。同じ種で再現できる）
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 1試合。人間が来たら false（試合は捨てる）
async function match(seed: number, until: number): Promise<boolean> {
  const random = Math.random;
  Math.random = rng(seed); GameRoom.matchSeed = seed;
  try {
    const r: any = new (GameRoom as any)();
    r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
    Object.defineProperty(r, 'clients', { value: [] });
    r.onCreate(); r.notice = () => {};
    r.startMatch(); // 8人とも Bot（キャラは本番と同じ選び方）
    let checkAt = performance.now() + CHECK_MS;
    while (r.phase !== 'ended') {
      r.tick(DT, false);
      if (performance.now() < checkAt) continue;
      const b = await busy();
      if (b || Date.now() > until) { log(`試合を捨てて止める: ${b ?? '上限時間'}`); return false; }
      checkAt = performance.now() + CHECK_MS;
    }
    log(`種 ${seed}: ${r.winner === 2 ? '引き分け' : `陣営${r.winner}の勝ち`}（${r.rec.summary()?.kind}、${Math.round(r.now)}秒）`);
    return true;
  } finally { Math.random = random; GameRoom.matchSeed = null; }
}

mkdirSync('logs', { recursive: true });
if (existsSync(LOCK)) {
  const pid = Number(readFileSync(LOCK, 'utf8'));
  try { process.kill(pid, 0); log(`別の botsim（PID ${pid}）が動いている`); process.exit(0); } catch {} // 残っていた lock（プロセスなし）は上書き
}
const last = existsSync(LAST) ? Number(readFileSync(LAST, 'utf8')) : 0;
if (!process.argv.includes('--now') && Date.now() - last < C.BOTSIM.intervalSec * 1000) process.exit(0); // 間隔が空いていない（launchd は短い間隔で起こすだけ）
const why = await busy();
if (why) { log(`始めない: ${why}`); process.exit(0); }
writeFileSync(LOCK, String(process.pid));
try {
  try { setPriority(10); } catch {} // 優先度を下げる（launchd の Nice と同じ）
  writeFileSync(LAST, String(Date.now()));
  GameRoom.logFile = ''; GameRoom.matchlogDir = 'logs/matchlog'; GameRoom.matchlogSource = 'bot';
  const until = Date.now() + MAX_MS;
  let n = 0;
  for (; n < MATCHES && Date.now() < until; n++) if (!(await match(randomInt(2 ** 32), until))) break;
  log(`${n}試合`);
} finally { rmSync(LOCK, { force: true }); }
process.exit(0);
