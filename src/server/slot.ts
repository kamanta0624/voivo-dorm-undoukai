// スロット（クラシック・モダン）の回転・払い出し・罰・反射（refac2 で GameRoom.ts から切り出し。中身は変えていない）。形は skills と同じ「関数(room, …)」
import { CONFIG as C, slotRate, penaltyRate, chanceRate, sevenRate } from '../shared/config';
import { BOSS_CHAR } from '../shared/chars';
import { dress, pick as pickW, type Ev as MEv, type Pay } from '../shared/slot_modern';
import { type CHold, lottery, pick, type Player, type SlotTarget, type GameRoom } from './GameRoom';

// 保留を1つ作る: 当否はこの時点の徳で1回のくじ（当たり・罰の確率は徳で決まる、残りは外れ）。見た目はモダンの選択率。act を渡すとその演出（null＝リーチなし）
// 当たりは払い出しの対象（そろう絵柄）もここで決める。先バレは対象の本人（7 は全員）に SLOT.saki.win、ほかのプレイヤーには保留ごとに SLOT.saki.miss（罰の保留は出さない）
// 全回転は7専用: 7 の当たりは全回転、7 以外の当たりで全回転が選ばれたらリーチの選択率で選び直す（act に allSpin を渡すと7の当たり）
export function classicHold(room: GameRoom, team: number, result?: CHold['outcome'], act?: string | null): CHold {
  const toku = room.teams[team].toku, u = Math.random(), pw = slotRate(toku);
  const outcome = result ?? (u < pw ? 'win' : u < pw + penaltyRate(toku) ? 'pen' : 'miss');
  const d = dress(C.SLOT_MODERN, outcome, Math.random);
  if (act !== undefined) d.act = act;
  const target: SlotTarget | null = outcome !== 'win' ? null : d.act === 'allSpin' && act !== undefined ? { kind: 'seven' } : room.slotTarget(team), S = C.SLOT.saki;
  if (target?.kind === 'seven') d.act = 'allSpin';
  else if (d.act === 'allSpin') { const R = C.SLOT_MODERN.reach, ks = Object.keys(R); d.act = ks[pickW(ks.map((k) => R[k].win), Math.random())]; }
  const mine = (id: string) => target?.kind === 'seven' || (target?.kind === 'ult' && target.id === id);
  const saki = outcome === 'pen' ? [] : room.slotPlayers(team).filter((p) => Math.random() < (mine(p.id) ? S.win : S.miss)).map((p) => p.id);
  return { outcome, color: d.color, act: d.act, target, saki, reels: [] };
}

export function slotPlayers(room: GameRoom, team: number) { return [...room.players.values()].filter((p) => p.team === team && !p.assist); }

// 当選の対象: 徳で7（sevenRate）、残りのうち SLOT.assistShare でアシスト（出ていればそのアシスト、いなければ4人から等確率）、残りは今いるプレイヤーから等確率
export function slotTarget(room: GameRoom, team: number): SlotTarget {
  const ps = room.slotPlayers(team);
  if (Math.random() < sevenRate(room.teams[team].toku)) return { kind: 'seven' };
  if (!ps.length || Math.random() < C.SLOT.assistShare) return { kind: 'assist', char: room.teamAssist(team)?.char ?? pick(Object.keys(C.ASSIST.units)) };
  return { kind: 'ult', id: pick(ps).id };
}

// リールの絵柄（SLOT.syms からいないプレイヤーを除く）。クライアントは編成（roster）から同じ並びを作る
export function slotSyms(room: GameRoom, team: number): SlotTarget[] {
  const ps = room.slotPlayers(team), as = Object.keys(C.ASSIST.units);
  return C.SLOT.syms.flatMap((x): SlotTarget[] => { const [k, i] = x.split(':'); return k === 'boss' ? [{ kind: 'seven' }] : k === 'assist' ? [{ kind: 'assist', char: as[+i] }] : ps[+i] ? [{ kind: 'ult', id: ps[+i].id }] : []; });
}

