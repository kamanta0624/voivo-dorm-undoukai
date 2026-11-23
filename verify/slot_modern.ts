// モダンのスロット（src/shared/slot_modern.ts）の単体テスト（handoff_slot2 成功基準1）。実行: npm run test:server
import { ModernSlot, winRate, fallRate, reliability, lvText, Hold, Mode } from '../src/shared/slot_modern';
import { CONFIG as C } from '../src/shared/config';

let fails = 0;
const ok = (name: string, cond: boolean, detail: any = '') => { if (!cond) fails++; console.log(cond ? 'PASS' : 'FAIL', name, typeof detail === 'string' ? detail : JSON.stringify(detail)); };
const S = C.SLOT_MODERN;
const near = (a: number, b: number, rel: number) => Math.abs(a - b) <= b * rel;
// 再現できる乱数（mulberry32）
const seeded = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// モード・徳を固定して保留を n 個作る
// full: 出目・払い出しも残す（大量に作るときは当否・演出・色・先バレだけ残してメモリを抑える）
const holds = (mode: Mode, toku: number, n: number, high = false, spec = S, full = false) => { const s = new ModernSlot(spec, toku, seeded(n + toku * 7 + mode.length)); s.mode = mode; return Array.from({ length: n }, () => { const h = s.makeHold(high); return full ? h : ({ outcome: h.outcome, act: h.act, saki: h.saki, color: h.color, high: h.high } as Hold); }); };
const frac = (hs: Hold[], f: (h: Hold) => boolean) => hs.filter(f).length / hs.length;

console.log('--- 抽選間隔・保留');
{
  // 抽選（保留を積む・捨てる）の間隔をモードごとに測る
  const gaps = (mode: Mode) => { const s = new ModernSlot(S, 5, seeded(1)); s.mode = mode; s.timer = S.interval[mode]; s.backLeft = 1e9; const at: number[] = []; for (let i = 0; i < 400; i++) { s.step(0.05); for (const e of s.ev) if ((e.type === 'hold' || e.type === 'discard') && s.mode === mode) at.push(e.t); s.ev = []; if (s.mode !== mode) break; } return [...new Set(at.slice(1).map((t, i) => +(t - at[i]).toFixed(3)))]; };
  const g = { normal: gaps('normal'), ct: gaps('ct'), back: gaps('back') };
  ok(`抽選間隔: 通常${S.interval.normal}秒・CT${S.interval.ct}秒・引き戻し${S.interval.back}秒`, g.normal.join() === '2' && g.ct.join() === '1' && g.back.join() === '0.5', g);
  // 長く回しても保留は常に4つ（リーチ中は消化を止め、満杯の抽選は捨てる）
  const s = new ModernSlot(S, 8, seeded(2)); let bad = 0, discards = 0, modes = new Set<string>();
  for (let i = 0; i < 20000; i++) { s.step(0.1); if (s.holds.length !== S.holds) bad++; discards += s.ev.filter((e) => e.type === 'discard').length; modes.add(s.mode); s.ev = []; }
  ok('保留は常に4つ（リーチ中も。満杯のときの抽選は捨てる）', bad === 0 && discards > 0 && modes.size === 3, { bad, discards, modes: [...modes] });
  // 保留を積む時点の徳で抽選している（積んだ後に徳を変えても当否は変わらない）
  const z = new ModernSlot(S, 10, seeded(3)); const before = z.holds.map((h) => h.toku); z.setToku(0); z.step(S.interval.normal + 1e-6);
  ok('保留はその時点の徳で抽選（積んだ保留の徳は残り、新しい保留から反映）', before.every((t) => t === 10) && z.holds.slice(0, 3).every((h) => h.toku === 10) && z.holds[3].toku === 0, z.holds.map((h) => h.toku));
}

