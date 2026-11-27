// 試合の記録部（handoff_botsim1）: 常時ON。試合開始（GAME START）で初期化し、決着で確定する。GameRoom は呼び出すだけ（ゲームの動きは変えない）
// summary(): JSON 化できる要約（結果画面 result1 の元データ）。GameRoom.matchlogDir があれば決着時に1回だけ <dir>/YYYYMMDD_<source>.jsonl へ1行追記する
import { appendFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { CONFIG as C } from '../shared/config';
import { roomAt } from './commentary';

const COMMIT = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } })();
export const BOT_STATES = ['fight', 'flee', 'recall', 'eat', 'courier', 'item', 'gather', 'boss', 'raid', 'guard', 'escort', 'ultraid', 'dead'] as const; // Bot の状態（botThink の分岐）。dead=撤退中。マクロの層（botai2）: guard=終盤の守り、escort=アシストに同行、ultraid=パワーアップ中の攻め
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100; // 徳の1秒ごと（1発 −0.06 などが 0.1 刻みだと丸めで合計がずれる）
const add = (a: number[], i: number, v: number) => { while (a.length <= i) a.push(0); a[i] += v; };

type CharRec = {
  id: string; char: string; team: number; human: boolean;
  dmg: { char: number; boss: number; courier: number; wall: number }; // 与ダメ（コバコは1発で倒れるので撃破数、壁は壊した段階の数）
  taken: { char: number; boss: number; penalty: number }; // 被ダメ（相手キャラ・アシスト／大将／スロットの罰）
  kills: number; deaths: number; assists: number; assistKills: number; tokuGain: number; tokuLoss: number; bad: number; skills: number; ults: number;
  deathRooms: (string | null)[]; states: Record<string, number>;
  series: { bossDmg: number[]; tokuGain: number[]; tokuLoss: number[] }; // 1秒ごと（添字＝試合の秒）
};
type Spin = { t: number; team: number; out: 'win' | 'pen' | 'miss'; reels: number[]; act: string | null; sym: { kind: string; char: string | null } | null; tier: number | null; pen: string | null };
type Ev = { t: number; team: number; char: string | null; type: string; foe: string | null };

export class MatchRec {
  on = false;
  startedAt = 0; seed: number | null = null;
  chars = new Map<string, CharRec>();
  spins: Spin[] = []; events: Ev[] = [];
  series = { toku: [] as number[][], bossHp: [] as number[][], bossPct: [] as number[][], assistBossDmg: [[], []] as number[][] };
  botState = new Map<string, string>();
  last: (Spin | null)[] = [null, null];
  result: any = null;

  start(room: any, seed: number | null) {
    Object.assign(this, { on: true, startedAt: Date.now(), seed, chars: new Map(), spins: [], events: [], botState: new Map(), last: [null, null], result: null, mats: [{}, {}] });
    this.series = { toku: [], bossHp: [], bossPct: [], assistBossDmg: [[], []] };
    for (const p of room.players.values()) if (!p.assist) this.ch(p);
    this.sample(room);
  }
  private ch(p: any): CharRec {
    let c = this.chars.get(p.id);
    if (!c) {
      c = { id: p.id, char: p.char, team: p.team, human: !p.bot, dmg: { char: 0, boss: 0, courier: 0, wall: 0 }, taken: { char: 0, boss: 0, penalty: 0 }, kills: 0, deaths: 0, assists: 0, assistKills: 0, tokuGain: 0, tokuLoss: 0, bad: 0, skills: 0, ults: 0, deathRooms: [], states: Object.fromEntries(BOT_STATES.map((s) => [s, 0])), series: { bossDmg: [], tokuGain: [], tokuLoss: [] } };
      this.chars.set(p.id, c);
    }
    c.char = p.char; if (!p.bot) c.human = true;
    return c;
  }
  private ev(room: any, team: number, char: string | null, type: string, foe: string | null) { this.events.push({ t: r1(room.now), team, char, type, foe }); }
  private sample(room: any) { this.series.toku.push(room.teams.map((t: any) => r1(t.toku))); this.series.bossHp.push(room.bosses.map((b: any) => r1(b.hp))); this.series.bossPct.push(room.bosses.map((b: any) => r1((b.hp / C.BOSS_HP) * 100))); }