// 回転を始める: 先頭の保留を消化して1つ積む（先バレはここで本人へ）。result を渡すとその結果に差し替える（e2e・検証用）
// 出目はこのときの編成で決める: 当たりは対象の絵柄の3つそろい（対象が抜けていたら今いる人から選び直す。アシストが出ていればそのアシスト）、罰は ×××、リーチの外れは2つそろえて3つ目をずらす、リーチなしの外れは1つ目と2つ目を違える
export function startSpin(room: GameRoom, team: number, result?: CHold['outcome'], act?: string | null) {
  const sl = room.teams[team].slot;
  let h = sl.holds.shift() ?? room.classicHold(team);
  const add = room.classicHold(team); sl.holds.push(add);
  for (const c of room.clients) if (add.saki.includes(room.owners.get(c.sessionId) ?? '')) c.send('mslot', { team, type: 'saki' });
  if (result) h = room.classicHold(team, result, act);
  else if (room.slotMiss && h.outcome !== 'miss') h = room.classicHold(team, 'miss'); // e2e: 技の検証中は外れに固定
  const t = h.target, a = room.teamAssist(team);
  if (t?.kind === 'ult' && !room.players.has(t.id)) h.target = room.slotTarget(team);
  else if (t?.kind === 'assist' && a) t.char = a.char;
  const syms = room.slotSyms(team), pool = syms.flatMap((x, i) => (x.kind === 'seven' ? [] : [i + 1])), n = pool.length, r = () => pool[Math.floor(Math.random() * n)]; // 外れの出目に7は使わない
  if (h.outcome === 'win') { const g = h.target!, k = 1 + syms.findIndex((x) => (x.kind === 'ult' ? g.kind === 'ult' && g.id === x.id : x.kind === 'assist' ? g.kind === 'assist' && g.char === x.char : g.kind === 'seven')); h.reels = [k, k, k]; }
  else if (h.outcome === 'pen') h.reels = [-1, -1, -1];
  else { const a = Math.floor(Math.random() * n), x = pool[a], y = pool[(a + 1 + Math.floor(Math.random() * (n - 1))) % n]; h.reels = h.act ? [x, x, y] : [x, y, r()]; }
  Object.assign(sl, { start: room.now, reels: h.reels, win: h.outcome === 'win', pen: h.outcome === 'pen', chain: 0, tier: 0, top: 0, payoutAt: null, holdUntil: 0, cur: h, reachSent: false });
}

// 罰: その陣営の生存者全員（アシストを除く）に、抽選した1つを掛ける。徳は変わらない。両陣営に通知
export function penalty(room: GameRoom, team: number) {
  const P = C.SLOT.penalty, kind = Object.keys(P.kinds)[lottery(Object.values(P.kinds))];
  room.rec.pen(room, team, kind);
  for (const q of room.players.values()) {
    if (q.team !== team || !q.alive || q.assist) continue;
    if (kind === 'dmg') room.damagePlayer(q, room.maxHp(q) * P.dmg, null, true);
    else if (kind === 'slow') q.slowUntil = room.now + P.dur;
    else q.weakUntil = room.now + P.dur;
    room.fxAtBody(q, 'aura', { r: 26, color: `pen_${kind}` });
  }
  for (const c of room.clients) c.send('penalty', { team, kind });
  room.cm.penalty(team, kind);
}

// 反省中（KOされて復活待ち）の人数 n に応じて、陣営の徳が毎秒 REFLECT_TOKU × n² 上がる
export function updateReflect(room: GameRoom, dt: number) {
  room.teams.forEach((t, team) => {
    const n = room.reflecting(team);
    if (n) t.toku = room.clampToku(t.toku + C.REFLECT_TOKU * n * n * dt);
  });
}

