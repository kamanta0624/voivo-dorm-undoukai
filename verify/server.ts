// サーバー単体のテスト（ブラウザなし、数秒）。実行: npm run test:server
import { GameRoom, ROOM_COMBOS, ROOM_DIST, lottery, PERIMETER } from '../src/server/GameRoom';
import * as OG from '../src/server/outgame';
import MAP from '../src/shared/map.json';
import { CONFIG as C, roomLayout, roomKindAt, slotRate, penaltyRate, chanceRate, sevenRate, wallRects, bossIntensity, bodyUp } from '../src/shared/config';
import { slotSpecHtml } from '../tools/render_rules_slot';
import { CHARS, PICKABLE, E2E_BOTS, visionRadius, eyeRadius, moveWalls, charAtk, aaMode, aaRange, charStats, STAT_STEPS } from '../src/shared/chars';
import { solarAt } from '../src/server/skills/sora';
import { solarPct } from '../src/shared/solar';
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
// テスト用: 壊せる壁を全部中破にする（あと1段階で壊れる。壁を壊して抜ける動きの確認に使う）
function worn(r: any) { r.tiles.forEach((row: string, y: number) => [...row].forEach((c, x) => { if (c === '#' && !PERIMETER[y][x]) r.wallDmg.set(y * MAP.width + x, C.WALL_HITS - 1); })); return r; }
// テスト用: 自動攻撃しない状態（旧「手動」モードの代わり）
function NOAUTO() { return { until: Infinity, noAuto: true }; }
// 花丸パンチ: 技ボタンを離して（タメなし）、拳が消えるまで飛ばす
const ents = (r: any, kind: string) => r.ents.filter((e: any) => e.kind === kind); // 場の物（種類別）
const upd = (r: any, kind: string, dt: number) => { for (const e of ents(r, kind)) ENTS[kind].update(r, e, dt); }; // 場の物の種類ごとの更新
const fly = (r: any) => { for (const id of r.players.keys()) r.skillUp(id); for (let i = 0; i < 200 && ents(r, 'fist').length; i++) upd(r, 'fist', 0.05); };
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
  // 壁破壊で開いた穴の縁: 道場（study・bath）の南壁（y=33）のうち x=11〜13 を壊す
  const { r, A, B } = mk('hanamaru', 'metan');
  Object.assign(A, { x: 200, y: 512, face: Math.PI / 2 }); A.tgt = null;
  r.skill('a'); fly(r);
  const hole = r.broken.map(([x, y]: number[]) => `${x},${y}`).join(' ');
  // 穴の縁（壊れていない壁との境）に沿って斜めに歩く
  Object.assign(A, { x: 11 * T + 2, y: 32 * T + 8 });
  let bad = 0;
  for (let i = 0; i < 40; i++) { Object.assign(A, moveBody(A.x, A.y, -3, 3, C.PLAYER_RADIUS, r.obstacles())); if (!clear(r, A)) bad++; }
  ok('穴の縁を斜めに歩いても壁にめり込まない', bad === 0, { hole, at: [Math.round(A.x), Math.round(A.y)] });
  // 穴の縁にいる敵を、横の壁へ向けてはじく
  Object.assign(B, { x: 11 * T + 6, y: 33 * T + 8 });
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

console.log('--- キャラの数値（speed1 でロール補正・近接補正を焼き込み）・ロールの特性');
{
  // [HP, 通常攻撃の基本値, 移動(px/秒), 視界]（handoff_speed1 の表。HP・攻撃・視界は変更前と同じ、移動はスピード役 1.3→1.1・近接補正 1.1 廃止の後）
  const TABLE: Record<string, [number, number, number, number]> = {
    hanamaru: [120, 24, 170, 300], itako: [120, 24, 170, 300], whitecul: [96, 19.2, 187, 390], aru: [96, 19.2, 187, 390],
    sayo: [84, 33.6, 170, 300], himari: [84, 33.6, 170, 300], sora: [84, 33.6, 170, 300], zunko: [70, 28, 170, 300],
    metan: [168, 21.6, 144.5, 300], mochiko: [168, 21.6, 144.5, 300], bii: [84, 14.4, 170, 300], ierutan: [84, 14.4, 170, 300], yurei: [84, 14.4, 170, 300],
    kiritan: [100, 20, 136, 300],
  };
  const step = (v: number, th: number[]) => 1 + th.filter((t) => v >= t).length;
  ok('表に全キャラ（選べるキャラ）がある', PICKABLE.every((ch) => TABLE[ch]) && Object.keys(TABLE).length === PICKABLE.length, PICKABLE.filter((ch) => !TABLE[ch]));
  for (const ch of PICKABLE) {
    const [hp, atk, sp, vis] = TABLE[ch];
    const { r, A } = mk(ch, 'sayo');
    const t = mk(ch, 'kiritan'); t.B.hp = 9999; t.A.tgt = null; const h0 = t.B.hp; t.r.attack('a'); for (let i = 0; i < 10; i++) t.r.updateShots(0.05); // 対象なし＝遠い扱い（ずん子・きりたんは遠距離）。相手はロールなし（被ダメ軽減なし）
    const m = aaMode(ch, null), st = charStats(ch);
    const hit = Math.round(atk * m.dmg * C.DAMAGE_MULT), dealt = h0 - t.B.hp;
    const stOk = st.hp === step(hp, STAT_STEPS.hp) && st.speed === step(sp, STAT_STEPS.speed) && st.aa.every((x, i) => x.atk === step((atk * CHARS[ch].aa[i].dmg) / CHARS[ch].aa[i].cd, STAT_STEPS.atk));
    ok(`${ch}（${CHARS[ch].role ?? 'ロールなし'}）HP${r.maxHp(A)} 攻撃${atk}（1発${dealt}） 移動${r.speedOf(A)} 視界${visionRadius(ch)}・選択画面の段階 HP${st.hp} 移動${st.speed} 攻撃${st.aa.map((x) => x.atk).join('/')}`,
      r.maxHp(A) === hp && charAtk(ch) === atk && dealt === hit && r.speedOf(A) === sp && visionRadius(ch) === vis * C.VISION_SCALE && stOk, { dealt, hit });
  }
}
{
  // アシストの HP・攻撃・移動は変更前（speed1 の前に測った値）と同じ。[最大HP, 1発, 移動]（強さ 0〜3）
  const BEFORE: Record<string, [number, number, number][]> = {
    kurono: [[245, 10, 85], [350, 15, 85], [490, 20, 85], [700, 29, 85]], shirakami: [[245, 10, 85], [350, 15, 85], [490, 20, 85], [700, 29, 85]],
    aoyama: [[245, 10, 85], [350, 15, 85], [490, 20, 85], [700, 29, 85]], ritsu: [[490, 10, 42.5], [700, 15, 42.5], [980, 20, 42.5], [1400, 29, 42.5]],
  };
  const got: any = {};
  const same = Object.entries(BEFORE).every(([u, rows]) => rows.every(([hp, hit, sp], tier) => {
    const z = mk('sayo', 'metan'); const a = z.r.summonAssist(0, tier, u); Object.assign(a, { x: 1552, y: 900, face: 0 }); a.tgt = null;
    Object.assign(z.B, { x: 1552 + 30, y: 900, hp: 9999 }); z.r.attack(a.id);
    got[u + tier] = [z.r.maxHp(a), 9999 - z.B.hp, z.r.speedOf(a)];
    return z.r.maxHp(a) === hp && 9999 - z.B.hp === hit && z.r.speedOf(a) === sp;
  }));
  ok('アシストの最大HP・攻撃・移動は変更前と同じ（全アシスト・強さ4段階）', same && Object.keys(got).length === 16, got);
}
{
  // 加速の重なり（白上 ×1.1・パワーアップ近接 ×1.1）での最高速度: スピード役の通常移動 約226px/秒、小夜・ビィの技中 約329px/秒
  const top = (ch: string, useSkill: boolean) => {
    const z = mk(ch, 'metan'); delete z.A.st.test; z.A.sk = z.A.sk ?? {};
    if (useSkill) { z.r.skill('a'); }
    z.A.boostUntil = z.r.now + 10; z.A.ult = { form: 'melee', tier: 0, left: 20 };
    return z.r.speedOf(z.A);
  };
  const w = top('whitecul', false), a = top('aru', false), sy = top('sayo', true), bi = top('bii', true);
  ok(`最高速度: スピード役 ${w.toFixed(1)}・${a.toFixed(1)}px/秒（約226）、小夜の技中 ${sy.toFixed(1)}・ビィの技中 ${bi.toFixed(1)}px/秒（約329）`,
    Math.abs(w - 187 * 1.1 * 1.1) < 1e-9 && Math.round(w) === 226 && a === w && Math.abs(sy - 170 * 1.6 * 1.1 * 1.1) < 1e-9 && Math.round(sy) === 329 && Math.abs(bi - sy) < 1e-9 && C.ASSIST.units.shirakami.boost === 1.1 && C.ULT_FORMS.melee.speed === 1.1, { w, a, sy, bi });
}
{
  const a = mk('sayo', 'hanamaru'); a.r.attack('a');
  const D = CHARS.sayo.stat.atk * C.DAMAGE_MULT; // sayo の通常攻撃（全体の倍率込み）
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
  const w = mk('hanamaru'); worn(w.r); Object.assign(w.A, { x: 200, y: 512, face: Math.PI / 2 }); w.A.tgt = null; // 道場（study・bath）の南壁（y=33）の手前（中破にしておく）
  const los0 = lineOfSight(200, 512, 200, 582, w.r.walls), path0 = findPath(w.A, { x: 200, y: 582 }, w.r.walls, w.r.walls).length;
  w.r.skill('a'); fly(w.r);
  ok('壁破壊が視界・経路探索に即反映', !los0 && lineOfSight(200, 512, 200, 582, w.r.walls) && findPath(w.A, { x: 200, y: 582 }, w.r.walls, w.r.walls).length < path0);
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
  ok(`通常攻撃に全体の倍率×${C.DAMAGE_MULT}`, r.maxHp(B) - B.hp === Math.round(CHARS.hanamaru.stat.atk * C.DAMAGE_MULT));
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
  ok(`アシストは${Object.keys(C.ASSIST.units).length}人からランダム ${JSON.stringify(ch)}`, Object.keys(ch).length === Object.keys(C.ASSIST.units).length && near(Object.keys(C.ASSIST.units).map((k) => ch[k]), Object.keys(C.ASSIST.units).map(() => 1)));
  const box = { ult: 0, assist: 0 } as Record<string, number>, k = mk('sayo');
  for (let i = 0; i < N; i++) { k.r.spawnCourier(); box[k.r.couriers[0].box]++; }
  ok(`コバコの荷物 ult/assist = ${fmt([box.ult, box.assist])}（期待 ${C.COURIER.box.ult}/${C.COURIER.box.assist}）`, near([box.ult, box.assist], [C.COURIER.box.ult, C.COURIER.box.assist]));
}

console.log('--- ウルト・アシスト・回復アイテム');
{
  // ウルト: 撤退中なら復活後に始まる。撃破で元のキャラがHP100%で戻る
  const u = mk('sayo');
  u.A.ult = { form: 'melee', tier: 1, until: u.r.now + 20, pending: false }; u.A.hp = u.r.maxHp(u.A); u.A.skillReadyAt = 0; u.r.skill('a');
  ok('パワーアップ中もキャラ技を使える', u.A.skillReadyAt > 0);
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
  s.r.damagePlayer(a, 9999, 'a'); s.r.now += C.KO_FX.shake + C.KO_FX.boom; s.r.updatePlayers(0.05); s.r.now += 10; s.r.updatePlayers(0.05);
  ok('アシスト: 撃破されると復活しない（撃破の演出の後に消える）', !s.r.players.has(a.id));
  // 回復アイテム: 触れると回復（最大HPまで）。部屋の中に出る
  const h = mk('sayo'); h.A.hp = 20; h.r.items.push({ id: 1, kind: 'heal', team: -1, x: h.A.x + 3, y: h.A.y }); h.r.updatePlayers(0.05);
  ok(`回復アイテム: 触れると${C.HEAL_ITEM_AMOUNT}回復`, h.A.hp === 20 + C.HEAL_ITEM_AMOUNT && h.r.items.length === 0);
  const g = mk('sayo'); putHeals(g.r);
  const pts = g.r.items.map((i: any) => [i.x, i.y]);
  ok(`ご飯は給湯室（kitchen）だけに左右${C.HEAL_SPOTS.length / 2}個ずつ（上限2）、左右対称`, pts.length === C.HEAL_SPOTS.length && pts.length === 4 && pts.every(([x, y]: number[]) => pts.some(([x2, y2]: number[]) => Math.abs(x2 - (C.MAP_W - x)) < 1 && y2 === y) && roomKindAt(Math.floor(x / T), Math.floor(y / T)) === 'kitchen'));
}

console.log('--- 技の変更（ierutan のアップグレード）・きりたん');
{
  const S = CHARS.ierutan.skill;
  const ie = mk('ierutan'); ie.A.hp = 30; const sp0 = ie.r.speedOf(ie.A), cd0 = ie.r.atkCooldown(ie.A); ie.r.skill('a'); const sp1 = ie.r.speedOf(ie.A), cd1 = ie.r.atkCooldown(ie.A); ie.r.updatePlayers(1);
  ok(`ierutan のアップグレード: 通常攻撃の間隔×${S.cd}、移動は変わらない、毎秒${S.regen}回復`, sp1 === sp0 && Math.abs(cd1 - cd0 * S.cd) < 1e-9 && Math.abs(ie.A.hp - 33) < 1e-9, { sp0, sp1, cd0, cd1, hp: ie.A.hp });
  // 味方の近接・遠距離・パワーアップ中の通常攻撃の間隔が 0.8 倍。アシストは変わらない。実際の攻撃の間隔（cooldownUntil）でも確認
  const z = mk('ierutan', 'metan'); delete z.A.st.test;
  const add = (id: string, char: string) => { z.r.addPlayer(id, 0, false); const q = z.r.players.get(id); Object.assign(q, { char, alive: true, x: 1552 + 20, y: 900 }); q.st.test = NOAUTO(); return q; };
  const mel = add('m1', 'hanamaru'), rng = add('r1', 'kiritan'), ult = add('u1', 'sayo'); ult.ult = { form: 'melee', tier: 0, left: 20 }; rng.tgt = null;
  const as = z.r.summonAssist(0, 1, 'kurono'); Object.assign(as, { x: 1552 + 20, y: 900 });
  const cds = () => [mel, rng, ult, as].map((q: any) => z.r.atkCooldown(q));
  const b0 = cds(); z.r.skill('a'); const b1 = cds();
  z.r.now += 0.01; const gap = (q: any) => { q.cooldownUntil = 0; z.r.attack(q.id, 0); return q.cooldownUntil - z.r.now; };
  const g = [mel, rng, ult, as].map(gap);
  const want = [C.ATTACK_COOLDOWN_MELEE * S.cd, C.ATTACK_COOLDOWN_RANGED * S.cd, C.ATTACK_COOLDOWN_MELEE * S.cd, C.ATTACK_COOLDOWN_MELEE];
  ok(`アップグレード中: 味方の近接 ${want[0]}秒・遠距離 ${want[1]}秒・パワーアップ中 ${want[2]}秒（各0.8倍）、アシストは ${want[3]}秒のまま（効果は付く: ${!!as.st.upgrade}）`,
    [mel, rng, ult, as].every((q: any) => !!q.st.upgrade) && b1.every((v, i) => Math.abs(v - want[i]) < 1e-9) && g.every((v, i) => Math.abs(v - want[i]) < 1e-9) && b0[3] === b1[3], { b0, b1, g });
  ok('アップグレード中も味方の移動は変わらない', [mel, rng, ult].every((q: any) => { const s0 = z.r.speedOf(q); const u = q.st.upgrade; delete q.st.upgrade; const s1 = z.r.speedOf(q); q.st.upgrade = u; return s0 === s1; }));
  const k = mk('kiritan', 'metan'); k.A.aim = 'nearest'; delete k.A.st.test;
  ok('きりたん: 足が遅い（136px/秒。旧 mult.speed 0.8 を焼き込み）', k.r.speedOf(k.A) === 136);
  Object.assign(k.B, { x: 1552 + 170 }); k.r.updatePlayers(0.05); // 170: 視界（180）の内側
  ok('きりたん: 遠い敵にはきりたん砲（弾速遅め）', k.r.shots.length === 1 && k.r.shots[0].kind === 'cannon' && k.r.shots[0].sp < C.BULLET_SPEED);
  const k2 = mk('kiritan', 'metan'); k2.A.aim = 'nearest'; delete k2.A.st.test; k2.r.updatePlayers(0.05);
  ok('きりたん: 隣の敵にもきりたん砲（包丁は aarange1 で試験的に削除）', k2.r.shots.length === 1 && k2.r.shots[0].kind === 'cannon' && k2.r.maxHp(k2.B) === k2.B.hp);
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
  ok('近接補正・ロールの倍率は廃止（数値は各キャラの stat に焼き込み済み）', z.r.maxHp(z.A) === 70 && k.r.maxHp(k.A) === 100 && s.r.maxHp(s.A) === 84 && !('MELEE_BONUS' in C) && !('ROLES' in C));
  const u = mk('sayo'); u.A.ult = { form: 'melee', tier: 1, until: u.r.now + 20, pending: false };
  ok(`ウルト変身中の最大HPは旧倍率の0.8倍×強さ（近接 1.8→1.44、レベル2は×${C.ULT_HP_MULT[1]}）`, Math.abs(u.r.maxHp(u.A) - 84 * 1.8 * 0.8 * C.ULT_HP_MULT[1]) < 1e-9);
  ok(`パワーアップのシールド（ULT_HP_MULT）: Lv4=旧Lv3 0.98、Lv2・3は旧×0.7、Lv1据え置き、攻撃の倍率 POWER_MULT は不変 ${JSON.stringify(C.ULT_HP_MULT)}`, [0.49, 0.7 * 0.7, 0.98 * 0.7, 0.98].every((v, i) => Math.abs(C.ULT_HP_MULT[i] - v) < 1e-9) && JSON.stringify(C.POWER_MULT) === JSON.stringify([0.49, 0.7, 0.98, 1.4]));
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
  r.beginPlay(); r.breakWalls([[11, 33]]); r.teams[0].toku = 9; r.materials = [{ id: 99, x: 0, y: 0 }]; r.endMatch(0);
  ok('リザルト: 押した人数／全人数（Botは押した扱い）', JSON.stringify(r.backCount()) === JSON.stringify({ n: 6, total: 8 }));
  r.messages.back({ sessionId: 'h1' });
  ok('人間の1人だけ押した段階では戻らない', r.phase === 'ended' && r.backCount().n === 7);
  r.messages.back({ sessionId: 'h2' });
  const ps = [...r.players.values()];
  ok('人間全員が押したら待機画面へ（Botは消え、人間は陣営・キャラのまま。壁・資材・徳も最初から）', r.phase === 'waiting' && ps.length === 2 && ps.every((p: any) => !p.bot) && r.players.get('h1').char === 'metan' && r.players.get('h1').team === 0 && r.players.get('h2').team === 1
    && r.broken.length === 0 && r.tiles[33][11] === '#' && r.materials.length === 0 && r.teams[0].toku === C.TOKU_INIT && r.timeLeft === C.MATCH_TIME && r.winner === -1 && unlocked);
  r.startMatch(); r.beginPlay(); for (let i = 0; i < 20; i++) r.tick(0.05);
  ok('同じ部屋で次の試合を始められる', r.phase === 'playing' && r.players.size === 8 && r.timeLeft < C.MATCH_TIME);
}

