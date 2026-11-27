// tune8 の「0. 仮説の確かめ」: 固定シードの Bot 戦（本番と同じ 中・std の Bot、通信なし）で、パワーアップ・アシスト・復帰直後の再撃破を数える
// ゲームのコードは変えず、記録部（MatchRec）と GameRoom の呼び出しを外から包んで数える。変更の前後で同じ種・同じ本数を回して比べる
// 実行: npx tsx verify/tune8_measure.ts [出力json]（既定 verify/evidence/tune8/measure.json）。表は標準出力（markdown）
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { GameRoom } from '../src/server/GameRoom';
import { MatchRec } from '../src/server/matchlog';
import NAMES from '../src/shared/chars.json';
import { CONFIG as C } from '../src/shared/config';

const SEEDS = Array.from({ length: 24 }, (_, i) => 8000 + i), OUT = process.argv[2] ?? 'verify/evidence/tune8/measure.json', REKILL = 10;
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

type Ep = { char: string; tier: number; start: number; end: number; dmgChar: number; dmgBoss: number; kills: number; endBy: string };
type As = { char: string; tier: number; start: number; end: number | null; dmgChar: number; dmgBoss: number; taken: number; died: boolean };
const eps: Ep[] = [], ass: As[] = [], rekill = { respawns: 0, deaths: 0, rekill: 0, byLose: { boss: [0, 0], toku: [0, 0], both: [0, 0] } as Record<string, number[]>, allLose: { boss: [0, 0], toku: [0, 0], both: [0, 0] } as Record<string, number[]> };
const base = { sec: 0, dmgChar: 0, dmgBoss: 0, kills: 0 }, delays: number[] = [], recall = { ok: 0, okUlt: 0 }; // delays: 復帰から倒されるまでの秒数（10秒以内）、recall: リコールの成功回数（うちパワーアップ中） // 比較用: 変身していない生存中のキャラ（アシスト除く）
let room: any, active = new Map<string, Ep>(), asMap = new Map<string, As>(), lastRespawn = new Map<string, number>(), inDamage = false;

// パワーアップの区間（変身が有効＝ult あり・pending でない）を毎tick見る
const active_ = (p: any) => !!(p.ult && !p.ult.pending && p.alive);
function scan() {
  for (const p of room.players.values()) {
    if (p.assist) continue;
    if (p.alive && !active_(p)) base.sec += 0.05;
    const e = active.get(p.id);
    if (active_(p) && !e) active.set(p.id, { char: p.char, tier: p.ult.tier, start: room.now, end: room.now, dmgChar: 0, dmgBoss: 0, kills: 0, endBy: '' });
    else if (e && active_(p)) e.tier = Math.max(e.tier, p.ult.tier);
  }
}
const close = (id: string, by: string) => { const e = active.get(id); if (!e) return; e.end = room.now; e.endBy = by; eps.push(e); active.delete(id); };