console.log('--- 確率（徳5の基準値に収束）');
{
  const N = 2_000_000, n5 = holds('normal', 5, N), c5 = holds('ct', 5, N / 4), b5 = holds('back', 5, N);
  ok(`通常の当選 1/120`, near(frac(n5, (h) => h.outcome === 'win'), 1 / 120, 0.05), { got: 1 / frac(n5, (h) => h.outcome === 'win') });
  ok(`CT の当選 1/15・転落 1/30（同じ1回の抽選で排他）`, near(frac(c5, (h) => h.outcome === 'win'), 1 / 15, 0.03) && near(frac(c5, (h) => h.outcome === 'fall'), 1 / 30, 0.03) && !n5.some((h) => h.outcome === 'fall'), { win: 1 / frac(c5, (h) => h.outcome === 'win'), fall: 1 / frac(c5, (h) => h.outcome === 'fall') });
  ok(`引き戻しの当選 1/120`, near(frac(b5, (h) => h.outcome === 'win'), 1 / 120, 0.05), { got: 1 / frac(b5, (h) => h.outcome === 'win') });
  // 振り分け: 当選を結果まで進めて数える
  const pays = (mode: Mode, n: number) => { const s = new ModernSlot(S, 5, seeded(4 + mode.length)); const cnt: Record<string, number> = {}; for (let i = 0; i < n; i++) { s.mode = mode; s.toku = 5; s.resolve({ outcome: 'win', mode, toku: 5, color: 0, saki: false, act: null, high: false, reels: [] }); for (const e of s.ev) if (e.type === 'win') cnt[e.pay.group] = (cnt[e.pay.group] ?? 0) + 1; s.ev = []; } return Object.fromEntries(Object.entries(cnt).map(([k, v]) => [k, +(v / n * 100).toFixed(1)])); };
  const pf = pays('normal', 100000), pc = pays('ct', 100000);
  ok('初当たりのそろい目: 偶数 85%・奇数（7を含む）15%', near(pf.even, 85, 0.02) && near(pf.odd + pf.seven, 15, 0.05), pf);
  ok('CT の当選のそろい目: 偶数 50%・奇数（7以外）40%・7 10%', near(pc.even, 50, 0.03) && near(pc.odd, 40, 0.03) && near(pc.seven, 10, 0.06), pc);
}

console.log('--- 徳による確率の変化（B章の式）');
{
  const f = (t: number) => ({ win: 2 ** ((t - 5) / 2.5) * (t < 1 ? 0.5 : 1), fall: 2 ** ((5 - t) / 5) * (t < 1 ? 2 : 1) });
  ok('徳0・10: 当選 × 2^((t−5)/2.5)、転落 × 2^((5−t)/5)、徳1未満は当選×0.5・転落×2', [0, 0.5, 10].every((t) => Math.abs(winRate(S, 'normal', t) - S.base.normal * f(t).win) < 1e-12 && Math.abs(winRate(S, 'ct', t) - S.base.ct * f(t).win) < 1e-12 && Math.abs(fallRate(S, t) - S.base.fall * f(t).fall) < 1e-12)
    && Math.round(1 / winRate(S, 'normal', 10)) === 30 && Math.round(1 / winRate(S, 'normal', 0)) === 960 && Math.round(1 / fallRate(S, 0)) === 8, { w10: 1 / winRate(S, 'normal', 10), w0: 1 / winRate(S, 'normal', 0), f0: 1 / fallRate(S, 0), f10: 1 / fallRate(S, 10) });
  const n0 = holds('normal', 0, 3_000_000), n10 = holds('normal', 10, 300_000), c0 = holds('ct', 0, 300_000);
  ok('徳0・10 で実際の当選率・転落率も式どおり', near(frac(n0, (h) => h.outcome === 'win'), 1 / 960, 0.1) && near(frac(n10, (h) => h.outcome === 'win'), 1 / 30, 0.03) && near(frac(c0, (h) => h.outcome === 'fall'), 1 / 7.5, 0.03), { n0: 1 / frac(n0, (h) => h.outcome === 'win'), n10: 1 / frac(n10, (h) => h.outcome === 'win'), fall0: 1 / frac(c0, (h) => h.outcome === 'fall') });
  const s = new ModernSlot(S, 5, seeded(5)); s.resolve({ outcome: 'win', mode: 'normal', toku: 5, color: 0, saki: false, act: null, high: false, reels: [] }); const t1 = s.toku; s.resolve({ outcome: 'win', mode: 'ct', toku: 4, color: 0, saki: false, act: null, high: false, reels: [] });
  ok('当選のたびに徳 −1（初当たり・CT 当選）', t1 === 4 && s.toku === 3, { t1, t2: s.toku });
}

