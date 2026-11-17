// サーバー単体のテスト（ブラウザなし、数秒）。実行: npm run test:server
import { GameRoom, ROOM_COMBOS, ROOM_DIST, lottery } from '../src/server/GameRoom';
import MAP from '../src/shared/map.json';
import { CONFIG as C, roomLayout, roomKindAt, slotRate, wallRects, bossIntensity } from '../src/shared/config';
import { CHARS, visionRadius, moveWalls, charAtk } from '../src/shared/chars';
import { SKILLS, ENTS } from '../src/server/skills';
import { circleRect, circleBody, moveBody, lineOfSight, inDashShape } from '../src/shared/geom';
import { stepPlayer } from '../src/shared/netcode';
import { findPath } from '../src/server/pathfind';

let fails = 0;
const ok = (name: string, cond: boolean, detail: any = '') => {
  if (!cond) fails++;
  console.log(cond ? 'PASS' : 'FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail));
};
const T = C.TILE;
const MB = C.MELEE_BONUS, melee = (ch: string) => CHARS[ch].melee; // 近接補正

// 部屋を作り、a（陣営0）と b（陣営1）だけを中央ホールに置く。Botは盤外で無効化
function mk(a: string, b?: string) {
  const r: any = new (GameRoom as any)();
  r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [] });
  r.onCreate();
  r.addPlayer('a', 0, false); r.players.get('a').char = a;
  if (b) { r.addPlayer('b', 1, false); r.players.get('b').char = b; }
  r.startMatch(); r.beginPlay();
  for (const p of r.players.values()) if (p.bot) { p.alive = false; p.respawnAt = 1e9; p.x = p.y = -999; }
  r.bosses.forEach((bo: any) => { bo.x = -500; bo.y = -500; });
  r.materials = []; r.items = []; r.couriers = []; r.courierAt = 1e9; r.notice = () => {}; // 資材・ご飯・コバコは各テストで置く
  const A = r.players.get('a'); Object.assign(A, { x: 1552, y: 900, face: 0 }); A.st.test = NOAUTO(); // 自動攻撃は各テストで有効にする（delete A.st.test）
  const B = b ? r.players.get('b') : null;
  if (B) { Object.assign(B, { x: 1592, y: 900 }); B.st.test = NOAUTO(); }
  return { r, A, B };
}
// テスト用: 自動攻撃しない状態（旧「手動」モードの代わり）
function NOAUTO() { return { until: Infinity, noAuto: true }; }
// 花丸の巨大拳が消えるまで飛ばす
const ents = (r: any, kind: string) => r.ents.filter((e: any) => e.kind === kind); // 場の物（種類別）
const upd = (r: any, kind: string, dt: number) => { for (const e of ents(r, kind)) ENTS[kind].update(r, e, dt); }; // 場の物の種類ごとの更新
const fly = (r: any) => { for (let i = 0; i < 200 && ents(r, 'fist').length; i++) upd(r, 'fist', 0.05); };
// 壁・バリケードと重なっていないか（移動の当たり判定の形。壁の終端・凸角は見た目より短く丸い）
const clear = (r: any, o: { x: number; y: number }, rad = C.PLAYER_RADIUS) => !r.obstacles().some((w: any) => circleBody(o.x, o.y, rad, w));
const inRoom = (p: any, h: any) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h;
const tileAt = (r: any, x: number, y: number) => r.tiles[Math.floor(y / T)][Math.floor(x / T)];
// 大将の拠点移動の予告を進めて、広範囲攻撃と移動まで終わらせる
const finish = (r: any) => { for (let i = 0; i < 1000 && r.phase === 'finale'; i++) r.tick(0.05, false); }; // 決着演出（finale）を最後まで進める
const finishMove = (r: any) => { r.now += C.BOSS_BLAST.warn; r.updateWarns(); };
// ご飯を置き場所（HEAL_SPOTS）すべてに置く
const putHeals = (r: any) => { for (const [x, y] of C.HEAL_SPOTS) r.items.push({ id: r.nextId++, kind: 'heal', team: -1, x, y }); };

console.log('--- 壁へのめり込み');
{
  // 吹雪: study の東壁（x=27タイル、x=432〜448px）の手前にいる敵を、壁へ向けてはじく
  const { r, A, B } = mk('whitecul', 'metan');
  Object.assign(A, { x: 360, y: 150 }); Object.assign(B, { x: 420, y: 150 }); // y=150: 扉（y=288〜368）のない所
  r.skill('a');
  ok('吹雪で壁際の敵を壁へはじいてもめり込まない', clear(r, B) && B.x < 27 * T, { x: B.x });
}
{
  // ドリル: study の南東の角（x=27, y=26 タイル付近）へ斜めにはじく
  const { r, A, B } = mk('metan', 'sayo');
  Object.assign(A, { x: 380, y: 360 }); Object.assign(B, { x: 410, y: 390 });
  A.tgt = null; A.face = Math.atan2(30, 30);
  r.skill('a'); r.updatePlayers(0.05); // ドリルは出ている間の毎tickで当たる
  ok('ドリルで壁の角へ斜めにはじいてもめり込まない', clear(r, B) && B.x < 27 * T && B.y < 26 * T && (B.x !== 410 || B.y !== 390), { x: B.x, y: B.y });
}
{
  // 大きな距離のはじきでも、1タイル厚の壁を通り抜けない
  const { r, B } = mk('metan', 'sayo');
  Object.assign(B, { x: 420, y: 150 });
  r.push({ k: 'p', o: B, x: B.x, y: B.y, r: C.PLAYER_RADIUS }, 1, 0, 500);
  ok('500pxのはじきでも壁を通り抜けない', clear(r, B) && B.x < 27 * T, { x: B.x });
}
{
  // 壁破壊で開いた穴の縁: study の南壁（y=26）のうち x=11〜13 を壊す
  const { r, A, B } = mk('hanamaru', 'metan');
  Object.assign(A, { x: 200, y: 400, face: Math.PI / 2 }); A.tgt = null;
  r.skill('a'); fly(r);
  const hole = r.broken.map(([x, y]: number[]) => `${x},${y}`).join(' ');
  // 穴の縁（壊れていない壁との境）に沿って斜めに歩く
  Object.assign(A, { x: 11 * T + 2, y: 25 * T + 8 });
  let bad = 0;
  for (let i = 0; i < 40; i++) { Object.assign(A, moveBody(A.x, A.y, -3, 3, C.PLAYER_RADIUS, r.obstacles())); if (!clear(r, A)) bad++; }
  ok('穴の縁を斜めに歩いても壁にめり込まない', bad === 0, { hole, at: [Math.round(A.x), Math.round(A.y)] });
  // 穴の縁にいる敵を、横の壁へ向けてはじく
  Object.assign(B, { x: 11 * T + 6, y: 26 * T + 8 });
  r.push({ k: 'p', o: B, x: B.x, y: B.y, r: C.PLAYER_RADIUS }, -1, 0, 120);
  ok('穴の中の敵を横の壁へはじいてもめり込まない', clear(r, B), { x: B.x, y: B.y });
}
{
  // 保険の押し出し: 壁と重なった状態を作ると、次のtickで空き位置へ（study の東壁 x=27タイル）
  const { r, B } = mk('sayo', 'metan');
  Object.assign(B, { x: 27 * T + 4, y: 300 });
  r.tick(0.05);
  ok('重なったキャラは毎tick押し出される', clear(r, B), { x: B.x, y: B.y });
}

console.log('--- 大将の部屋（試合ごとにランダム3部屋、左右同じ）');
{
  const seen = new Set<string>(); let good = true;
  for (let i = 0; i < 400; i++) {
    const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; Object.defineProperty(r, 'clients', { value: [] }); r.onCreate();
    const names: string[] = r.bossRooms;
    names.forEach((n) => seen.add(n));
    const L = roomLayout(names);
    const mirror = L.bases[0].every((p, k) => Math.abs(C.MAP_W - p.x - L.bases[1][k].x) < 1 && p.y === L.bases[1][k].y);
    if (names.length !== C.BOSS_ROOM_COUNT || new Set(names).size !== names.length || !names.every((n) => C.BOSS_ROOM_CANDIDATES.includes(n)) || !mirror) good = false;
    if (r.bases !== undefined && JSON.stringify(r.bases) !== JSON.stringify(L.bases)) good = false;
    if (!r.bosses.every((b: any, t: number) => b.x === r.bases[t][b.base].x)) good = false;
  }
  const possible = new Set(ROOM_COMBOS.filter((c) => c.sum <= C.BOSS_ROOM_DIST_SUM_MAX).flatMap((c) => c.names)); // 距離の上限以下の組み合わせに出てくる部屋
  ok('候補から3つ、重複なし、左右で同じ部屋、大将はそのどれかに出現（400試合）', good && seen.size === possible.size, [...seen]);
  const { r, A } = mk('sayo');
  const others = new Set<number>();
  for (let i = 0; i < 30; i++) { const b = r.bosses[1], before = b.base; r.damageBoss(b, C.BOSS_MOVE_THRESHOLD, A); finishMove(r); b.hp = C.BOSS_HP; if (b.base === before) others.add(-1); else others.add(b.base); }
  ok('逃亡は毎回いま居る部屋以外へ（3部屋を回る）', !others.has(-1) && others.size === 3, [...others]);
}

console.log('--- 復活時間（暴れ度どおり）');
for (const rage of [0, 15, 37, 200]) {
  const { r, B } = mk('sayo', 'metan'); B.rage = rage;
  r.damagePlayer(B, 999, 'a');
  const exp = Math.min(C.RESPAWN_MAX, C.RESPAWN_BASE + C.RESPAWN_COEF * rage);
  ok(`暴れ度${rage}: 復活${(B.respawnAt - r.now).toFixed(1)}秒（期待${exp}）。資材は落とさない`, Math.abs(B.respawnAt - r.now - exp) < 1e-9 && r.materials.length === 0);
}

console.log('--- E2E_HOOKS なしでは挙動が変わらない');
{
  const { r } = mk('sayo');
  const keys = Object.keys(r.messages);
  ok('テスト用のメッセージがない', !keys.some((k) => k.startsWith('e2e')), keys);
  ok('早送り倍率は1', r.speed === 1);
}

console.log('--- ロール倍率・特性');
const roles: Record<string, string> = { hanamaru: 'balance', sayo: 'attacker', zunko: 'attacker', whitecul: 'speed', aru: 'speed', mochiko: 'defense', metan: 'defense', ierutan: 'support', bii: 'support' };
for (const [ch, role] of Object.entries(roles)) {
  const { r, A } = mk(ch, 'sayo'); const R = C.ROLES[role], k = melee(ch) ? MB : { hp: 1, speed: 1, atk: 1 };
  const t = mk(ch, 'sayo'); const h0 = t.B.hp; t.r.attack('a'); if (CHARS[ch].aa[0].kind === 'shot') t.r.updateShots(0.2);
  ok(`${ch}（${role}${melee(ch) ? '・近接補正' : ''}）HP${r.maxHp(A).toFixed(1)} 移動${r.speedOf(A).toFixed(1)} 攻撃${h0 - t.B.hp} 視界${visionRadius(ch)}`,
    Math.abs(r.maxHp(A) - C.PLAYER_HP * R.hp * k.hp) < 1e-9 && Math.abs(r.speedOf(A) - C.PLAYER_SPEED * R.speed * k.speed) < 1e-9 && h0 - t.B.hp === Math.round(C.ATTACK_DAMAGE * R.atk * k.atk * C.DAMAGE_MULT) && visionRadius(ch) === C.VISION_RADIUS * R.vision);
}
{
  const a = mk('sayo', 'hanamaru'); a.r.attack('a');
  const D = 28 * MB.atk * C.DAMAGE_MULT; // sayo の通常攻撃（近接補正・全体の倍率込み）
  ok('balance: 近くに味方なしで被ダメ-20%', a.r.maxHp(a.B) - a.B.hp === Math.round(D * 0.8));
  const d = mk('sayo', 'metan'); d.r.attack('a');
  ok('defense: 被ダメ-20%', d.r.maxHp(d.B) - d.B.hp === Math.round(D * 0.8));
  const b = mk('sayo'); Object.assign(b.r.bosses[1], { x: 1592, y: 900 }); b.r.attack('a');
  ok('attacker: 大将へ×2', Math.abs(C.BOSS_HP - b.r.bosses[1].hp - D * 2) < 1e-9);
}

console.log('--- 技・壁破壊・照準・Bot');
{
  const { r } = mk('whitecul'); Object.assign(r.bosses[1], { x: 1620, y: 900 }); r.skill('a');
  ok('大将ははじかれない（ダメージは入る）', r.bosses[1].x === 1620 && r.bosses[1].hp < C.BOSS_HP);
  const z = mk('zunko', 'metan'); z.r.skill('a'); for (let i = 0; i < 5; i++) z.r.updateShots(0.05);
  ok('ずんだアローで敵が餅になり技を使えない', !!z.r.stat(z.B, 'mochi') && (z.B.skillReadyAt = 0, z.r.skill('b'), z.B.skillReadyAt === 0));
  const w = mk('hanamaru'); Object.assign(w.A, { x: 200, y: 400, face: Math.PI / 2 }); w.A.tgt = null;
  const los0 = lineOfSight(200, 400, 200, 470, w.r.walls), path0 = findPath(w.A, { x: 200, y: 470 }, w.r.walls, w.r.walls).length;
  w.r.skill('a'); fly(w.r);
  ok('壁破壊が視界・経路探索に即反映', !los0 && lineOfSight(200, 400, 200, 470, w.r.walls) && findPath(w.A, { x: 200, y: 470 }, w.r.walls, w.r.walls).length < path0);
  const pe = mk('hanamaru'); Object.assign(pe.A, { x: 248, y: 60, face: -Math.PI / 2 }); pe.A.tgt = null; pe.r.skill('a'); fly(pe.r);
  ok('外周の壁は壊せない（拳は外周の壁に当たると消える）', pe.r.broken.length === 0 && ents(pe.r, 'fist').length === 0);
  const m = mk('sayo', 'metan'); m.A.aim = 'nearest'; delete m.A.st.test; m.A.bot = true; m.A.dy = 1; m.r.updatePlayers(0.05);
  ok('移動しながら自動攻撃', m.A.y > 900 && m.B.hp < m.r.maxHp(m.B));
}

console.log('--- オートアタック（射程・CT・移動中・照準モード4つ）');
{
  const r0 = mk('sayo', 'metan'); r0.A.aim = 'nearest'; delete r0.A.st.test; r0.B.x = 1552 + C.ATTACK_RANGE + C.PLAYER_RADIUS + 5; r0.r.updatePlayers(0.05);
  const full = r0.r.maxHp(r0.B);
  ok('射程外の敵には自動攻撃しない', r0.B.hp === full);
  r0.B.x = 1592; r0.r.updatePlayers(0.05); const h1 = r0.B.hp; r0.r.now += C.ATTACK_COOLDOWN_MELEE / 2; r0.r.updatePlayers(0.05);
  ok('射程内なら自動攻撃し、CTが明けるまでは次を撃たない', h1 < full && r0.B.hp === h1);
  r0.r.now += C.ATTACK_COOLDOWN_MELEE; r0.r.updatePlayers(0.05);
  ok('CTが明けたら次を自動で撃つ', r0.B.hp < h1);
  // 照準: 近い敵c（HP多め）、遠い敵b（HP少なめ）、大将も射程内
  const t = mk('sayo', 'metan'); t.r.addPlayer('c', 1, false); const Cc = t.r.players.get('c');
  Object.assign(Cc, { x: 1530, y: 900, hp: 120, alive: true, char: 'metan' }); Object.assign(t.B, { x: 1592, y: 900, hp: 30 }); Object.assign(t.r.bosses[1], { x: 1552, y: 950 });
  const sel = (mode: string) => { t.A.aim = mode; t.r.updatePlayers(0); return t.A.tgt ? (t.A.tgt.k === 'boss' ? 'boss' : t.A.tgt.o.id) : null; };
  const got = { nearest: sel('nearest'), lowhp: sel('lowhp'), boss: sel('boss'), courier: sel('courier') };
  ok('照準モード: 一番近い敵/一番HPが低い敵/大将優先/コバコ（コバコがいなければ一番近い敵）', got.nearest === 'c' && got.lowhp === 'b' && got.boss === 'boss' && got.courier === 'c', got);
  t.r.bosses[1].x = -500; ok('大将優先: 射程内に大将がいなければ一番近い敵', sel('boss') === 'c');
  const mv = mk('sayo', 'metan'); mv.A.aim = 'nearest'; delete mv.A.st.test; mv.A.bot = true; mv.A.dy = 1; mv.r.updatePlayers(0.05);
  ok('移動しながら自動攻撃する', mv.A.y > 900 && mv.B.hp < mv.r.maxHp(mv.B));
}

console.log('--- 攻撃力の底上げ・大将の部屋の距離');
{
  const { r, A, B } = mk('hanamaru', 'sayo'); r.attack('a');
  ok(`通常攻撃に全体の倍率×${C.DAMAGE_MULT}`, r.maxHp(B) - B.hp === Math.round(C.ATTACK_DAMAGE * MB.atk * C.DAMAGE_MULT));
  const s = mk('whitecul', 'sayo'); s.r.skill('a'); ok('技にも全体の倍率', s.r.maxHp(s.B) - s.B.hp === Math.round(CHARS.whitecul.skill.dmg * C.DAMAGE_MULT));
  const pass = ROOM_COMBOS.filter((c) => c.sum <= C.BOSS_ROOM_DIST_SUM_MAX);
  ok(`大将の部屋の組み合わせ ${ROOM_COMBOS.length}通り中 ${pass.length}通りが上限${C.BOSS_ROOM_DIST_SUM_MAX}px以下`, ROOM_COMBOS.length === 20 && pass.length >= 1 && pass.length < 20, ROOM_DIST);
  ok('大将の候補は図書室を含む6部屋（開始部屋の dining は除く）', C.BOSS_ROOM_CANDIDATES.length === 6 && !C.BOSS_ROOM_CANDIDATES.includes('dining') && C.BOSS_ROOM_CANDIDATES.includes('library'));
  let good = true;
  for (let i = 0; i < 100; i++) { const r2: any = new (GameRoom as any)(); r2.setSimulationInterval = () => {}; Object.defineProperty(r2, 'clients', { value: [] }); r2.onCreate(); if (r2.bossRooms.reduce((a: number, n: string) => a + ROOM_DIST[n], 0) > C.BOSS_ROOM_DIST_SUM_MAX) good = false; }
  ok('試合の大将の部屋は、距離の合計が上限以下の組み合わせだけ（100試合）', good);
}

console.log('--- 抽選（各1万回）');
{
  const N = 10000;
  const near = (cnt: number[], w: number[]) => { const tot = w.reduce((a, b) => a + b, 0); return cnt.every((c, i) => Math.abs(c / N - w[i] / tot) < 0.02); };
  const fmt = (cnt: number[]) => cnt.map((c) => `${(c / N * 100).toFixed(1)}%`).join('/');
  const u = mk('sayo'); const form = Object.keys(C.ULT_FORMS), fc = form.map(() => 0), tc = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) { u.A.ult = null; u.r.takeItem(u.A, { id: i, kind: 'box_ult', team: -1, x: 0, y: 0 }); fc[form.indexOf(u.A.ult.form)]++; tc[u.A.ult.tier]++; }
  ok(`ウルトの変身先 ${form.join('/')} = ${fmt(fc)}（均等）`, near(fc, form.map(() => 1)));
  ok(`ウルト箱の強さ = ${fmt(tc)}（期待 ${C.POWER_WEIGHTS.join('/')}）。バランスブレーカーは出ない`, near(tc, C.POWER_WEIGHTS) && tc[3] === 0);
  const as = mk('sayo'); const ac = [0, 0, 0, 0], ch: Record<string, number> = {};
  for (let i = 0; i < N; i++) { as.r.takeItem(as.A, { id: i, kind: 'box_assist', team: -1, x: 0, y: 0 }); const a = [...as.r.players.values()].find((p: any) => p.assist); ac[a.tier]++; ch[a.char] = (ch[a.char] ?? 0) + 1; as.r.players.delete(a.id); }
  ok(`アシスト箱の強さ = ${fmt(ac)}（期待 ${C.POWER_WEIGHTS.join('/')}）。バランスブレーカーは出ない`, near(ac, C.POWER_WEIGHTS) && ac[3] === 0);
  ok(`アシストは3人からランダム ${JSON.stringify(ch)}`, Object.keys(ch).length === 3 && near(Object.keys(C.ASSIST.units).map((k) => ch[k]), [1, 1, 1]));
  const box = { ult: 0, assist: 0 } as Record<string, number>, k = mk('sayo');
  for (let i = 0; i < N; i++) { k.r.spawnCourier(); box[k.r.couriers[0].box]++; }
  ok(`コバコの荷物 ult/assist = ${fmt([box.ult, box.assist])}（期待 ${C.COURIER.box.ult}/${C.COURIER.box.assist}）`, near([box.ult, box.assist], [C.COURIER.box.ult, C.COURIER.box.assist]));
}

console.log('--- ウルト・アシスト・回復アイテム');
{
  // ウルト: 撤退中なら復活後に始まる。撃破で元のキャラがHP100%で戻る
  const u = mk('sayo');
  u.A.ult = { form: 'melee', tier: 1, until: u.r.now + 20, pending: false }; u.A.hp = u.r.maxHp(u.A); u.A.skillReadyAt = 0; u.r.skill('a');
  ok('ウルト中はキャラ技を使えない', u.A.skillReadyAt === 0);
  u.r.damagePlayer(u.A, 9999, null);
  ok('ウルト中に撃破されると、元のキャラがその場にHP100%で戻る', u.A.alive && !u.A.ult && u.A.hp === u.r.maxHp(u.A));
  Object.assign(u.A, { alive: false, respawnAt: u.r.now + 5 }); u.r.giveUlt(u.A, 2);
  ok('ウルト: 撤退中に選ばれたら復活まで始まらない', u.A.ult.pending);
  u.r.now += 5; u.r.updatePlayers(0.05);
  ok('ウルト: 復活後に効果時間が始まる', u.A.alive && !u.A.ult.pending && Math.abs(u.A.ult.until - (u.r.now + C.ULT_DURATION)) < 0.1);
  u.r.now = u.A.ult.until; u.r.updatePlayers(0.05); ok('ウルト: 時間切れで元に戻る（HP100%）', !u.A.ult && u.A.hp === u.r.maxHp(u.A));
  // アシスト: 大将の所に出る。復活しない。回復アイテム・資材・荷物を拾わない
  const s = mk('sayo'); Object.assign(s.r.bosses[0], { x: 1300, y: 900 }); const a = s.r.summonAssist(0, 1);
  ok('アシスト: 自陣の大将の所に現れ、攻めに行く', a && Math.hypot(a.x - 1300, a.y - 900) < 60 && a.bot && a.assist);
  s.r.items.push({ id: 9, kind: 'heal', team: -1, x: a.x, y: a.y }, { id: 10, kind: 'box_ult', team: -1, x: a.x, y: a.y }); s.r.materials.push({ id: 11, x: a.x, y: a.y }); a.hp = 10; s.r.updatePlayers(0.05);
  ok('アシスト: 回復アイテム・荷物・資材を拾わない', s.r.items.length === 2 && s.r.materials.length === 1 && s.r.teams[0].toku === C.TOKU_INIT);
  s.r.damagePlayer(a, 9999, 'a'); ok('アシスト: 撃破されると復活しない（消える）', !s.r.players.has(a.id));
  // 回復アイテム: 触れると回復（最大HPまで）。部屋の中に出る
  const h = mk('sayo'); h.A.hp = 20; h.r.items.push({ id: 1, kind: 'heal', team: -1, x: h.A.x + 3, y: h.A.y }); h.r.updatePlayers(0.05);
  ok(`回復アイテム: 触れると${C.HEAL_ITEM_AMOUNT}回復`, h.A.hp === 20 + C.HEAL_ITEM_AMOUNT && h.r.items.length === 0);
  const g = mk('sayo'); putHeals(g.r);
  const pts = g.r.items.map((i: any) => [i.x, i.y]);
  ok(`ご飯は給湯室（kitchen）だけに左右${C.HEAL_SPOTS.length / 2}個ずつ（上限2）、左右対称`, pts.length === C.HEAL_SPOTS.length && pts.length === 4 && pts.every(([x, y]: number[]) => pts.some(([x2, y2]: number[]) => Math.abs(x2 - (C.MAP_W - x)) < 1 && y2 === y) && roomKindAt(Math.floor(x / T), Math.floor(y / T)) === 'kitchen'));
}