console.log('--- リコール・回復・技のCT');
{
  const { r, A } = mk('hanamaru'); const cl = { sessionId: 'a' }; r.owners.set('a', 'a');
  const run = (sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { r.now += 0.05; r.updatePlayers(0.05); } };
  r.messages.qdown(cl); run(C.RECALL_HOLD - 0.2);
  ok('Q を押している間は溜める（まだワープしない）', !inRoom(A, C.RECALL_ROOMS[0]) && A.recallAt !== null);
  r.damagePlayer(A, 1, 'x');
  ok('被弾で中断し、溜めは0（Q を押し続けても溜めない）', A.recallAt === null);
  run(C.RECALL_HOLD); ok('中断後は押し直すまでワープしない', !inRoom(A, C.RECALL_ROOMS[0]));
  r.messages.qup(cl); r.messages.qdown(cl); run(1); r.messages.input(cl, { seq: 1, dx: 1, dy: 0 }); run(0.1);
  ok('移動で中断し、溜めは0', A.recallAt === null && A.qAt === null);
  r.messages.qup(cl); Object.assign(A, { x: 1552, y: 900 }); r.messages.qdown(cl); run(1); A.cooldownUntil = 0; r.attack('a', 0);
  ok('通常攻撃で中断し、溜めは0', A.recallAt === null);
  r.messages.qup(cl); r.messages.qdown(cl); run(1); A.skillReadyAt = 0; r.skill('a'); fly(r);
  ok('技で中断し、溜めは0', A.recallAt === null);
  r.messages.qup(cl); Object.assign(A, { x: 1552, y: 900, hp: 30 }); r.messages.qdown(cl);
  run(C.RECALL_HOLD + 0.1);
  ok(`Q を${C.RECALL_HOLD}秒押し続けると自陣の給湯室へワープ`, inRoom(A, C.RECALL_ROOMS[0]) && A.recallAt === null);
  ok(`リコール完了で最大HPの${C.RECALL_HEAL * 100}%回復（30→${A.hp}）`, Math.abs(A.hp - (30 + r.maxHp(A) * C.RECALL_HEAL)) < 1e-9, { hp: A.hp, max: r.maxHp(A) });
  r.messages.qup(cl); A.hp = r.maxHp(A) - 5; Object.assign(A, { x: 1552, y: 900 }); r.messages.qdown(cl); run(C.RECALL_HOLD + 0.1);
  ok('リコールの回復は最大HPで頭打ち', inRoom(A, C.RECALL_ROOMS[0]) && A.hp === r.maxHp(A), { hp: A.hp });
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
  ok(`Bot: HP低下でリコール → 給湯室でご飯を食べて満タンまで回復（${ate}個）`, be.A.hp >= be.r.maxHp(be.A) && ate >= 1 && inRoom(be.A, C.RECALL_ROOMS[0]) && !be.A.eating, { hp: be.A.hp, ate });
  // Bot のリコール
  const b = mk('metan'); b.A.bot = true; b.A.hp = b.r.maxHp(b.A) * 0.2; b.r.botThink(b.A, b.r.obstacles());
  ok('Bot: HPが低いとリコールを使う', b.A.recallAt !== null);
  // 溜め中に脅威（被弾）で中断されるのが BOT_RECALL_BREAKS 回続くと、BOT_RECALL_BAN 秒リコールを始めない。その後はまた始める
  const rb = mk('metan'); const R = rb.A; R.bot = true; R.hp = rb.r.maxHp(R) * 0.2; const think = () => rb.r.botThink(R, rb.r.obstacles()); const starts: boolean[] = [];
  let tCut = 0; for (let k = 0; k < C.BOT_RECALL_BREAKS; k++) { rb.r.now += C.BOT_RECALL_SAFE + 0.1; think(); starts.push(R.recallAt !== null); R.hitAt = tCut = rb.r.now; think(); }
  const banUntil = R.recallBanUntil, cnt = R.recallBreaks; rb.r.now += C.BOT_RECALL_SAFE + 0.1; think(); const banned = R.recallAt === null;
  rb.r.now = banUntil - 0.05; think(); const stillBanned = R.recallAt === null; rb.r.now = banUntil + 0.01; think(); const again = R.recallAt !== null;
  ok(`Bot: 溜め中に${C.BOT_RECALL_BREAKS}回中断されると${C.BOT_RECALL_BAN}秒リコールを始めず、その後また始める（回数は0に戻る）`, starts.every(Boolean) && Math.abs(banUntil - (tCut + C.BOT_RECALL_BAN)) < 1e-9 && cnt === 0 && banned && stillBanned && again, { starts, cnt, banned, stillBanned, again });
  const rz = mk('metan'); rz.A.bot = true; rz.A.recallBreaks = 2; rz.A.recallAt = rz.r.now; rz.r.damagePlayer(rz.A, 1e9, null); const koReset = rz.A.recallBreaks === 0;
  const rs = mk('metan'); rs.A.bot = true; rs.A.recallBreaks = 2; rs.A.recallAt = rs.r.now - C.RECALL_HOLD; rs.r.updatePlayers(0.05); const okReset = rs.A.recallBreaks === 0 && inRoom(rs.A, C.RECALL_ROOMS[0]);
  ok('Bot: 中断の回数はリコール成功・撤退で0に戻る', koReset && okReset, { koReset, okReset });
  const b2 = mk('metan'); b2.A.bot = true; Object.assign(b2.A, { x: C.MAP_W - 400, y: 300 }); b2.r.botThink(b2.A, b2.r.obstacles());
  ok('Bot: HPが減っていなければリコールしない', b2.A.recallAt === null);
  // 技のCT
  const old: Record<string, number> = { hanamaru: 25, sayo: 20, whitecul: 18, aru: 15, bii: 25, metan: 12, ierutan: 20, kiritan: 18, mochiko: 30, zunko: 18 };
  ok('技のCT: mochiko は旧の0.7倍（30→21秒、tune6）、zunko は旧の2/3、ほかは旧0.4倍', CHARS.mochiko.skill.ct === 21 && Object.entries(old).every(([k, v]) => Math.abs(CHARS[k].skill.ct - (k === 'mochiko' ? v * 0.7 : k === 'zunko' ? (v * 2) / 3 : v * 0.4)) < 1e-9));
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
  r.onCreate({ e2e: 't' }); r.onJoin({ sessionId: 'h' }); // 途中参加（Bot と入れ替わる）は e2e の部屋だけ。常設の部屋は観戦（spectate1）
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
  const K = CHARS.kiritan, cannon = K.aa.find((m) => m.name === 'きりたん砲')!;
  ok('きりたん: 通常攻撃はきりたん砲だけ（包丁は aarange1 で試験的に削除）、きりたん砲 射程200（aarange1 で310から短縮）・ダメージ0.85、全弾斉射 射程200（aim1 で310から短縮）・1発6（tune5）', K.aa.length === 1 && cannon.range === 200 && cannon.dmg === 0.85 && K.skill.range === 200 && K.skill.dmg === 6);
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
    const obs = r.seeWalls; // 敵の表示は視界の壁（透過壁を通す）
    for (const id of ['c0', 'c1']) {
      const team = r.players.get(r.owners.get(id)).team, s = last[id];
      const eyes = [...[...r.players.values()].filter((p: any) => p.team === team).map((p: any) => ({ x: p.x, y: p.y, r: eyeRadius(p.char, p.alive ? null : r.now - p.koAt, p.assist) })).filter((e: any) => e.r > 0), { ...r.bosses[team], r: visionRadius() }]; // 倒されたキャラは大爆発の後に縮む視界を持つ
      for (const u of [...r.players.values()].filter((p: any) => p.team !== team && (p.alive || r.dying(p)))) {
        const ds = eyes.map((e: any) => ({ d: Math.hypot(e.x - u.x, e.y - u.y), r: e.r }));
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

const SLOT_MODE0 = C.SLOT_MODE, classic = (on: boolean) => ((C as any).SLOT_MODE = on ? 'classic' : SLOT_MODE0); // クラシックのスロット・コバコの荷物の確認はクラシックで（handoff_slot3。結果は前と同じ）
classic(true);
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
  const wb = mk('hanamaru'); worn(wb.r); Object.assign(wb.A, { x: 200, y: 400, face: Math.PI / 2 }); wb.A.tgt = null; wb.r.skill('a'); fly(wb.r);
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

console.log('--- スロット（当たる確率・チャンスアップ・払い出し。handoff_slot4）');
{
  const N = 10000, { r } = mk('sayo');
  const rate = (toku: number) => { r.teams[0].toku = toku; let w = 0, bad = 0; for (let i = 0; i < N; i++) { r.startSpin(0); const q = r.teams[0].slot; if (q.win) w++; if (q.win !== (q.reels[0] >= 0 && q.reels[0] === q.reels[1] && q.reels[1] === q.reels[2])) bad++; } return { p: w / N, bad }; };
  const M = C.SLOT.rateMult, res = [0, 5, 10].map(rate), want = [0.01, 0.08, 0.25].map((v) => v * M);
  ok(`当たる確率 徳0/5/10 = ${res.map((x) => (x.p * 100).toFixed(1) + '%').join('/')}（期待 1/8/25%×${M}。各1万回）。当たりだけ3つそろう`, res.every((x, i) => Math.abs(x.p - want[i]) < 3 * Math.sqrt((want[i] * (1 - want[i])) / N) + 0.002 && x.bad === 0));
  ok(`間は線形補間（徳2.5→4.5%×${M}、徳7.5→16.5%×${M}）`, Math.abs(slotRate(2.5) - 0.045 * M) < 1e-9 && Math.abs(slotRate(7.5) - 0.165 * M) < 1e-9);
  // チャンスアップ（handoff_slot4）: 必ず当たる設定で、カットインの段が 大当たり L1 → L2 → L3 → L4。徳が下がるのは当選時だけ。払い出しは最後の段で1回
  const q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; q.lock = () => {}; const sent: any[] = [], paid: any[] = [];
  Object.defineProperty(q, 'clients', { value: [{ sessionId: 'x', send: (t: string, m: any) => { if (t === 'slot') sent.push([m, q.now]); } }] });
  q.onCreate(); q.notice = () => {}; q.startMatch(); q.beginPlay(); q.teams[0].toku = 6; q.slotChance = 1; q.startSpin(0, 'win'); q.teams[1].slot.start = 1e9;
  const pay0 = q.payout.bind(q); q.payout = (...a: any[]) => { paid.push([a[2], q.now]); pay0(...a); };
  const t0 = q.now; let t = 0; while (!paid.length && t < 30) { q.now += 0.05; t += 0.05; q.updateSlots(); }
  const tokuAfter = q.teams[0].toku;
  ok(`チャンスアップ: 段ごとにカットイン（${sent.map(([m]) => `${m.chain}:${C.POWER_TAGS[m.tier]}`).join(' ')}）、最大${C.SLOT.chance.n}回で${C.POWER_TAGS.at(-1)}、徳${C.SLOT.winToku}は当選時だけ`,
    JSON.stringify(sent.map(([m]) => [m.team, m.chain, m.tier])) === JSON.stringify([[0, 1, 0], [0, 2, 1], [0, 3, 2], [0, 4, 3]]) && tokuAfter === 6 + C.SLOT.winToku && paid.length === 1 && paid[0][0] === 3);
  ok(`段の間隔は${C.SLOT.gap}秒、払い出しは最後の段で1回、そのあと次の回転`, sent.every(([, at]: any, i: number) => Math.abs(at - (t0 + C.SLOT.spin + i * C.SLOT.gap)) < 0.06 * (i + 1)) && Math.abs(paid[0][1] - sent[3][1]) < 1e-9 && q.teams[0].slot.payoutAt === null && q.teams[0].slot.start === paid[0][1], sent.map(([, at]: any) => +(at - t0).toFixed(2)));
  {
    q.slotChance = 0; sent.length = 0; paid.length = 0; q.startSpin(0, 'win'); for (let i = 0; i < Math.round((C.SLOT.spin + 0.1) / 0.05); i++) { q.now += 0.05; q.updateSlots(); }
    ok('チャンスアップが外れたら大当たり（レベル1）だけ', sent.length === 1 && sent[0][0].tier === 0 && paid.length === 1 && paid[0][0] === 0);
  }
  // 到達率: 徳で連続抽選の確率が変わる（徳が高いほど続く）
  {
    const NB = 20000, z: any = new (GameRoom as any)(); z.setSimulationInterval = () => {}; Object.defineProperty(z, 'clients', { value: [] });
    z.onCreate(); z.notice = () => {}; z.startMatch(); z.beginPlay(); z.teams[1].slot.start = 1e9; z.payout = () => {}; z.addToku = () => {};
    const reach = (toku: number) => { const n = [0, 0, 0, 0]; z.teams[0].toku = toku; for (let i = 0; i < NB; i++) { z.startSpin(0, 'win'); z.now += C.SLOT.spin; z.updateSlots(); n[z.teams[0].slot.top]++; } return [1, 2, 3].map((k) => n.slice(k).reduce((a, b) => a + b, 0) / NB); };
    const res = [0, 5, 10].map(reach), want = [0, 5, 10].map((t) => [1, 2, 3].map((k) => chanceRate(t) ** k));
    const rep = [0, 5, 10].map((t, i) => `徳${t}（${(chanceRate(t) * 100).toFixed(0)}%）: L2 ${(res[i][0] * 100).toFixed(1)}%・L3 ${(res[i][1] * 100).toFixed(1)}%・L4 ${(res[i][2] * 100).toFixed(1)}%`);
    ok(`チャンスアップの到達率（各${NB}回）: ${rep.join(' / ')}`, res.every((r, i) => r.every((v, k) => Math.abs(v - want[i][k]) < 0.015)) && res[0][0] < res[1][0] && res[1][0] < res[2][0]);
  }
  // 払い出しの対象
  {
    const u = mk('sayo'); u.r.addPlayer('d', 0, true); const D = u.r.players.get('d'); Object.assign(D, { alive: true, x: 1500, y: 900 });
    u.r.payout(0, { kind: 'ult', id: 'a' }, 1);
    ok('パワーアップの絵柄: そろった1人だけ（ほかの生存者は変わらない）', u.A.ult?.tier === 1 && !D.ult && ![...u.r.players.values()].some((p: any) => p !== u.A && p.ult));
    u.r.now += 5; u.r.payout(0, { kind: 'ult', id: 'a' }, 0); const k0 = u.A.ult.tier, left0 = u.A.ult.until - u.r.now; u.r.payout(0, { kind: 'ult', id: 'a' }, 3);
    ok('パワーアップ中にまた当たる: レベルは高い方、効果時間は最初から', k0 === 1 && Math.abs(left0 - C.ULT_DURATION) < 1e-9 && u.A.ult.tier === 3);
    Object.assign(D, { alive: false }); u.r.payout(0, { kind: 'ult', id: 'd' }, 2);
    ok('反省中の人が当たる: 復帰したときにそのレベルでパワーアップ', D.ult?.pending === true && D.ult.tier === 2);
    u.r.payout(0, { kind: 'assist', char: 'ritsu' }, 1); const as = () => [...u.r.players.values()].filter((p: any) => p.assist && p.team === 0);
    const a = as()[0];
    ok('アシストの絵柄（出ていない）: そろったアシストを召喚（レベルは当選のレベル）', as().length === 1 && a.char === 'ritsu' && a.tier === 1);
    a.hp = 10; const m1 = u.r.maxHp(a); u.r.payout(0, { kind: 'assist', char: 'ritsu' }, 3); const up = a.hp - 10, m3 = u.r.maxHp(a);
    a.hp = 10; u.r.payout(0, { kind: 'assist', char: 'ritsu' }, 0);
    ok(`アシストの絵柄（出ている）: レベルは高い方。上がったら最大HPの増えた分だけ回復、上がらなければ最大HPの${C.SLOT.assistHeal * 100}%回復`, as().length === 1 && a.tier === 3 && Math.abs(up - (m3 - m1)) < 1e-9 && Math.abs(a.hp - (10 + m3 * C.SLOT.assistHeal)) < 1e-9, { up, m1, m3, hp: a.hp });
    const NT = 20000, cnt: Record<string, number> = {}; for (let i = 0; i < NT; i++) { const g = u.r.slotTarget(0); const k = g.kind === 'ult' ? g.id : g.char; cnt[k] = (cnt[k] ?? 0) + 1; }
    const ps = u.r.slotPlayers(0).map((p: any) => p.id);
    ok(`対象の抽選（アシストが出ている）: アシスト${C.SLOT.assistShare * 100}%はそのアシストだけ、残りはプレイヤー${ps.length}人で等分（${Object.entries(cnt).map(([k, v]) => `${k} ${(v / NT * 100).toFixed(1)}%`).join('・')}）`,
      Object.keys(cnt).filter((k) => !ps.includes(k)).join() === 'ritsu' && Math.abs(cnt.ritsu / NT - C.SLOT.assistShare) < 0.015 && ps.every((id: string) => Math.abs((cnt[id] ?? 0) / NT - (1 - C.SLOT.assistShare) / ps.length) < 0.015));
    for (const p of as()) u.r.players.delete(p.id);
    const c2: Record<string, number> = {}; for (let i = 0; i < NT; i++) { const g = u.r.slotTarget(0); if (g.kind === 'assist') c2[g.char] = (c2[g.char] ?? 0) + 1; }
    ok('対象の抽選（アシストが出ていない）: アシスト4人から等確率', Object.keys(c2).length === 4 && Object.values(c2).every((v) => Math.abs(v / NT - C.SLOT.assistShare / 4) < 0.01), c2);
    // 出目: 当たりは対象の絵柄の3つそろい。絵柄は SLOT.syms からいないプレイヤーを除いた並び
    u.r.players.delete('d'); const syms = u.r.slotSyms(0), sl = u.r.teams[0].slot; let bad = 0;
    for (let i = 0; i < 300; i++) { u.r.startSpin(0, 'win'); const g = sl.cur.target, x = syms[sl.reels[0] - 1]; if (!(sl.reels[0] === sl.reels[1] && sl.reels[1] === sl.reels[2]) || x.kind !== g.kind || (x.kind === 'ult' ? x.id !== g.id : x.char !== g.char)) bad++; }
    ok(`当たりの出目は対象の絵柄の3つそろい（絵柄${syms.length}つ＝プレイヤー${ps.length - 1}人＋アシスト4人＋7）`, bad === 0 && syms.length === ps.length - 1 + 5);
  }
}
{
  // 7（handoff_slot4 3章）: 徳9以上だけ、当選のうち徳9で3%・徳10で6%。全回転は7専用。7 の外れの出目はない
  const q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; Object.defineProperty(q, 'clients', { value: [] });
  q.onCreate(); q.notice = () => {}; q.startMatch(); q.beginPlay(); q.teams[1].slot.start = 1e9;
  const NS = 60000, seven = (toku: number) => { q.teams[0].toku = toku; let w = 0, s7 = 0, bad = 0; for (let i = 0; i < NS; i++) { const h = q.classicHold(0); if (h.outcome !== 'win') { if (h.act === 'allSpin') bad++; continue; } w++; const is7 = h.target.kind === 'seven'; if (is7) s7++; if (is7 !== (h.act === 'allSpin')) bad++; } return { p: s7 / w, bad }; };
  const res = [0, 5, 8.9, 9, 9.5, 10].map(seven), want = [0, 0, 0, 0.03, 0.045, 0.06];
  ok(`7の割合（当選のうち）徳0/5/8.9/9/9.5/10 = ${res.map((x) => (x.p * 100).toFixed(1) + '%').join('/')}（期待 0/0/0/3/4.5/6%）。全回転は7だけ、7は必ず全回転`, res.every((x, i) => x.bad === 0 && (want[i] === 0 ? x.p === 0 : Math.abs(x.p - want[i]) < 0.012)) && sevenRate(9.5) === 0.045, res);
  q.teams[0].toku = 10; const syms = q.slotSyms(0), i7 = 1 + syms.findIndex((x: any) => x.kind === 'seven'); let miss7 = 0, win7 = 0;
  for (let i = 0; i < 5000; i++) { q.startSpin(0); const h = q.teams[0].slot.cur; if (h.outcome !== 'win' && h.reels.includes(i7)) miss7++; } q.startSpin(0, 'win', 'allSpin'); const c = q.teams[0].slot.cur; if (c.target.kind === 'seven' && c.reels.every((v: number) => v === i7)) win7++;
  ok(`7の出目: 当たり（全回転）だけ777、外れ・リーチの出目に7は出ない（絵柄${syms.length}つ）`, miss7 === 0 && win7 === 1 && syms.length === 9, { miss7 });
  // 効果: プレイヤー全員（反省中は復帰後）。パワーアップしていない人は tier、している人は今+1+tier（上限）、効果時間は最初から。アシストは対象外
  const u = mk('sayo'); const ps = u.r.slotPlayers(0); const [a, b, c2, d] = ps; for (const p of ps) Object.assign(p, { alive: true });
  u.r.giveUlt(b, 1); u.r.giveUlt(c2, 3); Object.assign(d, { alive: false }); const as = u.r.summonAssist(0, 1, 'ritsu'); u.r.now += 10;
  u.r.payout(0, { kind: 'seven' }, 0);
  ok('7: 全員レベルアップ（なし→レベル1、レベル2→3、レベル4のまま、反省中は復帰後にレベル1）、効果時間は最初から、アシストは変わらない',
    a.ult?.tier === 0 && b.ult.tier === 2 && c2.ult.tier === 3 && d.ult?.pending && d.ult.tier === 0 && Math.abs(b.ult.until - u.r.now - C.ULT_DURATION) < 1e-9 && as.tier === 1, ps.map((p: any) => p.ult));
  u.r.payout(0, { kind: 'seven' }, 2);
  ok('7のあとのチャンスアップは全員さらに+1ずつ（2回当たり: レベル1→4）', a.ult.tier === 3 && b.ult.tier === 3);
  // 先バレ: 7 の保留は全員に saki.win
  let n7 = 0, sk = 0; for (let i = 0; i < 4000; i++) { const h = q.classicHold(0, 'win', 'allSpin'); n7++; sk += h.saki.length; }
  ok(`7の保留の先バレは全員に（1人あたり ${(sk / n7 / 4 * 100).toFixed(1)}%、期待 ${C.SLOT.saki.win * 100}%）`, Math.abs(sk / n7 / 4 - C.SLOT.saki.win) < 0.02);
  // 1試合（MATCH_TIME 秒）あたりの7の出現回数: 徳を固定して回す
  const per = (toku: number, M = 400) => { const z: any = new (GameRoom as any)(); z.setSimulationInterval = () => {}; Object.defineProperty(z, 'clients', { value: [] }); z.onCreate(); z.notice = () => {}; z.startMatch(); z.beginPlay(); z.teams[1].slot.start = 1e9;
    let n = 0; z.addToku = () => {}; z.payout = (_t: number, g: any) => { if (g.kind === 'seven') n++; };
    for (let m = 0; m < M; m++) { z.teams[0].toku = toku; z.teams[0].slot.holds = Array.from({ length: C.SLOT_MODERN.holds }, () => z.classicHold(0)); z.startSpin(0); const end = z.now + C.MATCH_TIME; while (z.now < end) { z.now += 0.1; z.updateSlots(); } }
    return n / M; };
  const pm = [9, 10].map((t) => per(t));
  ok(`7の出現回数（1試合${C.MATCH_TIME}秒、徳固定、各400試合）: 徳9 ${pm[0].toFixed(2)}回・徳10 ${pm[1].toFixed(2)}回`, pm[0] > 0 && pm[0] < pm[1] && pm[1] < 1.5, pm);
}
{
  // 先バレ: 自分がパワーアップの対象で当たる保留だけ本人に。信頼度は徳5・4人で40%（徳が上がると上がる）
  const N = 400000, q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; Object.defineProperty(q, 'clients', { value: [] });
  q.onCreate(); q.notice = () => {}; q.startMatch(); q.beginPlay();
  const me = q.slotPlayers(0)[0].id;
  const rel = (toku: number) => { q.teams[0].toku = toku; let n = 0, hit = 0; for (let i = 0; i < N; i++) { const h = q.classicHold(0); if (h.saki.includes(me)) { n++; if (h.outcome === 'win' && h.target.kind === 'ult' && h.target.id === me) hit++; } } return { n, r: hit / n }; };
  const res = [0, 5, 10].map(rel);
  const rep = [0, 5, 10].map((t, i) => `徳${t}: ${(res[i].r * 100).toFixed(1)}%（${res[i].n}回）`);
  ok(`先バレの信頼度（自分の絵柄の当たり、各${N}保留、${q.slotPlayers(0).length}人）: ${rep.join(' / ')}`, Math.abs(res[1].r - 0.4) < 0.04 && res[0].r < res[1].r && res[1].r < res[2].r);
}

classic(false);
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
  // 波音リツ: 高耐久・鈍足（他のアシストの HP×hpMult・移動×speedMult。他のアシストの値は不変）
  const R = U.ritsu, base = (ch: string, tier = 1) => { const q = setup(ch, tier); return { hp: q.r.maxHp(q.a), sp: q.r.speedOf(q.a) }; };
  const rt = base('ritsu', 2), others = ['kurono', 'shirakami', 'aoyama'].map((c) => base(c, 2));
  ok(`波音リツ: HPは他のアシストの${R.hpMult}倍、移動は${R.speedMult}倍（他のアシストは HP ${C.PLAYER_HP}×${C.ASSIST.hp}×強さ・移動 ${C.PLAYER_SPEED}×${C.ASSIST.speed} のまま）`,
    others.every((o) => o.hp === C.PLAYER_HP * C.ASSIST.hp * C.POWER_MULT[2] && o.sp === C.PLAYER_SPEED * C.ASSIST.speed) && rt.hp === others[0].hp * R.hpMult && rt.sp === others[0].sp * R.speedMult, { rt, others });
  z = setup('ritsu'); Object.assign(z.B, { x: 1552 + R.sense + 20, y: 900 }); run(z, 0.05);
  ok(`波音リツ: 周囲${R.sense}pxに敵がいなければ吹雪を出さない`, z.r.warns.length === 0);
  z = setup('ritsu'); Object.assign(z.B, { x: 1552 + 100, y: 900 }); Object.assign(z.r.bosses[1], { x: 1552, y: 900 - 110 }); run(z, 0.05); const wr = z.r.warns[0], bossAt = { ...z.r.bosses[1] };
  run(z, R.warn - 0.15); const bHp = z.B.hp, bx = z.B.x; z.r.fx = []; run(z, 0.15);
  const rdmg = Math.round(R.dmg * C.POWER_MULT[1] * C.DAMAGE_MULT * (1 - C.DEFENSE_CUT));
  ok(`波音リツ: 敵がいると自分中心・半径${R.r}の予告を${R.warn}秒出してから吹雪（${R.dmg}×強さ、外向きに${R.push}pxはじく。はじく距離は強さを掛けない）。大将ははじかれない`,
    !!wr && wr.r === R.r && wr.follow === z.a.id && bHp === 9999 && 9999 - z.B.hp === rdmg && Math.abs(z.B.x - bx - R.push) < 1e-6 && z.r.bosses[1].x === bossAt.x && z.r.bosses[1].y === bossAt.y && z.r.bosses[1].hp < C.BOSS_HP && z.r.fx.some((f: any) => f.color === 'snow'), { dmg: 9999 - z.B.hp, rdmg, push: z.B.x - bx });
  // 重い: めたんのドリル・WhiteCUL の吹雪ではじかれない。ドリルは逆にめたんをはじき、ダメージは入る
  const heavy = (ch: string) => { const q = mk(ch); Object.assign(q.r.bosses[1], { x: 2400, y: 900 }); const a = q.r.summonAssist(1, 1, 'ritsu'); Object.assign(a, { x: 1552 + 30, y: 900, skillReadyAt: 1e9 }); q.A.face = 0; q.A.tgt = null; return { q, a, hp0: a.hp, ax: a.x }; };
  const dr = heavy('metan'); dr.q.r.skill('a'); const mx0 = dr.q.A.x; const mx: number[] = [];
  for (let i = 0; i < Math.round(CHARS.metan.skill.dur / 0.05); i++) { dr.q.r.now += 0.05; dr.q.r.updatePlayers(0.05); mx.push(dr.q.A.x); }
  const bounces = mx.filter((x, i) => x < (i ? mx[i - 1] : mx0) - 1).length;
  ok(`波音リツ: めたんのドリルではじかれず（ダメージは入る）、めたんが離れる向きへ${CHARS.metan.skill.push}pxはじかれる（再ヒット間隔ごと）`, dr.a.x === dr.ax && dr.a.hp < dr.hp0 && Math.abs(mx[0] - (mx0 - CHARS.metan.skill.push)) < 1e-6 && bounces >= 1, { ritsu: dr.a.x - dr.ax, metan: mx.slice(0, 3).map((x) => x - mx0), bounces });
  const bl = heavy('whitecul'); bl.q.r.skill('a');
  ok('波音リツ: WhiteCUL の吹雪でダメージは入るが、はじかれない（WhiteCUL も弾き返されない）', bl.a.x === bl.ax && bl.a.hp < bl.hp0 && bl.q.A.x === 1552);
  const dr2 = mk('metan', 'sayo'); dr2.r.skill('a'); dr2.r.updatePlayers(0.05);
  ok('重くない相手には今までどおりドリルではじく', dr2.B.x > 1592 && dr2.A.x === 1552);
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
  // 壁・バリケードを壊して進む（道場の南壁 y=33。中破にしておく）。外周の壁は壊さずそこで止まる
  z = aru(248, 472, 0, 1); worn(z.r); z.r.skill('a'); step(z, AR.windup + 0.6);
  const broke = z.r.broken.filter(([, y]: number[]) => y === 33).length;
  ok(`壁を壊して進む（道場の南壁を${broke}マス、壊した壁は床になる）`, broke >= 4 && z.r.tiles[33][12] === '.' && z.A.y > 33 * T + 16 && JSON.stringify(z.r.walls) !== JSON.stringify(C.WALLS));
  ok(`壁を壊したら徳${C.TOKU.wall}（1回の突撃で1回）`, Math.abs(z.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.wall)) < 1e-9);
  z = aru(248, 120, 0, -1); z.r.skill('a'); step(z, AR.windup + 0.3); const mid = !!z.r.stat(z.A, 'rush');
  step(z, AR.dur);
  ok(`マップ外周の壁は壊さず、正面からぶつかっても突撃は${AR.dur}秒続く（壁の手前で止まる）`, z.r.broken.length === 0 && mid && !z.r.stat(z.A, 'rush') && z.A.y >= 3 * T && clear(z.r, z.A), { y: z.A.y });
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
  const kn2 = gap('kiritan', (z) => { z.A.tgt = { k: 'p', o: z.B, x: z.B.x, y: z.B.y, r: 10 }; }); // 近い対象もきりたん砲（包丁は aarange1 で試験的に削除）
  ok(`近接は${C.ATTACK_COOLDOWN_MELEE}秒、遠距離はきりたん砲${C.ATTACK_COOLDOWN_RANGED}秒・ずん子${CHARS.zunko.aa[0].cd}秒、きりたんは近い対象でもきりたん砲の間隔`, me.t0 === C.ATTACK_COOLDOWN_MELEE && me.blocked && Math.abs(zu.t0 - CHARS.zunko.aa[0].cd) < 1e-9 && kf.t0 === C.ATTACK_COOLDOWN_RANGED && kn2.t0 === C.ATTACK_COOLDOWN_RANGED, { me: me.t0, zu: zu.t0, cannon: kf.t0, near: kn2.t0 });
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
  ok('強化の上限はバランスブレーカー', a.tier === C.ASSIST_TAGS.length - 1);
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

classic(true);
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
  Object.assign(z.A, { x: 200, y: 400, face: Math.PI / 2, skillReadyAt: 0 }); const toku = z.r.teams[0].toku; z.r.fx = []; z.r.skill('a'); z.r.skillUp('a'); const fist = ents(z.r, 'fist').length;
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

classic(false);
console.log('--- 通信の切断と再接続（スマホのバックグラウンド等）');
{
  const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [] }); r.onCreate({ e2e: 't' }); // 途中参加は e2e の部屋だけ（常設の部屋は対戦中に入れない。人間がいなくなれば待機に戻る）
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
  r.flushLog(); // 終了レポートの収集期限を待たずに確定
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

console.log('--- 花丸（パッシブの押し込み・花丸パンチ）');
{
  const H = CHARS.hanamaru.skill;
  const push = (ch: string, x: number, y: number, dx: number, dy: number, sec: number) => {
    const z = mk(ch); z.A.bot = true; Object.assign(z.A, { x, y, dx, dy }); const b0 = z.r.broken.length;
    for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); }
    return { z, n: z.r.broken.length - b0 };
  };
  const wallY = 33 * T; // 道場（study・bath）の南壁（内側の壁）
  const touch = push('hanamaru', 200, wallY - 11, 0, 1, 0.05); // 1tick目: 壁に阻まれて押し込み始め（まだ0秒）。2tick目で0.05秒
  const held = push('hanamaru', 200, wallY - 11, 0, 1, H.push + 0.11);
  ok(`パッシブ: 壁へ${H.push}秒押し込み続けると壊す（触れてすぐでは壊れない）`, touch.n === 0 && held.n > 0 && held.z.r.tiles[33][12] === '.', { touch: touch.n, held: held.n });
  ok(`パッシブで無傷の壁を壊したら徳${C.TOKU.wall}×${C.WALL_HITS}（一気に破壊）、クールダウンなし（技のCTも消費しない）`, Math.abs(held.z.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.wall * C.WALL_HITS)) < 1e-9 && held.z.A.skillReadyAt === 0);
  const again = held.z; Object.assign(again.A, { x: 27 * T - 11, y: 200, dx: 1, dy: 0 }); const b1 = again.r.broken.length; // 道場の東壁（x=27）
  for (let i = 0; i < Math.round((H.push + 0.11) / 0.05); i++) { again.r.now += 0.05; again.r.updatePlayers(0.05); }
  ok('続けて別の壁も壊せる（クールダウンなし）', again.r.broken.length > b1);
  const per = push('hanamaru', 200, 3 * T + 11, 0, -1, 1);
  const other = push('sayo', 200, wallY - 11, 0, 1, 1);
  ok('外周の壁は壊れない。花丸以外は押し込んでも壊れない', per.n === 0 && other.n === 0);
  // 花丸パンチ: 直進、キャラ（1体1回）にダメージ、貫通、壁は壊して貫通、射程で消える
  const f = mk('hanamaru', 'metan'); f.r.addPlayer('c', 1, false); const Cc = f.r.players.get('c');
  Object.assign(f.A, { x: 1400, y: 900, face: 0 }); f.A.tgt = null; Object.assign(f.B, { x: 1460, y: 900, hp: 9999 }); Object.assign(Cc, { x: 1540, y: 905, hp: 9999, alive: true, char: 'metan' });
  f.r.skill('a'); f.r.skillUp('a'); const ct = f.A.skillReadyAt - f.r.now;
  const xs: number[] = []; for (let i = 0; i < 8; i++) { upd(f.r, 'fist', 0.05); if (ents(f.r, 'fist')[0]) xs.push(+(ents(f.r, 'fist')[0].x).toFixed(1)); }
  const one = Math.round(H.dmg * H.lv[0].dmg * C.DAMAGE_MULT * 0.8);
  ok(`花丸パンチ: 前方へ直進（毎秒${H.speed}px）、CT${H.ct}秒`, xs.every((x, i) => !i || Math.abs(x - xs[i - 1] - H.speed * 0.05) < 1e-6) && Math.abs(ents(f.r, 'fist')[0].y - 900) < 1e-9 && ct === H.ct, xs);
  ok(`花丸パンチ: キャラを貫通し、同じキャラには1回だけ当たる（${H.dmg}×レベル1の${H.lv[0].dmg}×全体の倍率）`, 9999 - f.B.hp === one && 9999 - Cc.hp === one, { b: 9999 - f.B.hp, c: 9999 - Cc.hp });
  fly(f.r);
  const dist = (H.range / H.speed);
  ok(`花丸パンチ: ${H.range}px 飛ぶと消える`, ents(f.r, 'fist').length === 0 && dist > 0);
  const w = mk('hanamaru'); worn(w.r); Object.assign(w.A, { x: 488, y: 472, face: Math.PI / 2 }); w.A.tgt = null; w.r.skill('a'); fly(w.r); // 弓道場（library）から南へ（壁は中破にしておく）
  const ys = new Set(w.r.broken.map(([, y]: number[]) => y));
  ok('花丸パンチ: 中破の壁に当たると壊して貫通し、その先の壁も壊す（弓道場の南壁 → 北廊下の南壁）', ys.has(33) && ys.has(38) && w.r.tiles[33][30] === '.' && Math.abs(w.r.teams[0].toku - (C.TOKU_INIT + C.TOKU.wall)) < 1e-9, [...ys]);
  ok('花丸パンチ: 命中・破壊はサーバーで判定し、拳の位置をスナップショットで送る', (() => { const q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; q.lock = () => {}; let got: any = null; Object.defineProperty(q, 'clients', { value: [{ sessionId: 'x', send: (t: string, m: any) => { if (t === 's') got = m; } }] }); q.onCreate(); q.onJoin({ sessionId: 'x' }); q.startMatch(); q.beginPlay(); const P = q.players.get('x'); P.char = 'hanamaru'; q.skill('x'); q.skillUp('x'); q.sendSnapshots(); const fs = got.ents.filter((e: any) => e.kind === 'fist'); return fs.length === 1 && fs[0].team === P.team; })());
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
  // 自動チャージ: CT 明けから進み、チャージ0／10秒／25秒で3段階（max 以降は溜まらない）。離すと向きを確定し、レベル2・3は溜め（移動不可）の後に発射
  const stepN = (z: any, sec: number, cl?: any) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; if (cl) z.r.messages.input(cl, { seq: ++z.seq, dx: 0, dy: 1 }); z.r.updatePlayers(0.05); } };
  const shot = (charge: number, a = 0) => {
    const z: any = mk('hanamaru', 'metan'); z.seq = 0; const cl = { sessionId: 'a' }; z.r.owners.set('a', 'a'); Object.assign(z.A, { x: 1400, y: 900, face: Math.PI }); z.A.tgt = null; Object.assign(z.B, { x: 1400 + Math.cos(a) * 60, y: 900 + Math.sin(a) * 60, hp: 9999 });
    z.A.skillReadyAt = z.r.now - charge; z.r.updatePlayers(0.05); // CT 明けから charge 秒
    const view = z.A.st.fistCharge?.view?.();
    z.r.messages.skillUp(cl, { a }); const t0 = z.r.now, ct = z.A.skillReadyAt - z.r.now, y0 = z.A.y, wind = !!z.A.st.fistWind;
    let at = ents(z.r, 'fist').length ? 0 : -1;
    for (let i = 0; i < 40 && at < 0; i++) { stepN(z, 0.05, cl); if (ents(z.r, 'fist').length) at = z.r.now - t0; }
    const f = ents(z.r, 'fist')[0]; const moved = Math.abs(z.A.y - y0) > 1e-9;
    const fx0 = f.x, fy0 = f.y; upd(z.r, 'fist', 0.05); const v = Math.hypot(f.x - fx0, f.y - fy0) / 0.05; fly(z.r);
    return { view, wind, at, moved, r: f.r, v, a: f.a, dmg: 9999 - z.B.hp, ct, charging: !!z.A.st.fistCharge };
  };
  const L = H.lv, res = [0, L[1].t - 0.1, L[1].t, L[2].t - 0.1, L[2].t, L[2].t + 30].map((c) => shot(c)), want = [0, 0, 1, 1, 2, 2].map((k) => L[k]);
  ok(`チャージ: CT 明けから0／${L[1].t}秒／${L[2].t}秒で3段階、max 以降は変わらない（半径・威力・弾速 = 基本 ×${L.map((l: any) => `${l.size}・${l.dmg}・${l.speed}`).join(' / ')}）。CT${H.ct}秒`,
    res.every((q, i) => Math.abs(q.r - H.r * want[i].size) < 1e-9 && Math.abs(q.v - H.speed * want[i].speed) < 1e-6 && q.dmg === Math.round(H.dmg * want[i].dmg * C.DAMAGE_MULT * (1 - C.DEFENSE_CUT)) && Math.abs(q.ct - H.ct) < 1e-9), res.map((q) => ({ r: q.r, v: q.v, dmg: q.dmg })));
  ok(`火力は全レベル一律×0.8（${L.map((l: any) => l.dmg).join('・')}）`, JSON.stringify(L.map((l: any) => l.dmg)) === JSON.stringify([0.8, 1.2, 1.76]));
  ok(`溜め: レベル1はすぐ、レベル2は${L[1].wind}秒、レベル3は${L[2].wind}秒の溜めの後に発射。溜め中は移動不可`, res.every((q, i) => Math.abs(q.at - want[i].wind) < 0.026 && q.wind === want[i].wind > 0 && !q.moved), res.map((q) => ({ at: +q.at.toFixed(3), moved: q.moved })));
  ok('チャージは技を使える間だけ頭上に表示（状態 fistCharge、t=チャージ秒）。発射で消える（CT 中は出さない）', Math.abs(res[2].view.t - L[1].t) < 0.051 && res.every((q) => !q.charging));
  {
    const z: any = mk('hanamaru', 'metan'); z.A.skillReadyAt = z.r.now; stepN(z, L[1].t); const t1 = z.A.st.fistCharge.view().t; stepN(z, L[2].t - L[1].t); const t2 = z.A.st.fistCharge.view().t;
    z.r.damagePlayer(z.A, 1e9, 'b'); z.r.now = z.A.respawnAt; z.r.updatePlayers(0.05); stepN(z, 1); const t3 = z.A.st.fistCharge.view().t;
    ok(`チャージは時間で進む（CT 明けから${L[1].t}秒で${t1.toFixed(2)}、${L[2].t}秒で${t2.toFixed(2)}）。撤退で0から（復活1秒後 ${t3.toFixed(2)}）`, Math.abs(t1 - L[1].t) < 0.051 && Math.abs(t2 - L[2].t) < 0.051 && t3 < 1.06, { t1, t2, t3 });
  }
  const dirs = [Math.PI / 2, -2.5].map((a) => shot(L[2].t, a));
  ok('離した時の矢印の向きに発射（自動照準の向きではない）', dirs.every((q, i) => Math.abs(q.a - [Math.PI / 2, -2.5][i]) < 1e-9 && q.dmg > 0));
  {
    // 溜め中に押し直して矢印を動かすと向きが変わり、発射時点の向きで確定（押し直しの離しでも確定）
    const z: any = mk('hanamaru', 'metan'); const cl = { sessionId: 'a' }; z.r.owners.set('a', 'a'); z.A.tgt = null; z.A.skillReadyAt = z.r.now - L[2].t; z.r.updatePlayers(0.05);
    z.r.messages.skillUp(cl, { a: 0 }); stepN(z, 0.3); z.r.messages.skillAim(cl, { a: 1 }); stepN(z, 0.3); z.r.messages.skillUp(cl, { a: 2 }); const still = !ents(z.r, 'fist').length && !!z.A.st.fistWind;
    stepN(z, 0.5); const f = ents(z.r, 'fist')[0];
    ok('溜め中: 矢印で向きを変えられ（押し直し中の skillAim・離した skillUp）、発射時点の向きで撃つ。押し直しで二重に撃たない', still && f && f.a === 2 && ents(z.r, 'fist').length === 1, { a: f?.a });
  }
  // Bot: その時のチャージのレベルで撃つ
  const bh = mk('hanamaru', 'metan'); bh.A.bot = true; Object.assign(bh.B, { x: 1552 + 300 }); bh.A.skillReadyAt = bh.r.now - (L[1].t + 1); bh.r.skill('a'); let fired = -1; const b0 = bh.r.now;
  for (let i = 0; i < 40 && fired < 0; i++) { bh.r.now += 0.05; bh.r.updatePlayers(0.05); if (ents(bh.r, 'fist').length) fired = bh.r.now - b0; }
  ok('Bot: その時のチャージのレベルで撃つ（レベル2: 溜めの後）', fired > 0 && Math.abs(fired - L[1].wind) < 0.06 && Math.abs(ents(bh.r, 'fist')[0].r - H.r * L[1].size) < 1e-9, { fired });
  // 溜め中に倒されたら不発（KO で溜めが消える）
  const ko = mk('hanamaru', 'metan'); ko.A.skillReadyAt = ko.r.now - L[2].t; ko.r.skill('a'); ko.r.damagePlayer(ko.A, 1e9, 'b'); ko.r.now += 2; ko.r.tick(0.05, false);
  ok('溜め中に倒されたら溜めは消え、拳は出ない', !ko.A.st.fistWind && ents(ko.r, 'fist').length === 0);
}

