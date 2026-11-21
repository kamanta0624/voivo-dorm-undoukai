import assert from 'node:assert/strict';
import { GameRoom, thingId } from '../src/server/GameRoom';
import { CONFIG as C } from '../src/shared/config';
import { CHARS } from '../src/shared/chars';

function setup() {
  const r = new GameRoom(); r.setSimulationInterval = (() => {}) as any; r.lock = (() => {}) as any;
  Object.defineProperty(r, 'clients', { value: [] }); r.onCreate({ e2e: 'netfix' });
  const a = r.addPlayer('a', 0, false), b = r.addPlayer('b', 1, false);
  a.char = b.char = 'bii'; r.startMatch(); r.beginPlay();
  for (const p of r.players.values()) { p.st.test = { until: Infinity, noAuto: true }; if (p.bot) { p.alive = false; p.respawnAt = Infinity; } }
  r.bosses.forEach((boss) => Object.assign(boss, { x: -500, y: -500 }));
  Object.assign(a, { x: 1500, y: 900 }); Object.assign(b, { x: 1600, y: 900 });
  r.walls = []; r.materials = []; r.items = []; r.couriers = []; r.courierAt = Infinity;
  r.skill('a');
  const effect = r.ents.find((e) => e.kind === 'overload' && e.owner === 'a')!;
  const has = (id = 'p:b') => effect.marks.some((m: any) => m.id === id);
  return { r, a, b, effect, has };
}
const finish = (r: GameRoom) => { r.updateEnts(.05); r.finishContactTick(); };
const target = (r: GameRoom) => r.enemyThings(0).find((t) => thingId(t) === 'p:b')!;

