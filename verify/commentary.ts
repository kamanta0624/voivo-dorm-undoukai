// 実況の判定（docs/commentary_spec.md の表）の単体テスト。実行: npm run test:server（tsx verify/commentary.ts）
import { GameRoom } from '../src/server/GameRoom';
import { CONFIG as C } from '../src/shared/config';
import { CHARS } from '../src/shared/chars';
import { bump, decay, nextFocus, engageKind, situation, killAddon, KillCtx, summary, board, pickBoard, flow, review, leaders, evaded, pickPattern, roomAt } from '../src/server/commentary';
import { clips, allTexts, nameDrift, priority, keep, tokens, SCRIPT, CHATTER, patterns, topicOf } from '../src/shared/commentary';
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
  r.cm.durOf = () => 0; r.cm.busyUntil = 0; r.cm.q = []; // 判定のテストは喋る長さ0（出来事のたびにすぐ送る）。タイムラインは別に確かめる
  r.cm.coolOrig = r.cm.cool; r.cm.cool = () => false; // 判定のテストは話題のクールタイムなし（クールタイムは「D. 話題のクールタイム」で確かめる）
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
console.log('--- 4. つなぎの話題選び');
{
  const T = (topic: string, sig = '') => ({ topic, sig, says: [{ k: 'idle_' + topic, p: 0, a: {} }] });
  ok('直前と同じ話題は避ける（ほかがあれば）', pickBoard([T('toku'), T('slot')], 'toku', new Map(), 0)?.topic === 'slot' && pickBoard([T('toku')], 'toku', new Map(), 0)?.topic === 'toku');
  ok('前回言ってから値が変わった話題を優先', pickBoard([T('toku', '1'), T('slot', '2')], null, new Map([['toku', '0'], ['slot', '2']]), 0.9)?.topic === 'toku');
  ok('言うことがない話題は飛ばす', pickBoard([{ topic: 'toku', sig: '', says: [] }, T('slot')], null, new Map(), 0)?.topic === 'slot' && pickBoard([{ topic: 'toku', sig: '', says: [] }], null, new Map(), 0) === null);
  const F = M.flow, up = (n: number, v: number) => Array(n).fill(v);
  ok('試合の流れ: 差が小さい→どちらに転ぶか', flow([0.3, 0.01])?.p === 1);
  ok(`試合の流れ: 直近${F.pace}秒ずっと同じ組が上→ペース`, flow(up(F.pace, 0.1))?.p === 0 && flow(up(F.pace, 0.1))?.team === 0 && flow(up(F.pace, -0.1))?.team === 1 && flow([...up(F.pace - 1, 0.1)]) === null);
  ok(`試合の流れ: 直近${F.widenWin}秒で差が${F.widen}以上広がった→じわじわ`, flow([...up(F.widenWin, 0.1), 0.2])?.p === 2 && flow([...up(F.widenWin, -0.1), -0.2])?.team === 1);
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
console.log('--- 4-1. 盤面コメントの各行');
{
  const { r, A, B } = mk('sayo', 'metan');
  const say = () => new Map<string, string[]>(r.cm.topics().map((t: any) => [t.topic, t.says.map((x: any) => `${x.k}:${x.p}`)]));
  const has = (m: Map<string, string[]>, k: string, p: number) => [...m.values()].some((v) => v.includes(`${k}:${p}`));
  r.now = 10; r.timeLeft = C.MATCH_TIME - 10; r.couriers = [];
  let m = say();
  ok('開始直後: 徳は互角（差1未満）・大将HPなし・序盤・スロットは静か・コバコ不在は飛ばす', has(m, 'idle_toku', 0) && has(m, 'idle_toku', 2) && !has(m, 'idle_toku', 1) && !m.has('bosshp') && has(m, 'idle_time', 0) && has(m, 'idle_time', 2) && has(m, 'idle_slot', 2) && !m.has('courier'), [...m]);
  r.now = 120; r.timeLeft = C.MATCH_TIME - 120; r.teams[0].toku = 7; r.teams[1].toku = 3;
  r.bosses[1].hp = C.BOSS_HP * 0.6;
  m = say();
  ok(`徳: リード（差1以上）。大将HP: ${M.bossHpAfter}秒以降、残り割合と優勢、両方9割以上でなければ「元気」なし。中盤`, has(m, 'idle_toku', 1) && !has(m, 'idle_toku', 2) && has(m, 'idle_bosshp', 0) && has(m, 'idle_bosshp', 1) && !has(m, 'idle_bosshp', 2) && has(m, 'idle_time', 1), [...m]);
  r.bosses[1].hp = C.BOSS_HP; r.bosses[0].hp = C.BOSS_HP * 0.95; m = say();
  ok('両大将とも9割以上 → まだまだ元気', has(m, 'idle_bosshp', 2));
  r.timeLeft = M.timeMin - 1; m = say();
  ok(`残り${M.timeMin}秒未満は残り時間の話題なし`, !m.has('time'));
  A.alive = false; m = say();
  ok('反省中: [n]人が反省中／[n]人で戦っています', has(m, 'idle_reflect', 0) && has(m, 'idle_reflect', 1));
  A.alive = true;
  r.cm.wins[0] = [90, 95]; m = say();
  ok(`スロット: ${M.slotHot}秒に2回 → 勢い、当たりなし${M.slotDry}秒 → まだ当たりなし`, has(m, 'idle_slot', 1) && has(m, 'idle_slot', 0) && !has(m, 'idle_slot', 2));
  A.ult = { form: 'melee', tier: 0, until: 999, pending: false }; m = say();
  ok('パワーアップ中1人 → [A]の文', has(m, 'idle_power', 1) && !has(m, 'idle_power', 0));
  r.addPlayer('c', 0, false); const Cc = r.players.get('c'); Object.assign(Cc, { alive: true, ult: { form: 'melee', tier: 0, until: 999, pending: false } }); m = say();
  ok('同じ組で2人以上 → [組]の文', has(m, 'idle_power', 0) && !has(m, 'idle_power', 1));
  const as = r.summonAssist(1, 1, 'kurono'); m = say();
  ok('アシスト: 出ていれば健在、ダメージがなければ「暴れています」なし', has(m, 'idle_assist', 0) && !has(m, 'idle_assist', 1));
  r.damagePlayer(A, 1, as.id, false, '技'); m = say();
  ok(`直近${M.rampWin}秒にダメージ → 暴れています`, has(m, 'idle_assist', 1));
  r.bosses[0].moved = true; m = say();
  ok('第2形態の大将がいる → 大将の形態', has(m, 'idle_form', 0));
  r.teams[1].wanted = 'b'; m = say();
  ok('指名手配: 3パターン', [0, 1, 2].every((p) => has(m, 'idle_wanted', p)));
  r.broken = Array.from({ length: Math.ceil((r.cm.walls[0] + r.cm.walls[1]) * 0.2) }, () => [5, 5]); m = say();
  ok('壁の壊れ方: 組側・寮全体・風通し', [0, 1, 2].every((p) => has(m, 'idle_wall', p)));
  r.spawnCourier(); m = say();
  ok('コバコ: 今いる部屋（中央）を巡回中＋常時の2つ', [0, 1, 2].every((p) => has(m, 'idle_courier', p)));
  const lib = MAPROOM('library_L');
  r.materials = Array.from({ length: M.lootMin }, (_, i) => ({ id: i, x: (lib[0] + 3 + i) * C.TILE, y: (lib[1] + 3) * C.TILE, hi: false })); m = say();
  ok(`徳が${M.lootMin}個以上ある部屋 → 散らばり`, has(m, 'idle_loot', 0) && has(m, 'idle_loot', 1));
  m = say();
  ok('撃破・大将へのダメージ・徳・悪行が0なら、その話題なし', !m.has('killer') && !m.has('bossdmg') && !m.has('tokuTop') && !m.has('bad'));
  r.cm.kills.set('a', 2); r.cm.toku.set('a', 1); r.cm.bad.set('b', 3); r.damageBoss(r.bosses[1], 50, A); m = say();
  ok('キルリーダー・大将へのダメージ・徳を稼いだ人・悪行（試合累計）', has(m, 'idle_killer', 0) && has(m, 'idle_killer', 1) && has(m, 'idle_bossdmg', 0) && has(m, 'idle_toku_top', 1) && has(m, 'idle_bad', 1) && r.cm.bossDmg.get('a') === 50, [...m]);
  B.bad = 5; r.damagePlayer(B, 1e9, 'a', false, '通常攻撃');
  ok('悪行の試合累計は撃破で0に戻らない（悪行ポイントも撃破では0にしない）', B.bad === 5 && r.cm.bad.get('b') === 3);
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
console.log('--- 4. つなぎ（GameRoom）');
{
  const { r, keys, got } = mk('sayo', 'metan');
  r.cm.durOf = () => 1;
  r.cm.flow(M.fill.silence - 0.05);
  ok(`${M.fill.silence}秒黙るまではつなぎなし`, !got.length);
  r.cm.flow(0.1);
  ok(`${M.fill.silence}秒黙ったらつなぎを1つ（fill）`, got.length === 1 && got[0].fill === true, keys());
  for (let i = 0; i < 1500; i++) r.cm.flow(0.5);
  const ks = got.map((u: any) => `${u.s[0].k}:${u.s[0].p}`), chats = ks.filter((k: string) => k.startsWith('chat:'));
  ok('フォーカスなし: 盤面コメントと雑談の両方', chats.length > 0 && ks.some((k: string) => k.startsWith('idle_')), { chats: chats.length, all: ks.length });
  ok('雑談は出場中のキャラだけ、同じ試合で繰り返さない', chats.every((k: string) => ['sayo', 'metan', ...[...r.players.values()].map((p: any) => p.char)].includes(k.split(':')[1])) && new Set(chats).size === chats.length);
  const chars = new Set([...r.players.values()].filter((p: any) => !p.assist).map((p: any) => p.char)), total = [...chars].reduce((a, c) => a + patterns(`chat:${c}`).length, 0);
  ok(`雑談を使い切ったら雑談は出ない（出場キャラの${total}本）`, chats.length === total, chats.length);
  const u = mk('sayo', 'metan'), S2 = [0, 1].map((p) => ({ k: 'idle_toku', p, a: {} }));
  u.r.cm.topics = () => [{ topic: 'toku', sig: '', says: S2 }];
  const picks = [0, 1, 2].map(() => u.r.cm.boardFill(false).p);
  ok('盤面コメントは話題ごとに使い切るまで同じパターンを繰り返さない（使い切ったらその話題だけ戻す）', picks[0] !== picks[1] && [0, 1].includes(picks[2]), picks);
  // フォーカス中は短い盤面コメントだけ
  const f = mk('sayo', 'metan'); f.r.cm.durOf = (s: any) => (s[0].k === 'idle_toku' && s[0].p === 1 ? 1 : 9);
  f.r.teams[0].toku = 8; f.r.cm.focus = 'a'; f.r.cm.attn.set('a', 100); f.r.cm.flow(M.fill.silence + 0.01);
  ok(`フォーカス中: ${M.fill.short}秒以下の盤面コメントだけ`, f.got.length === 1 && f.got[0].s[0].k === 'idle_toku' && f.got[0].s[0].p === 1, f.got.map((u: any) => u.s[0]));
  const e = mk('sayo', 'metan'); e.r.cm.durOf = () => 1; e.r.phase = 'ended'; e.r.cm.flow(3);
  ok('試合中（playing）以外はつなぎなし', !e.got.length);
}
console.log('--- A・B・C. タイムライン（言い切る・切れ目で選ぶ・捨てる・統合）');
{
  const { r, A, B, got } = mk('sayo', 'metan');
  r.cm.durOf = () => 2;
  r.cm.emit([{ k: 'start', p: 0, a: {} }]);
  r.cm.emit([{ k: 'play_courier', p: 0, a: { A: 'sayo' } }]);
  r.cm.emit([{ k: 'boss50', p: 0, a: { 大将: 0 } }]);
  ok('喋っている間は次を言わない（割り込みなし）', got.length === 1 && got[0].s[0].k === 'start');
  r.cm.flow(2);
  ok('切れ目で、待っているうち優先度が一番高いもの', got.length === 2 && got[1].s[0].k === 'boss50');
  r.cm.flow(2);
  ok(`捨てない種類以外は発生から${M.drop}秒で捨てる`, got.length === 2, got.map((u: any) => u.s[0].k));
  ok('捨てない: 決着・全員反省中・大将HP・撃破系・試合後', ['end_boss', 'alldown', 'boss50', 'kill_normal', 'add_first', 'multi', 'sum_double', 'rev_good', 'mvp_kill', 'close'].every(keep) && !['play_dodge', 'idle_toku', 'start', 'engage_1', 'chat:sayo'].some(keep));
  r.cm.durOf = () => 6; r.cm.emit([{ k: 'start', p: 0, a: {} }]); r.cm.emit([{ k: 'kill_boss', p: 0, a: { 大将: 0, B: 'sayo' } }]); r.cm.flow(6);
  ok(`撃破系は待たされても（${M.drop}秒超）捨てない`, got.at(-1).s[0].k === 'kill_boss');
  // 同じ戦闘の古い単発撃破は連続・まとめに統合
  const g = mk('sayo', 'metan'); g.r.cm.durOf = () => 5;
  g.r.cm.emit([{ k: 'start', p: 0, a: {} }]);
  const bt: any = {};
  g.r.cm.emit([{ k: 'kill_normal', p: 0, a: { A: 'sayo', B: 'metan' } }], { bt });
  g.r.cm.emit([{ k: 'multi', p: 0, a: {} }], { merge: bt });
  g.r.cm.flow(5); g.r.cm.flow(5);
  ok('同じ戦闘の待っている単発撃破は、連続・まとめに統合（単発は言わない）', g.got.map((u: any) => u.s[0].k).slice(0, 2).join() === 'start,multi' && !g.got.some((u: any) => u.s[0].k === 'kill_normal'));
  // フォーカスの移動はセリフの切れ目だけ
  const h = mk('sayo', 'metan'); h.r.cm.durOf = () => 3;
  h.r.cm.emit([{ k: 'start', p: 0, a: {} }]);
  h.r.cm.attn.set('a', 80); h.r.cm.evalFocus();
  ok('喋っている間はフォーカスを始めない', h.r.cm.focus === null);
  h.r.cm.flow(3);
  ok('言い終えた時点で判定して始める', h.r.cm.focus === 'a');
  h.r.cm.emit([{ k: 'start', p: 0, a: {} }]); h.r.cm.attn.set('b', 100); h.r.cm.attn.set('a', 70); h.r.cm.evalFocus();
  ok('喋っている間は移らない', h.r.cm.focus === 'a');
  h.r.cm.attn.set('b', 75); h.r.cm.flow(3);
  ok('言い終えた時点で条件（差20以上）を満たさなくなっていれば移らない', h.r.cm.focus === 'a');
  // 試合後: 決着 → 総評 → 活躍キャラ → 締め
  const z = mk('sayo', 'metan'); z.r.cm.durOf = () => 2;
  z.r.cm.kills.set('a', 2); z.r.cm.toku.set('b', 1.2); z.r.cm.bad.set('a', 0.5); z.r.cm.bossDmg.set('a', 300);
  z.r.cm.emit([{ k: 'play_dodge', p: 0, a: { B: 'sayo' } }]); z.r.cm.emit([{ k: 'play_courier', p: 0, a: { A: 'sayo' } }]);
  z.r.damageBoss(z.r.bosses[1], C.BOSS_HP, z.A); // 大将撃破 → 決着演出（スロー→爆発→止め→WIN）→ 決着後
  for (let i = 0; i < 800 && z.r.phase !== 'ended'; i++) z.r.tick(0.05, false);
  for (let i = 0; i < 40; i++) z.r.cm.flow(0.5);
  const order = z.got.map((u: any) => u.s[0].k);
  ok('試合後: 決着（大将撃破→止め→勝った組）→総評→活躍キャラ（キル・大将ダメージ・徳・悪行）→締めの順で最後まで（待っていたものは捨てる）', JSON.stringify(order.slice(1)) === JSON.stringify(['end_boss', 'end_killer', 'end_win', 'rev_good', 'mvp_kill', 'mvp_boss', 'mvp_toku', 'mvp_bad', 'close']) || JSON.stringify(order.slice(1)).replace('rev_onesided', 'rev_good') === JSON.stringify(['end_boss', 'end_killer', 'end_win', 'rev_good', 'mvp_kill', 'mvp_boss', 'mvp_toku', 'mvp_bad', 'close']), order);
}
console.log('--- D. 話題のクールタイム');
{
  const cd = (o: { dur?: number } = {}) => { const z = mk('sayo', 'metan'); z.r.cm.cool = z.r.cm.coolOrig; z.r.cm.durOf = () => o.dur ?? 1; return z; };
  const ks = (z: any) => z.got.map((u: any) => u.s.map((s: any) => s.k).join('+'));
  ok('話題カテゴリ: スロットの出目・罰・盤面のスロットは同じ、全員反省中と反省中の盤面は同じ、撃破と付け足しは同じ、決着・試合後は対象外', ['slot_reach', 'slot_ult', 'slot_chain', 'pen_dmg', 'idle_slot'].every((k) => topicOf(k) === 'slot') && topicOf('alldown') === topicOf('idle_reflect') && topicOf('kill_normal') === topicOf('add_duel') && ['end_boss', 'rev_good', 'mvp_kill', 'close'].every((k) => topicOf(k) === null));
  ok('台本の全イベントキーに話題カテゴリがある（キーそのままの話題はない）', Object.keys(SCRIPT.lines).every((k) => topicOf(k) === null || topicOf(k) !== k));
  const a = cd(); a.r.cm.filler = () => null; a.r.cm.emit([{ k: 'slot_reach', p: 0, a: { 組: [0] } }]); a.r.cm.flow(1);
  a.r.cm.emit([{ k: 'slot_ult', p: 0, a: { 組: [0] } }]); a.r.cm.flow(M.topicCd - 1.1);
  a.r.cm.emit([{ k: 'pen_dmg', p: 0, a: { 組: [1] } }]); a.r.cm.flow(0.2);
  a.r.cm.emit([{ k: 'slot_chain', p: 0, a: { 組: [0] } }]); a.r.cm.flow(1);
  ok(`同じ話題（スロット）は言い始めから${M.topicCd}秒は出さない（来たものは捨てる）。過ぎたらまた出す`, JSON.stringify(ks(a).filter((k: string) => topicOf(k) === 'slot')) === JSON.stringify(['slot_reach', 'slot_chain']), ks(a));
  const b = cd(); b.r.cm.emit([{ k: 'alldown', p: 0, a: { 組: [0] } }]); b.r.cm.flow(1); b.r.cm.emit([{ k: 'alldown', p: 0, a: { 組: [1] } }]); b.r.cm.flow(1);
  ok('捨てない種類（全員反省中）もクールタイム中は捨てる', ks(b).filter((k: string) => k === 'alldown').length === 1, ks(b));
  const c = cd(); c.r.cm.emit([{ k: 'kill_normal', p: 0, a: { A: 'sayo', B: 'metan' } }]); c.r.cm.flow(1); c.r.cm.emit([{ k: 'kill_skill', p: 0, a: { A: 'metan', B: 'sayo', 技: 'metan' } }]); c.r.cm.flow(1);
  ok('撃破も5秒以内の2件目は捨てる', ks(c).filter((k: string) => k.startsWith('kill')).length === 1, ks(c));
  const d = cd(); d.r.cm.emit([{ k: 'end_time', p: 0, a: { 組: [0] } }]); d.r.cm.flow(1); d.r.cm.emit([{ k: 'end_time', p: 0, a: { 組: [0] } }]); d.r.cm.flow(1);
  ok('決着はクールタイムの対象外', ks(d).filter((k: string) => k === 'end_time').length === 2, ks(d));
  const e = cd(); e.r.cm.emit([{ k: 'pre_move', p: 0, a: { 場所: 'hall' } }]); e.r.cm.flow(1); e.r.cm.emit([{ k: 'pre_move', p: 1, a: { 場所: 'hall' } }, { k: 'play_dodge', p: 0, a: { B: 'sayo' } }]); e.r.cm.flow(1);
  ok('前置きがクールタイム中なら前置きだけ外して本体は言う', ks(e).at(-1) === 'play_dodge', ks(e));
  // つなぎもクールタイム中の話題を選ばない
  const f = cd(); f.r.cm.topics = () => [{ topic: 'toku', sig: '1', says: [0, 1, 2].map((p) => ({ k: 'idle_toku', p, a: {} })) }, { topic: 'time', sig: '2', says: [{ k: 'idle_time', p: 0, a: {} }] }];
  f.r.cm.chatFill = () => null;
  for (let i = 0; i < 40; i++) f.r.cm.flow(0.25);
  const fk = f.got.map((u: any) => ({ k: u.s[0].k, c: 0 })); const L = f.r.cm.log.map((x: string) => JSON.parse(x)).filter((x: any) => x.keys);
  const bad = L.filter((x: any, i: number) => L.slice(0, i).some((y: any) => topicOf(y.keys[0]) === topicOf(x.keys[0]) && x.c - y.c < M.topicCd)).length;
  ok(`つなぎもクールタイム中の話題は選ばない（候補が尽きたら${M.every}秒おきに探し直す）`, fk.length >= 3 && bad === 0, L.map((x: any) => `${x.c}:${x.keys[0]}`));
}
console.log('--- 7-1. 総評（優先順）');
{
  const R = M.review, H = (...ds: [number, number][]) => ds;
  ok('1 勝った組が残り60秒以降に0.2以上負けていた → 大逆転', review(H([200, 0.1], [50, -0.25], [0, 0.05]), 0, 0.05).k === 'rev_late' && review(H([50, 0.25]), 1, -0.05).k === 'rev_late');
  ok('2 試合中に0.2以上負けていた → 逆転勝利', review(H([200, -0.3], [100, 0.1]), 0, 0.1).k === 'rev_comeback');
  ok(`3 リードが${R.swaps}回以上入れ替わった → シーソー`, review(H([250, 0.1], [200, -0.1], [150, 0.1], [100, -0.1], [50, 0.15]), 0, 0.15).k === 'rev_seesaw');
  ok('4 引き分け、または最終の差0.03未満 → 大接戦', review(H([100, 0.1]), 2, 0).k === 'rev_close' && review(H([100, 0.1]), 0, 0.02).k === 'rev_close');
  ok('5 最終の差0.1未満 → 接戦', review(H([100, 0.05]), 0, 0.09).k === 'rev_near');
  ok('6 入れ替わりなし・最終の差0.5以上 → ワンサイド（勝った組）', JSON.stringify(review(H([100, 0.3], [0, 0.6]), 0, 0.6)) === JSON.stringify({ k: 'rev_onesided', a: { 組: [0] } }));
  ok('7 どれでもない → 見ごたえ', review(H([100, -0.05], [0, 0.3]), 0, 0.3).k === 'rev_good');
  ok('優先: 大逆転はシーソーより先', review(H([250, 0.1], [200, -0.1], [150, 0.1], [50, -0.3], [0, 0.1]), 0, 0.1).k === 'rev_late');
  ok('引き分けは逆転の判定をしない', review(H([50, -0.3]), 2, 0).k === 'rev_close');
}
console.log('--- 7-2. 活躍したキャラ（同点）');
{
  ok('1人', JSON.stringify(leaders(new Map([['a', 3], ['b', 1]]))) === JSON.stringify({ ids: ['a'], v: 3 }));
  ok('同点は全員（小数は0.01で丸めて比べる）', leaders(new Map([['a', 0.6000001], ['b', 0.6], ['c', 0.2]]))!.ids.join() === 'a,b');
  ok('0以下は数えない（全員0なら飛ばす）', leaders(new Map([['a', 0]])) === null);
  const say = (m: [string, number][]) => { const z = mk('sayo', 'metan'); z.r.addPlayer('c', 0, false); z.r.players.get('c').char = 'bii'; z.r.cm.kills = new Map(m); z.r.cm.end(0, 'boss'); return z.got.map((u: any) => u.s[0]).find((s: any) => s.k.startsWith('mvp_kill')); };
  const one = say([['a', 2]]), two = say([['a', 2], ['b', 2]]), three = say([['a', 1], ['b', 1], ['c', 1]]);
  ok('2人は名前を続けて（[A]と[B]）、3人以上は人数（[n]キルで[m]人が並びました）', one.k === 'mvp_kill' && one.a.n === 2 && two.k === 'mvp_kill2' && two.a.A === 'sayo' && two.a.B === 'metan' && three.k === 'mvp_kill_many' && three.a.m === 3 && three.a.n === 1, [one, two, three]);
  ok('締めは3パターン', patterns('close').length === 3);
}
console.log('--- E. 読みの指定・雑談');
{
  const w = clips({ k: 'boss_warn', p: 0, a: { 大将: 0 } });
  ok('{字幕|読み}: 音声は「いかり」、字幕は「怒り」', w.map((x) => x.text).join('') === 'あんこもん、いかりの大爆発が来るぞ！' && w.map((x) => x.sub).join('') === 'あんこもん、怒りの大爆発が来るぞ！', w);
  ok('読みの指定は台本全体（音声の部品は読み）', allTexts().includes('、いかりの大爆発が来るぞ！') && !allTexts().some((t) => t.includes('{')));
  const c = clips({ k: 'chat:hanamaru', p: 0, a: {} });
  ok(`雑談は docs/commentary_chatter.md から（${Object.values(CHATTER).reduce((a, v) => a + (v as string[]).length, 0)}本）。1本で1つの部品`, c.length === 1 && c[0].sub === (CHATTER as any).hanamaru[0] && Object.values(CHATTER).every((v: any) => v.length >= 10));
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
  // リーチ: 待ち行列に入れず、直前の発話がつなぎ（雑談・盤面コメント）で待っているセリフがないセリフの切れ目で言う（沈黙は待たない）。言う前にリールが止まったら捨てる
  const { r, got } = mk('sayo', 'metan');
  r.cm.cool = r.cm.coolOrig; r.cm.durOf = () => 0.5; r.cm.filler = () => null;
  const reach = () => got.filter((u) => u.s[0].k === 'slot_reach' && u.s[0].a.組[0] === 1).length;
  const spin = () => { r.startSpin(1, 'miss'); r.teams[1].slot.reels = [0, 0, 1]; Object.assign(r.teams[0].slot, { start: r.now, reels: [0, 1, 2] }); r.now += C.SLOT.stops[1] * C.SLOT.spin; r.cm.tick(0.05); }; // 陣営0はそろわない出目（陣営1のリーチだけを見る）
  const fill = () => r.cm.send({ pr: 1, s: [{ k: 'idle_toku', p: 2, a: {} }], fill: true }); // つなぎ（盤面コメント）を言い始める
  const wait = (sec: number) => { for (let i = 0; i < sec / 0.05; i++) { r.cm.flow(0.05); } };
  const lastAt = () => JSON.parse(r.cm.log.filter((x: string) => x.includes('"keys"')).at(-1)); // 最後の発話（言い始め c・言い終わり end）
  r.cm.reachAt = [-Infinity, -Infinity];
  r.cm.emit([{ k: 'play_dodge', p: 0, a: { B: 'sayo' } }]); wait(0.5); spin(); wait(M.fill.silence + 0.5);
  ok('リーチ: 直前の発話がつなぎでなければ言わない（沈黙でも）', reach() === 0 && r.cm.reachWait[1] !== null);
  fill(); r.cm.emit([{ k: 'play_boss_near', p: 0, a: { A: 'sayo', 大将: 1 } }]); wait(1.2);
  ok('リーチ: 待っているセリフがあればそちらが先（言った後は直前がつなぎでないので言わない）', reach() === 0 && got.at(-1).s[0].k === 'play_boss_near', got.map((u: any) => u.s[0].k));
  fill(); const fEnd = lastAt().end; wait(0.55);
  const rs = lastAt();
  ok(`リーチ（2つ目が止まって2つそろった）: 直前がつなぎなら、待っているセリフがない切れ目ですぐ言う（沈黙${M.fill.silence}秒を待たない）`, reach() === 1 && r.cm.reachWait[1] === null && rs.keys[0] === 'slot_reach' && rs.c - fEnd < M.fill.silence, { gap: +(rs.c - fEnd).toFixed(2) });
  spin(); fill(); wait(0.6);
  ok('同じ組は20秒に1回', reach() === 1);
  r.now += M.reachCd; spin(); r.now += C.SLOT.spin; fill(); wait(0.6);
  ok('言う前にリールが止まって結果が確定していたら捨てる', reach() === 1 && r.cm.reachWait[1] === null);
  r.now += M.reachCd; r.cm.topicAt.delete('slot'); spin(); fill(); wait(0.6);
  ok('20秒たてばまた喋る', reach() === 2);
  r.startSpin(1, 'pen'); r.now += C.SLOT.stops[1] * C.SLOT.spin + M.reachCd; r.cm.tick(0.05); fill(); wait(0.6);
  ok('罰の出目（×××）はリーチにしない', reach() === 2);
  ok('リーチはつなぎ・出来事より優先度が低い（待ち行列に入れない）', !r.cm.q.some((x: any) => x.u.s[0].k === 'slot_reach'));
}
{
  const { r, keys, got } = mk('sayo', 'metan');
  r.cm.prevLeft = 181; r.timeLeft = 180; r.cm.tick(0.01);
  ok('形勢（SITUATION_AT、接戦）', keys().includes('sit_even'), keys());
  r.bosses[0].hp = C.BOSS_HP * 0.5; r.cm.prevLeft = 121; r.timeLeft = 120; r.cm.tick(0.01);
  const s = r.cm.log.map((x: string) => JSON.parse(x)).filter((x: any) => x.keys?.includes('sit_lead'));
  ok('形勢（優勢: 大将のHP割合の差が SITUATION_DIFF 以上）', s.length === 1, keys());
  r.cm.prevLeft = 31; r.timeLeft = 30; r.cm.tick(0.01);
  r.cm.prevLeft = 11; r.timeLeft = 10; r.cm.tick(0.01);
  ok('残り30秒・10秒', keys().includes('left30') && keys().includes('left10'));
  const B = r.players.get('b'); r.damageBoss(r.bosses[0], C.BOSS_HP, B);
  const seq = () => keys().filter((k: string) => k.startsWith('end_'));
  ok('大将撃破の瞬間は決着の実況なし（スロー）', !seq().length && r.phase === 'finale');
  for (let i = 0; i < 800 && r.phase === 'finale'; i++) r.tick(0.05, false);
  ok('決着（大将撃破）: 爆発で大将撃破 → 止めのキャラ（[A]=止めのキャラ）→ WIN で勝った組の順', JSON.stringify(seq()) === JSON.stringify(['end_boss', 'end_killer', 'end_win']) && got.find((u: any) => u.s[0].k === 'end_killer').s[0].a.A === 'metan' && got.find((u: any) => u.s[0].k === 'end_win').s[0].a.組[0] === 1, seq());
}
{
  const fin = (r: any) => { for (let i = 0; i < 800 && r.phase === 'finale'; i++) r.tick(0.05, false); };
  const { r, keys } = mk('sayo', 'metan');
  r.now = C.MATCH_TIME - 0.01; r.tick(0.05, false); fin(r);
  const { r: r2, keys: k2 } = mk('sayo', 'metan');
  r2.bosses[1].hp = 100; r2.now = C.MATCH_TIME - 0.01; r2.tick(0.05, false); fin(r2);
  const e = (k: () => string[]) => k().filter((x) => x.startsWith('end_'));
  ok('決着（時間切れ）: 時間切れ → 引き分け／勝った組の順', JSON.stringify(e(keys)) === JSON.stringify(['end_timeup', 'end_draw']) && JSON.stringify(e(k2)) === JSON.stringify(['end_timeup', 'end_time']), [e(keys), e(k2)]);
}
{
  const got: any[] = [];
  const r: any = new (GameRoom as any)();
  r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [{ send: (t: string, m: any) => t === 'cm' && got.push(m) }] });
  r.onCreate(); r.addPlayer('a', 0, false); r.startMatch();
  ok('試合前（ロード完了＝開幕演出の開始）: [組]は左側→右側', got[0]?.s[0].k === 'pre_match' && JSON.stringify(got[0].s[0].a.組) === '[0,1]');
  r.cm.flow(30); r.beginPlay(); // 試合前のあいさつを言い終えてから（開幕演出の間に言い終える）
  ok('試合開始（あいさつを言い切ってから）', got[1]?.s[0].k === 'start' && got[1].pr > got[0].pr, got.map((u: any) => u.s[0].k));
}
console.log('--- 優先度');
{
  const order = ['end_boss', 'alldown', 'boss50', 'kill_normal', 'pre_start', 'play_dodge', 'sit_lead', 'idle_toku'];
  ok('決着・試合後は同じ', ['rev_good', 'mvp_kill', 'close'].every((k) => priority(k) === priority('end_boss')));
  ok('決着 ＞ 全員反省中 ＞ 全体 ＞ 撃破 ＞ 前置き ＞ 個別 ＞ 進行 ＞ つなぎ', order.every((k, i) => i === 0 || priority(order[i - 1]) > priority(k)), order.map(priority));
  ok('接敵・合流・連続・盤面は前置きと同じ', ['engage_1', 'join', 'multi', 'board_diff'].every((k) => priority(k) === priority('pre_start')));
  ok('まとめは撃破と同じ、追跡は個別と同じ', priority('sum_double') === priority('kill_normal') && priority('chase_start') === priority('play_dodge'));
}
console.log('--- 台本・部品');
{
  ok('パターンの分解', JSON.stringify(tokens('[A]と[B]、接敵！')) === JSON.stringify(['[A]', 'と', '[B]', '、接敵！']));
  const c = clips({ k: 'kill_skill', p: 0, a: { A: 'hanamaru', B: 'metan', 技: 'hanamaru' } });
  ok('読みは台本、字幕は chars.json の名前・chars.ts の技名。名前類の直後の助詞は名前の部品にくっつける', c.map((x) => x.text).join('|') === '花丸の|てんきょうけんが|めたんを|捉えた！' && c.map((x) => x.sub).join('') === '満別花丸の巨大拳飛ばしが四国めたんを捉えた！', c);
  const old = CHARS.hanamaru.skill.name;
  CHARS.hanamaru.skill.name = 'テスト拳';
  ok('chars.ts の技名を変えると字幕が追従し、生成スクリプトは食い違いを警告', clips({ k: 'kill_skill', p: 0, a: { A: 'hanamaru', B: 'metan', 技: 'hanamaru' } }).some((x) => x.sub.startsWith('テスト拳')) && nameDrift().some((w) => w.includes('テスト拳')));
  CHARS.hanamaru.skill.name = old;
  ok('今の定義と台本の名前は一致', nameDrift().length === 0, nameDrift());
  const p = clips({ k: 'pre_start', p: 1, a: { 場所: 'library_R' } });
  ok('陣営側の部屋は「[組]側の[部屋]」（1つの部品。助詞もくっつける）', p.map((x) => x.sub).join('') === 'みどり組側の図書室に注目です！' && p[0].text === 'みどり組側の図書室に', p);
  ok('名前＋助詞の部品は台本の組み合わせから全部作る', ['花丸が', 'めたんを', 'だいだい組の', 'ずんだもんは', '玄野武宏の'].every((t) => allTexts().includes(t)));
  ok('数は0〜20（徳は四捨五入）', clips({ k: 'idle_toku', p: 0, a: { 組: [0, 1], n: 5.5, m: 4.4 } }).map((x) => x.sub).join('') === '徳の状況です。だいだい組6、みどり組4！');
  ok('全パターンの部品が台本にある', Object.keys(SCRIPT.lines).every((k) => (SCRIPT.lines as any)[k].length > 0) && allTexts().length > 0);
  ok('助っ人の字幕は config の名前', clips({ k: 'play_rampage', p: 0, a: { 助っ人: 'kurono' } })[0].sub === C.ASSIST.units.kurono.name);
}

// map.json の部屋の rect
function MAPROOM(id: string) { return MAP.rooms.find((r) => r.id === id)!.rect; }

console.log(fails ? `${fails} FAIL` : 'ALL PASS');
if (fails) process.exit(1);