console.log('--- 壊せない壁の近く（犬走りの通路で花丸パンチ・アルの突撃）');
{
  // 犬走り（y=19〜23 タイル、高さ80px）。x=53〜84・109〜140 は上下とも外周、x=85〜108 は南が壊せる壁（扉あり）
  const H = CHARS.hanamaru.skill, AR = CHARS.aru.skill, cy = 21.5 * T, top = 19 * T;
  ok('通路の条件: 高さ80pxで上下が外周（壊せない壁）', 24 * T - top === 80 && [53, 84, 109, 140].every((x) => PERIMETER[18][x] && PERIMETER[24][x]) && !PERIMETER[24][90] && tileAt(mk('hanamaru').r, 90 * T + 8, 24 * T + 8) === '#');
  const punch = (x: number, y: number, a: number, hold: number, ex?: number, ey?: number) => {
    const z = mk('hanamaru', 'metan'); worn(z.r); Object.assign(z.A, { x, y, face: a }); z.A.tgt = null; // 壁は中破にしておく
    if (ex !== undefined) Object.assign(z.B, { x: ex, y: ey, hp: 9999 }); else Object.assign(z.B, { x: -999, y: -999 });
    z.A.skillReadyAt = z.r.now - hold; z.r.skill('a', a); for (let i = 0; i < 40 && !ents(z.r, 'fist').length; i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); } // hold: チャージ秒
    const f = ents(z.r, 'fist')[0], ys: number[] = [];
    for (let i = 0; i < 400 && ents(z.r, 'fist').length; i++) { ys.push(f.y); upd(z.r, 'fist', 0.01); }
    return { z, f, ys, dmg: 9999 - z.B.hp };
  };
  for (const [hold, name] of [[0, 'チャージなし'], [H.lv[2].t, '最大チャージ']] as [number, string][]) {
    const q = punch(1120, cy, 0, hold, 1120 + 480, cy);
    ok(`花丸パンチ（${name}、半径${q.f.r}）: 外周に挟まれた通路に沿って射程いっぱい（${H.range}px）まで飛び、通路の先の敵に当たる`, q.f.left <= 1e-9 && Math.abs(q.f.x - (1120 + H.range)) < 1e-6 && q.dmg > 0, { left: q.f.left, x: q.f.x, dmg: q.dmg });
    const per = q.z.r.broken.filter(([x, y]: number[]) => PERIMETER[y][x]).length, inner = q.z.r.broken.filter(([, y]: number[]) => y === 24).length;
    ok(`花丸パンチ（${name}）: 範囲内の壊せる壁（中破）は壊れ、外周は壊れない`, per === 0 && (q.f.r + cy > 24 * T ? inner > 0 : inner === 0), { per, inner });
  }
  const h = punch(1800, cy, -Math.PI / 2, 0), gone = h.f.y, touched = h.ys.filter((y) => y - h.f.r < top);
  ok(`花丸パンチ: 外周に正面から撃つと、芯（半径${H.core}）が外周に触れた位置で消える（拳の外側が触れただけでは消えない）`, ents(h.z.r, 'fist').length === 0 && gone - H.core <= top && gone - H.core > top - 8 && touched.length > 0 && h.z.r.broken.length === 0, { gone, touched: touched.length });
  // アル
  const step = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); } };
  const dash = (x: number, y: number, a: number, b?: string) => { const z = mk('aru', b); z.A.bot = true; Object.assign(z.A, { x, y, dx: Math.cos(a), dy: Math.sin(a) }); z.A.tgt = null; z.r.skill('a'); z.A.dx = z.A.dy = 0; return z; };
  let z = dash(1800, cy, 0, 'metan'); Object.assign(z.B, { x: 1800 + 300, y: cy, hp: 9999 }); step(z, AR.windup + 0.05); const mid = !!z.r.stat(z.A, 'rush'); step(z, AR.dur);
  ok('アルの突撃: 外周に挟まれた通路（幅126の範囲＞80px）でも止まらず通路に沿って進み、通路の先の敵に当たる', mid && z.A.x > 1800 + 300 && Math.abs(z.A.y - cy) < 1e-6 && z.B.hp < 9999 && z.r.broken.length === 0, { x: z.A.x, y: z.A.y, hp: z.B.hp });
  z = dash(1120, cy, 0); worn(z.r); step(z, AR.windup + AR.dur);
  const per = z.r.broken.filter(([x, y]: number[]) => PERIMETER[y][x]).length, inner = z.r.broken.filter(([, y]: number[]) => y === 24).length;
  ok('アルの突撃: 範囲内の壊せる壁（通路の南の壁、中破）は壊れ、外周は壊れない', inner > 0 && per === 0, { per, inner });
  z = dash(1800, cy, Math.PI / 6); step(z, AR.windup + 0.6); const x1 = z.A.x, y1 = z.A.y, on = !!z.r.stat(z.A, 'rush'); step(z, 0.4);
  ok('アルの突撃: 外周に斜めに当たると、壁に沿って滑って進む（突撃は続く）', on && !!z.r.stat(z.A, 'rush') && z.A.x > x1 + 20 && Math.abs(z.A.y - y1) < 1e-6 && y1 < 24 * T && clear(z.r, z.A), { x1, y1, x: z.A.x, y: z.A.y });
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
  const bi = mk('bii', 'himari'); Object.assign(bi.B, { x: 1552 + 5 }); bi.r.skill('b'); bi.r.skill('a'); bi.r.now += 0.05; bi.r.updateEnts(0.05); // 鎌を振ると透明化が解けるので、ビィの予約だけを進める
  ok('透明化中は敵の技（ビィのオーバードライブの予約）の対象にならない', ents(bi.r, 'overload')[0]?.marks.length === 0);
  // 被弾（範囲攻撃を含む）で即死
  const d = mk('metan', 'himari'); d.r.skill('b'); d.A.face = 0; d.A.tgt = null; d.r.skill('a'); d.r.updatePlayers(0.05);
  ok('透明化中は被弾（範囲攻撃）で即死', !d.B.alive);
  // 5秒で解除（攻撃なしで姿を現す）
  const e = mk('himari', 'sayo'); Object.assign(e.B, { x: 1552 + 300 }); e.r.skill('a'); tick(e, H.dur - 0.1); const still = !!e.r.stat(e.A, 'cloak'); tick(e, 0.2);
  ok(`${H.dur}秒で透明化が解ける（攻撃は出ない）`, still && !e.r.stat(e.A, 'cloak') && e.B.hp === e.r.maxHp(e.B) && !e.r.fx.some((f: any) => f.color === 'scythe'));
  // 鎌: 通常キャラは倒れ、ひまりは攻撃の向きへ5キャラ分跳ぶ
  const s = mk('himari', 'sayo'); s.A.face = 0; s.A.tgt = null; s.r.skill('a'); const x0 = s.A.x; s.r.attack('a'); const cloak = !!s.r.stat(s.A, 'cloak'); tick(s, 1);
  ok(`鎌: 当たった通常キャラは倒れ、ひまりは${H.jump}px（5キャラ分）跳ぶ。透明化は解ける`, !s.B.alive && Math.abs(s.A.x - x0 - H.jump) < 1 && !cloak && !s.A.st.leap, { moved: s.A.x - x0 });
  // 基礎ダメージ160: ディフェンス（めたん・もち子）だけ残りHP約2で耐え、ほかのプレイヤーは一撃
  const left = Object.fromEntries(PICKABLE.filter((c) => c !== 'himari').map((c) => { const q = mk('himari', c); q.A.face = 0; q.A.tgt = null; q.B.hp = q.r.maxHp(q.B); q.r.skill('a'); q.r.attack('a'); return [c, q.B.alive ? q.B.hp : 0]; }));
  ok(`鎌の基礎ダメージ${H.dmg}（全体の倍率込み${H.dmg * C.DAMAGE_MULT}）: めたん・もち子は残りHP約2で耐え、ほかは一撃`, H.dmg === 160 && left.metan === 2 && left.mochiko === 2 && Object.entries(left).every(([c, hp]) => c === 'metan' || c === 'mochiko' || hp === 0), left);
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
  const bt = mk('himari', 'sayo'); bt.A.bot = true; bt.A.aim = C.BOT_AIM; Object.assign(bt.B, { x: 1552 + 150 }); bt.B.hp = 1e9; // 視界（ひまり 180）の内側
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
  ok(`ロックした3人へ、${K.volleys}回に分けて計${K.perTarget * K.volleys}発（1人あたり${(K.perTarget * K.volleys) / 3}発）`, launched.length === K.volleys && launched.reduce((x, y) => x + y, 0) === K.perTarget * K.volleys, launched);
  ok('ロックした全員に弾が当たる', [z.B, c, d].every((q: any, i: number) => q.hp < hp[i]) && ents(z.r, 'missile').length === 0, [z.B, c, d].map((q: any, i: number) => hp[i] - q.hp));
  ok('弾道は3種（直進・左右に展開→加速・前後へ偏差→急制動）', ['straight', 'spread', 'brake'].every((p) => pats.has(p)), [...pats]);
  // 弾数: 総数 perTarget × volleys をロックした人数で均等に分ける（余りはロック順に1発ずつ）
  const split = (n: number) => {
    const q = mk('kiritan'); const ids: string[] = [];
    for (let i = 0; i < n; i++) { const id = `t${i}`; q.r.addPlayer(id, 1, false); Object.assign(q.r.players.get(id), { char: 'metan', alive: true, x: 1552 + 40 + i * 25, y: 900 + (i % 2) * 30, hp: 9999 }); q.r.players.get(id).st.test = NOAUTO(); ids.push(id); }
    q.r.skill('a'); for (let i = 0; i < 20 && q.A.sk.marks.length < n; i++) { q.r.now += 0.05; q.r.updatePlayers(0.05); }
    const marks = [...q.A.sk.marks]; q.r.skill('a'); const by: Record<string, number> = {}, seen = new Set<number>();
    for (let i = 0; i < 20; i++) { q.r.now += 0.05; q.r.updatePlayers(0.05); for (const e of ents(q.r, 'missile')) if (!seen.has(e.id)) { seen.add(e.id); by[e.tgt] = (by[e.tgt] ?? 0) + 1; } upd(q.r, 'missile', 0); }
    return marks.map((m) => by[m] ?? 0);
  };
  const sp = [1, 2, 3, 5].map(split);
  ok(`弾数: 1人ロックで${K.perTarget * K.volleys}発、2人で6発ずつ、3人で4発ずつ、5人は余りをロック順に1発ずつ（3,3,2,2,2）`, JSON.stringify(sp) === JSON.stringify([[12], [6, 6], [4, 4, 4], [3, 3, 2, 2, 2]]), sp);
  // 目標が着弾前に倒れた弾: その時点の進行方向へ直進し、壁・敵・寿命で消える。当たった敵にはダメージ（倒れた地点で往復しない）
  const o = mk('kiritan', 'metan'); Object.assign(o.B, { x: 1552 + 120, y: 900, hp: 9999 }); o.r.addPlayer('c', 1, false); const oc = o.r.players.get('c'); Object.assign(oc, { char: 'metan', alive: true, x: 1552 + 190, y: 900, hp: 9999 }); oc.st.test = NOAUTO(); oc.st.h = { until: Infinity, hidden: true }; // c はロックされないように隠す（当たり判定は残る）
  o.r.skill('a'); o.r.now += 0.05; o.r.updatePlayers(0.05); o.r.skill('a');
  for (let i = 0; i < 12; i++) { o.r.now += 0.05; o.r.updatePlayers(0.05); o.r.updateEnts(0.05); }
  o.r.damagePlayer(o.B, 1e9, 'a'); const heads: Record<number, number[]> = {}; let back = 0;
  for (let i = 0; i < 80; i++) { o.r.now += 0.05; o.r.updatePlayers(0.05); o.r.updateEnts(0.05); for (const e of ents(o.r, 'missile')) { if (e.orphan) { (heads[e.id] ??= []).push(e.a); } } }
  for (const hs of Object.values(heads)) if (hs.some((h) => Math.abs(Math.atan2(Math.sin(h - hs[0]), Math.cos(h - hs[0]))) > 1e-9)) back++;
  ok('目標が倒れた弾は進行方向へ直進に切り替わり（向きが変わらない＝往復しない）、距離・壁・敵で消え、当たった敵にはダメージ', Object.keys(heads).length > 0 && back === 0 && ents(o.r, 'missile').length === 0 && oc.hp < 9999, { orphans: Object.keys(heads).length, back, c: 9999 - oc.hp });
  // 直進に切り替わった弾はコバコにも当たり、KOして消える（そらのビームと同じ扱い）
  const oq = mk('kiritan', 'metan'); Object.assign(oq.B, { x: 1552 + 120, y: 900, hp: 9999 }); oq.r.spawnCourier(); Object.assign(oq.r.couriers[0], { x: 1552 + 190, y: 900 });
  oq.r.skill('a'); oq.r.now += 0.05; oq.r.updatePlayers(0.05); oq.r.skill('a');
  for (let i = 0; i < 12; i++) { oq.r.now += 0.05; oq.r.updatePlayers(0.05); oq.r.updateEnts(0.05); }
  oq.r.damagePlayer(oq.B, 1e9, 'a'); let orph = 0;
  for (let i = 0; i < 80 && oq.r.couriers.length; i++) { oq.r.now += 0.05; oq.r.updatePlayers(0.05); oq.r.updateEnts(0.05); orph = Math.max(orph, ents(oq.r, 'missile').filter((e: any) => e.orphan).length); }
  ok('直進に切り替わった弾はコバコにも当たり、1発でKOする', orph > 0 && !oq.r.couriers.length && oq.r.courierAt > 0, { orph, couriers: oq.r.couriers.length });
  const t = mk('kiritan', 'metan'); t.r.skill('a'); for (let i = 0; i < Math.round((K.lockMax + 0.1) / 0.05); i++) { t.r.now += 0.05; t.r.updatePlayers(0.05); }
  ok(`ロックの時間切れ（${K.lockMax}秒）で撃たずに CT が始まる`, !t.r.stat(t.A, 'lockon') && t.A.skillReadyAt > t.r.now && ents(t.r, 'missile').length === 0);
  const bt = mk('kiritan', 'metan'); bt.A.bot = true; Object.assign(bt.B, { x: 1552 + 120, hp: 9999 }); let fired = false;
  for (let i = 0; i < 60 && !fired; i++) { bt.r.now += 0.05; bt.r.updateBots(); bt.r.updatePlayers(0.05); fired = !!bt.A.sk.volleys; }
  ok('Bot: ロックして発射する', fired);
}