// 停止・低速: 終点判定と同じ結果。相対速度0、最接近時刻の両端、接線も確認。
for (const [label, start, end, expected] of [
  ['stopped-in', [49, 0], [49, 0], true], ['stopped-out', [51, 0], [51, 0], false],
  ['slow-in', [45, 0], [44, 0], true], ['slow-out', [60, 0], [58, 0], false],
  ['past-segment', [70, 0], [60, 0], false], ['future-segment', [60, 0], [70, 0], false],
  ['tangent', [-100, 50], [100, 50], true], ['near-miss', [-100, 50.01], [100, 50.01], false],
] as const) {
  const { r, a, b, has, effect } = setup(); b.x = a.x + start[0]; b.y = a.y + start[1];
  r.beginContactTick(); b.x = a.x + end[0]; b.y = a.y + end[1]; finish(r);
  assert.equal(has(), expected, label); r.updateEnts(.05); assert.equal(effect.marks.length, expected ? 1 : 0, '同じ相手は1回');
  console.log('PASS contact', label);
}
{
  const { r, a, b, has } = setup(); b.x = a.x + 60;
  r.beginContactTick(); a.x += 300; b.x += 300; finish(r); assert.equal(has(), false);
}
// 人間の実入力・catchupを通し、tickが自動的に始点を保存して終点で確定する。
for (const lateJump of [false, true]) {
  const { r, a, b, has } = setup(); r.skill('b');
  for (const p of [a, b]) {
    p.st.accel = { until: Infinity, speed: CHARS.ierutan.skill.speed }; p.boostUntil = Infinity;
    p.ult = { form: 'melee', tier: 0, until: Infinity, pending: false };
    p.inputs = Array.from({ length: C.NET_CATCHUP + 1 }, (_, seq) => ({ seq, dx: p === a ? 1 : -1, dy: 0 }));
  }
  const d = r.speedOf(a) * C.NET_STEP * 2; a.x = 1500 - d / 2; b.x = 1500 + d / 2;
  if (lateJump) r.updateWarns = () => { assert.equal(has(), false, 'tick末尾まで予約を確定しない'); r.relocate('p:b', b, { x: 2500, y: 900 }); };
  r.tick(.05); assert.equal(has(), !lateJump); assert.equal(r.contactTick, null);
  console.log('PASS full tick catchup', { lateJump, hit: has() });
}
// 相手だけ／ビィだけ／両方の不連続は終点のみ。終点接触は有効。
for (const which of ['owner', 'target', 'both'] as const) for (const endContact of [false, true]) {
  const { r, a, b, has } = setup(); a.x = 1400; b.x = 1600; r.beginContactTick();
  if (which !== 'target') r.relocate('p:a', a, { x: 1700, y: 900 }); else a.x = 1700;
  if (which !== 'owner') r.relocate('p:b', b, { x: 1300, y: 900 }); else b.x = 1300;
  if (endContact) b.x = a.x + 10;
  finish(r); assert.equal(has(), endContact, which);
  console.log('PASS teleport', which, endContact);
}
for (const event of ['respawn', 'recall', 'boss', 'wall', 'appearance'] as const) {
  const { r, a, b, has } = setup();
  if (event === 'respawn' || event === 'recall') {
    const dest = event === 'respawn' ? C.SPAWNS[1] : { x: C.RECALL_ROOMS[1].x + C.RECALL_ROOMS[1].w / 2, y: C.RECALL_ROOMS[1].y + C.RECALL_ROOMS[1].h / 2 };
    a.x = (b.x + dest.x) / 2; a.y = (b.y + dest.y) / 2; r.beginContactTick();
    if (event === 'respawn') r.respawn(b); else { b.recallAt = -C.RECALL_HOLD; r.updatePlayers(0); }
    assert.ok(r.contactTick!.jumped.has('p:b')); finish(r); assert.equal(has(), false);
  } else if (event === 'boss') {
    const boss = r.bosses[1]; Object.assign(boss, { x: 1300, y: 900, base: 0 });
    r.bases[1] = [{ x: 1300, y: 900 }, { x: 1700, y: 900 }]; r.beginContactTick(); r.moveBoss(boss);
    finish(r); assert.equal(has('boss:1'), false);
  } else if (event === 'wall') {
    Object.assign(a, { x: 1510, y: 851 }); Object.assign(b, { x: 1500, y: 900 });
    r.walls = [{ x: 1490, y: 890, w: 20, h: 20 }]; r.beginContactTick(); r.unstick();
    assert.ok(r.contactTick!.jumped.has('p:b')); assert.equal(b.x, 1520); finish(r); assert.equal(has(), false);
  } else {
    r.beginContactTick(); const assist = r.summonAssist(1, 0, 'shirakami');
    r.relocate(`p:${assist.id}`, assist, { x: 1700, y: 900 }); finish(r); assert.equal(has(`p:${assist.id}`), false);
  }
  console.log('PASS discontinuity', event);
}
// send=false等でelapsedが進まない場合でも、前tickの印を次tickへ持ち越さない。
{
  const { r, a, b, has } = setup(); r.beginContactTick(); r.relocate('p:b', b, { x: a.x - 100, y: a.y }); finish(r); assert.equal(has(), false);
  r.beginContactTick(); b.x = a.x + 100; finish(r); assert.equal(has(), true);
}
// targetable・対象種類・体中心の基準を維持。
{
  const { r, a, b, has } = setup(); b.x = a.x; b.st.hiddenTest = { until: Infinity, hidden: true };
  r.beginContactTick(); finish(r); assert.equal(has(), false);
  delete b.st.hiddenTest; const boss = r.bosses[1]; Object.assign(boss, { x: a.x, y: a.y + r.bodyOf(a).y - r.body({ k: 'boss', o: boss, x: a.x, y: a.y, r: C.BOSS_RADIUS }).y });
  r.beginContactTick(); finish(r); assert.equal(has('boss:1'), true);
}
// 中間・最古・最新のサンプルと完全一致。最新より後は現在位置。
{
  const { r, b } = setup();
  for (const [time, x] of [[1, 1500], [1.1, 1510], [1.2, 1520]]) { r.elapsed = time; b.x = x; r.recordHist(); }
  b.x = 1600; r.elapsed = 1.25;
  for (const [time, x] of [[1, 1500], [1.1, 1510], [1.2, 1520], [1.200001, 1600], [1.25, 1600]]) assert.equal(r.rewound([target(r)], time)[0].x, x);
  r.relocate('p:b', b, { x: 1700, y: 900 }); assert.equal(r.rewound([target(r)], 1.23)[0].x, 1700);
  r.elapsed = 1.3; r.relocate('p:b', b, { x: 1800, y: 900 }); b.x = 1810; r.recordHist(); b.x = 1900;
  assert.equal(r.rewound([target(r)], 1.3)[0].x, 1810, '不連続後の同tickの通常移動も記録時刻では記録を使う');
  console.log('PASS exact sample and newer-than-history');
}
console.log('ALL PASS netfix');