console.log('--- 技の変更（ierutan の加速）・きりたん');
{
  const ie = mk('ierutan'); ie.A.hp = 30; ie.r.skill('a'); const sp0 = ie.r.speedOf(ie.A); ie.r.updatePlayers(1);
  ok(`ierutan の加速: 移動×${CHARS.ierutan.skill.speed}、毎秒${CHARS.ierutan.skill.regen}回復`, Math.abs(sp0 - C.PLAYER_SPEED * MB.speed * CHARS.ierutan.skill.speed) < 1e-9 && Math.abs(ie.A.hp - 33) < 1e-9);
  const k = mk('kiritan', 'metan'); k.A.aim = 'nearest'; delete k.A.st.test;
  ok(`きりたん: 足が遅い（×${CHARS.kiritan.mult.speed}）`, k.r.speedOf(k.A) === C.PLAYER_SPEED * CHARS.kiritan.mult.speed!);
  Object.assign(k.B, { x: 1552 + 200 }); k.r.updatePlayers(0.05);
  ok('きりたん: 遠い敵にはきりたん砲（弾速遅め）', k.r.shots.length === 1 && k.r.shots[0].kind === 'cannon' && k.r.shots[0].sp < C.BULLET_SPEED);
  const k2 = mk('kiritan', 'metan'); k2.A.aim = 'nearest'; delete k2.A.st.test; k2.r.updatePlayers(0.05);
  ok('きりたん: 近い敵には包丁（ダメージそれなり）', k2.r.shots.length === 0 && k2.r.maxHp(k2.B) - k2.B.hp === Math.round(C.ATTACK_DAMAGE * CHARS.kiritan.aa[0].dmg * C.DAMAGE_MULT * 0.8));
}

console.log('--- ファンネル（経路で届く敵だけ、囲んで止まって撃つ）');
{
  // 壁の向こう（study の中の敵に、廊下から）: 直線は近いが回り道が長い → 対象にしない
  const w = mk('mochiko', 'metan'); Object.assign(w.A, { x: 150, y: 568 }); Object.assign(w.B, { x: 150, y: 380 }); w.r.skill('a'); upd(w.r, 'funnel', 0.05); // 廊下と study（直線188px、回り道は bath 経由で約600px）
  ok(`壁の向こうで回り道が${CHARS.mochiko.skill.pathMax}pxを超える敵は狙わない`, ents(w.r, 'funnel').every((f: any) => f.tgt === null));
  const f = mk('mochiko', 'metan'); Object.assign(f.B, { x: 1552 + 150, y: 900 }); f.B.hp = 9999; f.r.skill('a');
  for (let i = 0; i < 60; i++) { f.r.now += 0.05; upd(f.r, 'funnel', 0.05); }
  const ang = ents(f.r, 'funnel').map((x: any) => Math.atan2(x.y - f.B.y, x.x - f.B.x));
  const spread = new Set(ang.map((a: number) => Math.round(((a + Math.PI) / (Math.PI / 3)) % 6))).size;
  ok(`6機が敵の周りの別々の位置に散らばる（方向 ${spread}/6 種類、敵からの距離 ${ents(f.r, 'funnel').map((x: any) => Math.round(Math.hypot(x.x - f.B.x, x.y - f.B.y))).join(',')}）`, spread >= 5);
  ok('射撃して敵にダメージ', f.B.hp < 9999);
}

console.log('--- 旧5 大将の反撃');
{
  const { r, A } = mk('sayo'); const boss = r.bosses[1]; Object.assign(boss, { x: 1640, y: 900 });
  Object.assign(A, { x: boss.x - (C.BOSS_RADIUS + C.PLAYER_RADIUS + 8), y: boss.y, face: 0 });
  r.attack('a'); const hits: number[] = [];
  for (let i = 0; i < 30; i++) { const h = A.hp; r.updateBosses(); r.now += 0.05; if (A.hp !== h) hits.push(h - A.hp); }
  ok(`大将を攻撃した敵が大将から反撃される（${C.BOSS_DAMAGE}×${C.BOSS_DAMAGE_MULT}ダメージ、${C.BOSS_COOLDOWN}秒ごと）`, hits.length === 2 && hits.every((d) => d === Math.round(C.BOSS_DAMAGE * C.BOSS_DAMAGE_MULT)), hits);
}

console.log('--- Bot の詰まり');
{
  const { r, A } = mk('metan'); A.bot = true; A.role = 'gather'; A.aim = C.BOT_AIM;
  r.materials.push({ id: 1, x: -500, y: -500 }, { id: 2, x: 1300, y: 900 }); // 1は届かない場所
  Object.assign(A, { x: 1552, y: 900 });
  r.botThink(A, r.obstacles()); const first = A.goal;
  for (let i = 0; i < (C.BOT_STUCK_TIME + 0.5) * 20; i++) { r.now += 0.05; r.botThink(A, r.obstacles()); r.updatePlayers(0.05); }
  ok(`詰まり（${C.BOT_STUCK_TIME}秒ほぼ動かない）で目的地を変える: ${first} → ${A.goal}`, first !== A.goal || A.penalty.size > 0);
}

console.log('--- バランス調整（回復アイテム間隔・近接補正・ウルト）');
{
  const h = mk('sayo'); putHeals(h.r);
  const [hx, hy] = C.HEAL_SPOTS[0]; Object.assign(h.A, { x: hx, y: hy, hp: 10 }); h.r.updatePlayers(0.05); const n0 = h.r.items.length;
  Object.assign(h.A, { x: 1552, y: 900 });
  const run = (sec: number) => { for (let i = 0; i < sec * 20; i++) { h.r.now += 0.05; h.r.updatePlayers(0.05); h.r.updateHeals(); } };
  run(C.HEAL_RESPAWN - 0.5); const n1 = h.r.items.length; run(1); const n2 = h.r.items.length; run(C.HEAL_RESPAWN * 2); const n3 = h.r.items.length;
  const back = h.r.items.some((i: any) => i.kind === 'heal' && i.x === hx && i.y === hy);
  ok(`ご飯はコバコなしで、欠けた置き場所ごとに${C.HEAL_RESPAWN}秒で再出現（上限は置き場所の数${C.HEAL_SPOTS.length}。1個ごとに徳${C.TOKU.eat}）`, h.r.couriers.length === 0 && n0 === C.HEAL_SPOTS.length - 1 && n1 === n0 && n2 === C.HEAL_SPOTS.length && n3 === n2 && back && Math.abs(h.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.eat)) < 1e-9, { n0, n1, n2, n3 });
  ok('回復量は旧の2倍（30→60）', C.HEAL_ITEM_AMOUNT === 60);
  const z = mk('zunko'), k = mk('kiritan'), s = mk('sayo');
  ok('近接補正は zunko・kiritan 以外（HP×1.2・移動×1.1・攻撃×1.2）', z.r.maxHp(z.A) === 70 && k.r.maxHp(k.A) === 100 && Math.abs(s.r.maxHp(s.A) - 84) < 1e-9 && MB.hp === 1.2 && MB.speed === 1.1 && MB.atk === 1.2);
  const u = mk('sayo'); u.A.ult = { form: 'melee', tier: 1, until: u.r.now + 20, pending: false };
  ok(`ウルト変身中の最大HPは旧倍率の0.8倍×強さ（近接 1.8→1.44、レベル2は×${C.POWER_MULT[1]}）`, Math.abs(u.r.maxHp(u.A) - 84 * 1.8 * 0.8 * C.POWER_MULT[1]) < 1e-9);
  u.r.now = 5; u.A.hp = 10; u.r.giveUlt(u.A, 3);
  ok('変身中に重ねてウルトが付いたら効果時間だけリセット（変身先・強さ・HPはそのまま）', u.A.ult.form === 'melee' && u.A.ult.tier === 1 && u.A.hp === 10 && Math.abs(u.A.ult.until - (5 + C.ULT_DURATION)) < 1e-9);
}

console.log('--- 旧開幕（INTRO_MODE を old に切り替え）');
{
  const mode = C.INTRO_MODE; (C as any).INTRO_MODE = 'old';
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; Object.defineProperty(r, 'clients', { value: [] });
  r.onCreate(); r.onJoin({ sessionId: 'h' }); r.startMatch();
  const H = r.players.get('h'), x0 = H.x, intro = C.INTRO_LINEUP + C.TEAM_SIZE * C.INTRO_CUTIN;
  let t = 0, seq = 0; const step = (dx: number, dy: number) => { H.inputs.push({ seq: ++seq, dx, dy }); r.tick(0.05); t += 0.05; };
  let moved = false; while (r.phase === 'intro') { step(1, 0); if (r.phase === 'intro' && H.x !== x0) moved = true; }
  ok(`旧開幕: 演出 ${intro}秒（横並び${C.INTRO_LINEUP}秒＋カットイン${C.INTRO_CUTIN}秒×${C.TEAM_SIZE}）の間は動けない`, Math.abs(t - intro) < 0.06 && !moved && r.timeLeft === C.MATCH_TIME, { t });
  const room = C.START_ROOMS[0]; let out = false;
  while (r.phase === 'countdown') { step(1, 1); if (H.x < room.x || H.x > room.x + room.w || H.y < room.y || H.y > room.y + room.h) out = true; }
  ok(`旧開幕: カウント${C.COUNTDOWN}秒の間は動けるが、開始した部屋から出られない。0で試合開始`, Math.abs(t - intro - C.COUNTDOWN) < 0.06 && H.x !== x0 && !out && r.phase === 'playing', { x: H.x, y: H.y, room });
  (C as any).INTRO_MODE = mode;
}

console.log('--- 開始の演出（新開幕）・カウント・終了の集合');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {};
  const sent: any[] = []; Object.defineProperty(r, 'clients', { value: [{ sessionId: 'h', send: (t: string, m: any) => sent.push([t, m]) }] });
  r.onCreate(); r.onJoin({ sessionId: 'h' }); r.startMatch();
  const H = r.players.get('h'), x0 = H.x, y0 = H.y, intro = C.INTRO2.cuts.reduce((a, [, x]) => a + x, 0);
  let t = 0, seq = 0; const step = (dx: number, dy: number) => { H.inputs.push({ seq: ++seq, dx, dy }); r.tick(0.05); t += 0.05; };
  r.sendSnapshots(); const s0 = sent.filter(([k]) => k === 's').pop()[1];
  ok('新開幕: 開幕中は敵大将の位置と「散らかった一角」を送る（カメラが映す）', s0.bosses.length === 2 && !!s0.introMess && r.materials.filter((m: any) => Math.hypot(m.x - s0.introMess.x, m.y - s0.introMess.y) <= C.INTRO2.messR).length >= 1);
  let moved = false; while (r.phase === 'intro') { step(1, 0); if (r.phase === 'intro' && H.x !== x0) moved = true; } // 0 秒になった tick からはカウント（動ける）
  ok(`新開幕: カット ${C.INTRO2.cuts.map(([k, x]) => `${k}${x}秒`).join('→')}（計${intro}秒）の間は動けない`, Math.abs(t - intro) < 0.06 && !moved && r.timeLeft === C.MATCH_TIME, { t });
  const room = C.START_ROOMS[0], tc = t, bots = [...r.players.values()].filter((p: any) => p.bot), b0 = bots.map((b: any) => [b.x, b.y]);
  Object.assign(H, { x: room.x + 60, y: 35 * T + 8 }); const hx = H.x; // 食堂の西の扉の前から西へ
  let out = false, botOut = false; const inBox = (p: any, h: any) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h; // 下の inRoom と名前が重なるため
  while (r.phase === 'countdown') { step(-1, 0); if (r.phase === 'countdown') { if (!inBox(H, room)) out = true; if (bots.some((b: any) => !inBox(b, C.START_ROOMS[b.team]))) botOut = true; } }
  ok(`新開幕: カウント（3,2,1）は実秒数の${C.INTRO2.count}秒（INTRO_SPEED の影響なし）`, Math.abs(t - tc - C.INTRO2.count) < 0.06 && C.INTRO2.count === 3, { t: t - tc });
  ok('新開幕: カウント中は入力ロックなし。開始部屋（食堂）の中は動けるが出られない', H.x < hx - 20 && !out, { x: H.x, room: room.x });
  const botMoved = bots.filter((b: any, i: number) => Math.hypot(b.x - b0[i][0], b.y - b0[i][1]) > 20).length;
  ok('新開幕: Botもカウント中に動き出す（開始部屋の中で）', botMoved >= bots.length / 2 && !botOut, { botMoved, n: bots.length });
  ok('カウント0で試合開始、試合時間はここから数える', r.phase === 'playing' && r.timeLeft > C.MATCH_TIME - 0.1, { timeLeft: r.timeLeft });
  Object.assign(H, { x: room.x + 12, y: 35 * T + 8 }); for (let i = 0; i < 40; i++) step(-1, 0); // 食堂の西の扉へ
  ok('GAME START の後は部屋から出られる', H.x < room.x - 20, { x: H.x, y: H.y });
  // キルログの通知
  const foe = [...r.players.values()].find((p: any) => p.team === 1 && p.alive && !p.ult && !p.assist); delete foe.st.rush; // 倒せる相手（ウルト中・突撃中でない）
  r.damagePlayer(foe, 9999, 'h');
  const kill = sent.filter(([t2]) => t2 === 'kill').pop()?.[1]; // 直前にBot同士の撃破があることがあるので最後のキル
  ok('倒したらキルログを全員に送る（倒した側 → 倒された側）', kill && kill.kc === H.char && kill.kt === 0 && kill.vc === foe.char && kill.vt === 1, kill);
  // 終了: 全員が自陣の大将の部屋へ（倒れていた人も）。部屋の中だけ動ける
  r.bosses[0].base = 1; r.endMatch(2);
  const inRoom = (p: any) => { const h = r.homes[p.team][r.bosses[p.team].base]; return p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h; };
  ok('終了したら各陣営の全員が、自陣の大将が最後にいた部屋に集まる', [...r.players.values()].every((p: any) => p.alive && inRoom(p)));
  for (let i = 0; i < 100; i++) step(i < 50 ? 1 : -1, i % 2 ? 1 : -1);
  ok('リザルト中も動けるが、その部屋から出られない', inRoom(H) && H.ack === seq);
}

console.log('--- 開始演出の横並び・戻る（連戦）');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; let unlocked = false; r.unlock = () => { unlocked = true; };
  Object.defineProperty(r, 'clients', { value: [] });
  r.onCreate(); r.onJoin({ sessionId: 'h1' }); r.onJoin({ sessionId: 'h2' }); r.players.get('h1').char = 'metan'; r.startMatch();
  const row = [0, 1].map((t) => [...r.players.values()].filter((p: any) => p.team === t));
  ok('開始演出: 各陣営の4人が開始部屋（食堂）の中に横一列に並ぶ', row.every((l, t) => l.length === 4 && l.every((p: any) => p.y === l[0].y && inRoom(p, C.START_ROOMS[t])) && l.every((p: any, i: number) => !i || p.x - l[i - 1].x === C.INTRO_GAP)));
  r.beginPlay(); r.breakWalls([[11, 26]]); r.teams[0].toku = 9; r.materials = [{ id: 99, x: 0, y: 0 }]; r.endMatch(0);
  ok('リザルト: 押した人数／全人数（Botは押した扱い）', JSON.stringify(r.backCount()) === JSON.stringify({ n: 6, total: 8 }));
  r.messages.back({ sessionId: 'h1' });
  ok('人間の1人だけ押した段階では戻らない', r.phase === 'ended' && r.backCount().n === 7);
  r.messages.back({ sessionId: 'h2' });
  const ps = [...r.players.values()];
  ok('人間全員が押したら待機画面へ（Botは消え、人間は陣営・キャラのまま。壁・資材・徳も最初から）', r.phase === 'waiting' && ps.length === 2 && ps.every((p: any) => !p.bot) && r.players.get('h1').char === 'metan' && r.players.get('h1').team === 0 && r.players.get('h2').team === 1
    && r.broken.length === 0 && r.tiles[26][11] === '#' && r.materials.length === 0 && r.teams[0].toku === C.TOKU_INIT && r.timeLeft === C.MATCH_TIME && r.winner === -1 && unlocked);
  r.startMatch(); r.beginPlay(); for (let i = 0; i < 20; i++) r.tick(0.05);
  ok('同じ部屋で次の試合を始められる', r.phase === 'playing' && r.players.size === 8 && r.timeLeft < C.MATCH_TIME);
}

console.log('--- リコール・回復・技のCT');
{
  const { r, A } = mk('hanamaru'); const cl = { sessionId: 'a' }; r.owners.set('a', 'a');
  const run = (sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { r.now += 0.05; r.updatePlayers(0.05); } };
  r.messages.qdown(cl); run(C.RECALL_HOLD - 0.2);
  ok('Q を押している間は溜める（まだワープしない）', !inRoom(A, C.RECALL_ROOMS[0]) && A.recallAt !== null);
  r.damagePlayer(A, 1, 'x'); run(0.4);
  ok('被弾すると溜めは0からやり直し', !inRoom(A, C.RECALL_ROOMS[0]));
  run(C.RECALL_HOLD - 0.3);
  ok(`Q を${C.RECALL_HOLD}秒押し続けると自陣の給湯室へワープ`, inRoom(A, C.RECALL_ROOMS[0]) && A.recallAt === null);
  r.messages.qup(cl); ok('ワープ後に離しても何も起きない', inRoom(A, C.RECALL_ROOMS[0]) && A.recallAt === null && A.qAt === null);
  Object.assign(A, { x: 1552, y: 900 }); r.messages.qdown(cl); run(1); r.messages.qup(cl); run(C.RECALL_HOLD);
  ok('キーを離すと溜めはリセット', !inRoom(A, C.RECALL_ROOMS[0]) && A.recallAt === null);
  Object.assign(A, { x: 200, y: 400, face: Math.PI / 2 }); A.tgt = null; r.skill('a'); fly(r); Object.assign(A, { y: 392 }); // 壁破壊の穴の前（旧: バリケードを置けた場所）
  const q0 = { x: A.x, y: A.y }, ob = JSON.stringify(r.obstacles()), nId = r.nextId;
  r.messages.qdown(cl); run(0.1); r.messages.qup(cl);
  ok('Q の短押しは何も起きない（バリケード設置は廃止）', A.x === q0.x && A.y === q0.y && JSON.stringify(r.obstacles()) === ob && r.nextId === nId && A.recallAt === null && !('barricades' in r));
  // 自陣回復は廃止（study・給湯室・食堂にいても回復しない）
  const h = mk('sayo'); const rooms0 = [MAP.rooms.find((x: any) => x.id === 'study_L')!.rect, MAP.rooms.find((x: any) => x.id === 'kitchen_L')!.rect, MAP.rooms.find((x: any) => x.id === 'dining_L')!.rect];
  const hs = rooms0.map((q: number[]) => { Object.assign(h.A, { x: (q[0] + 2) * T, y: (q[1] + 2) * T, hp: 20 }); h.r.updatePlayers(1); return h.A.hp; });
  ok('自陣回復は廃止（study・給湯室・食堂にいても回復しない）', hs.every((v: number) => v === 20), hs);
  // Bot: HPが低いとリコール → 給湯室でご飯を食べてHPが満タンになるまで回復
  const be = mk('metan'); be.A.bot = true; be.A.aim = C.BOT_AIM; be.A.hp = be.r.maxHp(be.A) * C.BOT_RECALL_HP - 1; putHeals(be.r);
  let ate = 0;
  for (let i = 0; i < 600 && be.A.hp < be.r.maxHp(be.A); i++) { const n = be.r.items.length; be.r.now += 0.05; be.r.botThink(be.A, be.r.obstacles()); be.r.updatePlayers(0.05); if (be.r.items.length < n) ate++; }
  be.r.botThink(be.A, be.r.obstacles());
  ok(`Bot: HP低下でリコール → 給湯室でご飯を食べて満タンまで回復（${ate}個）`, be.A.hp >= be.r.maxHp(be.A) && ate >= 2 && inRoom(be.A, C.RECALL_ROOMS[0]) && !be.A.eating, { hp: be.A.hp, ate });
  // Bot のリコール
  const b = mk('metan'); b.A.bot = true; b.A.hp = b.r.maxHp(b.A) * 0.2; b.r.botThink(b.A, b.r.obstacles());
  ok('Bot: HPが低いとリコールを使う', b.A.recallAt !== null);
  const b2 = mk('metan'); b2.A.bot = true; Object.assign(b2.A, { x: C.MAP_W - 400, y: 300 }); b2.r.botThink(b2.A, b2.r.obstacles());
  ok('Bot: HPが減っていなければリコールしない', b2.A.recallAt === null);
  // 技のCT
  const old: Record<string, number> = { hanamaru: 25, sayo: 20, whitecul: 18, aru: 15, bii: 25, metan: 12, ierutan: 20, kiritan: 18, mochiko: 30, zunko: 18 };
  ok('技のCT: mochiko は旧のまま、zunko は旧の2/3、ほかは旧0.4倍', Object.entries(old).every(([k, v]) => Math.abs(CHARS[k].skill.ct - (k === 'mochiko' ? v : k === 'zunko' ? (v * 2) / 3 : v * 0.4)) < 1e-9));
}

console.log('--- アシスト召喚の通知');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {};
  const sent: any[] = []; Object.defineProperty(r, 'clients', { value: [{ sessionId: 'x', send: (t: string, m: any) => sent.push(['x', t, m]) }, { sessionId: 'y', send: (t: string, m: any) => sent.push(['y', t, m]) }] });
  r.onCreate(); r.addPlayer('a', 0, false); r.startMatch(); r.beginPlay();
  const a = r.summonAssist(0, 2), m = sent.filter(([, t]) => t === 'assist');
  ok('アシスト召喚を全員（両陣営）に通知する（陣営・名前・強さ）', m.length === 2 && m.every(([, , x]) => x.char === a.char && x.tier === 2 && x.team === 0));
}

console.log('--- 開始人数・途中参加（e2e から移動）');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [] });
  r.onCreate(); r.onJoin({ sessionId: 'h' });
  ok('入室で待機画面（1人）', r.phase === 'waiting' && r.players.size === 1);
  r.startMatch(); r.beginPlay();
  const ps = [...r.players.values()];
  ok('開始で自分+Bot7体の4vs4', ps.length === 8 && ps.filter((p: any) => p.bot).length === 7 && [0, 1].every((t) => ps.filter((p: any) => p.team === t).length === 4));
  const bot = ps.find((p: any) => p.team === 1 && p.bot);
  Object.assign(bot, { x: 1234, y: 567, rage: 7, bad: 2 });
  r.onJoin({ sessionId: 'h2' });
  const me = r.players.get(r.owners.get('h2'));
  ok('途中参加は人間の少ない陣営のBotと入れ替わる', me === bot && !me.bot && [...r.players.values()].filter((p: any) => p.bot).length === 6);
  ok('途中参加: 位置・暴れ度・悪行ポイントを引き継ぐ', me.x === 1234 && me.y === 567 && me.rage === 7 && me.bad === 2);
}

console.log('--- 大将の逃亡・勝敗（e2e から移動）');
{
  const { r, A } = mk('sayo'); const bo = r.bosses[1], base0 = bo.base;
  r.damageBoss(bo, C.BOSS_MOVE_THRESHOLD - 1, A); const stay = bo.base === base0;
  r.damageBoss(bo, 1, A); finishMove(r);
  ok(`大将: 同じ拠点での被ダメが閾値（${C.BOSS_MOVE_THRESHOLD}）に届くと、予告と広範囲攻撃のあと別拠点へ移動`, stay && bo.base !== base0 && bo.dmgAtBase === 0 && bo.x === r.bases[1][bo.base].x);
  const k = mk('sayo'); k.r.damageBoss(k.r.bosses[1], C.BOSS_HP, k.A); const ph = k.r.phase; finish(k.r);
  ok('大将のHPが0になった側の負け（決着演出のあと決着後へ）', ph === 'finale' && k.r.phase === 'ended' && k.r.winner === 0);
  for (const [h0, h1, w] of [[500, 400, 0], [400, 500, 1], [450, 450, 2]]) {
    const t = mk('sayo'); t.r.bosses[0].hp = h0; t.r.bosses[1].hp = h1; t.r.now = C.MATCH_TIME - 0.01; t.r.tick(0.05, false); const p0 = t.r.phase; finish(t.r);
    ok(`時間切れは大将のHP割合で勝敗（${h0} 対 ${h1} → ${['あんこもん軍', 'ずんだもん軍', '引き分け'][w]}）`, p0 === 'finale' && t.r.phase === 'ended' && t.r.winner === w);
  }
}