  // 毎tick（playing）: Bot の状態の滞在時間、1秒ごとの推移
  tick(room: any, dt: number) {
    if (!this.on) return;
    for (const p of room.players.values()) {
      if (p.assist || !p.bot) continue;
      this.ch(p).states[p.alive ? this.botState.get(p.id) ?? 'raid' : 'dead'] += dt;
    }
    while (this.series.toku.length <= Math.floor(room.now)) this.sample(room);
  }
  bot(p: any, s: (typeof BOT_STATES)[number]) { if (this.on) this.botState.set(p.id, s); }
  // 徳: 実際にゲージが変わった量（上限・下限で打ち切られた分は数えない）。bad: 増えた悪行
  toku(room: any, p: any, d: number, bad: number) {
    if (!this.on || p.assist) return;
    const c = this.ch(p), s = Math.floor(room.now);
    if (d > 0) { c.tokuGain += d; add(c.series.tokuGain, s, d); } else if (d < 0) { c.tokuLoss -= d; add(c.series.tokuLoss, s, -d); }
    c.bad += bad;
  }
  hurt(v: any, by: any, raw: boolean, dmg: number) {
    if (!this.on || dmg <= 0) return;
    if (by && !by.assist) this.ch(by).dmg.char += dmg;
    if (!v.assist) this.ch(v).taken[by ? 'char' : raw ? 'penalty' : 'boss'] += dmg;
  }
  ko(room: any, v: any, killer: any) {
    if (!this.on) return;
    if (v.assist) { if (killer && !killer.assist) this.ch(killer).assistKills++; return; } // アシスト（召喚物）の撃破はイベントにしない
    const c = this.ch(v); c.deaths++; c.deathRooms.push(roomAt(v.x, v.y));
    this.ev(room, v.team, v.char, 'death', killer?.char ?? null);
    if (killer && !killer.assist) { this.ch(killer).kills++; this.ev(room, killer.team, killer.char, 'kill', v.char); }
    for (const [aid, t] of v.lastHitBy) { const a = room.players.get(aid); if (a && !a.assist && aid !== killer?.id && room.now - t <= C.ASSIST_WINDOW) this.ch(a).assists++; }
  }
  boss(room: any, p: any, dmg: number) {
    if (!this.on) return;
    const s = Math.floor(room.now);
    if (p.assist) add(this.series.assistBossDmg[p.team], s, dmg);
    else { const c = this.ch(p); c.dmg.boss += dmg; add(c.series.bossDmg, s, dmg); }
    if (!p.assist && dmg >= C.BOSS_HP * C.MATCHLOG.bossBig) this.ev(room, p.team, p.char, 'bossBig', String(r1(dmg)));
  }
  courier(room: any, p: any) { if (!this.on || p.assist) return; this.ch(p).dmg.courier++; this.ev(room, p.team, p.char, 'koba', null); }
  // 拾った資材（チームごと）: big＝コバコの資材、back の自陣／敵陣＝裏側の部屋の資材、front＝表側の資材
  mats = [{}, {}] as Record<string, number>[];
  mat(p: any, m: any) { if (!this.on) return; const own = p.team === 0 ? m.x < C.MAP_W / 2 : m.x > C.MAP_W / 2, k = m.big ? 'big' : m.hi ? (own ? 'backOwn' : 'backEnemy') : 'front'; this.mats[p.team][k] = (this.mats[p.team][k] ?? 0) + 1; }
  wall(p: any, n: number) { if (this.on && p && !p.assist) this.ch(p).dmg.wall += n; }
  skill(p: any) { if (this.on && !p.assist) this.ch(p).skills++; }
  ult(p: any) { if (this.on && !p.assist) this.ch(p).ults++; }
  // スロット: 回転の止まり（当落・出目）→ 当選なら払い出し（そろった図柄・段階）、罰なら種類。当選・罰はイベントにも
  spin(room: any, team: number, out: Spin['out'], reels: number[], act: string | null) {
    if (!this.on) return;
    const s: Spin = { t: r1(room.now), team, out, reels: [...reels], act: act ?? null, sym: null, tier: null, pen: null };
    this.spins.push(s); this.last[team] = s;
  }
  pay(room: any, team: number, kind: string, char: string | null, tier: number) {
    if (!this.on) return;
    const s = this.last[team];
    if (s) { s.sym = { kind, char }; s.tier = tier; }
    this.ev(room, team, null, 'slot', `${kind}${char ? ':' + char : ''}:${tier}`);
  }
  pen(room: any, team: number, kind: string) {
    if (!this.on) return;
    const s = this.last[team];
    if (s) s.pen = kind;
    this.ev(room, team, null, 'slot', `pen:${kind}`);
  }

