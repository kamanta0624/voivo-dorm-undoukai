// モダン（転落スペック）のスロットの抽選（handoff_slot2）。DOM・試合に依存しない純粋な処理（サーバーでも動く）。数値は CONFIG.SLOT_MODERN（単体画面から上書きできるように spec を渡す）
// 流れ: 抽選間隔ごとに保留を1つ積み（その時点の徳とモードで当否・色・先バレ・演出を決める）、先頭の保留を消化する。リーチ・全回転の間は消化を止め、満杯の保留への抽選は捨てる
// 通常 →（初当たり）→ CT →（転落）→ 引き戻し →（当選）→ CT ／（30回外れ）→ 通常
import { CONFIG } from './config';

export type Spec = typeof CONFIG.SLOT_MODERN;
export type Mode = 'normal' | 'ct' | 'back';
export type Outcome = 'win' | 'miss' | 'fall';
// act: リーチ演出のキー（spec.reach）、'allSpin'＝全回転、null＝リーチなし。reels: 出目（絵柄の番号 1〜9、転落は −1）。pay: 当選の払い出し（そろい目の種類と一致）
// Pay: group＝そろい目の種類（spec.reel.group）。add＝初当たりはパワーアップ・アシストの両方のレベル、CT・引き戻しは両方の上げ幅
export type Pay = { group: string; add: number };
export type Hold = { outcome: Outcome; mode: Mode; toku: number; color: number; saki: boolean; act: string | null; high: boolean; reels: number[]; pay?: Pay; forced?: boolean };
export type Ev =
  | { t: number; type: 'hold'; hold: Hold } // 保留を積んだ（先バレの光はここ）
  | { t: number; type: 'discard'; hold: Hold } // 保留が満杯で捨てた
  | { t: number; type: 'spin'; hold: Hold; mode: Mode; end: number } // 先頭の保留を消化して回転開始（end: 結果の出る時刻。リーチ・全回転は先）
  | { t: number; type: 'stop'; hold: Hold; mode: Mode } // 結果が出た
  | { t: number; type: 'win'; mode: Mode; pay: Pay; first: boolean; toku: number; chain: number } // 当選（first: 初当たり）
  | { t: number; type: 'fall'; toku: number } // 転落
  | { t: number; type: 'penalty'; n: 1 | 2 } // ペナルティ（転落で1回目、引き戻し失敗で2回目）
  | { t: number; type: 'mode'; mode: Mode; prev: Mode }
  | { t: number; type: 'end'; chain: number; maxLv: { power: number; assist: number } }; // 連チャンの終わり（引き戻し失敗で通常へ）。chain: CT・引き戻しの当選の回数

export const pick = (w: number[], u: number) => { const s = w.reduce((a, b) => a + b, 0); let x = u * s; for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; } return w.length - 1; };

// 徳 t・モードの当選確率と、CT の転落確率（B章の式）
export function winRate(spec: Spec, mode: Mode, t: number) {
  return Math.min(1, spec.base[mode] * 2 ** ((t - 5) / spec.tokuDiv.win) * (t < spec.lowBelow ? spec.lowWin : 1));
}
export function fallRate(spec: Spec, t: number) {
  return Math.min(1, spec.base.fall * 2 ** ((5 - t) / spec.tokuDiv.fall) * (t < spec.lowBelow ? spec.lowFall : 1));
}
// 強さの表示（n は1始まり）: パワーアップは 1・2・3・MAX、アシストは ★〜★★★★（CONFIG の POWER_TAGS・ASSIST_TAGS）。lvCap を超えたら「MAX+N」「★★★★+N」
export const powerText = (spec: Spec, n: number) => (n > spec.lvCap ? `${CONFIG.POWER_TAGS[CONFIG.POWER_TAGS.length - 1]}+${n - spec.lvCap}` : CONFIG.POWER_TAGS[n - 1]);
export const assistText = (spec: Spec, n: number) => (n > spec.lvCap ? `${CONFIG.ASSIST_TAGS[CONFIG.ASSIST_TAGS.length - 1]}+${n - spec.lvCap}` : CONFIG.ASSIST_TAGS[n - 1]);