console.log('--- 決着演出（finale）');
{
  const F = C.FINALE, st = (r: any) => r.finale?.stage ?? r.phase;
  const run = (r: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) r.tick(0.05, false); };
  // 大将撃破: スロー → 大将の爆発 → 止めのキャラ → WIN → 決着後
  const k = mk('sayo', 'metan'); k.r.shots.push({ id: 999, kind: 'bullet', team: 1, owner: 'b', x: 1400, y: 950, vx: 100, vy: 0, sp: 100, left: 1e9, dmg: 0, r: 4 });
  const x0 = k.A.x, now0 = k.r.now; k.r.damageBoss(k.r.bosses[1], C.BOSS_HP, k.A);
  const seq: string[] = [st(k.r)];
  k.r.players.get('a').inputs.push({ seq: 1, dx: 1, dy: 0 }); run(k.r, 1);
  const slowNow = k.r.now - now0, moved = k.A.x !== x0, shot = k.r.shots.find((x: any) => x.id === 999);
  ok(`大将撃破の瞬間からスロー（${F.slowRate}倍）。スロー中は入力を受けない（入力は捨てて処理済みにする）・弾は遅く進む`, k.r.phase === 'finale' && Math.abs(slowNow - F.slowRate) < 1e-6 && !moved && k.A.ack === 1 && shot && Math.abs(shot.x - (1400 + 100 * F.slowRate)) < 1e-6, { slowNow, moved, shotX: shot?.x });
  const cd0 = k.A.skillReadyAt; k.r.skill('a');
  ok('演出中は技も受けない', k.A.skillReadyAt === cd0 && !k.r.ents.length);
  for (let i = 0; i < 600 && k.r.phase === 'finale'; i++) { k.r.tick(0.05, false); if (st(k.r) !== seq.at(-1)) seq.push(st(k.r)); }
  ok('大将撃破の段: スロー → 大将（カメラ・爆発）→ 止めのキャラ → WIN → 決着後', JSON.stringify(seq) === JSON.stringify(['slow', 'boss', 'killer', 'win', 'ended']), seq);
  const k2 = mk('sayo', 'metan'); k2.r.damageBoss(k2.r.bosses[1], C.BOSS_HP, k2.A); run(k2.r, F.slow + F.cam + F.boom + 0.05);
  ok('止めのキャラ（id・キャラ・陣営・位置）を送る。倒された大将の位置も', k2.r.finale.killer?.id === 'a' && k2.r.finale.killer.char === 'sayo' && k2.r.finale.killer.team === 0 && !k2.r.finale.killer.assist && k2.r.finale.boss.team === 1);
  const k3 = mk('sayo', 'metan'); const as = k3.r.summonAssist(0, 1); k3.r.damageBoss(k3.r.bosses[1], C.BOSS_HP, as); run(k3.r, F.slow + F.cam + F.boom + 0.05);
  ok('止めがアシストなら assist（立ち絵なしで名前だけ）', k3.r.finale.killer?.assist === true);
  const k4 = mk('sayo', 'metan'); k4.r.damageBoss(k4.r.bosses[1], C.BOSS_HP, k4.A); k4.r.damageBoss(k4.r.bosses[0], C.BOSS_HP, k4.B);
  ok('演出中はもう一方の大将は倒れない（勝者は最初の撃破で決まる）', k4.r.winner === 0 && k4.r.bosses[0].hp === C.BOSS_HP);
  // 時間切れ: 停止 → 時間切れ → WIN → 決着後
  const t = mk('sayo', 'metan'); t.r.now = C.MATCH_TIME - 0.01; t.r.tick(0.05, false); const tn = t.r.now; const tseq = [st(t.r)];
  for (let i = 0; i < 600 && t.r.phase === 'finale'; i++) { t.r.tick(0.05, false); if (st(t.r) !== tseq.at(-1)) tseq.push(st(t.r)); }
  ok('時間切れの段: 時間切れ（ゲーム停止）→ WIN → 決着後', JSON.stringify(tseq) === JSON.stringify(['timeup', 'win', 'ended']), tseq);
  const t2 = mk('sayo', 'metan'); t2.r.now = C.MATCH_TIME - 0.01; t2.r.tick(0.05, false); const n2 = t2.r.now; run(t2.r, F.timeup / 2);
  ok('時間切れの間はゲームの時間が止まる', t2.r.now === n2 && t2.r.phase === 'finale');
  // 演出中は全員に全ユニットを送る（倒された大将・止めのキャラを映す）
  const v: any = mk('sayo', 'metan'); const last: any = {};
  Object.defineProperty(v.r, 'clients', { value: [{ sessionId: 'x', send: (ty: string, m: any) => { if (ty === 's') last.s = m; } }] }); v.r.owners.set('x', 'a');
  Object.assign(v.B, { x: 200, y: 200 }); v.r.sendSnapshots(); const hid = !last.s.players.some((p: any) => p.id === 'b');
  v.r.damageBoss(v.r.bosses[1], C.BOSS_HP, v.A); v.r.sendSnapshots();
  ok('演出中はフォグなしで送る（通常は視界外の敵を送らない）', hid && last.s.players.some((p: any) => p.id === 'b') && last.s.finale?.stage === 'slow');
}

console.log('--- バランス（ending1）');
{
  ok('POWER_MULT は旧の0.7倍 [0.49, 0.7, 0.98, 1.4]（見た目のオーラは据え置き）', JSON.stringify(C.POWER_MULT) === JSON.stringify([0.49, 0.7, 0.98, 1.4]) && JSON.stringify(C.POWERUP_AURA.scale) === JSON.stringify([1.2, 1.2 + 0.8 / 3, 1.2 + 1.6 / 3, 2]));
  ok('POWER_WEIGHTS: レベル3・4はコバコから出ない [30, 40, 0, 0]', JSON.stringify(C.POWER_WEIGHTS) === JSON.stringify([30, 40, 0, 0]));
  ok('連チャン確率: レベル3へ 0.35、レベル4へ 0.15', C.SLOT.chain === 0.35 && C.SLOT.chainBreak === 0.15);
  const K = CHARS.kiritan, cannon = K.aa.find((m) => m.name === 'きりたん砲')!, knife = K.aa.find((m) => m.name === '包丁')!;
  ok('きりたん: 包丁は不変（近接・ダメージ1.2）、きりたん砲 射程310・ダメージ0.85、全弾斉射 射程310・1発7.5', knife.kind === 'melee' && knife.dmg === 1.2 && knife.range === C.ATTACK_RANGE && cannon.range === 310 && cannon.dmg === 0.85 && K.skill.range === 310 && K.skill.dmg === 7.5);
  ok('めたんのドリル: 持続2.4秒', CHARS.metan.skill.dur === 2.4);
  ok('コバコの徳: 1部屋に2個、上限9は据え置き', C.COURIER_DROP.n === 2 && C.COURIER_DROP.cap === 9);
  const box: number[] = [0, 0, 0, 0]; for (let i = 0; i < 20000; i++) box[lottery(C.POWER_WEIGHTS)]++;
  ok(`コバコの荷物の強さの抽選でレベル3・4は出ない（2万回: ${box.join('/')}）`, box[2] === 0 && box[3] === 0);
}

console.log('--- Botだけの試合・視界外の敵を送らない（e2e の試合2から移動）');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  const last: Record<string, any> = {};
  Object.defineProperty(r, 'clients', { value: ['c0', 'c1'].map((id) => ({ sessionId: id, send: (t: string, m: any) => { if (t === 's') last[id] = m; } })) });
  r.onCreate(); r.notice = () => {};
  r.onJoin({ sessionId: 'c0' }); r.onJoin({ sessionId: 'c1' }); // 両陣営に1人ずつ（受信の確認用）。開始後はBotとして動かす
  r.startMatch(); r.beginPlay();
  for (const p of r.players.values()) { p.bot = true; p.aim = C.BOT_AIM; }
  const SIM = 60; // Botだけで進める試合内の秒数（その後は時間切れへ飛ばす）
  let checks = 0, leaked = 0, missing = 0, picked = 0;
  for (let i = 0; i < SIM / 0.05; i++) {
    const m0 = r.materials.length;
    r.tick(0.05, false);
    if (r.materials.length < m0) picked += m0 - r.materials.length;
    if (i % 20) continue;
    r.sendSnapshots(); checks++;
    const obs = r.obstacles();
    for (const id of ['c0', 'c1']) {
      const team = r.players.get(r.owners.get(id)).team, s = last[id];
      const eyes = [...[...r.players.values()].filter((p: any) => p.team === team && (p.alive || r.dying(p))), r.bosses[team]]; // 撃破の演出中（消えるまで）も視界を持つ
      for (const u of [...r.players.values()].filter((p: any) => p.team !== team && (p.alive || r.dying(p)))) {
        const ds = eyes.map((e: any) => ({ d: Math.hypot(e.x - u.x, e.y - u.y), r: visionRadius(e.char) }));
        if (ds.some((x) => Math.abs(x.d - x.r) < 1)) continue; // 視界の境目ちょうどは除く
        const vis = eyes.some((e: any, k: number) => ds[k].d <= ds[k].r && lineOfSight(e.x, e.y, u.x, u.y, obs));
        const sent = s.players.some((p: any) => p.id === u.id);
        if (sent && !vis) leaked++;
        if (!sent && vis) missing++;
      }
    }
  }
  ok('視界外の敵ユニットを送らない（視界内の敵は送る）', checks > 50 && leaked === 0 && missing === 0, { checks, leaked, missing });
  ok(`Botが資材を拾う（${SIM}秒で${picked}個）`, picked > 0, { toku: r.teams.map((t: any) => t.toku.toFixed(2)) });
  r.now = C.MATCH_TIME - 0.01; r.tick(0.05, false); finish(r);
  const ratio = r.bosses.map((b: any) => b.hp / C.BOSS_HP), want = ratio[0] > ratio[1] ? 0 : ratio[1] > ratio[0] ? 1 : 2;
  ok('Botだけの試合が時間切れで決着、勝敗が大将のHP割合どおり', r.phase === 'ended' && r.winner === want, { ratio, winner: r.winner });
}

console.log('--- 徳（各行動の増減・範囲・頭上の表示）');
{
  const tk = (r: any, t = 0) => +r.teams[t].toku.toFixed(4);
  const m = mk('sayo'); m.r.materials.push({ id: 1, x: m.A.x + 3, y: m.A.y }); m.r.updatePlayers(0.05);
  const fx = m.r.fx.find((f: any) => f.kind === 'toku');
  ok(`資材を拾う: +${C.TOKU.material}（資材は消え、持ち運ばない。頭上に「${fx?.text} +${fx?.d}」）`, tk(m.r) === C.TOKU_INIT + C.TOKU.material && m.r.materials.length === 0 && fx?.d === C.TOKU.material && !('carry' in m.A));
  const h = mk('sayo', 'metan'); h.r.attack('a');
  ok(`攻撃を当てる: ${C.TOKU.hit}（1回ごと）`, tk(h.r) === +(C.TOKU_INIT + C.TOKU.hit).toFixed(4) && h.A.bad === -C.TOKU.hit);
  const w = mk('whitecul', 'metan'); w.r.addPlayer('c', 1, false); Object.assign(w.r.players.get('c'), { x: 1600, y: 910, alive: true }); w.r.skill('a');
  ok('技の命中も1体ごとに下がる（2体に当てて2回）', tk(w.r) === +(C.TOKU_INIT + 2 * C.TOKU.hit).toFixed(4));
  const k = mk('sayo', 'metan'); k.r.damagePlayer(k.B, 999, 'a');
  ok(`相手をKO: ${C.TOKU.ko}`, tk(k.r) === C.TOKU_INIT + C.TOKU.ko);
  const wk = mk('sayo', 'metan'); wk.B.bad = C.WANTED_MIN; wk.r.updateWanted(); const was = wk.r.teams[1].wanted; wk.r.damagePlayer(wk.B, 999, 'a');
  ok(`指名手配中の敵をKO: +${C.TOKU.wantedKo}（KOの${C.TOKU.ko}はない）。倒された側の悪行ポイントは残り、手配が外れる`, was === 'b' && tk(wk.r) === C.TOKU_INIT + C.TOKU.wantedKo && wk.B.bad === C.WANTED_MIN && wk.r.teams[1].wanted === null);
  const ak = mk('sayo'); const ea = ak.r.summonAssist(1, 1); ak.r.damagePlayer(ea, 1e9, 'a');
  ok('敵のアシストを倒しても KO では下がらない', tk(ak.r) === C.TOKU_INIT);
  const wb = mk('hanamaru'); Object.assign(wb.A, { x: 200, y: 400, face: Math.PI / 2 }); wb.A.tgt = null; wb.r.skill('a'); fly(wb.r);
  ok(`壁を壊す（花丸の壁破壊）: ${C.TOKU.wall}（1回の技につき1回）`, wb.r.broken.length > 1 && tk(wb.r) === C.TOKU_INIT + C.TOKU.wall);
  const nb = mk('hanamaru'); Object.assign(nb.A, { x: 248, y: 60, face: -Math.PI / 2 }); nb.A.tgt = null; nb.r.skill('a'); fly(nb.r); // 外周の壁へ（壊れない）
  ok('壁を壊さなかった壁破壊では下がらない', nb.r.broken.length === 0 && tk(nb.r) === C.TOKU_INIT);
  const e = mk('sayo'); e.r.items.push({ id: 1, kind: 'heal', team: -1, x: e.A.x + 3, y: e.A.y }); e.r.updatePlayers(0.05);
  ok(`盗み食い（回復アイテムを拾う）: ${C.TOKU.eat}`, tk(e.r) === C.TOKU_INIT + C.TOKU.eat && e.r.fx.some((f: any) => f.kind === 'toku' && f.text === '盗み食い'));
  const c = mk('sayo'); c.r.spawnCourier(); Object.assign(c.r.couriers[0], { x: c.A.x + 30, y: c.A.y }); c.A.aim = 'courier'; c.r.attack('a');
  ok(`コバコを攻撃: ${C.TOKU.courier}（攻撃の${C.TOKU.hit}は重ねない）`, tk(c.r) === C.TOKU_INIT + C.TOKU.courier);
  const lo = mk('sayo', 'metan'); lo.r.teams[0].toku = 0.03; lo.r.attack('a');
  const hi = mk('sayo'); hi.r.teams[0].toku = 9.9; for (let i = 0; i < 3; i++) hi.r.materials.push({ id: i, x: hi.A.x + 3, y: hi.A.y }); hi.r.updatePlayers(0.05);
  ok(`${C.TOKU_MIN}〜${C.TOKU_MAX}で止まる`, lo.r.teams[0].toku === C.TOKU_MIN && hi.r.teams[0].toku === C.TOKU_MAX);
  const as = mk('sayo'); const a = as.r.summonAssist(0, 1, 'kurono'); Object.assign(a, { x: 1552, y: 900, face: 0 }); as.B = as.r.addPlayer('b', 1, false); Object.assign(as.B, { x: 1592, y: 900 }); const bh = as.B.hp; as.r.attack(a.id);
  ok('アシストの攻撃では徳は変わらない', as.B.hp < bh && tk(as.r) === C.TOKU_INIT);
  const st = mk('sayo'); st.r.startMatch(); 
  ok(`初期値は${C.TOKU_INIT}（キャラごとの補正は今は全キャラ0）`, st.r.teams.every((t: any) => t.toku === C.TOKU_INIT) && Object.values(CHARS).every((c) => !c.toku));
}

console.log('--- 資材（マップのあちこち・再出現・部屋ごとのフレーバー）');
{
  const { r } = mk('sayo'); const kinds = new Set<string>();
  for (let i = 0; i < 300; i++) { r.materials = []; r.spawnMaterial(); const m = r.materials[0]; kinds.add(roomKindAt(Math.floor(m.x / T), Math.floor(m.y / T)) ?? 'none'); if (tileAt(r, m.x, m.y) !== '.') kinds.add('wall!'); }
  ok(`中央3部屋を除く全部屋・廊下に出る（${kinds.size}種類の場所）`, kinds.size >= 9 && kinds.has('path') && !kinds.has('none') && !kinds.has('wall!') && !['smoking', 'hall', 'entrance'].some((k) => kinds.has(k)), [...kinds]);
  r.materials = []; r.materialTimer = 0; r.updateMaterials(C.MATERIAL_SPAWN_INTERVAL - 0.01); const n0 = r.materials.length; r.updateMaterials(0.02);
  ok(`拾われて減ったら${C.MATERIAL_SPAWN_INTERVAL}秒ごとに1個ずつ再出現（上限${C.MATERIAL_MAX * C.MATERIAL_MAX_MULT}）`, n0 === 0 && r.materials.length === 1);
  const s2 = mk('sayo'); s2.r.startMatch(); ok(`試合開始時に${C.MATERIAL_MAX * C.MATERIAL_MAX_MULT}個置く（基準${C.MATERIAL_MAX}の${C.MATERIAL_MAX_MULT}倍）`, s2.r.materials.length === C.MATERIAL_MAX * C.MATERIAL_MAX_MULT && C.MATERIAL_MAX_MULT === 3);
  ok(`資材拾いの徳は旧の1/3（+${C.TOKU.material}、裏側 +${C.TOKU.materialBack}。旧 0.6・1.2）`, Math.abs(C.TOKU.material - 0.6 / 3) < 1e-9 && Math.abs(C.TOKU.materialBack - 1.2 / 3) < 1e-9);
  const at = (id: string, fx: number, fy: number) => { const q = MAP.rooms.find((x: any) => x.id === id)!.rect; return { x: (q[0] + 1 + (q[2] - q[0] - 1) * fx) * T, y: (q[1] + 1 + (q[3] - q[1] - 1) * fy) * T }; };
  const fp = mk('sayo'); Object.assign(fp.A, at('study_L', 0.5, 0.5)); fp.r.materials.push({ id: 1, x: fp.A.x + 3, y: fp.A.y, hi: false }); fp.r.updatePlayers(0.05);
  ok('資材を拾った表示はフレーバーなし（「徳+XX」だけ）', fp.r.fx.some((f: any) => f.kind === 'toku' && f.text === '' && f.d === C.TOKU.material));
  ok('資材の出現間隔は旧の半分（3→1.5秒）', C.MATERIAL_SPAWN_INTERVAL === 1.5);
  // 裏側（食堂・中央 以外の部屋・廊下）に偏って出て、高ポイント
  let hi = 0, wrong = 0; const front = new Set<string>();
  for (let i = 0; i < 2000; i++) { r.materials = []; r.spawnMaterial(); const m = r.materials[0], k = roomKindAt(Math.floor(m.x / T), Math.floor(m.y / T))!; if (m.hi) hi++; if (m.hi === C.FRONT_ROOMS.includes(k)) wrong++; if (!m.hi) front.add(k); }
  ok(`裏側に${C.MATERIAL_BACK * 100}%の比率で出る（2000個中 ${(hi / 20).toFixed(1)}%）。表側は食堂・中央の部屋だけ`, Math.abs(hi / 2000 - C.MATERIAL_BACK) < 0.04 && wrong === 0 && [...front].every((k) => C.FRONT_ROOMS.includes(k)), [...front]);
  const g = mk('sayo'); g.r.teams[0].toku = 5; g.r.materials.push({ id: 1, x: g.A.x + 3, y: g.A.y, hi: true }); g.r.updatePlayers(0.05);
  const fx1 = g.r.fx.filter((f: any) => f.kind === 'toku').pop(); const t1 = g.r.teams[0].toku;
  g.r.materials.push({ id: 2, x: g.A.x + 3, y: g.A.y, hi: false }); g.r.updatePlayers(0.05); const fx2 = g.r.fx.filter((f: any) => f.kind === 'toku').pop();
  ok(`裏側の資材は徳+${C.TOKU.materialBack}（通常+${C.TOKU.material}）、頭上の表示も高ポイントの印付き`, Math.abs(t1 - 5 - C.TOKU.materialBack) < 1e-9 && Math.abs(g.r.teams[0].toku - t1 - C.TOKU.material) < 1e-9 && fx1.hi === true && fx2.hi === false);
}

console.log('--- 悪行ポイント（倍率・反省中の減少）');
{
  const per = -C.TOKU.courier * C.BAD_MULT.courier; // コバコ撃破1回分
  const c = mk('sayo'); c.r.spawnCourier(); Object.assign(c.r.couriers[0], { x: c.A.x + 30, y: c.A.y }); c.A.aim = 'courier'; c.r.attack('a');
  ok(`コバコ撃破の悪行: ${per}（徳の${C.TOKU.courier}の${C.BAD_MULT.courier}倍。徳は${C.TOKU.courier}のまま）`, Math.abs(c.A.bad - 4.5) < 1e-9 && Math.abs(c.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.courier)) < 1e-9, { bad: c.A.bad });
  const w = mk('bii'); w.r.addToku(0, w.A, 'wall');
  ok(`壁破壊の悪行: ${-C.TOKU.wall * C.BAD_MULT.wall}（徳の${C.TOKU.wall}の${C.BAD_MULT.wall}倍。徳は${C.TOKU.wall}のまま）`, Math.abs(w.A.bad - 1.8) < 1e-9 && Math.abs(w.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.wall)) < 1e-9, { bad: w.A.bad });
  const h = mk('sayo', 'metan'); h.r.attack('a');
  ok('倍率のない行動（攻撃）は今までどおり徳の減少量', Math.abs(h.A.bad - -C.TOKU.hit) < 1e-9);
  // 反省中: コバコ撃破1回分が BAD_DECAY_SEC 秒で0。0未満にならない。復帰後は減らない
  const d = mk('sayo', 'metan'); d.A.bad = per; d.A.rage = 1e6; d.r.damagePlayer(d.A, 1e9, 'b'); // 反省時間を長く（RESPAWN_MAX）
  const step = (sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { d.r.now += 0.05; d.r.updatePlayers(0.05); } };
  step(C.BAD_DECAY_SEC / 2); const half = d.A.bad;
  step(C.BAD_DECAY_SEC / 2); const zero = d.A.bad;
  step(1); const after = d.A.bad;
  ok(`反省中はコバコ撃破1回分（${per}）が${C.BAD_DECAY_SEC}秒で0になる（半分の時点で${half.toFixed(3)}、${C.BAD_DECAY_SEC}秒で${zero.toFixed(6)}）、0未満にならない`, !d.A.alive && Math.abs(half - per / 2) < 1e-6 && Math.abs(zero) < 1e-6 && after === 0 && zero >= 0, { half, zero, after });
  const e = mk('sayo', 'metan'); e.A.bad = per; e.r.damagePlayer(e.A, 1e9, 'b'); let n = 0;
  while (!e.A.alive && n++ < 1000) { e.r.now += 0.05; e.r.updatePlayers(0.05); }
  const atRespawn = e.A.bad; for (let i = 0; i < 100; i++) { e.r.now += 0.05; e.r.updatePlayers(0.05); }
  ok(`復帰後は減らない（復帰時${atRespawn.toFixed(3)} → 5秒後${e.A.bad.toFixed(3)}）`, e.A.alive && atRespawn > 0 && e.A.bad === atRespawn);
  // 指名手配: 撃破で外れ、反省中・復帰直後は悪行が残っていても手配しない。復帰後に悪行が増えたら再び手配
  e.r.updateWanted(); const held = e.r.teams[0].wanted;
  e.r.addToku(0, e.A, 'hit'); e.r.updateWanted();
  ok(`撃破で手配が外れ、復帰後に新しい悪行が付くまで手配しない（悪行${atRespawn.toFixed(2)}が残っていても）。付いたら再び手配`, atRespawn >= C.WANTED_MIN && held === null && e.r.teams[0].wanted === 'a', { held, now: e.r.teams[0].wanted });
}