console.log('--- 猫使ビィ（オーバードライブ）');
{
  const B = CHARS.bii.skill;
  const run = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); z.r.updateEnts(0.05); } };
  const ov = (z: any, id = 'a') => ents(z.r, 'overload').find((e: any) => e.owner === id);
  // 加速・通常攻撃なし・残像
  const s0 = mk('bii', 'metan'); const sp0 = s0.r.speedOf(s0.A); s0.r.skill('a');
  const sp1 = s0.r.speedOf(s0.A); s0.A.cooldownUntil = 0; s0.r.attack('a', 0);
  ok(`発動で${B.dur}秒、移動×${B.speed}・通常攻撃しない`, Math.abs(sp1 / sp0 - B.speed) < 1e-9 && s0.A.cooldownUntil === 0, { sp0, sp1 });
  s0.A.bot = true; s0.A.dx = 1; s0.A.dy = 0; Object.assign(s0.B, { x: -999, y: -999, alive: false, respawnAt: 1e9 }); // 1人で右へ走る
  const counts: number[] = []; for (let i = 0; i < 20; i++) { run(s0, 0.05); counts.push(ents(s0.r, 'biiDecoy').length); }
  const ds = ents(s0.r, 'biiDecoy'), gaps = ds.slice(1).map((d: any, i: number) => +(d.x - ds[i].x).toFixed(1));
  ok(`${B.every}秒ごとにその場へ残像を置き、${B.decoyLife}秒で消える`, counts[2] === 1 && counts[3] === 2 && Math.max(...counts) === Math.round(B.decoyLife / B.every) && counts[19] === Math.round(B.decoyLife / B.every) && gaps.every((g: number) => Math.abs(g - sp1 * B.every) < 1), { counts, gaps });
  // 残像は敵の自動照準・通常攻撃の対象（ビィより近ければ狙われ、攻撃を受けると消える。ビィは無傷）
  const dc = mk('bii', 'sayo'); Object.assign(dc.B, { x: 1552 + 40 }); dc.B.aim = 'nearest'; dc.r.skill('a'); run(dc, 0.05); // 1tick目で残像を置く
  Object.assign(dc.A, { x: 1552 - 60 }); delete dc.B.st.test; const hp0 = dc.A.hp; dc.B.cooldownUntil = 0; run(dc, 0.05);
  ok('残像は敵の通常攻撃・自動照準の対象になり、攻撃を受けると消える', ents(dc.r, 'biiDecoy').every((d: any) => d.x !== 1552) && dc.A.hp === hp0 && dc.B.cooldownUntil > dc.r.now, { decoys: ents(dc.r, 'biiDecoy').map((d: any) => d.x), hp: dc.A.hp });
  // 予約: 触れた敵に1回。終了でポーズ（硬直）→ 予約の全員へダメージ
  const h = mk('bii', 'metan'); h.r.addPlayer('c', 1, false); const Cc = h.r.players.get('c'); Object.assign(Cc, { char: 'sayo', alive: true, x: 1552 + 200, y: 900, hp: 9999 }); Cc.st.test = NOAUTO();
  Object.assign(h.B, { x: 1552 + 5, hp: 9999 }); h.r.skill('a'); run(h, 0.4);
  const m1 = ov(h).marks.length; Object.assign(h.A, { x: 1552 + 195 }); run(h, 0.4); Object.assign(h.A, { x: 1552 + 5 }); run(h, 0.4);
  const mv = ov(h).v;
  run(h, B.dur - 1.2 + 0.05); const pose = !!h.r.stat(h.A, 'overloadPose') && h.r.effect(h.A, 'lock'), stillPose = h.r.stillLock(h.A), hpPose = [h.B.hp, Cc.hp];
  run(h, B.pose + 0.1);
  const want = [Math.round(B.dmg * C.DAMAGE_MULT * (1 - C.DEFENSE_CUT)), Math.round(B.dmg * C.DAMAGE_MULT)];
  ok('触れた敵に予約が付き、同じ敵は1回だけ（予約の目印は対象のidと半径だけ送り、位置はクライアントが対象の描画位置から引く）', m1 === 1 && mv.length === 2 && mv.map((m: any) => m.id).join() === 'p:b,p:c' && mv.every((m: any) => m.x === undefined && m.r > 0), { m1, mv });
  const sl = mk('bii'); sl.A.st.x = { until: Infinity, lock: true, still: true }; const s1 = sl.r.stillLock(sl.A); sl.A.st.y = { until: Infinity, lock: true }; const s2 = sl.r.stillLock(sl.A); delete sl.A.st.x; delete sl.A.st.y; const s3 = sl.r.stillLock(sl.A);
  ok('ポーズはその場で止まる lock（still）。still は有効な lock がすべて still のときだけ（サーバーが動かす lock が混ざれば補間）', stillPose && s1 && !s2 && !s3, { stillPose, s1, s2, s3 });
  ok(`終了時にポーズ（硬直${B.pose}秒）→ 予約の全員へダメージ（${B.dmg}×全体の倍率、1回だけ）`, pose && hpPose[0] === 9999 && hpPose[1] === 9999 && 9999 - h.B.hp === want[0] && 9999 - Cc.hp === want[1] && !h.r.stat(h.A, 'overloadPose'), { pose, b: 9999 - h.B.hp, c: 9999 - Cc.hp, want });
  // 爆発のカウントダウン: 予約の目印に爆発の時刻（技の終了時刻＋pose）と残り秒。残りが0になる tick でダメージ。予約後に倒れた相手の目印は消える
  const cd = mk('bii', 'metan'); cd.r.addPlayer('c', 1, false); const Cd = cd.r.players.get('c'); Object.assign(Cd, { char: 'sayo', alive: true, x: 1552 + 200, y: 900, hp: 9999 }); Cd.st.test = NOAUTO();
  Object.assign(cd.B, { x: 1552 + 5, hp: 9999 }); cd.r.skill('a'); const until = cd.A.st.overload.until; run(cd, 0.2);
  const v0 = ov(cd).v[0], at = v0.at, left0 = v0.left; Object.assign(cd.A, { x: 1552 + 195 }); run(cd, 0.2); Object.assign(cd.A, { x: 1552 - 300 }); // C にも予約してから離れる
  cd.r.damagePlayer(Cd, 1e9, 'a'); run(cd, 0.05); const afterKo = ov(cd).v.map((m: any) => m.id);
  let hitAt = -1, lastLeft = -1; for (let i = 0; i < 80 && hitAt < 0; i++) { const e0 = ov(cd); if (e0) lastLeft = e0.v[0]?.left ?? -1; const b0 = cd.B.hp; run(cd, 0.05); if (cd.B.hp < b0) hitAt = cd.r.now; }
  ok(`爆発のカウントダウン: 予約の目印に爆発の時刻（技の終了＋${B.pose}秒）と残り秒を送り、残りが0になる tick でダメージ。予約後に倒れた相手の目印は消える`, Math.abs(at - (until + B.pose)) < 1e-9 && Math.abs(left0 - (at - 0.2)) < 1e-6 && hitAt >= at - 1e-9 && hitAt < at + 0.05 + 1e-9 && lastLeft > 0 && lastLeft <= 0.05 + 1e-9 && afterKo.join() === 'p:b', { at, left0, hitAt, lastLeft, afterKo });
  // 接触範囲: 中心間 敵の半径＋touch 以内で予約（プレイヤー同士の接触 20px より広い）
  const tr = (dx: number) => { const z = mk('bii', 'metan'); z.B.st.test = NOAUTO(); Object.assign(z.B, { x: 1552 + dx, y: 900 }); z.r.skill('a'); run(z, 0.05); return ov(z).marks.length; };
  const edge = C.PLAYER_RADIUS + B.touch;
  ok(`接触範囲は中心間${edge}px（敵の半径＋${B.touch}）。その外は予約しない`, tr(edge - 2) === 1 && tr(30) === 1 && tr(edge + 4) === 0, { in: tr(edge - 2), out: tr(edge + 4) });
  // 予約0人ならポーズも爆発もない
  const z = mk('bii', 'metan'); Object.assign(z.B, { x: 1552 + 300 }); z.r.skill('a'); run(z, B.dur + 0.05); z.r.fx = [];
  ok('予約0人なら終了時にポーズも硬直もない', !z.A.st.overloadPose && !z.r.effect(z.A, 'lock') && ov(z) === undefined);
  // 途中で倒されたら不発（予約は消える）
  const k = mk('bii', 'metan'); Object.assign(k.B, { x: 1552 + 5, hp: 9999 }); k.r.skill('a'); run(k, 0.2); k.r.damagePlayer(k.A, 1e9, 'b'); run(k, B.dur + B.pose);
  const kp = mk('bii', 'metan'); Object.assign(kp.B, { x: 1552 + 5, hp: 9999 }); kp.r.skill('a'); run(kp, B.dur + 0.05); kp.r.damagePlayer(kp.A, 1e9, 'b'); run(kp, B.pose + 0.1);
  ok('オーバードライブ中・ポーズ中に倒されたら予約は消え、ダメージは不発', k.B.hp === 9999 && kp.B.hp === 9999 && !ents(k.r, 'overload').length && !ents(kp.r, 'overload').length);
  // ビィ2人の予約は別々（片方が倒れても、もう片方の予約は残る）
  const two = mk('bii', 'metan'); two.r.addPlayer('d', 0, false); const D = two.r.players.get('d'); Object.assign(D, { char: 'bii', alive: true, x: 1552, y: 1100 }); D.st.test = NOAUTO();
  two.r.addPlayer('c', 1, false); const C2 = two.r.players.get('c'); Object.assign(C2, { char: 'sayo', alive: true, x: 1552 + 5, y: 1100, hp: 9999 }); C2.st.test = NOAUTO();
  Object.assign(two.B, { x: 1552 + 5, hp: 9999 }); two.r.skill('a'); two.r.skill('d'); run(two, 0.2);
  const sep = ov(two, 'a').marks.map((m: any) => m.id).join() === 'p:b' && ov(two, 'd').marks.map((m: any) => m.id).join() === 'p:c';
  two.r.damagePlayer(D, 1e9, 'b'); run(two, B.dur + B.pose);
  ok('予約はビィ1人ずつ別（同じ陣営のビィ2人が混ざらない。倒れたほうの予約だけ不発）', sep && two.B.hp < 9999 && C2.hp === 9999, { b: two.B.hp, c: C2.hp });
  // 大将にも予約できる（大将へは bossDmg）
  const bs = mk('bii'); Object.assign(bs.r.bosses[1], { x: 1552 + 20, y: 900 }); bs.r.skill('a'); run(bs, B.dur + B.pose + 0.15);
  ok(`大将にも予約でき、大将へは${B.bossDmg}×全体の倍率`, Math.abs(C.BOSS_HP - bs.r.bosses[1].hp - B.bossDmg * C.DAMAGE_MULT) < 1e-9, C.BOSS_HP - bs.r.bosses[1].hp);
  // 旧技（突進・着弾爆発・壁破壊）はない
  const w = mk('bii', 'metan'); Object.assign(w.A, { x: 300, y: 300, face: 0 }); Object.assign(w.B, { x: 305, y: 300, hp: 9999 }); w.r.skill('a'); run(w, B.dur + B.pose + 0.05);
  ok('壁は壊さない（旧技の突進・着弾爆発・壁破壊は削除）', w.r.broken.length === 0 && !w.A.st.phantom);
  // Bot: 敵が近いときに使い、予約していない敵へ寄る
  const bt = mk('bii', 'metan'); Object.assign(bt.B, { x: 1552 + 100 }); bt.A.bot = true;
  const use = bt.r.botSkillUseful(bt.A); Object.assign(bt.B, { x: 1552 + B.botRange + 60 }); const far = bt.r.botSkillUseful(bt.A);
  Object.assign(bt.B, { x: 1552 + 100 }); bt.r.skill('a'); bt.A.dx = bt.A.dy = 0; const d0 = Math.hypot(bt.B.x - bt.A.x, bt.B.y - bt.A.y); run(bt, 0.3);
  ok('Bot: 敵が近ければ使い、オーバードライブ中は予約していない敵へ寄る', use && !far && Math.hypot(bt.B.x - bt.A.x, bt.B.y - bt.A.y) < d0 - 30, { d0, d1: Math.hypot(bt.B.x - bt.A.x, bt.B.y - bt.A.y) });
}

console.log('--- もち子（ホバー）・ずん子');
{
  ok('もち子・ユーレイちゃん・そらの歩行タイプはホバー（ほかは normal）', ['mochiko', 'yurei', 'sora'].every((k) => CHARS[k].walk === 'hover') && Object.entries(CHARS).every(([k, c]) => ['mochiko', 'yurei', 'sora'].includes(k) || c.walk === 'normal'));
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
  const zs = mk('zunko', 'metan'); zs.B.x = zs.A.x + 150; /* 近接に切り替わらない距離 */ zs.A.tgt = { k: 'p', o: zs.B, x: zs.B.x, y: zs.B.y, r: C.PLAYER_RADIUS }; zs.r.attack('a', 0); const noSlash = !zs.r.fx.some((x: any) => x.kind === 'slash'); zs.r.updateShots(0.5);
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
  const hm = mk('himari', 'sayo'); delete hm.A.st.test; hm.A.aim = 'nearest'; hm.r.skill('a'); hm.r.updatePlayers(0.05); hm.r.updatePlayers(0.05);
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
  // 道場（bath）↔北廊下の扉（y=33、x=20〜24）。左の縁は x=320px、右の縁は x=400px
  const y0 = 33 * T, cases: [string, number, number, number, number][] = [
    ['真下へ・左の縁に掛かる', 318, y0 - 30, 0, 1], ['真下へ・右の縁に掛かる', 402, y0 - 30, 0, 1],
    ['右下へ斜め・左の縁', 290, y0 - 40, 1, 1], ['左下へ斜め・右の縁', 430, y0 - 40, -1, 1],
    ['真上へ・左の縁に掛かる（北廊下から）', 318, y0 + 16 + 30, 0, -1],
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
  ok(`撃破の演出中（揺れ${C.KO_FX.shake}秒＋大爆発${C.KO_FX.boom}秒で消えるまで）は、倒された側の視界で敵が見える。大爆発の直後は縮み始めた視界の内側（150px）なのでまだ見え、演出後（RESPAWN_BASE ${C.RESPAWN_BASE}秒）は見えない`, seen0 && seen1 && seen2 && !seen3, { seen0, seen1, seen2, seen3 });
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
  ok(`狐火: ${S.n}個がイタコの体の中心を中心に半径${S.r}の円周に出て時計回りに回る（CT はまだ）`, fb().length === S.n && fb().every((e: any) => Math.abs(Math.hypot(e.x - z.A.x, e.y - (z.A.y - bodyUp())) - S.r) < 1e-6) && a1.every((v: number, i: number) => Math.abs(v - a0[i] - S.spin * 0.1) < 1e-6) && z.A.skillReadyAt === ready0);
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
  const l = mk('itako', 'sayo'); Object.assign(l.B, { x: 1552 + 150, hp: 9999 }); l.r.skill('a'); l.r.skill('a'); for (let i = 0; i < 20; i++) { l.r.now += 0.05; l.r.updateEnts(0.05); }
  l.B.alive = false; const homing = ents(l.r, 'foxfire').filter((f: any) => f.mode === 'home').length; for (let i = 0; i < 80; i++) { l.r.now += 0.05; l.r.updateEnts(0.05); }
  ok('飛行中に標的が倒れたら直進して寿命・壁で消える（離れる前の火の玉は消える）', homing > 0 && ents(l.r, 'foxfire').length === 0);
  // itako2: 追尾はイタコの近くでしか働かない（標的を選ぶ範囲 range・今のイタコからの leash・追尾を始めてからの距離 homeRange・イタコが倒れたら消える）
  const R = C.PLAYER_RADIUS, one = Math.round(S.homeDmg * C.DAMAGE_MULT);
  const launch = (bx: number) => { const z = mk('itako', 'sayo'); Object.assign(z.B, { x: 1552 + bx, y: 900, hp: 9999 }); z.r.skill('a'); tick(z, 0.2); z.r.skill('a'); return z; };
  const outR = launch(S.range + R + 5), inR = launch(S.range + R - 5);
  ok(`itako2: 標的を選ぶ範囲は ${S.range}px（＋相手の半径）。外の敵には再発動しても追尾しない、内側なら追尾する`, S.range === 180
    && ents(outR.r, 'foxfire').every((f: any) => f.mode === 'orbit' && !f.tgt) && outR.A.skillReadyAt <= outR.r.now
    && ents(inR.r, 'foxfire').every((f: any) => f.tgt === 'p:b'));
  // 追尾中、イタコが標的と反対へ、標的はイタコから離れる向きへ、どちらも 170px/秒で動く → 今のイタコから leash より離れて消える（命中しない）。leash・homeRange の確認は壁なし（壁で消えるのと区別する）
  const runAway = (z: any, sec: number, move: (i: number) => void) => {
    const last = new Map<number, { went: number; d: number }>();
    for (let i = 0; i < Math.round(sec / 0.05); i++) {
      move(i); z.r.now += 0.05; z.r.updateEnts(0.05);
      const c = z.r.bodyOf(z.A);
      for (const f of ents(z.r, 'foxfire')) if (f.mode === 'home') last.set(f.id, { went: f.went, d: Math.hypot(f.x - c.x, f.y - c.y) });
    }
    return [...last.values()];
  };
  const lz = launch(170); lz.r.walls = []; const lw = runAway(lz, 3.5, () => { lz.A.x -= 170 * 0.05; lz.B.x += 170 * 0.05; });
  ok(`itako2: 追尾中にイタコが標的と反対へ動き、${S.leash}px より離れたら消える（命中しない）`, S.leash === 260 && lw.length === S.n && ents(lz.r, 'foxfire').length === 0 && lz.B.hp === 9999
    && lw.every((x) => x.went < S.homeRange && x.d > S.leash - S.homeSpeed * 0.05), lw);
  // イタコは動かず、標的がイタコのまわりを火の玉より速く回って逃げ続ける（leash の内側）→ 追尾を始めてから homeRange 進んで消える
  const rz = launch(150); rz.r.walls = []; const cx = rz.A.x, cy0 = rz.A.y; let ang = 0; // 狐火の周回と逆向きに回る（全弾が順に円から離れる）
  const rw = runAway(rz, 3.5, () => { ang -= (420 / 150) * 0.05; Object.assign(rz.B, { x: cx + Math.cos(ang) * 150, y: cy0 + Math.sin(ang) * 150 }); });
  ok(`itako2: イタコが動かず、標的が逃げ続けて ${S.homeRange}px 進んでも当たらなければ消える`, S.homeRange === 360 && rw.length === S.n && ents(rz.r, 'foxfire').length === 0 && rz.B.hp === 9999
    && rw.every((x) => x.went >= S.homeRange - S.homeSpeed * 0.05 && x.d <= S.leash), rw);
  // 追尾中にイタコが倒れたら消える
  const dz = launch(170); let homed = 0;
  for (let i = 0; i < 40 && !homed; i++) { dz.r.now += 0.05; dz.r.updateEnts(0.05); homed = ents(dz.r, 'foxfire').filter((f: any) => f.mode === 'home').length; }
  dz.A.alive = false; const hpD = dz.B.hp; dz.r.now += 0.05; dz.r.updateEnts(0.05);
  ok('itako2: 追尾中にイタコが倒れたら消える', homed > 0 && ents(dz.r, 'foxfire').length === 0 && dz.B.hp === hpD, { homed });
  // 近くの標的には今までどおり命中する（1発 homeDmg 15 × 全体の倍率）
  const nz = launch(100); for (let i = 0; i < 60; i++) { nz.r.now += 0.05; nz.r.updateEnts(0.05); }
  ok(`itako2: 近くの標的には今までどおり全弾命中（1発 homeDmg ${S.homeDmg} × 全体の倍率 ${C.DAMAGE_MULT} = ${one}）`, S.homeDmg === 15 && 9999 - nz.B.hp === S.n * one && ents(nz.r, 'foxfire').length === 0, { dmg: 9999 - nz.B.hp });
  // 当たりは相手の体の中心で測る（tune3）: 体の中心が周回の円の上にいる相手には当たり、円から離れていれば当たらない。プレイヤー・アシスト・大将（2倍）とも
  const body = (kind: string, onCircle: boolean) => {
    const w = mk('itako', 'sayo'); Object.assign(w.B, { x: -999, y: -999 }); const cy = 900 - bodyUp(), gap = onCircle ? 0 : S.r;
    let o: any, up = bodyUp(), hp0 = 0, get = () => 0;
    if (kind === 'boss') { o = w.r.bosses[1]; up = bodyUp(2); Object.assign(o, { x: 1552 + S.r + gap, y: cy + up }); hp0 = o.hp; get = () => o.hp; }
    else { w.r.addPlayer('x', 1, false); o = w.r.players.get('x'); const as = kind === 'assist'; up = bodyUp(as ? C.ASSIST.scale : 1); Object.assign(o, { char: as ? 'aoyama' : 'sayo', assist: as, alive: true, x: 1552 + S.r + gap, y: cy + up, hp: 9999 }); o.st.test = NOAUTO(); hp0 = 9999; get = () => o.hp; }
    w.r.skill('a'); for (let i = 0; i < 30; i++) { w.r.now += 0.05; w.r.updateEnts(0.05); }
    return { hit: get() < hp0, feet: Math.hypot(o.x - 1552, o.y - 900) };
  };
  const res = ['player', 'assist', 'boss'].map((k) => ({ k, on: body(k, true), off: body(k, false) }));
  ok('狐火の当たりは相手の体の中心で測る: 体の中心が円の上なら当たり、離れていれば当たらない（プレイヤー・アシスト・大将）', res.every((x) => x.on.hit && !x.off.hit), res);
  const hb = mk('itako', 'sayo'); Object.assign(hb.B, { x: -999, y: -999 }); const bb = hb.r.bosses[1]; Object.assign(bb, { x: 1552 + 160, y: 900 + bodyUp(2) - bodyUp() }); const bh0 = bb.hp;
  hb.r.skill('a'); tick(hb, 0.2); hb.r.skill('a'); for (let i = 0; i < 80; i++) { hb.r.now += 0.05; hb.r.updateEnts(0.05); }
  ok('撃ち出した狐火は大将（2倍）の体の中心へ飛んで当たる', bb.hp < bh0 && ents(hb.r, 'foxfire').length === 0, { dmg: bh0 - bb.hp });
  // Bot: 近くに敵がいれば展開し、円の外の敵へ撃ち出す
  const bt = mk('itako', 'sayo'); bt.A.bot = true; bt.A.aim = C.BOT_AIM; Object.assign(bt.B, { x: 1552 + 60, hp: 1e9 });
  let deployed = false, launched = false;
  for (let i = 0; i < 200 && !launched; i++) { bt.r.now += 0.05; bt.r.updateBots(); bt.r.updatePlayers(0.05); bt.r.updateEnts(0.05); deployed ||= ents(bt.r, 'foxfire').length > 0; launched = ents(bt.r, 'foxfire').some((f: any) => f.mode !== 'orbit'); if (deployed && i === 40) Object.assign(bt.B, { x: bt.A.x + 180, y: bt.A.y }); }
  ok('Bot: 敵が近いと狐火を展開し、円の外の敵へ撃ち出す', deployed && launched);
}

console.log('--- ユーレイちゃん（壁すり抜け・ジャッジメント）');
{
  ok('ジャッジメント: 技名を変え、弾速だけ旧エンマビーム（420）の1.25倍', CHARS.yurei.skill.name === 'ジャッジメント' && CHARS.yurei.skill.speed === 420 * 1.25);
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
  // ジャッジメント: ダメージは悪行に比例、指名手配中は即死
  const beam = (bad: number, wanted = false) => {
    const z = mk('yurei', 'sayo'); Object.assign(z.B, { x: 1552 + 150, hp: 9999, bad });
    if (wanted) { z.B.hp = z.r.maxHp(z.B); z.r.updateWanted(); }
    z.r.skill('a'); for (let i = 0; i < 20; i++) { z.r.now += 0.05; z.r.updateEnts(0.05); }
    return { d: (wanted ? z.r.maxHp(z.B) : 9999) - z.B.hp, alive: z.B.alive, left: ents(z.r, 'enma').length };
  };
  const b0 = beam(0), bh = beam(C.WANTED_MIN / 2), bm = beam(C.WANTED_MIN - 0.01), bw = beam(C.WANTED_MIN, true);
  ok(`ジャッジメント: 悪行0で${S.minDmg}、悪行${C.WANTED_MIN / 2}で${S.maxDmg / 2}、閾値手前でほぼ${S.maxDmg}（全体の倍率込み ${b0.d}/${bh.d}/${bm.d}）、指名手配中は即死`,
    b0.d === Math.round(S.minDmg * C.DAMAGE_MULT) && bh.d === Math.round((S.maxDmg / 2) * C.DAMAGE_MULT) && bm.d === Math.round(S.maxDmg * ((C.WANTED_MIN - 0.01) / C.WANTED_MIN) * C.DAMAGE_MULT) && !bw.alive && b0.left === 0, { b0, bh, bm, bw });
  // 当たり判定は先頭の光弾だけ（半径 r）: 弾の通り道から少し外れた敵には当たらない
  const side = mk('yurei', 'sayo'); Object.assign(side.B, { x: 1552 + 150, y: 900 + S.r + C.PLAYER_RADIUS + 1, hp: 9999 }); side.B.st.hide = { until: Infinity, hidden: true }; side.r.skill('a'); // 照準の対象にしない（向き＝右へ直進させる） for (let i = 0; i < 20; i++) { side.r.now += 0.05; side.r.updateEnts(0.05); }
  ok('当たり判定は先頭の光弾だけ（1つの場の物、半径 r）', side.B.hp === 9999);
  // 壁で止まる
  const w = mk('yurei', 'sayo'); Object.assign(w.A, { x: 400, y: 150 }); Object.assign(w.B, { x: 480, y: 150, hp: 9999 }); w.r.skill('a'); for (let i = 0; i < 20; i++) { w.r.now += 0.05; w.r.updateEnts(0.05); }
  ok('ジャッジメントは壁で消える', w.B.hp === 9999 && ents(w.r, 'enma').length === 0);
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
  ok(`Bot 戦が最後まで動き（${r.phase}）、狐火の展開・撃ち出し・ジャッジメント・ユーレイちゃんの壁抜けが起きる`, r.phase === 'ended' && fox > 0 && home > 0 && enma > 0 && inWall > 0, { fox, home, enma, inWall, phase: r.phase });
}

console.log('--- プレイテスト2（技の照準・きりたん・ひまり）');
{
  const runE = (r: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { r.now += 0.05; r.updatePlayers(0.05); r.updateEnts(0.05); r.updateShots(0.05); } };
  // 技の向き: 技の射程で照準ルールどおりに対象を選ぶ（通常攻撃の射程外でも）。対象がいなければ向いている方向
  const aimCase = (ch: string, R: number) => {
    const z = mk(ch, 'sayo'); z.A.face = Math.PI; Object.assign(z.B, { x: 1552 + 20, y: 900 + Math.min(R - 30, 150), hp: 9999 }); // 斜め下（通常攻撃の射程外）
    const want = Math.atan2(z.B.y - z.A.y, z.B.x - z.A.x), got = z.r.skillAim(z.A, R);
    const n = mk(ch); n.A.face = Math.PI; const none = n.r.skillAim(n.A, R);
    return Math.abs(got - want) < 1e-9 && none === Math.PI;
  };
  const SK = (c: string) => CHARS[c].skill;
  const aims = { whitecul: SK('whitecul').len, yurei: SK('yurei').range, zunko: SK('zunko').range, hanamaru: SK('hanamaru').range, metan: SK('metan').len } as Record<string, number>;
  ok('技の照準: 技の射程内の対象の方向（通常攻撃の射程外でも）、対象なしは向いている方向', Object.entries(aims).every(([c, R]) => aimCase(c, R)));
  // 吹雪: 横向きでも対象へ
  const wc = mk('whitecul', 'sayo'); wc.A.face = Math.PI; Object.assign(wc.B, { x: 1552, y: 900 + 120, hp: 9999 }); wc.r.skill('a');
  ok('吹雪: 向きと違う方向（下）の対象に当たる', wc.B.hp < 9999);
  const yu = mk('yurei', 'sayo'); yu.A.face = Math.PI; Object.assign(yu.B, { x: 1552, y: 900 + 170, hp: 9999 }); yu.r.skill('a'); runE(yu.r, 1); // 170: 視界（180）の内側
  ok('ジャッジメント: 向きと違う方向（下）の対象に当たる', yu.B.hp < 9999);
  const zk = mk('zunko', 'sayo'); zk.A.face = Math.PI; Object.assign(zk.B, { x: 1552, y: 900 + 170, hp: 9999 }); zk.r.skill('a'); runE(zk.r, 1);
  ok('ずんだアロー: 向きと違う方向（下）の対象に当たる', !!zk.B.st.mochi);
  const hm = mk('hanamaru', 'sayo'); hm.A.face = Math.PI; Object.assign(hm.B, { x: 1552, y: 900 + 170, hp: 9999 }); hm.r.skill('a'); fly(hm.r);
  ok('花丸パンチ: 向きと違う方向（下）の対象に当たる', hm.B.hp < 9999);
  // きりたん: 弾数2倍（1体あたり perTarget × volleys）、発射時間は不変
  const kt = mk('kiritan', 'sayo'); Object.assign(kt.B, { x: 1552 + 150, hp: 9999 }); kt.r.skill('a'); kt.r.now += 0.2; kt.r.updatePlayers(0.05); kt.r.skill('a');
  let shots = 0; const t0 = kt.r.now; let last = t0;
  for (let i = 0; i < 40; i++) { const n = ents(kt.r, 'missile').length; kt.r.now += 0.05; kt.r.updatePlayers(0.05); const m = ents(kt.r, 'missile').length; if (m > n) { shots += m - n; last = kt.r.now; } upd(kt.r, 'missile', 0); }
  ok(`全弾斉射: 1体へ${shots}発（旧6発の2倍）、発射時間は旧と同じ（${(SK('kiritan').volleys - 1) * SK('kiritan').volleyGap}秒）`, shots === 12 && SK('kiritan').volleys === 3 && SK('kiritan').volleyGap === 0.3, { shots, span: last - t0 });
  // ひまり: CT +3秒、アシストへのダメージ半分
  ok('死神の鎌のCTは15秒（旧12＋3）', SK('himari').ct === 15);
  const hi = mk('himari'); Object.assign(hi.r.bosses[1], { x: 2400, y: 900 }); const as = hi.r.summonAssist(1, 3); Object.assign(as, { x: 1552 + 40, y: 900, hp: 9999 });
  hi.r.skill('a'); hi.A.cooldownUntil = 0; hi.r.attack('a', 0);
  ok(`死神の鎌: アシストへのダメージは半分（${9999 - as.hp} = ${SK('himari').dmg}×0.5×全体倍率）`, 9999 - as.hp === Math.round(SK('himari').dmg * 0.5 * C.DAMAGE_MULT) && 9999 - as.hp === 104, { d: 9999 - as.hp });
}

console.log('--- プレイテスト3（Botのリコール判断・撃破後の視界の絞り・アシストの撃破演出）');
{
  // 低HPのBot（陣営0、ホール）と敵（陣営1）。敵は人間（動かない）
  const lowBot = (foeHp: number, foeAt: number | null = 150) => {
    const z = mk('sayo', 'sayo'); z.A.bot = true; z.A.role = 'gather'; z.A.hp = Math.round(z.r.maxHp(z.A) * 0.2);
    if (foeAt === null) Object.assign(z.B, { x: -999, y: -999 }); else Object.assign(z.B, { x: 1552 + foeAt, y: 900 });
    z.B.hp = foeHp; return z;
  };
  const think = (z: any) => z.r.botThink(z.A, z.r.obstacles());
  const run = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; think(z); z.r.updatePlayers(0.05); } };
  // 1. 視界内に敵がいる間はリコールを始めない。溜め中に敵が見えたら中断
  const r1 = lowBot(999); think(r1); const noStart = r1.A.recallAt === null;
  Object.assign(r1.B, { x: -999, y: -999 }); think(r1); const started = r1.A.recallAt !== null;
  r1.r.now += 1; Object.assign(r1.B, { x: r1.A.x + 150, y: r1.A.y }); think(r1); const canceled = r1.A.recallAt === null;
  ok('低HPのBot: 視界内に敵がいる間はリコールを始めない／敵がいなくなれば始める／溜め中に敵が見えたら中断', noStart && started && canceled, { noStart, started, canceled });
  // 2. 残りHPの多い敵からは給湯室方向へ離れ、少ない敵には攻撃する
  const K0 = C.RECALL_ROOMS[0], kc = { x: K0.x + K0.w / 2, y: K0.y + K0.h / 2 }, dd = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
  const f = lowBot(999, 100); const fk0 = dd(f.A, kc), fb0 = dd(f.A, f.B); run(f, 1); // 100: 視界（180）の外に出るまで十分に逃げられる距離から
  const flee = { kitchen: Math.round(fk0 - dd(f.A, kc)), away: Math.round(dd(f.A, f.B) - fb0), recall: f.A.recallAt };
  const threatR = Math.min(C.BOT_AGGRO_RANGE, visionRadius('sayo')); // 脅威とみなす距離（視界の外の敵は見えないので脅威にならない）
  ok(`低HPのBot: 自分より残りHPの多い敵からは離れ、給湯室へ向かう（リコールは敵が ${threatR}px より離れて脅威なしになってから）`, flee.kitchen > 50 && flee.away > 50 && (flee.recall === null || dd(f.A, f.B) > threatR) && !f.A.lowFight, flee);
  const g = lowBot(1); g.B.st.test = NOAUTO(); delete g.A.st.test; const gb0 = dd(g.A, g.B); run(g, 1);
  ok('低HPのBot: 自分より残りHPの少ない敵には攻撃する（離れない・倒す）', g.A.lowFight && (!g.B.alive || dd(g.A, g.B) <= gb0), { fight: g.A.lowFight, foeAlive: g.B.alive, d: Math.round(dd(g.A, g.B)) });
  // 決定は BOT_FLEE_COMMIT 秒維持
  const cm = lowBot(999); think(cm); cm.B.hp = 1; cm.r.now += C.BOT_FLEE_COMMIT - 0.1; think(cm); const kept = !cm.A.lowFight; cm.r.now += 0.2; think(cm);
  ok(`低HPのBot: 攻撃・逃亡の決定は ${C.BOT_FLEE_COMMIT} 秒維持し、その後に選び直す`, kept && cm.A.lowFight);
  // 3. 直近 BOT_RECALL_SAFE 秒以内に被弾していたら始めない。経過後、脅威なしなら始める
  const h = lowBot(999, null); h.r.damagePlayer(h.A, 1, null); think(h); const hit0 = h.A.recallAt === null;
  h.r.now += C.BOT_RECALL_SAFE - 0.1; think(h); const hit1 = h.A.recallAt === null;
  h.r.now += 0.2; think(h); const hit2 = h.A.recallAt !== null;
  ok(`低HPのBot: 直近 ${C.BOT_RECALL_SAFE} 秒以内に被弾したらリコールを始めない。経過後、脅威なしなら始める`, hit0 && hit1 && hit2, { hit0, hit1, hit2 });
  const hr = lowBot(999, null); think(hr); hr.r.now += 1; hr.r.damagePlayer(hr.A, 1, null); const hrc = hr.A.recallAt === null; think(hr);
  ok('低HPのBot: 被弾で中断した直後に溜め直さない', hrc && hr.A.recallAt === null);

  // 4. 倒されたキャラの視界半径: 大爆発後に縮み RESPAWN_BASE で0。縮み中は縮んだ半径の内側の敵だけが見える
  const KF = C.KO_FX, end = KF.shake + KF.boom, R = visionRadius('sayo');
  const radii = [0, end - 0.01, end, (end + C.RESPAWN_BASE) / 2, C.RESPAWN_BASE].map((t) => eyeRadius('sayo', t));
  const mid = (end + C.RESPAWN_BASE) / 2, rMid = R * 0.5 ** 2;
  ok(`撃破後の視界半径: 大爆発（${end}秒）までは ${R}、その後 (1−t)^2 で縮み RESPAWN_BASE（${C.RESPAWN_BASE}秒）で0`, radii[0] === R && radii[1] === R && radii[2] === R && Math.abs(radii[3] - rMid) < 1e-9 && radii[4] === 0 && eyeRadius('sayo', null) === R, radii);
  const v = mk('sayo'); const me = v.A; v.r.addPlayer('f1', 1, false); v.r.addPlayer('f2', 1, false);
  const near = v.r.players.get('f1'), far = v.r.players.get('f2');
  me.rage = 0; v.r.damagePlayer(me, 1e9, null); v.r.now = me.koAt + mid;
  Object.assign(near, { x: me.x + rMid * 0.8, y: me.y, koAt: 0 }); Object.assign(far, { x: me.x + rMid * 1.2, y: me.y, koAt: 0 });
  const obs = v.r.obstacles(), inS = v.r.visibleTo(0, near.x, near.y, obs), outS = v.r.visibleTo(0, far.x, far.y, obs);
  v.r.now = me.koAt + C.RESPAWN_BASE; const after = v.r.visibleTo(0, me.x + 10, me.y, obs);
  ok(`縮み中（半径 ${Math.round(rMid)}）は内側の敵だけが見え、RESPAWN_BASE で何も見えない`, inS && !outS && !after, { inS, outS, after });
  // 5. 味方が近くにいれば、絞り中・絞り切り後も味方の視界内の敵は見え続ける
  const w = mk('sayo'); w.r.addPlayer('ally', 0, false); w.r.addPlayer('foe', 1, false);
  const ally = w.r.players.get('ally'), foe = w.r.players.get('foe');
  Object.assign(foe, { x: w.A.x + 150, y: w.A.y }); Object.assign(ally, { x: foe.x - (visionRadius('sayo') - 10), y: w.A.y }); // 敵は味方の視界の内側
  w.A.rage = 0; w.r.damagePlayer(w.A, 1e9, null); const wobs = w.r.obstacles();
  const seen = [end + 0.3, C.RESPAWN_BASE - 0.01, C.RESPAWN_BASE + 0.5].map((t) => { w.r.now = w.A.koAt + t; return w.r.visibleTo(0, foe.x, foe.y, wobs); });
  ally.alive = false; ally.koAt = -99; w.r.now = w.A.koAt + C.RESPAWN_BASE; const alone = w.r.visibleTo(0, foe.x, foe.y, wobs);
  ok('味方が近くにいれば、倒されたキャラの絞り中・絞り切り後も味方の視界内の敵は見え続ける（味方がいなければ見えない）', seen.every(Boolean) && !alone, { seen, alone });

  // 6. 倒れたアシスト: 大爆発まで players に残り（alive=false）、その後消える。演出中は攻撃・技の対象にならず、召喚数に数えない
  const as = mk('sayo', 'whitecul'); Object.assign(as.r.bosses[1], { x: 2400, y: 900 }); const A1 = as.r.summonAssist(1, 1);
  Object.assign(A1, { x: 1552 + 40, y: 900 }); as.r.damagePlayer(A1, 1e9, 'a');
  const kept0 = as.r.players.get(A1.id) === A1 && !A1.alive;
  as.r.now += end - 0.05; as.r.updatePlayers(0.05); const kept1 = as.r.players.has(A1.id);
  Object.assign(as.B, { x: -999, y: -999 }); const tgt = as.r.pickTarget(as.A); delete as.A.st.test; as.A.cooldownUntil = 0; as.r.attack('a', 0); const hp1 = A1.hp;
  as.A.skillReadyAt = 0; as.r.skill('a'); as.r.updatePlayers(0.01); const hp2 = A1.hp; // 技（サヨの技）も対象外
  const n0 = [...as.r.players.values()].filter((q: any) => q.assist && q.team === 1).length;
  const A2 = as.r.summonAssist(1, 1); const fresh = A2 !== A1 && A2.alive && A1.tier === 1;
  as.r.now += 0.1; as.r.updatePlayers(0.05); const gone = !as.r.players.has(A1.id) && as.r.players.has(A2.id);
  ok('倒れたアシスト: 大爆発まで players に残り（alive=false）、その後消える', kept0 && kept1 && gone, { kept0, kept1, gone });
  ok('倒れたアシスト: 演出中は攻撃・技の対象にならず、召喚数に数えない（新しく召喚され、レベルアップにならない）', tgt === null && hp1 === 0 && hp2 === 0 && n0 === 1 && fresh, { tgt: !!tgt, hp1, hp2, n0, fresh });
  // 弾: 倒れたアシストの撃った弾は消える
  const sh = mk('sayo'); Object.assign(sh.r.bosses[1], { x: 2400, y: 900 }); const A3 = sh.r.summonAssist(1, 1);
  sh.r.shots.push({ id: 99, kind: 'bullet', team: 1, owner: A3.id, x: 1552 + 200, y: 900, vx: -300, vy: 0, sp: 300, left: 400, dmg: 10, aa: true });
  sh.r.damagePlayer(A3, 1e9, 'a'); sh.r.updateShots(0.05);
  ok('倒れたアシストの弾は消える（いないものとして扱う）', !sh.r.shots.some((x: any) => x.id === 99));
}

