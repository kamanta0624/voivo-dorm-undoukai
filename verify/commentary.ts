// 実況の判定（docs/commentary_spec.md の表）の単体テスト。実行: npm run test:server（tsx verify/commentary.ts）
import { GameRoom } from '../src/server/GameRoom';
import { CONFIG as C } from '../src/shared/config';
import { CHARS } from '../src/shared/chars';
import { bump, decay, nextFocus, engageKind, situation, killAddon, KillCtx, summary, board, pickTopic, TOPICS, evaded, pickPattern, roomAt } from '../src/server/commentary';
import { clips, allTexts, nameDrift, priority, tokens, SCRIPT } from '../src/shared/commentary';
import MAP from '../src/shared/map.json';

let fails = 0;
const ok = (name: string, cond: boolean, detail: any = '') => {
  if (!cond) fails++;
  console.log(cond ? 'PASS' : 'FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail));
};
const M = C.CM;

// 部屋を作り、a（陣営0）と b（陣営1）だけを中央ホールに置く（verify/server.ts の mk と同じ）。実況のメッセージを集める
function mk(a: string, b?: string) {
  const r: any = new (GameRoom as any)();
  r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  const got: any[] = [];
  Object.defineProperty(r, 'clients', { value: [{ sessionId: 'x', send: (t: string, m: any) => { if (t === 'cm') got.push(m); } }] });
  r.onCreate();
  r.addPlayer('a', 0, false); r.players.get('a').char = a;
  if (b) { r.addPlayer('b', 1, false); r.players.get('b').char = b; }
  r.startMatch(); r.beginPlay();
  for (const p of r.players.values()) if (p.bot) { p.alive = false; p.respawnAt = 1e9; p.x = p.y = -999; }
  r.bosses.forEach((bo: any) => { bo.x = -500; bo.y = -500; });
  r.materials = []; r.items = []; r.couriers = []; r.courierAt = 1e9; r.notice = () => {};
  const A = r.players.get('a'); Object.assign(A, { x: 1552, y: 900, face: 0 }); A.st.test = { until: Infinity, noAuto: true };
  const B = b ? r.players.get('b') : null;
  if (B) { Object.assign(B, { x: 1592, y: 900 }); B.st.test = { until: Infinity, noAuto: true }; }
  got.length = 0; // 試合前・試合開始のセリフは捨てる
  r.cm.log = [];
  return { r, A, B, got, keys: () => got.flatMap((u) => u.s.map((s: any) => s.k)) };
}
const run = (r: any, sec: number) => { for (let i = 0; i < Math.round(sec / 0.05); i++) r.cm.tick(0.05), (r.now += 0.05); };

console.log('--- 0. 注目度');
{
  const at = new Map<string, number>();
  bump(at, 'x', 60); bump(at, 'x', 60);
  ok('上限100で止まる', at.get('x') === M.attn.max);
  decay(at, 1);
  ok('毎秒 -15', at.get('x') === M.attn.max - 15);
  decay(at, 10);
  ok('0以下は消える', !at.has('x'));
  ok('各トリガーの値（撃破=上限 助っ人60 接近40 回避40 コバコ50 荷物50 視界15 ダメージ10）',
    [M.attn.max, M.attn.assistIn, M.attn.bossNear, M.attn.dodge, M.attn.courier, M.attn.box, M.attn.spot, M.attn.dmg].join() === '100,60,40,40,50,50,15,10');
  const { r, A, B } = mk('sayo', 'metan');
  r.damagePlayer(B, 5, 'a', false, '通常攻撃');
  ok('ダメージで与えた側・受けた側が+10', r.cm.attn.get('a') === 10 && r.cm.attn.get('b') === 10);
  r.giveUlt(B, 1); r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  ok('パワーアップ中のダメージは通常どおり加算', r.cm.attn.get('b') === 20);
}
console.log('--- 0. フォーカス');
{
  const f = (focus: string | null, o: Record<string, number>) => nextFocus(focus, new Map(Object.entries(o)));
  ok('フォーカスなし: 50以上で開始', f(null, { x: 50 }).change === 'start' && f(null, { x: 50 }).focus === 'x');
  ok('フォーカスなし: 49では始めない', f(null, { x: 49 }).change === null);
  ok('25を下回ったら外す', f('x', { x: 24.9 }).change === 'off' && f('x', { x: 25 }).change === null);
  ok('他が20以上上回れば移る', f('x', { x: 60, y: 80 }).change === 'move' && f('x', { x: 60, y: 80 }).focus === 'y');
  ok('差が19なら移らない', f('x', { x: 60, y: 79 }).change === null);
}
console.log('--- 1-2. 接敵');
ok('1対1・1対2は個人の接敵', engageKind(1, 1) === 'engage_1' && engageKind(1, 2) === 'engage_1' && engageKind(3, 1) === 'engage_1');
ok('両チーム2人以上は集団戦', engageKind(2, 2) === 'engage_group' && engageKind(2, 3) === 'engage_group');
ok('合計6人以上は大規模', engageKind(3, 3) === 'engage_big' && engageKind(4, 2) === 'engage_big');
console.log('--- 1-5-2. 単発の一言（優先順）');
{
  const base: KillCtx = { first: false, wanted: false, victimStreak: 0, killerStreak: 1, revenge: false, lowHp: false, combo: false, chase: false, n: 0, m: 0 };
  const rows: [Partial<KillCtx>, string | null][] = [
    [{ first: true, wanted: true }, 'add_first'], [{ wanted: true, victimStreak: 3 }, 'add_wanted'], [{ victimStreak: 3, killerStreak: 3 }, 'add_stop'],
    [{ killerStreak: 3, revenge: true }, 'add_streak'], [{ revenge: true, lowHp: true }, 'add_revenge'], [{ lowHp: true, combo: true }, 'add_lowhp'],
    [{ combo: true, chase: true }, 'add_combo'], [{ chase: true, n: 1, m: 1 }, 'add_chase'], [{ n: 1, m: 1 }, 'add_duel'], [{ n: 1, m: 2 }, 'add_under'],
    [{ n: 3, m: 1 }, 'add_over'], [{ n: 2, m: 2 }, 'add_melee'], [{ n: 3, m: 2 }, 'add_melee'], [{ victimStreak: 2, killerStreak: 2 }, null],
  ];
  for (const [c, want] of rows) ok(`${JSON.stringify(c)} → ${want}`, killAddon({ ...base, ...c }) === want);
  ok('状況: タイマン n=1,m=1／数的不利 n<m／数的有利 n>m,m=1／乱戦 n≥2,m≥2', situation(1, 1) === 'add_duel' && situation(2, 3) === 'add_under' && situation(4, 1) === 'add_over' && situation(2, 2) === 'add_melee');
}
console.log('--- 1-6. まとめ');
{
  const K = (k: string, kt: number) => ({ k, kt, vt: 1 - kt });
  const S = (o: any) => summary({ chain: true, kills: [], alive: [], hurt: [], lowEsc: null, ...o });
  ok('撃破2以上・周辺の生存者0 → みんないなくなった', S({ kills: [K('a', 0), K('b', 1)] })?.k === 'sum_wipe');
  ok('3人以上撃破・生存者1 → 最後に立っていた', S({ kills: [K('a', 0), K('b', 1), K('a', 0)], alive: [{ id: 'a', team: 0 }] })?.k === 'sum_last');
  ok('1人で2キル → ダブルキル', S({ kills: [K('a', 0), K('a', 0)], alive: [{ id: 'a', team: 0 }, { id: 'c', team: 1 }] })?.k === 'sum_double');
  ok('1人で3キル → トリプル', S({ kills: [K('a', 0), K('a', 0), K('a', 0)], alive: [{ id: 'a', team: 0 }, { id: 'c', team: 1 }] })?.k === 'sum_triple');
  ok('1人で4キル → クアドラプル', S({ kills: [K('a', 0), K('a', 0), K('a', 0), K('a', 0)], alive: [{ id: 'a', team: 0 }, { id: 'c', team: 1 }] })?.k === 'sum_quad');
  ok('1チーム2キル・2人以上生存 → 乱戦を制している', JSON.stringify(S({ kills: [K('a', 0), K('c', 0)], alive: [{ id: 'a', team: 0 }, { id: 'c', team: 0 }] })) === JSON.stringify({ k: 'sum_team', a: { 組: [0] } }));
  ok('1チームが全キル → 完勝', JSON.stringify(S({ kills: [K('a', 1), K('c', 1)], alive: [{ id: 'a', team: 1 }, { id: 'x', team: 0 }] })) === JSON.stringify({ k: 'sum_sweep', a: { 組: [1] } }));
  ok('どれにも当てはまらない → 痛み分け', S({ kills: [K('a', 0), K('b', 1)], alive: [{ id: 'a', team: 0 }, { id: 'b', team: 1 }] })?.k === 'sum_even');
  ok('撃破0・HP20%以下で逃げ切った → 間一髪', S({ hurt: [0, 1], lowEsc: 'sayo' })?.k === 'sum0_escape');
  ok('撃破0・両チーム被ダメ → 痛み分け', S({ hurt: [0, 1] })?.k === 'sum0_even');
  ok('撃破0・一方だけ被ダメ → 被ダメのない組が一歩リード', JSON.stringify(S({ hurt: [1] })) === JSON.stringify({ k: 'sum0_lead', a: { 組: [0] } }));
  ok('撃破1 → まとめなし', S({ kills: [K('a', 0)] }) === null);
  ok('連続にならなかった戦闘の撃破2 → まとめなし（単発で喋り済み）', S({ chain: false, kills: [K('a', 0), K('b', 1)] }) === null);
}
console.log('--- 1-7. 盤面');
{
  ok('一方が全員反省中 → 盤面では喋らない（6章の割り込み）', board([0, 3], null).say === null);
  const d = board([4, 2], null);
  ok('人数差2以上 → これで4対2！[組]、攻め時', JSON.stringify(d.say) === JSON.stringify({ k: 'board_diff', a: { n: 4, m: 2, 組: [0] } }) && d.behind === 1);
  ok('人数差2以上から0に戻った → 少なかった組が立て直した', JSON.stringify(board([3, 3], 1).say) === JSON.stringify({ k: 'board_back', a: { 組: [1] } }));
  ok('差1 → なし', board([3, 2], null).say === null);
}
console.log('--- 4. 平時の話題');
{
  const all = new Set(TOPICS);
  const a = pickTopic(-1, null, all, false, 0.9);
  const b = pickTopic(a.rot, a.topic, all, false, 0.9);
  ok('順番を回す', a.topic === TOPICS[0] && b.topic === TOPICS[1], [a.topic, b.topic]);
  ok('言うことがない話題は飛ばす', pickTopic(0, 'toku', new Set(['killer']), false, 0.9).topic === 'killer');
  ok('直前と同じ話題は避ける', pickTopic(-1, 'toku', new Set(['toku']), false, 0.9).topic === null);
  ok('小ネタは1/4程度（r<0.25）、空のキャラだけなら選ばない', pickTopic(0, null, all, true, 0.2).topic === 'trivia' && pickTopic(0, null, all, true, 0.3).topic !== 'trivia' && pickTopic(0, null, all, false, 0.1).topic !== 'trivia');
  ok('小ネタは続けない', pickTopic(0, 'trivia', all, true, 0.1).topic !== 'trivia');
}
console.log('--- 2. 回避');
ok('範囲に入って被弾せず生存 → 回避', JSON.stringify(evaded(new Set(['x', 'y', 'z']), new Set(['y']), (id) => id !== 'z')) === '["x"]');
console.log('--- パターン');
{
  let same = 0;
  for (let i = 0; i < 100; i++) if (pickPattern(2, 0, i / 100) === 0) same++;
  ok('直前と同じパターンは避ける', same === 0);
  ok('使えるパターンだけから選ぶ', pickPattern(2, undefined, 0.9, [0]) === 0);
}

console.log('--- 撃破（GameRoom のフック）');
{
  const { r, A, B, keys, got } = mk('sayo', 'metan');
  r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  ok('撃破の直後は保留（1秒）', !keys().some((k) => k.startsWith('kill')));
  run(r, 1.05);
  const u = got.find((x) => x.s.some((s: any) => s.k === 'kill_normal')); // （ほかのBotは倒してあるので、先に「全員反省中」が入る）
  ok('1秒後に単発: 前置き＋本文＋ファーストキル（1つの発話）', JSON.stringify(u?.s.map((s: any) => s.k)) === JSON.stringify(['pre_start', 'kill_normal', 'add_first']), keys());
  ok('前置きの場所は部屋の id、本文は A=撃破者 B=倒された', u.s[0].a.場所 === roomAt(B.x, B.y) && u.s[1].a.A === 'sayo' && u.s[1].a.B === 'metan');
  ok('座標を送らない', got.every((u) => u.s.every((s: any) => Object.keys(s.a).every((k) => ['A', 'B', 'C', '組', '大将', '助っ人', '技', '場所', 'n', 'm'].includes(k)))));
}
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.damagePlayer(B, 1e6, 'a', false, CHARS.sayo.skill.name);
  run(r, 1.05);
  ok('技で撃破 → 技の本文', keys().includes('kill_skill'));
}
{
  const { r, B, keys } = mk('sayo', 'metan');
  r.giveUlt(B, 1);
  r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  run(r, 2);
  ok('パワーアップ中に倒された（元に戻る）は撃破として扱わない', B.alive && !keys().some((k) => k.startsWith('kill') || k.startsWith('add')) && !r.cm.kills.size);
}
{
  const { r, B, keys } = mk('sayo', 'metan');
  r.damagePlayer(B, 1e6, null, true);
  run(r, 2);
  ok('スロットの罰による撃破は撃破として実況しない', !B.alive && !keys().some((k) => k.startsWith('kill') || k.startsWith('add')), keys());
  ok('罰で全員反省中になったら6章の割り込み', keys().includes('alldown'));
}
{
  // 連続: 1秒以内に同じ戦闘で次の撃破
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.addPlayer('c', 1, false); const Cc = r.players.get('c'); Object.assign(Cc, { char: 'zunko', x: 1600, y: 920, alive: true }); Cc.hp = r.maxHp(Cc);
  r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  run(r, 0.5);
  r.damagePlayer(Cc, 1e6, 'a', false, '通常攻撃');
  ok('2つ目の撃破が1秒以内 → 連続（1回）', keys().filter((k) => k === 'multi').length === 1 && !keys().includes('kill_normal'), keys());
  run(r, M.battleEnd + 1.5);
  ok('戦闘の終了でまとめ（1人で2キル → ダブルキル）', keys().includes('sum_double'), keys());
}
{
  // 大将・助っ人による撃破、助っ人の撃破
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.damagePlayer(B, 1e6, null, false);
  ok('大将が撃破 → 返り討ち', keys().includes('kill_boss'), keys());
  const a = r.summonAssist(0, 1, 'kurono'); a.x = 1500; a.y = 900;
  const { r: r2, B: B2, keys: k2 } = mk('sayo', 'metan');
  const a2 = r2.summonAssist(0, 1, 'kurono'); Object.assign(a2, { x: 1560, y: 900 });
  r2.cm.attn.set(a2.id, 100); r2.cm.focus = a2.id;
  r2.damagePlayer(B2, 1e6, a2.id, false, '技');
  ok('助っ人が撃破', k2().includes('kill_by_assist'), k2());
  const { r: r3, A: A3, keys: k3 } = mk('sayo', 'metan');
  const a3 = r3.summonAssist(1, 1, 'aoyama'); Object.assign(a3, { x: 1560, y: 900 });
  r3.damagePlayer(a3, 1e9, 'a', false, '通常攻撃');
  ok('助っ人が撃破された', k3().includes('kill_assist'), k3());
}
console.log('--- 一言（GameRoom）');
{
  // 連携: 撃破者以外の味方が直近5秒に30%以上
  const { r, A, B, keys, got } = mk('sayo', 'metan');
  r.cm.firstKill = true;
  r.addPlayer('c', 0, false); const Cc = r.players.get('c'); Object.assign(Cc, { char: 'zunko', x: 1540, y: 930, alive: true }); Cc.hp = r.maxHp(Cc);
  r.damagePlayer(B, r.maxHp(B) * 0.35 / 0.8, 'c', false, '通常攻撃'); // defense の軽減(0.8)込みで35%
  r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  run(r, 1.05);
  const add = got.flatMap((u) => u.s).find((s: any) => s.k.startsWith('add_'));
  ok('連携あり → [C]との連携', add?.k === 'add_combo' && add.a.C === 'zunko', add);
}
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.cm.firstKill = true;
  r.teams[1].wanted = 'b';
  r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  run(r, 1.05);
  ok('指名手配中を撃破 → お尋ね者', keys().includes('add_wanted'), keys());
}
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.cm.firstKill = true;
  A.hp = r.maxHp(A) * 0.15;
  r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  run(r, 1.05);
  ok('撃破者のHP20%以下 → 瀕死からの逆転', keys().includes('add_lowhp'), keys());
}
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.cm.firstKill = true; r.cm.lastVictim.set('b', 'a');
  r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  run(r, 1.05);
  ok('直前に倒された相手を撃破 → リベンジ', keys().includes('add_revenge'), keys());
}
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.cm.firstKill = true; r.cm.streak.set('b', 3);
  r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  run(r, 1.05);
  ok('3連続撃破中の相手を撃破 → 快進撃もここまで', keys().includes('add_stop'), keys());
  const { r: r2, B: B2, keys: k2 } = mk('sayo', 'metan');
  r2.cm.firstKill = true; r2.cm.streak.set('a', 2);
  r2.damagePlayer(B2, 1e6, 'a', false, '通常攻撃');
  run(r2, 1.05);
  ok('撃破者がこれで3連続 → 止まらない', k2().includes('add_streak'), k2());
}
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.cm.firstKill = true;
  r.damagePlayer(B, 1e6, 'a', false, '通常攻撃');
  run(r, 1.05);
  ok('1対1の撃破 → タイマン', keys().includes('add_duel'), keys());
}
console.log('--- 戦闘の検知・合流・まとめ（撃破0）');
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.cm.attn.set('a', 60);
  r.damagePlayer(B, 5, 'a', false, '通常攻撃');
  ok('フォーカス中の対象が関わる戦闘の開始 → 前置き＋接敵（1対1）', JSON.stringify(keys()) === JSON.stringify(['pre_start', 'engage_1']), keys());
  ok('戦闘は1つ', r.cm.battles.length === 1);
  r.addPlayer('c', 0, false); const Cc = r.players.get('c'); Object.assign(Cc, { char: 'zunko', x: 1552 - 250, y: 900, alive: true }); Cc.hp = r.maxHp(Cc);
  r.damagePlayer(B, 5, 'c', false, '通常攻撃');
  r.cm.focus = 'c';
  r.damagePlayer(B, 5, 'c', false, '通常攻撃');
  ok('合流（1戦闘1回）', keys().filter((k) => k === 'join').length <= 1);
  Object.assign(B, { x: 3000, y: 900 });
  r.cm.focus = 'a'; r.cm.attn.set('a', 100);
  run(r, M.battleEnd + 1.2);
  ok('撃破0・一方だけ被ダメ → 一歩リード', keys().includes('sum0_lead'), keys());
  // 離れた場所のダメージは別の戦闘
  const { r: r2, A: A2, B: B2 } = mk('sayo', 'metan');
  r2.damagePlayer(B2, 5, 'a', false, '通常攻撃');
  r2.addPlayer('d', 0, false); const D = r2.players.get('d'); Object.assign(D, { char: 'zunko', x: 400, y: 300, alive: true }); r2.addPlayer('e', 1, false); const E = r2.players.get('e'); Object.assign(E, { char: 'aru', x: 420, y: 300, alive: true });
  r2.damagePlayer(E, 5, 'd', false, '通常攻撃');
  ok('進行中の戦闘の半径外のダメージは別の戦闘（複数同時）', r2.cm.battles.length === 2);
}
console.log('--- 1-4. 追跡');
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.cm.focus = 'b'; r.cm.attn.set('b', 100);
  r.damagePlayer(B, 1, 'a', false, '通常攻撃');
  const bt = r.cm.battles[0];
  const sec = () => { r.now += 1; bt.last = r.now; r.cm.second(); r.cm.attn.set('b', 100); }; // 戦闘は続いている（ダメージあり）扱い
  for (let i = 1; i <= 3; i++) { Object.assign(B, { x: 1592 + i * 60 }); Object.assign(A, { x: 1552 + i * 60 }); sec(); }
  ok('逃げる相手に敵が2秒以上ついていく → 追跡', keys().includes('chase_start') && bt.chasing?.b === 'b', keys());
  Object.assign(B, { x: 1592 + 400 }); sec();
  ok('半径外へ出て追跡が切れた → 逃げ切った', keys().includes('chase_escape'), keys());
  const { r: r2, A: A2, B: B2, got } = mk('sayo', 'metan');
  r2.cm.firstKill = true;
  r2.damagePlayer(B2, 1, 'a', false, '通常攻撃');
  r2.cm.battles[0].chasing = { a: 'a', b: 'b' };
  r2.damagePlayer(B2, 1e6, 'a', false, '通常攻撃');
  run(r2, 1.05);
  ok('追いついて撃破 → 撃破の本文＋追いついた', got.flatMap((u) => u.s.map((s: any) => s.k)).includes('add_chase'));
}
console.log('--- 4. 平時の各話題');
{
  const { r, A, B, got } = mk('sayo', 'metan');
  r.now = 100;
  r.cm.kills.set('a', 2); r.cm.toku.set('a', 1); r.cm.bad.set('b', 3);
  r.teams[1].wanted = 'b'; r.teams[0].toku = 7; r.teams[1].toku = 3;
  r.bosses[1].hp = C.BOSS_HP * 0.6;
  r.broken = Array.from({ length: Math.ceil(r.cm.walls[0] * 0.2) }, () => [5, 5]);
  r.spawnCourier();
  const lib = MAPROOM('library_L');
  r.materials = Array.from({ length: M.lootMin }, (_, i) => ({ id: i, x: (lib[0] + 3 + i) * C.TILE, y: (lib[1] + 3) * C.TILE, hi: false }));
  r.cm.wins[0] = [90, 95];
  A.alive = false; // 反省中
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) { r.cm.idleAt = -Infinity; r.cm.idle(); }
  for (const u of got) for (const s of u.s) seen.add(s.k);
  const want = ['idle_toku', 'idle_bosshp', 'idle_slot', 'idle_wanted', 'idle_wall', 'idle_courier', 'idle_loot', 'idle_reflect', 'idle_killer', 'idle_toku_top', 'idle_bad'];
  ok('条件がそろえば全話題を回す', want.every((k) => seen.has(k)), want.filter((k) => !seen.has(k)));
  const ks = got.map((u) => u.s[0].k);
  ok('直前と同じ話題は続かない', ks.every((k, i) => i === 0 || k !== ks[i - 1]));
  const { r: r2, got: g2 } = mk('sayo', 'metan');
  r2.now = 10; r2.couriers = []; r2.cm.idle();
  ok('言うことがない話題は飛ばす（大将HPは開始直後なし・コバコ不在）', g2.length === 1 && g2[0].s[0].k === 'idle_toku', g2.map((u) => u.s[0].k));
}
console.log('--- 2. 個別プレー');
{
  const { r, A, keys } = mk('sayo', 'metan');
  r.cm.focus = 'a'; r.cm.attn.set('a', 60);
  r.spawnCourier(); Object.assign(r.couriers[0], { x: A.x + 30, y: A.y });
  r.hitThing(A, { k: 'c', o: r.couriers[0], x: A.x + 30, y: A.y, r: 10 }, 20, true);
  ok('コバコ撃破', keys().includes('play_courier') && r.cm.attn.get('a') === 100, keys());
  const box = r.items.find((i: any) => i.kind.startsWith('box_'));
  r.takeItem(A, box);
  ok('荷物を拾う（自分の組がコバコを撃破 → 横取りなし）', keys().some((k) => k === 'play_box_ult' || k === 'play_box_assist') && !keys().includes('play_steal'), keys());
}
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.cm.focus = 'b'; r.cm.attn.set('b', 60);
  r.spawnCourier(); Object.assign(r.couriers[0], { box: 'ult' });
  r.hitThing(A, { k: 'c', o: r.couriers[0], x: A.x, y: A.y, r: 10 }, 20, true);
  r.takeItem(B, r.items.find((i: any) => i.kind === 'box_ult'));
  ok('別の組が拾う → 荷物（パワーアップ）＋横取り', JSON.stringify(keys().slice(-2)) === JSON.stringify(['play_box_ult', 'play_steal']), keys());
  r.spawnCourier(); Object.assign(r.couriers[0], { box: 'assist' });
  r.hitThing(A, { k: 'c', o: r.couriers[0], x: A.x, y: A.y, r: 10 }, 20, true);
  const before = keys().length;
  r.takeItem(B, r.items.find((i: any) => i.kind === 'box_assist'));
  ok('荷物で助っ人 → 「助っ人の登場」は出さない', keys().slice(before).includes('play_box_assist') && !keys().includes('play_assist_in'), keys().slice(before));
}
{
  const { r, A, keys } = mk('mochiko', 'sayo');
  r.cm.focus = 'b'; r.cm.attn.set('b', 60);
  const f = { id: 99, kind: 'funnel', team: 0, owner: 'a', x: 0, y: 0, r: 6, body: 'unit', hp: 1 };
  r.ents.push(f);
  r.hitThing(r.players.get('b'), { k: 'e', o: f, x: 0, y: 0, r: 6 }, 50, true);
  ok('ファンネルが通常攻撃で破壊 → 撃墜', keys().includes('play_funnel'), keys());
  const f2 = { ...f, id: 100, hp: 1 }; r.ents.push(f2);
  r.hitThing(r.players.get('b'), { k: 'e', o: f2, x: 0, y: 0, r: 6 }, 50, false);
  ok('技での破壊は撃墜にしない', keys().filter((k) => k === 'play_funnel').length === 1);
}
{
  // 大将に接近: 大将側の視界に入ったときだけ
  const { r, A, B, keys } = mk('sayo', 'metan');
  B.alive = false; B.x = B.y = -999;
  const boss = r.bosses[1];
  Object.assign(boss, { x: 1552 + 200, y: 900 });
  r.cm.focus = 'a'; r.cm.attn.set('a', 60);
  run(r, 1.05);
  ok('敵大将の近くで大将側に見えた → 接近', keys().includes('play_boss_near') && r.cm.nearAt.has('a'), keys());
  const n = keys().length;
  run(r, 5);
  ok('同じキャラは30秒に1回', keys().slice(n).filter((k) => k === 'play_boss_near').length === 0);
  // 壁の向こう（見えていない）: study（陣営1）の外の廊下から
  const { r: r2, A: A2, B: B2, keys: k2 } = mk('sayo', 'metan');
  B2.alive = false; B2.x = B2.y = -999;
  const study = MAPROOM('study_R');
  Object.assign(r2.bosses[1], { x: (study[0] + 3) * C.TILE, y: (study[1] + 3) * C.TILE });
  Object.assign(A2, { x: (study[0] - 2) * C.TILE, y: (study[1] + 3) * C.TILE });
  const seen = r2.visibleTo(1, A2.x, A2.y, r2.obstacles());
  r2.cm.focus = 'a'; r2.cm.attn.set('a', 60);
  run(r2, 1.05);
  ok('大将側に見えていない接近は判定しない', !seen && !k2().includes('play_boss_near') && !r2.cm.nearAt.has('a'), { seen, keys: k2() });
}
{
  const { r, keys } = mk('sayo', 'metan');
  Object.assign(r.bosses[0], { x: 1400, y: 900 }); // 助っ人は大将の所に現れる
  const a = r.summonAssist(0, 1, 'kurono');
  ok('助っ人の登場: 本人の注目度60でフォーカス → 前置き＋登場', r.cm.attn.get(a.id) === 60 && JSON.stringify(keys()) === JSON.stringify(['pre_start', 'play_assist_in']), keys());
  r.summonAssist(0, 1, 'kurono');
  ok('助っ人の強化', keys().includes('play_assist_up'), keys());
  const { r: r2, B: B2, keys: k2 } = mk('sayo', 'metan');
  const a2 = r2.summonAssist(0, 1, 'kurono'); Object.assign(a2, { x: 1560, y: 900 });
  r2.damagePlayer(B2, 1, a2.id, false, '技'); r2.now += 3; r2.damagePlayer(B2, 1, a2.id, false, '技');
  ok('助っ人の活躍（10秒に1回）', k2().filter((k) => k === 'play_rampage').length === 1, k2());
}
{
  // 回避: アルの突撃の警告帯に入った敵が、被弾せずに技が終わった
  const { r, A, B, keys } = mk('aru', 'metan');
  r.cm.focus = 'b'; r.cm.attn.set('b', 60);
  A.tgt = null; A.face = 0;
  r.skill('a');
  ok('発動時に進路上にいた敵を記録', r.cm.tracks[0]?.cand.has('b'));
  Object.assign(B, { x: 1552, y: 1200 }); // 進路から外れる
  for (let i = 0; i < 80 && r.cm.tracks.length; i++) { r.updatePlayers(0.05); r.cm.tick(0.05); r.now += 0.05; }
  ok('被弾せず技が終わった → 回避', keys().includes('play_dodge'), keys());
  const { r: r2, A: A2, B: B2, keys: k2 } = mk('aru', 'metan');
  r2.cm.focus = 'b'; r2.cm.attn.set('b', 60);
  A2.tgt = null; A2.face = 0;
  r2.skill('a');
  for (let i = 0; i < 80 && r2.cm.tracks.length; i++) { r2.updatePlayers(0.05); r2.cm.tick(0.05); r2.now += 0.05; }
  ok('被弾したら回避ではない', !k2().includes('play_dodge') && B2.hp < r2.maxHp(B2), k2());
}
console.log('--- 3. 前置き');
{
  const { r, A, B, keys } = mk('sayo', 'metan');
  r.cm.attn.set('a', 60); r.cm.evalFocus();
  ok('平時からフォーカス開始 → 開始の前置きが待つ', r.cm.prefix?.k === 'pre_start');
  run(r, M.prefixWait + 0.1);
  ok('続くセリフが来なければ前置きだけ', keys().includes('pre_start'));
  r.addPlayer('c', 1, false); const Cc = r.players.get('c'); Object.assign(Cc, { char: 'zunko', x: 400, y: 300, alive: true });
  r.cm.attn.set('c', 100); r.cm.attn.set('a', 60); (r.cm as any).evalFocus();
  ok('フォーカス中に別の部屋の対象へ移る → 移動の前置き', r.cm.focus === 'c' && r.cm.prefix?.k === 'pre_move');
  Object.assign(B, { x: 1580, y: 900 });
  r.cm.prefix = null; r.cm.focus = 'a'; r.cm.focusRoom = roomAt(A.x, A.y); r.cm.attn.set('b', 100); r.cm.attn.set('a', 60); (r.cm as any).evalFocus();
  ok('同じ部屋で対象だけ変わる → 前置きなし', r.cm.focus === 'b' && r.cm.prefix === null);
}
console.log('--- 4. 平時（GameRoom）');
{
  const { r, keys } = mk('sayo', 'metan');
  run(r, M.idleDelay - 0.5);
  ok('フォーカスが外れて5秒までは喋らない', !keys().some((k) => k.startsWith('idle_')));
  run(r, 1.6);
  ok('5秒後から話題を1つ（徳）', keys().filter((k) => k.startsWith('idle_')).length === 1 && keys().includes('idle_toku'), keys());
  run(r, M.idleEvery);
  ok('10秒に1回、直前と違う話題', keys().filter((k) => k.startsWith('idle_')).length === 2 && keys().filter((k) => k === 'idle_toku').length === 1, keys());
}
console.log('--- 6. 全体・進行');
{
  const { r, keys } = mk('sayo', 'metan');
  r.damageBoss(r.bosses[1], C.BOSS_HP * 0.26, r.players.get('a'));
  ok('大将HP75%を切った → 割り込み', keys().includes('boss75') && !keys().includes('boss50'), keys());
  Object.assign(r.bosses[1], { moving: false, dmgAtBase: 0 }); // 拠点移動の予告（無敵）を解く
  r.damageBoss(r.bosses[1], C.BOSS_HP * 0.5, r.players.get('a'));
  ok('一度に2段階切ったら低い方だけ', keys().includes('boss25') && !keys().includes('boss50'), keys());
  r.cm.reverseAt = -1e9;
  r.bosses[0].hp = C.BOSS_HP * 0.2; r.cm.bossHit(r.bosses[0]);
  ok('優劣逆転', keys().includes('reverse'), keys());
  const b = r.bosses[0]; b.moved = false; r.moveBoss(b); r.moveBoss(b);
  ok('拠点移動: 1回目は第2形態、2回目以降はまた移した', keys().includes('boss_form2') && keys().includes('boss_move'));
  r.payout(0, 1, 'ult'); r.payout(0, 2, 'ult');
  ok('スロット当選（払い出しの種類）と連チャン', keys().some((k) => k === 'slot_ult' || k === 'slot_assist') && keys().includes('slot_chain'));
  r.penalty(1);
  ok('スロットの罰', keys().some((k) => k.startsWith('pen_')));
}
{
  const { r, got } = mk('sayo', 'metan');
  const reach = () => got.filter((u) => u.s[0].k === 'slot_reach' && u.s[0].a.組[0] === 1).length;
  const spin = () => { r.startSpin(1, 'miss'); r.teams[1].slot.reels = [0, 0, 1]; r.teams[0].slot.start = r.now; r.now += C.SLOT.stops[1] * C.SLOT.spin; r.cm.tick(0.05); };
  r.cm.reachAt = [-Infinity, -Infinity];
  spin();
  ok('リーチ（2つ目が止まって2つそろった）', reach() === 1);
  spin();
  ok('同じ組は20秒に1回', reach() === 1);
  r.now += M.reachCd; spin();
  ok('20秒たてばまた喋る', reach() === 2);
  r.startSpin(1, 'pen'); r.now += C.SLOT.stops[1] * C.SLOT.spin + M.reachCd; r.cm.tick(0.05);
  ok('罰の出目（×××）はリーチにしない', reach() === 2);
}
{
  const { r, keys } = mk('sayo', 'metan');
  r.cm.prevLeft = 181; r.timeLeft = 180; r.cm.tick(0.01);
  ok('形勢（SITUATION_AT、接戦）', keys().includes('sit_even'), keys());
  r.bosses[0].hp = C.BOSS_HP * 0.5; r.cm.prevLeft = 121; r.timeLeft = 120; r.cm.tick(0.01);
  const s = r.cm.log.map((x: string) => JSON.parse(x)).filter((x: any) => x.keys?.includes('sit_lead'));
  ok('形勢（優勢: 大将のHP割合の差が SITUATION_DIFF 以上）', s.length === 1, keys());
  r.cm.prevLeft = 31; r.timeLeft = 30; r.cm.tick(0.01);
  r.cm.prevLeft = 11; r.timeLeft = 10; r.cm.tick(0.01);
  ok('残り30秒・10秒', keys().includes('left30') && keys().includes('left10'));
  r.endMatch(1, 'boss');
  ok('決着（大将撃破）', keys().at(-1) === 'end_boss' && r.cm.lastPat.has('end_boss'));
}
{
  const { r, keys } = mk('sayo', 'metan');
  r.endMatch(2, 'timeout');
  const { r: r2, keys: k2 } = mk('sayo', 'metan');
  r2.endMatch(0, 'timeout');
  ok('決着（時間切れ・引き分け／勝ち）', keys().includes('end_draw') && k2().includes('end_time'));
}
{
  const got: any[] = [];
  const r: any = new (GameRoom as any)();
  r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [{ send: (t: string, m: any) => t === 'cm' && got.push(m) }] });
  r.onCreate(); r.addPlayer('a', 0, false); r.startMatch();
  ok('試合前（ロード完了＝開幕演出の開始）: [組]は左側→右側', got[0]?.s[0].k === 'pre_match' && JSON.stringify(got[0].s[0].a.組) === '[0,1]');
  r.beginPlay();
  ok('試合開始', got[1]?.s[0].k === 'start' && got[1].pr > got[0].pr);
}
console.log('--- 優先度');
{
  const order = ['end_boss', 'alldown', 'boss50', 'kill_normal', 'pre_start', 'play_dodge', 'sit_lead', 'idle_toku'];
  ok('決着 ＞ 全員反省中 ＞ 全体 ＞ 撃破 ＞ 前置き ＞ 個別 ＞ 進行 ＞ 平時', order.every((k, i) => i === 0 || priority(order[i - 1]) > priority(k)), order.map(priority));
  ok('接敵・合流・連続・盤面は前置きと同じ', ['engage_1', 'join', 'multi', 'board_diff'].every((k) => priority(k) === priority('pre_start')));
  ok('まとめは撃破と同じ、追跡は個別と同じ', priority('sum_double') === priority('kill_normal') && priority('chase_start') === priority('play_dodge'));
}
console.log('--- 台本・部品');
{
  ok('パターンの分解', JSON.stringify(tokens('[A]と[B]、接敵！')) === JSON.stringify(['[A]', 'と', '[B]', '、接敵！']));
  const c = clips({ k: 'kill_skill', p: 0, a: { A: 'hanamaru', B: 'metan', 技: 'hanamaru' } });
  ok('読みは台本、字幕は chars.json の名前・chars.ts の技名', c.map((x) => x.text).join('|') === '花丸|の|てんきょうけん|が|めたん|を捉えた！' && c.map((x) => x.sub).join('') === '満別花丸の巨大拳飛ばしが四国めたんを捉えた！', c);
  const old = CHARS.hanamaru.skill.name;
  CHARS.hanamaru.skill.name = 'テスト拳';
  ok('chars.ts の技名を変えると字幕が追従し、生成スクリプトは食い違いを警告', clips({ k: 'kill_skill', p: 0, a: { A: 'hanamaru', B: 'metan', 技: 'hanamaru' } }).some((x) => x.sub === 'テスト拳') && nameDrift().some((w) => w.includes('テスト拳')));
  CHARS.hanamaru.skill.name = old;
  ok('今の定義と台本の名前は一致', nameDrift().length === 0, nameDrift());
  const p = clips({ k: 'pre_start', p: 1, a: { 場所: 'library_R' } });
  ok('陣営側の部屋は「[組]側の[部屋]」', p.map((x) => x.sub).join('') === 'みどり組側の図書室に注目です！', p.map((x) => x.sub).join(''));
  ok('数は0〜20（徳は四捨五入）', clips({ k: 'idle_toku', p: 0, a: { 組: [0, 1], n: 5.5, m: 4.4 } }).map((x) => x.sub).join('') === '徳の状況です。だいだい組6、みどり組4！');
  ok('全パターンの部品が台本にある', Object.keys(SCRIPT.lines).every((k) => (SCRIPT.lines as any)[k].length > 0) && allTexts().length > 0);
  ok('助っ人の字幕は config の名前', clips({ k: 'play_rampage', p: 0, a: { 助っ人: 'kurono' } })[0].sub === C.ASSIST.units.kurono.name);
}

// map.json の部屋の rect
function MAPROOM(id: string) { return MAP.rooms.find((r) => r.id === id)!.rect; }

console.log(fails ? `${fails} FAIL` : 'ALL PASS');
if (fails) process.exit(1);