// 信頼度（その演出・色・先バレが出たときの当選率）の理論値。徳 t・通常モード・高確率保留なし
export function reliability(spec: Spec, t: number, mode: Mode = 'normal') {
  const pw = winRate(spec, mode, t), pf = mode === 'ct' ? Math.min(1 - pw, fallRate(spec, t)) : 0, pm = 1 - pw - pf; // 転落は色・先バレでは外れ扱い、リーチなし
  const R = spec.reach, keys = Object.keys(R), sw = keys.reduce((a, k) => a + R[k].win, 0), sm = keys.reduce((a, k) => a + R[k].miss, 0);
  const rel = (w: number, m: number) => (w + m > 0 ? w / (w + m) : 0);
  const cw = spec.colorWin.reduce((a, b) => a + b, 0), cm = spec.colorMiss.reduce((a, b) => a + b, 0);
  return {
    win: pw,
    reach: rel(pw * (1 - spec.allSpin), pm * spec.reachMiss),
    act: Object.fromEntries(keys.map((k) => [k, rel((pw * (1 - spec.allSpin) * R[k].win) / sw, (pm * spec.reachMiss * R[k].miss) / sm)])),
    color: spec.colors.map((_, i) => rel((pw * spec.colorWin[i]) / cw, ((pm + pf) * spec.colorMiss[i]) / cm)),
    saki: rel(pw * spec.sakibare.win, pm * spec.sakibare.miss),
  };
}

// 当否に合わせた見た目: 保留の色・先バレ・リーチ演出（外れ側の選択率は徳によらず固定）。bad（転落・クラシックの罰）は外れの色で、先バレ・リーチなし
export function dress(S: Spec, outcome: Outcome | 'pen', rng: () => number) {
  const win = outcome === 'win', bad = outcome === 'fall' || outcome === 'pen';
  const color = pick(win ? S.colorWin : S.colorMiss, rng());
  const saki = bad ? false : rng() < (win ? S.sakibare.win : S.sakibare.miss);
  const R = S.reach, keys = Object.keys(R);
  let act: string | null = null;
  if (win) act = rng() < S.allSpin ? 'allSpin' : keys[pick(keys.map((k) => R[k].win), rng())];
  else if (!bad && rng() < S.reachMiss) act = keys[pick(keys.map((k) => R[k].miss), rng())];
  return { color, saki, act };
}

export class ModernSlot {
  t = 0; // 経過秒
  mode: Mode = 'normal';
  holds: Hold[] = [];
  cur: { hold: Hold; end: number } | null = null; // リーチ・全回転で結果待ちの回転
  timer: number; // 次の抽選までの秒数
  backLeft = 0; // 引き戻しの残り回数
  lv = { power: 0, assist: 0 };
  maxLv = { power: 0, assist: 0 }; // この連チャンの最高レベル
  chain = 0; // この連チャンの CT・引き戻しの当選回数
  nextHigh = false; // 次に積む保留を高確率保留にする
  ev: Ev[] = []; // 起きたこと（呼び出し側が読んで空にする）

  constructor(public spec: Spec = CONFIG.SLOT_MODERN, public toku = 5, public rng: () => number = Math.random) {
    this.timer = spec.interval.normal;
    for (let i = 0; i < spec.holds; i++) this.holds.push(this.makeHold());
  }

  // 保留を1つ作る（今の徳・モードで当否 → 色・先バレ・演出）
  makeHold(high = false): Hold {
    const S = this.spec, m = this.mode, t = this.toku, u = this.rng();
    let outcome: Outcome;
    if (high) outcome = u < S.high[m] ? 'win' : 'miss';
    else { const w = winRate(S, m, t), f = m === 'ct' ? fallRate(S, t) : 0; outcome = u < w ? 'win' : u < w + f ? 'fall' : 'miss'; }
    return this.fill({ outcome, mode: m, toku: t, ...dress(S, outcome, this.rng), high, reels: [] });
  }

  // 払い出しの抽選（通常＝reel.first、CT・引き戻し＝reel.ct の選択率でそろい目の種類を選ぶ）。group を指定するとその種類の効果
  drawPay(mode: Mode, group?: string): Pay {
    const table = mode === 'normal' ? this.spec.reel.first : this.spec.reel.ct, ks = Object.keys(table);
    const g = group ?? ks[pick(ks.map((k) => table[k].w), this.rng())];
    return { group: g, add: table[g].add };
  }

  // 出目と払い出しを決める。当選は払い出しのそろい目の種類の絵柄でそろえる（出目が指定されていればその絵柄の種類で払い出す）
  // リーチの外れは2つそろえて3つ目をずらす、リーチなしの外れは1つ目と2つ目を違えておく。転落は −1（×）
  fill(h: Hold): Hold {
    const gr = this.spec.reel.group, n = gr.length, any = () => 1 + Math.floor(this.rng() * n), other = (a: number) => 1 + ((a + Math.floor(this.rng() * (n - 1))) % n);
    if (h.outcome === 'win') {
      if (h.reels.length) h.pay ??= this.drawPay(h.mode, gr[h.reels[0] - 1]);
      else { h.pay ??= this.drawPay(h.mode); const ok = gr.map((v, i) => (v === h.pay!.group ? i + 1 : 0)).filter(Boolean), s = ok.length ? ok[Math.floor(this.rng() * ok.length)] : any(); h.reels = [s, s, s]; }
    } else if (!h.reels.length) {
      if (h.outcome === 'fall') h.reels = [-1, -1, -1];
      else { const a = any(), b = other(a); h.reels = h.act ? [a, a, b] : [a, b, any()]; }
    }
    return h;
  }

