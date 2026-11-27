// Bot のフィジカル × チームのマクロの比較（handoff_botai1）。botsim と同じく通信なしで早回しし、記録部が logs/botai/YYYYMMDD_bot.jsonl へ書く
// 実行: npx tsx tools/botai.ts [--n 40] [--port 2567]（--n: 組み合わせごとの試合数。陣営を入れ替えて半分ずつ。途中から再開できる＝出力済みの試合数を数えて残りだけ回す）
// 始めない・途中で止める: botsim と同じ（公開サーバーに人間・観戦者／e2e）。公開側の botsim が動いている間は待つ
import { execSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { setPriority, homedir } from 'node:os';
import { CONFIG as C } from '../src/shared/config';
import { GameRoom } from '../src/server/GameRoom';

const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const N = arg('--n', 40), PORT = arg('--port', C.PORT), DIR = 'logs/botai', DT = 1 / C.TICK_HZ;
const log = (s: string) => console.log(`${new Date().toISOString()} [botai] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 組み合わせ: [陣営Aの フィジカル/マクロ, 陣営Bの フィジカル/マクロ]
type Side = { phys: string; macro: string };
const S = (phys: string, macro: string): Side => ({ phys, macro });
const M = C.BOT_MACROS;
const PLAN: [string, Side, Side][] = [
  ['A 強vs弱', S('strong', 'std'), S('weak', 'std')], ['A 強vs中', S('strong', 'std'), S('mid', 'std')], ['A 中vs弱', S('mid', 'std'), S('weak', 'std')],
  ...M.flatMap((a, i) => M.slice(i + 1).map((b): [string, Side, Side] => [`B ${a}vs${b}`, S('mid', a), S('mid', b)])),
  ...M.filter((m) => m !== 'std').map((m): [string, Side, Side] => [`C 弱${m}vs強std`, S('weak', m), S('strong', 'std')]),
];
const key = (a: Side, b: Side) => `${a.phys}/${a.macro}|${b.phys}/${b.macro}`;

async function busy(): Promise<string | null> {
  try { execSync('pgrep -f verify/e2e', { stdio: 'ignore' }); return 'e2e が動いている'; } catch {}
  for (let i = 0; i < 3; i++) {
    try {
      const s: any = await (await fetch(`http://localhost:${PORT}/status`, { signal: AbortSignal.timeout(3000) })).json();
      const r = s.rooms?.find((r: any) => r.humans > 0 || r.spec > 0);
      return r ? `部屋${r.no}に人間（${r.humans}人・観戦${r.spec}人）` : null;
    } catch { await sleep(1000); }
  }
  return `/status が読めない（ポート${PORT}）`;
}
const liveBotsim = () => existsSync(`${homedir()}/kiritan_zunda_proto_live/logs/botsim.lock`);

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 1試合。t0・t1 は陣営0・1の設定。人間が来たら false（試合は捨てる）
async function match(seed: number, t0: Side, t1: Side): Promise<boolean> {
  const random = Math.random;
  Math.random = rng(seed); GameRoom.matchSeed = seed;
  try {
    const r: any = new (GameRoom as any)();
    r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
    Object.defineProperty(r, 'clients', { value: [] });
    r.onCreate(); r.notice = () => {};
    r.macros = [t0.macro, t1.macro];
    r.startMatch();
    for (const p of r.players.values()) { const ph = (p.team ? t1 : t0).phys; if (ph !== 'mid') p.phys = ph; }
    let checkAt = performance.now() + 2000;
    while (r.phase !== 'ended') {
      r.tick(DT, false);
      if (performance.now() < checkAt) continue;
      const b = await busy();
      if (b) { log(`試合を捨てて止める: ${b}`); return false; }
      checkAt = performance.now() + 2000;
    }
    return true;
  } finally { Math.random = random; GameRoom.matchSeed = null; }
}

// 出力済みの試合数（組み合わせ・陣営ごと）
function done() {
  const n = new Map<string, number>();
  if (!existsSync(DIR)) return n;
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.jsonl'))) for (const l of readFileSync(`${DIR}/${f}`, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const m = JSON.parse(l), ph = (t: number) => m.chars.find((c: any) => c.team === t)?.phys ?? 'mid';
    const k = key(S(ph(0), m.teams[0].macro), S(ph(1), m.teams[1].macro));
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return n;
}

try { setPriority(10); } catch {}
GameRoom.logFile = ''; GameRoom.matchlogDir = DIR; GameRoom.matchlogSource = 'bot';
const why = await busy();
if (why) { log(`始めない: ${why}`); process.exit(0); }
const have = done();
let ran = 0;
const t0 = Date.now();
for (const [name, a, b] of PLAN) for (const [x, y] of [[a, b], [b, a]]) {
  for (let i = have.get(key(x, y)) ?? 0; i < N / 2; i++) {
    while (liveBotsim()) await sleep(5000); // 公開側の定期 Bot 戦と同時に回さない
    if (!(await match(randomInt(2 ** 32), x, y))) process.exit(0);
    ran++;
  }
  log(`${name}（${x.phys}/${x.macro} が陣営0）: ${N / 2}試合そろった（累計 ${ran}試合、${Math.round((Date.now() - t0) / 1000)}秒）`);
}
log(`完了: ${ran}試合`);
process.exit(0);