console.log('--- 指名手配');
{
  const { r, A, B } = mk('sayo', 'metan'); r.addPlayer('c', 0, false); const Cc = r.players.get('c');
  A.bad = C.WANTED_MIN - 0.01; r.updateWanted();
  ok(`悪行ポイントが${C.WANTED_MIN}未満なら手配なし`, r.teams[0].wanted === null);
  A.bad = C.WANTED_MIN; Cc.bad = C.WANTED_MIN + 1; r.updateWanted();
  ok('しきい値以上で一番多い人1人に手配（陣営ごと）', r.teams[0].wanted === 'c' && r.teams[1].wanted === null);
  A.bad = 0; Cc.bad = 0; for (let i = 0; i < 50; i++) { r.attack('a'); r.now += C.ATTACK_COOLDOWN_MELEE; B.hp = 9999; } r.updateWanted();
  ok(`悪行ポイントは徳を下げた量の累計（攻撃50回で${A.bad.toFixed(2)}）`, Math.abs(A.bad - 50 * -C.TOKU.hit) < 1e-9 && r.teams[0].wanted === 'a');
  const bad0 = A.bad; r.damagePlayer(A, 1e9, 'b'); r.updateWanted();
  ok('倒されると悪行ポイントは残り、手配が外れる', A.bad === bad0 && r.teams[0].wanted === null);
  // 敵の視界外でもミニマップに位置を送る
  const v: any = new (GameRoom as any)(); v.setSimulationInterval = () => {}; v.lock = () => {}; const last: any = {};
  Object.defineProperty(v, 'clients', { value: ['c0', 'c1'].map((id) => ({ sessionId: id, send: (t: string, m: any) => { if (t === 's') last[id] = m; } })) });
  v.onCreate(); v.onJoin({ sessionId: 'c0' }); v.onJoin({ sessionId: 'c1' }); v.startMatch(); v.beginPlay();
  const me1 = v.players.get('c1'); Object.assign(me1, { x: C.MAP_W - 200, y: 200, bad: 5 }); v.updateWanted(); v.sendSnapshots();
  ok('指名手配中のキャラは、敵の視界外でもミニマップ用に位置を送る', !last.c0.players.some((p: any) => p.id === 'c1') && last.c0.wanted.some((w: any) => w.id === 'c1' && w.x === me1.x));
  // Bot は指名手配中の敵を優先して狙う
  const b = mk('metan', 'sayo'); b.A.bot = true; b.A.aim = C.BOT_AIM; b.r.addPlayer('c', 1, false); const W = b.r.players.get('c');
  Object.assign(W, { x: 1552 + 40, y: 920, alive: true, bad: 5 }); Object.assign(b.B, { x: 1552 + 30, y: 900 }); b.r.updateWanted(); b.r.updatePlayers(0);
  ok('Bot は指名手配中の敵を優先して狙う（近い敵より）', b.A.tgt?.o?.id === 'c');
}

console.log('--- ブイブイ・コバコ（巡回・1発でKO・荷物・復活）');
{
  const { r, A } = mk('sayo'); r.spawnCourier(); const c0 = r.couriers[0];
  ok('マップ中央下部（entrance）に出て、荷物を1つ持つ（中立）', c0.x === C.COURIER_START.x && c0.y === C.COURIER_START.y && ['ult', 'assist'].includes(c0.box) && c0.team === -1);
  const arrive = r.courierArrive.bind(r), seq: string[] = []; r.courierArrive = (to: any) => { seq.push(to.room); arrive(to); };
  const outer = ['entrance', 'hall', 'smoking'].map((id) => { const q = MAP.rooms.find((x: any) => x.id === id)!.rect; return { x: q[0] * T, y: q[1] * T, w: (q[2] - q[0] + 1) * T, h: (q[3] - q[1] + 1) * T }; });
  let outside = 0; for (let i = 0; i < 1200; i++) { r.now += 0.05; r.updateCouriers(0.05); if (!outer.some((o) => inRoom(r.couriers[0], o))) outside++; }
  const want = ['hall', 'smoking', 'hall', 'entrance'], pattern = seq.every((x, i) => x === want[i % 4]);
  ok(`中央3部屋だけを往復する（entrance から出発、smoking・entrance で折り返し。60秒で${seq.length}回到着: ${seq.slice(0, 5).join('→')}…）`, seq.length >= 8 && pattern && outside === 0, { outside });
  const c = r.couriers[0]; Object.assign(c, { x: A.x + 30, y: A.y, box: 'ult' }); A.face = 0; A.aim = 'courier'; r.attack('a');
  const drop = r.items.find((i: any) => i.kind === 'box_ult');
  ok('攻撃を受けると1発でKOし、荷物をその場に落とす', !r.couriers.length && drop && Math.abs(drop.x - A.x - 30) < 1);
  r.now += C.COURIER.respawn - 0.1; r.updateCouriers(0.05); const early = r.couriers.length;
  r.now += 0.1; r.updateCouriers(0.05);
  ok(`${C.COURIER.respawn}秒後に entrance で復活し、新しい荷物を持つ`, early === 0 && r.couriers.length === 1 && r.couriers[0].x === C.COURIER_START.x && r.couriers[0].id !== c.id);
  Object.assign(drop, { x: A.x + 3, y: A.y }); r.updatePlayers(0.05);
  ok('ウルト箱: 拾った本人が変身（強さは4段階の抽選）', !!A.ult && A.ult.tier >= 0 && !r.items.includes(drop));
  const b2 = mk('sayo'); b2.r.items.push({ id: 5, kind: 'box_assist', team: -1, x: b2.A.x + 3, y: b2.A.y }); b2.r.updatePlayers(0.05);
  ok('アシスト箱: 拾った陣営にアシストを1体召喚', [...b2.r.players.values()].filter((p: any) => p.assist && p.team === 0).length === 1);
  const au = mk('sayo'); au.A.aim = 'nearest'; delete au.A.st.test; au.r.spawnCourier(); Object.assign(au.r.couriers[0], { x: au.A.x + 30, y: au.A.y }); au.r.updatePlayers(0.05);
  ok('オートアタックはコバコを狙わない', au.r.couriers.length === 1);
  const ac = mk('sayo', 'metan'); ac.A.aim = 'courier'; delete ac.A.st.test; ac.r.spawnCourier(); Object.assign(ac.r.couriers[0], { x: ac.A.x + 30, y: ac.A.y + 5 }); ac.B.x = ac.A.x - 30; ac.r.updatePlayers(0.05);
  ok(`照準モード「コバコ」: 射程内のコバコを敵より優先して攻撃（徳${C.TOKU.courier}）`, ac.r.couriers.length === 0 && ac.B.hp === ac.r.maxHp(ac.B) && Math.abs(ac.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.courier)) < 1e-9);
  const sp = mk('sayo', 'metan'); sp.A.aim = 'nearest'; delete sp.A.st.test; sp.r.spawnCourier(); Object.assign(sp.r.couriers[0], { x: sp.A.x + 30, y: sp.A.y + 5 }); sp.r.updatePlayers(0.05);
  ok('ほかのモードでは、敵を狙った近接の扇形にコバコがいても当たらない', sp.r.couriers.length === 1 && sp.B.hp < sp.r.maxHp(sp.B));
  const zs = mk('zunko', 'metan'); zs.A.aim = 'nearest'; delete zs.A.st.test; zs.r.spawnCourier(); Object.assign(zs.B, { x: zs.A.x + 120 }); Object.assign(zs.r.couriers[0], { x: zs.A.x + 60, y: zs.A.y }); zs.r.updatePlayers(0.05); zs.r.updateShots(0.5);
  ok('ほかのモードでは、通常攻撃の弾はコバコを素通りする', zs.r.couriers.length === 1 && zs.B.hp < zs.r.maxHp(zs.B));
  const bn = mk('metan'); bn.A.bot = true; bn.A.aim = C.BOT_AIM; bn.r.spawnCourier(); Object.assign(bn.r.couriers[0], { x: bn.A.x + 40, y: bn.A.y });
  for (let i = 0; i < 20 && bn.r.couriers.length; i++) { bn.r.botThink(bn.A, bn.r.obstacles()); bn.r.updatePlayers(0.05); bn.r.now += 0.05; }
  const bf = mk('metan'); bf.A.bot = true; bf.A.aim = C.BOT_AIM; bf.r.spawnCourier(); Object.assign(bf.r.couriers[0], { x: bf.A.x + 200, y: bf.A.y }); bf.r.botThink(bf.A, bf.r.obstacles());
  ok(`Bot: コバコが${C.BOT_COURIER_RANGE}px以内なら攻撃し、遠ければ狙わない`, !bn.r.couriers.length && !bf.A.goal.startsWith('c:'), { far: bf.A.goal });
}

console.log('--- スロット（当たる確率・連チャン・払い出し）');
{
  const N = 10000, { r } = mk('sayo');
  const rate = (toku: number) => { r.teams[0].toku = toku; let w = 0, bad = 0; for (let i = 0; i < N; i++) { r.startSpin(0); const q = r.teams[0].slot; if (q.win) w++; if (q.win !== (q.reels[0] >= 0 && q.reels[0] === q.reels[1] && q.reels[1] === q.reels[2])) bad++; } return { p: w / N, bad }; };
  const M = C.SLOT.rateMult, res = [0, 5, 10].map(rate), want = [0.01, 0.08, 0.25].map((v) => v * M);
  ok(`当たる確率 徳0/5/10 = ${res.map((x) => (x.p * 100).toFixed(1) + '%').join('/')}（期待 1/8/25%×${M}。各1万回）。当たりだけ3つそろう`, res.every((x, i) => Math.abs(x.p - want[i]) < 3 * Math.sqrt((want[i] * (1 - want[i])) / N) + 0.002 && x.bad === 0));
  ok(`間は線形補間（徳2.5→4.5%×${M}、徳7.5→16.5%×${M}）`, Math.abs(slotRate(2.5) - 0.045 * M) < 1e-9 && Math.abs(slotRate(7.5) - 0.165 * M) < 1e-9);
  // 連チャン: 必ず続く設定で、強さが 普通→強い→バランスブレーカー→（上限）。徳が下がるのは最初の当選時だけ
  const q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; q.lock = () => {}; const sent: any[] = [];
  Object.defineProperty(q, 'clients', { value: [{ sessionId: 'x', send: (t: string, m: any) => { if (t === 'slot') sent.push(m); } }] });
  const cb = C.SLOT.chainBreak; (C.SLOT as any).chainBreak = 1;
  q.onCreate(); q.notice = () => {}; q.startMatch(); q.beginPlay(); q.teams[0].toku = 6; q.slotChain = 1; q.startSpin(0, 'win'); q.teams[1].slot.start = 1e9;
  let t = 0; while (sent.length < 4 && t < 30) { q.now += 0.05; t += 0.05; q.updateSlots(); }
  const tokuAfter = q.teams[0].toku;
  q.slotChain = 0; (C.SLOT as any).chainBreak = 0; for (let i = 0; i < 40; i++) { q.now += 0.05; q.updateSlots(); }
  (C.SLOT as any).chainBreak = cb;
  ok(`当たると徳${C.SLOT.winToku}（最初の当選時だけ）、連チャンのたびに強さが1段階上がる（上限バランスブレーカー）: ${sent.map((m) => `${m.chain}:${C.POWER_TIERS[m.tier]}`).join(' ')}`,
    JSON.stringify(sent.slice(0, 4).map((m) => [m.team, m.chain, m.tier])) === JSON.stringify([[0, 1, 1], [0, 2, 2], [0, 3, 3], [0, 4, 3]]) && tokuAfter === 6 + C.SLOT.winToku && q.teams[0].toku === tokuAfter);
  ok(`連チャンの払い出しは${C.SLOT.gap}秒おき、終わったら次の回転`, Math.abs(t - (C.SLOT.spin + 3 * C.SLOT.gap)) < 0.11 && q.teams[0].slot.payoutAt === null && !q.teams[0].slot.win || q.teams[0].slot.start > 0, { t });
  ok(`初回の払い出しはバランスブレーカーにならない（${C.POWER_TIERS[C.SLOT.firstTier]}）`, C.SLOT.firstTier < C.POWER_TIERS.length - 1 && sent[0].tier === C.SLOT.firstTier);
  // バランスブレーカー段階への連チャンは別の確率（chainBreak）。通常の連チャンを必ず続く設定にして数える
  {
    const NB = 4000, top = C.POWER_TIERS.length - 1, z: any = new (GameRoom as any)(); z.setSimulationInterval = () => {}; const got: number[] = [];
    Object.defineProperty(z, 'clients', { value: [] });
    z.onCreate(); z.notice = () => {}; z.startMatch(); z.beginPlay(); z.slotChain = 1; z.teams[1].slot.start = 1e9; z.payout = (_t: number, _c: number, tier: number) => got.push(tier);
    let reach = 0, broke = 0;
    for (let i = 0; i < NB; i++) {
      got.length = 0; z.startSpin(0, 'win'); z.now += C.SLOT.spin;
      for (let j = 0; j < top; j++) { z.updateSlots(); z.now += C.SLOT.gap; } // 普通 → 強い →（連チャンすれば）バランスブレーカー
      if (got.includes(top - 1)) reach++;
      if (got.includes(top)) broke++;
    }
    const pb = broke / reach;
    ok(`バランスブレーカー段階への連チャン = ${(pb * 100).toFixed(1)}%（期待 ${C.SLOT.chainBreak * 100}%、通常の連チャンは ${C.SLOT.chain * 100}%）`, Math.abs(pb - C.SLOT.chainBreak) < 0.03 && C.SLOT.chain === 0.35, { reach, broke });
  }
  // 払い出し: ウルト（自陣の生存者全員が変身）
  const u = mk('sayo'); u.r.addPlayer('d', 0, true); const D = u.r.players.get('d'); Object.assign(D, { alive: true, x: 1500, y: 900 }); const orig = Math.random; Math.random = () => 0.1; u.r.payout(0, 2, 2); Math.random = orig;
  ok('払い出し「ウルト」: 自陣の生存者全員が変身（強さはその回の段階）', u.A.ult?.tier === 2 && D.ult?.tier === 2 && ![...u.r.players.values()].some((p: any) => p.team === 1 && p.ult));
  Math.random = () => 0.9; u.r.payout(0, 1, 3); Math.random = orig;
  ok('払い出し「アシスト召喚」: 1体（強さはその回の段階）', [...u.r.players.values()].filter((p: any) => p.assist && p.team === 0 && p.tier === 3).length === 1);
  const pw = [0, 0]; for (let i = 0; i < N; i++) pw[lottery(Object.values(C.SLOT.payout))]++;
  ok(`払い出しの抽選 ult/assist = ${pw.map((x) => (x / N * 100).toFixed(1) + '%').join('/')}（期待 50/50）`, pw.every((x) => Math.abs(x / N - 0.5) < 0.02));
}

console.log('--- アシスト3人（技の発動条件・効果・予告と回避）');
{
  const setup = (char: string, tier = 1) => { const z = mk('sayo', 'metan'); const a = z.r.summonAssist(0, tier, char); Object.assign(a, { x: 1552, y: 900, skillReadyAt: 0 }); Object.assign(z.A, { x: 3000, y: 300 }); z.B.hp = 9999; return { ...z, a }; };
  const run = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updateAssists(); z.r.updateWarns(); } };
  const U = C.ASSIST.units;
  ok(`共通: HPはプレイヤーの${C.ASSIST.hp}倍、移動は${C.ASSIST.speed}倍、強さはHPに掛かる`, (() => { const z = setup('kurono', 3); return z.r.maxHp(z.a) === C.PLAYER_HP * C.ASSIST.hp * C.POWER_MULT[3] && z.r.speedOf(z.a) === C.PLAYER_SPEED * C.ASSIST.speed; })());
  // 玄野武宏
  let z = setup('kurono'); Object.assign(z.B, { x: 1552 + U.kurono.sense + 20, y: 900 }); run(z, 0.05);
  ok(`玄野武宏: 周囲${U.kurono.sense}pxに敵がいなければ発動しない`, z.r.warns.length === 0);
  z = setup('kurono'); Object.assign(z.B, { x: 1552 + 100, y: 900 }); run(z, 0.05); const w0 = z.r.warns[0];
  run(z, U.kurono.warn - 0.15); const before = z.B.hp; run(z, 0.15);
  ok(`玄野武宏: 敵がいると自分中心・半径${U.kurono.r}の予告を${U.kurono.warn}秒出してから範囲攻撃`, !!w0 && w0.r === U.kurono.r && w0.follow === z.a.id && before === 9999 && z.B.hp < 9999);
  z = setup('kurono'); Object.assign(z.B, { x: 1552 + 100, y: 900 }); run(z, 0.05); z.B.x = 1552 + U.kurono.r + 30; run(z, U.kurono.warn);
  ok('玄野武宏: 予告の間に範囲の外へ出れば当たらない', z.B.hp === 9999 && z.r.warns.length === 0);
  const t1 = setup('kurono', 1), t3 = setup('kurono', 3); for (const q of [t1, t3]) { Object.assign(q.B, { x: 1552 + 100, y: 900 }); run(q, U.kurono.warn + 0.1); }
  ok('強さは技の効果に倍率として掛かる（バランスブレーカーは普通の2倍）', Math.abs((9999 - t3.B.hp) / (9999 - t1.B.hp) - C.POWER_MULT[3] / C.POWER_MULT[1]) < 0.05);
  run(t1, 1); ok(`一定時間ごと（${U.kurono.every}秒）`, t1.r.warns.length === 0); run(t1, U.kurono.every - 1); ok(`${U.kurono.every}秒たつと次を発動`, t1.r.warns.length === 1);
  // 青山龍星
  z = setup('aoyama'); Object.assign(z.B, { x: 1552 + U.aoyama.sense - 20, y: 900 }); run(z, 0.05); const wa = z.r.warns[0];
  ok(`青山龍星: 周囲${U.aoyama.sense}pxの一番近い敵の位置に、半径${U.aoyama.r}の予告`, !!wa && wa.x === z.B.x && wa.r === U.aoyama.r && wa.follow === null);
  z.B.x += U.aoyama.r + 20; run(z, U.aoyama.warn);
  ok('青山龍星: 予告の位置は発動時点で固定（動いて避けられる）', z.B.hp === 9999);
  z = setup('aoyama'); Object.assign(z.B, { x: 1552 + 150, y: 900 }); run(z, U.aoyama.warn + 0.1);
  ok('青山龍星: 留まれば当たる', z.B.hp < 9999);
  // 白上虎太郎
  z = setup('shirakami'); z.a.hp = 50; run(z, 0.05);
  ok(`白上虎太郎: 周囲${U.shirakami.sense}pxに味方がいなければ発動しない`, z.a.hp === 50);
  z = setup('shirakami'); Object.assign(z.A, { x: 1552 + 100, y: 900, hp: 20 }); z.a.hp = 50; const sp0 = z.r.speedOf(z.A); run(z, 0.05);
  ok(`白上虎太郎: 味方がいると、周囲の味方と自分を${U.shirakami.heal}×強さ回復、移動×${U.shirakami.boost}（${U.shirakami.dur}秒）`, z.A.hp === 20 + U.shirakami.heal * C.POWER_MULT[1] && z.a.hp === 50 + U.shirakami.heal * C.POWER_MULT[1] && Math.abs(z.r.speedOf(z.A) / sp0 - U.shirakami.boost) < 1e-9 && z.r.fx.some((f: any) => f.kind === 'ring' && f.color === 'heal'));
  z.r.now += U.shirakami.dur; ok('移動速度上昇は時間で切れる', Math.abs(z.r.speedOf(z.A) - sp0) < 1e-9);
  // 前進: 敵大将へ経路探索で進み、攻撃されても止まらない
  const g = mk('sayo', 'metan'); Object.assign(g.r.bosses[1], g.r.bases[1][g.r.bosses[1].base]); const a = g.r.summonAssist(0, 1, 'kurono'); Object.assign(a, { x: 1552, y: 900 });
  Object.assign(g.B, { x: 1552, y: 870 }); g.B.aim = 'nearest'; delete g.B.st.test; const d0 = Math.hypot(g.r.bosses[1].x - a.x, g.r.bosses[1].y - a.y);
  for (let i = 0; i < 60; i++) { g.r.now += 0.05; g.r.botThink(a, g.r.obstacles()); g.r.updatePlayers(0.05); g.B.x = a.x; g.B.y = a.y - 30; g.B.cooldownUntil = 0; g.r.attack('b'); }
  ok('前進: 敵大将へ経路探索で進み、途中で攻撃されても前進を続ける', a.hp < g.r.maxHp(a) && Math.hypot(g.r.bosses[1].x - a.x, g.r.bosses[1].y - a.y) < d0 - 150, { d0: Math.round(d0), d1: Math.round(Math.hypot(g.r.bosses[1].x - a.x, g.r.bosses[1].y - a.y)) });
  const f = mk('sayo'); Object.assign(f.r.bosses[1], { x: 1600, y: 900 }); const af = f.r.summonAssist(0, 1, 'aoyama'); Object.assign(af, { x: 1552, y: 900 });
  for (let i = 0; i < 20; i++) { f.r.now += 0.05; f.r.botThink(af, f.r.obstacles()); f.r.updatePlayers(0.05); }
  ok('敵大将に着いたら攻撃する', f.r.bosses[1].hp < C.BOSS_HP);
}

console.log('--- アルの突撃（タメ・方向・壁とバリケードの破壊・一度だけ当たる・無敵・不発）');
{
  const AR = CHARS.aru.skill;
  const step = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); } };
  const aru = (x: number, y: number, dx: number, dy: number, b?: string) => { const z = mk('aru', b); z.A.bot = true; Object.assign(z.A, { x, y, dx, dy }); z.A.tgt = null; return z; };
  // タメ中は止まる、方向はタメに入った瞬間の移動入力
  let z = aru(248, 360, 0, 1); z.r.skill('a'); const ct = z.A.skillReadyAt;
  z.A.dx = 1; z.A.dy = 0; step(z, AR.windup - 0.1); const still = z.A.x === 248 && z.A.y === 360;
  ok(`タメ（${AR.windup}秒）の間はその場で止まる（移動入力があっても）。CTは押した時点で消費`, still && !!z.A.st.charge && Math.abs(ct - AR.ct) < 1e-9);
  step(z, 0.3);
  ok('方向はタメに入った瞬間の移動入力で固定（あとで入力を変えても変わらない）', z.A.y > 370 && Math.abs(z.A.sk.a - Math.PI / 2) < 1e-9);
  // 垂直方向の入力で少し動ける（速さは移動速度×side）
  z = aru(248, 360, 0, 1); z.r.skill('a'); z.A.dx = 0; z.A.dy = 0; step(z, AR.windup + 0.05); const x0 = z.A.x; z.A.dx = 1; z.A.dy = 0; step(z, 0.2);
  ok(`進行方向に垂直な入力で動ける（移動速度×${AR.side}）`, Math.abs(z.A.x - x0 - z.r.speedOf(z.A) * AR.side * 0.2) < 1);
  // 移動入力がなければ照準の対象、それもなければ向いている方向
  z = aru(1552, 900, 0, 0, 'metan'); z.A.face = Math.PI; z.A.tgt = { k: 'p', o: z.B, x: 1552, y: 1000, r: 10 }; z.r.skill('a');
  const z2 = aru(1552, 900, 0, 0); z2.A.face = Math.PI; z2.r.skill('a');
  ok('移動入力がなければ照準の対象の方向、それもなければ向いている方向', Math.abs(z.A.sk.a - Math.PI / 2) < 1e-9 && Math.abs(z2.A.sk.a - Math.PI) < 1e-9);
  // 壁・バリケードを壊して進む（study の南壁）。外周の壁は壊さずそこで止まる
  z = aru(248, 360, 0, 1); z.r.skill('a'); step(z, AR.windup + 0.6);
  const broke = z.r.broken.filter(([, y]: number[]) => y === 26).length;
  ok(`壁を壊して進む（study の南壁を${broke}マス、壊した壁は床になる）`, broke >= 4 && z.r.tiles[26][12] === '.' && z.A.y > 26 * T + 16 && JSON.stringify(z.r.walls) !== JSON.stringify(C.WALLS));
  ok(`壁を壊したら徳${C.TOKU.wall}（1回の突撃で1回）`, Math.abs(z.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.wall)) < 1e-9);
  z = aru(248, 120, 0, -1); z.r.skill('a'); step(z, AR.windup + 0.3);
  ok('マップ外周の壁は壊さず、そこで突撃が終わる', z.r.broken.length === 0 && !z.A.st.rush && z.A.y >= 3 * T);
  // 触れた敵に大ダメージ、同じ相手には1回だけ
  z = aru(1400, 900, 1, 0, 'metan'); Object.assign(z.B, { x: 1500, y: 900, hp: 9999 }); delete z.B.st.rush; z.r.skill('a'); step(z, AR.windup + 1.0);
  ok(`触れた敵に${AR.dmg}（×全体の倍率・被ダメ軽減）を1回だけ`, 9999 - z.B.hp === Math.round(AR.dmg * C.DAMAGE_MULT * 0.8), { dmg: 9999 - z.B.hp });
  z = aru(1400, 900, 1, 0); Object.assign(z.r.bosses[1], { x: 1520, y: 900 }); z.r.skill('a'); step(z, AR.windup + 1.0);
  ok('敵大将にも当たる（大将はひるまない）', C.BOSS_HP - z.r.bosses[1].hp === AR.dmg * C.DAMAGE_MULT);
  z = aru(1400, 900, 1, 0); z.r.spawnCourier(); Object.assign(z.r.couriers[0], { x: 1500, y: 900 }); z.r.skill('a'); step(z, AR.windup + 0.6);
  ok('コバコにも当たる（KOする。落とした荷物はそのまま通れば拾う）', !z.r.couriers.length && z.r.courierAt === z.r.now - (z.r.now - z.r.courierAt) && z.r.courierAt > 0 && z.r.courierAt < 1e9);
  // 突撃中は無敵（ダメージ・はじき・ずんだ餅化なし）、通常攻撃しない
  z = aru(1400, 900, 1, 0, 'metan'); z.r.skill('a'); step(z, AR.windup + 0.1); const hp0 = z.A.hp, p0 = { x: z.A.x, y: z.A.y };
  z.r.damagePlayer(z.A, 50, 'b'); z.r.push({ k: 'p', o: z.A, x: z.A.x, y: z.A.y, r: 10 }, 0, 1, 100);
  SKILLS.zunko.use(z.r, z.B, 0); Object.assign(z.r.shots[z.r.shots.length - 1], { id: 1, x: z.A.x - 5, y: z.A.y, left: 50 }); z.r.updateShots(0.05);
  ok('突撃中は無敵（ダメージ・はじき・ずんだ餅化を受けない）', z.A.hp === hp0 && z.A.y === p0.y && !z.r.stat(z.A, 'mochi'));
  z.A.cooldownUntil = 0; const cd = z.A.cooldownUntil; z.r.attack('a'); ok('突撃中は通常攻撃しない', z.A.cooldownUntil === cd);
  z = aru(1400, 900, 1, 0); z.r.skill('a'); const t0 = z.r.now; step(z, AR.windup + 0.05); const until = z.A.st.rush.until;
  ok(`最大${AR.dur}秒で終わる`, Math.abs(until - (t0 + AR.windup + 0.05 + AR.dur)) < 0.051);
  // タメ中に倒されたら不発、CTは消費
  z = aru(1400, 900, 1, 0); z.r.skill('a'); const ready = z.A.skillReadyAt; step(z, 0.3); z.r.damagePlayer(z.A, 1e9, null); z.r.now = z.A.respawnAt; z.r.updatePlayers(0.05); step(z, AR.windup);
  ok('タメ中に倒されたら突撃は不発、CTは消費される', !z.A.st.charge && !z.A.st.rush && z.A.skillReadyAt === ready && ready > 0);
  // Bot: 予測進路に敵か敵大将がいるときに使う
  const bb = mk('aru', 'metan'); bb.A.bot = true; Object.assign(bb.A, { dx: 1, dy: 0 }); Object.assign(bb.B, { x: 1552 + 300, y: 900 });
  const yes = bb.r.botSkillUseful(bb.A); bb.B.y = 900 + AR.w; const no = bb.r.botSkillUseful(bb.A);
  ok('Bot: 予測進路（エフェクトの範囲）に敵がいるときに使う（外れていれば使わない）', yes && !no);
  ok(`エフェクトの形: 長さ${AR.len}・幅${AR.w}、頭は${AR.head}px前、尾は後ろへ細くなる`, inDashShape(AR, AR.head + AR.w / 2 - 1, 0, 0, 0, 0) && !inDashShape(AR, AR.head + AR.w / 2 + 1, 0, 0, 0, 0) && inDashShape(AR, AR.head + AR.w / 2 - AR.len + 1, 0, 0, 0, 0) && !inDashShape(AR, 0, AR.w / 2 - 5, 0, 0, 0) && inDashShape(AR, AR.head, AR.w / 2 - 1, 0, 0, 0));
  ok(`CT は${AR.ct}秒のまま`, AR.ct === 6);
}

