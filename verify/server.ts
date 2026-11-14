// サーバー単体のテスト（ブラウザなし、数秒）。実行: npm run test:server
import { GameRoom, ROOM_COMBOS, ROOM_DIST, lottery } from '../src/server/GameRoom';
import MAP from '../src/shared/map.json';
import { CONFIG as C, roomLayout, roomKindAt, slotRate, wallRects, bossIntensity } from '../src/shared/config';
import { CHARS, visionRadius } from '../src/shared/chars';
import { SKILLS, ENTS } from '../src/server/skills';
import { circleRect, moveBody, lineOfSight, inDashShape } from '../src/shared/geom';
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
  r.materials = []; r.items = []; r.couriers = []; r.courierAt = 1e9; r.healAt = C.HEAL_SPOTS.map(() => 1e9); r.notice = () => {}; // 資材・ご飯・コバコは各テストで置く
  const A = r.players.get('a'); Object.assign(A, { x: 1552, y: 900, face: 0, aim: 'manual' });
  const B = b ? r.players.get('b') : null;
  if (B) Object.assign(B, { x: 1592, y: 900, aim: 'manual' });
  return { r, A, B };
}
// 花丸の巨大拳が消えるまで飛ばす
const ents = (r: any, kind: string) => r.ents.filter((e: any) => e.kind === kind); // 場の物（種類別）
const upd = (r: any, kind: string, dt: number) => { for (const e of ents(r, kind)) ENTS[kind].update(r, e, dt); }; // 場の物の種類ごとの更新
const fly = (r: any) => { for (let i = 0; i < 200 && ents(r, 'fist').length; i++) upd(r, 'fist', 0.05); };
// 壁・バリケードと重なっていないか
const clear = (r: any, o: { x: number; y: number }, rad = C.PLAYER_RADIUS) => !r.obstacles().some((w: any) => circleRect(o.x, o.y, rad, w));
const inRoom = (p: any, h: any) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h;
const tileAt = (r: any, x: number, y: number) => r.tiles[Math.floor(y / T)][Math.floor(x / T)];
// 大将の拠点移動の予告を進めて、広範囲攻撃と移動まで終わらせる
const finishMove = (r: any) => { r.now += C.BOSS_BLAST.warn; r.updateWarns(); };

console.log('--- 壁へのめり込み');
{
  // 吹雪: study の東壁（x=27タイル、x=432〜448px）の手前にいる敵を、壁へ向けてはじく
  const { r, A, B } = mk('whitecul', 'metan');
  Object.assign(A, { x: 360, y: 300 }); Object.assign(B, { x: 420, y: 300 });
  r.skill('a');
  ok('吹雪で壁際の敵を壁へはじいてもめり込まない', clear(r, B) && B.x < 27 * T, { x: B.x });
}
{
  // ドリル: study の南東の角（x=27, y=26 タイル付近）へ斜めにはじく
  const { r, A, B } = mk('metan', 'sayo');
  Object.assign(A, { x: 380, y: 360 }); Object.assign(B, { x: 410, y: 390 });
  A.tgt = null; A.face = Math.atan2(30, 30);
  r.skill('a');
  ok('ドリルで壁の角へ斜めにはじいてもめり込まない', clear(r, B) && B.x < 27 * T && B.y < 26 * T, { x: B.x, y: B.y });
}
{
  // 大きな距離のはじきでも、1タイル厚の壁を通り抜けない
  const { r, B } = mk('metan', 'sayo');
  Object.assign(B, { x: 420, y: 300 });
  r.push({ k: 'p', o: B, x: B.x, y: B.y, r: C.PLAYER_RADIUS }, 1, 0, 500);
  ok('500pxのはじきでも壁を通り抜けない', clear(r, B) && B.x < 27 * T, { x: B.x });
}
{
  // キャラの上へのバリケード設置（壁破壊の穴へのQ）。study の南壁 x=11〜13 を壊してから置く
  const { r, A, B } = mk('hanamaru', 'metan');
  Object.assign(A, { x: 200, y: 400, face: Math.PI / 2 }); A.tgt = null; r.skill('a'); fly(r);
  Object.assign(A, { y: 392 }); Object.assign(B, { x: 200, y: 392 + C.PLACE_DIST });
  r.place('a');
  ok('敵の上にはバリケードを置けない', r.barricades.length === 0);
  B.x = 3000; Object.assign(r.bosses[1], { x: 200, y: 392 + C.PLACE_DIST + 20 }); r.place('a');
  ok('大将と重なる位置にも置けない', r.barricades.length === 0);
  r.bosses[1].x = -500; r.ents.push({ id: 9, kind: 'funnel', team: 0, owner: 'a', x: 200, y: 392 + C.PLACE_DIST, r: CHARS.mochiko.skill.radius, body: 'unit', hp: 20, until: 99, nextAtk: 0, slot: 0, tgt: null, path: [], retargetAt: 0 }); r.place('a');
  ok('ファンネルと重なる位置にも置けない', r.barricades.length === 0);
  r.ents = r.ents.filter((e: any) => e.kind !== 'funnel'); r.place('a');
  ok('空いていれば置ける', r.barricades.length === 1);
  // bii の罠: 前にキャラがいれば足元に置く（キャラと重ねない）
  const t = mk('bii', 'metan'); Object.assign(t.B, { x: 1552 + C.PLACE_DIST, y: 900 }); t.r.skill('a');
  ok('bii の罠は前がキャラで塞がっていれば足元に置く', ents(t.r, 'trap').length === 1 && ents(t.r, 'trap')[0].x === 1552);
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
  // 保険の押し出し: バリケードと重なった状態を作ると、次のtickで空き位置へ
  const { r, B } = mk('sayo', 'metan');
  r.barricades.push({ id: 1, team: 0, x: 1572, y: 880, w: 40, h: 40, hp: 80 });
  Object.assign(B, { x: 1592, y: 900 });
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
  for (const ch of ['hanamaru', 'metan']) {
    const x = mk(ch); x.r.barricades.push({ id: 1, team: 1, x: 1572, y: 880, w: 40, h: 40, hp: C.BARRICADE_HP }); x.r.attack('a');
    const base = C.ATTACK_DAMAGE * C.ROLES[roles[ch]].atk * MB.atk * C.DAMAGE_MULT;
    ok(`${ch}: バリケードへ ${CHARS[ch].breaker ? '×3' : '×1'}`, Math.abs(C.BARRICADE_HP - (x.r.barricades[0]?.hp ?? 0) - Math.min(C.BARRICADE_HP, CHARS[ch].breaker ? base * 3 : base)) < 1e-9);
  }
}