const R = GameRoom.prototype as any;
const tick0 = R.tick; R.tick = function (this: any, dt: number, s?: boolean) { tick0.call(this, dt, s); if (this === room && this.phase === 'playing') scan(); };
const endUlt0 = R.endUlt; R.endUlt = function (this: any, p: any) { if (this === room) close(p.id, inDamage ? '倒された' : this.now >= (p.ult?.until ?? Infinity) - 1e-9 ? '時間切れ' : 'その他'); return endUlt0.call(this, p); };
const dmg0 = R.damagePlayer; R.damagePlayer = function (this: any, ...a: any[]) { inDamage = true; try { return dmg0.apply(this, a); } finally { inDamage = false; } };
const resp0 = R.respawn; R.respawn = function (this: any, p: any) { resp0.call(this, p); if (this === room && !p.assist) { lastRespawn.set(p.id, this.now); rekill.respawns++; } };
const sum0 = R.summonAssist; R.summonAssist = function (this: any, ...a: any[]) { const x = sum0.apply(this, a); if (this === room && x && !asMap.has(x.id)) { const r: As = { char: x.char, tier: x.tier, start: this.now, end: null, dmgChar: 0, dmgBoss: 0, taken: 0, died: false }; asMap.set(x.id, r); ass.push(r); } return x; };
const fx0 = R.addFx; R.addFx = function (this: any, p: any, kind: string, x: any) { if (this === room && kind === 'recall' && p.id) { recall.ok++; if (active_(p)) recall.okUlt++; } return fx0.call(this, p, kind, x); };
const M = MatchRec.prototype as any;
const hurt0 = M.hurt; M.hurt = function (this: any, v: any, by: any, raw: boolean, d: number) {
  hurt0.call(this, v, by, raw, d);
  if (!room || d <= 0) return;
  if (by && active.has(by.id)) active.get(by.id)!.dmgChar += d;
  else if (by && !by.assist) base.dmgChar += d;
  if (by?.assist) { const r = asMap.get(by.id); if (r) r.dmgChar += d; }
  if (v.assist) { const r = asMap.get(v.id); if (r) r.taken += d; }
};
const boss0 = M.boss; M.boss = function (this: any, rm: any, p: any, d: number) { boss0.call(this, rm, p, d); if (active.has(p.id)) active.get(p.id)!.dmgBoss += d; else if (!p.assist) base.dmgBoss += d; if (p.assist) { const r = asMap.get(p.id); if (r) r.dmgBoss += d; } };
const ko0 = M.ko; M.ko = function (this: any, rm: any, v: any, killer: any) {
  ko0.call(this, rm, v, killer);
  if (killer && active.has(killer.id) && !v.assist) active.get(killer.id)!.kills++;
  else if (killer && !killer.assist && !v.assist) base.kills++;
  if (v.assist) { const r = asMap.get(v.id); if (r) { r.end = rm.now; r.died = true; r.tier = v.tier; } return; }
  rekill.deaths++;
  { const e = 1 - v.team, bl = rm.bosses[v.team].hp / C.BOSS_HP < rm.bosses[e].hp / C.BOSS_HP, tl = rm.teams[v.team].toku < rm.teams[e].toku; rekill.allLose.boss[bl ? 0 : 1]++; rekill.allLose.toku[tl ? 0 : 1]++; rekill.allLose.both[bl && tl ? 0 : 1]++; }
  const t = lastRespawn.get(v.id);
  if (t !== undefined && rm.now - t <= REKILL) {
    rekill.rekill++; delays.push(rm.now - t);
    const e = 1 - v.team, bl = rm.bosses[v.team].hp / C.BOSS_HP < rm.bosses[e].hp / C.BOSS_HP, tl = rm.teams[v.team].toku < rm.teams[e].toku;
    rekill.byLose.boss[bl ? 0 : 1]++; rekill.byLose.toku[tl ? 0 : 1]++; rekill.byLose.both[bl && tl ? 0 : 1]++;
  }
};

const matches: any[] = [];
for (const seed of SEEDS) {
  Math.random = rng(seed);
  room = new (GameRoom as any)();
  room.setSimulationInterval = () => {}; room.lock = () => {}; room.unlock = () => {};
  Object.defineProperty(room, 'clients', { value: [] });
  room.onCreate(); room.notice = () => {};
  active = new Map(); asMap = new Map(); lastRespawn = new Map();
  room.startMatch();
  while (room.phase !== 'ended') room.tick(0.05, false);
  for (const id of [...active.keys()]) close(id, '試合終了');
  for (const [id, r] of asMap) if (r.end === null) { r.end = room.now; r.tier = room.players.get(id)?.tier ?? r.tier; }
  matches.push({ seed, winner: room.winner, sec: Math.round(room.now), kind: room.rec.summary()?.kind });
}