console.log('--- 攻撃間隔（近接・遠距離・きりたんの切り替え、手動も同じ）');
{
  const gap = (ch: string, setup: (z: any) => void = () => {}) => {
    const z = mk(ch, 'metan'); z.B.hp = 9999; setup(z);
    z.r.attack('a'); const t0 = z.A.cooldownUntil - z.r.now;
    const h1 = z.B.hp; z.r.now += t0 - 0.01; z.r.attack('a'); z.r.updateShots(0.5); const early = z.B.hp; // 間隔の直前は撃てない
    return { t0, blocked: early === h1 || ch === 'zunko' || ch === 'kiritan' };
  };
  const me = gap('sayo'), zu = gap('zunko');
  const kf = gap('kiritan', (z) => { z.A.tgt = { k: 'p', o: z.B, x: z.B.x + 200, y: z.B.y, r: 10 }; }); // 遠い対象 → きりたん砲
  const kn = gap('kiritan'); // 近い対象（隣） → 包丁
  kn; // 隣の敵は p.tgt なし＝遠い扱いなので、包丁は対象が近いときで確認する
  const kn2 = gap('kiritan', (z) => { z.A.tgt = { k: 'p', o: z.B, x: z.B.x, y: z.B.y, r: 10 }; });
  ok(`近接は${C.ATTACK_COOLDOWN_MELEE}秒、遠距離（zunko・きりたん砲）は${C.ATTACK_COOLDOWN_RANGED}秒、きりたんの包丁（近い対象）は近接`, me.t0 === C.ATTACK_COOLDOWN_MELEE && me.blocked && zu.t0 === C.ATTACK_COOLDOWN_RANGED && kf.t0 === C.ATTACK_COOLDOWN_RANGED && kn2.t0 === C.ATTACK_COOLDOWN_MELEE, { me: me.t0, zu: zu.t0, cannon: kf.t0, knife: kn2.t0 });
  const a = mk('sayo', 'metan'); a.A.aim = 'nearest'; delete a.A.st.test; a.r.updatePlayers(0.05); const h1 = a.B.hp; a.r.now += C.ATTACK_COOLDOWN_MELEE - 0.1; a.r.updatePlayers(0.05); const h2 = a.B.hp; a.r.now += 0.1; a.r.updatePlayers(0.05);
  ok('オートアタックも同じ間隔（手動の SPACE と共通）', h2 === h1 && a.B.hp < h1);
}

console.log('--- アシストの同時1体と強化・アシスト同士の優先');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; const sent: any[] = [];
  Object.defineProperty(r, 'clients', { value: ['x', 'y'].map((id) => ({ sessionId: id, send: (t: string, m: any) => sent.push([id, t, m]) })) });
  r.onCreate(); r.addPlayer('a', 0, false); r.startMatch(); r.beginPlay();
  const a = r.summonAssist(0, 1); a.hp = 10; const b = r.summonAssist(0, 2);
  const up = sent.filter(([, t]) => t === 'assistUp');
  ok(`各陣営、同時に出ているアシストは${C.ASSIST.max}体まで。超える召喚は今のアシストの強化（強さ+1、HPは新しい最大値まで回復、両陣営に通知）`, b === a && [...r.players.values()].filter((p: any) => p.assist && p.team === 0).length === 1 && a.tier === 2 && a.hp === r.maxHp(a) && up.length === 2 && up.every(([, , m]) => m.tier === 2 && m.char === a.char && m.team === 0));
  r.summonAssist(0, 1); r.summonAssist(0, 1);
  ok('強化の上限はバランスブレーカー', a.tier === C.POWER_TIERS.length - 1);
  r.items.push({ id: 900, kind: 'box_assist', team: -1, x: 0, y: 0 }); const hp0 = (a.hp = 5); r.takeItem(r.players.get('a'), r.items[r.items.length - 1]);
  ok('アシスト箱でも強化（上限のままHP回復）', a.tier === 3 && a.hp > hp0 && [...r.players.values()].filter((p: any) => p.assist).length === 1);
  r.damagePlayer(a, 1e9, null); const c = r.summonAssist(0, 1);
  ok('アシストが倒れたら、次の召喚は新しく出る', c !== a && c.tier === 1);
  // アシスト同士: 互いを最優先
  const z = mk('sayo', 'metan'); Object.assign(z.r.bosses[1], z.r.bases[1][z.r.bosses[1].base]);
  const x = z.r.summonAssist(0, 1, 'aoyama'), y = z.r.summonAssist(1, 1, 'kurono');
  Object.assign(x, { x: 1552, y: 900, skillReadyAt: 0 }); Object.assign(y, { x: 1552 + 45, y: 900 }); Object.assign(z.B, { x: 1552 + 20, y: 900 }); // 相手のプレイヤーの方が近い
  z.r.assistThink(x, z.r.obstacles()); z.r.updatePlayers(0);
  ok('両陣営のアシストが出ていれば、敵大将ではなく相手のアシストへ向かい、攻撃の対象も相手のアシスト（近いプレイヤーより優先）', x.goal === `p:${y.id}` && x.tgt?.o === y);
  z.r.updateAssists();
  ok('技の対象も相手のアシストを優先（青山の予告は相手のアシストの位置）', z.r.warns.length === 1 && z.r.warns[0].x === y.x);
  z.r.damagePlayer(y, 1e9, null); z.r.assistThink(x, z.r.obstacles());
  ok('相手のアシストが倒れたら敵大将への前進に戻る', x.goal === 'boss');
}

console.log('--- スロットの罰の出目');
{
  const N = 10000, { r } = mk('sayo');
  const cnt = (toku: number) => { r.teams[0].toku = toku; let pen = 0, win = 0, bad = 0; for (let i = 0; i < N; i++) { r.startSpin(0); const q = r.teams[0].slot; if (q.pen) pen++; if (q.win) win++; if (q.pen !== q.reels.every((v: number) => v === -1)) bad++; if (q.pen && q.win) bad++; } return { pen: pen / N, win: win / N, bad }; };
  const res = [0, 2.5, 5].map(cnt), want = [0.2, 0.1, 0];
  ok(`罰の出る確率 徳0/2.5/5 = ${res.map((x) => (x.pen * 100).toFixed(1) + '%').join('/')}（期待 20/10/0%。各1万回）。当たり・罰・外れは1回のくじで、罰は ×××`, res.every((x, i) => Math.abs(x.pen - want[i]) < 3 * Math.sqrt((want[i] * (1 - want[i])) / N) + 0.002 && x.bad === 0));
  ok(`当たりの確率は罰と別に徳で決まる（徳0で1%×${C.SLOT.rateMult}のまま）`, Math.abs(res[0].win - 0.01 * C.SLOT.rateMult) < 0.004, res[0].win);
  // 効果: 生存者全員（アシストを除く）。徳は変わらない。両陣営に通知
  const q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; q.lock = () => {}; const sent: any[] = [];
  Object.defineProperty(q, 'clients', { value: ['x', 'y'].map((id) => ({ sessionId: id, send: (t: string, m: any) => sent.push([id, t, m]) })) });
  q.onCreate(); q.startMatch(); q.beginPlay(); const team0 = [...q.players.values()].filter((p: any) => p.team === 0); const dead = team0[3]; q.damagePlayer(dead, 1e9, null);
  const as = q.summonAssist(0, 1); const orig = Math.random;
  const run = (u: number) => { Math.random = () => u; q.penalty(0); Math.random = orig; };
  const hp0 = team0.map((p: any) => p.hp), toku0 = q.teams[0].toku, ash = as.hp; run(0.1);
  ok(`罰「全員にダメージ」: 生存者全員に最大HPの${C.SLOT.penalty.dmg * 100}%（被ダメ軽減なし）、アシスト・反省中は対象外、徳は変わらない`, team0.slice(0, 3).every((p: any, i: number) => hp0[i] - p.hp === Math.round(q.maxHp(p) * C.SLOT.penalty.dmg)) && as.hp === ash && q.teams[0].toku === toku0 && sent.filter(([, t]) => t === 'penalty').length === 2);
  const p0 = team0[0], sp0 = q.speedOf(p0); run(0.5);
  ok(`罰「移動速度低下」: ×${C.SLOT.penalty.slow}、${C.SLOT.penalty.dur}秒`, Math.abs(q.speedOf(p0) / sp0 - C.SLOT.penalty.slow) < 1e-9 && (q.now += C.SLOT.penalty.dur, Math.abs(q.speedOf(p0) - sp0) < 1e-9));
  const w = mk('sayo', 'metan'); w.B.hp = 9999; w.r.attack('a'); const d1 = 9999 - w.B.hp; w.A.weakUntil = w.r.now + 8; w.r.now += 1; w.B.hp = 9999; w.r.attack('a');
  ok(`罰「攻撃力低下」: ×${C.SLOT.penalty.weak}`, Math.abs((9999 - w.B.hp) / d1 - C.SLOT.penalty.weak) < 0.03, { d1, d2: 9999 - w.B.hp });
  q.teams[1].slot.start = 1e9; q.startSpin(0, 'pen'); const fx0 = sent.length; q.now += C.SLOT.spin; q.updateSlots();
  const held = q.teams[0].slot.pen && q.teams[0].slot.holdUntil > q.now; q.now += C.SLOT.penHold; q.updateSlots();
  ok(`回転が終わって罰の出目なら、罰を掛け、出目を${C.SLOT.penHold}秒見せてから次の回転`, sent.slice(fx0).filter(([, t]) => t === 'penalty').length === 2 && held && q.teams[0].slot.start === q.now && q.teams[0].slot.holdUntil === 0);
}

console.log('--- 反省中の徳の上がり方');
{
  const rates: number[] = [];
  for (let n = 1; n <= 4; n++) {
    const { r } = mk('sayo'); for (const p of r.players.values()) { p.alive = true; p.respawnAt = 0; }
    [...r.players.values()].filter((p: any) => p.team === 0).slice(0, n).forEach((p: any) => { p.alive = false; p.respawnAt = 1e9; });
    r.teams[0].toku = 1; r.updateReflect(1); rates.push(+(r.teams[0].toku - 1).toFixed(6));
  }
  ok(`反省中の人数1〜4で毎秒 ${rates.join(' / ')}（${C.REFLECT_TOKU}×人数²）`, rates.every((v, i) => Math.abs(v - C.REFLECT_TOKU * (i + 1) ** 2) < 1e-9));
  const { r } = mk('sayo'); [...r.players.values()].filter((p: any) => p.team === 0).forEach((p: any) => { p.alive = false; p.respawnAt = 1e9; }); r.teams[0].toku = 9.9; r.updateReflect(1);
  ok(`徳の上限${C.TOKU_MAX}で止まる`, r.teams[0].toku === C.TOKU_MAX);
}

console.log('--- 開始前のスロット・結果画面の技');
{
  const s0: any = new (GameRoom as any)(); s0.setSimulationInterval = () => {}; s0.lock = () => {}; Object.defineProperty(s0, 'clients', { value: [] });
  s0.onCreate(); s0.startMatch(); const st = s0.teams[0].slot.start, reels = JSON.stringify(s0.teams[0].slot.reels);
  for (let i = 0; i < 200; i++) s0.tick(0.05, false);
  ok(`演出は倍速（横並び${C.INTRO_LINEUP}秒・カットイン${C.INTRO_CUTIN}秒×4・カウント${C.COUNTDOWN}秒、倍率 INTRO_SPEED=${C.INTRO_SPEED}）`, C.INTRO_LINEUP === 2 / C.INTRO_SPEED && C.INTRO_CUTIN === 2 / C.INTRO_SPEED && C.COUNTDOWN === 3 / C.INTRO_SPEED && C.GAME_START_MS === 1200 / C.INTRO_SPEED);
  const s1: any = new (GameRoom as any)(); s1.setSimulationInterval = () => {}; s1.lock = () => {}; Object.defineProperty(s1, 'clients', { value: [] });
  s1.onCreate(); s1.startMatch(); const r0 = JSON.stringify(s1.teams[0].slot); let same = true;
  while (s1.phase !== 'playing') { s1.tick(0.05, false); if (s1.phase !== 'playing' && JSON.stringify(s1.teams[0].slot) !== r0) same = false; }
  for (let i = 0; i < Math.round((C.SLOT.spin + 0.1) / 0.05); i++) s1.tick(0.05, false);
  ok('スロットは GAME START まで回さない（開始前は止めたまま）、GAME START で回り始める', same && st === 0 && reels.length > 0 && s1.teams.every((t: any) => t.slot.start > 0 || t.slot.payoutAt !== null));
  // 結果画面: 技を使える。エフェクトは出るが、ダメージ・徳・壁の破壊はない。部屋からは出られない
  const z = mk('hanamaru', 'metan'); Object.assign(z.A, { x: 200, y: 400, face: Math.PI / 2 }); z.A.tgt = null; z.r.endMatch(2);
  Object.assign(z.A, { x: 200, y: 400, face: Math.PI / 2, skillReadyAt: 0 }); const toku = z.r.teams[0].toku; z.r.fx = []; z.r.skill('a'); const fist = ents(z.r, 'fist').length;
  for (let i = 0; i < 40; i++) z.r.tick(0.05, false);
  ok('結果画面: 技を使える（拳は出て飛ぶ）が、壁は壊れず徳も変わらない', z.A.skillReadyAt > 0 && fist === 1 && z.r.broken.length === 0 && z.r.teams[0].toku === toku);
  const w = mk('whitecul', 'metan'); w.r.endMatch(2); const room = w.r.cageOf(w.A); Object.assign(w.B, { x: w.A.x + 30, y: w.A.y }); w.A.face = 0; w.A.skillReadyAt = 0; const hb = w.B.hp; w.r.skill('a');
  ok('結果画面: 技が当たってもダメージはない', w.B.hp === hb && w.r.fx.some((f: any) => f.kind === 'rect'));
  const m = mk('mochiko', 'metan'); m.r.endMatch(2); m.A.skillReadyAt = 0; m.r.skill('a'); const f0 = ents(m.r, 'funnel').map((f: any) => f.x + f.y).join(); m.A.x += 60; for (let i = 0; i < 10; i++) m.r.tick(0.05, false); // 持ち主が動くと付いていく
  ok('結果画面: ファンネルなどの物も出て動く', ents(m.r, 'funnel').length === CHARS.mochiko.skill.n && ents(m.r, 'funnel').map((f: any) => f.x + f.y).join() !== f0);
  const a = mk('aru', 'metan'); a.r.endMatch(2); const cg = a.r.cageOf(a.A); a.A.skillReadyAt = 0; a.A.inDx = 1; a.A.inDy = 0; a.r.skill('a'); const b0 = a.r.broken.length;
  for (let i = 0; i < 60; i++) a.r.tick(0.05, false);
  const inCage = a.A.x >= cg.x && a.A.x <= cg.x + cg.w && a.A.y >= cg.y && a.A.y <= cg.y + cg.h;
  ok('結果画面: アルの突撃はタメ→突撃で動くが、部屋から出ず壁も壊さない', !!a.A.st.rush && inCage && a.r.broken.length === b0, { x: Math.round(a.A.x), cg });
  room;
}

console.log(`--- 大将の反撃（全体×${C.BOSS_DAMAGE_MULT}、アシストへはさらに×${C.BOSS_ASSIST_MULT}、アシストを優先）`);
{
  const { r, A } = mk('sayo'); const boss = r.bosses[1]; Object.assign(boss, { x: 1640, y: 900, target: 'a' });
  Object.assign(A, { x: boss.x - 40, y: boss.y }); const as = r.summonAssist(0, 1); Object.assign(as, { x: boss.x + 40, y: boss.y });
  const ha = A.hp, hs = as.hp; r.updateBosses();
  ok(`近くにアシストがいれば反撃の対象はアシスト（${C.BOSS_DAMAGE}×${C.BOSS_DAMAGE_MULT}×${C.BOSS_ASSIST_MULT}）`, A.hp === ha && hs - as.hp === Math.round(C.BOSS_DAMAGE * C.BOSS_DAMAGE_MULT * C.BOSS_ASSIST_MULT), { dmg: hs - as.hp });
}

console.log('--- 通信の切断と再接続（スマホのバックグラウンド等）');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [] }); r.onCreate();
  let allowed: any = null; r.allowReconnection = (c: any, sec: number) => { allowed = { id: c.sessionId, sec }; };
  r.onJoin({ sessionId: 'h' }); r.startMatch(); r.beginPlay();
  const P = r.players.get('h'); P.aim = 'lowhp';
  r.onDrop({ sessionId: 'h' });
  ok(`切れたら${C.RECONNECT_SEC}秒は再接続を待ち、その間は Bot が代わりに動かす`, allowed?.id === 'h' && allowed.sec === C.RECONNECT_SEC && P.bot && P.aim === C.BOT_AIM && r.owners.get('h') === 'h');
  for (const p of r.players.values()) if (p !== P) p.bot = false; // Bot（入れ替え先の候補）は P だけ
  r.onJoin({ sessionId: 'x' });
  ok('再接続待ちの間は、途中参加の人に入れ替わられない', r.owners.get('x') === undefined);
  r.onReconnect({ sessionId: 'h' });
  ok('再接続したら操作が本人に戻る（同じキャラ・陣営）', !P.bot && r.players.get(r.owners.get('h')) === P);
  r.onDrop({ sessionId: 'h' }); r.onLeave({ sessionId: 'h' }); r.onJoin({ sessionId: 'y' });
  ok('再接続できずに抜けたら Bot になり、途中参加の人が入れ替われる', r.owners.get('y') === P.id && !P.bot);
}

console.log('--- 待機画面の陣営移動・試合ログ');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [] }); r.onCreate();
  r.onJoin({ sessionId: 'h1' }); r.onJoin({ sessionId: 'h2' }); // h1=陣営0、h2=陣営1
  r.messages.pick({ sessionId: 'h2' }, { char: 'metan' }); r.messages.team({ sessionId: 'h2' }, { team: 0 });
  const H2 = r.players.get('h2');
  ok('待機画面で陣営を移れる（キャラはそのまま）', H2.team === 0 && H2.char === 'metan' && r.owners.get('h2') === 'h2');
  for (let i = 3; i <= 4; i++) { r.onJoin({ sessionId: `h${i}` }); r.messages.team({ sessionId: `h${i}` }, { team: 0 }); }
  r.onJoin({ sessionId: 'h5' }); r.messages.team({ sessionId: 'h5' }, { team: 0 });
  ok(`満員（${C.TEAM_SIZE}人）の陣営には移れない`, r.players.get('h5').team === 1 && [...r.players.values()].filter((p: any) => p.team === 0).length === C.TEAM_SIZE);
  const file = `${process.env.TMPDIR ?? '/tmp'}/matches_test_${process.pid}.jsonl`;
  (GameRoom as any).logFile = file;
  r.startMatch(); r.beginPlay(); r.messages.team({ sessionId: 'h5' }, { team: 0 });
  ok('試合中は陣営を移れない', r.players.get('h5').team === 1);
  const enemy = r.bosses[1], hp = enemy.hp;
  r.damageBoss(enemy, 100, r.players.get('h1'));
  r.damageBoss(enemy, 30, { ...r.players.get('h1'), assist: true });
  r.damageBoss(enemy, hp, r.players.get('h1')); // 撃破（与えたのは残りHPまで）
  const { readFileSync, rmSync } = await import('node:fs');
  const lines = readFileSync(file, 'utf8').trim().split('\n'); rmSync(file); (GameRoom as any).logFile = '';
  const L = JSON.parse(lines[0]);
  ok('試合終了で試合ログに1行（時刻・試合時間・勝利陣営・決着・陣営ごとのキャラと人/Bot・大将へのダメージ）', lines.length === 1 && L.start && L.end && L.sec >= 0 && L.winner === 0 && L.kind === 'boss'
    && L.teams[0].members.length === C.TEAM_SIZE && L.teams[1].members.filter((m: any) => m.human).length === 1 && L.teams[0].members.find((m: any) => m.char === 'metan')?.human
    && L.teams[0].bossDmg.player === hp - 30 && L.teams[0].bossDmg.assist === 30 && L.teams[1].bossDmg.player === 0, L);
}

