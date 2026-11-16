// 実況ディレクター（docs/commentary_spec.md）。判定はすべてここ。出来事のフック（GameRoom から呼ぶ）と1秒ごとの軽い更新で状態を持ち、
// 喋る内容だけを小さなメッセージ 'cm'（イベントキー＋部品のID。座標は送らない）として全員に送る。判定ロジックは純粋関数に切り出してある
import type { GameRoom, Player, Ent } from './GameRoom';
import { PERIMETER } from './GameRoom';
import { CONFIG as C } from '../shared/config';
import { CHARS } from '../shared/chars';
import { inDashShape } from '../shared/geom';
import { Args, Say, Utter, priority, patterns } from '../shared/commentary';
import MAP from '../shared/map.json';

const M = C.CM;

// ---- 純粋関数 ----

// 注目度の加算（上限あり）
export const bump = (attn: Map<string, number>, id: string, v: number) => attn.set(id, Math.min(M.attn.max, (attn.get(id) ?? 0) + v));
// 時間経過の減衰（dt 秒ぶん）。0以下は消す
export function decay(attn: Map<string, number>, dt: number) {
  for (const [id, v] of attn) { const n = v - M.attn.decay * dt; if (n > 0) attn.set(id, n); else attn.delete(id); }
}
// フォーカスの遷移: なし→注目度 focusOn 以上の最大の対象へ開始、フォーカス中の対象が focusOff 未満で解除、他の対象が focusGap 以上上回れば移る
export function nextFocus(focus: string | null, attn: Map<string, number>): { focus: string | null; change: 'start' | 'move' | 'off' | null } {
  let top: string | null = null, tv = -Infinity;
  for (const [id, v] of attn) if (id !== focus && v > tv) { top = id; tv = v; }
  if (focus !== null) {
    const fv = attn.get(focus) ?? 0;
    if (fv < M.focusOff) return top !== null && tv >= M.focusOn ? { focus: top, change: 'start' } : { focus: null, change: 'off' };
    if (top !== null && tv - fv >= M.focusGap) return { focus: top, change: 'move' };
    return { focus, change: null };
  }
  return top !== null && tv >= M.focusOn ? { focus: top, change: 'start' } : { focus: null, change: null };
}
// 接敵の規模（a, b: 両チームの参加者数）
export const engageKind = (a: number, b: number) => (a + b >= 6 ? 'engage_big' : Math.min(a, b) >= 2 ? 'engage_group' : 'engage_1');
// 撃破の瞬間の状況（撃破側 n 人 vs 被撃破側 m 人、撃破直前）
export const situation = (n: number, m: number) => (n === 1 && m === 1 ? 'add_duel' : n < m ? 'add_under' : n > m && m === 1 ? 'add_over' : n >= 2 && m >= 2 ? 'add_melee' : null);
// 単発の撃破の一言（上から順に最初に当てはまる1つ）
export type KillCtx = { first: boolean; wanted: boolean; victimStreak: number; killerStreak: number; revenge: boolean; lowHp: boolean; combo: boolean; chase: boolean; n: number; m: number };
export function killAddon(c: KillCtx): string | null {
  if (c.first) return 'add_first';
  if (c.wanted) return 'add_wanted';
  if (c.victimStreak >= 3) return 'add_stop';
  if (c.killerStreak >= 3) return 'add_streak';
  if (c.revenge) return 'add_revenge';
  if (c.lowHp) return 'add_lowhp';
  if (c.combo) return 'add_combo';
  if (c.chase) return 'add_chase';
  return situation(c.n, c.m);
}
// 戦闘の終了時のまとめ。kills: 撃破（k=撃破者 kt=その陣営 vt=倒された陣営）、alive: 周辺の生存者、hurt: 被ダメージのあった陣営、lowEsc: HP20%以下で生存のまま離脱したキャラ
export type SumCtx = { chain: boolean; kills: { k: string; kt: number; vt: number }[]; alive: { id: string; team: number }[]; hurt: number[]; lowEsc: string | null };
export function summary(c: SumCtx): { k: string; a: Args } | null {
  const n = c.kills.length;
  if (n === 0) {
    if (c.lowEsc) return { k: 'sum0_escape', a: { A: c.lowEsc } };
    if (c.hurt.length >= 2) return { k: 'sum0_even', a: {} };
    if (c.hurt.length === 1) return { k: 'sum0_lead', a: { 組: [1 - c.hurt[0]] } };
    return null;
  }
  if (n < 2 || !c.chain) return null; // 撃破1は単発で喋り済み
  if (c.alive.length === 0) return { k: 'sum_wipe', a: {} };
  if (n >= 3 && c.alive.length === 1) return { k: 'sum_last', a: { A: c.alive[0].id } };
  const by = new Map<string, number>();
  for (const x of c.kills) by.set(x.k, (by.get(x.k) ?? 0) + 1);
  const [top, cnt] = [...by].sort((u, v) => v[1] - u[1])[0];
  if (cnt >= 2) return { k: cnt === 2 ? 'sum_double' : cnt === 3 ? 'sum_triple' : 'sum_quad', a: { A: top } };
  for (const t of [0, 1]) if (c.kills.filter((x) => x.kt === t).length >= 2 && c.alive.filter((a) => a.team === t).length >= 2) return { k: 'sum_team', a: { 組: [t] } };
  for (const t of [0, 1]) if (c.kills.every((x) => x.kt === t)) return { k: 'sum_sweep', a: { 組: [t] } };
  return { k: 'sum_even', a: {} };
}
// 盤面（マップ全体の反省中でない人数、助っ人を除く）。behind: 前回人数差2以上だったときの少ない側（なければ null）
export function board(alive: number[], behind: number | null): { say: { k: string; a: Args } | null; behind: number | null } {
  const [a, b] = alive, d = Math.abs(a - b);
  if (a === 0 || b === 0) return { say: null, behind }; // 全員反省中は6章の割り込みで喋る
  if (d >= 2) { const big = a > b ? 0 : 1; return { say: { k: 'board_diff', a: { n: alive[big], m: alive[1 - big], 組: [big] } }, behind: 1 - big }; }
  if (d === 0 && behind !== null) return { say: { k: 'board_back', a: { 組: [behind] } }, behind: null };
  return { say: null, behind: d === 0 ? null : behind };
}
// 平時の話題選び: 順番を回し、直前と同じ話題・言うことがない話題は飛ばす。小ネタは trivia の割合で
export const TOPICS = ['toku', 'bosshp', 'slot', 'wanted', 'wall', 'courier', 'loot', 'reflect', 'killer', 'tokuTop', 'bad'];
export function pickTopic(rot: number, last: string | null, avail: Set<string>, triviaOk: boolean, r: number): { topic: string | null; rot: number } {
  if (triviaOk && last !== 'trivia' && r < M.trivia) return { topic: 'trivia', rot };
  for (let i = 1; i <= TOPICS.length; i++) {
    const j = (rot + i) % TOPICS.length, t = TOPICS[j];
    if (avail.has(t) && t !== last) return { topic: t, rot: j };
  }
  return { topic: triviaOk && last !== 'trivia' ? 'trivia' : null, rot };
}
// 回避: 技の判定範囲に入った（または発動時に進路上にいた）敵のうち、その技で被弾せず生き残ったもの
export const evaded = (cand: Set<string>, hit: Set<string>, alive: (id: string) => boolean) => [...cand].filter((id) => !hit.has(id) && alive(id));
// パターン選び: ランダム、直前と同じものは避ける（allowed: 使えるパターンの添字）
export function pickPattern(n: number, last: number | undefined, r: number, allowed?: number[]) {
  let list = allowed ?? [...Array(n).keys()];
  if (list.length > 1 && last !== undefined) list = list.filter((i) => i !== last);
  return list[Math.floor(r * list.length)] ?? 0;
}
// 座標 → 部屋の id（map.json の rooms。どこにも入らなければ null）
export function roomAt(x: number, y: number) {
  const tx = Math.floor(x / C.TILE), ty = Math.floor(y / C.TILE);
  return MAP.rooms.find((r) => tx > r.rect[0] && tx < r.rect[2] && ty > r.rect[1] && ty < r.rect[3])?.id ?? null;
}