// 表
const r1 = (x: number) => Math.round(x * 10) / 10, pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '−');
const TAG = ['1', '2', '3', 'MAX'], STAR = ['★', '★★', '★★★', '★★★★'];
const out: string[] = [];
out.push(`固定シード ${SEEDS.length}試合（種 ${SEEDS[0]}〜${SEEDS.at(-1)}）。決着: 大将撃破 ${matches.filter((m) => m.kind === 'boss').length}・時間切れ ${matches.filter((m) => m.kind === 'timeout').length}、平均 ${r1(matches.reduce((a, m) => a + m.sec, 0) / matches.length)}秒、陣営0の勝ち ${matches.filter((m) => m.winner === 0).length}・陣営1 ${matches.filter((m) => m.winner === 1).length}・引き分け ${matches.filter((m) => m.winner === 2).length}\n`);
out.push('## パワーアップ（1回の変身あたり。強さは変身中の最大）\n');
out.push('| 強さ | 回数 | 平均の長さ(秒) | 与ダメ 対キャラ | 対大将 | キル | 倒されて終わった | 時間切れ | 試合終了 |\n|---|---|---|---|---|---|---|---|---|');
for (let t = 0; t < 4; t++) { const e = eps.filter((x) => Math.min(3, x.tier) === t), n = e.length, s = (f: (x: Ep) => number) => (n ? r1(e.reduce((a, x) => a + f(x), 0) / n) : '−'); out.push(`| ${TAG[t]} | ${n} | ${s((x) => x.end - x.start)} | ${s((x) => x.dmgChar)} | ${s((x) => x.dmgBoss)} | ${s((x) => x.kills)} | ${pct(e.filter((x) => x.endBy === '倒された').length, n)} | ${pct(e.filter((x) => x.endBy === '時間切れ').length, n)} | ${pct(e.filter((x) => x.endBy === '試合終了').length, n)} |`); }
{ const e = eps, n = e.length, per = (f: (x: Ep) => number) => r1(e.reduce((a, x) => a + f(x), 0) / Math.max(1, e.reduce((a, x) => a + (x.end - x.start), 0)) * 20); out.push(`| 全体 | ${n} | ${r1(e.reduce((a, x) => a + x.end - x.start, 0) / Math.max(1, n))} | 20秒あたり ${per((x) => x.dmgChar)} | 20秒あたり ${per((x) => x.dmgBoss)} | 20秒あたり ${per((x) => x.kills)} | ${pct(e.filter((x) => x.endBy === '倒された').length, n)} | ${pct(e.filter((x) => x.endBy === '時間切れ').length, n)} | ${pct(e.filter((x) => x.endBy === '試合終了').length, n)} |`); }
out.push(`| 比較: 変身していない時 | − | − | 20秒あたり ${r1(base.dmgChar / base.sec * 20)} | 20秒あたり ${r1(base.dmgBoss / base.sec * 20)} | 20秒あたり ${r1(base.kills / base.sec * 20)} | − | − | − |`);
out.push('\n## アシスト（1体あたり。強さは最後の強さ。リツは分ける）\n');
out.push('| 強さ | 種類 | 体数 | 生存時間(秒) | 倒された割合 | 与ダメ 対キャラ | 対大将 | 倒されるまでに受けたダメージ |\n|---|---|---|---|---|---|---|---|');
for (let t = 0; t < 4; t++) for (const kind of ['リツ以外', '波音リツ']) {
  const a = ass.filter((x) => Math.min(3, x.tier) === t && (x.char === 'ritsu') === (kind === '波音リツ')), n = a.length, s = (f: (x: As) => number) => (n ? r1(a.reduce((q, x) => q + f(x), 0) / n) : '−');
  const d = a.filter((x) => x.died);
  out.push(`| ${STAR[t]} | ${kind} | ${n} | ${s((x) => (x.end ?? 0) - x.start)} | ${pct(d.length, n)} | ${s((x) => x.dmgChar)} | ${s((x) => x.dmgBoss)} | ${d.length ? r1(d.reduce((q, x) => q + x.taken, 0) / d.length) : '−'} |`);
}
out.push('\n## 復帰直後の再撃破（復帰から10秒以内に倒された）\n');
out.push(`撃破 ${rekill.deaths}回のうち、復帰から10秒以内 ${rekill.rekill}回（${pct(rekill.rekill, rekill.deaths)}）。復帰 ${rekill.respawns}回あたり ${pct(rekill.rekill, rekill.respawns)}\n`);
out.push('| その時の組の状況 | 復帰10秒以内の撃破: 劣勢 | 劣勢でない | 劣勢の割合 | 比較: すべての撃破の劣勢の割合 |\n|---|---|---|---|---|');
for (const [k, l] of [['大将HP%が相手より低い', 'boss'], ['徳が相手より低い', 'toku'], ['両方', 'both']]) out.push(`| ${k} | ${rekill.byLose[l][0]} | ${rekill.byLose[l][1]} | ${pct(rekill.byLose[l][0], rekill.byLose[l][0] + rekill.byLose[l][1])} | ${pct(rekill.allLose[l][0], rekill.allLose[l][0] + rekill.allLose[l][1])} |`);
out.push(`\n復帰から倒されるまで（10秒以内の${delays.length}回）: 3秒以内 ${delays.filter((d) => d <= 3).length}・3〜6秒 ${delays.filter((d) => d > 3 && d <= 6).length}・6〜10秒 ${delays.filter((d) => d > 6).length}`);
out.push(`\nリコールの成功 ${recall.ok}回（うちパワーアップ中 ${recall.okUlt}回）、1試合あたり ${r1(recall.ok / SEEDS.length)}回`);
console.log(out.join('\n'));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ seeds: SEEDS, matches, eps, ass, rekill, base, delays, recall, names: Object.fromEntries(Object.entries(NAMES).map(([k, v]: any) => [k, v.name])) }));