  // dt 秒進める（イベントの順に細かく刻む）
  step(dt: number) {
    let left = dt;
    while (left > 0) {
      const toEnd = this.cur ? this.cur.end - this.t : Infinity, d = Math.min(left, this.timer, toEnd);
      this.t += d; this.timer -= d; left -= d;
      if (this.cur && this.t >= this.cur.end - 1e-9) { const h = this.cur.hold; this.cur = null; this.resolve(h); }
      if (this.timer <= 1e-9) { this.timer += this.spec.interval[this.mode]; this.tick(); }
    }
  }

  // 抽選間隔ごと: 先頭を消化して1つ積む。結果待ちの間は積むだけ（満杯なら捨てる）
  tick() {
    const add = () => {
      const h = this.makeHold(this.nextHigh); this.nextHigh = false;
      if (this.holds.length >= this.spec.holds) return this.ev.push({ t: this.t, type: 'discard', hold: h });
      this.holds.push(h); this.ev.push({ t: this.t, type: 'hold', hold: h });
    };
    if (this.cur) return add();
    const h = this.holds.shift();
    add();
    if (!h) return;
    const sec = h.act === 'allSpin' ? this.spec.allSpinSec : h.act ? this.spec.reach[h.act].sec : 0;
    this.ev.push({ t: this.t, type: 'spin', hold: h, mode: this.mode, end: this.t + sec });
    if (sec > 0) this.cur = { hold: h, end: this.t + sec }; else this.resolve(h);
  }

  // 結果: 当選・転落・引き戻しの残り
  resolve(h: Hold) {
    const S = this.spec, m = this.mode;
    this.ev.push({ t: this.t, type: 'stop', hold: h, mode: m });
    if (h.outcome === 'win') {
      this.toku = Math.max(0, Math.min(10, this.toku + S.winToku));
      const pay = h.pay ?? this.drawPay(m);
      if (m === 'normal') { this.chain = 0; this.lv = { power: pay.add, assist: pay.add }; } // 初当たり: パワーアップ・アシストの両方のレベル1・2
      else { this.chain++; this.lv.power += pay.add; this.lv.assist += pay.add; }
      this.maxLv = { power: Math.max(m === 'normal' ? 0 : this.maxLv.power, this.lv.power), assist: Math.max(m === 'normal' ? 0 : this.maxLv.assist, this.lv.assist) };
      this.ev.push({ t: this.t, type: 'win', mode: m, pay, first: m === 'normal', toku: this.toku, chain: this.chain });
      if (m !== 'ct') this.setMode('ct');
      return;
    }
    if (h.outcome === 'fall') {
      this.ev.push({ t: this.t, type: 'fall', toku: this.toku }, { t: this.t, type: 'penalty', n: 1 });
      this.backLeft = S.backSpins; this.setMode('back');
      return;
    }
    if (m === 'back' && --this.backLeft <= 0) {
      this.ev.push({ t: this.t, type: 'penalty', n: 2 }, { t: this.t, type: 'end', chain: this.chain, maxLv: { ...this.maxLv } });
      this.lv = { power: 0, assist: 0 }; this.setMode('normal');
    }
  }

  // モードが変わったら、保留を新しいモードで引き直す（強制した保留と高確率保留の印は残す）。抽選間隔もそのモードから数え直す
  setMode(mode: Mode) {
    const prev = this.mode;
    this.mode = mode; this.timer = this.spec.interval[mode];
    this.holds = this.holds.map((h) => (h.forced ? h : this.makeHold(h.high)));
    this.ev.push({ t: this.t, type: 'mode', mode, prev });
  }

  // 徳を変える（次に積む保留から反映）
  setToku(t: number) { this.toku = Math.max(0, Math.min(10, t)); }

  // 手動発火: 次に消化する保留（先頭）を指定の内容に差し替える（当否つき）
  force(p: Partial<Hold> & { outcome: Outcome }) {
    const h = this.fill({ mode: this.mode, toku: this.toku, color: 0, saki: false, act: null, high: false, reels: [], ...p, forced: true });
    if (this.holds.length) this.holds[0] = h; else this.holds.push(h);
    this.ev.push({ t: this.t, type: 'hold', hold: h });
    return h;
  }
}