console.log('--- 大将の第2形態（拠点移動の予告・広範囲攻撃・無敵・弾・攻撃の激しさ）');
{
  const SH = C.BOSS_SHOT, BL = C.BOSS_BLAST;
  // 敵（陣営0）3人: A・c は射程内、d は射程外。B は大将と同じ陣営
  const setup = () => {
    const z = mk('sayo', 'metan'); const bo = z.r.bosses[1]; Object.assign(bo, { x: 1640, y: 900, target: null });
    for (const id of ['c', 'd']) { z.r.addPlayer(id, 0, false); Object.assign(z.r.players.get(id), { alive: true, char: 'sayo' }); z.r.players.get(id).st.test = NOAUTO(); }
    Object.assign(z.A, { x: bo.x - 150, y: bo.y }); Object.assign(z.r.players.get('c'), { x: bo.x + 150, y: bo.y }); Object.assign(z.r.players.get('d'), { x: bo.x - SH.range - 60, y: bo.y });
    Object.assign(z.B, { x: bo.x - 150, y: bo.y + 4 });
    return { ...z, bo, c: z.r.players.get('c'), d: z.r.players.get('d') };
  };
  let z = setup();
  for (let i = 0; i < 60; i++) { z.r.now += 0.05; z.r.updateBosses(); }
  ok('第1形態: 弾を撃たない', z.r.shots.length === 0);
  z.bo.moved = true; z.r.updateBosses();
  const k1 = bossIntensity(z.r.now, z.bo.hp / C.BOSS_HP);
  ok(`第2形態: 範囲（${SH.range}px）内の敵の数だけ弾を撃つ（弾速${SH.speed}、ずん子の通常攻撃と同じ見た目）`, z.r.shots.length === 2 && z.r.shots.every((s: any) => s.kind === 'bullet' && s.sp === SH.speed && s.boom === SH.boom && Math.abs(s.dmg - SH.dmg * k1) < 1e-9), z.r.shots.length);
  const hp0 = [z.A.hp, z.c.hp, z.d.hp, z.B.hp];
  for (let i = 0; i < 20 && z.r.shots.length; i++) { z.r.now += 0.05; z.r.updateShots(0.05); }
  ok('弾は狙った位置で爆発し、範囲内の敵にダメージ（射程外の敵・大将の味方には当たらない）', z.A.hp < hp0[0] && z.c.hp < hp0[1] && z.d.hp === hp0[2] && z.B.hp === hp0[3] && z.r.fx.filter((f: any) => f.kind === 'aura' && f.r === SH.boom).length === 2, { hp: [z.A.hp, z.c.hp, z.d.hp, z.B.hp] });
  z.r.shots = []; z.r.now += 0.05; z.r.updateBosses(); const again = z.r.shots.length;
  z.r.now += SH.every / k1; z.r.updateBosses();
  ok(`弾の間隔は ${SH.every}秒÷激しさ`, again === 0 && z.r.shots.length === 2);
  // 拠点移動: 予告〜移動完了まで無敵、広範囲攻撃
  z = setup(); const base0 = z.bo.base; Object.assign(z.bo, z.r.bases[1][base0]);
  Object.assign(z.A, { x: z.bo.x + 40, y: z.bo.y }); Object.assign(z.c, { x: z.bo.x, y: z.bo.y + BL.r + 40 }); z.B.x = -999;
  z.r.damageBoss(z.bo, C.BOSS_MOVE_THRESHOLD, z.A); const hpT = z.bo.hp, w = z.r.warns.find((x: any) => x.boss);
  let hurt = false;
  for (let i = 0; i < Math.round(BL.warn / 0.05) - 1; i++) { z.r.now += 0.05; z.r.updateWarns(); z.r.damageBoss(z.bo, 50, z.A); if (z.bo.hp !== hpT) hurt = true; }
  const stay = z.bo.base === base0 && z.bo.moving && !z.bo.moved, a0 = z.A.hp, c0 = z.c.hp;
  z.r.now += 0.05; z.r.updateWarns();
  ok(`拠点移動: 被ダメ累計${C.BOSS_MOVE_THRESHOLD}で無敵になり、半径${BL.r}の予告を${BL.warn}秒`, !!w && w.r === BL.r && w.x === z.r.bases[1][base0].x && stay);
  ok('予告〜移動完了まで大将にダメージが入らない', !hurt && z.bo.hp === hpT);
  ok(`予告のあと広範囲攻撃（${BL.dmg}ダメージ、範囲外は当たらない）→ 別拠点へ移動、第2形態になる`, a0 - z.A.hp === BL.dmg && z.c.hp === c0 && z.bo.base !== base0 && z.bo.moved && !z.bo.moving && z.bo.x === z.r.bases[1][z.bo.base].x, { a: a0 - z.A.hp });
  z.r.damageBoss(z.bo, 10, z.A); ok('移動が終わればダメージが入る', z.bo.hp === hpT - 10);
  // 攻撃の激しさ
  const I = C.BOSS_INTENSITY, e = (t: number, h: number) => +bossIntensity(t, h).toFixed(3);
  ok(`激しさ: 時間係数は開始直後が最大（${I.time.max}）、時間で減る（${I.time.min}）。HP係数はHPが減るほど上がる（${I.hp.min}→${I.hp.max}）`,
    e(0, 1) === I.time.max * I.hp.min && e(0, 1) > e(150, 1) && e(150, 1) > e(C.MATCH_TIME, 1) && e(C.MATCH_TIME, 1) === I.time.min * I.hp.min && e(100, 0.5) > e(100, 1) && e(100, 0.2) > e(100, 0.5) && e(C.MATCH_TIME, 0) === +(I.time.min * I.hp.max).toFixed(3),
    { '0s満タン': e(0, 1), '150s満タン': e(150, 1), '300s満タン': e(300, 1), '100s HP50%': e(100, 0.5), '100s HP20%': e(100, 0.2) });
  // 反撃: 第1形態は今どおり、第2形態は激しさが掛かる
  const cnt = (moved: boolean, t: number, hp: number) => {
    const q = mk('sayo'); const bo = q.r.bosses[1]; Object.assign(bo, { x: 1640, y: 900, target: 'a', moved, hp, shotAt: 1e9 }); Object.assign(q.A, { x: bo.x - 40, y: bo.y, hp: 9999 }); q.r.now = t;
    q.r.updateBosses(); const d = 9999 - q.A.hp, cd = bo.cooldownUntil - t; return { d, cd };
  };
  const p1 = cnt(false, 10, 500), p2 = cnt(true, 10, 500), k2 = bossIntensity(10, 0.5);
  ok(`反撃: 第1形態は今どおり（${Math.round(C.BOSS_DAMAGE * C.BOSS_DAMAGE_MULT)}、${C.BOSS_COOLDOWN}秒）、第2形態は ダメージ×激しさ・間隔÷激しさ`,
    p1.d === Math.round(C.BOSS_DAMAGE * C.BOSS_DAMAGE_MULT) && Math.abs(p1.cd - C.BOSS_COOLDOWN) < 1e-9 && p2.d === Math.round(C.BOSS_DAMAGE * C.BOSS_DAMAGE_MULT * k2) && Math.abs(p2.cd - C.BOSS_COOLDOWN / k2) < 1e-9, { p1, p2, k: k2 });
}

console.log('--- 白上虎太郎（大将だけを攻撃）');
{
  const z = mk('sayo', 'metan'); const a = z.r.summonAssist(0, 1, 'shirakami'); Object.assign(a, { x: 1552, y: 900, skillReadyAt: 1e9 }); Object.assign(z.A, { x: 3000, y: 300 });
  Object.assign(z.B, { x: 1552 + 30, y: 900, hp: 9999 }); const ea = z.r.summonAssist(1, 1, 'kurono'); Object.assign(ea, { x: 1552, y: 900 + 30, skillReadyAt: 1e9 }); const eh = ea.hp;
  const run = () => { for (let i = 0; i < 60; i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); Object.assign(z.B, { x: 1552 + 30, y: 900 }); Object.assign(ea, { x: 1552, y: 900 + 30 }); Object.assign(a, { x: 1552, y: 900 }); } };
  run(); const none = z.B.hp === 9999 && ea.hp === eh;
  Object.assign(z.r.bosses[1], { x: 1552 - 40, y: 900 }); run();
  ok(`白上虎太郎: 大将が攻撃範囲（${C.ATTACK_RANGE}px）にいる間だけ大将を攻撃（敵プレイヤー・敵アシストは攻撃しない）`, none && z.r.bosses[1].hp < C.BOSS_HP && z.B.hp === 9999 && ea.hp === eh, { boss: z.r.bosses[1].hp, B: z.B.hp, ea: ea.hp });
}

console.log('--- 大将とアシストのタイマン（大将の拠点で、HP満タンの大将とアシスト1体だけ）');
{
  // 強さは「普通」。スロット・コバコ・ほかのキャラは止める。move=false は大将が拠点を移らない（被ダメで逃げない）
  const duel = (ch: string, move: boolean) => {
    const { r } = mk('sayo'); r.players.get('a').alive = false; r.players.get('a').respawnAt = 1e9; r.updateSlots = () => {};
    const thr = C.BOSS_MOVE_THRESHOLD; if (!move) (C as any).BOSS_MOVE_THRESHOLD = 1e9;
    const b = r.bosses[1], base = r.bases[1][b.base]; Object.assign(b, { x: base.x, y: base.y, hp: C.BOSS_HP, target: null });
    const a = r.summonAssist(0, 1, ch); Object.assign(a, { x: b.x - 140, y: b.y, skillReadyAt: 0 }); const max = a.hp;
    let last = a.hp, t = 0;
    while (t < 300 && a.alive && r.players.has(a.id) && r.phase === 'playing') { r.tick(0.05, false); t += 0.05; if (r.phase === 'playing') last = a.hp; }
    (C as any).BOSS_MOVE_THRESHOLD = thr;
    return { win: r.phase === 'ended' && r.winner === 0, pct: Math.round((Math.max(0, last) / max) * 100), boss: Math.round(b.hp), t: Math.round(t) };
  };
  const fmt = (x: any) => `${x.win ? '勝ち' : '負け'} 残りHP${x.pct}% 大将${x.boss} ${x.t}秒`;
  for (const ch of ['kurono', 'aoyama', 'shirakami']) console.log(`  参考 ${C.ASSIST.units[ch].name}: ${[0, 1, 2].map(() => fmt(duel(ch, false))).join(' / ')}`); // 合格条件なし
}

console.log('--- 花丸（パッシブの押し込み・巨大拳飛ばし）');
{
  const H = CHARS.hanamaru.skill;
  const push = (ch: string, x: number, y: number, dx: number, dy: number, sec: number) => {
    const z = mk(ch); z.A.bot = true; Object.assign(z.A, { x, y, dx, dy }); const b0 = z.r.broken.length;
    for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); }
    return { z, n: z.r.broken.length - b0 };
  };
  const wallY = 26 * T; // study の南壁（内側の壁）
  const touch = push('hanamaru', 200, wallY - 11, 0, 1, 0.05); // 1tick目: 壁に阻まれて押し込み始め（まだ0秒）。2tick目で0.05秒
  const held = push('hanamaru', 200, wallY - 11, 0, 1, H.push + 0.11);
  ok(`パッシブ: 壁へ${H.push}秒押し込み続けると壊す（触れてすぐでは壊れない）`, touch.n === 0 && held.n > 0 && held.z.r.tiles[26][12] === '.', { touch: touch.n, held: held.n });
  ok(`パッシブで壊したら徳${C.TOKU.wall}、クールダウンなし（技のCTも消費しない）`, Math.abs(held.z.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.wall)) < 1e-9 && held.z.A.skillReadyAt === 0);
  const again = held.z; Object.assign(again.A, { x: 200, y: 33 * T - 11, dx: 0, dy: 1 }); const b1 = again.r.broken.length;
  for (let i = 0; i < Math.round((H.push + 0.11) / 0.05); i++) { again.r.now += 0.05; again.r.updatePlayers(0.05); }
  ok('続けて別の壁も壊せる（クールダウンなし）', again.r.broken.length > b1);
  const per = push('hanamaru', 200, 3 * T + 11, 0, -1, 1);
  const other = push('sayo', 200, wallY - 11, 0, 1, 1);
  ok('外周の壁は壊れない。花丸以外は押し込んでも壊れない', per.n === 0 && other.n === 0);
  // 巨大拳: 直進、キャラ（1体1回）にダメージ、貫通、壁は壊して貫通、射程で消える
  const f = mk('hanamaru', 'metan'); f.r.addPlayer('c', 1, false); const Cc = f.r.players.get('c');
  Object.assign(f.A, { x: 1400, y: 900, face: 0 }); f.A.tgt = null; Object.assign(f.B, { x: 1460, y: 900, hp: 9999 }); Object.assign(Cc, { x: 1540, y: 905, hp: 9999, alive: true, char: 'metan' });
  f.r.skill('a'); const ct = f.A.skillReadyAt - f.r.now;
  const xs: number[] = []; for (let i = 0; i < 8; i++) { upd(f.r, 'fist', 0.05); if (ents(f.r, 'fist')[0]) xs.push(+(ents(f.r, 'fist')[0].x).toFixed(1)); }
  const one = Math.round(H.dmg * C.DAMAGE_MULT * 0.8);
  ok(`巨大拳: 前方へ直進（毎秒${H.speed}px）、CT${H.ct}秒`, xs.every((x, i) => !i || Math.abs(x - xs[i - 1] - H.speed * 0.05) < 1e-6) && Math.abs(ents(f.r, 'fist')[0].y - 900) < 1e-9 && ct === H.ct, xs);
  ok(`巨大拳: キャラを貫通し、同じキャラには1回だけ当たる（${H.dmg}×全体の倍率）`, 9999 - f.B.hp === one && 9999 - Cc.hp === one, { b: 9999 - f.B.hp, c: 9999 - Cc.hp });
  fly(f.r);
  const dist = (H.range / H.speed);
  ok(`巨大拳: ${H.range}px 飛ぶと消える`, ents(f.r, 'fist').length === 0 && dist > 0);
  const w = mk('hanamaru'); Object.assign(w.A, { x: 200, y: 360, face: Math.PI / 2 }); w.A.tgt = null; w.r.skill('a'); fly(w.r);
  const ys = new Set(w.r.broken.map(([, y]: number[]) => y));
  ok('巨大拳: 壁に当たると壊して貫通し、その先の壁も壊す（study の南壁 → bath の南壁）', ys.has(26) && ys.has(33) && w.r.tiles[26][12] === '.' && Math.abs(w.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.wall)) < 1e-9, [...ys]);
  ok('巨大拳: 命中・破壊はサーバーで判定し、拳の位置をスナップショットで送る', (() => { const q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; q.lock = () => {}; let got: any = null; Object.defineProperty(q, 'clients', { value: [{ sessionId: 'x', send: (t: string, m: any) => { if (t === 's') got = m; } }] }); q.onCreate(); q.onJoin({ sessionId: 'x' }); q.startMatch(); q.beginPlay(); const P = q.players.get('x'); P.char = 'hanamaru'; q.skill('x'); q.sendSnapshots(); const fs = got.ents.filter((e: any) => e.kind === 'fist'); return fs.length === 1 && fs[0].team === P.team; })());
  // 壁の中央・終端・角を上下左右から押し込む。終端・角は壁タイルの正面から（一部だけ触れる位置からは、移動の当たり判定で丸めた角に沿って滑るので押し込めない）
  {
    const R = C.PLAYER_RADIUS, tl = MAP.tiles as string[], seen: Record<string, number> = {}, res: string[] = [];
    const per = (x: number, y: number) => [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (tl[y + dy]?.[x + dx] ?? ' ') === ' '));
    const wall = (x: number, y: number) => tl[y]?.[x] === '#';
    const dirs: [number, number, string][] = [[1, 0, '右へ'], [-1, 0, '左へ'], [0, 1, '下へ'], [0, -1, '上へ']];
    let bad = 0;
    for (let ty = 2; ty < tl.length - 2; ty++) for (let tx = 2; tx < tl[0].length - 2; tx++) {
      if (!wall(tx, ty) || per(tx, ty)) continue;
      for (const [dx, dy, dn] of dirs) {
        if (tl[ty - dy]?.[tx - dx] !== '.') continue;
        const px = dy ? 1 : 0, py = dx ? 1 : 0, l1 = wall(tx + px, ty + py), l2 = wall(tx - px, ty - py), behind = wall(tx + dx, ty + dy);
        const kind = l1 && l2 ? '中央' : l1 !== l2 && behind ? '角' : '終端';
        const k = `${kind}${dn}`;
        if ((seen[k] ?? 0) >= 2) continue;
        const off = 0; // 正面から
        const x = dx ? (dx > 0 ? tx * T - R - 1 : (tx + 1) * T + R + 1) : (tx + 0.5) * T + off;
        const y = dy ? (dy > 0 ? ty * T - R - 1 : (ty + 1) * T + R + 1) : (ty + 0.5) * T + off;
        const z = mk('hanamaru'); if (!clear(z.r, { x, y })) continue;
        z.A.bot = true; Object.assign(z.A, { x, y, dx, dy });
        for (let i = 0; i < Math.round((H.push + 0.2) / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); }
        seen[k] = (seen[k] ?? 0) + 1;
        const slide = kind === '終端' && !behind; // 終端を横から押すと、丸めた角に沿って滑るので壊れない（移動の当たり判定）
        const okk = slide ? z.r.tiles[ty][tx] === '#' && Math.hypot(z.A.x - x, z.A.y - y) > 4 : z.r.tiles[ty][tx] === '.';
        if (!okk) bad++;
        res.push(`${k}(${tx},${ty})${slide ? '滑る' : ''}${okk ? '' : '×'}`);
      }
    }
    // 上向きの角は地図にないので、終端 (27,9)（上が壁、下が扉）の右に壁を足して角を作り、左にずらして下から押し込む
    {
      const z = mk('hanamaru'); z.r.tiles[9] = z.r.tiles[9].slice(0, 28) + '#' + z.r.tiles[9].slice(29); z.r.walls = wallRects(z.r.tiles);
      const x = 27.5 * T, y = 10 * T + R + 1;
      z.A.bot = true; Object.assign(z.A, { x, y, dx: 0, dy: -1 });
      if (clear(z.r, { x, y }) && wall(27, 8) && tl[10][27] === '.' && tl[9][26] === '.') {
        for (let i = 0; i < Math.round((H.push + 0.2) / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); }
        seen['角上へ'] = 1; if (z.r.tiles[9][27] !== '.') bad++;
        res.push(`角上へ(27,9)${z.r.tiles[9][27] === '.' ? '' : '×'}`);
      }
    }
    const kinds = ['中央', '終端', '角'].flatMap((k) => dirs.map(([, , dn]) => k + dn)).filter((k) => !seen[k]);
    ok(`パッシブ: 壁の中央・終端・角を上下左右から押し込んで壊せる（${H.push}秒）。終端は正面からなら壊せ、横から押すと滑って壊れない`, bad === 0 && kinds.length === 0, { missing: kinds, res });
  }
  const bt = mk('hanamaru', 'metan'); Object.assign(bt.A, { face: 0 }); bt.A.bot = true; Object.assign(bt.B, { x: 1552 + 300, y: 900 });
  const yes = bt.r.botSkillUseful(bt.A); bt.B.y = 900 + 200; const no = bt.r.botSkillUseful(bt.A);
  ok('Bot: 拳の進路に敵がいれば使う', yes && !no);
}

console.log('--- 冥鳴ひまり（死神の鎌: 透明化・鎌・跳ぶ）');
{
  const H = CHARS.himari.skill;
  const tick = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); z.r.updateShots(0.05); z.r.updateEnts(0.05); } };
  // 透明化中は敵のオートアタック・技の対象にならない
  const a = mk('himari', 'sayo'); a.B.aim = 'nearest'; a.r.skill('a'); const hp0 = a.A.hp; tick(a, 1);
  ok('透明化中は敵のオートアタックの対象にならない', !a.B.tgt && a.A.hp === hp0 && a.A.alive);
  const k = mk('kiritan', 'himari'); Object.assign(k.B, { x: 1552 + 100 }); k.r.skill('b'); k.r.skill('a'); tick(k, 0.5);
  ok('透明化中は敵の技（きりたんのロックオン）の対象にならない', k.A.sk.marks.length === 0);
  const bi = mk('bii', 'himari'); bi.A.aim = 'nearest'; delete bi.A.st.test; Object.assign(bi.B, { x: 1552 + 100 }); bi.r.skill('b'); bi.A.face = Math.PI; bi.r.skill('a');
  ok('透明化中は敵の技（ビィの再現江湖）の狙いにならない（向いている方向へ出る）', bi.A.sk.phantom.a === Math.PI);
  // 被弾（範囲攻撃を含む）で即死
  const d = mk('metan', 'himari'); d.r.skill('b'); d.A.face = 0; d.A.tgt = null; d.r.skill('a'); d.r.updatePlayers(0.05);
  ok('透明化中は被弾（範囲攻撃）で即死', !d.B.alive);
  // 5秒で解除（攻撃なしで姿を現す）
  const e = mk('himari', 'sayo'); Object.assign(e.B, { x: 1552 + 300 }); e.r.skill('a'); tick(e, H.dur - 0.1); const still = !!e.r.stat(e.A, 'cloak'); tick(e, 0.2);
  ok(`${H.dur}秒で透明化が解ける（攻撃は出ない）`, still && !e.r.stat(e.A, 'cloak') && e.B.hp === e.r.maxHp(e.B) && !e.r.fx.some((f: any) => f.color === 'scythe'));
  // 鎌: 通常キャラは倒れ、ひまりは攻撃の向きへ5キャラ分跳ぶ
  const s = mk('himari', 'metan'); s.A.face = 0; s.A.tgt = null; s.r.skill('a'); const x0 = s.A.x; s.r.attack('a'); const cloak = !!s.r.stat(s.A, 'cloak'); tick(s, 1);
  ok(`鎌: 当たった通常キャラは倒れ、ひまりは${H.jump}px（5キャラ分）跳ぶ。透明化は解ける`, !s.B.alive && Math.abs(s.A.x - x0 - H.jump) < 1 && !cloak && !s.A.st.leap, { moved: s.A.x - x0 });
  const j = mk('himari', 'metan'); j.A.face = 0; j.A.tgt = null; j.r.skill('a'); j.r.attack('a'); const sp = j.r.speedOf(j.A); const jx = j.A.x; tick(j, 0.05);
  ok(`跳ぶ速さは通常移動の${H.jumpSpeed}倍、跳ぶ間は動けない`, Math.abs(j.A.x - jx - sp * H.jumpSpeed * 0.05) < 1e-6 && j.r.effect(j.A, 'lock'));
  const w = mk('himari', 'metan'); Object.assign(w.A, { x: 400, y: 150, face: 0 }); Object.assign(w.B, { x: 420, y: 150 }); w.A.tgt = null; w.r.skill('a'); w.r.attack('a'); tick(w, 1);
  ok('跳ぶのは壁で止まる（study の東壁）', w.A.x < 27 * T && clear(w.r, w.A), { x: w.A.x });
  // 大将には旧めたんのドリル相当（同じ基本値30。全体の倍率・ロール倍率は他の攻撃と同じく掛かる）。めたんの技はドリル出しっぱなしに変わったが、ひまりの値は変えない
  const b = mk('himari'); Object.assign(b.r.bosses[1], { x: 1592, y: 900 }); b.A.face = 0; b.A.tgt = null; b.r.skill('a'); b.r.attack('a');
  ok(`鎌の大将へのダメージは旧ドリルと同じ基本値（${H.bossDmg}。ひまり ${C.BOSS_HP - b.r.bosses[1].hp}＝${H.bossDmg}×全体の倍率×attacker の${C.ATTACKER_BOSS_MULT}倍）`, H.bossDmg === 30 && Math.abs((C.BOSS_HP - b.r.bosses[1].hp) - 30 * C.DAMAGE_MULT * C.ATTACKER_BOSS_MULT) < 1e-9);
  // 透明化していないときの Space は通常の近接攻撃
  const n = mk('himari', 'metan'); n.A.face = 0; n.A.tgt = null; n.r.attack('a');
  ok('透明化していないときは通常攻撃（鎌ではない）', n.B.alive && n.B.hp < n.r.maxHp(n.B) && !n.A.st.leap);
  // Bot: 透明化 → 接近 → 鎌
  const bt = mk('himari', 'sayo'); bt.A.bot = true; bt.A.aim = C.BOT_AIM; Object.assign(bt.B, { x: 1552 + 200 }); bt.B.hp = 1e9;
  let used = false, swung = false;
  for (let i = 0; i < 100 && !swung; i++) { bt.r.now += 0.05; bt.r.updateBots(); bt.r.updatePlayers(0.05); used ||= !!bt.r.stat(bt.A, 'cloak'); swung = bt.r.fx.some((f: any) => f.color === 'scythe'); bt.r.fx = []; }
  ok('Bot: 敵が近いと透明化し、近づいて鎌を振る', used && swung);
}