console.log('--- 技・壁破壊・バリケード上限・照準・Bot');
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
  const bl = mk('sayo'); for (let i = 0; i < 5; i++) bl.r.addBarricade(0, 1000 + i * 50, 900);
  ok('バリケードは3つまで（古いものから消える）、HP80', bl.r.barricades.length === 3 && bl.r.barricades.every((b: any) => b.hp === 80));
  const m = mk('sayo', 'metan'); m.A.aim = 'nearest'; m.A.bot = true; m.A.dy = 1; m.r.updatePlayers(0.05);
  ok('移動しながら自動攻撃', m.A.y > 900 && m.B.hp < m.r.maxHp(m.B));
  const g = mk('metan'); g.A.bot = true; g.A.role = 'raid'; g.A.aim = C.BOT_AIM; Object.assign(g.A, { x: 248, y: 380 });
  g.r.barricades.push({ id: 50, team: 1, x: 15.5 * T - 20, y: 26.5 * T - 20, w: 40, h: 40, hp: 80 }); // study→bath の扉を塞ぐ
  g.r.barricades.push({ id: 51, team: 1, x: 27.5 * T - 20, y: 11.5 * T - 20, w: 40, h: 40, hp: 80 }); // study→図書室の扉も塞ぐ（図書室経由の迂回路をなくす）
  let k = 0;
  for (; k < 400 && g.A.y < 450; k++) { g.r.botGoto(g.A, { x: 248, y: 480 }, g.r.obstacles()); g.r.updatePlayers(0.05); g.r.now += 0.05; }
  ok('Botは扉を塞ぐ敵バリケードを壊して進む', g.r.barricades.length === 1 && g.A.y >= 450 && g.A.x < 27 * T, { ticks: k });
}