console.log('--- 東北ずん子（tune1: パンチ・遠距離・誘導するずんだアロー・餅の攻撃力）');
{
  const Z = CHARS.zunko, S = Z.skill, [rg] = Z.aa;
  ok(`通常攻撃は遠距離だけ（パンチは aarange1 で試験的に削除。far ${rg.far}px は戻すとき用に残し、近い対象も遠距離で撃つ）`, Z.aa.length === 1 && rg.kind === 'shot' && rg.far === CHARS.kiritan.aa[0].far && aaMode('zunko', 30) === rg && aaMode('zunko', 200) === rg && aaMode('kiritan', 30).name === 'きりたん砲');
  ok('射程の円の半径（aaRange）: きりたん 200・ずん子 200、ほかは通常攻撃の射程のまま', aaRange('kiritan') === 200 && aaRange('zunko') === 200 && PICKABLE.filter((k) => !['kiritan', 'zunko'].includes(k)).every((k) => aaRange(k) === CHARS[k].aa[0].range));
  ok(`遠距離: CT ${rg.cd}秒（旧1.5）、弾速 ${rg.speed}（旧600）`, rg.cd < 1.5 && rg.speed! > 600);
  // ずんだアロー: 上へ歩き続ける対象を、曲がりながら追って当たる。1tickに曲がる角度は turn×dt まで
  const run = (z: any, n: number, each: () => void = () => {}) => { const angs: number[] = []; for (let i = 0; i < n; i++) { each(); const sh = z.r.shots.find((x: any) => x.kind === 'arrow'); if (sh) angs.push(Math.atan2(sh.vy, sh.vx)); z.r.now += 0.05; z.r.updateShots(0.05); } return angs; };
  const turns = (a: number[]) => a.slice(1).map((x, i) => Math.abs(Math.atan2(Math.sin(x - a[i]), Math.cos(x - a[i]))));
  const h = mk('zunko', 'sayo'); h.B.st.test = NOAUTO(); Object.assign(h.B, { x: 1552 + 260, y: 900, hp: 9999 });
  h.r.addPlayer('eye', 0, false); Object.assign(h.r.players.get('eye'), { x: 1552 + 200, y: 900, alive: true }); h.r.players.get('eye').st.test = NOAUTO(); // 対象を自陣営の視界に入れる味方（ずん子の視界 180 の外の対象を追う確認のため）
  h.r.skill('a');
  const ah = run(h, 12, () => { h.B.y -= 9; }), th = turns(ah), maxT = Math.max(...th);
  ok(`ずんだアロー: 弾速${S.arrowSpeed}で、動く対象を曲がりながら追って当たる（1tickの旋回は ${(S.turn * 0.05 * 180 / Math.PI).toFixed(1)}° まで、毎秒${(S.turn * 180 / Math.PI).toFixed(0)}°）`, !!h.B.st.mochi && maxT > 0.01 && maxT <= S.turn * 0.05 + 1e-9 && Math.hypot(h.r.shots[0]?.vx ?? S.arrowSpeed, 0) > 0, { mochi: !!h.B.st.mochi, maxTurnDeg: maxT * 180 / Math.PI });
  // 急な切り返し（対象が真後ろへ）は追えない
  const b = mk('zunko', 'sayo'); b.B.st.test = NOAUTO(); Object.assign(b.B, { x: 1552 + 150, y: 900, hp: 9999 }); b.r.skill('a'); run(b, 1); Object.assign(b.B, { x: 1552 - 60, y: 900 + 60 });
  const ab = run(b, 20), tb = turns(ab);
  ok('旋回の上限を超える切り返し（真後ろへ回り込む）は追えず外れる', !b.B.st.mochi && Math.max(...tb) <= S.turn * 0.05 + 1e-9, { maxTurnDeg: Math.max(...tb) * 180 / Math.PI });
  // 対象が倒れたら直進
  const o = mk('zunko', 'sayo'); o.B.st.test = NOAUTO(); Object.assign(o.B, { x: 1552 + 300, y: 900 + 150 }); o.r.skill('a'); run(o, 2); o.r.damagePlayer(o.B, 1e9, 'a'); const ao = run(o, 4);
  ok('対象が倒れたら（対象にならなくなったら）直進する', ao.length > 1 && turns(ao).every((x) => x < 1e-9), { n: ao.length });
  // 餅の間は与えるダメージ ×atk（通常攻撃・技とも）
  const m = mk('sayo', 'metan'); m.B.hp = 9999; m.r.hitThing(m.A, { k: 'p', o: m.B, x: m.B.x, y: m.B.y, r: 10 }, 10); const d0 = 9999 - m.B.hp;
  m.A.st.mochi = { until: m.r.now + S.dur, speed: S.speed, noSkill: true, atk: S.atk }; m.B.hp = 9999; m.r.hitThing(m.A, { k: 'p', o: m.B, x: m.B.x, y: m.B.y, r: 10 }, 10, true); const d1 = 9999 - m.B.hp;
  const z2 = mk('zunko', 'sayo'); z2.B.st.test = NOAUTO(); Object.assign(z2.B, { x: 1552 + 100, y: 900 }); z2.r.skill('a'); run(z2, 4);
  ok(`ずんだ餅の間は与えるダメージ×${S.atk}（通常攻撃・技とも）。ずんだアローの餅に付く`, Math.abs(d1 - d0 * S.atk) <= 1 && z2.B.st.mochi?.atk === S.atk, { d0, d1 });
}

console.log('--- 自分中心の範囲は体の中心（tune2）');
{
  const up = bodyUp(), upA = bodyUp(C.ASSIST.scale);
  ok(`体の中心は足元から ${up.toFixed(1)}px 上（ドットの高さ42 × (0.85−0.5) × DOT_SCALE）、アシスト・大将は2倍`, Math.abs(up - 42 * 0.35 * C.DOT_SCALE) < 1e-9 && Math.abs(upA - up * C.ASSIST.scale) < 1e-9);
  // あいえるたん: 輪の中心＝体の中心。円の縁ちょうど（体の中心どうしの距離＝r）の味方は対象、r を少し超えたら対象外。アシスト（2倍）も体の中心で測る
  const S = CHARS.ierutan.skill, z = mk('ierutan'); z.r.fx = [];
  const ally = (id: string, x: number, y: number, assist = false) => { z.r.addPlayer(id, 0, false); const q = z.r.players.get(id); Object.assign(q, { char: assist ? 'aoyama' : 'sayo', alive: true, x, y, assist }); q.st.test = NOAUTO(); return q; };
  const cy = 900 - up, e1 = ally('e1', 1552 + S.r, 900), e2 = ally('e2', 1552 - S.r - 0.5, 900), a1 = ally('a1', 1552, cy - S.r + upA - 1, true), a2 = ally('a2', 1552, 900 + S.r - 1 + upA - up, true);
  z.r.skill('a'); const f = z.r.fx.find((x: any) => x.color === 'upgrade');
  ok('あいえるたんのアップグレード: 輪の中心は体の中心。縁ちょうどの味方は対象、縁の外は対象外（アシストも体の中心どうしで測る: 足元では内でも体で外なら対象外、その逆は対象）', f && f.x === 1552 && Math.abs(f.y - cy) < 1e-9 && !!e1.st.upgrade && !e2.st.upgrade && !a1.st.upgrade && !!a2.st.upgrade, { f: f && [f.x, f.y], e1: !!e1.st.upgrade, e2: !!e2.st.upgrade, a1: !!a1.st.upgrade, a2: !!a2.st.upgrade });
  // 小夜の舞: 大将（2倍）も体の中心で測る。輪は体の中心
  const sy = mk('sayo'); sy.r.fx = []; const R = CHARS.sayo.skill.r, b = sy.r.bosses[1], bu = bodyUp(2);
  Object.assign(b, { x: 1552, y: 900 - up + bu + R + C.BOSS_RADIUS - 1 }); const bh = b.hp; sy.r.skill('a'); sy.r.now += 0.01; sy.r.updatePlayers(0.05);
  const sf = sy.r.fx.find((x: any) => x.color === 'dance');
  ok('小夜の舞: 範囲と輪は体の中心（大将も体の中心で測り、足元の距離では外でも当たる）', sf && Math.abs(sf.y - (900 - up)) < 1e-9 && b.hp < bh && Math.hypot(b.x - 1552, b.y - 900) > R + C.BOSS_RADIUS, { ring: sf && sf.y, hit: b.hp < bh });
  // 輪の見た目だけのもの: もち子の発射・ウルト・罰・回復アイテム・帰還の回復、ひまりの扇、青山の回復の輪 も体の中心
  const u = mk('sayo'); u.r.fx = []; u.r.giveUlt(u.A, 1); const uf = u.r.fx.find((x: any) => x.color === 'ult');
  const pn = mk('sayo'); pn.r.fx = []; pn.r.penalty(0); const pf = pn.r.fx.find((x: any) => String(x.color).startsWith('pen_') && Math.abs(x.x - pn.A.x) < 1e-9);
  ok('ウルト・罰の輪は体の中心', uf && Math.abs(uf.y - (u.A.y - up)) < 1e-9 && (!pf || Math.abs(pf.y - (pn.A.y - up)) < 1e-9), { ult: uf && uf.y, pen: pf && pf.y });
}

console.log('--- 近接AAの巻き戻し判定（lagcomp1）');
{
  // 追いかけ: 攻撃側 281px/秒・相手 187px/秒で同じ向き（右）。今の距離は近接の届く距離の外、画面の時刻（0.1秒＋通信遅延0.05秒前）の相手の位置なら届く
  const chase = (rewind: boolean, human = true) => {
    const z = mk('sayo', 'metan'); delete z.A.st.test; z.A.bot = !human; z.B.hp = 9999; Object.assign(z.A, { x: 1360, y: 900 }); Object.assign(z.B, { x: 1360 + 75 - 187 * 0.5 + 281 * 0.5, y: 900 });
    z.A.cooldownUntil = 1e9; // 追いかけている間は攻撃しない
    for (let i = 0; i < 10; i++) { z.r.elapsed += 0.05; z.A.x += 281 * 0.05; z.B.x += 187 * 0.05; z.r.recordHist(); }
    const gapNow = z.B.x - z.A.x;
    z.A.viewT = rewind ? z.r.elapsed - (C.NET_INTERP_DELAY + 0.05) : undefined; z.A.cooldownUntil = 0;
    z.r.updatePlayers(0.05); // 入力なし（その場で）: 対象選び → 近接AA
    return { hit: z.B.hp < 9999, gapNow: +gapNow.toFixed(1), reach: C.ATTACK_RANGE + C.PLAYER_RADIUS };
  };
  const on = chase(true), off = chase(false), bot = chase(true, false);
  ok(`追いかけ（攻撃側281・相手187px/秒、今の距離 ${on.gapNow}px ＞ 届く距離 ${on.reach}px）: 画面の時刻（${C.NET_INTERP_DELAY}＋0.05秒前）まで巻き戻すと当たり、巻き戻さないと当たらない。Bot は巻き戻さない`, on.hit && !off.hit && !bot.hit && on.gapNow > on.reach, { on, off, bot });
  // 上限: 画面の時刻が NET_REWIND_MAX より古くても、その上限までしか戻さない
  const z = mk('sayo', 'metan'); z.r.elapsed = 5; z.A.viewT = 1; ok(`巻き戻しは最大${C.NET_REWIND_MAX}秒`, Math.abs(z.r.lagT(z.A)! - (5 - C.NET_REWIND_MAX)) < 1e-9);
  // 自分の斬撃は who を付けて送る（クライアントが画面の自キャラの位置に描く）
  const w = mk('sayo', 'metan'); w.r.fx = []; w.A.cooldownUntil = 0; w.r.attack('a', 0); const sl = w.r.fx.find((x: any) => x.kind === 'slash');
  ok('斬撃のエフェクトに攻撃した人の id を付ける（自分の斬撃は画面の自キャラの位置に描く）', sl?.who === 'a');
}