console.log('--- モードの移り変わり・レベル');
{
  const mk = () => { const s = new ModernSlot(S, 5, seeded(6)); s.resolve({ outcome: 'win', mode: 'normal', toku: 5, color: 0, saki: false, act: null, high: false, reels: [] }); s.ev = []; return s; };
  const miss: Hold = { outcome: 'miss', mode: 'back', toku: 5, color: 0, saki: false, act: null, high: false, reels: [] };
  const a = mk(); const m0 = a.mode; a.resolve({ ...miss, outcome: 'fall', mode: 'ct' }); const m1 = a.mode, left = a.backLeft;
  for (let i = 0; i < S.backSpins; i++) a.resolve(miss);
  const pen = a.ev.filter((e) => e.type === 'penalty').map((e: any) => e.n), end = a.ev.find((e) => e.type === 'end');
  ok(`初当たりで CT、転落で引き戻し（${S.backSpins}回）、30回外れでペナルティ2回・通常へ`, m0 === 'ct' && m1 === 'back' && left === S.backSpins && pen.join() === '1,2' && a.mode === 'normal' && !!end, { m0, m1, left, pen, mode: a.mode });
  const b = mk(); b.resolve({ ...miss, outcome: 'fall', mode: 'ct' }); for (let i = 0; i < 10; i++) b.resolve(miss); b.resolve({ ...miss, outcome: 'win' });
  ok('引き戻しで当選すると CT に戻る（ペナルティは転落の1回だけ）', b.mode === 'ct' && b.ev.filter((e) => e.type === 'penalty').length === 1, { mode: b.mode });
  // Lv4 に +1・+2
  const lv = (sym: number) => { const s = new ModernSlot(S, 5, seeded(7)); s.mode = 'ct'; s.lv = { power: 4, assist: 4 }; s.resolve({ ...miss, outcome: 'win', mode: 'ct', reels: [sym, sym, sym], pay: s.drawPay('ct', S.reel.group[sym - 1]) }); return s.lv; };
  const e = lv(2), o = lv(1), s7 = lv(7);
  ok('Lv4 で偶数・奇数・7 を受けると、両方が Lv.4・Lv.4+1・Lv.4+2（頭打ちにしない）', [e, o, s7].map((x) => `${lvText(S, x.power)}/${lvText(S, x.assist)}`).join() === 'Lv.4/Lv.4,Lv.4+1/Lv.4+1,Lv.4+2/Lv.4+2' && lvText(S, 4) === 'Lv.4', [e, o, s7].map((x) => [lvText(S, x.power), lvText(S, x.assist)]));
}

console.log('--- 先バレ・リーチ・全回転・高確率保留');
{
  const n5 = holds('normal', 5, 2_000_000);
  const sk = n5.filter((h) => h.saki);
  ok('徳5固定で先バレの当選率40%前後（転落では出ない）', near(frac(sk, (h) => h.outcome === 'win'), 0.4, 0.06) && !holds('ct', 5, 200000).some((h) => h.outcome === 'fall' && h.saki), { rel: frac(sk, (h) => h.outcome === 'win'), n: sk.length });
  const reach = (hs: Hold[]) => hs.filter((h) => h.act && h.act !== 'allSpin');
  ok('徳5固定でリーチの当選率10%前後', near(frac(reach(n5), (h) => h.outcome === 'win'), 0.1, 0.06), { rel: frac(reach(n5), (h) => h.outcome === 'win') });
  const table: Record<number, number> = { 0: 0.014, 2: 0.046, 5: 0.10, 8: 0.21, 10: 0.31 };
  const rows = [0, 2, 5, 8, 10].map((t) => { const hs = holds('normal', t, t === 0 ? 4_000_000 : 1_500_000), m = hs.filter((h) => h.outcome === 'miss'); return { t, missReach: +(1 / frac(m, (h) => !!h.act)).toFixed(2), rel: +frac(reach(hs), (h) => h.outcome === 'win').toFixed(4), theory: +reliability(S, t).reach.toFixed(4) }; });
  ok('徳0〜10 で外れ時のリーチ率は 1/13.4 のまま、信頼度は D章26の表どおり', rows.every((r) => near(r.missReach, 13.4, 0.02) && near(r.theory, table[r.t], 0.06) && near(r.rel, r.theory, r.t === 0 ? 0.25 : 0.08)), rows);
  const wins = n5.filter((h) => h.outcome === 'win');
  ok('リーチを経由しない当選は全回転だけで、当選の1%前後。全回転は当選でしか出ない', wins.every((h) => !!h.act) && near(frac(wins, (h) => h.act === 'allSpin'), 0.01, 0.35) && !n5.some((h) => h.outcome !== 'win' && h.act === 'allSpin'), { allSpin: frac(wins, (h) => h.act === 'allSpin'), wins: wins.length });
  const hn = holds('normal', 0, 200000, true), hc = holds('ct', 0, 200000, true);
  ok('高確率保留: 通常1/4・CT中1/2（徳によらない）、転落なし', near(frac(hn, (h) => h.outcome === 'win'), 0.25, 0.02) && near(frac(hc, (h) => h.outcome === 'win'), 0.5, 0.02) && !hc.some((h) => h.outcome === 'fall'), { n: frac(hn, (h) => h.outcome === 'win'), ct: frac(hc, (h) => h.outcome === 'win') });
  const s = new ModernSlot(S, 5, seeded(8)); s.nextHigh = true; s.step(S.interval.normal + 1e-6);
  ok('高確率保留のボタン: 次に積む保留1つだけが高確率保留', s.holds.filter((h) => h.high).length === 1 && s.holds[3].high && !s.nextHigh);
}