console.log('--- 東北きりたん（全弾斉射）');
{
  const K = CHARS.kiritan.skill;
  const z = mk('kiritan', 'metan'); z.r.addPlayer('c', 1, false); z.r.addPlayer('d', 1, false);
  const c = z.r.players.get('c'), d = z.r.players.get('d');
  Object.assign(z.B, { x: 1552 + 40, hp: 9999 }); Object.assign(c, { x: 1552 + 150, y: 900, hp: 9999, char: 'metan' }); Object.assign(d, { x: 1552 + 90, y: 930, hp: 9999, char: 'metan' });
  z.r.skill('a'); const ready0 = z.A.skillReadyAt;
  const order: string[] = [], at: number[] = [];
  for (let i = 0; i < 20; i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); if (z.A.sk.marks.length > order.length) { order.push(z.A.sk.marks[order.length]); at.push(z.r.now); } }
  ok(`ロックは近い順に1体ずつ、${K.lockEvery}秒間隔`, order.join() === 'p:b,p:d,p:c' && at.slice(1).every((t, i) => t - at[i] >= K.lockEvery - 1e-9), { order, at });
  ok('ロック中は CT が始まらない', z.A.skillReadyAt === ready0 && !!z.r.stat(z.A, 'lockon'));
  const hp = [z.B, c, d].map((q: any) => q.hp);
  z.r.skill('a'); const ready1 = z.A.skillReadyAt;
  ok('2回目で発射し、CT は発射から始まる', Math.abs(ready1 - (z.r.now + K.ct)) < 1e-9 && !z.r.stat(z.A, 'lockon'));
  const launched: number[] = [], seen = new Set<number>(), pats = new Set<string>();
  for (let i = 0; i < 80; i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); z.r.updateEnts(0.05); const nw = ents(z.r, 'missile').filter((e: any) => !seen.has(e.id)); nw.forEach((e: any) => { seen.add(e.id); pats.add(e.pat); }); if (nw.length) launched.push(nw.length); }
  ok(`ロックした全員へ、${K.volleys}回に分けて各${K.perTarget}発（計${3 * K.perTarget * K.volleys}発）`, launched.length === K.volleys && launched.every((n) => n === 3 * K.perTarget), launched);
  ok('ロックした全員に弾が当たる', [z.B, c, d].every((q: any, i: number) => q.hp < hp[i]) && ents(z.r, 'missile').length === 0, [z.B, c, d].map((q: any, i: number) => hp[i] - q.hp));
  ok('弾道は3種（直進・左右に展開→加速・前後へ偏差→急制動）', ['straight', 'spread', 'brake'].every((p) => pats.has(p)), [...pats]);
  const t = mk('kiritan', 'metan'); t.r.skill('a'); for (let i = 0; i < Math.round((K.lockMax + 0.1) / 0.05); i++) { t.r.now += 0.05; t.r.updatePlayers(0.05); }
  ok(`ロックの時間切れ（${K.lockMax}秒）で撃たずに CT が始まる`, !t.r.stat(t.A, 'lockon') && t.A.skillReadyAt > t.r.now && ents(t.r, 'missile').length === 0);
  const bt = mk('kiritan', 'metan'); bt.A.bot = true; Object.assign(bt.B, { x: 1552 + 120, hp: 9999 }); let fired = false;
  for (let i = 0; i < 60 && !fired; i++) { bt.r.now += 0.05; bt.r.updateBots(); bt.r.updatePlayers(0.05); fired = !!bt.A.sk.volleys; }
  ok('Bot: ロックして発射する', fired);
}

console.log('--- 猫使ビィ（再現江湖）');
{
  const B = CHARS.bii.skill;
  const run = (z: any) => { for (let i = 0; i < 40 && z.r.stat(z.A, 'phantom'); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); } };
  const h = mk('bii', 'metan'); h.A.aim = 'nearest'; delete h.A.st.test; Object.assign(h.B, { x: 1552 + 150, hp: 9999 }); h.r.skill('a'); h.r.fx = []; run(h);
  const boom = h.r.fx.find((f: any) => f.kind === 'aura' && f.color === 'boom');
  ok(`射程内の敵へ高速移動し、当たったらさらに${B.extra}px進んで止まり、相手を中心に爆発（${B.dmg}）`, !!boom && Math.abs(boom.x - h.B.x) < 1e-9 && h.A.x > h.B.x + B.extra - 25 && 9999 - h.B.hp === Math.round(B.dmg * C.DAMAGE_MULT * 0.8), { ax: h.A.x, bx: h.B.x, dmg: 9999 - h.B.hp });
  const w = mk('bii', 'metan'); Object.assign(w.A, { x: 300, y: 300, face: 0 }); w.A.aim = 'nearest'; delete w.A.st.test; Object.assign(w.B, { x: 400, y: 300, hp: 9999 }); const b0 = w.r.broken.length; w.r.skill('a'); run(w);
  ok('爆発の範囲の壁が壊れる（study の東壁）', w.r.broken.length > b0 && w.r.broken.every(([x, y]: number[]) => Math.hypot((x + 0.5) * T - w.B.x, (y + 0.5) * T - w.B.y) <= B.r + T), { broken: w.r.broken.length - b0 });
  const ms = mk('bii'); ms.A.face = 0; const mx = ms.A.x; ms.r.skill('a'); ms.r.fx = []; run(ms);
  ok(`空振りは最大距離（${B.range}px）で止まり、爆発しない`, Math.abs(ms.A.x - mx - B.range) < 1 && !ms.r.fx.some((f: any) => f.color === 'boom') && ms.r.broken.length === 0);
  const bs = mk('bii'); Object.assign(bs.r.bosses[1], { x: 1552 + 100, y: 900 }); bs.A.aim = 'boss'; delete bs.A.st.test; bs.r.skill('a'); run(bs);
  ok(`大将へは旧ドリルと同じ基本値（${B.bossDmg}）`, B.bossDmg === 30 && C.BOSS_HP - bs.r.bosses[1].hp === B.bossDmg * C.DAMAGE_MULT);
  const bt = mk('bii', 'metan'); Object.assign(bt.B, { x: 1552 + 150 }); bt.A.bot = true;
  ok('Bot: 射程内に敵がいれば使う', bt.r.botSkillUseful(bt.A) && (Object.assign(bt.B, { x: 1552 + B.range + 60 }), !bt.r.botSkillUseful(bt.A)));
}

console.log('--- もち子（ホバー）・ずん子');
{
  ok('もち子・ユーレイちゃんの歩行タイプはホバー（ほかは normal）', CHARS.mochiko.walk === 'hover' && CHARS.yurei.walk === 'hover' && Object.entries(CHARS).every(([k, c]) => k === 'mochiko' || k === 'yurei' || c.walk === 'normal'));
  ok('ずんだアローの CT は旧の2/3（18→12秒）', Math.abs(CHARS.zunko.skill.ct - (18 * 2) / 3) < 1e-9);
}

console.log('--- 待機画面の出撃（go）・e2e の Bot 編成');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  const sent: any[] = []; Object.defineProperty(r, 'clients', { value: [{ sessionId: 'c0', send: (t: string, m: any) => { if (t === 's') sent.push(m); } }] });
  r.onCreate(); r.onJoin({ sessionId: 'c0' });
  const cl = { sessionId: 'c0' }, me = () => r.players.get('c0');
  r.onJoin({ sessionId: 'c1' }); // 人間2人（1人だとすぐ開始する）
  const ok0 = me().ok; r.messages.pick(cl, { char: 'sayo' }); const ok1 = me().ok; r.messages.go(cl, { char: 'zunko' }); r.sendSnapshots(); const s1 = sent[sent.length - 1].roster.find((x: any) => x.id === 'c0');
  r.messages.unpick(cl); r.sendSnapshots(); const s2 = sent[sent.length - 1].roster.find((x: any) => x.id === 'c0');
  ok('pick は今選んでいるキャラだけ（出撃しない）、go で出撃済み、unpick で取り消し（キャラはそのまま）。ロスターで他のクライアントにも送る', ok0 === false && ok1 === false && s1.ok === true && s1.char === 'zunko' && s2.ok === false && s2.char === 'zunko');
  r.startMatch(); ok('出撃していなくても開始の処理はできる（Bot で埋める処理は現行どおり）', r.phase === 'intro');
  const prev = process.env.E2E_HOOKS;
  process.env.E2E_HOOKS = '1'; const e: any = new (GameRoom as any)(); e.setSimulationInterval = () => {}; e.lock = () => {}; e.unlock = () => {}; Object.defineProperty(e, 'clients', { value: [] }); e.onCreate(); e.startMatch();
  if (prev === undefined) delete process.env.E2E_HOOKS; else process.env.E2E_HOOKS = prev;
  const bots = [...e.players.values()].map((p: any) => p.char);
  const n: any = new (GameRoom as any)(); n.setSimulationInterval = () => {}; n.lock = () => {}; n.unlock = () => {}; Object.defineProperty(n, 'clients', { value: [] }); n.onCreate();
  const seen = new Set<string>(); for (let i = 0; i < 30; i++) { n.players.clear(); n.startMatch(); n.players.forEach((p: any) => seen.add(p.char)); n.phase = 'waiting'; }
  ok('e2e（E2E_HOOKS）の Bot は固定の編成で、ひまり・ビィを入れない。通常の試合の Bot はランダムのまま（ひまり・ビィも出る）', JSON.stringify(bots) === JSON.stringify(['hanamaru', 'whitecul', 'sayo', 'metan', 'mochiko', 'aru', 'ierutan', 'zunko']) && seen.has('himari') && seen.has('bii'), { bots });
}

console.log('--- 待機画面の開始の流れ（出撃・選択猶予）');
{
  // 人間 n 人の部屋（待機画面）。h(i): i 番目の人の client
  const lobby = (n: number) => {
    const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
    Object.defineProperty(r, 'clients', { value: [] }); r.onCreate(); r.notice = () => {};
    for (let i = 0; i < n; i++) r.onJoin({ sessionId: `h${i}` });
    return { r, h: (i: number) => ({ sessionId: `h${i}` }), p: (i: number) => r.players.get(`h${i}`), run: (sec: number) => { for (let k = 0; k < Math.round(sec / 0.05); k++) r.tick(0.05, false); } };
  };
  const G = C.LOBBY_GRACE;
  const a = lobby(1); a.r.messages.go(a.h(0), { char: 'sayo' });
  ok('人間が1人だけなら、出撃した時点で開始', a.r.phase === 'intro' && a.p(0).char === 'sayo');
  const b = lobby(2); b.r.messages.go(b.h(0), { char: 'sayo' });
  ok(`人間が2人: 片方が出撃するとカウント開始（${G}秒）、まだ開始しない`, b.r.phase === 'waiting' && b.r.lobbyLeft === G);
  b.run(3); b.r.messages.go(b.h(1), { char: 'metan' });
  ok('カウント中に全員が出撃したら、その時点で開始', b.r.phase === 'intro' && b.p(1).char === 'metan');
  const c = lobby(2); c.r.messages.pick(c.h(1), { char: 'zunko' }); c.r.messages.go(c.h(0), { char: 'sayo' }); c.run(G - 0.1); const before = c.r.phase; c.run(0.15);
  ok(`${G}秒たつと、未出撃の人は今選んでいるキャラ（pick）のまま出撃して開始`, before === 'waiting' && c.r.phase === 'intro' && c.p(1).char === 'zunko' && c.p(0).char === 'sayo');
  const d = lobby(2); d.r.messages.go(d.h(0), { char: 'sayo' }); d.run(5); const left0 = d.r.lobbyLeft; d.r.onJoin({ sessionId: 'h2' }); d.run(0); const left1 = d.r.lobbyLeft; d.run(G - 5 - 0.1); const mid = d.r.phase; d.run(0.15);
  ok('カウント中に入ってきた人は未出撃、残り時間は延びない', Math.abs(left0 - (G - 5)) < 1e-6 && left1 === left0 && d.p(2).ok === false && mid === 'waiting' && d.r.phase === 'intro', { left0, left1 });
  const e = lobby(2); e.r.messages.go(e.h(0), { char: 'sayo' }); e.run(3); e.r.messages.unpick(e.h(0)); e.run(2);
  ok('カウント中に出撃を取り消してもカウントは止まらない', e.r.phase === 'waiting' && Math.abs(e.r.lobbyLeft - (G - 5)) < 1e-6 && !e.p(0).ok);
  e.run(G - 5 - 0.1); const mid2 = e.r.phase; e.run(0.15);
  ok(`全員が未出撃に戻っても、${G}秒で開始`, mid2 === 'waiting' && e.r.phase === 'intro');
  const f = lobby(2); f.r.dropped.add('h1'); f.r.messages.go(f.h(0), { char: 'sayo' });
  ok('再接続待ち（切断中）の人間は判定から除く（接続中の全員が出撃済みなら開始）', f.r.phase === 'intro');
  const g = lobby(2); g.r.messages.go(g.h(0), { char: 'sayo' }); g.r.dropped.add('h0'); g.r.dropped.add('h1'); g.run(G + 0.1);
  ok('接続中の人間がいないまま猶予が切れたら開始せず、カウントを止める', g.r.phase === 'waiting' && g.r.lobbyLeft === null);
  ok('開始ボタン（start メッセージ）はない', !('start' in lobby(1).r.messages));
}

console.log('--- 四国めたん（ドリル: 出しっぱなし・接触でダメージ＋はじき・再ヒット間隔）');
{
  const D = CHARS.metan.skill;
  const run = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); } };
  const z = mk('metan', 'sayo'); z.A.face = 0; z.A.tgt = null; z.B.hp = 9999; const x0 = z.B.x;
  z.r.skill('a'); const noHitYet = z.B.hp === 9999; run(z, 0.05);
  ok(`ドリル出現中、触れた敵にダメージ（${D.dmg}×全体の倍率）＋はじき`, noHitYet && 9999 - z.B.hp === Math.round(D.dmg * C.DAMAGE_MULT) && z.B.x > x0, { dmg: 9999 - z.B.hp, push: z.B.x - x0 });
  const h0 = z.B.hp; Object.assign(z.B, { x: z.A.x + 40 }); run(z, D.rehit - 0.1); const h1 = z.B.hp; run(z, 0.15);
  ok(`同じ敵には${D.rehit}秒おきに再ヒット`, h1 === h0 && z.B.hp < h1, { h0, h1, h2: z.B.hp });
  const o = mk('metan', 'sayo'); o.A.face = 0; o.A.tgt = null; o.B.hp = 9999; Object.assign(o.B, { x: o.A.x + D.len + 30 }); o.r.skill('a'); run(o, 0.5);
  ok(`ドリルの長さ（${D.len}px）の外の敵には当たらない`, o.B.hp === 9999);
  const t = mk('metan', 'sayo'); t.A.face = 0; t.A.tgt = null; t.B.hp = 9999; t.r.skill('a'); run(t, D.dur + 0.1); const hd = t.B.hp; Object.assign(t.B, { x: t.A.x + 40, y: t.A.y }); run(t, 0.5);
  ok(`${D.dur}秒でドリルが消え、以後は当たらない`, !t.r.stat(t.A, 'drill') && t.B.hp === hd);
  const f = mk('metan', 'sayo'); f.A.face = 0; f.A.tgt = null; f.A.bot = true; f.B.hp = 9999; Object.assign(f.B, { x: f.A.x, y: f.A.y + 40 }); f.A.dx = 0; f.A.dy = 1; f.A.face = Math.PI / 2; f.r.skill('a'); run(f, 0.05);
  ok('ドリルの向きは移動・照準に追従（向きを変えた先の敵に当たる）', f.B.hp < 9999);
  const m = mk('metan', 'sayo'); m.A.face = 0; m.A.tgt = null; m.r.skill('a'); m.A.cooldownUntil = 0; const cd = m.A.cooldownUntil; m.r.attack('a'); const x1 = m.A.x; m.A.bot = true; m.A.dx = 0; m.A.dy = 1; m.r.updatePlayers(0.05);
  ok('ドリル中は通常攻撃しない、移動はできる', m.A.cooldownUntil === cd && m.A.y > 900 && m.A.x === x1);
  const bt = mk('metan', 'sayo'); bt.A.face = 0; bt.A.tgt = null; const yes = bt.r.botSkillUseful(bt.A); Object.assign(bt.B, { x: bt.A.x + D.len + 40 }); const no = bt.r.botSkillUseful(bt.A);
  ok('Bot: ドリルの範囲に敵がいれば使う（いなければ使わない）', yes && !no);
  // 視界外の敵のドリルは送らない（スナップショットにその敵ごと入らない。技の fx も視界内だけ）
  const q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; q.lock = () => {}; q.unlock = () => {}; let got: any = null;
  Object.defineProperty(q, 'clients', { value: [{ sessionId: 'x', send: (tp: string, msg: any) => { if (tp === 's') got = msg; } }] }); q.onCreate(); q.onJoin({ sessionId: 'x' }); q.startMatch(); q.beginPlay();
  const me = q.players.get('x'), foe = [...q.players.values()].find((p: any) => p.team !== me.team);
  foe.char = 'metan'; q.skill(foe.id); Object.assign(foe, { x: me.x + 2000 }); q.sendSnapshots();
  const far = !got.players.some((p: any) => p.id === foe.id) && !JSON.stringify(got).includes('"drill"');
  Object.assign(foe, { x: me.x + 60, y: me.y }); q.sendSnapshots();
  ok('視界外の敵のドリルは送らない（視界内なら送る）', far && !!got.players.find((p: any) => p.id === foe.id)?.st.drill);
}

console.log('--- 友人テストの反映（通常攻撃の見た目・撃破の表示・取得判定・コバコの巡回）');
{
  // 近接の通常攻撃: 斬撃（向き・射程・角度）と、当たった側の汗
  const sl = mk('sayo', 'metan'); sl.r.attack('a', 0);
  const f = sl.r.fx.find((x: any) => x.kind === 'slash'), sw = sl.r.fx.find((x: any) => x.kind === 'sweat');
  ok('近接の通常攻撃: 斬撃（攻撃の向き・射程・角度）と、当たった側に汗', f && f.a === 0 && f.r === CHARS.sayo.aa[0].range && f.arc === C.ATTACK_ARC && sw && sw.x === sl.B.x && sw.y === sl.B.y);
  const zs = mk('zunko', 'metan'); zs.A.tgt = { k: 'p', o: zs.B, x: zs.B.x, y: zs.B.y, r: C.PLAYER_RADIUS }; zs.r.attack('a', 0); const noSlash = !zs.r.fx.some((x: any) => x.kind === 'slash'); zs.r.updateShots(0.5);
  ok('遠距離の通常攻撃: 斬撃は出さず、当たった側に汗', noSlash && zs.r.fx.some((x: any) => x.kind === 'sweat') && zs.B.hp < zs.r.maxHp(zs.B));
  const sk = mk('whitecul', 'metan'); sk.r.skill('a'); ok('技の命中では汗を出さない', !sk.r.fx.some((x: any) => x.kind === 'sweat'));
  // 撃破の表示: 倒した側へ ko（相手・手段）、倒された側へ koed（相手のキャラ・手段）
  const msgs = (k: any) => { const got: any[] = []; for (const id of ['a', 'b']) { k.r.owners.set(id, id); k.r.clients.push({ sessionId: id, send: (tp: string, m: any) => got.push([id, tp, m]) }); } return got; };
  const ka = mk('sayo', 'metan'), ga = msgs(ka); ka.B.hp = 1; ka.r.attack('a', 0);
  const koA = ga.find((x) => x[0] === 'a' && x[1] === 'ko')?.[2], koedA = ga.find((x) => x[0] === 'b' && x[1] === 'koed')?.[2];
  ok('通常攻撃で撃破: 倒した側に相手と「通常攻撃」、倒された側に相手のキャラと「通常攻撃」', koA?.victimChar === 'metan' && koA.how === '通常攻撃' && koedA?.kc === 'sayo' && koedA.how === '通常攻撃', { koA, koedA });
  const ks = mk('whitecul', 'metan'), gs = msgs(ks); ks.B.hp = 1; ks.r.skill('a');
  ok('技で撃破: 手段は技名', gs.find((x) => x[0] === 'b' && x[1] === 'koed')?.[2].how === CHARS.whitecul.skill.name && gs.find((x) => x[0] === 'a' && x[1] === 'ko')?.[2].how === CHARS.whitecul.skill.name);
  const kb = mk('sayo', 'metan'), gb = msgs(kb); kb.r.damagePlayer(kb.B, 1e9, null); const kp = mk('sayo', 'metan'), gp = msgs(kp); kp.r.damagePlayer(kp.B, 1e9, null, true);
  const kbm = gb.find((x) => x[1] === 'koed')?.[2], kpm = gp.find((x) => x[1] === 'koed')?.[2];
  ok('大将に倒された: 大将のキャラと「大将の攻撃」、スロットの罰: キャラなしと「スロットの罰」', kbm?.kc === 'ankomon' && kbm.how === '大将の攻撃' && kpm?.kc === null && kpm.how === 'スロットの罰', { kbm, kpm });
  // ひまり: 透明化中は範囲に入った対象へ自動で鎌（人間も）
  const hm = mk('himari', 'metan'); delete hm.A.st.test; hm.A.aim = 'nearest'; hm.r.skill('a'); hm.r.updatePlayers(0.05); hm.r.updatePlayers(0.05);
  ok('ひまり（人間）: 透明化中、対象が鎌の範囲に入ったら自動で鎌', !hm.B.alive && !hm.r.stat(hm.A, 'cloak'));
  // アイテムの取得判定: 全キャラ共通の縦長長方形（頭・上半身まで）。徳は広い判定、回復・荷物は従来の判定
  const MB2 = C.MATERIAL_PICKUP_BOX, B = C.PICKUP_BOX, res: Record<string, boolean[]> = {};
  for (const ch of ['mochiko', 'hanamaru', 'kiritan']) {
    const t = mk(ch); res[ch] = [[0, -MB2.up + 2], [MB2.w / 2 - 1, 0], [0, MB2.down + 3], [MB2.w / 2 + 2, -10]].map(([dx, dy]) => { t.r.materials = [{ id: 1, x: t.A.x + dx, y: t.A.y + dy, hi: false }]; t.r.updatePlayers(0.05); return t.r.materials.length === 0; });
  }
  ok(`取得判定（徳）: 左右${MB2.w / 2}px・頭の上（足元から${MB2.up}px）・足元の下${MB2.down}pxまで拾い、範囲外は拾わない。キャラによらず同じ`, Object.values(res).every((v) => JSON.stringify(v) === '[true,true,false,false]') && MB2.w >= 2 * B.w && MB2.up > B.up, res);
  const far = [[B.w / 2 + 4, 0], [0, B.down + 4], [-B.w / 2 - 8, -20]], got: Record<string, boolean[]> = {};
  for (const kind of ['material', 'heal', 'box_ult', 'box_assist']) {
    const t = mk('sayo'); t.A.hp = 10;
    got[kind] = far.map(([dx, dy]) => { t.r.materials = []; t.r.items = []; const o = { id: 1, x: t.A.x + dx, y: t.A.y + dy }; if (kind === 'material') t.r.materials.push({ ...o, hi: false }); else t.r.items.push({ ...o, kind, team: -1 }); t.r.updatePlayers(0.05); return kind === 'material' ? !t.r.materials.length : !t.r.items.length; });
  }
  ok('取得判定: 同じ距離（隣を通る位置）で、徳は拾い、回復・荷物は拾わない', JSON.stringify(got.material) === '[true,true,true]' && ['heal', 'box_ult', 'box_assist'].every((k) => JSON.stringify(got[k]) === '[false,false,false]'), got);
  // コバコ: 中央の部屋に着くたび、その部屋に高性能の徳を決めた個数置く。部屋の未取得の数が上限に達したら止める。重ならない
  const D = C.COURIER_DROP, cb = mk('sayo'), hall = C.COURIER_ROUTE.find((q: any) => q.room === 'hall')!, ent = C.COURIER_ROUTE.find((q: any) => q.room === 'entrance')!;
  cb.r.items.push({ id: 900, kind: 'heal', team: -1, x: hall.x, y: hall.y });
  const counts = [0, 1, 2, 3, 4].map(() => { cb.r.courierArrive(hall); return cb.r.materials.filter((m: any) => m.big).length; });
  const want: number[] = []; for (let i = 0, c = 0; i < 5; i++) want.push((c += c < D.cap ? D.n : 0)); // 未取得が cap 未満なら n 個足す
  const inHall = () => cb.r.materials.filter((m: any) => m.big && inRoom(m, hall.area));
  while (inHall().length > D.cap - 1) { const hb = inHall()[0]; cb.r.materials = cb.r.materials.filter((m: any) => m !== hb); } // 拾って cap-1 個に
  cb.r.courierArrive(hall); const after8 = inHall().length;
  cb.r.courierArrive(ent); const inEnt = cb.r.materials.filter((m: any) => m.big && inRoom(m, ent.area)).length;
  const all = [...cb.r.materials, ...cb.r.items];
  const apart = all.every((m: any, i: number) => all.every((n: any, j: number) => i === j || Math.hypot(m.x - n.x, m.y - n.y) >= C.MATERIAL_GAP));
  ok(`コバコが着くたびに高性能の徳を${D.n}個置き、部屋の未取得が${D.cap}個以上なら置かない（hall: ${counts.join('→')}、1個拾って${D.cap - 1}個なら${D.n}個置いて${after8}個。別の部屋は別に数える）。重ならない`, JSON.stringify(counts) === JSON.stringify(want) && after8 === D.cap - 1 + D.n && inEnt === D.n && apart, { counts, after8 });
  // 自然湧きの徳は中央3部屋に出ない
  const sp = mk('sayo'); for (let i = 0; i < 3000; i++) sp.r.spawnMaterial();
  const inCenter = sp.r.materials.filter((m: any) => ['smoking', 'hall', 'entrance'].includes(roomKindAt(Math.floor(m.x / T), Math.floor(m.y / T)) ?? '')).length, front = sp.r.materials.filter((m: any) => !m.hi).length;
  ok(`自然湧きの徳は中央3部屋（smoking・hall・entrance）に出ない（${sp.r.materials.length}個中 ${inCenter}個。表側 ${front}個はすべて dining）`, inCenter === 0 && sp.r.materials.length > 100 && sp.r.materials.filter((m: any) => !m.hi).every((m: any) => roomKindAt(Math.floor(m.x / T), Math.floor(m.y / T)) === 'dining'));
  const pk = mk('sayo'); pk.r.materials.push({ id: 1, x: pk.A.x, y: pk.A.y, hi: false, big: true }); pk.r.updatePlayers(0.05);
  ok(`高性能の徳: 徳+${C.TOKU.materialBig}（通常の資材の2倍）`, Math.abs(pk.r.teams[0].toku - C.TOKU_INIT - 2 * C.TOKU.material) < 1e-9 && C.TOKU.materialBig === 2 * C.TOKU.material);
}