console.log('--- 九州そら（ソーラーキャノン）');
{
  const S = CHARS.sora.skill, K = S.keys as number[][], DUR = (c: number) => solarAt(c, 4), N = Math.round(DUR(5) / S.every), N30 = Math.round(DUR(30) / S.every);
  const run = (z: any, sec: number, input?: [number, number]) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; if (input) [z.A.inDx, z.A.inDy] = input; z.r.updatePlayers(0.05); } };
  const fire = (z: any, charge: number, a = 0) => { z.A.sk.charge = charge; z.A.sk.koAt = z.A.koAt; z.A.face = a; z.A.tgt = null; z.r.skill('a'); if (charge <= K[K.length - 2][0]) run(z, (Math.ceil(S.delay / 0.05 - 1e-9) - 1) * 0.05); }; // 発生の遅れ（aim1）の分を進めてから（次の tick でビームが出る）
  ok('選択画面に出る。浮遊（hover）、近接のパンチ（花丸よりダメージやや高く、間隔やや長い）', PICKABLE.includes('sora') && CHARS.sora.walk === 'hover' && aaMode('sora', null).kind === 'melee'
    && charAtk('sora') * CHARS.sora.aa[0].dmg > charAtk('hanamaru') && CHARS.sora.aa[0].cd > CHARS.hanamaru.aa[0].cd && Math.round(charAtk('sora') * CHARS.sora.aa[0].dmg) === 29, { sora: charAtk('sora') * CHARS.sora.aa[0].dmg, hanamaru: charAtk('hanamaru') });
  // チャージ: 試合開始から進む。撤退で0から、発射で0、CT 中も進む
  const c = mk('sora', 'metan'); Object.assign(c.B, { x: -999, y: -999 }); run(c, 10); const c10 = c.A.sk.charge;
  c.r.damagePlayer(c.A, 1e9, 'b'); c.r.now = c.A.respawnAt; c.r.updatePlayers(0.05); run(c, 0.05); const pKo = Math.round(solarPct(c.r.statusView(c.A).solarCharge)); run(c, 1.95); const cKo = c.A.sk.charge;
  c.A.skillReadyAt = 0; c.A.sk.charge = 40; c.A.sk.koAt = c.A.koAt; c.r.skill('a'); const c0 = c.A.sk.charge, p0 = Math.round(solarPct(c0)); run(c, S.ct - 0.5); const cCt = c.A.sk.charge, inCt = c.A.skillReadyAt > c.r.now;
  ok(`チャージ: 試合開始から進み、撤退で0から、発射で0、CT${S.ct}秒の間も進む`, Math.abs(c10 - 10) < 0.06 && Math.abs(cKo - 2) < 0.11 && c0 === 0 && inCt && Math.abs(cCt - (S.ct - 0.5)) < 0.06, { c10, cKo, c0, cCt });
  ok('技ボタンの％: 発射後・撤退後は0%', p0 === 0 && pKo === 0, { p0, pKo });
  { // ％: 30秒の総ダメージを100%。0〜5秒は比例、5秒以降は総ダメージ÷30秒の総ダメージ（威力と同じ solarAt）
    const want = (c: number) => Math.round(((c < 5 ? (c / 5) * solarAt(5, 1) : solarAt(c, 1)) / solarAt(30, 1)) * 100);
    const got = [0, 2.5, 5, 10, 20, 30, 270, 294].map((c) => ({ c, got: Math.round(solarPct(c)), want: want(c) }));
    ok('技ボタンの％: 威力と同じ補間から出る（0秒0%・30秒100%・それ以降も同じ式で100%超え）', got.every((g) => g.got === g.want) && got[0].got === 0 && got[5].got === 100 && got[7].got > got[6].got && got[6].got > 100, got);
  }
  ok('チャージの光の状態を送る（チャージ秒）', c.r.statusView(c.A).solarCharge === c.A.sk.charge);
  ok('キーフレームの間は線形補間（20秒→総ダメージ62.5）、5秒より前は5秒の値、最大は294秒', solarAt(20, 1) === 62.5 && solarAt(0, 1) === K[0][1] && solarAt(294, 2) === K[K.length - 1][2] && solarAt(400, 3) === K[K.length - 1][3]);
  // 照射秒: チャージ270秒までは0.5秒、270秒から最大（294秒）まで0.5秒→5秒へ線形に伸びる。本人が止まる時間も同じ
  ok('照射秒: チャージ270秒以下は0.5秒、270〜294秒で0.5→5秒（線形）、294秒以降は5秒', [5, 30, 100, 270].every((c) => DUR(c) === 0.5) && Math.abs(DUR(282) - 2.75) < 1e-9 && DUR(294) === 5 && DUR(400) === 5, [5, 270, 282, 294, 400].map(DUR));
  const ends = [5, 270, 282, 294].map((ch) => { const z = mk('sora'); fire(z, ch, 0); let n = 0; while (z.A.st.solar && n < 200) { run(z, 0.05); n++; } return +(n * 0.05).toFixed(2); });
  ok('照射（本人が止まる lock）はその照射秒で終わる', ends.every((e, i) => Math.abs(e - DUR([5, 270, 282, 294][i])) <= 0.051), ends);
  // 照射: 本人は止まる。向きは移動入力の方へ毎秒6度（0.5秒で3度、5秒で30度）
  const turn = (ch: number) => { const t = mk('sora'); const x0 = t.A.x; fire(t, ch, 0); run(t, DUR(ch) - 0.05, [0, 1]); const turned = t.A.sk.beam.a, moved = Math.hypot(t.A.x - x0, t.A.y - 900); run(t, 0.1); return { turned, moved, ended: !t.A.st.solar && !t.r.effect(t.A, 'lock') }; };
  const t5 = turn(5), t294 = turn(294);
  ok(`照射中は本人が止まり、移動入力の方へ毎秒${(S.turn * 180 / Math.PI).toFixed(0)}度だけ向きが変わる（0.5秒照射で約3度、5秒照射で約30度）`, t5.moved === 0 && t294.moved === 0 && Math.abs(t5.turned - Math.PI / 60) < 0.01 && Math.abs(t294.turned - Math.PI / 6) < 0.02 && t5.ended && t294.ended, { t5: t5.turned * 180 / Math.PI, t294: t294.turned * 180 / Math.PI });
  // 多段ヒット・貫通（チャージ10秒未満は爆発なし）
  const h = mk('sora', 'sayo'); h.r.addPlayer('c', 1, false); const Cc = h.r.players.get('c'); Object.assign(Cc, { char: 'sayo', alive: true, x: 1552 + 120, y: 900, hp: 9999 }); Cc.st.test = NOAUTO();
  h.r.addPlayer('d', 1, false); const D = h.r.players.get('d'); Object.assign(D, { char: 'sayo', alive: true, x: 1592, y: 900 + 30, hp: 9999 }); D.st.test = NOAUTO(); // ビームの外（爆発があれば届く距離）
  Object.assign(h.B, { hp: 9999 }); const hits: number[] = []; fire(h, 5, 0);
  for (let i = 0; i < Math.round(1 / 0.05); i++) { const b0 = h.B.hp; run(h, 0.05); if (h.B.hp < b0) hits.push(+h.r.now.toFixed(2)); }
  const per = Math.round((K[0][1] / N) * C.DAMAGE_MULT);
  ok(`ビームは多段ヒット（同じ相手へ${S.every}秒おき、${DUR(5)}秒で${N}回）でキャラを貫通する。チャージ5秒は総ダメージ${K[0][1]}（通常攻撃1発程度）`, hits.length === N && 9999 - h.B.hp === per * N && 9999 - Cc.hp === per * N, { n: hits.length, b: 9999 - h.B.hp, c: 9999 - Cc.hp });
  // 総ダメージ（ビームの合計＋爆発）はキーフレームのまま。照射秒が短いと1ヒットが大きい
  const tot = [5, 30, 270, 282, 294].map((ch) => { const z = mk('sora', 'sayo'); Object.assign(z.B, { x: 1552 + 40, y: 900, hp: 9999 }); fire(z, ch, 0); run(z, DUR(ch) + 0.1); const n = Math.round(DUR(ch) / S.every); return { ch, got: 9999 - z.B.hp, want: Math.round(solarAt(ch, 1) * C.DAMAGE_MULT), n }; });
  ok('1照射の総ダメージはキーフレームどおり（照射秒が変わっても同じ。誤差は1ヒットごとの四捨五入）', tot.every((q) => Math.abs(q.got - q.want) <= q.n / 2 + 1), tot);
  ok(`チャージ${S.boomFrom}秒未満は爆発なし（ビームの外の敵は無傷）`, D.hp === 9999 && !h.r.fx.some((f: any) => f.color === 'solar'));
  // あとから入ってきたキャラにも当たる
  const l = mk('sora', 'sayo'); Object.assign(l.B, { x: 1552 + 100, y: 900 + 80, hp: 9999 }); l.B.st.h = { until: Infinity, hidden: true }; fire(l, 5, 0); delete l.B.st.h; run(l, 0.15); const lb0 = l.B.hp; l.B.y = 900; run(l, 0.3);
  ok('ビームにはあとから入ってきたキャラにも当たる（発射の狙いにならないように隠してから出す）', lb0 === 9999 && l.B.hp < 9999);
  // 爆発: キャラごとに1回（あとから入ってきたキャラでも）、1キャラへの爆発ダメージは1照射1回
  const e = mk('sora', 'sayo'); e.r.addPlayer('c', 1, false); const E2 = e.r.players.get('c'); Object.assign(E2, { char: 'sayo', alive: true, x: 1552 + 60, y: 900, hp: 9999 }); E2.st.test = NOAUTO();
  e.r.addPlayer('d', 1, false); const E3 = e.r.players.get('d'); Object.assign(E3, { char: 'sayo', alive: true, x: 1552 + 50, y: 900 + 32, hp: 9999 }); E3.st.test = NOAUTO(); // ビームの外、B・E2 の両方の爆発の範囲
  Object.assign(e.B, { x: 1552 + 40, hp: 9999 }); e.r.fx = []; fire(e, 30, 0); run(e, 0.05); const boomFx = e.r.fx.filter((f: any) => f.color === 'solar').length;
  run(e, DUR(30)); const R30 = K[2][1], boomOne = Math.round(R30 * (1 - S.beamShare) * C.DAMAGE_MULT), beamOne = Math.round((R30 * S.beamShare / N30) * C.DAMAGE_MULT);
  ok(`チャージ${K[2][0]}秒: 当たったキャラごとに1回・射程の端で1回爆発（半径${K[2][3]}）。爆発がいくつ重なっても1キャラへは1回（${boomOne}）`, boomFx === 3 && 9999 - E3.hp === boomOne && 9999 - e.B.hp === boomOne + beamOne * N30 && 9999 - E2.hp === boomOne + beamOne * N30, { boomFx, e3: 9999 - E3.hp, b: 9999 - e.B.hp, e2: 9999 - E2.hp, boomOne, beamOne });
  const le = mk('sora', 'sayo'); Object.assign(le.B, { x: 1552 + 100, y: 900 + 80, hp: 9999 }); le.B.st.h = { until: Infinity, hidden: true }; fire(le, 30, 0); delete le.B.st.h; run(le, 0.15); le.r.fx = []; le.B.y = 900; run(le, 0.05);
  ok('途中からビームに入ってきたキャラでも爆発する', le.r.fx.some((f: any) => f.color === 'solar' && Math.abs(f.x - le.B.x) < 1e-9));
  // 壁: 壊せる壁は壊して進み、外壁で止まる。壁（長方形）ごとに1回爆発し、範囲の壁も壊す
  const w = mk('sora'); worn(w.r); Object.assign(w.A, { x: 300, y: 150 }); w.r.fx = []; const walls0 = w.r.walls; fire(w, 30, 0); run(w, 0.05);
  const wb = w.A.sk.beam, wfx = w.r.fx.filter((f: any) => f.color === 'solar').length, wbroken = w.r.broken.length, wlen = wb.len;
  run(w, DUR(30) - 0.1, [0, -1]); const rects = new Set(w.r.broken.map(([x, y]: number[]) => walls0.findIndex((o: any) => x * T >= o.x && x * T < o.x + o.w && y * T >= o.y && y * T < o.y + o.h)));
  ok(`壊せる壁（study の東壁の扉のない所、中破）は壊して進み（チャージ${K[2][0]}秒の射程${K[2][2]}px）、壁の長方形ごとに1照射1回爆発（範囲の壁も壊す）、射程の端でも1回`, wbroken > 0 && Math.abs(wlen - K[2][2]) <= 4 && wfx === wb.wallsBoomed.size + 1 && wb.wallsBoomed.size >= 1 && w.r.fx.filter((f: any) => f.color === 'solar').length <= rects.size + 1, { wbroken, wlen, wfx, walls: wb.wallsBoomed.size });
  const pe = mk('sora'); Object.assign(pe.A, { x: 248, y: 60 }); fire(pe, 294, -Math.PI / 2); run(pe, 0.05);
  ok('壊せない外壁で止まる（最大チャージでも外周の壁は壊れない）', pe.A.sk.beam.len < 60 && pe.r.broken.every(([x, y]: number[]) => !PERIMETER[y][x]), { len: pe.A.sk.beam.len });
  // 大将: ビームが当たっている間は拠点移動しない（予告・無敵も起きない）。離れたら通常どおり
  const bh = mk('sora'); Object.assign(bh.r.bosses[1], { x: 1552 + 150, y: 900, dmgAtBase: C.BOSS_MOVE_THRESHOLD - 1 }); fire(bh, 30, 0); run(bh, DUR(30) - 0.1);
  const held = !bh.r.bosses[1].moving && bh.r.warns.length === 0 && bh.r.bosses[1].dmgAtBase >= C.BOSS_MOVE_THRESHOLD;
  run(bh, 1); bh.r.hitThing(bh.A, { k: 'boss', o: bh.r.bosses[1], x: 0, y: 0, r: 0 }, 1);
  ok('ビームが当たっている間は大将の拠点移動（予告・無敵）が起きず、照射後のダメージで通常どおり始まる', held && bh.r.bosses[1].moving, { held });
  // 最大チャージ: 対角の端から撃つと、HP満タンの大将がワープせず試合終了の直前に撃破される（294・295・296秒）
  const far = { x: 72, y: 376 }; // svcA_R の大将から、外周の壁に遮られない一番遠い床（約2600px。マップの外接の対角線は約3700px）
  const res = [294, 295, 296].map((ch) => {
    const z = mk('sora'); z.r.setBossRooms(['svcA', 'svcB', 'svcC']); const b = z.r.bosses[1]; Object.assign(b, { base: 0, ...z.r.bases[1][0] });
    Object.assign(z.A, far); z.r.now = ch; fire(z, ch, Math.atan2(b.y - far.y, b.x - far.x));
    let dieAt = -1; for (let i = 0; i < 200 && z.r.phase === 'playing'; i++) { z.r.tick(0.05, false); if (b.hp <= 0 && dieAt < 0) dieAt = z.r.now; }
    return { ch, dieAt: +dieAt.toFixed(2), kind: z.r.finale?.kind, winner: z.r.winner, base: b.base, warned: z.r.warns.length, dist: Math.round(Math.hypot(b.x - far.x, b.y - far.y)) };
  });
  ok(`最大チャージ: 4分54秒〜4分56秒チャージで対角の端から撃つと、満タンの大将がワープせず試合終了（${C.MATCH_TIME}秒）の直前に撃破される`, res.every((q) => q.kind === 'boss' && q.winner === 0 && q.base === 0 && q.warned === 0 && q.dieAt > 0 && q.dieAt < C.MATCH_TIME), res);
  ok(`最大チャージの大将への合計は全倍率の後で${S.bossMax}（プレイヤーへは${K[K.length - 1][1]}）`, Math.abs(solarAt(294, 1, true) * C.DAMAGE_MULT * C.ATTACKER_BOSS_MULT - S.bossMax) < 1e-9 && solarAt(294, 1) === K[K.length - 1][1]);
  // Bot: チャージ botMin 秒以上で、ビームの線上に敵か大将がいれば撃つ
  const bt = mk('sora', 'metan'); bt.A.bot = true; Object.assign(bt.B, { x: 1552 + 200, y: 900 }); bt.A.sk.charge = S.botMin - 1; const low = bt.r.botSkillUseful(bt.A);
  bt.A.sk.charge = S.botMin + 1; const yes = bt.r.botSkillUseful(bt.A); bt.B.y = 900 + 200; const no = bt.r.botSkillUseful(bt.A);
  ok(`Bot: チャージ${S.botMin}秒以上でビームの線上に敵がいれば撃つ`, !low && yes && !no);
  ok('e2e の Bot 編成に入れない', !E2E_BOTS.includes('sora'));
}

console.log('--- アウトゲーム（常設の部屋・入室の判定・名前・BAN・/status・キック）');
{
  const room = (opt?: any) => { const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {}; const cl: any[] = []; Object.defineProperty(r, 'clients', { value: cl }); r.onCreate(opt); return r; };
  const auth = (r: any, opt: any = {}, ip = '9.9.9.9', cf?: string) => { try { return r.onAuth({}, opt, { ip, headers: new Headers(cf ? { 'cf-connecting-ip': cf } : {}) }); } catch (e: any) { return { err: e.message }; } };
  const join = (r: any, sid: string, name?: string) => { const c = { sessionId: sid, auth: auth(r, { bid: 'b' + sid }), send: (t: string, m: any) => { if (t === 's') c.got = m; }, leave: (code: number, why: string) => (c.left = [code, why]) } as any; r.clients.push(c); r.onJoin(c, { name }); return c; };
  // 常設の部屋: 空になっても残す。作り終えたら（sealed）e2e 以外の部屋は作れない
  const a = room(), b = room();
  GameRoom.sealed = true; let sealed = false; try { room(); } catch { sealed = true; } const e = room({ e2e: 'x' }); GameRoom.sealed = false;
  ok(`常設の部屋は空になっても残し（autoDispose なし）、${C.ROOMS}つ作った後は e2e の部屋しか作れない`, a.pub && !a.autoDispose && sealed && !e.pub && e.autoDispose);
  ok('/status: 部屋ごとの状態・人数（待機中）', JSON.stringify(OG.status([a, b]).rooms.map((x: any) => [x.no, x.state, x.humans, x.max])) === JSON.stringify([[1, 'waiting', 0, C.ROOM_FULL], [2, 'waiting', 0, C.ROOM_FULL]]));
  // 名前: 部品の組み合わせ（そのまま）、それ以外は付け直す、重複は末尾に番号
  const nm = OG.randomName();
  for (let i = 0; i < 3; i++) join(a, 'h' + i, nm); join(a, 'h3', 'あいうえお');
  const names = ['h0', 'h1', 'h2', 'h3'].map((id) => a.players.get(id).name);
  ok('名前: 同じ部屋で重複したら末尾に番号、部品の組み合わせでない名前はサーバーが付け直す', names[0] === nm && names[1] === nm + '2' && names[2] === nm + '3' && OG.validName(names[3].replace(/\d+$/, '')), names); // 付け直した名前が乱数で nm と重なると番号が付く
  a.sendSnapshots(); ok('名前は待機画面の名簿（roster）で送る', a.clients[0].got.roster.find((x: any) => x.id === 'h1').name === nm + '2');
  // 満員（人間 ROOM_FULL 人）・対戦中は入れない。e2e の部屋は従来どおり
  for (let i = 4; i < C.ROOM_FULL; i++) join(a, 'h' + i);
  ok(`満員（人間${C.ROOM_FULL}人）の部屋には入れない。/status は満員`, auth(a).err === 'この部屋は満員です' && OG.status([a]).rooms[0].state === 'full', auth(a));
  join(b, 'p0'); b.startMatch();
  // 観戦（spectate1）: 対戦中の常設の部屋には観戦で入る（Bot と入れ替えない）。観戦者は別枠で SPECTATOR_MAX まで
  const bots0 = [...b.players.values()].filter((p: any) => p.bot).length, s1 = join(b, 's1', nm);
  ok('対戦中の常設の部屋へ観戦で入れる（参加者にならず Bot はそのまま）。/status は対戦中・観戦者数', !b.owners.has('s1') && [...b.players.values()].filter((p: any) => p.bot).length === bots0 && OG.status([b]).rooms[0].state === 'playing' && OG.status([b]).rooms[0].humans === 1 && OG.status([b]).rooms[0].spec === 1);
  b.sendSnapshots(); ok('観戦者のスナップショット: me なし・フォグなし（全員）・実況のフォーカスと視点', s1.got.me === null && s1.got.players.length === b.players.size && s1.got.spec.view === 'all' && 'focus' in s1.got.spec);
  b.messages.spec(s1, { view: 1 }); b.sendSnapshots(); b.messages.spec(b.clients[0], { view: 'all' });
  ok('観戦者の視点「組の視界」: その組の視界の分だけ送る。参加者の視点の指定は無視', s1.got.spec.view === 1 && s1.got.players.length < b.players.size && s1.got.players.filter((p: any) => p.team === 1).length === C.TEAM_SIZE && !b.specView.has(b.clients[0].sessionId));
  for (let i = 2; i <= C.SPECTATOR_MAX; i++) join(b, 's' + i);
  ok(`観戦者は${C.SPECTATOR_MAX}人まで。超えたら「観戦席が満員です」`, auth(b).err === '観戦席が満員です' && OG.status([b]).rooms[0].spec === C.SPECTATOR_MAX);
  // 結果画面で参加者全員が「戻る」→ 観戦者を入室順に参加者へ（陣営は人数の少ない側、参加者 TEAM_SIZE×2 まで。残りは観戦のまま）
  b.beginPlay(); b.endMatch(0); b.messages.back(b.clients[0]);
  const ps = [...b.players.values()], promoted = ps.filter((p: any) => p.id.startsWith('s')).map((p: any) => p.id);
  ok('結果画面で参加者の人間全員が「戻る」→ 観戦者が入室順に参加者になる（名前つき・人数の少ない陣営へ。8人で残りは観戦）', b.phase === 'waiting' && ps.length === C.TEAM_SIZE * 2 && JSON.stringify(promoted) === JSON.stringify(Array.from({ length: C.TEAM_SIZE * 2 - 1 }, (_, i) => 's' + (i + 1))) && b.players.get('s1').name === nm && b.owners.get('s1') === 's1' && [0, 1].every((t) => ps.filter((p: any) => p.team === t).length === C.TEAM_SIZE) && !b.owners.has('s' + C.SPECTATOR_MAX) && OG.status([b]).rooms[0].spec === 1, promoted);
  // 参加者の人間が0人で観戦者だけ → ABANDON_SEC 秒のカウントダウン、0で打ち切って待機画面へ（観戦者は参加者に）。再接続で解除
  {
    const h = room(), q0 = join(h, 'q0'); h.startMatch(); h.beginPlay(); const w = join(h, 'w1');
    h.allowReconnection = () => {};
    const run = (sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) h.tick(0.05, false); };
    h.onDrop(q0); run(3); h.sendSnapshots(); const cnt = w.got.spec.abandon, ph = h.phase;
    h.onReconnect(q0); run(0.1); const off = h.abandonLeft;
    h.onDrop(q0); run(C.ABANDON_SEC - 1); const still = h.phase;
    h.clients.splice(h.clients.indexOf(q0), 1); h.onLeave(q0); run(1.2);
    ok(`参加者の人間が0人（再接続待ちは数えない）で観戦者だけ → ${C.ABANDON_SEC}秒のカウントダウン（観戦者に秒数を送る）。再接続で解除。0で打ち切って待機画面へ、観戦者は参加者に`, ph === 'playing' && cnt === C.ABANDON_SEC - 3 && off === null && still === 'playing' && h.phase === 'waiting' && h.owners.get('w1') === 'w1' && h.players.size === 1, { cnt, off, still, phase: h.phase });
  }
  e.startMatch(); ok('e2e の部屋は対戦中でも入れる（途中参加）', !auth(e).err);
  // メンテ中: 常設の部屋に入れない。/status にメンテ中と告知文
  OG.setMaintenance(true);
  ok('メンテ中は常設の部屋に入れず、/status にメンテ中と告知文', auth(room()).err === OG.MAINT_TEXT && OG.status([a]).maintenance && OG.status([a]).notice === OG.MAINT_TEXT);
  OG.setMaintenance(false); ok('メンテ解除で入れる', !auth(room()).err && !OG.status([a]).maintenance);
  // BAN: IP（CF-Connecting-IP 優先、なければ接続元）かブラウザ保存IDのどちらか一致で拒否（e2e の部屋も）
  OG.addBan({ ip: '1.2.3.4', bid: '', name: '', at: '' }); OG.addBan({ ip: '', bid: 'evil', name: '', at: '' });
  const f = room();
  ok('BAN: CF-Connecting-IP・接続元IP・ブラウザ保存IDのどれかが一致したら「入室できません」、他は入れる', auth(f, {}, '5.5.5.5', '1.2.3.4').err === '入室できません' && auth(f, {}, '1.2.3.4').err === '入室できません' && auth(e, { bid: 'evil' }).err === '入室できません' && !auth(f, { bid: 'ok' }, '1.2.3.4', '7.7.7.7').err);
  OG.bans.splice(0);
  // キック・BAN（管理ページ）: その人を外し、Bot が引き継ぐ（再接続させない）。BAN は以後の入室も拒否
  const g = room(), k1 = join(g, 'k1'), k2 = join(g, 'k2'); g.players.get('k2').ip = '8.8.8.8'; g.startMatch(); g.beginPlay();
  g.kick('k1', false); g.kick('k2', true);
  ok('キック・BAN: 理由つきで外す（kick / ban）。BAN は IP とブラウザ保存IDを記録して以後は入れない', k1.left?.[1] === 'kick' && k2.left?.[1] === 'ban' && OG.banned('8.8.8.8', '') && OG.banned('', 'bk2') && !OG.banned('8.8.8.9', 'bk1'));
  OG.bans.splice(0);
  // 常設の部屋は、人間が誰もいなくなったら（再接続待ちもなし）試合を打ち切って待機に戻る
  const h = room(), c = join(h, 'q'); h.startMatch(); h.beginPlay(); h.clients.splice(0); h.onLeave(c);
  ok('常設の部屋は人間が誰もいなくなったら待機に戻る（Bot だけの試合を続けない）', h.phase === 'waiting' && h.players.size === 0);
}

console.log('--- 透過壁（犬走り・サンルームの移動可能な床から検証）');
{
  const dogrun = [138 * T + 8, 20 * T + 8], sunroom = [142 * T + 8, 14 * T + 8];
  for (const [name, [ax, ay], [bx, by]] of [['犬走り→サンルーム', dogrun, sunroom], ['サンルーム→犬走り', sunroom, dogrun]] as const) {
    const { r, A, B } = mk('zunko', 'sayo');
    Object.assign(A, { x: ax, y: ay }); Object.assign(B, { x: bx, y: by });
    ok(`透過壁（${name}）: 両者は移動可能な床で壁に重ならない`, tileAt(r, ax, ay) === '.' && tileAt(r, bx, by) === '.' && clear(r, A, C.PLAYER_RADIUS) && clear(r, B, C.PLAYER_RADIUS));
    const got: any = {}; r.clients.push({ sessionId: 'c0', send: (t: string, m: any) => { if (t === 's') got.s = m; } }); r.owners.set('c0', 'a');
    r.sendSnapshots();
    const seen = r.visibleTo(0, B.x, B.y, r.seeWalls) && got.s.players.some((p: any) => p.id === 'b');
    const losBlocked = !lineOfSight(A.x, A.y, B.x, B.y, r.obstacles()) && !r.visibleTo(0, B.x, B.y, r.obstacles()); // 射線・Bot の照準（visibleTo に当たり判定の壁）
    const h0 = B.hp; delete A.st.test;
    const noTarget = r.pickTarget(A) === null;
    r.attack('a', Math.atan2(B.y - A.y, B.x - A.x));
    const fired = r.shots.length === 1; // 壁へ実際に撃つ。CT中の空振りで成功にしない
    for (let i = 0; i < 20; i++) r.updateShots(0.05);
    const m = moveBody(A.x, A.y, B.x - A.x, B.y - A.y, C.PLAYER_RADIUS, r.obstacles());
    const moved = Math.hypot(m.x - A.x, m.y - A.y);
    ok(`透過壁（${name}）: 柵越しの敵が視界に入り送られる。射線・Botの照準・弾・移動は遮る`, seen && losBlocked && noTarget && fired && r.shots.length === 0 && B.hp === h0 && moved < Math.hypot(bx - ax, by - ay) - 1, { seen, losBlocked, noTarget, fired, dmg: h0 - B.hp, moved: moved.toFixed(1) });
    // 壁の両側の近距離で近接攻撃。壁を除いた対照では命中する距離・向き
    const near = mk('sayo', 'sayo');
    const ends = [{ x: 2228, y: 315 }, { x: 2268, y: 273 }];
    if (ax > bx) ends.reverse();
    Object.assign(near.A, ends[0]); Object.assign(near.B, ends[1]);
    const aim = Math.atan2(near.B.y - near.A.y, near.B.x - near.A.x);
    ok(`透過壁（${name}）: 近接攻撃の両者も移動可能な床`, ends.every(p => tileAt(near.r, p.x, p.y) === '.') && clear(near.r, near.A, C.PLAYER_RADIUS) && clear(near.r, near.B, C.PLAYER_RADIUS));
    const hp = near.B.hp;
    near.r.attack('a', aim);
    const blocked = near.B.hp === hp;
    near.r.walls = []; near.A.cooldownUntil = 0;
    near.r.attack('a', aim);
    ok(`透過壁（${name}）: 近接攻撃を遮る（壁なしの対照では命中）`, blocked && near.B.hp < hp);
  }
  // ガラス（アトリウムの南）: 外側は誰も立てないので、視界の判定だけ確かめる（内側の床から、ガラスの外の点が見え、射線・Bot の照準は遮る）
  {
    const { r, A } = mk('zunko', 'sayo'), gx = MAP.clear.glass[Math.floor(MAP.clear.glass.length / 2)][0], gy = MAP.clear.glass[0][1];
    const ax = gx * T + 8, ay = (gy - 3) * T + 8, bx = ax, by = (gy + 2) * T + 8;
    Object.assign(A, { x: ax, y: ay });
    ok('透過壁（ガラス）: 内側の床から外の点が視界に入り、射線・Bot の照準は遮る', tileAt(r, ax, ay) === '.' && r.visibleTo(0, bx, by, r.seeWalls) && !r.visibleTo(0, bx, by, r.obstacles()) && lineOfSight(ax, ay, bx, by, r.seeWalls) && !lineOfSight(ax, ay, bx, by, r.obstacles()));
  }
  const nGlass = MAP.clear.glass.length, nFence = MAP.clear.fence.length, perim = MAP.clear.glass.every(([x, y]) => PERIMETER[y][x]);
  const solid = [...MAP.clear.glass, ...MAP.clear.fence].every(([x, y]) => C.WALLS.some((w) => x * T + 8 > w.x && x * T + 8 < w.x + w.w && y * T + 8 > w.y && y * T + 8 < w.y + w.h) && !C.SEE_WALLS.some((w) => x * T + 8 > w.x && x * T + 8 < w.x + w.w && y * T + 8 > w.y && y * T + 8 < w.y + w.h));
  ok(`ガラスは壊れない外周のまま（ガラス${nGlass}マス・柵${nFence}マス）。当たり判定の壁は柵・ガラスとも含む`, perim && solid && nGlass > 0 && nFence > 0, { perim, solid });
}