console.log('--- リールの9絵柄・魚群2段階（handoff_slot2b）');
{
  const R = S.reel, g = (n: number) => R.group[n - 1];
  ok('絵柄 1〜9: 奇数（1・3・5・9）＝プレイヤー4人、偶数＝アシスト4人、7＝大将', R.syms.length === 9 && [1, 3, 5, 9].every((n) => R.syms[n - 1].startsWith('player:') && g(n) === 'odd') && [2, 4, 6, 8].every((n) => R.syms[n - 1].startsWith('assist:') && g(n) === 'even') && R.syms[6] === 'boss' && g(7) === 'seven', R);
  // 当選のそろい目と払い出しが一致する（通常: 奇数・7＝Lv2・偶数＝Lv1、CT: 偶数＝+0・奇数＝+1・7＝+2）
  const wins = (mode: Mode, n: number) => holds(mode, 10, n, true, S, true).filter((h) => h.outcome === 'win');
  const wn = wins('normal', 80000), wc = wins('ct', 40000);
  const match = (hs: Hold[], want: Record<string, number>) => hs.every((h) => h.reels.length === 3 && h.reels.every((x) => x === h.reels[0]) && h.pay!.group === g(h.reels[0]) && h.pay!.add === want[g(h.reels[0])]);
  const syms = new Set(wn.concat(wc).map((h) => h.reels[0]));
  ok('当選のそろい目と払い出しが一致（通常: 奇数・7＝Lv2、偶数＝Lv1。CT: 偶数＝+0、奇数＝+1、7＝+2）。9絵柄すべて出る', match(wn, { odd: 2, seven: 2, even: 1 }) && match(wc, { even: 0, odd: 1, seven: 2 }) && syms.size === 9, { syms: [...syms].sort() });
  ok('初当たりの奇数（7を含む）のそろい目 15%前後', near(frac(wn, (h) => g(h.reels[0]) !== 'even'), 0.15, 0.08), { odd: frac(wn, (h) => g(h.reels[0]) !== 'even') });
  // 7 の効果だけ変えると、7 のそろい目だけがその効果になる
  const sp7 = { ...S, reel: { ...S.reel, ct: { ...S.reel.ct, seven: { w: 10, add: 5 } } } };
  const w7 = holds('ct', 10, 40000, true, sp7, true).filter((h) => h.outcome === 'win' && h.reels[0] === 7);
  ok('絵柄と効果の対応は reel の1か所（7 だけ後から変えられる）', w7.length > 0 && w7.every((h) => h.pay!.add === 5), { n: w7.length });
  // 外れ・リーチの外れ・転落・全回転の出目
  const all = holds('ct', 5, 300000, false, S, true);
  const miss = all.filter((h) => h.outcome === 'miss'), rm = miss.filter((h) => h.act), nm = miss.filter((h) => !h.act), fl = all.filter((h) => h.outcome === 'fall'), as = all.filter((h) => h.act === 'allSpin');
  const inRange = (h: Hold) => h.reels.every((x) => x >= 1 && x <= 9);
  ok('出目: リーチの外れは2つそろって3つ目が違う、リーチなしの外れは1つ目と2つ目が違う、転落は×××、全回転は同じ絵柄でそろう', rm.every((h) => inRange(h) && h.reels[0] === h.reels[1] && h.reels[2] !== h.reels[0]) && nm.every((h) => inRange(h) && h.reels[0] !== h.reels[1]) && fl.every((h) => h.reels.join() === '-1,-1,-1') && as.every((h) => h.reels.every((x) => x === h.reels[0])), { rm: rm.length, nm: nm.length, fl: fl.length, as: as.length });
  // 強制した出目: そろい目の絵柄の強さで払い出す
  const fz = new ModernSlot(S, 5, seeded(9)); fz.mode = 'ct'; const f7 = fz.force({ outcome: 'win', reels: [7, 7, 7] }), f4 = fz.force({ outcome: 'win', reels: [4, 4, 4] });
  ok('手動で指定したそろい目も、その絵柄の効果で払い出す', f7.pay!.add === 2 && f4.pay!.add === 0, { f7: f7.pay, f4: f4.pay });
  // 特別な魚群の信頼度は通常の魚群より高い（理論値・実測）
  const th = [0, 5, 10].map((t) => ({ t, fish: reliability(S, t).act.fish, fishSp: reliability(S, t).act.fishSp }));
  const h5 = holds('normal', 8, 3_000_000), fr = (k: string) => frac(h5.filter((h) => h.act === k), (h) => h.outcome === 'win');
  ok('特別な魚群の当選時の信頼度は通常の魚群より高い（徳0・5・10の理論値、徳8の実測）', th.every((x) => x.fishSp > x.fish) && fr('fishSp') > fr('fish') && S.special.includes('fishSp') && !S.special.includes('fish'), { th, measured8: { fish: fr('fish'), fishSp: fr('fishSp') } });
}

console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