console.log('--- 扉の縁・壁の終端（移動の当たり判定）');
{
  const W0 = C.WALLS, isWallAt = (x: number, y: number) => MAP.tiles[Math.floor(y / T)]?.[Math.floor(x / T)] === '#';
  // 斜め・まっすぐに扉の縁へ当てて歩かせる。止まらず抜けるか、壁の中（壁タイルに中心が入る・移動の形と重なる）に入らないか
  const walk = (x: number, y: number, dx: number, dy: number, n: number) => {
    let p = { x, y }, stuck = 0, inside = 0;
    for (let i = 0; i < n; i++) {
      const q = stepPlayer(p.x, p.y, dx, dy, C.PLAYER_SPEED, W0);
      if (Math.hypot(q.x - p.x, q.y - p.y) < 1) stuck++;
      if (isWallAt(q.x, q.y) || W0.some((w) => circleBody(q.x, q.y, C.PLAYER_RADIUS, w))) inside++;
      p = q;
    }
    return { ...p, stuck, inside };
  };
  // study↔bath の扉（y=26、x=20〜24）。左の縁は x=320px、右の縁は x=400px
  const y0 = 26 * T, cases: [string, number, number, number, number][] = [
    ['真下へ・左の縁に掛かる', 318, y0 - 30, 0, 1], ['真下へ・右の縁に掛かる', 402, y0 - 30, 0, 1],
    ['右下へ斜め・左の縁', 290, y0 - 40, 1, 1], ['左下へ斜め・右の縁', 430, y0 - 40, -1, 1],
    ['真上へ・左の縁に掛かる（bath から）', 318, y0 + 16 + 30, 0, -1],
  ];
  const res = cases.map(([name, x, y, dx, dy]) => { const r = walk(x, y, dx, dy, 12); return { name, through: dy > 0 ? r.y > y0 + T + C.PLAYER_RADIUS : r.y < y0 - C.PLAYER_RADIUS, stuck: r.stuck, inside: r.inside }; });
  ok('扉の縁に斜め・まっすぐ当たっても止まらず抜ける。壁の中には入らない', res.every((q) => q.through && q.stuck === 0 && q.inside === 0), res);
  // 壁の終端（扉の縁）は見た目より短い。平らな壁の面は今までどおり止める
  const flat = walk(250, y0 - 30, 0, 1, 12);
  ok(`平らな壁の面ではまっすぐ当たると止まる（y=${flat.y.toFixed(1)}、壁の上端 ${y0}）`, Math.abs(flat.y - (y0 - C.PLAYER_RADIUS)) < 0.6 && flat.inside === 0, flat);
  const end = W0.find((w) => w.y === y0 && w.x + w.w === 20 * T)!;
  ok(`扉の縁の当たり判定は見た目より${C.WALL_EDGE.trim}px短く、角は半径${C.WALL_EDGE.round}pxで丸い`, end?.m?.w === end.w - C.WALL_EDGE.trim && (end.m!.k & 6) === 6, end);
  // 丸めるのは外に出た角だけ。長方形どうしの継ぎ目（隣の長方形と接する角）は丸めない
  let rounded = 0, seam = 0, seamRounded = 0;
  const bits: [number, number, number][] = [[1, 0, 0], [2, 1, 0], [4, 1, 1], [8, 0, 1]];
  for (const w of W0) for (const [bit, fx, fy] of bits) {
    const px = w.x + fx * w.w, py = w.y + fy * w.h, sx = fx ? 1 : -1, sy = fy ? 1 : -1;
    const touch = [[sx, -sy], [-sx, sy], [sx, sy]].some(([ax, ay]) => W0.some((o) => o !== w && px + ax * 4 > o.x && px + ax * 4 < o.x + o.w && py + ay * 4 > o.y && py + ay * 4 < o.y + o.h));
    if (w.m!.k & bit) rounded++;
    if (touch) { seam++; if (w.m!.k & bit) seamRounded++; }
  }
  ok(`継ぎ目の角は丸めない（丸めた角 ${rounded}、継ぎ目の角 ${seam} のうち丸めたもの ${seamRounded}）`, rounded > 50 && seam > 50 && seamRounded === 0);
  // 経路探索・弾・視界は長方形のまま
  const tip = { x: 20 * T - 2, y: y0 + 8 };
  ok('弾・視界は見た目の壁（長方形）で止まる', W0.some((w) => tip.x >= w.x && tip.x <= w.x + w.w && tip.y >= w.y && tip.y <= w.y + w.h) && !lineOfSight(20 * T - 2, y0 - 20, 20 * T - 2, y0 + 40, W0));
}

console.log('--- 撃破の演出（視界の維持・敵への送信）');
{
  const v: any = new (GameRoom as any)(); v.setSimulationInterval = () => {}; v.lock = () => {}; const last: any = {};
  Object.defineProperty(v, 'clients', { value: ['c0', 'c1'].map((id) => ({ sessionId: id, send: (t: string, m: any) => { if (t === 's') last[id] = m; } })) });
  v.onCreate(); v.onJoin({ sessionId: 'c0' }); v.onJoin({ sessionId: 'c1' }); v.startMatch(); v.beginPlay();
  for (const p of v.players.values()) if (p.bot) { p.alive = false; p.respawnAt = 1e9; p.koAt = -99; p.x = p.y = -999; }
  v.bosses.forEach((b: any) => { b.x = -500; b.y = -500; });
  const me = v.players.get('c0'), foe = v.players.get('c1');
  Object.assign(me, { x: 1552, y: 900, rage: 0 }); Object.assign(foe, { x: 1552 + 150, y: 900 });
  v.damagePlayer(me, 1e9, 'c1'); v.sendSnapshots();
  const seen0 = last.c0.players.some((p: any) => p.id === 'c1'), mine0 = last.c0.players.find((p: any) => p.id === 'c0'), foeSees = last.c1.players.find((p: any) => p.id === 'c0');
  v.now += C.KO_FX.shake + C.KO_FX.boom - 0.05; v.sendSnapshots(); const seen1 = last.c0.players.some((p: any) => p.id === 'c1'), foeSees1 = !!last.c1.players.find((p: any) => p.id === 'c0');
  v.now += 0.1; v.sendSnapshots(); const seen2 = last.c0.players.some((p: any) => p.id === 'c1'), foeSees2 = !!last.c1.players.find((p: any) => p.id === 'c0');
  v.now = me.koAt + C.RESPAWN_BASE + 0.05; v.sendSnapshots(); const seen3 = last.c0.players.some((p: any) => p.id === 'c1');
  ok(`撃破の演出中（揺れ${C.KO_FX.shake}秒＋大爆発${C.KO_FX.boom}秒で消えるまで）は、倒された側の視界で敵が見える。消えた後・演出後（RESPAWN_BASE ${C.RESPAWN_BASE}秒）は見えない`, seen0 && seen1 && !seen2 && !seen3, { seen0, seen1, seen2, seen3 });
  ok('倒された本人へ撃破からの秒数を送り、敵にも消えるまで（視界内なら）送る。復活の時刻は変えない', mine0?.ko === 0 && !mine0.alive && foeSees?.ko === 0 && foeSees1 && !foeSees2 && Math.abs(me.respawnAt - me.koAt - C.RESPAWN_BASE) < 1e-9);
  ok(`演出の内訳（揺れ＋大爆発＋絞り）は RESPAWN_BASE（${C.RESPAWN_BASE}秒）に収まる`, C.KO_FX.shake + C.KO_FX.boom < C.RESPAWN_BASE);
  // リコール: 元いた場所に瞬間移動の跡
  const rc = mk('sayo'); const from = { x: rc.A.x, y: rc.A.y }; rc.A.recallAt = rc.r.now - C.RECALL_HOLD; rc.r.updatePlayers(0.05);
  ok('リコール: 元いた場所に瞬間移動の跡のエフェクト', rc.r.fx.some((f: any) => f.kind === 'recall' && f.x === from.x && f.y === from.y) && inRoom(rc.A, C.RECALL_ROOMS[0]));
}

console.log('--- 東北イタコ（通常攻撃・狐火）');
{
  const S = CHARS.itako.skill, M = CHARS.itako.aa[0];
  const tick = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); z.r.updateShots(0.05); z.r.updateEnts(0.05); } };
  const dealt = (ch: string) => { const z = mk(ch, 'sayo'); z.B.hp = 9999; z.A.tgt = null; z.r.attack('a'); return { d: 9999 - z.B.hp, cd: z.A.cooldownUntil - z.r.now, fx: z.r.fx.find((f: any) => f.kind === 'slash') }; };
  const it = dealt('itako'), hm = dealt('hanamaru'); // 同じ balance・近接の花丸と比べる
  ok(`通常攻撃: 間隔は半分（${it.cd}秒）、1発は半分（${it.d} / 花丸 ${hm.d}）、エフェクトはキツネ（color ${it.fx?.color}）`, it.cd === hm.cd / 2 && M.dmg === 0.5 && it.d === Math.round(charAtk('itako') * 0.5 * C.DAMAGE_MULT) && it.fx?.color === 'kitsune' && !hm.fx?.color, { it, hm });
  // 展開: n 個が半径 r の円周に並び、時計回りに回る。CT はまだ
  const z = mk('itako', 'sayo'); Object.assign(z.B, { x: 1552 + 300, hp: 9999 }); const ready0 = z.A.skillReadyAt; z.r.skill('a');
  const fb = () => ents(z.r, 'foxfire');
  const a0 = fb().map((e: any) => e.ang); tick(z, 0.1); const a1 = fb().map((e: any) => e.ang);
  ok(`狐火: ${S.n}個が半径${S.r}の円周に出て時計回りに回る（CT はまだ）`, fb().length === S.n && fb().every((e: any) => Math.abs(Math.hypot(e.x - z.A.x, e.y - z.A.y) - S.r) < 1e-6) && a1.every((v: number, i: number) => Math.abs(v - a0[i] - S.spin * 0.1) < 1e-6) && z.A.skillReadyAt === ready0);
  // 回っている火の玉に触れた敵はダメージ、火の玉は消えない。同じ火の玉は rehit 秒おき
  const c = mk('itako', 'sayo'); Object.assign(c.B, { x: 1552 + S.r, y: 900, hp: 9999 }); c.r.skill('a'); let hits = 0, last = c.B.hp;
  for (let i = 0; i < 40; i++) { c.r.now += 0.05; c.r.updateEnts(0.05); if (c.B.hp < last) { hits++; last = c.B.hp; } }
  ok(`回る火の玉に触れた敵にダメージ（2秒で${hits}回）、当たっても消えない`, hits > 0 && ents(c.r, 'foxfire').length === S.n && c.B.hp < 9999, { hits });
  // 時間切れで消え、CT はそこから
  const e = mk('itako', 'sayo'); Object.assign(e.B, { x: 1552 + 300 }); e.r.skill('a'); tick(e, S.dur + 0.1);
  ok(`${S.dur}秒で消え、CT は時間切れから`, ents(e.r, 'foxfire').length === 0 && Math.abs(e.A.skillReadyAt - (S.dur + S.ct)) <= 0.1 + 1e-9, { ready: e.A.skillReadyAt });
  // 再発動: 範囲内に敵がいなければ何もしない
  const n = mk('itako', 'sayo'); Object.assign(n.B, { x: 1552 + S.range + 100 }); n.r.skill('a'); n.r.skill('a');
  ok('再発動: 範囲内に敵がいなければ何もしない（回り続け、CT はまだ）', ents(n.r, 'foxfire').every((f: any) => f.mode === 'orbit') && n.A.skillReadyAt <= n.r.now);
  // 再発動: 最寄りの敵へ。標的の方向を12時とした9時の位置で円から離れ、ホーミングで命中して消える
  const h = mk('itako', 'sayo'); h.r.addPlayer('c', 1, false); const far = h.r.players.get('c'); Object.assign(far, { x: 1552 + 220, y: 900, char: 'sayo', hp: 9999 }); far.st.test = NOAUTO();
  Object.assign(h.B, { x: 1552 + 150, y: 900, hp: 9999 }); h.r.skill('a'); tick(h, 0.2); h.r.skill('a');
  ok('再発動で全弾が最寄りの敵を標的にし、CT はここから', ents(h.r, 'foxfire').every((f: any) => f.tgt === 'p:b') && Math.abs(h.A.skillReadyAt - (h.r.now + S.ct)) < 1e-9);
  const leave: number[][] = []; const seen = new Set<number>();
  for (let i = 0; i < 80; i++) { h.r.now += 0.05; h.r.updateEnts(0.05); for (const f of ents(h.r, 'foxfire')) if (f.mode === 'home' && !seen.has(f.id)) { seen.add(f.id); leave.push([f.ang, f.y]); } }
  const want9 = -Math.PI / 2; // 標的は真右（0）→ 9時は真上
  ok(`各火の玉は9時（標的が右なら真上）で離れ、順に標的へ飛んで命中して消える（${seen.size}個）`, seen.size === S.n && leave.every(([a]) => Math.abs(Math.atan2(Math.sin(a - want9), Math.cos(a - want9))) < 1e-9) && ents(h.r, 'foxfire').length === 0 && 9999 - h.B.hp === S.n * Math.round(S.homeDmg * C.DAMAGE_MULT) && far.hp === 9999, { leave, dmg: 9999 - h.B.hp });
  // 飛行中に標的が倒れたら、そのまま直進して寿命・壁で消える
  const l = mk('itako', 'sayo'); Object.assign(l.B, { x: 1552 + 200, hp: 9999 }); l.r.skill('a'); l.r.skill('a'); for (let i = 0; i < 20; i++) { l.r.now += 0.05; l.r.updateEnts(0.05); }
  l.B.alive = false; const homing = ents(l.r, 'foxfire').filter((f: any) => f.mode === 'home').length; for (let i = 0; i < 80; i++) { l.r.now += 0.05; l.r.updateEnts(0.05); }
  ok('飛行中に標的が倒れたら直進して寿命・壁で消える（離れる前の火の玉は消える）', homing > 0 && ents(l.r, 'foxfire').length === 0);
  // Bot: 近くに敵がいれば展開し、円の外の敵へ撃ち出す
  const bt = mk('itako', 'sayo'); bt.A.bot = true; bt.A.aim = C.BOT_AIM; Object.assign(bt.B, { x: 1552 + 60, hp: 1e9 });
  let deployed = false, launched = false;
  for (let i = 0; i < 200 && !launched; i++) { bt.r.now += 0.05; bt.r.updateBots(); bt.r.updatePlayers(0.05); bt.r.updateEnts(0.05); deployed ||= ents(bt.r, 'foxfire').length > 0; launched = ents(bt.r, 'foxfire').some((f: any) => f.mode !== 'orbit'); if (deployed && i === 40) Object.assign(bt.B, { x: bt.A.x + 180, y: bt.A.y }); }
  ok('Bot: 敵が近いと狐火を展開し、円の外の敵へ撃ち出す', deployed && launched);
}

console.log('--- ユーレイちゃん（壁すり抜け・エンマビーム）');
{
  const S = CHARS.yurei.skill;
  ok(`通常攻撃の間隔は2倍（${CHARS.yurei.aa[0].cd}秒）、威力は普通（倍率${CHARS.yurei.aa[0].dmg}）`, CHARS.yurei.aa[0].cd === C.ATTACK_COOLDOWN_MELEE * 2 && CHARS.yurei.aa[0].dmg === 1);
  const walk = (ch: string, x: number, y: number, dx: number, dy: number, sec: number) => {
    const z = mk(ch); Object.assign(z.A, { x, y });
    for (let i = 0; i < Math.round(sec / C.NET_STEP); i++) { z.A.inputs.push({ seq: i + 1, dx, dy }); z.r.now += C.NET_STEP; z.r.updatePlayers(C.NET_STEP); z.r.unstick(); }
    return z;
  };
  // study の東壁（x=27タイル、外周ではない）へ東へ歩く
  const g = walk('yurei', 400, 150, 1, 0, 1.5), s = walk('sayo', 400, 150, 1, 0, 1.5);
  ok('壊せる壁（study の東壁）をすり抜ける。ほかのキャラは止まる', tileAt(g.r, 432, 150) === '#' && g.A.x > 28 * T + C.PLAYER_RADIUS && s.A.x < 27 * T, { yurei: g.A.x, sayo: s.A.x });
  // 外周（study の北壁）は通れない
  const o = walk('yurei', 400, 150, 0, -1, 2);
  ok('外周の壁（study の北壁）は通れない', o.A.y >= 3 * T && !moveWalls('yurei', o.r.walls).some((w: any) => circleBody(o.A.x, o.A.y, C.PLAYER_RADIUS, w)), { y: o.A.y });
  // クライアントの予測と同じ計算（共通の stepPlayer に同じ壁）
  let px = 400, py = 150; for (let i = 0; i < Math.round(1.5 / C.NET_STEP); i++) ({ x: px, y: py } = stepPlayer(px, py, 1, 0, g.r.speedOf(g.A), moveWalls('yurei', C.WALLS)));
  ok('クライアントの予測（stepPlayer＋moveWalls）とサーバーの位置が一致', Math.abs(px - g.A.x) < 1e-9 && Math.abs(py - g.A.y) < 1e-9, { px, sx: g.A.x });
  ok('ほかのキャラの移動の壁は変わらない（moveWalls は ghost だけ外周）', moveWalls('sayo', C.WALLS) === C.WALLS && moveWalls(undefined, C.WALLS) === C.WALLS && moveWalls('yurei', C.WALLS) !== C.WALLS);
  // Bot の経路: 壁を抜ける
  const pb = mk('yurei'); pb.A.bot = true; Object.assign(pb.A, { x: 400, y: 150 }); pb.r.botGoto(pb.A, { x: 480, y: 150 }, pb.r.obstacles());
  const ps = mk('sayo'); ps.A.bot = true; Object.assign(ps.A, { x: 400, y: 150 }); ps.r.botGoto(ps.A, { x: 480, y: 150 }, ps.r.obstacles());
  const plen = (p: any) => p.path.reduce((a: number, q: any, i: number, arr: any[]) => a + Math.hypot(q.x - (i ? arr[i - 1].x : p.x), q.y - (i ? arr[i - 1].y : p.y)), 0);
  ok(`Bot の経路は壁を抜ける（${plen(pb.A).toFixed(0)}px、ほかのキャラは回り道 ${plen(ps.A).toFixed(0)}px）`, plen(pb.A) < 100 && plen(ps.A) > 200);
  // エンマビーム: ダメージは悪行に比例、指名手配中は即死
  const beam = (bad: number, wanted = false) => {
    const z = mk('yurei', 'sayo'); Object.assign(z.B, { x: 1552 + 150, hp: 9999, bad });
    if (wanted) { z.B.hp = z.r.maxHp(z.B); z.r.updateWanted(); }
    z.r.skill('a'); for (let i = 0; i < 20; i++) { z.r.now += 0.05; z.r.updateEnts(0.05); }
    return { d: (wanted ? z.r.maxHp(z.B) : 9999) - z.B.hp, alive: z.B.alive, left: ents(z.r, 'enma').length };
  };
  const b0 = beam(0), bh = beam(C.WANTED_MIN / 2), bm = beam(C.WANTED_MIN - 0.01), bw = beam(C.WANTED_MIN, true);
  ok(`エンマビーム: 悪行0で${S.minDmg}、悪行${C.WANTED_MIN / 2}で${S.maxDmg / 2}、閾値手前でほぼ${S.maxDmg}（全体の倍率込み ${b0.d}/${bh.d}/${bm.d}）、指名手配中は即死`,
    b0.d === Math.round(S.minDmg * C.DAMAGE_MULT) && bh.d === Math.round((S.maxDmg / 2) * C.DAMAGE_MULT) && bm.d === Math.round(S.maxDmg * ((C.WANTED_MIN - 0.01) / C.WANTED_MIN) * C.DAMAGE_MULT) && !bw.alive && b0.left === 0, { b0, bh, bm, bw });
  // 当たり判定は先頭の光弾だけ（半径 r）: 弾の通り道から少し外れた敵には当たらない
  const side = mk('yurei', 'sayo'); Object.assign(side.B, { x: 1552 + 150, y: 900 + S.r + C.PLAYER_RADIUS + 1, hp: 9999 }); side.r.skill('a'); for (let i = 0; i < 20; i++) { side.r.now += 0.05; side.r.updateEnts(0.05); }
  ok('当たり判定は先頭の光弾だけ（1つの場の物、半径 r）', side.B.hp === 9999);
  // 壁で止まる
  const w = mk('yurei', 'sayo'); Object.assign(w.A, { x: 400, y: 150 }); Object.assign(w.B, { x: 480, y: 150, hp: 9999 }); w.r.skill('a'); for (let i = 0; i < 20; i++) { w.r.now += 0.05; w.r.updateEnts(0.05); }
  ok('エンマビームは壁で消える', w.B.hp === 9999 && ents(w.r, 'enma').length === 0);
  // Bot: 悪行のある敵が射程内にいれば撃つ
  const bt = mk('yurei', 'sayo'); bt.A.bot = true; Object.assign(bt.B, { x: 1552 + 150, bad: 1 }); const bt0 = mk('yurei', 'sayo'); bt0.A.bot = true; Object.assign(bt0.B, { x: 1552 + 150, bad: 0 });
  ok('Bot: 悪行のある敵が射程内にいれば撃つ（悪行0の敵には撃たない）', SKILLS.yurei.botUse(bt.r, bt.A) && !SKILLS.yurei.botUse(bt0.r, bt0.A));
}

console.log('--- イタコ・ユーレイちゃんの Bot 戦');
{
  const r: any = new (GameRoom as any)();
  r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [] });
  r.onCreate(); r.notice = () => {};
  [['itako', 'yurei', 'sayo', 'metan'], ['yurei', 'itako', 'zunko', 'aru']].forEach((list, team) => list.forEach((ch, i) => { r.addPlayer(`g${team}${i}`, team, true).char = ch; }));
  r.startMatch();
  let fox = 0, home = 0, enma = 0, inWall = 0;
  const seenE = new Set<number>();
  for (let i = 0; r.phase !== 'ended' && i < 20 * 400; i++) {
    r.tick(0.05, false);
    for (const e of r.ents) if (!seenE.has(e.id)) { seenE.add(e.id); if (e.kind === 'foxfire') fox++; if (e.kind === 'enma') enma++; }
    if (r.ents.some((e: any) => e.kind === 'foxfire' && e.mode === 'home')) home++;
    for (const p of r.players.values()) if (p.char === 'yurei' && p.alive && r.tiles[Math.floor(p.y / T)]?.[Math.floor(p.x / T)] === '#') inWall++;
  }
  ok(`Bot 戦が最後まで動き（${r.phase}）、狐火の展開・撃ち出し・エンマビーム・ユーレイちゃんの壁抜けが起きる`, r.phase === 'ended' && fox > 0 && home > 0 && enma > 0 && inWall > 0, { fox, home, enma, inWall, phase: r.phase });
}

console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
