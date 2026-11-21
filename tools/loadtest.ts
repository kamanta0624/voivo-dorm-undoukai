// 負荷試験（handoff_publish1.md E）: 別ポートでサーバーを起動し、部屋を増やしながら 1tick の処理時間・CPU・メモリ・送信量を測る
// 実行: npx tsx tools/loadtest.ts [部屋数の列（既定 1,2,4,8,12）] [測る秒数（既定 30）] [ポート（既定 2571）]   例: npx tsx tools/loadtest.ts 1,2 30
// 各部屋に SDK のクライアントを8つ接続して出撃させ、試合を進める（操作はサーバーの Bot に任せる＝Bot 相当の入力。クライアントは受信だけ）
// サーバーは子プロセス（同じファイルを --server で起動）。測るのはサーバーのプロセスだけ
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { CONFIG as C } from '../src/shared/config';

if (process.env.NET_MEASURE !== undefined) C.NET_MEASURE = process.env.NET_MEASURE !== '0';

if (process.argv[2] === '--server') {
  let seed = 7; Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
  const { defineServer, defineRoom } = await import('colyseus');
  const { GameRoom } = await import('../src/server/GameRoom');
  const { WebSocket } = await import('ws');
  GameRoom.logFile = ''; // 試合ログは書かない
  let on = false, sent = 0, cpu0 = process.cpuUsage(), t0 = 0;
  const durs: number[] = [], gaps: number[] = [], last = new Map<object, number>();
  const send = WebSocket.prototype.send; // サーバーからの送信量
  WebSocket.prototype.send = function (this: any, data: any, ...a: any[]) { if (on) sent += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength ?? data.length ?? 0; return (send as any).call(this, data, ...a); } as any;
  const tick = GameRoom.prototype.tick; // 1tick の処理時間と、tick の間隔（TICK_HZ に収まっているか）
  GameRoom.prototype.tick = function (this: any, dt: number, s = true) {
    const t = performance.now();
    tick.call(this, dt, s);
    if (on) { durs.push(performance.now() - t); const l = last.get(this); if (l !== undefined) gaps.push(t - l); }
    last.set(this, t);
  };
  const begin = (GameRoom.prototype as any).beginPlay; // 試合開始で人間の枠を Bot に任せる（接続は残す）
  (GameRoom.prototype as any).beginPlay = function (this: any) {
    begin.call(this);
    for (const p of this.players.values()) if (!p.bot && !p.assist) Object.assign(p, { bot: true, path: [], aim: C.BOT_AIM, qAt: null, recallAt: null });
  };
  const server = defineServer({ rooms: { game: defineRoom(GameRoom).filterBy(['e2e']) } });
  await server.listen(Number(process.argv[3]));
  console.log(JSON.stringify({ ready: true }));
  const pct = (a: number[], q: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };
  for await (const line of createInterface({ input: process.stdin })) {
    if (line === 'start') { on = true; sent = 0; durs.length = gaps.length = 0; last.clear(); cpu0 = process.cpuUsage(); t0 = performance.now(); }
    if (line === 'stop') {
      on = false;
      const sec = (performance.now() - t0) / 1000, cu = process.cpuUsage(cpu0);
      const avg = durs.reduce((a, b) => a + b, 0) / (durs.length || 1);
      console.log(JSON.stringify({ sec, ticks: durs.length, avg, max: Math.max(0, ...durs), p99: pct(durs, 0.99), gapP99: pct(gaps, 0.99), gapMax: Math.max(0, ...gaps), late: gaps.filter((g) => g > 1000 / C.TICK_HZ * 1.5).length / (gaps.length || 1), cpu: (cu.user + cu.system) / 1e6 / sec * 100, rss: process.memoryUsage().rss / 2 ** 20, heap: process.memoryUsage().heapUsed / 2 ** 20, sent }));
    }
  }
  process.exit(0);
}

const steps = (process.argv[2] ?? '1,2,4,8,12').split(',').map(Number), SEC = Number(process.argv[3] ?? 30), PORT = Number(process.argv[4] ?? 2571), PER = 8;
const { Client } = await import('@colyseus/sdk');
const { PICKABLE } = await import('../src/shared/chars');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const child = spawn(process.execPath, [...process.execArgv, process.argv[1], '--server', String(PORT)], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines: any[] = [];
createInterface({ input: child.stdout! }).on('line', (l) => { try { lines.push(JSON.parse(l)); } catch {} });
const next = async () => { const n = lines.length; for (let i = 0; i < 600 && lines.length === n; i++) await sleep(100); if (lines.length === n) throw new Error('サーバーが応答しない'); return lines[n]; };
const cmd = (c: string) => child.stdin!.write(c + '\n');
try {
  for (let i = 0; i < 300 && !lines.length; i++) await sleep(100);
  if (!lines[0]?.ready) throw new Error('サーバーが起動しない');
  const rows: string[] = [];
  for (const [si, n] of steps.entries()) {
    const sdk = new Client(`ws://localhost:${PORT}`), conns: any[] = [];
    for (let r = 0; r < n; r++) {
      let phase = '';
      for (let k = 0; k < PER; k++) {
        const room = await sdk.joinOrCreate('game', { e2e: `load${si}-${r}` });
        room.onMessage('*', () => {});
        if (k === 0) room.onMessage('s', (m: any) => { phase = m.phase; });
        conns.push(room);
      }
      for (const room of conns.slice(-PER)) room.send('go', { char: PICKABLE[conns.indexOf(room) % PICKABLE.length] });
      for (let i = 0; i < 600 && phase !== 'playing'; i++) await sleep(100);
      if (phase !== 'playing') throw new Error(`部屋${r + 1}の試合が始まらない（${phase}）`);
    }
    await sleep(2000);
    cmd('start'); await sleep(SEC * 1000); cmd('stop');
    const s = await next(), kbps = s.sent / s.sec / 1024;
    rows.push(`| ${n} | ${n * PER} | ${s.avg.toFixed(2)} | ${s.p99.toFixed(2)} | ${s.max.toFixed(1)} | ${s.gapP99.toFixed(1)} / ${s.gapMax.toFixed(1)} | ${(s.late * 100).toFixed(1)}% | ${s.cpu.toFixed(0)}% | ${s.rss.toFixed(0)} | ${kbps.toFixed(0)} | ${(kbps / (n * PER)).toFixed(1)} |`);
    console.log(rows.at(-1));
    for (const room of conns) await room.leave();
    await sleep(2000);
  }
  console.log(`\n測定 ${SEC}秒／段階、TICK_HZ ${C.TICK_HZ}（間隔 ${1000 / C.TICK_HZ}ms）、1部屋 ${PER}クライアント`);
  console.log('| 部屋 | 接続 | tick平均ms | tick 99%ms | tick最大ms | tick間隔 99%/最大ms | 間隔1.5倍超 | CPU | RSS MB | 送信 KB/s | 1人あたり KB/s |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(r);
} finally { child.kill(); }
process.exit(0);