console.log('--- モダンのスロット（handoff_slot3）');
{
  (C as any).SLOT_MODE = 'modern';
  const M = C.SLOT_MODERN, G = M.game, ext = (a: number[], t: number) => (t < 4 ? a[t] : a[3] * (1 + G.lvStep * (t - 3))); // Lv4+N: Lv4 の値から +5% ずつ
  const room = () => {
    const q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; q.lock = () => {}; q.unlock = () => {}; const sent: any[] = [];
    Object.defineProperty(q, 'clients', { value: [{ sessionId: 'x', send: (t: string, m: any) => sent.push([t, m]) }] });
    q.onCreate(); q.notice = () => {}; q.startMatch(); q.beginPlay(); q.sent = sent;
    q.team0 = [...q.players.values()].filter((p: any) => p.team === 0 && !p.assist);
    return q;
  };
  const assistOf = (q: any) => [...q.players.values()].find((p: any) => p.assist && p.team === 0 && p.alive) as any;
  const pay = (q: any, group: string, first: boolean) => q.payModern(0, { group, add: (first ? M.reel.first : M.reel.ct)[group].add }, first, 1);
  // 抽選から当選まで: 次の保留を当選に差し替えて進める
  const drive = (q: any, h: any, sec = 3) => { q.teams[0].m.force(h); q.teams[1].m.rng = () => 0.999999; for (let i = 0; i < sec / 0.05; i++) { q.now += 0.05; q.updateModern(0.05); } };

  // 初当たり
  for (const [sym, lv] of [[1, 1], [7, 1], [2, 0]] as const) {
    const q = room(), dead = q.team0[3]; q.damagePlayer(dead, 1e9, null); q.teams[0].toku = 5; q.teams[0].m.rng = () => 0.999999;
    drive(q, { outcome: 'win', reels: [sym, sym, sym] });
    const a = assistOf(q), alive = q.team0.slice(0, 3), win = q.sent.find(([t]: any) => t === 'mslotWin');
    const okA = alive.every((p: any) => p.ult && !p.ult.pending && p.ult.tier === lv && p.hp === q.maxHp(p)) && dead.ult?.pending && dead.ult.tier === lv && a?.tier === lv;
    q.respawn(dead);
    ok(`初当たり（そろい目 ${sym}）: パワーアップ・アシストとも Lv${lv + 1}。パワーアップは生存者全員、撤退中の人は復活後に始まる。当選で徳 −1、フィーバータイムへ`, okA && !dead.ult.pending && Math.abs(dead.ult.until - (q.now + C.ULT_DURATION)) < 1e-9 && Math.abs(q.teams[0].toku - 4) < 0.01 && q.teams[0].m.mode === 'ct' && win?.[1].first, { tiers: alive.map((p: any) => p.ult?.tier), dead: dead.ult, assist: a?.tier, toku: q.teams[0].toku, mode: q.teams[0].m.mode });
  }
  {
    const q = room(); q.summonAssist(0, 2); const a = assistOf(q); a.hp = 50; const mx0 = q.maxHp(a);
    pay(q, 'odd', true);
    ok('初当たりでアシストが今いれば、そのアシストに当たりのレベル分（奇数は+2）のレベルアップと耐久の追加（全回復しない）', a.tier === 4 && assistOf(q) === a && a.hp < q.maxHp(a) && a.hp > 50, { tier: a.tier, hp: a.hp, mx0, mx: q.maxHp(a) });
  }

  // フィーバータイム中: そろい目ごとのレベル・時間・耐久
  {
    const rows: any[] = []; let good = true;
    for (const [group, add] of [['even', 0], ['odd', 1], ['seven', 2]] as const) for (const k of [0, 1, 2, 3, 4]) for (const full of [false, true]) {
      const q = room(); pay(q, 'even', true); const p = q.team0[0], a = assistOf(q);
      for (const o of q.team0) o.ult.tier = k; a.tier = k; q.teams[0].powerTier = k;
      const mxU = (t: number) => CHARS[p.char].stat.hp * C.ULT_FORMS[p.ult.form].hp * ext(C.ULT_HP_MULT, t), mxA = (t: number) => C.PLAYER_HP * C.ASSIST.hp * ext(C.POWER_MULT, t) * (C.ASSIST.units[a.char].hpMult ?? 1);
      const step = (mx: (t: number) => number, j: number) => (j < 3 ? mx(j + 1) - mx(j) : mx(3) - mx(2)); // Lv4 以降の段は Lv3→Lv4 の差
      const inc = (mx: (t: number) => number) => Array.from({ length: Math.max(1, add) }, (_, i) => step(mx, k + i)).reduce((x, y) => x + y, 0);
      p.hp = full ? mxU(k) : mxU(k) * 0.3; a.hp = full ? mxA(k) : mxA(k) * 0.3;
      const hp0 = p.hp, ahp0 = a.hp, until0 = p.ult.until;
      pay(q, group, false);
      const wantP = Math.min(mxU(k + add), hp0 + inc(mxU)), wantA = Math.min(mxA(k + add), ahp0 + inc(mxA));
      const r = p.ult.tier === k + add && a.tier === k + add && Math.abs(p.ult.until - until0 - G.ultAdd) < 1e-9 && Math.abs(p.hp - wantP) < 1e-6 && Math.abs(a.hp - wantA) < 1e-6 && p.hp <= q.maxHp(p) + 1e-9 && a.hp <= q.maxHp(a) + 1e-9 && Math.abs(q.maxHp(p) - mxU(k + add)) < 1e-6;
      if (!r) good = false;
      if (!full) rows.push({ group, from: k + 1, to: k + add + 1, addU: +(p.hp - hp0).toFixed(2), addA: +(a.hp - ahp0).toFixed(2) });
    }
    ok('フィーバータイム中: 偶数＝レベルそのまま、奇数＝+1、7＝+2（両方に同じ）。時間+10秒。耐久＝上がった先と今の最大値の差（偶数は次の1段分、Lv4以降は Lv3→Lv4 の差、7 は2段分）。上限を超えず、減っていた分は持ち越す', good, rows);
    const q = room(); pay(q, 'even', true); for (const o of q.team0) o.ult.tier = 3; q.teams[0].powerTier = 3; const p = q.team0[0];
    const mx4 = q.maxHp(p); pay(q, 'odd', false); const mx5 = q.maxHp(p);
    const w = mk('sayo', 'metan'); w.r.payModern(0, { group: 'even', add: 1 }, true, 1); Object.assign(w.A.ult, { tier: 3, form: 'melee' }); w.B.hp = 1e6; w.r.attack('a'); const d4 = 1e6 - w.B.hp; w.A.ult.tier = 4; w.A.cooldownUntil = 0; w.r.now += 1; w.B.hp = 1e6; w.r.attack('a'); const d5 = 1e6 - w.B.hp;
    ok(`Lv4+N: 1段ごとにシールド（最大値）・攻撃を Lv4 の値から +${G.lvStep * 100}%`, Math.abs(mx5 / mx4 - (1 + G.lvStep)) < 1e-9 && Math.abs(d5 / d4 - (1 + G.lvStep)) < 0.02, { mx4, mx5, d4, d5 });
  }
  {
    const q = room(), [p0, p1, , p3] = q.team0; q.damagePlayer(p3, 1e9, null); pay(q, 'odd', true); p1.ult = null; const pend = !!p3.ult?.pending;
    pay(q, 'odd', false); q.now += 1; q.respawn(p3);
    ok('フィーバータイム中: パワーアップが切れた味方は陣営のレベルで新たにパワーアップ、撤退中の人は戻ってから（時間+10秒は持ち越す）', pend && p0.ult.tier === 2 && p1.ult && p1.ult.tier === 2 && !p1.ult.pending && p1.hp === q.maxHp(p1) && !p3.ult.pending && p3.ult.tier === 2 && Math.abs(p3.ult.until - (q.now + C.ULT_DURATION + G.ultAdd)) < 1e-9, { p0: p0.ult.tier, p1: p1.ult, p3: p3.ult });
  }
  {
    const q = room(); pay(q, 'odd', true); const a = assistOf(q); q.damagePlayer(a, 1e9, null);
    pay(q, 'seven', false); const b = assistOf(q);
    ok('アシストが倒されていれば、フィーバータイム中の当たりで Lv1 のアシストを新しく呼ぶ（そろい目によらない）', !!b && b !== a && b.tier === 0 && b.hp === q.maxHp(b), { tier: b?.tier });
  }

  // 転落・引き戻し失敗のペナルティ
  {
    const P = G.penalty, q = room(); pay(q, 'even', true); const a = assistOf(q), [u, n1, n2, dead] = q.team0; n1.ult = null; n2.ult = null; dead.ult = null; n1.hp = q.maxHp(n1); n2.hp = q.maxHp(n2); q.damagePlayer(dead, 1e9, null);
    const hp0 = [u, n1, n2, a].map((p: any) => [p.hp, q.maxHp(p)]), sp0 = [n1, a].map((p: any) => q.speedOf(p));
    q.teams[0].m.mode = 'ct'; q.teams[0].m.rng = () => 0.999999; drive(q, { outcome: 'fall' }, 2);
    const hit = [u, n1, n2, a].every((p: any, i: number) => hp0[i][0] - p.hp === Math.round(hp0[i][1] * P.dmg)) && u.ult && !u.ult.pending;
    const slow = [n1, a].every((p: any, i: number) => Math.abs(q.speedOf(p) / sp0[i] - P.speed) < 1e-9 && Math.abs(p.weakUntil - (q.now + P.dur)) < 2.1);
    const deadOk = dead.slowUntil < q.now && dead.weakUntil < q.now;
    const until1 = n1.slowUntil;
    q.penaltyModern(0, 2);
    ok(`転落: 陣営の生存者全員とアシストに最大HPの${P.dmg * 100}%（パワーアップ中はシールドに）、攻撃×${P.atk}・移動×${P.speed}を${P.dur}秒。撤退中は対象外。重ねがけは時間の延長`, hit && slow && deadOk && q.teams[0].m.mode === 'back' && q.sent.some(([t, m]: any) => t === 'mpenalty' && m.n === 1) && Math.abs(n1.slowUntil - until1 - P.dur) < 1e-9, { hit, slow, deadOk, mode: q.teams[0].m.mode });
    const w = mk('sayo', 'metan'); w.B.hp = 1e6; w.r.attack('a'); const d1 = 1e6 - w.B.hp; w.r.penaltyModern(0, 1); w.A.cooldownUntil = 0; w.r.now += 1; w.B.hp = 1e6; w.r.attack('a');
    ok(`ペナルティの攻撃ダウン ×${P.atk}`, Math.abs((1e6 - w.B.hp) / d1 - P.atk) < 0.03, { d1, d2: 1e6 - w.B.hp });
    const n = q.sent.filter(([t]: any) => t === 'mpenalty').length, n2b = q.sent.filter(([t, m]: any) => t === 'mpenalty' && m.n === 2).length, hpB = n1.hp;
    for (let i = 0; i < (M.backSpins * M.interval.back + 1) / 0.05; i++) { q.now += 0.05; q.updateModern(0.05); }
    ok('引き戻し失敗（30回外れ）: もう一度ペナルティ（陣営全員とアシスト）→ 通常へ', q.teams[0].m.mode === 'normal' && q.sent.filter(([t, m]: any) => t === 'mpenalty' && m.n === 2).length === n2b + 1 && q.sent.filter(([t]: any) => t === 'mpenalty').length === n + 1 && n1.hp < hpB, { mode: q.teams[0].m.mode });
  }

  // コバコ撃破
  {
    const { r, A } = mk('sayo'); r.spawnCourier(); const c = r.couriers[0]; Object.assign(c, { x: A.x + 30, y: A.y }); r.teams[0].toku = 5; A.aim = 'courier'; delete A.st.test; A.cooldownUntil = 0;
    r.hitThing(A, { k: 'c', o: c, x: c.x, y: c.y, r: C.PLAYER_RADIUS }, 10, true);
    const m = r.teams[0].m, flag = m.nextHigh, items = r.items.length; m.rng = () => 0.999999; m.step(M.interval.normal + 1e-6);
    ok(`コバコ撃破: 荷物の代わりに次の保留が高確率保留（倒した陣営）。徳 ${G.courierToku}（クラシックの −1.5 の置き換え）`, flag && items === 0 && m.holds.filter((h: any) => h.high).length === 1 && Math.abs(r.teams[0].toku - (5 + G.courierToku)) < 1e-9 && !r.teams[1].m.nextHigh, { toku: r.teams[0].toku, items });
  }
  {
    (C as any).SLOT_MODE = 'classic'; const q = room(); (C as any).SLOT_MODE = SLOT_MODE0;
    ok('クラシックに切り替えると、モダンのスロットを作らずクラシック（保留つき）が回る', q.teams.every((t: any) => t.m === null && t.slot.holds.length === M.holds) && !q.modern);
  }
}

console.log('--- クラシックのスロット（保留・演出。handoff_tune5）');
{
  const M = C.SLOT_MODERN;
  const room = () => {
    const q: any = new (GameRoom as any)(); q.setSimulationInterval = () => {}; q.lock = () => {}; q.unlock = () => {}; const sent: any[] = [];
    Object.defineProperty(q, 'clients', { value: [{ sessionId: 'x', send: (t: string, m: any) => sent.push([t, m, q.now]) }] });
    q.onCreate(); q.notice = () => {}; q.startMatch(); q.beginPlay(); q.sent = sent; q.teams[1].slot.start = 1e9;
    return q;
  };
  const run = (q: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { q.now += 0.05; q.updateSlots(); } };
  ok('既定はクラシック（保留つき）', C.SLOT_MODE === 'classic');
  // 保留: 常に4つ。1回転ごとに先頭を消化して1つ積む。当否は積んだ時点の徳
  {
    const q = room(), sl = q.teams[0].slot; q.teams[0].toku = 10;
    for (let i = 0; i < M.holds; i++) { q.slotMiss = false; q.now += C.SLOT.spin; sl.cur = null; q.startSpin(0); } // 徳10 で積み直す
    const before = sl.holds.map((h: any) => h);
    q.teams[0].toku = 0; const got: any[] = [];
    for (let i = 0; i < M.holds; i++) { q.startSpin(0); got.push(sl.cur); }
    ok(`保留は常に${M.holds}つ。回転のたびに先頭を消化して1つ積む（積んだ時点の徳の当否のまま回る）`, got.every((h, i) => h === before[i]) && sl.holds.length === M.holds && sl.holds.every((h: any) => !before.includes(h)));
    const N = 20000, cnt = (toku: number) => { q.teams[0].toku = toku; let w = 0, p = 0; for (let i = 0; i < N; i++) { const h = q.classicHold(0); if (h.outcome === 'win') w++; if (h.outcome === 'pen') p++; } return [w / N, p / N]; };
    const res = [0, 5, 10].map(cnt), tol = (v: number) => 3 * Math.sqrt((v * (1 - v)) / N) + 0.002;
    ok(`保留の当否は旧クラシックの確率のまま（当たり ${res.map((x) => (x[0] * 100).toFixed(1)).join('/')}%・罰 ${res.map((x) => (x[1] * 100).toFixed(1)).join('/')}%、徳0/5/10）`, res.every(([w, p], i) => { const t = [0, 5, 10][i]; return Math.abs(w - slotRate(t)) < tol(slotRate(t)) && Math.abs(p - penaltyRate(t)) < tol(penaltyRate(t)); }));
    const n = q.slotSyms(0).length, hs = Array.from({ length: 4000 }, () => { q.startSpin(0); return sl.cur; }), bad = hs.filter((h: any) => h.outcome === 'win' ? !(h.reels[0] === h.reels[1] && h.reels[1] === h.reels[2] && h.reels[0] >= 1 && h.reels[0] <= n) : h.outcome === 'pen' ? h.reels.some((v: number) => v !== -1) || h.saki.length || h.act : (h.reels[0] === h.reels[1]) !== !!h.act);
    ok(`出目: 当たりは${n}絵柄の3つそろい、罰は ×××（先バレ・リーチなし）、外れはリーチのときだけ2つそろう`, bad.length === 0, bad.slice(0, 3));
  }
  // リーチ・全回転は回転の終わり（SLOT.spin 秒）を変えず、演出の秒数だけ前から
  for (const [res, act] of [['miss', 'plain'], ['win', 'allSpin'], ['miss', 'fish']] as const) {
    const q = room(); q.slotChance = 0; q.startSpin(0, res, act); const t0 = q.now; run(q, C.SLOT.spin + 0.1);
    const ev = q.sent.filter(([t, m]: any) => t === 'mslot' && m.team === 0 && m.type !== 'saki'), sec = act === 'allSpin' ? M.allSpinSec : M.reach[act].sec;
    const sp = ev.find(([, m]: any) => m.type === 'spin'), st = ev.find(([, m]: any) => m.type === 'stop');
    ok(`${act}: 演出は回転の終わりの${sec}秒前から、結果は${C.SLOT.spin}秒で出る`, !!sp && sp[1].act === act && Math.abs(sp[2] - (t0 + C.SLOT.spin - sec)) < 0.06 && Math.abs(sp[1].sec - sec) < 0.06 && !!st && Math.abs(st[2] - (t0 + C.SLOT.spin)) < 0.06 && st[1].outcome === res, ev.map(([, m, t]: any) => [m.type, +(t - t0).toFixed(2)]));
  }
  // 払い出し・罰の表示中は消化を止める
  {
    const q = room(), sl = q.teams[0].slot; q.slotChance = 1;
    q.startSpin(0, 'win'); run(q, C.SLOT.spin + 0.05); const h0 = [...sl.holds]; run(q, C.SLOT.gap * 2);
    const stopped = sl.payoutAt !== null && sl.holds.every((h: any, i: number) => h === h0[i]) && q.classicView(sl).cur === null && q.classicView(sl).chain >= 2;
    const p = room(), pl = p.teams[0].slot; p.startSpin(0, 'pen'); run(p, C.SLOT.spin + 0.05); const p0 = [...pl.holds]; run(p, C.SLOT.penHold - 0.2);
    const held = pl.holdUntil > 0 && pl.holds.every((h: any, i: number) => h === p0[i]); run(p, 0.3);
    ok('チャンスアップのカットイン・罰の出目の表示中は保留の消化を止める（終わったら次の回転）', stopped && held && pl.holdUntil === 0 && pl.cur !== null && pl.start > C.SLOT.spin, { stopped, held });
  }
  // 先バレは積んだ時点で本人（見せる対象のプレイヤーの画面）だけへ。表示は保留4つと回っている保留。先バレの印は見る人ごと
  {
    const q = room(), me = q.slotPlayers(0)[0].id, other = q.slotPlayers(0)[1].id; q.owners.set('x', me); let sk = 0, mine = 0, bad = 0;
    for (let i = 0; i < 20000; i++) { q.sent.length = 0; q.startSpin(0); const h = q.teams[0].slot.holds.at(-1), got = q.sent.some(([t, m]: any) => t === 'mslot' && m.type === 'saki'); if (h.saki.includes(me)) mine++; if (got) sk++; if (got !== h.saki.includes(me)) bad++; }
    const sl = q.teams[0].slot; sl.holds[0].saki = [me];
    const v = q.classicView(sl, me), vo = q.classicView(sl, other);
    ok(`先バレは保留を積んだときに、見せる対象の本人にだけ通知（${sk}/20000 回）。表示: 保留${M.holds}つ・回っている保留・陣営の種類、先バレの印は本人の表示だけ`, sk > 0 && sk === mine && bad === 0 && v.kind === 'classic' && v.holds.length === M.holds && Array.isArray(v.cur) && v.holds[0][1] === 1 && vo.holds[0][1] === 0, { sk, mine, bad });
  }
  // 実況のリーチ（既存のクラシックの判定）: リーチの出目の回転で言う
  {
    const q = room(); q.startSpin(0, 'miss', 'plain');
    ok('リーチの出目は2つそろう（実況の既存のリーチの判定に乗る）', q.teams[0].slot.reels[0] === q.teams[0].slot.reels[1] && q.teams[0].slot.reels[1] !== q.teams[0].slot.reels[2]);
  }
}

console.log('--- 練習モード（handoff_practice1）');
{
  const mkP = () => {
    const r: any = new (GameRoom as any)(); r.setSimulationInterval = () => {}; r.lock = () => { r.didLock = true; }; r.unlock = () => {}; const sent: any[] = [];
    Object.defineProperty(r, 'clients', { value: [{ sessionId: 'h', send: (t: string, m: any) => sent.push([t, m]) }] });
    r.onCreate({ practice: true }); r.onAuth({}, {}, {}); r.onJoin({ sessionId: 'h' }, {}); r.sent = sent;
    r.messages.go({ sessionId: 'h' }, { char: 'kiritan' });
    return { r, me: r.players.get('h'), foe: r.players.get('foe') };
  };
  const run = (r: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) r.tick(0.05, false); };
  const { r, me, foe } = mkP();
  ok('練習: 作った本人だけ（入室で鍵、2人目は入室拒否）。一覧（/status）には常設の部屋だけ', r.didLock && r.pub === false && (() => { try { r.onAuth({}, {}, {}); return false; } catch { return true; } })() && OG.status([]).rooms.length === 0);
  ok('練習: 自キャラを選ぶだけで即開始（自分1 vs Bot1、開始演出なし）。相手は選べるキャラ・棒立ちで始まる。資材・ご飯・コバコなし', r.phase === 'playing' && r.players.size === 2 && me.char === 'kiritan' && PICKABLE.includes(foe.char) && r.foeMode === 'stand' && r.noAuto.has('foe') && foe.bot && foe.team !== me.team && !r.materials.length && !r.items.length && !r.couriers.length);
  run(r, C.MATCH_TIME + 5);
  ok('練習: 時間無制限（試合時間を過ぎても続く）・スロットは回らない・資材も出ない', r.phase === 'playing' && r.timeLeft === C.MATCH_TIME && r.teams.every((t: any) => t.slot.start === 0 && !t.slot.cur) && !r.materials.length && !r.couriers.length);
  r.damageBoss(r.bosses[1], C.BOSS_HP * 2, me);
  ok('練習: 大将は HP1 で止まり、決着しない', r.bosses[1].hp === 1 && r.phase === 'playing');
  r.messages.pr({ sessionId: 'h' }, { op: 'boss' });
  ok('練習: 大将の全快', r.bosses.every((b: any) => b.hp === C.BOSS_HP));
  r.damagePlayer(foe, 1e6, me.id, true); const ko = !foe.alive; run(r, 0.1);
  ok('練習: 撃破されたら反省なしで即復活', ko && foe.alive && foe.respawnTotal === 0 && foe.hp === r.maxHp(foe));
  ok('練習: 実況は送らない', !r.sent.some(([t]: any) => t === 'cm'));
  // 相手の動き: 棒立ちは動かず攻撃しない、攻撃なしは動くが通常攻撃・技なし
  const f = () => r.players.get('foe');
  r.messages.pr({ sessionId: 'h' }, { op: 'foe', char: 'aru' }); // 相手は近接（遠距離のキャラは射程内だと Bot でも動かないので「攻撃なしは動く」を見られない）
  const place = () => { Object.assign(f(), { x: 1928, y: 784, dx: 0, dy: 0, path: [] }); Object.assign(me, { x: 1988, y: 784, hp: 1e9 }); }; // 大将から離れた所で向かい合う（大将の攻撃を受けない）
  me.st.test = { until: Infinity, noAuto: true }; let skill = 0; const sk0 = r.skill.bind(r); r.skill = (id: string) => { if (id === 'foe') skill++; return sk0(id); };
  r.messages.pr({ sessionId: 'h' }, { op: 'mode', mode: 'stand' }); place(); f().skillReadyAt = 0; run(r, 3);
  const stood = f().x === 1928 && f().y === 784 && me.hp === 1e9 && skill === 0;
  r.messages.pr({ sessionId: 'h' }, { op: 'mode', mode: 'passive' }); place(); f().skillReadyAt = 0; run(r, 3);
  const passive = (f().x !== 1928 || f().y !== 784) && me.hp === 1e9 && skill === 0;
  r.messages.pr({ sessionId: 'h' }, { op: 'mode', mode: 'bot' }); place(); run(r, 3);
  ok('練習: 相手の動き 棒立ち（動かない・攻撃も技もなし）／攻撃なし（移動はBot・攻撃も技もなし）／通常Bot（攻撃する）', stood && passive && me.hp < 1e9, { stood, passive, hp: me.hp, skill });
  // 差し替え・パワーアップ・アシスト・選択画面へ
  r.messages.pr({ sessionId: 'h' }, { op: 'foe', char: 'sora' });
  ok('練習: 相手の差し替え（その場で入れ替え、HP満タン）', f().char === 'sora' && f().hp === r.maxHp(f()) && r.players.size === 2);
  const lv: number[] = []; for (const d of [1, 1, 1, 1, 1, -1, -1, -1, -1, -1]) { r.messages.pr({ sessionId: 'h' }, { op: 'power', who: 'me', d }); lv.push(me.ult ? me.ult.tier : -1); }
  ok(`練習: パワーアップのレベル なし〜上限（${lv.join(',')}）`, lv.join() === '0,1,2,3,3,2,1,0,-1,-1');
  r.messages.pr({ sessionId: 'h' }, { op: 'assist', side: 'mine', char: 'ritsu', tier: 2 }); r.messages.pr({ sessionId: 'h' }, { op: 'assist', side: 'mine', char: 'kurono', tier: 0 }); r.messages.pr({ sessionId: 'h' }, { op: 'assist', side: 'foe', char: 'aoyama', tier: 3 });
  const as = [...r.players.values()].filter((q: any) => q.assist).map((q: any) => [q.team === me.team ? 'mine' : 'foe', q.char, q.tier]);
  ok('練習: アシスト召喚（キャラとレベルを指定、自陣・敵陣。同じ陣営は入れ替え）', JSON.stringify(as.sort()) === JSON.stringify([['foe', 'aoyama', 3], ['mine', 'kurono', 0]]), as);
  r.messages.pr({ sessionId: 'h' }, { op: 'back' });
  ok('練習: 選択画面へ（本人だけ残して待機に戻る。相手の動きは通常Botに）', r.phase === 'waiting' && r.players.size === 1 && r.players.get('h')?.char === 'kiritan' && !r.players.get('h').ok && r.foeMode === 'bot' && !r.noAuto.has('foe'));
  r.messages.go({ sessionId: 'h' }, { char: 'zunko' });
  ok('練習: 選び直して再開（相手は改めてランダム・棒立ち）', r.phase === 'playing' && r.players.get('h').char === 'zunko' && PICKABLE.includes(r.players.get('foe').char) && r.foeMode === 'stand');
  const foes = new Set<string>(); for (let i = 0; i < 40; i++) { r.messages.pr({ sessionId: 'h' }, { op: 'back' }); r.messages.go({ sessionId: 'h' }, { char: 'kiritan' }); foes.add(r.players.get('foe').char); } // 選択画面へ → 再開を繰り返す
  ok(`練習: 相手は選べるキャラからランダム（40回で${foes.size}種）`, [...foes].every((c) => PICKABLE.includes(c)) && foes.size > 3, [...foes]);
  // 上限
  const live = [...(GameRoom as any).live].filter((x: any) => x.practice).length, made: any[] = [];
  let refused = false;
  for (let i = live; i < C.PRACTICE_ROOMS + 1; i++) { const z: any = new (GameRoom as any)(); z.setSimulationInterval = () => {}; try { z.onCreate({ practice: true }); made.push(z); } catch { refused = true; } }
  for (const z of [...made, r]) z.onDispose();
  ok(`練習: 同時に作れる部屋は ${C.PRACTICE_ROOMS} まで`, refused && live + made.length === C.PRACTICE_ROOMS);
  // 通常の部屋は今までどおり（Bot で4人ずつ補充、開始演出から）
  const n: any = new (GameRoom as any)(); n.setSimulationInterval = () => {}; Object.defineProperty(n, 'clients', { value: [] }); n.onCreate({ e2e: 'x' }); n.addPlayer('a', 0, false); n.startMatch();
  ok('通常の部屋: Bot で補充して開始演出から（練習の分岐に入らない）', !n.practice && n.players.size === C.TEAM_SIZE * 2 && n.phase === 'intro' && n.materials.length > 0 && n.couriers.length === 1);
  n.onDispose();
}