// ---- 状態 ----

type Kill = { k: Player; v: Player; t: number; says: Say[] };
type Battle = {
  x: number; y: number; members: Set<string>; last: number; kills: { k: string; kt: number; vt: number }[]; pend: Kill | null; chain: boolean; said: Set<string>;
  hurt: Set<number>; lowEsc: string | null; dist: Map<string, number>; follow: Map<string, number>; chasing: { a: string; b: string } | null;
};
type Track = { p: Player; at: number; cand: Set<string>; hit: Set<string>; active: () => boolean; zone: () => string[] };

// 乱数（Math.random は使わない。試合の挙動の照合 verify/golden.ts を変えないため）
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export class Director {
  rnd = rng(Date.now() & 0x7fffffff);
  log: string[] | null = null; // 実況ログ（時刻・フォーカス対象・注目度・イベントキー）。null なら取らない
  attn = new Map<string, number>();
  focus: string | null = null;
  focusRoom: string | null = null;
  lostAt = 0; // フォーカスが外れた時刻
  prefix: { k: string; place: string; at: number } | null = null; // 続くセリフ待ちの前置き
  battles: Battle[] = [];
  tracks: Track[] = [];
  lastPat = new Map<string, number>();
  timer = 0;
  prevLeft = C.MATCH_TIME;
  // 統計（イベントフックでの加算だけ）
  kills = new Map<string, number>(); streak = new Map<string, number>(); toku = new Map<string, number>(); bad = new Map<string, number>(); lastVictim = new Map<string, string>();
  firstKill = false;
  dmgLog = new Map<string, { by: string; t: number; d: number }[]>(); // 倒されたキャラへの直近のダメージ（連携の判定）
  seen = new Map<string, boolean>(); spotAt = new Map<string, number>(); nearAt = new Map<string, number>(); rampAt = new Map<string, number>();
  courierTeam: number | null = null; // 最後にコバコを撃破した組
  bossSaid = [new Set<number>(), new Set<number>()]; leader: number | null = null; reverseAt = -Infinity;
  reachSpin = [-1, -1]; reachAt = [-Infinity, -Infinity]; wins: number[][] = [[], []];
  boardAt = -Infinity; behind: number | null = null; alldown = [false, false];
  idleAt = -Infinity; topic: string | null = null; rot = -1;
  walls: number[] = [0, 0]; // 陣営側ごとの壊せる壁タイル数（壁の壊れ方の話題）

  constructor(private room: GameRoom) {
    const half = MAP.width / 2;
    MAP.tiles.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#' && !PERIMETER[y][x]) this.walls[x < half ? 0 : 1]++; }));
  }

  get now() { return this.room.now; }
  private char = (id: string) => this.room.players.get(id)?.char ?? id;

  // ---- 送信 ----
  private say(k: string, a: Args, allowed?: number[]): Say | null {
    const n = patterns(k).length;
    if (!n) return null;
    const p = pickPattern(n, this.lastPat.get(k), this.rnd(), allowed);
    this.lastPat.set(k, p);
    return { k, p, a };
  }
  private emit(list: (Say | null)[]) {
    const s = list.filter((x): x is Say => !!x);
    if (!s.length) return;
    const u: Utter = { pr: Math.max(...s.map((x) => priority(x.k))), s };
    for (const c of this.room.clients) c.send('cm', u);
    this.log?.push(JSON.stringify({ t: +this.now.toFixed(1), focus: this.focus && this.char(this.focus), attn: this.focus ? Math.round(this.attn.get(this.focus) ?? 0) : null, keys: s.map((x) => x.k) }));
  }
  // フォーカス中の対象が関わるときだけ喋る（前置きが待っていれば前に付ける）
  private focusSay(ids: string[], list: (Say | null)[]) {
    if (this.focus === null || !ids.includes(this.focus)) return false;
    const pre = this.prefix ? this.say(this.prefix.k, { 場所: this.prefix.place }) : null;
    this.prefix = null;
    this.emit([pre, ...list]);
    return true;
  }

  // ---- 注目度とフォーカス ----
  private evalFocus() {
    const prev = this.focus, r = nextFocus(this.focus, this.attn);
    if (!r.change) return;
    this.focus = r.focus;
    this.log?.push(JSON.stringify({ t: +this.now.toFixed(1), focusChange: r.change, from: prev && this.char(prev), to: r.focus && this.char(r.focus), attn: r.focus ? Math.round(this.attn.get(r.focus) ?? 0) : null }));
    if (r.focus === null) { this.lostAt = this.now; this.prefix = null; return; }
    const p = this.room.players.get(r.focus), place = p ? roomAt(p.x, p.y) : null;
    const same = r.change === 'move' && place !== null && place === this.focusRoom;
    this.focusRoom = place;
    this.prefix = same || !place ? null : { k: prev === null ? 'pre_start' : 'pre_move', place, at: this.now };
  }
  private add(id: string, v: number) { bump(this.attn, id, v); }
  // 出来事: 注目度を上げ、フォーカスを判定し、フォーカス中の対象が関わればセリフ
  private event(ids: string[], v: number, list: (Say | null)[]) {
    for (const id of ids) this.add(id, v);
    this.evalFocus();
    return this.focusSay(ids, list);
  }

  // ---- 試合の進行 ----
  intro() { this.emit([this.say('pre_match', { 組: [0, 1] })]); }
  play() { this.lostAt = this.now; this.emit([this.say('start', {})]); }
  end(winner: number, kind: string) {
    if (kind === 'boss') this.emit([this.say('end_boss', { 大将: 1 - winner, 組: [winner] })]);
    else if (winner === 2) this.emit([this.say('end_draw', {})]);
    else this.emit([this.say('end_time', { 組: [winner] })]);
  }

  // 毎tick（軽い処理だけ）: 撃破の保留・前置きの待ち・リーチ・形勢と残り時間。重い判定は CM.every 秒ごと
  tick(dt: number) {
    const now = this.now;
    for (const b of this.battles) if (b.pend && now - b.pend.t >= M.killHold) { const k = b.pend; b.pend = null; this.single(k); }
    if (this.prefix && now - this.prefix.at >= M.prefixWait) { const p = this.prefix; this.prefix = null; this.emit([this.say(p.k, { 場所: p.place })]); }
    this.room.teams.forEach((t, team) => {
      const sl = t.slot;
      if (sl.payoutAt !== null || sl.pen || sl.holdUntil || this.reachSpin[team] === sl.start || now - sl.start < C.SLOT.stops[1] * C.SLOT.spin || sl.reels[0] !== sl.reels[1]) return;
      this.reachSpin[team] = sl.start;
      if (now - this.reachAt[team] < M.reachCd) return;
      this.reachAt[team] = now;
      this.emit([this.say('slot_reach', { 組: [team] })]);
    });
    const left = this.room.timeLeft;
    for (const a of C.SITUATION_AT) if (this.prevLeft > a && left <= a) {
      const d = this.room.bosses[0].hp / C.BOSS_HP - this.room.bosses[1].hp / C.BOSS_HP;
      this.emit([Math.abs(d) >= C.SITUATION_DIFF ? this.say('sit_lead', { 組: [d > 0 ? 0 : 1], n: a / 60 }) : this.say('sit_even', { n: a / 60 })]);
    }
    for (const a of C.END_WARN_AT) if (this.prevLeft > a && left <= a) this.emit([this.say(`left${a}`, {})]);
    this.prevLeft = left;
    for (const tr of [...this.tracks]) this.track(tr);
    this.timer += dt;
    if (this.timer >= M.every) { this.timer -= M.every; this.second(); }
  }

  // ---- 1秒ごと ----
  private second() {
    const room = this.room, obs = room.obstacles(), now = this.now;
    decay(this.attn, M.every);
    const chars = [...room.players.values()].filter((p) => !p.assist);
    // 視界: 敵チームの視界に入った（初登場）、敵大将に接近（大将側に見えたときだけ）
    for (const p of chars) {
      if (!p.alive) { this.seen.set(p.id, false); continue; }
      const vis = room.visibleTo(1 - p.team, p.x, p.y, obs);
      if (vis && !this.seen.get(p.id) && now - (this.spotAt.get(p.id) ?? -Infinity) >= M.spotCd) { this.spotAt.set(p.id, now); this.event([p.id], M.attn.spot, []); }
      this.seen.set(p.id, vis);
      const boss = room.bosses[1 - p.team];
      if (vis && Math.hypot(boss.x - p.x, boss.y - p.y) <= M.bossNearR && now - (this.nearAt.get(p.id) ?? -Infinity) >= M.bossNearCd) {
        this.nearAt.set(p.id, now);
        this.event([p.id], M.attn.bossNear, [this.say('play_boss_near', { A: p.char, 大将: 1 - p.team })]);
      }
    }
    // 戦闘: 離脱・追跡・終了
    for (const b of [...this.battles]) this.battleSecond(b);
    // 全員反省中が解けたら、次の全員反省中をまた喋れる
    for (const t of [0, 1]) if (chars.some((p) => p.team === t && p.alive)) this.alldown[t] = false;
    this.evalFocus();
    // 平時の話題
    if (this.focus === null && now - this.lostAt >= M.idleDelay && now - this.idleAt >= M.idleEvery) this.idle();
  }

  private battleSecond(b: Battle) {
    const room = this.room, now = this.now;
    const prev = new Map(b.dist), cur = (id: string) => b.dist.get(id) ?? Infinity;
    for (const id of b.members) { const p = room.players.get(id); if (p?.alive) b.dist.set(id, Math.hypot(p.x - b.x, p.y - b.y)); }
    for (const id of [...b.members]) {
      const p = room.players.get(id);
      if (!p || !p.alive) continue;
      const d = cur(id);
      if (d > M.battleR) { // 離脱（生存のまま＝逃走）
        b.members.delete(id);
        if (p.hp <= room.maxHp(p) * M.lowHp) b.lowEsc = p.char;
        if (b.chasing?.b === id) { const a = b.chasing.a; b.chasing = null; this.focusSay([id, a], [this.say('chase_escape', { A: this.char(a), B: p.char })]); }
        continue;
      }
      // 追跡: 中心から離れる向きに動く参加者に、後ろ（中心寄り）の敵が chaseGap 以内で chaseSec 秒以上ついていく
      if (d <= (prev.get(id) ?? d) || b.said.has('chase')) continue;
      for (const aid of b.members) {
        const a = room.players.get(aid), key = `${aid}>${id}`;
        if (!a || !a.alive || a.team === p.team || Math.hypot(a.x - p.x, a.y - p.y) > M.chaseGap || cur(aid) >= d || cur(aid) < (prev.get(aid) ?? Infinity)) { b.follow.delete(key); continue; }
        const s = (b.follow.get(key) ?? 0) + M.every;
        b.follow.set(key, s);
        if (s < M.chaseSec) continue;
        b.chasing = { a: aid, b: id };
        b.said.add('chase');
        this.focusSay([aid, id], [this.say('chase_start', { A: a.char, B: p.char })]);
        break;
      }
    }
    if (now - b.last < M.battleEnd) return;
    // 戦闘の終了: 保留中の撃破を先に喋り、まとめ
    if (b.pend) { const k = b.pend; b.pend = null; this.single(k); }
    this.battles = this.battles.filter((x) => x !== b);
    const alive = [...room.players.values()].filter((p) => !p.assist && p.alive && Math.hypot(p.x - b.x, p.y - b.y) <= M.battleR);
    const s = summary({ chain: b.chain, kills: b.kills, alive: alive.map((p) => ({ id: p.char, team: p.team })), hurt: [...b.hurt], lowEsc: b.lowEsc });
    if (!s) return;
    const ids = [...b.members, ...alive.map((p) => p.id)];
    if (s.k.startsWith('sum_')) { // 撃破のまとめは喋った人の id で引く
      if (s.a.A) { const p = [...room.players.values()].find((q) => q.char === s.a.A); if (p) ids.push(p.id); }
    }
    if (this.focusSay(ids, [this.say(s.k, s.a)])) this.board();
  }

  // ---- 戦闘 ----
  damage(v: Player, atk: Player | null, dmg: number, how: string) {
    const now = this.now;
    this.add(v.id, M.attn.dmg);
    if (atk) {
      this.add(atk.id, M.attn.dmg);
      const log = (this.dmgLog.get(v.id) ?? []).filter((x) => now - x.t <= M.comboWin);
      log.push({ by: atk.id, t: now, d: dmg });
      this.dmgLog.set(v.id, log);
      if (how !== '通常攻撃') for (const tr of this.tracks) if (tr.p === atk) tr.hit.add(v.id);
    }
    this.evalFocus();
    if (atk?.assist && now - (this.rampAt.get(atk.id) ?? -Infinity) >= M.rampageCd && this.focusSay([atk.id], [this.say('play_rampage', { 助っ人: atk.char })])) this.rampAt.set(atk.id, now);
    if (!atk || atk.assist || v.assist || atk.team === v.team) return;
    const b = this.battles.find((x) => Math.hypot(v.x - x.x, v.y - x.y) <= M.battleR);
    if (!b) {
      const members = new Set([...this.room.players.values()].filter((p) => !p.assist && p.alive && Math.hypot(p.x - v.x, p.y - v.y) <= M.battleR).map((p) => p.id));
      members.add(atk.id); members.add(v.id);
      const nb: Battle = { x: v.x, y: v.y, members, last: now, kills: [], pend: null, chain: false, said: new Set(), hurt: new Set([v.team]), lowEsc: null, dist: new Map(), follow: new Map(), chasing: null };
      this.battles.push(nb);
      const cnt = [0, 1].map((t) => [...members].filter((id) => this.room.players.get(id)?.team === t).length);
      const k = engageKind(cnt[0], cnt[1]);
      this.focusSay([...members], [this.say(k, k === 'engage_1' ? { A: atk.char, B: v.char } : {})]);
      return;
    }
    b.last = now; b.hurt.add(v.team);
    b.x += (v.x - b.x) * 0.3; b.y += (v.y - b.y) * 0.3;
    for (const p of [atk, v]) {
      if (b.members.has(p.id)) continue;
      b.members.add(p.id);
      if (b.said.has('join')) continue;
      b.said.add('join');
      this.focusSay([p.id], [this.say('join', { A: p.char, 組: [p.team] })]);
    }
  }

  // 撃破（パワーアップ中に倒された＝元に戻るものはここに来ない）。raw: スロットの罰（撃破として実況しない）
  kill(v: Player, killer: Player | undefined, how: string, raw: boolean) {
    const room = this.room, now = this.now;
    const vStreak = this.streak.get(v.id) ?? 0;
    this.streak.set(v.id, 0);
    if (!v.assist && ![...room.players.values()].some((p) => p.team === v.team && !p.assist && p.alive) && !this.alldown[v.team]) {
      this.alldown[v.team] = true;
      this.emit([this.say('alldown', { 組: [v.team] })]);
    }
    if (raw) return;
    for (const p of room.players.values()) if (p === v || p === killer || (p.alive && (Math.hypot(p.x - v.x, p.y - v.y) <= M.killR || (killer && Math.hypot(p.x - killer.x, p.y - killer.y) <= M.killR)))) this.attn.set(p.id, M.attn.max);
    this.evalFocus();
    if (!killer) { this.focusSay([v.id], [this.say('kill_boss', { 大将: 1 - v.team, B: v.char })]); return; }
    if (killer.assist) { this.focusSay([v.id, killer.id], [this.say('kill_by_assist', { 助っ人: killer.char, B: v.char })]); return; }
    if (v.assist) { this.focusSay([killer.id, v.id], [this.say('kill_assist', { A: killer.char, 助っ人: v.char })]); return; }
    // 通常の撃破
    const kStreak = (this.streak.get(killer.id) ?? 0) + 1;
    this.streak.set(killer.id, kStreak);
    this.kills.set(killer.id, (this.kills.get(killer.id) ?? 0) + 1);
    const revenge = this.lastVictim.get(v.id) === killer.id;
    this.lastVictim.set(killer.id, v.id);
    const first = !this.firstKill;
    this.firstKill = true;
    const b = this.battles.find((x) => x.members.has(v.id) || x.members.has(killer.id));
    const cnt = (t: number) => (b ? [...b.members].filter((id) => { const p = room.players.get(id); return p && p.team === t && (p.alive || p === v); }).length : 0);
    // 連携: 撃破者以外の味方で、直近 comboWin 秒に最大HPの comboRatio 以上を与えた最大の1人
    const share = new Map<string, number>();
    for (const x of this.dmgLog.get(v.id) ?? []) if (now - x.t <= M.comboWin && x.by !== killer.id) share.set(x.by, (share.get(x.by) ?? 0) + x.d);
    const [cid, cd] = [...share].filter(([id]) => { const p = room.players.get(id); return p && p.team === killer.team && !p.assist; }).sort((u, w) => w[1] - u[1])[0] ?? [null, 0];
    const combo = cid !== null && cd >= room.maxHp(v) * M.comboRatio;
    const ctx: KillCtx = {
      first, wanted: room.teams[v.team].wanted === v.id, victimStreak: vStreak, killerStreak: kStreak, revenge,
      lowHp: killer.hp <= room.maxHp(killer) * M.lowHp, combo, chase: !!b?.chasing && b.chasing.a === killer.id && b.chasing.b === v.id,
      n: b ? cnt(killer.team) : 0, m: b ? cnt(v.team) : 0,
    };
    this.dmgLog.delete(v.id);
    const body = this.say(how === CHARS[killer.char]?.skill.name ? 'kill_skill' : 'kill_normal', { A: killer.char, B: v.char, 技: killer.char });
    const add = killAddon(b ? ctx : { ...ctx, n: 0, m: 0 });
    const k: Kill = { k: killer, v, t: now, says: [body, add ? this.say(add, { A: killer.char, B: v.char, C: cid ? this.char(cid) : undefined }) : null].filter((x): x is Say => !!x) };
    if (!b) return this.single(k);
    b.kills.push({ k: killer.char, kt: killer.team, vt: v.team });
    if (b.chain) return; // 連続になった戦闘の以降の撃破はまとめへ
    if (b.pend) { // 1秒以内に次の撃破: 連続
      b.pend = null; b.chain = true;
      this.focusSay([...b.members], [this.say('multi', {})]);
      return;
    }
    b.pend = k;
  }
  private single(k: Kill) {
    if (this.focusSay([k.k.id, k.v.id], k.says)) this.board();
  }
  private board() {
    if (this.now - this.boardAt < M.boardCd) return;
    const alive = [0, 1].map((t) => [...this.room.players.values()].filter((p) => p.team === t && !p.assist && p.alive).length);
    const r = board(alive, this.behind);
    this.behind = r.behind;
    if (!r.say) return;
    this.boardAt = this.now;
    this.emit([this.say(r.say.k, r.say.a)]);
  }

  // ---- 個別プレー ----
  courier(p: Player) {
    this.courierTeam = p.team;
    this.event([p.id], M.attn.courier, [this.say('play_courier', { A: p.char })]);
  }
  pickup(p: Player, kind: string) {
    const steal = this.courierTeam !== null && this.courierTeam !== p.team;
    this.courierTeam = null;
    this.event([p.id], M.attn.box, [this.say(kind === 'box_ult' ? 'play_box_ult' : 'play_box_assist', { A: p.char, 組: [p.team] }), steal ? this.say('play_steal', {}) : null]);
  }
  entDown(p: Player, e: Ent, aa: boolean) {
    if (aa && e.kind === 'funnel') this.event([p.id], M.attn.dodge, [this.say('play_funnel', { A: p.char })]);
  }
  assistIn(a: Player, quiet: boolean) {
    if (!quiet) this.event([a.id], M.attn.assistIn, [this.say('play_assist_in', { 組: [a.team], 助っ人: a.char })]);
  }
  assistUp(a: Player) { this.focusSay([a.id], [this.say('play_assist_up', { 助っ人: a.char })]); }

  // 回避の判定: 技の発動から終わりまで、判定範囲に入った敵を記録し、終わったときに被弾していなければ回避
  skill(p: Player) {
    if (this.tracks.some((t) => t.p === p)) return;
    const z = this.zone(p);
    if (!z) return;
    const tr: Track = { p, at: this.now, cand: new Set(), hit: new Set(), ...z };
    this.tracks.push(tr);
    this.track(tr);
  }
  private track(tr: Track) {
    const room = this.room, p = tr.p;
    for (const id of tr.zone()) tr.cand.add(id);
    if (tr.active() && p.alive) return;
    this.tracks = this.tracks.filter((x) => x !== tr);
    if (p.char === 'zunko') for (const id of tr.cand) { const q = room.players.get(id), m = q?.st.mochi; if (m && m.until - CHARS.zunko.skill.dur >= tr.at) tr.hit.add(id); } // ずんだアローはダメージではなく餅で被弾
    const ev = evaded(tr.cand, tr.hit, (id) => !!room.players.get(id)?.alive);
    for (const id of ev) this.add(id, M.attn.dodge);
    this.evalFocus();
    const who = ev.find((id) => id === this.focus);
    if (who) this.focusSay([who], [this.say('play_dodge', { B: this.char(who), 技: p.char })]);
  }
  // 技ごとの判定範囲（進路・警告帯・範囲）と、技が続いているか。吹雪（即時）・加速（ダメージなし）・ファンネル（撃墜で別に実況）・死神の鎌（透明化中は見えない）は対象外
  private zone(p: Player): { active: () => boolean; zone: () => string[] } | null {
    const room = this.room, S = CHARS[p.char]?.skill, foes = (list: any[]) => list.filter((t) => t.k === 'p' && !t.o.assist).map((t) => t.o.id as string);
    const R = C.PLAYER_RADIUS;
    switch (p.char) {
      case 'hanamaru': {
        const start = foes(room.inRectAhead(p, room.aimOf(p), S.range, S.r * 2));
        let first = true;
        const fists = () => room.ents.filter((e) => e.kind === 'fist' && e.owner === p.id);
        return { active: () => fists().length > 0, zone: () => { const out = first ? start : []; first = false; return [...out, ...fists().flatMap((f) => foes(room.enemyThings(p.team).filter((t) => Math.hypot(t.x - f.x, t.y - f.y) <= S.r + t.r + R)))]; } };
      }
      case 'aru': return {
        active: () => !!(p.st.charge || room.stat(p, 'rush')),
        zone: () => p.st.charge ? foes(room.inRectAhead(p, p.sk.a, room.speedOf(p) * S.speed * S.dur, S.w)) : room.stat(p, 'rush') ? foes(room.enemyThings(p.team).filter((t) => inDashShape(S, t.x, t.y, p.x, p.y, p.sk.a, t.r))) : [],
      };
      case 'bii': {
        let first = true;
        return { active: () => !!p.st.phantom, zone: () => { if (!first || !p.sk.phantom) return []; first = false; return foes(room.inRectAhead(p, p.sk.phantom.a, S.range, R * 2)); } };
      }
      case 'metan': return { active: () => !!room.stat(p, 'drill'), zone: () => (room.stat(p, 'drill') ? foes(room.inRectAhead(p, room.aimOf(p), S.len, S.w)) : []) };
      case 'sayo': return { active: () => !!room.stat(p, 'dance'), zone: () => (room.stat(p, 'dance') ? foes(room.inCircle(p, p.x, p.y, S.r)) : []) };
      case 'zunko': {
        let first = true;
        return { active: () => room.shots.some((s) => s.owner === p.id && s.kind === 'arrow'), zone: () => { if (!first) return []; first = false; return foes(room.inRectAhead(p, room.aimOf(p), S.range, (C.BULLET_RADIUS + R) * 2)); } };
      }
      case 'kiritan': return {
        active: () => !!p.st.lockon || !!p.sk.volleys?.length || room.ents.some((e) => e.kind === 'missile' && e.owner === p.id),
        zone: () => ((p.sk.marks ?? []) as string[]).filter((id) => id.startsWith('p:')).map((id) => id.slice(2)).filter((id) => !room.players.get(id)?.assist),
      };
      default: return null;
    }
  }

  // ---- 6章の全体 ----
  bossHit(boss: { team: number; hp: number }) {
    const r = boss.hp / C.BOSS_HP, said = this.bossSaid[boss.team];
    const crossed = M.bossHpAt.filter((th) => r < th && !said.has(th));
    if (crossed.length) { for (const th of crossed) said.add(th); const th = Math.min(...crossed); this.emit([this.say(`boss${Math.round(th * 100)}`, { 大将: boss.team })]); }
    const [a, b] = this.room.bosses.map((x) => x.hp / C.BOSS_HP), lead = a > b ? 0 : b > a ? 1 : null;
    if (lead === null) return;
    if (this.leader !== null && lead !== this.leader && this.now - this.reverseAt >= M.reverseCd) { this.reverseAt = this.now; this.emit([this.say('reverse', { 組: [lead] })]); }
    this.leader = lead;
  }
  bossWarn(boss: { team: number }) { this.emit([this.say('boss_warn', { 大将: boss.team })]); }
  bossMoved(boss: { team: number }, first: boolean) { this.emit([this.say(first ? 'boss_form2' : 'boss_move', { 大将: boss.team })]); }
  slot(team: number, chain: number, kind: string) {
    this.wins[team].push(this.now);
    this.emit([this.say(chain >= 2 ? 'slot_chain' : kind === 'ult' ? 'slot_ult' : 'slot_assist', { 組: [team] })]);
  }
  penalty(team: number, kind: string) { this.emit([this.say(`pen_${kind}`, { 組: [team] })]); }

  // 統計: 徳の増減（獲得量・悪行の累計）
  tokuBy(p: Player, d: number) {
    if (d > 0) this.toku.set(p.id, (this.toku.get(p.id) ?? 0) + d);
    else this.bad.set(p.id, (this.bad.get(p.id) ?? 0) - d);
  }

  // ---- 4章 平時 ----
  private idle() {
    const room = this.room, now = this.now;
    const chars = [...room.players.values()].filter((p) => !p.assist);
    const top = (m: Map<string, number>) => [...m].filter(([id, v]) => v > 0 && room.players.get(id)).sort((u, v) => v[1] - u[1])[0];
    const says: Record<string, () => Say | null> = {
      toku: () => { const t = room.teams.map((x) => Math.round(x.toku)), lead = t[0] > t[1] ? 0 : t[1] > t[0] ? 1 : null; const o = lead ?? 0; return this.say('idle_toku', { 組: [o, 1 - o], n: t[o], m: t[1 - o] }, lead === null ? [0] : undefined); },
      bosshp: () => { if (now < M.bossHpAfter) return null; const r = room.bosses.map((b) => b.hp / C.BOSS_HP), low = r[0] <= r[1] ? 0 : 1; return r[0] === r[1] ? this.say('idle_bosshp', { 大将: low, n: r[low] * 10 }, [0]) : this.rnd() < 0.5 ? this.say('idle_bosshp', { 大将: low, n: r[low] * 10 }, [0]) : this.say('idle_bosshp', { 大将: 1 - low }, [1]); },
      slot: () => { const hot = [0, 1].find((t) => this.wins[t].filter((x) => now - x <= M.slotHot).length >= 2); if (hot !== undefined) return this.say('idle_slot', { 組: [hot] }, [1]); const dry = [0, 1].find((t) => now - (this.wins[t].at(-1) ?? 0) >= M.slotDry); return dry !== undefined ? this.say('idle_slot', { 組: [dry] }, [0]) : null; },
      wanted: () => { const w = room.teams.map((t) => room.players.get(t.wanted ?? '')).find((p) => p?.alive); return w ? this.say('idle_wanted', { A: w.char }) : null; },
      wall: () => { const side = [0, 1].map((s) => room.broken.filter(([x]) => (x < MAP.width / 2 ? 0 : 1) === s).length / (this.walls[s] || 1)); const s = side[0] >= side[1] ? 0 : 1; if (side[s] < M.wallRatio) return null; return this.say('idle_wall', { 組: [s] }, (room.broken.length / (this.walls[0] + this.walls[1] || 1)) >= M.wallRatio ? undefined : [0]); },
      courier: () => { const c = room.couriers[0]; if (!c) return null; const at = roomAt(c.x, c.y); return at ? this.say('idle_courier', { 場所: at }) : this.say('idle_courier', {}, [1]); },
      loot: () => { const cnt = new Map<string, number>(); for (const m of room.materials) { const r = roomAt(m.x, m.y); if (r) cnt.set(r, (cnt.get(r) ?? 0) + 1); } const best = [...cnt].sort((u, v) => v[1] - u[1])[0]; return best && best[1] >= M.lootMin ? this.say('idle_loot', { 場所: best[0] }) : null; },
      reflect: () => { const n = [0, 1].map((t) => room.reflecting(t)), t = n[0] >= n[1] ? 0 : 1; return n[t] > 0 ? this.say('idle_reflect', { 組: [t], n: n[t] }) : null; },
      killer: () => { const k = top(this.kills); return k ? this.say('idle_killer', { A: this.char(k[0]), n: k[1] }) : null; },
      tokuTop: () => { const k = top(this.toku); return k ? this.say('idle_toku_top', { A: this.char(k[0]) }) : null; },
      bad: () => { const k = top(this.bad); return k ? this.say('idle_bad', { A: this.char(k[0]) }) : null; },
    };
    const trivia = [...new Set(chars.map((p) => p.char))].filter((c) => patterns(`trivia:${c}`).length > 0);
    // 言うことがない話題は飛ばす（判定のために一度作る。パターン選びの記録は選んだ話題だけ残す）
    const saved = new Map(this.lastPat), cand = new Map<string, Say>();
    for (const t of TOPICS) { const s = says[t](); if (s) cand.set(t, s); }
    this.lastPat = saved;
    const r = pickTopic(this.rot, this.topic, new Set(cand.keys()), trivia.length > 0, this.rnd());
    if (!r.topic) return;
    this.idleAt = now;
    this.topic = r.topic;
    this.rot = r.rot;
    if (r.topic === 'trivia') { const c = trivia[Math.floor(this.rnd() * trivia.length)]; this.emit([this.say(`trivia:${c}`, {})]); return; }
    const s = cand.get(r.topic)!;
    this.lastPat.set(s.k, s.p);
    this.emit([s]);
  }
}
