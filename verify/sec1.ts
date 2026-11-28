// sec1 の確認（本物のサーバーにつなぐ）: E2E_HOOKS なしのサーバーで e2e の部屋が作れない・異常なメッセージで切断も停止もしない・tick の例外で部屋が止まらない
// 実行: npx tsx verify/sec1.ts [ポート（既定 2613）]。E2E_HOOKS を付けずに動かす（付いていれば外す）
delete process.env.E2E_HOOKS;
export {};
const { defineServer, defineRoom, matchMaker } = await import('colyseus');
const { Client } = await import('@colyseus/sdk');
const { GameRoom } = await import('../src/server/GameRoom');
const PORT = Number(process.argv[2] ?? 2613);
let fails = 0;
const ok = (name: string, cond: boolean, info: unknown = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`, info === '' ? '' : JSON.stringify(info)); if (!cond) fails++; };

const server = defineServer({ rooms: { game: defineRoom(GameRoom).filterBy(['e2e']) } });
await server.listen(PORT);
const room = matchMaker.getLocalRoomById((await matchMaker.createRoom('game', {})).roomId) as InstanceType<typeof GameRoom>;
const sdk = new Client(`ws://localhost:${PORT}`);

// e2e の部屋
let rejected = ''; try { await sdk.joinOrCreate('game', { e2e: 'x' }); } catch (e: any) { rejected = e?.message ?? String(e); }
ok('E2E_HOOKS なしのサーバーで joinOrCreate(game, { e2e }) が拒否される', !!rejected, rejected);

// 異常なメッセージ: 切断されず、tick が進み、座標が有限
const c = await sdk.joinById(room.roomId, {});
let left = false; c.onLeave(() => { left = true; });
const bad: [string, unknown][] = [['input', null], ['input', 'x'], ['input', { seq: 1, dx: Infinity, dy: 0 }], ['input', { seq: 1, dx: NaN, dy: 0 }], ['input', { seq: 1e300, dx: 1, dy: 0 }],
  ['aim', undefined], ['pick', undefined], ['go', 3], ['team', { team: 'a' }], ['spec', undefined], ['skillUp', 'x'], ['skillAim', {}], ['qdown', { seq: 'x' }], ['pr', undefined], ['netPing', null], ['netReport', undefined], ['nosuchmessage', { a: 1 }], ['e2eWarp', {}]];
for (const [k, m] of bad) c.send(k, m as any);
for (let i = 0; i < 300; i++) c.send('input', { seq: i, dx: 1, dy: 0 }); // 毎秒の上限を超える連打
let ticks = 0; const t1 = (room as any).tick; (room as any).tick = function (this: any, ...a: unknown[]) { ticks++; return t1.apply(this, a); };
await new Promise((r) => setTimeout(r, 1500));
const finite = [...room.players.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
ok('異常なメッセージ・未知の名前・連打で切断されず、部屋の時間が進み、全プレイヤーの座標が有限', !left && finite && room.clients.length === 1 && ticks > 20, { left, finite, clients: room.clients.length, ticks });

// tick の例外: 1回だけ例外を出しても、次の tick が動く
const orig = (room as any).tick; let threw = 0, after = 0;
(room as any).tick = function (this: any, ...a: unknown[]) { if (!threw) { threw++; throw new Error('sec1 test'); } after++; return orig.apply(this, a); };
await new Promise((r) => setTimeout(r, 500));
ok('tick の途中で例外が出ても、次の tick が動く（onUncaughtException でログに残す）', threw === 1 && after > 3, { threw, after });

await c.leave(); await server.gracefullyShutdown(false).catch(() => {});
console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