export function reflecting(room: GameRoom, team: number) {
  return [...room.players.values()].filter((p) => p.team === team && !p.assist && !p.alive).length;
}

// 回転が終わったら: 当たりなら徳が下がり、払い出し（連チャンは間を空けて続ける）。外れなら次の回転
export function updateSlots(room: GameRoom) {
  room.teams.forEach((t, team) => {
    const sl = t.slot, h = sl.cur;
    if (sl.payoutAt === null) {
      if (h?.act && !sl.reachSent && !sl.holdUntil) { // リーチ・全回転: 演出の秒数だけ前から（回転の終わりは変えない）
        const M = C.SLOT_MODERN, sec = h.act === 'allSpin' ? M.allSpinSec : M.reach[h.act].sec, end = sl.start + C.SLOT.spin;
        if (room.now >= end - sec) { sl.reachSent = true; mslot(room, team, { type: 'spin', reels: sl.reels, act: h.act, sec: end - room.now, win: sl.win }); }
      }
      if (room.now - sl.start < C.SLOT.spin) return;
      if (sl.holdUntil) { if (room.now >= sl.holdUntil) room.startSpin(team); return; } // 罰の出目を見せ終わったら次の回転
      mslot(room, team, { type: 'stop', reels: sl.reels, outcome: sl.win ? 'win' : sl.pen ? 'pen' : 'miss' });
      room.rec.spin(room, team, sl.win ? 'win' : sl.pen ? 'pen' : 'miss', sl.reels, h?.act ?? null);
      if (sl.pen) { room.penalty(team); sl.holdUntil = room.now + C.SLOT.penHold; return; }
      if (!sl.win) return room.startSpin(team);
      // チャンスアップ: 外れるまで最大 SLOT.chance.n 回の連続抽選（当選時の徳）。結果は先に決め、カットインで1段ずつ見せて最後に払い出す
      const rate = room.slotChance ?? chanceRate(t.toku);
      let top = 0; while (top < C.SLOT.chance.n && Math.random() < rate) top++;
      room.addToku(team, null, 'slot');
      Object.assign(sl, { chain: 1, tier: 0, top: Math.min(top, C.POWER_TAGS.length - 1), payoutAt: room.now });
    }
    if (room.now < sl.payoutAt!) return;
    const tg = sl.cur!.target!, kind = tg.kind, who = tg.kind === 'ult' ? room.players.get(tg.id)?.char ?? '' : tg.kind === 'assist' ? tg.char : BOSS_CHAR[team];
    for (const c of room.clients) c.send('slot', { team, chain: sl.chain, kind, tier: sl.tier, char: who }); // 両陣営にカットイン
    room.cm.slot(team, sl.chain, kind, who);
    if (sl.tier < sl.top) Object.assign(sl, { chain: sl.chain + 1, tier: sl.tier + 1, payoutAt: room.now + C.SLOT.gap });
    else { room.rec.pay(room, team, kind, kind === 'seven' ? null : who, sl.tier); room.payout(team, tg, sl.tier); room.startSpin(team); }
  });
}