console.log('--- オートアタック（射程・CT・移動中・照準モード4つ）');
{
  const r0 = mk('sayo', 'metan'); r0.A.aim = 'nearest'; r0.B.x = 1552 + C.ATTACK_RANGE + C.PLAYER_RADIUS + 5; r0.r.updatePlayers(0.05);
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
  const got = { nearest: sel('nearest'), lowhp: sel('lowhp'), boss: sel('boss'), manual: sel('manual') };
  ok('照準モード: 一番近い敵/一番HPが低い敵/大将優先/手動', got.nearest === 'c' && got.lowhp === 'b' && got.boss === 'boss' && got.manual === null, got);
  t.r.bosses[1].x = -500; ok('大将優先: 射程内に大将がいなければ一番近い敵', sel('boss') === 'c');
  const mv = mk('sayo', 'metan'); mv.A.aim = 'nearest'; mv.A.bot = true; mv.A.dy = 1; mv.r.updatePlayers(0.05);
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
  const g = mk('sayo'); g.r.healAt = []; g.r.updateHealItems(); g.r.now += C.HEAL_RESPAWN; g.r.updateHealItems();
  const pts = g.r.items.map((i: any) => [i.x, i.y]);
  ok(`ご飯は給湯室（kitchen）だけに左右${C.HEAL_SPOTS.length / 2}個ずつ、左右対称`, pts.length === C.HEAL_SPOTS.length && pts.length >= 4 && pts.every(([x, y]: number[]) => pts.some(([x2, y2]: number[]) => Math.abs(x2 - (C.MAP_W - x)) < 1 && y2 === y) && roomKindAt(Math.floor(x / T), Math.floor(y / T)) === 'kitchen'));
}

console.log('--- 技の変更（bii の罠・ierutan の加速）・きりたん');
{
  const b = mk('bii', 'metan'); b.A.face = 0; Object.assign(b.B, { x: 1552 + 120, y: 900 }); b.r.skill('a');
  const tr = ents(b.r, 'trap')[0]; upd(b.r, 'trap', 0.05);
  ok('bii の罠: 向きの扇形（射程140）にいる敵を攻撃', b.r.maxHp(b.B) - b.B.hp === Math.round(CHARS.bii.skill.dmg * C.DAMAGE_MULT * 0.8), { hp: b.B.hp });
  Object.assign(b.B, { x: 1552 - 100 }); const hb = b.B.hp; b.r.now += 1; upd(b.r, 'trap', 0.05);
  ok('bii の罠: 扇形の外（後ろ）は攻撃しない', b.B.hp === hb);
  const hp0 = tr.hp; upd(b.r, 'trap', 1); ok('bii の罠: 時間で耐久が減る', Math.abs(hp0 - tr.hp - CHARS.bii.skill.decay) < 1e-9);
  b.A.skillReadyAt = 0; b.A.x += 60; b.r.skill('a'); b.A.skillReadyAt = 0; b.A.x += 60; b.r.skill('a');
  ok('bii の罠: 同時に2つまで（古い方が消える）', ents(b.r, 'trap').filter((t: any) => t.owner === 'a').length === 2 && !ents(b.r, 'trap').includes(tr));
  const ie = mk('ierutan'); ie.A.hp = 30; ie.r.skill('a'); const sp0 = ie.r.speedOf(ie.A); ie.r.updatePlayers(1);
  ok(`ierutan の加速: 移動×${CHARS.ierutan.skill.speed}、毎秒${CHARS.ierutan.skill.regen}回復`, Math.abs(sp0 - C.PLAYER_SPEED * MB.speed * CHARS.ierutan.skill.speed) < 1e-9 && Math.abs(ie.A.hp - 33) < 1e-9);
  const k = mk('kiritan', 'metan'); k.A.aim = 'nearest';
  ok(`きりたん: 足が遅い（×${CHARS.kiritan.mult.speed}）`, k.r.speedOf(k.A) === C.PLAYER_SPEED * CHARS.kiritan.mult.speed!);
  Object.assign(k.B, { x: 1552 + 200 }); k.r.updatePlayers(0.05);
  ok('きりたん: 遠い敵にはきりたん砲（弾速遅め）', k.r.shots.length === 1 && k.r.shots[0].kind === 'cannon' && k.r.shots[0].sp < C.BULLET_SPEED);
  const k2 = mk('kiritan', 'metan'); k2.A.aim = 'nearest'; k2.r.updatePlayers(0.05);
  ok('きりたん: 近い敵には包丁（ダメージそれなり）', k2.r.shots.length === 0 && k2.r.maxHp(k2.B) - k2.B.hp === Math.round(C.ATTACK_DAMAGE * CHARS.kiritan.aa[0].dmg * C.DAMAGE_MULT * 0.8));
  const k3 = mk('kiritan', 'metan'); k3.r.skill('a'); k3.A.aim = 'nearest'; Object.assign(k3.B, { x: 1552 + 200 }); k3.r.updatePlayers(0.05);
  ok('きりたん砲飛行: 移動が速く、遠くの敵は撃たない（包丁のみ）', k3.r.speedOf(k3.A) > C.PLAYER_SPEED && k3.r.shots.length === 0 && !k3.A.tgt);
}

