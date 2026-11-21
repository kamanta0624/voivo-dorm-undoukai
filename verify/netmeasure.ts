import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameRoom, thingId, type Thing } from '../src/server/GameRoom';
import { CONFIG as C } from '../src/shared/config';
import { CHARS } from '../src/shared/chars';
import { Interp, stepPlayer } from '../src/shared/netcode';
import { ClientMeasure, Histogram, LIMITS, clientReport } from '../src/shared/netmeasure';
import { SKILLS } from '../src/server/skills';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function room() {
  const r = new GameRoom(); r.setSimulationInterval = (() => {}) as any; r.lock = (() => {}) as any;
  Object.defineProperty(r, 'clients', { value: [] }); r.onCreate({ e2e: 'measure' });
  const a = r.addPlayer('a', 0, false), b = r.addPlayer('b', 1, false);
  a.char = 'sayo'; b.char = 'metan'; r.startMatch(); r.beginPlay();
  for (const p of r.players.values()) { p.st.test = { until: Infinity, noAuto: true }; if (p.bot) { p.alive = false; p.respawnAt = Infinity; } }
  Object.assign(a, { x: 1450, y: 900 }); Object.assign(b, { x: 1550, y: 900, hp: 1e6 });
  r.walls = []; r.materials = []; r.items = []; r.couriers = [];
  return { r, a, b };
}
const target = (r: GameRoom, id = 'p:b') => r.enemyThings(0).find((t) => thingId(t) === id)!;
for (const kind of ['respawn', 'recall', 'boss', 'unstick', 'e2e'] as const) {
  const { r, a, b } = room();
  const object = kind === 'boss' ? r.bosses[1] : b, id = kind === 'boss' ? 'boss:1' : 'p:b';
  Object.assign(object, { x: 1500, y: 900 }); r.elapsed = 1; r.recordHist();
  const before = { x: object.x, y: object.y }; r.elapsed = 1.1;
  if (kind === 'respawn') r.respawn(b);
  if (kind === 'recall') { b.recallAt = -C.RECALL_HOLD; r.updatePlayers(0); }
  if (kind === 'boss') r.moveBoss(r.bosses[1]);
  if (kind === 'unstick') { r.walls = [{ x: 1490, y: 890, w: 20, h: 20 }]; r.unstick(); }
  if (kind === 'e2e') r.relocate(id, object, { x: 1900, y: 900 });
  const after = { x: object.x, y: object.y }; assert.notDeepEqual(before, after); r.recordHist();
  const old = r.rewound([target(r, id)], 1.05)[0], at = r.rewound([target(r, id)], 1.1)[0];
  near(old.x, before.x); near(old.y, before.y); near(at.x, after.x); near(at.y, after.y);
  if (Math.hypot(after.x - before.x, after.y - before.y) > 200) {
    Object.assign(a, { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 });
    assert.equal(r.inArc(a, old.x, old.y, old.r, 0, C.ATTACK_RANGE, Math.PI * 2), false);
  }
  console.log('PASS boundary', kind, before, after);
  r.phase = 'finale'; assert.equal(r.hist.length, 0); assert.equal(r.jumps.size, 0);
  for (const phase of ['ended', 'waiting', 'intro', 'countdown', 'playing'] as const) {
    r.hist.push({ t: 0, pos: new Map() }); r.jumps.set('test', [{ t: 0, before, after, born: false }]);
    r.phase = phase; assert.equal(r.hist.length, 0); assert.equal(r.jumps.size, 0);
  }
}
// 高速移動はイベントを作らず補間。実際の突撃・はじき経路を使う。
for (const kind of ['push', 'dash']) {
  const { r, b } = room(); r.elapsed = 1; r.recordHist(); const x = b.x;
  r.elapsed = 1.1;
  if (kind === 'push') r.push(target(r), 1, 0, 100);
  else { b.char = 'aru'; b.inDx = 1; r.skill(b.id); r.now += CHARS.aru.skill.windup; SKILLS.aru.afterMove?.(r, b, .1, b.x, b.y, false); }
  assert.ok(b.x > x, kind); r.recordHist();
  near(r.rewound([target(r)], 1.05)[0].x, (x + b.x) / 2); assert.equal(r.jumps.size, 0);
  console.log('PASS continuous', kind, b.x - x);
}
// stepPlayer 内の pushOut は追跡しない。
{
  const { r, b } = room(); const obs = [{ x: b.x - 10, y: b.y - 10, w: 20, h: 20 }];
  Object.assign(b, stepPlayer(b.x, b.y, 1, 0, 200, obs)); assert.equal(r.jumps.size, 0);
}
// 最初の履歴がまだない開始直後でも、負の描画時刻を扱える。
{
  const { r, b } = room(); r.relocate('p:b', b, { x: 1900, y: 900 });
  assert.equal(r.rewound([target(r)], -.2)[0].x, 1550);
}
// 履歴対象外の場の物は壁補正後も従来どおり現在位置を使う。
{
  const { r } = room();
  const e = { id: 999, kind: 'biiDecoy', team: 1, owner: 'b', x: 1500, y: 900, r: 10, body: 'unit' as const, hp: 1 };
  r.ents.push(e); r.noteJump('e:999', { x: 1000, y: 900 }, e); e.x = 1520;
  assert.equal(r.rewound([target(r, 'e:999')], -.2)[0].x, 1520);
}
// 同じフレームの重複参照は計上しない。推測・上限停止の回数と時間。
{
  const i = new Interp(), m = new ClientMeasure(); i.measure = m;
  i.push(0, 0, [{ id: 'b', x: 0, y: 0 }]); i.push(.05, 50, [{ id: 'b', x: 5, y: 0 }]);
  for (const now of [300, 350, 400]) { m.beginFrame(50); i.at('b', now); i.at('b', now); }
  assert.equal(m.extrapolate.count, 1); near(m.extrapolate.ms, 150); assert.equal(m.capped.count, 1); near(m.capped.ms, 50);
  assert.ok(clientReport(m.report())); assert.equal(clientReport({ ...m.report(), frame: { buckets: [] } }), null);
}
// verify/net.ts と同じ、順序を保つ遅延キュー（時計差5秒、1方向の遅延）。
function network(lat: number, jitter: number) {
  const { r, a } = room(), interp = new Interp(), m = new ClientMeasure();
  let seed = 7, now = 0; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const pipe = () => { let last = 0; const q: { at: number; fn: () => void }[] = []; return { q, send(fn: () => void) { last = Math.max(last, now + lat + (rnd() * 2 - 1) * jitter); q.push({ at: last, fn }); } }; };
  const down = pipe(), up = pipe();
  for (now = 0; now <= 10000; now += 10) {
    r.elapsed = now / 1000;
    if (now % 50 === 0) { const t = r.elapsed; down.send(() => { interp.push(t, now + 5000, [{ id: 'b', x: t * 100, y: 0 }]); m.snapshot(now + 5000, interp.offset!); }); }
    if (now % 1000 === 0) { const sent = now; up.send(() => down.send(() => m.rtt.add(now - sent))); }
    for (const p of [down, up]) while (p.q.length && p.q[0].at <= now) p.q.shift()!.fn();
    if (now > 1000 && now % 100 === 0) { const rt = interp.renderTime(now + 5000); up.send(() => { a.viewT = rt; a.cooldownUntil = 0; r.attack(a.id, 0); }); }
  }
  return { client: m.report(), server: r.measure!.client('a') };
}
const normal = network(50, 0), jitter = network(100, 100), slow = network(200, 0);
near(normal.client.rtt.sum / normal.client.rtt.n, 100); near(slow.client.rtt.sum / slow.client.rtt.n, 400);
near(normal.client.offset.min, 5050); near(normal.client.receive.min, 50); near(normal.client.receive.max, 50);
assert.ok(jitter.client.receive.max > normal.client.receive.max + 50); assert.ok(jitter.client.offsetChange.min < 0);
assert.ok(slow.server.requested.sum / slow.server.requested.n > normal.server.requested.sum / normal.server.requested.n);
assert.ok(slow.server.capped / slow.server.requested.n > normal.server.capped / normal.server.requested.n);
assert.ok(slow.server.actual.max <= C.NET_REWIND_MAX * 1000 + 1e-8);
console.log('PASS artificial network', JSON.stringify(Object.fromEntries(Object.entries({ normal, jitter, slow }).map(([k, v]) => [k, { rtt: v.client.rtt.sum / v.client.rtt.n, receiveMin: v.client.receive.min, receiveMax: v.client.receive.max, requested: v.server.requested.sum / v.server.requested.n, capped: v.server.capped / v.server.requested.n }]))));
// 入力の追いつき・破棄、近接1回につき1計上、汗の対象ID。
{
  const { r, a, b } = room(); r.owners.set('a', 'a');
  for (let seq = 0; seq < 25; seq++) r.messages.input({ sessionId: 'a' } as any, { seq, dx: 0, dy: 0 });
  r.updatePlayers(.05); const m = r.measure!.client('a'); assert.equal(m.dropped, 5); assert.equal(m.catchup, 1); assert.equal(m.queue.max, 20);
  a.viewT = 0; r.elapsed = 1; a.cooldownUntil = 0; b.x = a.x + 20;
  r.attack('a', 0); assert.equal(m.requested.n, 1); assert.equal(m.capped, 1);
  assert.equal(r.fx.find((f) => f.kind === 'sweat')?.target, 'p:b');
}
// 実処理時間とtick間隔の単位、終了ログ1行・重複/不正レポート拒否・欠損表示。
{
  const { r } = room(); const original = performance.now; let ms = 0;
  performance.now = () => ms;
  const tickGame = (r as any).tickGame; (r as any).tickGame = () => { ms += 3; };
  r.tick(.05); ms = 50; r.tick(.05); performance.now = original; (r as any).tickGame = tickGame;
  near(r.measure!.tick.max, 3); near(r.measure!.interval.max, 50);
  const dir = mkdtempSync(join(tmpdir(), 'netmeasure-')); GameRoom.logFile = join(dir, 'match.jsonl');
  const sent: string[] = []; (r.clients as any).push({ sessionId: 'a', send: (type: string) => sent.push(type) }, { sessionId: 'b', send: () => {} });
  r.startFinale(0, 'timeout', null); assert.ok(sent.includes('netFinish'));
  const value = new ClientMeasure().report();
  r.messages.netReport({ sessionId: 'a' } as any, { id: r.measureId, value });
  value.rtt.add(999); r.messages.netReport({ sessionId: 'a' } as any, { id: r.measureId, value });
  r.flushLog(); r.writeLog('timeout');
  const rows = readFileSync(GameRoom.logFile, 'utf8').trim().split('\n'); assert.equal(rows.length, 1);
  const net = JSON.parse(rows[0]).net; assert.equal(net.clients.a.rtt.n, 0); assert.deepEqual(net.missingClients, ['b']);
  GameRoom.logFile = ''; rmSync(dir, { recursive: true });
}
// 加速の重複・追走・すれ違い: 既存の速度式と巻き戻し判定を再現。
for (const scenario of ['normal', 'stacked', 'chase', 'crossing'] as const) {
  const { r, a, b } = room();
  if (scenario === 'stacked') {
    b.st.accel = { until: Infinity, speed: CHARS.ierutan.skill.speed }; b.boostUntil = Infinity;
    b.ult = { form: 'melee', tier: 0, until: Infinity, pending: false };
  }
  const speed = r.speedOf(b), direction = scenario === 'crossing' ? -1 : 1;
  a.x = 1450; b.x = 1470; const start = b.x;
  for (let i = 0; i <= 10; i++) { r.elapsed = i * .05; b.x = start + direction * speed * r.elapsed; if (scenario === 'chase') a.x = 1450 + r.speedOf(a) * r.elapsed; r.recordHist(); }
  a.viewT = .275; const historical = r.rewound([target(r)], r.lagT(a)!)[0];
  near(historical.x, start + direction * speed * .275);
  const aim = historical.x >= a.x ? 0 : Math.PI;
  const expected = r.inArc(a, historical.x, historical.y, historical.r, aim, C.ATTACK_RANGE, C.ATTACK_ARC);
  const hp = b.hp; r.attack('a', aim); assert.equal(b.hp < hp, expected);
  console.log('PASS trajectory', scenario, { speed, gapNow: b.x - a.x, gapRewound: historical.x - a.x, hit: b.hp < hp });
}
{
  const { r } = room(); r.elapsed = 1; r.recordHist(); r.elapsed = 1.1;
  const assist = r.summonAssist(1, 0, 'shirakami'), t = target(r, `p:${assist.id}`);
  r.recordHist(); assert.equal(r.rewound([t], 1.05).length, 0); assert.equal(r.rewound([t], 1.1).length, 1);
  console.log('PASS assist appearance');
}
// ビィの接触: 双方の通常速度・重複加速、tick 50/100/150ms で交差を走査。すべて接触を取得。
for (const dt of [.05, .1, .15]) {
  const { r, a, b } = room(); a.char = b.char = 'bii';
  for (const p of [a, b]) { p.st.accel = { until: Infinity, speed: CHARS.ierutan.skill.speed }; p.boostUntil = Infinity; p.ult = { form: 'melee', tier: 0, until: Infinity, pending: false }; r.skill(p.id); }
  const step = r.speedOf(a) * dt, reach = C.PLAYER_RADIUS + CHARS.bii.skill.touch;
  a.x = 1500 - step / 2; b.x = 1500 + step / 2;
  r.updateEnts(0);
  const e = r.ents.find((e) => e.kind === 'overload' && e.owner === a.id)!;
  const before = e.marks.length;
  r.beginContactTick(); a.x += step; b.x -= step; r.updateEnts(dt); r.finishContactTick();
  const missed = before === 0 && e.marks.length === 0;
  assert.equal(missed, false);
  console.log('PASS contact reproduction', { dtMs: dt * 1000, speed: r.speedOf(a), relativeStep: step * 2, reach, missed });
}
// 50ms tick のcatchupによる2stepの交差でも接触を取得する。
{
  const { r, a, b } = room(); a.char = b.char = 'bii';
  for (const p of [a, b]) {
    p.st.accel = { until: Infinity, speed: CHARS.ierutan.skill.speed }; p.boostUntil = Infinity;
    p.ult = { form: 'melee', tier: 0, until: Infinity, pending: false }; r.skill(p.id);
    p.inputs = Array.from({ length: C.NET_CATCHUP + 1 }, (_, seq) => ({ seq, dx: p === a ? 1 : -1, dy: 0 }));
  }
  const step = r.speedOf(a) * C.NET_STEP * 2; a.x = 1500 - step / 2; b.x = 1500 + step / 2;
  r.updateEnts(0); r.beginContactTick(); r.updatePlayers(C.NET_STEP); r.updateEnts(C.NET_STEP); r.finishContactTick();
  const e = r.ents.find((e) => e.kind === 'overload' && e.owner === a.id)!;
  assert.ok(a.x > b.x); assert.equal(e.marks.length, 1); assert.equal(r.measure!.client('a').catchup, 1);
  console.log('PASS contact catchup reproduction', { tickMs: 50, steps: 2, relativeStep: step * 2, missed: false });
}
C.NET_MEASURE = false; { const { r } = room(); assert.equal(r.measure, null); } C.NET_MEASURE = true;
const h = new Histogram(); for (let i = 0; i < 100000; i++) h.add(i); assert.equal(h.buckets.length, LIMITS.length + 1);
console.log('ALL PASS netmeasure');