  // 決着: 要約を確定し、出力先があれば1行追記
  end(room: any, kind: string, dir: string, source: 'human' | 'bot') {
    if (!this.on) return null;
    this.on = false;
    this.sample(room);
    for (const p of room.players.values()) if (!p.assist && room.dropped.has(p.id)) this.ch(p).human = true;
    const chars = [...this.chars.values()].map((c) => ({
      ...c, dmg: { char: r1(c.dmg.char), boss: r1(c.dmg.boss), courier: c.dmg.courier, wall: c.dmg.wall }, taken: { char: r1(c.taken.char), boss: r1(c.taken.boss), penalty: r1(c.taken.penalty) },
      tokuGain: r1(c.tokuGain), tokuLoss: r1(c.tokuLoss), bad: r1(c.bad), rage: r1(room.players.get(c.id)?.rage ?? 0), phys: room.players.get(c.id)?.phys ?? 'mid', badNow: r1(room.players.get(c.id)?.bad ?? 0),
      states: Object.fromEntries(Object.entries(c.states).map(([k, v]) => [k, r1(v)])),
      series: { bossDmg: c.series.bossDmg.map(r1), tokuGain: c.series.tokuGain.map(r2), tokuLoss: c.series.tokuLoss.map(r2) },
    }));
    const teams = [0, 1].map((t) => {
      const T = room.teams[t], b = room.bosses[t];
      return { macro: room.macros?.[t] ?? 'std', endDefend: !!room.endDefend?.[t], counterN: room.counterN?.[t] ?? 0, counterBoss: r1(room.counterBoss?.[t] ?? 0), mats: { big: 0, backOwn: 0, backEnemy: 0, front: 0, ...this.mats[t] }, toku: r1(T.toku), bossHp: r1(b.hp), bossPct: r1((b.hp / C.BOSS_HP) * 100), bossMoved: !!b.moved, bossDmg: { player: r1(room.bossDmg[t].player), assist: r1(room.bossDmg[t].assist) }, wanted: T.wanted ?? null, powerTier: T.powerTier ?? null, slotLv: T.m ? T.m.lv : null, slotMaxLv: T.m ? T.m.maxLv : null, holds: T.m ? T.m.holds?.length ?? null : T.slot?.holds?.length ?? null };
    });
    this.result = {
      v: 1, source, start: new Date(this.startedAt).toISOString(), seed: this.seed, commit: COMMIT, slotMode: C.SLOT_MODE,
      sec: r1(room.now), winner: room.winner, kind, teams, chars, spins: this.spins, events: this.events,
      series: { toku: this.series.toku, bossHp: this.series.bossHp, bossPct: this.series.bossPct, assistBossDmg: this.series.assistBossDmg.map((a) => a.map(r1)) },
    };
    if (dir) write(dir, source, this.result);
    return this.result;
  }
  summary() { return this.result; }
}

// logs/ の合計（MATCHLOG.maxBytes を超えたら書かずに警告。消さない）
function size(d: string): number {
  let n = 0;
  try { for (const e of readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? size(join(d, e.name)) : statSync(join(d, e.name)).size; } catch {}
  return n;
}
function write(dir: string, source: string, line: unknown) {
  const total = size(dirname(dir));
  if (total > C.MATCHLOG.maxBytes) { console.warn(`[matchlog] ${dirname(dir)}/ が ${(total / 2 ** 30).toFixed(2)}GB で上限 ${(C.MATCHLOG.maxBytes / 2 ** 30).toFixed(2)}GB を超えたので書かない`); return; }
  const d = new Date(), ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${ymd}_${source}.jsonl`), JSON.stringify(line) + '\n');
}