console.log('--- 技の矢印照準・そらの弾速・きりたん弾の射程・もち子のファンネル（aim1）');
{
  const ang = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  // 人間 A（陣営0）、敵 B は東 60px（自動照準の向き＝0）。cl は A のクライアント
  const human = (char: string) => { const z: any = mk(char, 'metan'); z.cl = { sessionId: 'a' }; z.r.owners.set('a', 'a'); z.A.tgt = null; Object.assign(z.B, { x: 1552 + 60, y: 900, hp: 9999 }); return z; };
  const run = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); z.r.updateShots(0.05); z.r.updateEnts(0.05); } };
  const S90 = Math.PI / 2;
  // 吹雪・ジャッジメント・ソーラーキャノン: 離した時の向き
  const wc = human('whitecul'); wc.r.fx = []; wc.r.messages.skillUp(wc.cl, { a: S90 }); const wcFx = wc.r.fx.find((f: any) => f.color === 'blizzard');
  const wcAuto = human('whitecul'); wcAuto.r.fx = []; wcAuto.r.messages.skillUp(wcAuto.cl, {}); const wcAutoFx = wcAuto.r.fx.find((f: any) => f.color === 'blizzard');
  ok('吹雪: 離した時の矢印の向きに出る（東の敵には当たらない）。向きなし（矢印を動かしていない）は自動照準の向き', wcFx?.a === S90 && wc.B.hp === 9999 && wcAutoFx && ang(wcAutoFx.a, 0) < 1e-9 && wcAuto.B.hp < 9999, { a: wcFx?.a, auto: wcAutoFx?.a });
  const yu = human('yurei'); yu.r.messages.skillUp(yu.cl, { a: -S90 }); const enma = ents(yu.r, 'enma')[0];
  ok('ジャッジメント: 離した時の矢印の向きに撃つ', enma?.a === -S90);
  const so = human('sora'); so.A.sk.charge = 30; so.A.sk.koAt = so.A.koAt; so.r.messages.skillUp(so.cl, { a: Math.PI }); const beamA = so.A.sk.beam?.a;
  ok('ソーラーキャノン: 離した時の矢印の向きに照射', beamA === Math.PI);
  // ずんだアロー: 矢印の向きへ撃ち、矢印との角度差が aimCone 以内で一番近い敵を追う
  const Z = CHARS.zunko.skill, zu = human('zunko'); zu.r.addPlayer('c', 1, false); const Cz = zu.r.players.get('c'); Object.assign(Cz, { char: 'metan', alive: true, x: 1552, y: 900 + 150, hp: 9999 }); Cz.st.test = NOAUTO();
  const za = S90 + Z.aimCone * 0.4; zu.r.messages.skillUp(zu.cl, { a: za }); const arrow = zu.r.shots.find((x: any) => x.kind === 'arrow'), a0 = arrow && Math.atan2(arrow.vy, arrow.vx);
  run(zu, 0.6);
  ok(`ずんだアロー: 矢印の向きへ撃ち、角度差${(Z.aimCone * 180 / Math.PI).toFixed(0)}度以内で一番近い敵（南の敵）を追って当てる。東の敵（自動照準の対象）には当たらない`, a0 !== undefined && ang(a0, za) < 1e-9 && !!zu.r.stat(Cz, 'mochi') && !zu.r.stat(zu.B, 'mochi'), { a0 });
  const zn = human('zunko'); zn.r.messages.skillUp(zn.cl, { a: Math.PI }); const an = zn.r.shots.find((x: any) => x.kind === 'arrow'); run(zn, 0.6);
  ok('ずんだアロー: 矢印の先に敵がいなければ直進（東の敵には曲がらない）', an && ang(Math.atan2(an.vy, an.vx), Math.PI) < 1e-9 && !zn.r.stat(zn.B, 'mochi'));
  // アル: 離して確定 → タメ。タメ中の押し直し（skillAim）・離し（skillUp）で向きを変えられ、突撃開始時点の向きで確定
  const AR = CHARS.aru.skill, ar = human('aru'); ar.A.inDx = 1; ar.A.inDy = 0; ar.r.messages.skillUp(ar.cl, { a: S90 }); const a1 = ar.A.sk.a, charging = !!ar.A.st.charge;
  run(ar, 0.2); ar.r.messages.skillAim(ar.cl, { a: Math.PI }); const a2 = ar.A.sk.a; run(ar, 0.2); ar.r.messages.skillUp(ar.cl, { a: -S90 }); const a3 = ar.A.sk.a, ct = ar.A.skillReadyAt;
  run(ar, AR.windup); const rush = ar.r.stat(ar.A, 'rush'), ra = rush?.view?.().a; ar.r.messages.skillUp(ar.cl, { a: 0 });
  ok('アルの突撃: 離した矢印の向きでタメ（移動入力の向きではない）。タメ中に向きを変えると、変えた向きへ突撃。突撃中は向きを変えられない', charging && a1 === S90 && a2 === Math.PI && a3 === -S90 && ra === -S90 && ar.A.sk.a === -S90 && ar.A.skillReadyAt === ct, { a1, a2, a3, ra });
  const ar2 = human('aru'); ar2.A.inDx = 0; ar2.A.inDy = 1; ar2.r.messages.skillUp(ar2.cl, {});
  ok('アルの突撃: 矢印を動かさなければ自動照準の向き（東の敵）', ang(ar2.A.sk.a, 0) < 1e-9, { a: ar2.A.sk.a });
  // 矢印の表示に使う値は本人にだけ送る
  const view = (char: string, f?: (z: any) => void) => { const z = human(char); let got: any = null; Object.defineProperty(z.r, 'clients', { value: [{ sessionId: 'a', send: (t: string, m: any) => { if (t === 's') got = m; } }] }); f?.(z); z.r.sendSnapshots(); return { me: got.players.find((p: any) => p.id === 'a'), foe: got.players.find((p: any) => p.id === 'b') }; };
  const vw = view('whitecul'), vm = view('metan'), va = view('aru', (z) => z.r.messages.skillUp(z.cl, { a: 2 })), vh = view('hanamaru', (z) => { z.A.skillReadyAt = z.r.now - 30; z.r.messages.skillUp(z.cl, { a: 1 }); });
  ok('矢印の技は本人に skA（自動照準の向き）・skR（技の射程）を送る。矢印のない技（めたん）・ほかのキャラには送らない。タメ中は今の向きと skRe', ang(vw.me.skA, 0) < 1e-9 && vw.me.skR === CHARS.whitecul.skill.len && !vw.me.skRe && vw.foe.skA === undefined && vm.me.skA === undefined && va.me.skA === 2 && va.me.skRe && vh.me.skA === 1 && vh.me.skRe, { w: vw.me.skA, a: va.me, h: vh.me.skA });
  ok('矢印の技は押した瞬間（skill のメッセージを送らない限り）には出ない: 離した時（skillUp）だけ発動。矢印のない技の skillUp は何もしない', (() => { const z = human('metan'); z.r.messages.skillUp(z.cl, { a: 1 }); return !z.r.stat(z.A, 'drill') && z.A.skillReadyAt === 0; })());

  // そら: チャージ4分30秒以下は発射から delay 秒でビームが出る。距離200で発射を見てから（反応0.25秒）射線と垂直に動いた WhiteCUL はギリギリ当たらない
  const SS = CHARS.sora.skill, KK = SS.keys as number[][];
  const dodge = (charge: number, react: number) => {
    const z: any = mk('sora', 'whitecul'); Object.assign(z.B, { x: 1552 + 200, y: 900, hp: 9999 }); z.B.st.test = NOAUTO();
    z.A.sk.charge = charge; z.A.sk.koAt = z.A.koAt; z.A.tgt = null; z.r.skill('a', 0); const t0 = z.r.now, sp = z.r.speedOf(z.B); let first = -1;
    for (let i = 0; i < 30; i++) { if (z.r.now - t0 >= react - 1e-9) z.B.y += sp * 0.05; z.r.now += 0.05; z.r.updatePlayers(0.05); if (first < 0 && z.A.sk.beam?.len > 0) first = z.r.now - t0; }
    return { hit: z.B.hp < 9999, first: +first.toFixed(3), sp };
  };
  const d0 = dodge(30, 0.25), d1 = dodge(30, 0.3), d2 = dodge(KK[KK.length - 2][0], 0.25), d3 = dodge(KK[KK.length - 2][0] + 1, 0), d4 = dodge(5, 0.25);
  ok(`ソーラーキャノン: 発射から${SS.delay.toFixed(3)}秒（0.25＋(${SS.w}/2＋${C.PLAYER_RADIUS})÷${CHARS.whitecul.stat.speed}）でビームが出る。距離200で反応0.25秒後に垂直へ動いた WhiteCUL（速さ${d0.sp}）は当たらず、0.3秒後だと当たる（チャージ5・30・270秒）`,
    Math.abs(SS.delay - (0.25 + (SS.w / 2 + C.PLAYER_RADIUS) / CHARS.whitecul.stat.speed)) < 1e-12 && CHARS.whitecul.stat.speed === 187 && !d0.hit && d1.hit && !d2.hit && !d4.hit && Math.abs(d0.first - 0.35) < 1e-9, { d0, d1, d2, d4 });
  ok(`ソーラーキャノン: チャージ${KK[KK.length - 2][0]}秒を超えた発射は今どおり発射時点で終端まで届く（動いても当たる）`, d3.hit && d3.first === 0.05, d3);
  const sd = mk('sora'); sd.A.sk.charge = 30; sd.A.sk.koAt = sd.A.koAt; sd.r.skill('a', 0); const t0 = sd.r.now; let end = -1; for (let i = 0; i < 40 && end < 0; i++) { sd.r.now += 0.05; sd.r.updatePlayers(0.05); if (!sd.A.st.solar) end = sd.r.now - t0; }
  ok(`ソーラーキャノン: 照射秒（${solarAt(30, 4)}秒）はビームが出てから数える（本人が止まるのは遅れ＋照射秒）`, Math.abs(end - (SS.delay + solarAt(30, 4))) <= 0.051, { end });
  // 発生の遅れの間は射線の予兆（view の pre＝発射時の射程）。ビームが出たら0。遅れなしの発射は最初から0
  const pre = (charge: number) => { const z: any = mk('sora'); z.A.sk.charge = charge; z.A.sk.koAt = z.A.koAt; z.r.skill('a', 0); const at0 = z.r.statusView(z.A).solar.pre; let n = 0; while (z.r.statusView(z.A).solar.pre && n < 40) { z.r.now += 0.05; z.r.updatePlayers(0.05); n++; } return { at0, gone: +(n * 0.05).toFixed(2), len: z.A.sk.beam.len }; };
  const p30 = pre(30), pMax = pre(KK[KK.length - 2][0] + 1);
  ok(`ソーラーキャノン: 発生の遅れの間は射線の予兆（長さ＝発射時の射程 ${solarAt(30, 2)}）を送り、ビームが出ると消える。遅れなしの発射では出さない`, p30.at0 === solarAt(30, 2) && Math.abs(p30.gone - Math.ceil(SS.delay / 0.05 - 1e-9) * 0.05) < 1e-9 && p30.len > 0 && pMax.at0 === 0, { p30, pMax });

  // きりたん: ロック射程200。弾はきりたんから homeMax 以上で直進、vanish 以上で消える
  const KS = CHARS.kiritan.skill;
  const lock = (d: number) => { const z = mk('kiritan', 'metan'); Object.assign(z.B, { x: 1552 + d, y: 900 }); z.r.skill('a'); run(z, 0.2); return z.A.sk.marks.length; };
  ok(`全弾斉射: ロック射程${KS.range}（190px はロック、${KS.range + C.PLAYER_RADIUS + 5}px はしない）`, KS.range === 200 && lock(190) === 1 && lock(KS.range + C.PLAYER_RADIUS + 5) === 0);
  const mis = (d: number) => { const z = mk('kiritan', 'metan'); Object.assign(z.B, { x: 1552, y: 900 + 150, hp: 9999 }); const e: any = { id: 9999, kind: 'missile', team: 0, owner: 'a', x: 1552 + d, y: 900, r: KS.r, body: null, tgt: 'p:b', pat: 'straight', side: 1, a0: 0, a: 0, t: 1, vx: 0, vy: 0 }; z.r.ents.push(e); upd(z.r, 'missile', 0.01); return { orphan: !!e.orphan, alive: z.r.ents.includes(e), a: e.a }; };
  const m1 = mis(KS.homeMax - 5), m2 = mis(KS.homeMax + 5), m3 = mis(KS.vanish + 1);
  ok(`全弾斉射の弾: きりたんから${KS.homeMax}px 未満は追尾、以上は直進（向きを変えない）、${KS.vanish}px 以上で消える`, KS.homeMax === 200 && KS.vanish === 250 && !m1.orphan && m1.alive && m1.a !== 0 && m2.orphan && m2.alive && m2.a === 0 && !m3.alive, { m1, m2, m3 });
  {
    const z = mk('kiritan', 'metan'); Object.assign(z.B, { x: 1552 + 150, y: 900, hp: 9999 }); z.r.skill('a'); run(z, 0.1); z.r.skill('a'); run(z, 0.1);
    const n0 = ents(z.r, 'missile').length; z.A.x -= 400; run(z, 0.05); const n1 = ents(z.r, 'missile').length;
    ok('全弾斉射の弾: きりたん本人（その時点の位置）からの距離で消える（撃った後にきりたんが離れると消える）', n0 > 0 && n1 === 0, { n0, n1 });
  }

  // もち子: 攻撃した瞬間にもち子から leash 以上離れていたファンネルは、その攻撃の直後に消える。未満は今どおり残る
  const F = CHARS.mochiko.skill, mo = mk('mochiko', 'metan'); Object.assign(mo.B, { x: 1552 + 230, y: 900, hp: 9999 }); mo.r.skill('a');
  const shots: { f: any; d: number }[] = [], fx0 = mo.r.addFx.bind(mo.r);
  mo.r.addFx = (o: any, color: string, extra: any) => { if (color === 'beam' && o.kind === 'funnel') shots.push({ f: o, d: Math.hypot(o.x - mo.A.x, o.y - mo.A.y) }); return fx0(o, color, extra); };
  run(mo, 4);
  const far = shots.filter((q) => q.d >= F.leash), near = shots.filter((q) => q.d < F.leash);
  ok(`ファンネル: 攻撃した時にもち子から${F.leash}px 以上のものは攻撃1回で消え、未満のものは残って次の攻撃もする（遠 ${far.length} 回・近 ${near.length} 回）`, F.leash === 200 && far.length > 0 && near.length > 0 && far.every((q) => !mo.r.ents.includes(q.f)) && new Set(far.map((q) => q.f)).size === far.length && near.every((q) => shots.indexOf(q) < shots.length - 1 && shots.slice(shots.indexOf(q) + 1).some((u) => u.f === q.f)), { far: far.map((q) => Math.round(q.d)), near: near.map((q) => Math.round(q.d)) });
}

console.log('--- 自動照準は自陣営の画面に映っている敵だけ（vision1）');
{
  // ずん子（視界 180、遠距離の通常攻撃 200、ずんだアロー 300）。味方の Bot・大将の視界は遠くに外してある（mk）
  const VR = visionRadius('zunko'), at = (z: any, dx: number) => Object.assign(z.B, { x: z.A.x + dx, y: z.A.y });
  const a = mk('zunko', 'sayo'); a.A.face = Math.PI; a.A.tgt = null;
  at(a, VR + 15); const out = a.r.pickTarget(a.A), outVis = a.r.seenBy(0, { k: 'p', o: a.B, x: a.B.x, y: a.B.y, r: C.PLAYER_RADIUS });
  at(a, VR - 30); const inT = a.r.pickTarget(a.A);
  ok(`通常攻撃: 射程内でも視界（${VR}）の外の敵は狙わない（${VR + 15}px）。視界内（${VR - 30}px）なら狙う`, out === null && !outVis && inT?.o === a.B, { out: out && out.k, inT: inT && inT.k });
  // 技の矢印の最初の向き: 見えない敵の方は向かず、向いている方向（左）のまま
  at(a, 250); const v0 = a.r.arrowView(a.A); at(a, 150); const v1 = a.r.arrowView(a.A);
  ok('技の矢印の最初の向き: 射程内でも視界の外の敵には向かず向いている方向のまま。視界内なら敵へ向く', Math.abs(v0.skA - Math.PI) < 1e-9 && Math.abs(v1.skA) < 1e-9, { v0: v0.skA, v1: v1.skA });
  // 敵大将も同じ（射程内・視界外は狙わない）
  const bo = mk('zunko'); bo.A.face = Math.PI; Object.assign(bo.r.bosses[1], { x: bo.A.x + 250, y: bo.A.y }); const bv0 = bo.r.arrowView(bo.A).skA;
  Object.assign(bo.r.bosses[1], { x: bo.A.x + 150, y: bo.A.y }); const bv1 = bo.r.arrowView(bo.A).skA;
  ok('敵大将も同じ: 射程内・視界外なら向かない、視界内なら向く', Math.abs(bv0 - Math.PI) < 1e-9 && Math.abs(bv1) < 1e-9, { bv0, bv1 });
  // Bot も同じ（通常攻撃の対象を選ばず、撃たない）
  const bt = mk('zunko', 'sayo'); bt.A.bot = true; delete bt.A.st.test; bt.A.cooldownUntil = 0; at(bt, VR + 15); bt.B.hp = 1e9;
  bt.r.updatePlayers(0.05); const tgt = bt.A.tgt, shots = bt.r.shots.filter((q: any) => q.team === 0).length;
  ok('Bot: 射程内でも視界外の敵は狙わず撃たない', tgt === null && shots === 0, { tgt: tgt && tgt.k, shots });
}

console.log('--- WhiteCUL のクナイ（fb1124）');
{
  const W = CHARS.whitecul, [k] = W.aa;
  ok(`通常攻撃はクナイ（遠距離）: 射程 ${k.range}（吹雪の長さと同じ）、間隔 ${k.cd}秒（近接の1.1倍）、威力の倍率 ${k.dmg}（近接と同じ）`, W.aa.length === 1 && k.name === 'クナイ' && k.kind === 'shot' && k.shot === 'kunai' && k.range === 200 && k.range === W.skill.len && Math.abs(k.cd - C.ATTACK_COOLDOWN_MELEE * 1.1) < 1e-12 && k.dmg === 1);
  const w = mk('whitecul', 'sayo'); Object.assign(w.B, { x: 1552 + 150, y: 900, hp: 9999 }); w.B.st.test = NOAUTO(); delete w.A.st.test; w.A.tgt = null;
  w.r.updatePlayers(0.05); const sh = w.r.shots.find((q: any) => q.owner === 'a'), cd0 = w.A.cooldownUntil - w.r.now;
  let t = 0; while (w.B.hp === 9999 && t < 2) { w.r.now += 0.05; t += 0.05; w.r.updateShots(0.05); }
  ok('クナイが飛んで当たる（射程200・間隔1.1秒）', !!sh && sh.kind === 'kunai' && sh.left <= 200 + 1e-9 && w.B.hp < 9999 && Math.abs(cd0 - 1.1) < 1e-9, { kind: sh?.kind, left: sh?.left, cd0, hp: w.B.hp });
}

console.log('--- ルール説明のスロットのスペック表（fb1124）');
{
  const html = (await import('node:fs')).readFileSync('public/rules.html', 'utf8');
  ok('rules.html のスロットの表が今の設定（CONFIG.SLOT）と同じ（違えば npx tsx tools/render_rules_slot.ts で作り直す）', html.includes(slotSpecHtml()));
}

console.log('--- 壁の段階破壊（walldmg1）');
{
  const tk = (r: any) => r.teams[0].toku, W = C.TOKU.wall, I = C.TOKU_INIT;
  const tick = (z: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) { z.r.now += 0.05; z.r.updatePlayers(0.05); } };
  // 段階: 1回の発動で1マス1段階、WALL_HITS 段階目で壊れる。途中は壁のまま
  const a = mk('sayo'), w0 = a.r.walls, s0 = a.r.seeWalls, h1 = new Set<number>();
  a.r.hitWalls([[12, 33]], h1); a.r.hitWalls([[12, 33]], h1);
  const one = a.r.wallStage(12, 33) === 1 && a.r.tiles[33][12] === '#' && a.r.walls === w0 && a.r.seeWalls === s0 && a.r.broken.length === 0;
  for (let i = 0; i < 400; i++) a.r.tick(0.05, false); // 20秒
  const kept = a.r.wallStage(12, 33) === 1;
  a.r.hitWalls([[12, 33]], new Set()); const two = a.r.wallStage(12, 33) === 2 && a.r.tiles[33][12] === '#';
  a.r.hitWalls([[12, 33]], new Set());
  ok(`壁の段階: 1回の発動で1マス1段階（同じ発動で何度当てても1段階）、${C.WALL_HITS}段階目で壊れて床になる。小破・中破は壁のまま（当たり判定・視界の壁は変わらない）で、時間で直らない`, one && kept && two && a.r.tiles[33][12] === '.' && a.r.broken.length === 1 && a.r.wallStage(12, 33) === 0 && JSON.stringify(a.r.crackLog) === '[[12,33,1],[12,33,2]]', { one, kept, two, log: a.r.crackLog });
  // 花丸パンチ: 無傷の壁は小破になるだけ。拳はそこで消える。3発で壊れる
  const f = mk('hanamaru'); Object.assign(f.A, { x: 200, y: 512, face: Math.PI / 2 }); f.A.tgt = null; f.r.skill('a'); fly(f.r);
  const fk = [...f.r.wallDmg.entries()];
  ok(`花丸パンチ: 無傷の壁（道場の南壁）は小破になるだけで拳はそこで消える（壁は通れないまま）。徳${W}は1回分`, f.r.broken.length === 0 && fk.length > 0 && fk.every(([k, v]) => v === 1 && Math.floor(k / MAP.width) === 33) && ents(f.r, 'fist').length === 0 && f.r.tiles[33][12] === '#' && Math.abs(tk(f.r) - (I + W)) < 1e-9, fk);
  for (let i = 0; i < 2; i++) { f.A.skillReadyAt = f.r.now; f.r.skill('a'); fly(f.r); }
  ok(`花丸パンチ: ${C.WALL_HITS}発目で壊れて通れる（徳${W}は1発ごと）`, f.r.tiles[33][12] === '.' && Math.abs(tk(f.r) - (I + W * C.WALL_HITS)) < 1e-9, { toku: tk(f.r) });
  // パッシブ: 段階に関係なく一気に壊す。徳は残っていた段階の分（範囲のマスで一番多い分）
  const pass = (st: number) => { const q = mk('hanamaru'); q.A.bot = true; q.r.tiles[33].split('').forEach((c: string, x: number) => { if (c === '#' && !PERIMETER[33][x] && st) q.r.wallDmg.set(33 * MAP.width + x, st); }); Object.assign(q.A, { x: 200, y: 33 * T - 11, dx: 0, dy: 1 }); tick(q, CHARS.hanamaru.skill.push + 0.11); return { ok: q.r.tiles[33][12] === '.' && q.r.tiles[33][11] === '.', d: +((tk(q.r) - I) / W).toFixed(6) }; };
  const pr = [0, 1, 2].map(pass), mix = mk('hanamaru'); mix.A.bot = true; mix.r.wallDmg.set(33 * MAP.width + 12, 2); mix.r.wallDmg.set(33 * MAP.width + 11, 1); Object.assign(mix.A, { x: 200, y: 33 * T - 11, dx: 0, dy: 1 }); tick(mix, CHARS.hanamaru.skill.push + 0.11); // 範囲の左の13は無傷
  ok(`花丸のパッシブ: 段階に関係なく一気に壊す。徳${W}は残っていた段階の分（無傷${C.WALL_HITS}・小破${C.WALL_HITS - 1}・中破${C.WALL_HITS - 2}回分、混ざっていれば一番多いマスの分）`, pr.every((x) => x.ok) && JSON.stringify(pr.map((x) => x.d)) === JSON.stringify([3, 2, 1]) && Math.abs(tk(mix.r) - (I + W * 3)) < 1e-9, { pr, mix: tk(mix.r) });
  // アルの突撃: 無傷の壁は小破で、体は壁で止まる（滑る）
  const z = mk('aru'); z.A.bot = true; Object.assign(z.A, { x: 248, y: 472, dx: 0, dy: 1 }); z.A.tgt = null; z.r.skill('a'); tick(z, CHARS.aru.skill.windup + CHARS.aru.skill.dur + 0.1);
  ok(`アルの突撃: 無傷の壁は小破になるだけで抜けられない（壁の手前で止まる）。徳${W}は1回分`, z.r.broken.length === 0 && z.r.wallStage(15, 33) === 1 && [...z.r.wallDmg.values()].every((v: number) => v === 1) && z.A.y < 33 * T && Math.abs(tk(z.r) - (I + W)) < 1e-9, { y: z.A.y, toku: tk(z.r) });
  // そら: 1発射で1段階（照射の多段・爆発を含めても）。チャージ keys の最後から2番目の秒数（4分30秒）を超えたら即破壊
  const SK = CHARS.sora.skill.keys as number[][], sora = (c: number) => {
    const q = mk('sora'); Object.assign(q.A, { x: 300, y: 150 }); q.A.sk.charge = c; q.A.sk.koAt = q.A.koAt; q.A.face = 0; q.A.tgt = null; q.r.skill('a');
    let L = 0; for (let i = 0; i < 200 && (q.A.sk.beam || i < 5); i++) { q.r.now += 0.05; q.r.updatePlayers(0.05); L = Math.max(L, q.A.sk.beam?.len ?? 0); }
    return { q: q.r, L };
  };
  const s30 = sora(30), s270 = sora(SK[SK.length - 2][0]), s280 = sora(SK[SK.length - 2][0] + 10), wallX = 27 * T - 300; // study の東壁までの距離
  const s280w = (() => { const q = mk('sora'); worn(q.r); Object.assign(q.A, { x: 300, y: 150 }); q.A.sk.charge = SK[SK.length - 2][0] + 10; q.A.sk.koAt = q.A.koAt; q.A.face = 0; q.A.tgt = null; q.r.skill('a'); for (let i = 0; i < 200 && (q.A.sk.beam || i < 5); i++) { q.r.now += 0.05; q.r.updatePlayers(0.05); } return q.r; })();
  ok(`そら（チャージ30秒・爆発あり）: 無傷の壁は小破になるだけ（照射の多段・爆発を含めても1段階）、ビームは壁で止まる。徳${W}は1回分`, s30.q.broken.length === 0 && s30.q.wallDmg.size > 0 && [...s30.q.wallDmg.values()].every((v: number) => v === 1) && s30.L <= wallX && Math.abs(tk(s30.q) - (I + W)) < 1e-9, { L: s30.L, n: s30.q.wallDmg.size, toku: tk(s30.q) });
  ok(`そら（チャージちょうど${SK[SK.length - 2][0]}秒）: まだ1段階`, s270.q.broken.length === 0 && [...s270.q.wallDmg.values()].every((v: number) => v === 1));
  ok(`そら（チャージ${SK[SK.length - 2][0]}秒超）: 即破壊して進む。徳${W}は残っていた段階の分（無傷の壁なら${C.WALL_HITS}回分、全部中破なら1回分）`, s280.q.broken.length > 0 && s280.q.wallDmg.size === 0 && s280.L > wallX + 32 && Math.abs(tk(s280.q) - (I + W * C.WALL_HITS)) < 1e-9 && s280w.broken.length > 0 && Math.abs(tk(s280w) - (I + W)) < 1e-9, { L: s280.L, toku: tk(s280.q), worn: tk(s280w) });
  // Bot の花丸: 拳1発で壊れる（中破）壁だけを壊して近道する
  const bot = (wear: boolean) => {
    const q = mk('hanamaru'); if (wear) worn(q.r); q.A.bot = true; Object.assign(q.A, { x: 200, y: 512 }); q.A.skillReadyAt = 0;
    return SKILLS.hanamaru.botMove!(q.r, q.A, { x: 120, y: 600 }, q.r.walls) as boolean; // 道場の南壁の向こう（回り道より 320px 以上近い）
  };
  ok('Bot の花丸: 無傷の壁では拳で近道しない（1発では抜けない）。中破なら撃つ', !bot(false) && bot(true));
  // 通信: 段階は変わった分だけ送る。途中参加・再接続は最初から
  const g: any = new (GameRoom as any)(); g.setSimulationInterval = () => {}; g.lock = () => {}; g.unlock = () => {};
  const got: Record<string, any[]> = { x: [], y: [] }, cl = (id: string) => ({ sessionId: id, send: (t: string, m: any) => { if (t === 's') got[id].push(m); } }), cls: any[] = [cl('x')];
  Object.defineProperty(g, 'clients', { value: cls }); g.onCreate(); g.onJoin(cls[0]); g.startMatch(); g.beginPlay();
  g.hitWalls([[12, 33], [13, 33]], new Set()); g.sendSnapshots(); g.sendSnapshots(); g.hitWalls([[12, 33]], new Set()); g.sendSnapshots();
  cls.push(cl('y')); g.onJoin(cls[1]); g.sendSnapshots();
  const x = got.x.map((m) => m.cracks ?? null), y1 = got.y[0]?.cracks;
  g.onReconnect(cls[0]); g.sendSnapshots(); const re = got.x.at(-1).cracks;
  ok('通信: 壁の段階（小破・中破）は変わったマスだけ送る（変わらなければ送らない）。途中参加・再接続は今までの分を最初から', JSON.stringify(x) === JSON.stringify([[[12, 33, 1], [13, 33, 1]], null, [[12, 33, 2]], null]) && JSON.stringify(y1) === '[[12,33,1],[13,33,1],[12,33,2]]' && JSON.stringify(re) === JSON.stringify(y1), { x, y1, re });
  g.endMatch(0); g.setup(); g.sendSnapshots();
  ok('連戦（待機画面に戻る）: 壁の段階も最初に戻る', g.wallDmg.size === 0 && g.crackLog.length === 0 && !got.x.at(-1).cracks);
}

console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