console.log('--- ファンネル（経路で届く敵だけ、囲んで止まって撃つ）');
{
  // 壁の向こう（study の中の敵に、廊下から）: 直線は近いが回り道が長い → 対象にしない
  const w = mk('mochiko', 'metan'); Object.assign(w.A, { x: 400, y: 568 }); Object.assign(w.B, { x: 400, y: 380 }); w.r.skill('a'); upd(w.r, 'funnel', 0.05); // 廊下と study（直線188px、回り道は bath 経由で約550px）
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
  const h = mk('sayo'); h.r.healAt = []; h.r.items = C.HEAL_SPOTS.map(([x, y]: number[], i: number) => ({ id: 500 + i, kind: 'heal', team: -1, x, y })); h.r.updateHealItems();
  const [hx, hy] = C.HEAL_SPOTS[0]; Object.assign(h.A, { x: hx, y: hy, hp: 10 }); h.r.updatePlayers(0.05); h.r.updateHealItems(); const n0 = h.r.items.length;
  h.r.now += C.HEAL_RESPAWN - 0.05; h.r.updateHealItems(); const n1 = h.r.items.length; h.r.now += 0.05; h.r.updateHealItems();
  ok(`ご飯は取られても${C.HEAL_RESPAWN}秒で同じ場所に再出現（1個ごとに徳${C.TOKU.eat}）`, n0 === C.HEAL_SPOTS.length - 1 && n1 === n0 && h.r.items.length === C.HEAL_SPOTS.length && Math.abs(h.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.eat)) < 1e-9);
  const z = mk('zunko'), k = mk('kiritan'), s = mk('sayo');
  ok('近接補正は zunko・kiritan 以外（HP×1.2・移動×1.1・攻撃×1.2）', z.r.maxHp(z.A) === 70 && k.r.maxHp(k.A) === 100 && Math.abs(s.r.maxHp(s.A) - 84) < 1e-9 && MB.hp === 1.2 && MB.speed === 1.1 && MB.atk === 1.2);
  const u = mk('sayo'); u.A.ult = { form: 'melee', tier: 1, until: u.r.now + 20, pending: false };
  ok('ウルト変身中の最大HPは旧倍率の0.8倍（近接 1.8→1.44）', Math.abs(u.r.maxHp(u.A) - 84 * 1.8 * 0.8) < 1e-9);
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
  r.messages.qup(cl); ok('ワープ後に離しても設置しない', r.barricades.length === 0);
  Object.assign(A, { x: 1552, y: 900 }); r.messages.qdown(cl); run(1); r.messages.qup(cl); run(C.RECALL_HOLD);
  ok('キーを離すと溜めはリセット', !inRoom(A, C.RECALL_ROOMS[0]) && A.recallAt === null);
  r.messages.qdown(cl); run(0.1); r.messages.qup(cl);
  ok(`短押し（${C.RECALL_TAP}秒未満）は設置できない場所なら何も起きない`, r.barricades.length === 0);
  Object.assign(A, { x: 200, y: 400, face: Math.PI / 2 }); A.tgt = null; r.skill('a'); fly(r); Object.assign(A, { y: 392 });
  r.messages.qdown(cl); run(0.1); r.messages.qup(cl);
  ok('短押しは壁破壊の穴へのバリケード設置', r.barricades.length === 1);
  // 自陣回復は廃止（study・給湯室・食堂にいても回復しない）
  const h = mk('sayo'); const rooms0 = [MAP.rooms.find((x: any) => x.id === 'study_L')!.rect, MAP.rooms.find((x: any) => x.id === 'kitchen_L')!.rect, MAP.rooms.find((x: any) => x.id === 'dining_L')!.rect];
  const hs = rooms0.map((q: number[]) => { Object.assign(h.A, { x: (q[0] + 2) * T, y: (q[1] + 2) * T, hp: 20 }); h.r.updatePlayers(1); return h.A.hp; });
  ok('自陣回復は廃止（study・給湯室・食堂にいても回復しない）', hs.every((v: number) => v === 20), hs);
  // Bot: HPが低いとリコール → 給湯室でご飯を食べてHPが満タンになるまで回復
  const be = mk('metan'); be.A.bot = true; be.A.aim = C.BOT_AIM; be.A.hp = be.r.maxHp(be.A) * 0.2; be.r.healAt = []; be.r.updateHealItems(); be.r.now += C.HEAL_RESPAWN; be.r.updateHealItems();
  let ate = 0;
  for (let i = 0; i < 600 && be.A.hp < be.r.maxHp(be.A); i++) { const n = be.r.items.length; be.r.now += 0.05; be.r.botThink(be.A, be.r.obstacles()); be.r.updatePlayers(0.05); if (be.r.items.length < n) ate++; be.r.updateHealItems(); }
  be.r.botThink(be.A, be.r.obstacles());
  ok(`Bot: HP低下でリコール → 給湯室でご飯を食べて満タンまで回復（${ate}個）`, be.A.hp >= be.r.maxHp(be.A) && ate >= 2 && inRoom(be.A, C.RECALL_ROOMS[0]) && !be.A.eating, { hp: be.A.hp, ate });
  // Bot のリコール
  const b = mk('metan'); b.A.bot = true; b.A.hp = b.r.maxHp(b.A) * 0.2; b.r.botThink(b.A, b.r.obstacles());
  ok('Bot: HPが低いとリコールを使う', b.A.recallAt !== null);
  const b2 = mk('metan'); b2.A.bot = true; Object.assign(b2.A, { x: C.MAP_W - 400, y: 300 }); b2.r.botThink(b2.A, b2.r.obstacles());
  ok('Bot: HPが減っていなければリコールしない', b2.A.recallAt === null);
  // 技のCT
  const old: Record<string, number> = { hanamaru: 25, sayo: 20, whitecul: 18, aru: 15, bii: 25, metan: 12, ierutan: 20, kiritan: 18, mochiko: 30, zunko: 18 };
  ok('技のCT: mochiko・zunko 以外は旧0.4倍', Object.entries(old).every(([k, v]) => Math.abs(CHARS[k].skill.ct - (['mochiko', 'zunko'].includes(k) ? v : v * 0.4)) < 1e-9));
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
  const k = mk('sayo'); k.r.damageBoss(k.r.bosses[1], C.BOSS_HP, k.A);
  ok('大将のHPが0になった側の負け', k.r.phase === 'ended' && k.r.winner === 0);
  for (const [h0, h1, w] of [[500, 400, 0], [400, 500, 1], [450, 450, 2]]) {
    const t = mk('sayo'); t.r.bosses[0].hp = h0; t.r.bosses[1].hp = h1; t.r.now = C.MATCH_TIME - 0.01; t.r.tick(0.05, false);
    ok(`時間切れは大将のHP割合で勝敗（${h0} 対 ${h1} → ${['あんこもん軍', 'ずんだもん軍', '引き分け'][w]}）`, t.r.phase === 'ended' && t.r.winner === w);
  }
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
      const eyes = [...[...r.players.values()].filter((p: any) => p.team === team && p.alive), r.bosses[team]];
      for (const u of [...r.players.values()].filter((p: any) => p.team !== team && p.alive)) {
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
  r.now = C.MATCH_TIME - 0.01; r.tick(0.05, false);
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
  ok(`指名手配中の敵をKO: +${C.TOKU.wantedKo}（KOの${C.TOKU.ko}はない）。倒された側の悪行ポイントは0、手配が外れる`, was === 'b' && tk(wk.r) === C.TOKU_INIT + C.TOKU.wantedKo && wk.B.bad === 0 && wk.r.teams[1].wanted === null);
  const ak = mk('sayo'); const ea = ak.r.summonAssist(1, 1); ak.r.damagePlayer(ea, 1e9, 'a');
  ok('敵のアシストを倒しても KO では下がらない', tk(ak.r) === C.TOKU_INIT);
  const wb = mk('hanamaru'); Object.assign(wb.A, { x: 200, y: 400, face: Math.PI / 2 }); wb.A.tgt = null; wb.r.skill('a'); fly(wb.r);
  ok(`壁を壊す（花丸の壁破壊）: ${C.TOKU.wall}（1回の技につき1回）`, wb.r.broken.length > 1 && tk(wb.r) === C.TOKU_INIT + C.TOKU.wall);
  const nb = mk('hanamaru'); Object.assign(nb.A, { x: 248, y: 60, face: -Math.PI / 2 }); nb.A.tgt = null; nb.r.skill('a'); fly(nb.r); // 外周の壁へ（壊れない）
  ok('壁を壊さなかった壁破壊では下がらない', nb.r.broken.length === 0 && tk(nb.r) === C.TOKU_INIT);
  const e = mk('sayo'); e.r.items.push({ id: 1, kind: 'heal', team: -1, x: e.A.x + 3, y: e.A.y }); e.r.updatePlayers(0.05);
  ok(`盗み食い（回復アイテムを拾う）: ${C.TOKU.eat}`, tk(e.r) === C.TOKU_INIT + C.TOKU.eat && e.r.fx.some((f: any) => f.kind === 'toku' && f.text === '盗み食い'));
  const c = mk('sayo'); c.r.spawnCourier(); Object.assign(c.r.couriers[0], { x: c.A.x + 30, y: c.A.y }); c.r.attack('a');
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
  ok(`全部屋・廊下に出る（${kinds.size}種類の場所）`, kinds.size >= 12 && kinds.has('path') && !kinds.has('none') && !kinds.has('wall!'), [...kinds]);
  r.materials = []; r.materialTimer = 0; r.updateMaterials(C.MATERIAL_SPAWN_INTERVAL - 0.01); const n0 = r.materials.length; r.updateMaterials(0.02);
  ok(`拾われて減ったら${C.MATERIAL_SPAWN_INTERVAL}秒ごとに1個ずつ再出現（上限${C.MATERIAL_MAX}）`, n0 === 0 && r.materials.length === 1);
  const s2 = mk('sayo'); s2.r.startMatch(); ok(`試合開始時に${C.MATERIAL_MAX}個置く`, s2.r.materials.length === C.MATERIAL_MAX);
  const at = (id: string, fx: number, fy: number) => { const q = MAP.rooms.find((x: any) => x.id === id)!.rect; return { x: (q[0] + 1 + (q[2] - q[0] - 1) * fx) * T, y: (q[1] + 1 + (q[3] - q[1] - 1) * fy) * T }; };
  const F = C.MATERIAL_FLAVOR, fl = (o: any) => r.flavor(o);
  ok(`フレーバー: study=${F.study} kitchen=${F.kitchen} 廊下=${F.path} 壁際=${F.wall} それ以外=${F.other}`,
    fl(at('study_L', 0.5, 0.5)) === F.study && fl(at('kitchen_R', 0.5, 0.5)) === F.kitchen && fl(at('corrN_L', 0.5, 0.5)) === F.path && fl({ x: at('library_L', 0, 0.5).x + 8, y: at('library_L', 0, 0.5).y }) === F.wall && fl(at('library_L', 0.5, 0.5)) === F.other);
  // 裏側（食堂・中央 以外の部屋・廊下）に偏って出て、高ポイント
  let hi = 0, wrong = 0; const front = new Set<string>();
  for (let i = 0; i < 2000; i++) { r.materials = []; r.spawnMaterial(); const m = r.materials[0], k = roomKindAt(Math.floor(m.x / T), Math.floor(m.y / T))!; if (m.hi) hi++; if (m.hi === C.FRONT_ROOMS.includes(k)) wrong++; if (!m.hi) front.add(k); }
  ok(`裏側に${C.MATERIAL_BACK * 100}%の比率で出る（2000個中 ${(hi / 20).toFixed(1)}%）。表側は食堂・中央の部屋だけ`, Math.abs(hi / 2000 - C.MATERIAL_BACK) < 0.04 && wrong === 0 && [...front].every((k) => C.FRONT_ROOMS.includes(k)), [...front]);
  const g = mk('sayo'); g.r.teams[0].toku = 5; g.r.materials.push({ id: 1, x: g.A.x + 3, y: g.A.y, hi: true }); g.r.updatePlayers(0.05);
  const fx1 = g.r.fx.filter((f: any) => f.kind === 'toku').pop(); const t1 = g.r.teams[0].toku;
  g.r.materials.push({ id: 2, x: g.A.x + 3, y: g.A.y, hi: false }); g.r.updatePlayers(0.05); const fx2 = g.r.fx.filter((f: any) => f.kind === 'toku').pop();
  ok(`裏側の資材は徳+${C.TOKU.materialBack}（通常+${C.TOKU.material}）、頭上の表示も高ポイントの印付き`, Math.abs(t1 - 5 - C.TOKU.materialBack) < 1e-9 && Math.abs(g.r.teams[0].toku - t1 - C.TOKU.material) < 1e-9 && fx1.hi === true && fx2.hi === false);
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
  r.damagePlayer(A, 1e9, 'b'); r.updateWanted();
  ok('倒されると悪行ポイントは0、手配が外れる', A.bad === 0 && r.teams[0].wanted === null);
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
  const wps = new Set<number>(); for (let i = 0; i < 1200; i++) { r.now += 0.05; r.updateCouriers(0.05); wps.add(r.couriers[0].wp); }
  ok(`寮の中を巡回する（60秒で${wps.size}地点、経路は全${C.COURIER_ROUTE.length}地点）`, wps.size >= 5 && C.COURIER_ROUTE.length === MAP.rooms.length);
  const c = r.couriers[0]; Object.assign(c, { x: A.x + 30, y: A.y, box: 'ult' }); A.face = 0; r.attack('a');
  const drop = r.items.find((i: any) => i.kind === 'box_ult');
  ok('攻撃を受けると1発でKOし、荷物をその場に落とす', !r.couriers.length && drop && Math.abs(drop.x - A.x - 30) < 1);
  r.now += C.COURIER.respawn - 0.1; r.updateCouriers(0.05); const early = r.couriers.length;
  r.now += 0.1; r.updateCouriers(0.05);
  ok(`${C.COURIER.respawn}秒後に entrance で復活し、新しい荷物を持つ`, early === 0 && r.couriers.length === 1 && r.couriers[0].x === C.COURIER_START.x && r.couriers[0].id !== c.id);
  Object.assign(drop, { x: A.x + 3, y: A.y }); r.updatePlayers(0.05);
  ok('ウルト箱: 拾った本人が変身（強さは4段階の抽選）', !!A.ult && A.ult.tier >= 0 && !r.items.includes(drop));
  const b2 = mk('sayo'); b2.r.items.push({ id: 5, kind: 'box_assist', team: -1, x: b2.A.x + 3, y: b2.A.y }); b2.r.updatePlayers(0.05);
  ok('アシスト箱: 拾った陣営にアシストを1体召喚', [...b2.r.players.values()].filter((p: any) => p.assist && p.team === 0).length === 1);
  const au = mk('sayo'); au.A.aim = 'nearest'; au.r.spawnCourier(); Object.assign(au.r.couriers[0], { x: au.A.x + 30, y: au.A.y }); au.r.updatePlayers(0.05);
  ok('オートアタックはコバコを狙わない', au.r.couriers.length === 1);
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
    ok(`バランスブレーカー段階への連チャン = ${(pb * 100).toFixed(1)}%（期待 ${C.SLOT.chainBreak * 100}%、通常の連チャンは ${C.SLOT.chain * 100}%）`, Math.abs(pb - C.SLOT.chainBreak) < 0.03 && C.SLOT.chain === 0.5, { reach, broke });
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
  ok(`白上虎太郎: 味方がいると、周囲の味方と自分を${U.shirakami.heal}回復、移動×${U.shirakami.boost}（${U.shirakami.dur}秒）`, z.A.hp === 20 + U.shirakami.heal && z.a.hp === 50 + U.shirakami.heal && Math.abs(z.r.speedOf(z.A) / sp0 - U.shirakami.boost) < 1e-9 && z.r.fx.some((f: any) => f.kind === 'ring' && f.color === 'heal'));
  z.r.now += U.shirakami.dur; ok('移動速度上昇は時間で切れる', Math.abs(z.r.speedOf(z.A) - sp0) < 1e-9);
  // 前進: 敵大将へ経路探索で進み、攻撃されても止まらない
  const g = mk('sayo', 'metan'); Object.assign(g.r.bosses[1], g.r.bases[1][g.r.bosses[1].base]); const a = g.r.summonAssist(0, 1, 'kurono'); Object.assign(a, { x: 1552, y: 900 });
  Object.assign(g.B, { x: 1552, y: 870 }); g.B.aim = 'nearest'; const d0 = Math.hypot(g.r.bosses[1].x - a.x, g.r.bosses[1].y - a.y);
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
  z = aru(248, 360, 0, 1); z.r.barricades.push({ id: 7, team: 1, x: 228, y: 470, w: 40, h: 40, hp: 80 }); z.r.skill('a'); step(z, AR.windup + 0.6);
  const broke = z.r.broken.filter(([, y]: number[]) => y === 26).length;
  ok(`壁とバリケードを壊して進む（study の南壁を${broke}マス、壊した壁は床になる）`, broke >= 4 && z.r.tiles[26][12] === '.' && z.A.y > 26 * T + 16 && !z.r.barricades.length && JSON.stringify(z.r.walls) !== JSON.stringify(C.WALLS));
  ok(`壁を壊したら徳${C.TOKU.wall}（1回の突撃で1回）`, Math.abs(z.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.wall)) < 1e-9);
  ok('壊れた場所には資材なしでバリケードを置ける', (Object.assign(z.A, { x: 12 * T + 8, y: 26 * T + 8 - C.PLACE_DIST, face: Math.PI / 2 }), delete z.A.st.rush, z.r.place('a'), z.r.barricades.length === 1));
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
  const kfly = gap('kiritan', (z) => { z.A.st.fly = { until: 99, speed: CHARS.kiritan.skill.speed, meleeOnly: true }; z.A.tgt = { k: 'p', o: z.B, x: z.B.x + 200, y: z.B.y, r: 10 }; }); // 飛行中は包丁
  kn; // 隣の敵は p.tgt なし＝遠い扱いなので、包丁は対象が近いときで確認する
  const kn2 = gap('kiritan', (z) => { z.A.tgt = { k: 'p', o: z.B, x: z.B.x, y: z.B.y, r: 10 }; });
  ok(`近接は${C.ATTACK_COOLDOWN_MELEE}秒、遠距離（zunko・きりたん砲）は${C.ATTACK_COOLDOWN_RANGED}秒、きりたんの包丁（近い対象・飛行中）は近接`, me.t0 === C.ATTACK_COOLDOWN_MELEE && me.blocked && zu.t0 === C.ATTACK_COOLDOWN_RANGED && kf.t0 === C.ATTACK_COOLDOWN_RANGED && kn2.t0 === C.ATTACK_COOLDOWN_MELEE && kfly.t0 === C.ATTACK_COOLDOWN_MELEE, { me: me.t0, zu: zu.t0, cannon: kf.t0, knife: kn2.t0, fly: kfly.t0 });
  const a = mk('sayo', 'metan'); a.A.aim = 'nearest'; a.r.updatePlayers(0.05); const h1 = a.B.hp; a.r.now += C.ATTACK_COOLDOWN_MELEE - 0.1; a.r.updatePlayers(0.05); const h2 = a.B.hp; a.r.now += 0.1; a.r.updatePlayers(0.05);
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
  const P = r.players.get('h'); P.aim = 'manual';
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
    for (const id of ['c', 'd']) { z.r.addPlayer(id, 0, false); Object.assign(z.r.players.get(id), { alive: true, char: 'sayo', aim: 'manual' }); }
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
  // 壁の中央・終端・角を上下左右から押し込む。終端・角は体が壁タイルに一部（3px）だけ触れる位置から
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
        const off = kind === '中央' ? 0 : (l1 ? -1 : 1) * (T / 2 + R - 3); // 開いている側へずらす
        const x = dx ? (dx > 0 ? tx * T - R - 1 : (tx + 1) * T + R + 1) : (tx + 0.5) * T + off;
        const y = dy ? (dy > 0 ? ty * T - R - 1 : (ty + 1) * T + R + 1) : (ty + 0.5) * T + off;
        const z = mk('hanamaru'); if (!clear(z.r, { x, y })) continue;
        z.A.bot = true; Object.assign(z.A, { x, y, dx, dy });
        for (let i = 0; i < Math.round((H.push + 0.2) / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); }
        seen[k] = (seen[k] ?? 0) + 1;
        const okk = z.r.tiles[ty][tx] === '.';
        if (!okk) bad++;
        res.push(`${k}(${tx},${ty})${okk ? '' : '×'}`);
      }
    }
    // 上向きの角は地図にないので、終端 (27,9)（上が壁、下が扉）の右に壁を足して角を作り、左にずらして下から押し込む
    {
      const z = mk('hanamaru'); z.r.tiles[9] = z.r.tiles[9].slice(0, 28) + '#' + z.r.tiles[9].slice(29); z.r.walls = wallRects(z.r.tiles);
      const x = 27.5 * T - (T / 2 + R - 3), y = 10 * T + R + 1;
      z.A.bot = true; Object.assign(z.A, { x, y, dx: 0, dy: -1 });
      if (clear(z.r, { x, y }) && wall(27, 8) && tl[10][27] === '.' && tl[9][26] === '.') {
        for (let i = 0; i < Math.round((H.push + 0.2) / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); }
        seen['角上へ'] = 1; if (z.r.tiles[9][27] !== '.') bad++;
        res.push(`角上へ(27,9)${z.r.tiles[9][27] === '.' ? '' : '×'}`);
      }
    }
    const kinds = ['中央', '終端', '角'].flatMap((k) => dirs.map(([, , dn]) => k + dn)).filter((k) => !seen[k]);
    ok(`パッシブ: 壁の中央・終端・角を上下左右から押し込んで壊せる（${H.push}秒）`, bad === 0 && kinds.length === 0, { missing: kinds, res });
  }
  const bt = mk('hanamaru', 'metan'); Object.assign(bt.A, { face: 0 }); bt.A.bot = true; Object.assign(bt.B, { x: 1552 + 300, y: 900 });
  const yes = bt.r.botSkillUseful(bt.A); bt.B.y = 900 + 200; const no = bt.r.botSkillUseful(bt.A);
  ok('Bot: 拳の進路に敵がいれば使う', yes && !no);
}

console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