// 払い出し（handoff_slot4）: そろった絵柄のプレイヤー1人がパワーアップ（反省中なら復帰後。パワーアップ中ならレベルは高い方・効果時間は最初から）
// アシストの絵柄: 出ていなければそのアシストを召喚。出ていればレベルは高い方、上がったら最大HPの増えた分・上がらなければ SLOT.assistHeal だけ回復
// 7: 陣営のプレイヤー全員がレベルアップ（パワーアップしていなければ tier、していれば今のレベル+1+tier。上限あり、効果時間は最初から。反省中は復帰後）。アシストは対象外
export function payout(room: GameRoom, team: number, t: SlotTarget, tier: number) {
  if (t.kind === 'seven') {
    for (const q of room.slotPlayers(team)) {
      if (!q.ult) { room.giveUlt(q, tier); continue; }
      q.ult.tier = Math.min(C.POWER_TAGS.length - 1, q.ult.tier + 1 + tier);
      if (!q.ult.pending) q.ult.until = room.now + C.ULT_DURATION;
    }
    return;
  }
  if (t.kind === 'ult') {
    const q = room.players.get(t.id);
    if (!q) return;
    if (!q.ult) return room.giveUlt(q, tier);
    q.ult.tier = Math.max(q.ult.tier, tier);
    if (!q.ult.pending) q.ult.until = room.now + C.ULT_DURATION;
    return;
  }
  const a = room.teamAssist(team);
  if (!a) return void room.summonAssist(team, tier, t.char);
  const m0 = room.maxHp(a);
  if (tier > a.tier) {
    a.tier = tier; a.hp += room.maxHp(a) - m0;
    for (const c of room.clients) c.send('assistUp', { char: a.char, tier: a.tier, team, at: room.elapsed }); // 両陣営に通知
    room.cm.assistUp(a);
  } else a.hp = Math.min(m0, a.hp + m0 * C.SLOT.assistHeal);
  room.addFx(a, 'aura', { r: 40, color: 'assist' });
}

// 陣営ごとに抽選を dt 秒進める（徳は陣営の徳を使い、当選の徳 −1 を陣営へ返す）。起きたことを効果・通知・実況に流す
export function updateModern(room: GameRoom, dt: number) {
  room.teams.forEach((t, team) => {
    const m = t.m!;
    if (room.slotMiss) return; // e2e: 技の検証中は止める
    m.toku = t.toku; m.step(dt); t.toku = room.clampToku(m.toku);
    const ev = m.ev; m.ev = [];
    for (const e of ev) modernEv(room, team, e);
  });
}

export function modernEv(room: GameRoom, team: number, e: MEv) {
  const send = (msg: any) => mslot(room, team, msg);
  if (e.type === 'hold' && e.hold.saki) send({ type: 'saki' });
  else if (e.type === 'spin') {
    const sec = e.end - e.t, h = e.hold;
    send({ type: 'spin', reels: h.reels, act: h.act, sec, win: h.outcome === 'win' });
    if (h.act && h.act !== 'allSpin') room.cm.reachModern(team, room.now + sec);
  } else if (e.type === 'stop') { send({ type: 'stop', reels: e.hold.reels, outcome: e.hold.outcome }); room.rec.spin(room, team, e.hold.outcome === 'fall' ? 'pen' : e.hold.outcome, e.hold.reels, e.hold.act); }
  else if (e.type === 'win') { room.rec.pay(room, team, e.pay.group, null, e.pay.add); room.payModern(team, e.pay, e.first, e.chain); }
  else if (e.type === 'penalty') { room.rec.pen(room, team, e.n === 1 ? 'fall' : 'pullback'); room.penaltyModern(team, e.n); }
}

// レベルを add 段上げ、耐久（アシストはHP、パワーアップ中はシールド）を足す。足す量＝各段の最大値の差の合計（Lv4 以降の段は Lv3→Lv4 の差）。
// add=0（偶数）はレベルを変えず次の1段分を足す。上がった先の最大値で止め、減っていた分は持ち越す。撤退中のパワーアップはレベルだけ
export function levelUp(room: GameRoom, p: Player, add: number) {
  const get = () => (p.assist ? p.tier : p.ult!.tier), set = (v: number) => { if (p.assist) p.tier = v; else p.ult!.tier = v; };
  const from = get(), mx = (v: number) => { set(v); const r = room.maxHp(p); set(from); return r; };
  const step = (k: number) => (k < C.POWER_TAGS.length - 1 ? mx(k + 1) - mx(k) : mx(C.POWER_TAGS.length - 1) - mx(C.POWER_TAGS.length - 2));
  let inc = 0;
  for (let k = from; k < from + Math.max(1, add); k++) inc += step(k);
  set(from + add);
  if (p.alive && !(p.ult?.pending && !p.assist)) p.hp = Math.min(room.maxHp(p), p.hp + inc);
}

