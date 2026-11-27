// Bot とアシストの思考（refac2 で GameRoom.ts から切り出し。中身は変えていない）。形は skills と同じ「関数(room, …)」
import { CONFIG as C, Rect, Pt } from '../shared/config';
import { moveWalls } from '../shared/chars';
import { lineOfSight, inRect } from '../shared/geom';
import { SKILLS } from './skills';
import { findPath } from './pathfind';
import { type Player, type Thing, type GameRoom } from './GameRoom';

export function updateBots(room: GameRoom) {
  const obs = room.obstacles();
  for (const t of [0, 1]) { // マクロ counter・split: 敵が trigger 人以上撤退中なら逆襲へ。逆襲は戻らず、味方が全滅したら構えに戻る
    const mc = room.macros[t].split('+')[0];
    if (mc !== 'counter' && mc !== 'split') continue;
    const dead = (tm: number) => [...room.players.values()].filter((q) => q.team === tm && !q.assist && !q.alive).length, n = (tm: number) => [...room.players.values()].filter((q) => q.team === tm && !q.assist).length;
    if (room.counterMode[t] === 'hold' && dead(1 - t) >= C.BOT_COUNTER.trigger) { room.counterMode[t] = 'attack'; room.counterN[t]++; }
    else if (room.counterMode[t] === 'attack' && dead(t) === n(t)) room.counterMode[t] = 'hold';
  }
  for (const t of [0, 1]) room.scUpdate(t);
  for (const p of room.players.values()) if (p.bot && p.alive && !(room.practice && p.id === 'foe' && room.foeMode === 'stand')) room.botThink(p, obs); // 練習の棒立ちは考えない（動かない）
}

// Botが技を使う価値があるか（技の範囲内に対象がいるか）
export function botSkillUseful(room: GameRoom, p: Player): boolean {
  return SKILLS[p.char]?.botUse(room, p) ?? false;
}

// Bot の技の判定用: 半径 r 内に ok を満たす敵の対象がいて、遮られていないか
export function nearFoe(room: GameRoom, p: Player, r: number, ok: (t: Thing) => boolean) {
  return room.inCircle(p, p.x, p.y, r).some((t) => ok(t) && room.targetable(t) && room.reach(p, t));
}

// 詰まり判定: 戦闘中でないのに一定時間ほとんど動いていなければ、今の目的地を一時的に避ける
export function botStuck(room: GameRoom, p: Player, fighting: boolean) {
  if (fighting || Math.hypot(p.x - p.stuckX, p.y - p.stuckY) > C.BOT_STUCK_RADIUS) {
    Object.assign(p, { stuckX: p.x, stuckY: p.y, stuckSince: room.now });
    return;
  }
  if (room.now - p.stuckSince < C.BOT_STUCK_TIME || !p.goal) return;
  p.penalty.set(p.goal, room.now + C.BOT_PENALTY_TIME);
  p.path = []; p.pathAt = -Infinity;
  if (p.goal.startsWith('room:')) { p.visited.push(p.raidBase); p.raidBase = -1; }
  Object.assign(p, { stuckX: p.x, stuckY: p.y, stuckSince: room.now });
}

