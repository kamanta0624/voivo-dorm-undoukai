// 実況ディレクター（docs/commentary_spec.md）。判定はすべてここ。出来事のフック（GameRoom から呼ぶ）と1秒ごとの軽い更新で状態を持ち、
// 実況のタイムライン（今何を喋っていて、いつ言い終わるか）もここで持つ。言い始める時に、その内容だけを小さなメッセージ 'cm'（イベントキー＋部品のID。座標は送らない）として全員に送る。判定ロジックは純粋関数に切り出してある
import { readFileSync } from 'node:fs';
import type { GameRoom, Player, Ent } from './GameRoom';
import { PERIMETER } from './GameRoom';
import { CONFIG as C } from '../shared/config';
import { CHARS } from '../shared/chars';
import { inDashShape } from '../shared/geom';
import { Args, Say, Utter, priority, patterns, keep, clips, topicOf } from '../shared/commentary';
import MAP from '../shared/map.json';

const M = C.CM;
// 部品の長さ（npm run cm:audio が作る public/commentary/cm.json。ない部品は文字数から見積もる）
let TABLE: Record<string, [number, number]> = {};
try { TABLE = JSON.parse(readFileSync(new URL('../../public/commentary/cm.json', import.meta.url), 'utf8')).clips; } catch {}
export const durOf = (s: Say[]) => s.flatMap((x) => clips(x)).reduce((a, c) => a + (TABLE[c.text]?.[1] ?? c.text.length * M.charSec), 0);

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
// つなぎの盤面コメント選び（4章）: 話題ごとの候補（言えるパターンと値の署名）から、直前と同じ話題を避け、前回言ってから値が変わった話題を優先してランダムに1つ
export type Topic = { topic: string; sig: string; says: Say[] };
export function pickBoard(cands: Topic[], last: string | null, lastSig: Map<string, string>, r: number): Topic | null {
  let list = cands.filter((c) => c.says.length && c.topic !== last);
  if (!list.length) list = cands.filter((c) => c.says.length);
  const fresh = list.filter((c) => lastSig.get(c.topic) !== c.sig);
  if (fresh.length) list = fresh;
  return list[Math.floor(r * list.length)] ?? null;
}
// 試合の流れ（盤面コメント）: hist は1秒ごとの優劣（陣営0から見た両大将のHP割合の差、新しいものが最後）
export function flow(hist: number[]): { p: number; team?: number } | null {
  const F = M.flow, last = hist.at(-1);
  if (last === undefined) return null;
  if (Math.abs(last) < F.even) return { p: 1 };
  const win = hist.slice(-F.pace), team = last > 0 ? 0 : 1;
  const old = hist.at(-1 - F.widenWin);
  if (old !== undefined && Math.sign(old) === Math.sign(last) && Math.abs(last) - Math.abs(old) >= F.widen) return { p: 2, team };
  if (win.length >= F.pace && win.every((d) => (team === 0 ? d > 0 : d < 0))) return { p: 0, team };
  return null;
}
// 試合後の総評（7-1）: hist は1秒ごとの [残り秒数, 優劣（陣営0から見た両大将のHP割合の差）]、winner: 0,1=陣営 2=引き分け、last: 最終の優劣
export function review(hist: [number, number][], winner: number, last: number): { k: string; a: Args } {
  const R = M.review, sgn = winner === 1 ? -1 : 1;
  if (winner !== 2) {
    if (hist.some(([left, d]) => left <= R.late && sgn * d <= -R.behind)) return { k: 'rev_late', a: {} };
    if (hist.some(([, d]) => sgn * d <= -R.behind)) return { k: 'rev_comeback', a: {} };
  }
  let swaps = 0, prev = 0;
  for (const [, d] of hist) { const sg = Math.sign(d); if (sg && prev && sg !== prev) swaps++; if (sg) prev = sg; }
  if (swaps >= R.swaps) return { k: 'rev_seesaw', a: {} };
  if (winner === 2 || Math.abs(last) < R.close) return { k: 'rev_close', a: {} };
  if (Math.abs(last) < R.near) return { k: 'rev_near', a: {} };
  if (swaps === 0 && Math.abs(last) >= R.oneSided) return { k: 'rev_onesided', a: { 組: [winner] } };
  return { k: 'rev_good', a: {} };
}
// 活躍したキャラ（7-2）: 値が最大のキャラ（0以下は数えない）。同点は全員
export function leaders(m: Map<string, number>): { ids: string[]; v: number } | null {
  const list = [...m].map(([id, v]) => [id, Math.round(v * 100) / 100] as const).filter(([, v]) => v > 0);
  if (!list.length) return null;
  const v = Math.max(...list.map(([, x]) => x));
  return { ids: list.filter(([, x]) => x === v).map(([id]) => id), v };
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

type Kill = { k: Player; v: Player; t: number; says: Say[]; b?: Battle };
type Q = { u: Utter; at: number; seq: number; keep: boolean; bt?: Battle }; // 待っている発話（at: 発生時刻、bt: 同じ戦闘の単発撃破＝連続・まとめに統合されるもの）
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
  prefix: { k: string; place: string; at: number } | null = null; // 続くセリフ待ちの場所のセリフ（k: pre_t1=型1 状況→場所 / pre_t2=型2 場所→状況）
  held = new Map<string, { list: Say[]; o: { bt?: Battle; merge?: Battle }; at: number }>(); // フォーカス外で言えなかった状況のセリフ（対象 id → 最新）。その対象へフォーカスが移ったら場所のセリフとまとめて言う
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
  reachSpin = [-1, -1]; reachAt = [-Infinity, -Infinity]; reachWait: (number | null)[] = [null, null]; wins: number[][] = [[], []]; // reachWait: 言うのを待っているリーチ（その回転の開始時刻）
  boardAt = -Infinity; behind: number | null = null; alldown = [false, false];
  walls: number[] = [0, 0]; // 陣営側ごとの壊せる壁タイル数（壁の壊れ方の話題）
  // タイムライン（実況の時計。試合前後も進む）
  clock = 0; busyUntil = 0; speaking = false; q: Q[] = []; seq = 0; noFill = false; noFillAt = 0; lastFill = false;
  topicAt = new Map<string, number>(); // 話題カテゴリ（topicOf）→ 最後に言い始めた時刻（実況の時計）。CM.topicCd 秒は同じ話題を出さない
  durOf = durOf; // 発話の長さ（秒）
  // つなぎ: 使ったパターン（k:p）、雑談の使用済み、直前の話題と話題ごとの前回の値、盤面と雑談の交互
  used = new Set<string>(); chatUsed = new Set<string>(); topic: string | null = null; topicSig = new Map<string, string>();
  adv: [number, number][] = []; // 1秒ごとの [残り秒数, 優劣]（試合の流れ・総評）
  bossDmg = new Map<string, number>(); assistHitAt = new Map<string, number>(); // 統計: キャラごとの大将へのダメージ、助っ人が最後にダメージを与えた時刻

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
  // 発話を待ち行列に入れる。bt: 同じ戦闘の単発撃破、merge: この戦闘の待っている単発撃破を捨てて統合する（連続・まとめ）
  private emit(list: (Say | null)[], o: { bt?: Battle; merge?: Battle } = {}) {
    const s = list.filter((x): x is Say => !!x);
    if (!s.length) return;
    if (o.merge) this.q = this.q.filter((x) => x.bt !== o.merge);
    this.q.push({ u: { pr: Math.max(...s.map((x) => priority(x.k))), s }, at: this.clock, seq: this.seq++, keep: s.some((x) => keep(x.k)), bt: o.bt });
    this.pump();
  }
  // 話題のクールタイム中か（決着・試合後は対象外）
  private cool = (k: string) => { const t = topicOf(k); return t !== null && this.clock - (this.topicAt.get(t) ?? -Infinity) < M.topicCd; };
  // 発話の本体（前置き以外）の話題がクールタイム中か。前置きだけの発話は前置きの話題で見る
  private coolU(u: Utter) { const main = u.s.filter((x) => topicOf(x.k) !== 'pre'); return (main.length ? main : u.s).some((x) => this.cool(x.k)); }
  // 言い始める: 全員に送り、言い終わる時刻を決める。クールタイム中の前置きは外す
  private send(u: Utter) {
    this.lastFill = !!u.fill; // 直前の発話がつなぎか（リーチの条件）
    if (u.s.length > 1) { const s = u.s.filter((x) => topicOf(x.k) !== 'pre' || !this.cool(x.k)); if (s.length) u = { ...u, s }; }
    for (const x of u.s) { const t = topicOf(x.k); if (t !== null) this.topicAt.set(t, this.clock); }
    const d = this.durOf(u.s);
    for (const c of this.room.clients) c.send('cm', u);
    this.log?.push(JSON.stringify({ t: +this.now.toFixed(1), c: +this.clock.toFixed(2), end: +(this.clock + d).toFixed(2), focus: this.focus && this.char(this.focus), attn: this.focus ? Math.round(this.attn.get(this.focus) ?? 0) : null, keys: u.s.map((x) => x.k), ps: u.s.map((x) => x.p), ...(u.fill ? { as: u.s.map((x) => x.a) } : {}), ...(u.fill ? { fill: true } : {}) }));
    this.busyUntil = this.clock + d;
    this.speaking = true;
    this.noFill = false;
  }
  // セリフの切れ目: フォーカスを判定し、待っているうち優先度が一番高い（同じなら古い）ものを言う。捨てない種類以外は発生から CM.drop 秒で捨てる。何もなく CM.fill.silence 秒黙ったら、つなぎ
  private pump() {
    if (this.clock < this.busyUntil) return;
    if (this.speaking) { this.speaking = false; this.evalFocus(); if (this.clock < this.busyUntil) return; } // フォーカス変更で言い始めた
    this.q = this.q.filter((x) => (x.keep || this.clock - x.at < M.drop) && !this.coolU(x.u)); // 同じ話題がクールタイム中のものは捨てる（種類によらず）
    const best = this.q.reduce<Q | null>((a, x) => (!a || x.u.pr > a.u.pr || (x.u.pr === a.u.pr && x.seq < a.seq) ? x : a), null);
    if (best) { this.q = this.q.filter((x) => x !== best); return this.send(best.u); }
    if (this.room.phase === 'playing' && this.reachFill()) return; // リーチは沈黙を待たない
    if (this.room.phase !== 'playing' || this.clock - this.busyUntil < M.fill.silence) return;
    if (this.prefix) { const p = this.prefix; this.prefix = null; if (!this.cool('pre_t1')) return this.send({ pr: priority('pre_t1'), s: [this.say('pre_t1', { 場所: p.place })!] }); } // 続くセリフが来ないまま黙ったら前置きだけ（つなぎの代わり）
    if (this.noFill && this.clock - this.noFillAt < M.every) return; // 候補がなければ CM.every 秒おきに探し直す
    const f = this.filler();
    if (f) this.send({ pr: priority(f.k), s: [f], fill: true });
    else { this.noFill = true; this.noFillAt = this.clock; this.log?.push(JSON.stringify({ t: +this.now.toFixed(1), c: +this.clock.toFixed(2), fillNone: true })); }
  }
  // 実況の時計を進める（試合前後も毎tick。GameRoom から）
  flow(dt: number) { this.clock += dt; this.pump(); }
  // フォーカス中の対象が関わるときだけ喋る（前置きが待っていれば前に付ける）
  // フォーカス外なら、状況のセリフとして対象ごとに取っておく（フォーカスが移ったら場所のセリフとまとめる）
  private focusSay(ids: string[], list: (Say | null)[], o: { bt?: Battle; merge?: Battle } = {}) {
    if (this.focus === null || !ids.includes(this.focus)) {
      const s = list.filter((x): x is Say => !!x);
      if (s.length) { for (const id of ids) this.held.set(id, { list: s, o, at: this.clock }); this.log?.push(JSON.stringify({ t: +this.now.toFixed(1), c: +this.clock.toFixed(2), held: s.map((x) => x.k), ids: ids.map((id) => this.char(id)) })); }
      return false;
    }
    this.emit(this.withPre(list), o);
    return true;
  }
  // 待っている場所のセリフを型どおりの順で付ける（型1: 状況→場所、型2: 場所→状況）
  private withPre(list: (Say | null)[]) {
    const p = this.prefix, alone = list.every((x) => !x), pre = p ? this.say(alone ? 'pre_t1' : p.k, { 場所: p.place }) : null; // 本文がなければ単独で言える型1
    this.prefix = null;
    return p?.k === 'pre_t1' ? [...list, pre] : [pre, ...list];
  }

  // ---- 注目度とフォーカス ----
  // フォーカスの開始・解除・移動の判定は、セリフの切れ目（喋っていない間）だけ
  private evalFocus() {
    if (this.clock < this.busyUntil) return;
    const prev = this.focus, r = nextFocus(this.focus, this.attn);
    if (!r.change) return;
    this.focus = r.focus;
    this.log?.push(JSON.stringify({ t: +this.now.toFixed(1), c: +this.clock.toFixed(2), focusChange: r.change, from: prev && this.char(prev), to: r.focus && this.char(r.focus), attn: r.focus ? Math.round(this.attn.get(r.focus) ?? 0) : null }));
    if (r.focus === null) { this.prefix = null; return; }
    const p = this.room.players.get(r.focus), place = p ? roomAt(p.x, p.y) : null;
    const same = r.change === 'move' && place !== null && place === this.focusRoom;
    this.focusRoom = place;
    this.prefix = same || !place ? null : { k: this.rnd() < M.preOrder ? 'pre_t1' : 'pre_t2', place, at: this.now };
    // 移った先の対象の、言えずに取ってあった状況のセリフ（M.drop 秒以内）を場所のセリフとまとめてすぐ言う
    // （フォーカス変更はセリフの切れ目なので、待っている他のセリフより先に言い始める。話題のクールタイム中なら捨てる）
    const h = this.held.get(r.focus);
    this.held.clear();
    if (!h || this.clock - h.at >= M.drop) return;
    const s = this.withPre(h.list).filter((x): x is Say => !!x), u = { pr: Math.max(...s.map((x) => priority(x.k))), s };
    const cool = this.coolU(u);
    this.log?.push(JSON.stringify({ t: +this.now.toFixed(1), c: +this.clock.toFixed(2), heldUse: !cool, keys: h.list.map((x) => x.k) }));
    if (cool) return;
    if (h.o.merge) this.q = this.q.filter((x) => x.bt !== h.o.merge);
    this.send(u);
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
  play() { this.emit([this.say('start', {})]); }
  // 決着演出の段ごと（GameRoom の finale）: 決着の瞬間に待っているものを捨てる。大将撃破は 爆発（boss）で大将撃破 → 止め（killer）で止めのキャラ → WIN（win）で勝った組、
  // 時間切れは 時間切れ（timeup）→ WIN で勝った組（引き分けは引き分け）。捨てない種類なので、喋り終わる前に次の段が来たら順に続ける
  finale(f: { kind: string; winner: number; stage: string; boss: { team: number } | null }, killer: Player | null) {
    this.log?.push(JSON.stringify({ t: +this.now.toFixed(1), c: +this.clock.toFixed(2), finale: f.stage }));
    if (f.stage === 'slow' || f.stage === 'timeup') { // 決着の瞬間: 待っているものを捨て、喋っている途中のセリフも打ち切る（演出の段に実況を合わせる）
      this.q = []; this.prefix = null; this.busyUntil = this.clock; this.speaking = false;
      for (const c of this.room.clients) c.send('cmStop', {});
    }
    if (f.stage === 'boss') this.emit([this.say('end_boss', { 大将: f.boss!.team })]);
    else if (f.stage === 'killer' && killer) this.emit([this.say('end_killer', { A: killer.char })]);
    else if (f.stage === 'timeup') this.emit([this.say('end_timeup', {})]);
    else if (f.stage === 'win') this.emit([f.winner === 2 ? this.say('end_draw', {}) : f.kind === 'boss' ? this.say('end_win', { 組: [f.winner] }) : this.say('end_time', { 組: [f.winner] })]);
  }
  // 決着演出の後: 総評 → 活躍したキャラ → 締め の順に続けて喋る（7章。捨てない。決着の実況は finale で済み）
  end(winner: number, kind: string) {
    const [a, b] = this.room.bosses.map((x) => x.hp / C.BOSS_HP), r = review(this.adv, winner, a - b);
    this.emit([this.say(r.k, r.a)]);
    for (const [key, m] of [['kill', this.kills], ['boss', this.bossDmg], ['toku', this.toku], ['bad', this.bad]] as const) {
      const top = leaders(m);
      if (!top) continue;
      const [x, y] = top.ids.map((id) => this.char(id)), n = Math.round(top.v);
      this.emit([top.ids.length === 1 ? this.say(`mvp_${key}`, { A: x, n }) : top.ids.length === 2 ? this.say(`mvp_${key}2`, { A: x, B: y, n }) : this.say(`mvp_${key}_many`, { n, m: top.ids.length })]);
    }
    this.emit([this.say('close', {})]);
  }

  // 毎tick（軽い処理だけ）: 撃破の保留・前置きの待ち・リーチ・形勢と残り時間。重い判定は CM.every 秒ごと
  tick(dt: number) {
    const now = this.now;
    for (const b of this.battles) if (b.pend && now - b.pend.t >= M.killHold) { const k = b.pend; b.pend = null; this.single(k); }
    if (this.prefix && now - this.prefix.at >= M.prefixWait) { const p = this.prefix; this.prefix = null; this.emit([this.say('pre_t1', { 場所: p.place })]); } // 単独なら型1の文言（型2「〜では」は続きがないと切れる）
    this.room.teams.forEach((t, team) => {
      const sl = t.slot;
      if (sl.payoutAt !== null || sl.pen || sl.holdUntil || this.reachSpin[team] === sl.start || now - sl.start < C.SLOT.stops[1] * C.SLOT.spin || sl.reels[0] !== sl.reels[1]) return;
      this.reachSpin[team] = sl.start;
      if (now - this.reachAt[team] < M.reachCd) return;
      this.reachWait[team] = sl.start; // リーチは待ち行列に入れず、雑談の直後の間（pump）でだけ言う
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
      const vis = room.visibleTo(1 - p.team, p.x, p.y, room.seeWalls); // 敵の画面に映ったか（視界の壁）
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
    // 優劣の記録（試合の流れ・総評）
    this.adv.push([room.timeLeft, room.bosses[0].hp / C.BOSS_HP - room.bosses[1].hp / C.BOSS_HP]);
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
    if (this.focusSay(ids, [this.say(s.k, s.a)], { merge: b })) this.board();
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
    if (atk?.assist) this.assistHitAt.set(atk.id, now);
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
    const k: Kill = { k: killer, v, t: now, b, says: [body, add ? this.say(add, { A: killer.char, B: v.char, C: cid ? this.char(cid) : undefined }) : null].filter((x): x is Say => !!x) };
    if (!b) return this.single(k);
    b.kills.push({ k: killer.char, kt: killer.team, vt: v.team });
    if (b.chain) return; // 連続になった戦闘の以降の撃破はまとめへ
    if (b.pend) { // 1秒以内に次の撃破: 連続
      b.pend = null; b.chain = true;
      this.focusSay([...b.members], [this.say('multi', {})], { merge: b });
      return;
    }
    b.pend = k;
  }
  private single(k: Kill) {
    if (this.focusSay([k.k.id, k.v.id], k.says, { bt: k.b })) this.board();
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
  // 技ごとの判定範囲（進路・警告帯・範囲）と、技が続いているか。吹雪（即時）・アップグレード（ダメージなし）・ファンネル（撃墜で別に実況）・死神の鎌（透明化中は見えない）は対象外
  private zone(p: Player): { active: () => boolean; zone: () => string[] } | null {
    const room = this.room, S = CHARS[p.char]?.skill, foes = (list: any[]) => list.filter((t) => t.k === 'p' && !t.o.assist).map((t) => t.o.id as string);
    const R = C.PLAYER_RADIUS;
    switch (p.char) {
      case 'hanamaru': {
        const start = foes(room.inRectAhead(p, room.aimOf(p), S.range, S.r * 2));
        let first = true;
        const fists = () => room.ents.filter((e) => e.kind === 'fist' && e.owner === p.id);
        return { active: () => !!p.st.fistCharge || fists().length > 0, zone: () => { const out = first ? start : []; first = false; return [...out, ...fists().flatMap((f) => foes(room.enemyThings(p.team).filter((t) => Math.hypot(t.x - f.x, t.y - f.y) <= f.r + t.r + R)))]; } }; // タメ中から拳が消えるまで
      }
      case 'aru': return {
        active: () => !!(p.st.charge || room.stat(p, 'rush')),
        zone: () => p.st.charge ? foes(room.inRectAhead(p, p.sk.a, room.speedOf(p) * S.speed * S.dur, S.w)) : room.stat(p, 'rush') ? foes(room.enemyThings(p.team).filter((t) => inDashShape(S, t.x, t.y, p.x, p.y, p.sk.a, t.r))) : [],
      };
      case 'bii': { // オーバードライブ: 予約した敵（終了まで被弾しなければ回避）
        const ov = () => room.ents.find((e) => e.kind === 'overload' && e.owner === p.id);
        return { active: () => !!ov(), zone: () => ((ov()?.marks ?? []) as { id: string }[]).filter((m) => m.id.startsWith('p:')).map((m) => m.id.slice(2)).filter((id) => !room.players.get(id)?.assist) };
      }
      case 'metan': return { active: () => !!room.stat(p, 'drill'), zone: () => (room.stat(p, 'drill') ? foes(room.inRectAhead(p, room.aimOf(p), S.len, S.w)) : []) };
      case 'sayo': return { active: () => !!room.stat(p, 'dance'), zone: () => (room.stat(p, 'dance') ? foes(room.inBodyCircle(p, S.r)) : []) };
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

  // 統計: キャラごとの大将へのダメージ（助っ人は数えない）
  bossDmgBy(p: Player, dmg: number) { if (!p.assist) this.bossDmg.set(p.id, (this.bossDmg.get(p.id) ?? 0) + dmg); }
  // 統計: 徳の増減（獲得量）・悪行の累計（bad: 悪行ポイントの増分、BAD_MULT 込み）
  tokuBy(p: Player, d: number, bad: number) {
    if (d > 0) this.toku.set(p.id, (this.toku.get(p.id) ?? 0) + d);
    else this.bad.set(p.id, (this.bad.get(p.id) ?? 0) + bad);
  }

  // スロットのリーチ（つなぎより低い優先度）: 直前の発話がつなぎ（雑談・盤面コメント）で、待っているセリフがないセリフの切れ目で言う（沈黙は待たない）。言う前にリールが止まって結果が確定していたら捨てる
  private reachFill() {
    const now = this.now;
    for (const team of [0, 1]) {
      const start = this.reachWait[team], sl = this.room.teams[team]?.slot;
      if (start === null) continue;
      if (!sl || sl.start !== start || now - start >= C.SLOT.stops[2] * C.SLOT.spin || sl.payoutAt !== null) { this.reachWait[team] = null; continue; } // 結果が確定した
      if (this.q.length || !this.lastFill || this.cool('slot_reach')) continue;
      this.reachWait[team] = null; this.reachAt[team] = now;
      this.send({ pr: priority('slot_reach'), s: [this.say('slot_reach', { 組: [team] })!] });
      return true;
    }
    return false;
  }

  // ---- 4章 つなぎ ----
  // フォーカス中は盤面コメント（短いもの）だけ、フォーカスなしは盤面コメントと雑談（CM.fill.board の割合）
  private filler(): Say | null {
    if (this.focus !== null) return this.boardFill(true);
    const [x, y] = this.rnd() < M.fill.board ? [() => this.boardFill(false), () => this.chatFill()] : [() => this.chatFill(), () => this.boardFill(false)];
    return x() ?? y();
  }
  // 雑談: 出場中のキャラ（助っ人を除く）から1人、まだ言っていない1本。同じ試合で繰り返さない
  private chatFill(): Say | null {
    if (this.cool('chat:')) return null;
    const chars = [...new Set([...this.room.players.values()].filter((p) => !p.assist).map((p) => p.char))];
    const cand = chars.flatMap((c) => patterns(`chat:${c}`).map((_, i) => ({ c, i })).filter(({ c, i }) => !this.chatUsed.has(`${c}:${i}`)));
    if (!cand.length) return null;
    const by = [...new Set(cand.map((x) => x.c))], c = by[Math.floor(this.rnd() * by.length)], list = cand.filter((x) => x.c === c), pick = list[Math.floor(this.rnd() * list.length)];
    this.chatUsed.add(`${pick.c}:${pick.i}`);
    return { k: `chat:${pick.c}`, p: pick.i, a: {} };
  }
  // 盤面コメント: 同じ試合で同じパターン（値の違いは問わない）を繰り返さない。話題ごとに使い切ったら、その話題の使用済みを戻す
  private boardFill(short: boolean): Say | null {
    const ok = (x: Say) => !short || this.durOf([x]) <= M.fill.short;
    const cands = this.topics().map((t) => {
      let says = t.says.filter((x) => ok(x) && !this.cool(x.k));
      const fresh = says.filter((x) => !this.used.has(`${x.k}:${x.p}`));
      if (!fresh.length && says.length) for (const x of patterns(says[0].k).keys()) this.used.delete(`${says[0].k}:${x}`);
      else says = fresh;
      return { ...t, says };
    });
    const t = pickBoard(cands, this.topic, this.topicSig, this.rnd());
    if (!t) return null;
    const x = t.says[Math.floor(this.rnd() * t.says.length)];
    this.used.add(`${x.k}:${x.p}`);
    this.topic = t.topic; this.topicSig.set(t.topic, t.sig);
    return x;
  }
  // 盤面コメントの話題（4-1）: 今言えるパターンと、値の署名（前回から変わったかの判定）
  topics(): Topic[] {
    const room = this.room, now = this.now, S = (k: string, p: number, a: Args = {}): Say => ({ k, p, a });
    const chars = [...room.players.values()].filter((p) => !p.assist);
    const top = (m: Map<string, number>) => [...m].filter(([id, v]) => v > 0 && room.players.get(id)).sort((u, v) => v[1] - u[1])[0];
    const out: Topic[] = [];
    const add = (topic: string, sig: any, says: (Say | null)[]) => out.push({ topic, sig: JSON.stringify(sig), says: says.filter((x): x is Say => !!x) });
    { const t = room.teams.map((x) => Math.round(x.toku)), d = room.teams[0].toku - room.teams[1].toku, lead = d > 0 ? 0 : 1, even = Math.abs(d) < 1;
      add('toku', t, [S('idle_toku', 0, { 組: [lead, 1 - lead], n: t[lead], m: t[1 - lead] }), even ? null : S('idle_toku', 1, { 組: [lead] }), even ? S('idle_toku', 2) : null]); }
    if (now >= M.bossHpAfter) { const r = room.bosses.map((b) => b.hp / C.BOSS_HP), low = r[0] <= r[1] ? 0 : 1, n = Math.round(r[low] * 10);
      add('bosshp', r.map((x) => Math.round(x * 10)), [S('idle_bosshp', 0, { 大将: low, n }), r[0] !== r[1] ? S('idle_bosshp', 1, { 大将: 1 - low }) : null, r.every((x) => x >= 0.9) ? S('idle_bosshp', 2) : null]); }
    { const f = flow(this.adv.map(([, d]) => d)); if (f) add('flow', f, [S('idle_flow', f.p, f.team !== undefined ? { 組: [f.team] } : {})]); }
    if (room.timeLeft >= M.timeMin) { const el = (C.MATCH_TIME - room.timeLeft) / C.MATCH_TIME, n = Math.floor(room.timeLeft / 60);
      add('time', n, [el < 1 / 3 ? S('idle_time', 0) : el < 2 / 3 ? S('idle_time', 1) : null, S('idle_time', 2, { n })]); }
    { const n = [0, 1].map((t) => room.reflecting(t)), t = n[0] >= n[1] ? 0 : 1;
      if (n[t] > 0) add('reflect', n, [S('idle_reflect', 0, { 組: [t], n: n[t] }), S('idle_reflect', 1, { 組: [t], n: chars.filter((p) => p.team === t && p.alive).length })]); }
    { const hot = [0, 1].find((t) => this.wins[t].filter((x) => now - x <= M.slotHot).length >= 2), dry = [0, 1].find((t) => now - (this.wins[t].at(-1) ?? 0) >= M.slotDry);
      add('slot', [hot, dry, this.wins[0].length, this.wins[1].length], [hot !== undefined ? S('idle_slot', 1, { 組: [hot] }) : null, dry !== undefined ? S('idle_slot', 0, { 組: [dry] }) : null, hot === undefined && dry === undefined && !this.wins[0].length && !this.wins[1].length ? S('idle_slot', 2) : null]); }
    { const pu = chars.filter((p) => p.alive && p.ult && !p.ult.pending), t = [0, 1].find((x) => pu.filter((p) => p.team === x).length >= 2), one = pu[0];
      if (one) add('power', pu.map((p) => p.id), [t !== undefined ? S('idle_power', 0, { 組: [t] }) : null, t === undefined ? S('idle_power', 1, { A: one.char }) : null]); }
    { const a = [...room.players.values()].find((p) => p.assist && p.alive);
      if (a) add('assist', a.id, [S('idle_assist', 0, { 組: [a.team], 助っ人: a.char }), now - (this.assistHitAt.get(a.id) ?? -Infinity) <= M.rampWin ? S('idle_assist', 1, { 助っ人: a.char }) : null]); }
    { const b = room.bosses.find((x) => x.moved); if (b) add('form', b.team, [S('idle_form', 0, { 大将: b.team })]); }
    { const w = room.teams.map((t) => room.players.get(t.wanted ?? '')).find((p) => p?.alive); if (w) add('wanted', w.id, [0, 1, 2].map((p) => S('idle_wanted', p, { A: w.char }))); }
    { const side = [0, 1].map((x) => room.broken.filter(([bx]) => (bx < MAP.width / 2 ? 0 : 1) === x).length / (this.walls[x] || 1)), sd = side[0] >= side[1] ? 0 : 1, all = room.broken.length / (this.walls[0] + this.walls[1] || 1);
      if (side[sd] >= M.wallRatio) add('wall', Math.round(all * 20), [S('idle_wall', 0, { 組: [sd] }), all >= M.wallRatio ? S('idle_wall', 1) : null, all >= M.wallRatio ? S('idle_wall', 2) : null]); }
    { const c = room.couriers[0]; if (c) { const at = roomAt(c.x, c.y); add('courier', at, [at ? S('idle_courier', 0, { 場所: at }) : null, S('idle_courier', 1), S('idle_courier', 2)]); } }
    { const cnt = new Map<string, number>(); for (const m of room.materials) { const r = roomAt(m.x, m.y); if (r) cnt.set(r, (cnt.get(r) ?? 0) + 1); }
      const best = [...cnt].sort((u, v) => v[1] - u[1])[0]; if (best && best[1] >= M.lootMin) add('loot', best[0], [S('idle_loot', 0, { 場所: best[0] }), S('idle_loot', 1)]); }
    { const k = top(this.kills); if (k) add('killer', k, [S('idle_killer', 0, { A: this.char(k[0]), n: k[1] }), S('idle_killer', 1, { A: this.char(k[0]) })]); }
    { const k = top(this.bossDmg), p = k && room.players.get(k[0]); if (k && p) add('bossdmg', k[0], [S('idle_bossdmg', 0, { 組: [1 - p.team], A: p.char })]); }
    { const k = top(this.toku); if (k) add('tokuTop', k[0], [0, 1].map((p) => S('idle_toku_top', p, { A: this.char(k[0]) }))); }
    { const k = top(this.bad); if (k) add('bad', k[0], [0, 1].map((p) => S('idle_bad', p, { A: this.char(k[0]) }))); }
    return out;
  }
}