// 当選の払い出し: パワーアップ（自陣のプレイヤー全員。撤退中は復活後に始まる）とアシストの両方に同じ効果。両陣営に通知
// 初当たり: パワーアップしている人がいなければ当たりのレベルで始める、いれば add 段上げる。アシストは今いなければ当たりのレベルで呼ぶ、いれば add 段上げる
// CT・引き戻し: パワーアップは陣営のレベル +add（切れた人・していない人は陣営のレベルで新たに始める）。アシストがいなければ Lv1 を呼ぶ（そろい目によらない）
export function payModern(room: GameRoom, team: number, pay: Pay, first: boolean, chain: number) {
  const T = room.teams[team], G = C.SLOT_MODERN.game;
  const mates = [...room.players.values()].filter((q) => q.team === team && !q.assist);
  const ults = mates.filter((q) => q.ult);
  const to = first && !ults.length ? pay.add - 1 : (ults.length ? Math.max(...ults.map((q) => q.ult!.tier)) : T.powerTier) + pay.add;
  for (const q of mates) {
    if (!q.ult) { room.giveUlt(q, to); continue; }
    levelUp(room, q, to - q.ult.tier);
    if (q.ult.pending) q.ult.dur = (q.ult.dur ?? C.ULT_DURATION) + G.ultAdd; else q.ult.until += G.ultAdd;
    if (q.alive) room.fxAtBody(q, 'aura', { r: 50, color: 'ult' });
  }
  T.powerTier = to;
  const a = [...room.players.values()].find((q) => q.assist && q.team === team && q.alive);
  let assist: { char: string; tier: number; add: number; new: boolean };
  if (!a) { const n = room.summonAssist(team, first ? pay.add - 1 : 0, undefined, true); assist = { char: n.char, tier: n.tier, add: 0, new: true }; }
  else {
    const add = pay.add; levelUp(room, a, add);
    room.addFx(a, 'aura', { r: 40, color: 'assist' });
    if (add > 0) room.cm.assistUp(a);
    assist = { char: a.char, tier: a.tier, add, new: false };
  }
  T.m!.lv = { power: to + 1, assist: assist.tier + 1 }; // 表示・最高到達レベル用に実際のレベルへ合わせる
  T.m!.maxLv = { power: Math.max(first ? 0 : T.m!.maxLv.power, to + 1), assist: Math.max(first ? 0 : T.m!.maxLv.assist, assist.tier + 1) };
  for (const c of room.clients) c.send('mslotWin', { team, first, chain, group: pay.group, power: { tier: to, add: first && !ults.length ? 0 : pay.add, new: first && !ults.length }, assist });
  room.cm.slotModern(team, first);
}

// 転落・引き戻し失敗のペナルティ: 陣営の生存者全員（アシストも）に、最大HPの dmg 割のダメージ（パワーアップ中はシールドに入る）と、攻撃・移動速度の低下（dur 秒。重ねがけは時間の延長）
export function penaltyModern(room: GameRoom, team: number, n: 1 | 2) {
  const P = C.SLOT_MODERN.game.penalty;
  for (const q of [...room.players.values()]) {
    if (q.team !== team || !q.alive) continue;
    room.damagePlayer(q, room.maxHp(q) * P.dmg, null, true);
    if (!q.alive) continue;
    q.slowUntil = Math.max(q.slowUntil, room.now) + P.dur; q.weakUntil = Math.max(q.weakUntil, room.now) + P.dur;
    room.fxAtBody(q, 'aura', { r: 26, color: 'pen_dmg' });
  }
  for (const c of room.clients) c.send('mpenalty', { team, n });
  room.cm.penaltyModern(team, n);
}

export function mslot(room: GameRoom, team: number, msg: any) { for (const c of room.clients) c.send('mslot', { team, ...msg }); }