export function botThink(room: GameRoom, p: Player, obs: Rect[]) {
  if (p.assist) return room.assistThink(p, obs);
  if (room.sc[p.team] && !room.sc[p.team]!.abort && room.scThink(p, obs)) return; // マクロ soracannon（botai4）
  const ph = p.phys ? C.BOT_PHYS[p.phys] : undefined; // フィジカル（中は undefined＝今の値）
  const dist = (o: Pt) => Math.hypot(o.x - p.x, o.y - p.y);
  // 近い順。同じくらい近い候補はランダムに選ぶ。詰まった目的地（penalty）は避ける（全部避けるべきなら避けない）
  const avoid = (key: string) => (p.penalty.get(key) ?? 0) > room.now;
  const best = <X extends Pt>(a: X[], key: (x: X) => string) => {
    const ok = a.filter((x) => !avoid(key(x)));
    const list = (ok.length ? ok : a).map((x) => ({ x, d: Math.round(dist(x) / C.GRID_CELL), r: Math.random() })).sort((u, v) => u.d - v.d || u.r - v.r);
    return list[0]?.x;
  };
  const go = (to: Pt, key: string) => { p.goal = key; room.botGoto(p, to, obs); };
  let foes = [...room.players.values()].filter((e) => e.team !== p.team && e.alive && !room.effect(e, 'hidden') && dist(e) <= (ph?.aggro ?? C.BOT_AGGRO_RANGE) && room.visibleTo(p.team, e.x, e.y, obs));
  if (ph?.react) { // 反応の遅い Bot: 敵が見えてから react 秒たつまで気付かない（移動・経路はいつもどおり）
    const seen = (p.seenAt ??= new Map()), ids = new Set(foes.map((e) => e.id));
    for (const k of [...seen.keys()]) if (!ids.has(k)) seen.delete(k);
    for (const e of foes) if (!seen.has(e.id)) seen.set(e.id, room.now);
    foes = foes.filter((e) => room.now - seen.get(e.id)! >= ph.react);
  }
  // リコール: HPが低いとき（給湯室にいるときは使わない）。脅威あり（近くに見える敵／直近の被弾）の間は始めず、溜め中なら中断。給湯室に着いたら、HPが満タンになるまでご飯を食べる
  const fl = room.macros[p.team].split('+')[1] ?? '', L = C.BOT_LAYER;
  const allIn = fl.includes('w') && [...room.players.values()].some((q) => q.team === p.team && !q.assist && !q.alive); // 層 w: 味方が撤退中の間は帰還・逃げをせず攻め切る
  const low = !allIn && !room.atBase(p) && p.hp < room.maxHp(p) * (ph?.recallHp ?? C.BOT_RECALL_HP), threat = foes.length > 0 || room.now - p.hitAt < C.BOT_RECALL_SAFE;
  if (threat) { if (p.recallAt !== null) room.cancelRecall(p); }
  else if (low && p.recallAt === null && room.now >= p.recallBanUntil) p.recallAt = room.now;
  if (p.recallAt !== null) { room.rec.bot(p, 'recall'); room.setInput(p.id, 0, 0); return; } // 溜め中は止まる（移動・技で中断するため）
  if (p.eating && (p.hp >= room.maxHp(p) || !room.atBase(p))) p.eating = false;
  // 0. 技: CTが明けていて範囲内に対象がいれば使う
  if (room.phase === 'playing' && room.now >= p.skillReadyAt + (ph?.skillDelay ?? 0) && !room.effect(p, 'noSkill') && !(room.practice && p.id === 'foe' && room.foeMode !== 'bot') && room.botSkillUseful(p)) room.skill(p.id); // 練習の攻撃なしは技も使わない
  // 1. 近くの敵を攻撃（指名手配中の敵を優先）
  const wanted = foes.find((e) => e.id === room.teams[1 - p.team].wanted);
  const enemy = wanted ?? (ph?.focusLow ? [...foes].sort((u, v) => u.hp / room.maxHp(u) - v.hp / room.maxHp(v))[0] : best(foes, (e) => `p:${e.id}`));
  botStuck(room, p, !!enemy || !!p.tgt);
  // 低HPで脅威あり: 狙う敵の残りHPが自分以下なら攻撃、それ以外（見える敵がいない被弾を含む）は自陣の給湯室へ逃亡（射程内の敵には通常攻撃が自動で出る）。決定は BOT_FLEE_COMMIT 秒維持
  if (low && threat) {
    if (room.now >= p.lowUntil) { p.lowFight = !!enemy && enemy.hp <= p.hp * (ph?.fleeRatio ?? C.BOT_FLEE_RATIO); p.lowUntil = room.now + C.BOT_FLEE_COMMIT; }
    if (!p.lowFight || !enemy) { const r = C.RECALL_ROOMS[p.team]; room.rec.bot(p, 'flee'); return go({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, 'flee'); }
  }
  if (enemy) { room.rec.bot(p, 'fight'); return botFight(room, p, enemy, C.PLAYER_RADIUS, obs); }
  if (p.eating) { const f = best(room.items.filter((i) => i.kind === 'heal' && inRect(i.x, i.y, C.RECALL_ROOMS[p.team])), (i) => `item:${i.id}`); if (f) { room.rec.bot(p, 'eat'); return go(f, `item:${f.id}`); } }
  // 2. コバコ: 落とした荷物をすぐ拾える位置にいるときだけ攻撃する
  const c = room.couriers[0];
  if (c && dist(c) <= C.BOT_COURIER_RANGE && room.visibleTo(p.team, c.x, c.y, obs)) {
    p.goal = `c:${c.id}`; room.rec.bot(p, 'courier');
    if (dist(c) <= C.ATTACK_RANGE + C.PLAYER_RADIUS - 4 && lineOfSight(p.x, p.y, c.x, c.y, obs)) { room.setInput(p.id, 0, 0); return room.attack(p.id, Math.atan2(c.y - p.y, c.x - p.x), true); }
    return room.botGoto(p, c, obs);
  }
  // 3. 見えている荷物を拾いに行く（触れると拾う）
  const box = best(room.items.filter((i) => i.kind.startsWith('box_') && room.visibleTo(p.team, i.x, i.y, obs)), (i) => `item:${i.id}`);
  if (box) { room.rec.bot(p, 'item'); return go(box, `item:${box.id}`); }
  // 4. 役割: 資材集め（一番近い資材）か、敵陣の見回り
  // マクロの層（botai2。層のない std は今の役割のまま）: e 終盤リードで守り ＞ u パワーアップ中は攻め ＞ a アシストに同行 ＞ 土台の役割
  let role: string = p.role;
  if (role === 'counter') role = room.counterMode[p.team] === 'attack' ? 'raid' : 'guard'; // counter: 構えは守り、逆襲は攻め
  if (room.sc[p.team]?.abort) role = [...room.players.values()].filter((q) => q.team === p.team && !q.assist).indexOf(p) % 2 === 0 ? 'gather' : 'raid'; // soracannon をやめた後は std の役割
  if (allIn) role = 'raid';
  else if (fl) {
    const pct = (t: number) => room.bosses[t].hp / C.BOSS_HP;
    if (fl.includes('e') && room.timeLeft <= L.endSec && pct(p.team) > pct(1 - p.team)) { role = 'guard'; room.endDefend[p.team] = true; }
    else if (fl.includes('u') && p.ult && !p.ult.pending) role = 'ultraid';
    else if (fl.includes('a') && escorts(room, p.team).includes(p)) role = 'escort';
  }
  if (role === 'guard') { // 守り: 自陣の大将の近く（defendR 以内）にいる見える敵を迎え撃つ。いなければ大将のそばで待つ
    const own = room.bosses[p.team], d2 = (e: Pt) => Math.hypot(e.x - own.x, e.y - own.y);
    const atk = [...room.players.values()].filter((e) => e.team !== p.team && e.alive && !room.effect(e, 'hidden') && d2(e) <= L.defendR && room.visibleTo(p.team, e.x, e.y, obs)).sort((u, v) => d2(u) - d2(v))[0];
    room.rec.bot(p, 'guard');
    if (atk) return botFight(room, p, atk, C.PLAYER_RADIUS, obs);
    if (dist(own) > C.BOSS_RADIUS * 3) return go(own, 'guard');
    return room.setInput(p.id, 0, 0);
  }
  if (role === 'escort') { // 同行: 味方のアシストのそばにつき、アシストの近く（escortFight 以内）の見える敵と戦う
    const a = room.teamAssist(p.team)!, d2 = (e: Pt) => Math.hypot(e.x - a.x, e.y - a.y);
    const atk = [...room.players.values()].filter((e) => e.team !== p.team && e.alive && !room.effect(e, 'hidden') && d2(e) <= L.escortFight && room.visibleTo(p.team, e.x, e.y, obs)).sort((u, v) => d2(u) - d2(v))[0];
    room.rec.bot(p, 'escort');
    if (atk) return botFight(room, p, atk, C.PLAYER_RADIUS, obs);
    if (dist(a) > L.escortNear) return go(a, 'escort');
    return room.setInput(p.id, 0, 0);
  }
  if (role === 'gather') {
    room.rec.bot(p, 'gather');
    const enemySide = (x: number) => (p.team === 0 ? x > C.MAP_W / 2 : x < C.MAP_W / 2), pri = room.macros[p.team].startsWith('steal') ? room.materials.filter((q) => q.big || (q.hi && enemySide(q.x))) : []; // steal: コバコの資材・敵陣の裏側の資材を優先
    const m = best(pri.length ? pri : room.materials, (m) => `mat:${m.id}`);
    return m ? go(m, `mat:${m.id}`) : go({ x: C.MAP_W / 2, y: C.MAP_H / 2 }, 'center');
  }
  const boss = room.bosses[1 - p.team];
  room.rec.bot(p, role === 'ultraid' ? 'ultraid' : 'raid');
  if (room.visibleTo(p.team, boss.x, boss.y, obs)) { p.goal = 'boss'; room.rec.bot(p, role === 'ultraid' ? 'ultraid' : 'boss'); return botFight(room, p, boss, C.BOSS_RADIUS, obs); }
  const bs = room.bases[1 - p.team];
  // 未見回りの部屋のうち近い部屋（同じくらいならランダム、詰まった部屋は避ける）
  const next = () => best(bs.map((b, i) => ({ ...b, i })).filter((b) => !p.visited.includes(b.i)), (b) => `room:${b.i}`)!.i;
  if (p.raidBase < 0) { if (p.visited.length >= bs.length) p.visited = []; p.raidBase = next(); }
  if (dist(bs[p.raidBase]) < 40) { // 見えないので次の拠点へ
    p.visited.push(p.raidBase);
    if (p.visited.length >= bs.length) p.visited = [p.raidBase];
    p.raidBase = next();
  }
  const b = bs[p.raidBase];
  if (SKILLS[p.char]?.botMove?.(room, p, b, obs)) return;
  go(b, `room:${p.raidBase}`);
}

// アシスト: 敵大将へ経路探索で前進し、着いたら攻撃する（途中の敵は射程内ならオートアタック、前進は止めない）
// 両陣営のアシストが出ているときは、互いを最優先の目標にする（相手が倒れたら敵大将への前進に戻る）
export function assistThink(room: GameRoom, p: Player, obs: Rect[]) {
  const foe = enemyAssist(room, p);
  if (foe) { p.goal = `p:${foe.id}`; return botFight(room, p, foe, C.PLAYER_RADIUS, obs); }
  if (room.macros[p.team].split('+')[1]?.includes('a')) { // マクロの層 a: 同行役が全員 assistWait より遠い間は進まずに待つ（単騎で攻め込んで倒されないように）
    const es = escorts(room, p.team);
    if (es.length && es.every((e) => Math.hypot(e.x - p.x, e.y - p.y) > C.BOT_LAYER.assistWait)) return room.setInput(p.id, 0, 0);
  }
  const boss = room.bosses[1 - p.team];
  p.goal = 'boss';
  botFight(room, p, boss, C.BOSS_RADIUS, obs);
}

export function enemyAssist(room: GameRoom, p: Player) {
  return [...room.players.values()].find((q) => q.assist && q.alive && q.team !== p.team);
}

// 射程まで近づく（攻撃はオートアタック）
export function botFight(room: GameRoom, p: Player, t: Pt, tr: number, obs: Rect[]) {
  const d = Math.hypot(t.x - p.x, t.y - p.y);
  if (d <= room.atkRange(p) + tr - 6 && lineOfSight(p.x, p.y, t.x, t.y, obs.filter((o) => !inRect(t.x, t.y, o)))) {
    room.setInput(p.id, 0, 0);
    p.face = Math.atan2(t.y - p.y, t.x - p.x);
  } else room.botGoto(p, t, obs);
}

export function botGoto(room: GameRoom, p: Player, to: Pt, obs: Rect[]) {
  if (room.now - p.pathAt >= C.BOT_REPATH || !p.path.length) {
    p.path = findPath(p, to, moveWalls(p.char, obs), moveWalls(p.char, room.walls));
    p.pathAt = room.now;
  }
  const reach = Math.max(6, room.speedOf(p) / C.TICK_HZ); // 6px 以内、または1tick の移動量以内なら着いた（速いキャラが経由点を行き過ぎて往復しないように）
  while (p.path.length && Math.hypot(p.path[0].x - p.x, p.path[0].y - p.y) < reach) p.path.shift();
  const n = p.path[0];
  if (n) room.setInput(p.id, n.x - p.x, n.y - p.y);
  else room.setInput(p.id, 0, 0);
}

// マクロの層 a の同行役: 味方のアシストが出ている間、アシストに近い生存中の Bot（アシスト以外）から BOT_LAYER.escort 人
export function escorts(room: GameRoom, team: number): Player[] {
  const a = room.teamAssist(team);
  if (!a) return [];
  return [...room.players.values()].filter((q) => q.team === team && q.bot && !q.assist && q.alive).sort((u, v) => Math.hypot(u.x - a.x, u.y - a.y) - Math.hypot(v.x - a.x, v.y - a.y)).slice(0, C.BOT_LAYER.escort);
}
