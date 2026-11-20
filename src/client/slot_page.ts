// モダンのスロットの単体画面（handoff_slot2 E章）。抽選は src/shared/slot_modern.ts、演出は src/client/slot_modern_fx.ts を呼ぶだけ
import { CONFIG as C } from '../shared/config';
import { BOSS_CHAR } from '../shared/chars';
import { ModernSlot, reliability, lvText, Hold, Ev, Mode } from '../shared/slot_modern';
import { ModernFx, HOLD_COLORS } from './slot_modern_fx';

const spec = structuredClone(C.SLOT_MODERN) as typeof C.SLOT_MODERN; // 画面から書き換える（定数ファイルは変えない）
const CHARS = ['hanamaru', 'sayo', 'metan', 'kiritan']; // 陣営のプレイヤー（仮置き: 単体画面には編成が無い）。魚群にも使う
const ASSISTS = Object.keys(C.ASSIST.units), BOSS = BOSS_CHAR[0]; // 陣営の切替は無いので陣営0の大将
// リールの絵柄 1〜9 → キャラ（SLOT_MODERN.reel.syms）
const SYMS = spec.reel.syms.map((s) => (s === 'boss' ? BOSS : s.startsWith('assist:') ? ASSISTS[Number(s.slice(7))] : CHARS[Number(s.slice(7))]));
const MODE_NAME: Record<Mode, string> = { normal: '通常', ct: 'CT', back: '引き戻し' };
const OUT_NAME: Record<string, string> = { win: '当選', miss: '外れ', fall: '転落' };
const actName = (a: string | null) => (a === 'allSpin' ? '全回転' : a ? spec.reach[a].name : '');
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');
const oneIn = (a: number, b: number) => (a ? `1/${(b / a).toFixed(1)}` : '-');

document.head.insertAdjacentHTML('beforeend', `<style>
#app{display:flex;flex-wrap:wrap;gap:12px;padding:12px}
.frame{position:relative;background:#000;overflow:hidden;flex:none}
.logic{position:absolute;left:0;top:0;width:${C.VIEW_W}px;height:${C.VIEW_H}px;transform-origin:0 0;overflow:hidden;background:repeating-linear-gradient(45deg,#4a4438 0 16px,#524b3e 16px 32px)}
.fog{position:absolute;inset:0;background:radial-gradient(circle ${C.VISION_RADIUS}px at 50% 50%,transparent ${C.VISION_RADIUS - 0.5}px,#000d ${C.VISION_RADIUS}px)}
.vis{position:absolute;left:${C.VIEW_W / 2 - C.VISION_RADIUS}px;top:${C.VIEW_H / 2 - C.VISION_RADIUS}px;width:${C.VISION_RADIUS * 2}px;height:${C.VISION_RADIUS * 2}px;border:1px dashed #0f08;border-radius:50%;box-sizing:border-box}
.kl{position:absolute;border:1px dashed #f80c;color:#f80;font-size:7px;box-sizing:border-box;padding:1px}
.me{position:absolute;left:${C.VIEW_W / 2 - 16}px;top:${C.VIEW_H / 2 - 36}px}
.hudpos{position:absolute;left:50%;top:6.4%;transform:translateX(-50%)}
.panel{background:#1f1f2a;border-radius:6px;padding:8px 10px;min-width:280px;max-width:640px;flex:1}
.panel h3{margin:0 0 6px;font-size:13px;color:#ffd700}
.panel table{border-collapse:collapse;font-size:12px}.panel td,.panel th{border:1px solid #333;padding:1px 5px;text-align:right}.panel th{color:#aaa;font-weight:normal}
.panel input[type=number]{width:52px;background:#111;color:#eee;border:1px solid #444}
.row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0}
button,select{background:#2c2c3c;color:#eee;border:1px solid #555;border-radius:4px;padding:2px 8px;font:inherit}
button.on{background:#5a4a10;border-color:#ffd700}
#log{font:11px monospace;white-space:pre;max-height:220px;overflow:auto;background:#111;padding:4px}
textarea{width:100%;height:140px;background:#111;color:#cfc;font:11px monospace}
.sw{display:inline-block;width:10px;height:10px;border-radius:50%;vertical-align:middle}
</style>`);
document.body.innerHTML = `<div id="app">
<div><div class="row"><b>演出の範囲</b><button id="pc" class="on">PC 1280×720</button><button id="sp">スマホ 844×390</button><span style="color:#888">緑の点線＝視界（半径${C.VISION_RADIUS}）、橙＝キルログ域</span></div>
<div class="frame" id="frame"><div class="logic" id="logic"><div class="fog"></div><div class="vis"></div><div class="kl" id="kl">キルログ域</div><img class="me" src="assets/gen/dot/zunko/idle.png" style="image-rendering:pixelated"><div class="hudpos" id="hud"></div><div id="layer" style="position:absolute;inset:0"></div></div></div></div>
<div class="panel"><h3>操作</h3>
<div class="row">徳 <input id="toku" type="range" min="0" max="10" step="0.1" style="width:180px"><b id="tokuV"></b><label><input id="fixed" type="checkbox">徳を固定（当選で減らさない）</label></div>
<div class="row">速さ <button data-sp="1" class="on">×1</button><button data-sp="10">×10</button><button data-sp="100">×100</button><button id="pause">一時停止</button><button id="reset">リセット（統計も）</button></div>
<div class="row"><label><input id="saki" type="checkbox" checked>先バレ表示</label><label><input id="snd" type="checkbox" checked>先バレの音</label><span id="now"></span></div>
<h3>手動発火（次に回る保留を差し替え）</h3>
<div class="row">当否 <select id="fOut"><option value="win">当選</option><option value="miss">外れ</option></select>
<button id="fReach">リーチ</button><select id="fAct">${Object.keys(spec.reach).map((k) => `<option value="${k}">${spec.reach[k].name}</option>`).join('')}</select>
そろい目 <select id="fSym"><option value="">おまかせ</option>${spec.reel.syms.map((_, i) => `<option value="${i + 1}">${i + 1}${spec.reel.add[i] === 2 ? '（良）' : ''}</option>`).join('')}</select>
<button id="fAll">全回転（当選）</button><button id="fSaki">先バレ</button><button id="fColor">保留の色</button><select id="fCol">${spec.colors.map((c, i) => `<option value="${i}">${c}</option>`).join('')}</select>
<button id="fHigh">高確率保留</button><button id="fFall">転落</button></div>
<h3>統計</h3><div id="stats"></div></div>
<div class="panel"><h3>選択率の表（書き換えるとすぐ反映）・信頼度（理論値、通常モード）</h3><div id="rates"></div>
<h3>定数（書き出し・読み込み。SLOT_MODERN の形式）</h3><textarea id="spec"></textarea><div class="row"><button id="apply">この内容を読み込む</button><span id="applyMsg"></span></div></div>
<div class="panel"><h3>ログ（直近）</h3><div id="log"></div></div>
</div>`;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const k = spec.area.killLog; Object.assign($('#kl').style, { left: `${k.x}px`, top: `${k.y}px`, width: `${k.w}px`, height: `${k.h}px` });
const fx = new ModernFx($('#hud'), $('#layer'), SYMS, CHARS, '#f0a030');
fx.idle(performance.now());
const save = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch {} };
const load = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };

// 画面の大きさ: PC は2倍、スマホ幅は試合と同じ決め方（整数倍、1未満は縮小しない）
let phone = false;
function layout() {
  const [fw, fh] = phone ? [844, 390] : [1280, 720], z = Math.max(1, Math.floor(Math.min(fw / C.VIEW_W, fh / C.VIEW_H)));
  Object.assign($('#frame').style, { width: `${fw}px`, height: `${fh}px` });
  Object.assign($('#logic').style, { transform: `scale(${z})`, left: `${(fw - C.VIEW_W * z) / 2}px`, top: `${(fh - C.VIEW_H * z) / 2}px` });
  $('#pc').classList.toggle('on', !phone); $('#sp').classList.toggle('on', phone);
}
$('#pc').onclick = () => { phone = false; layout(); }; $('#sp').onclick = () => { phone = true; layout(); };
layout();

// 統計
type Cnt = { n: number; win: number };
const cnt = (): Cnt => ({ n: 0, win: 0 });
let st = newStats();
function newStats() {
  return { sec: 0, draws: 0, discards: 0, spins: { normal: 0, ct: 0, back: 0 } as Record<Mode, number>, wins: { normal: 0, ct: 0, back: 0 } as Record<Mode, number>, first: [] as number[], normalAt: 0,
    reach: cnt(), act: {} as Record<string, Cnt>, saki: cnt(), color: spec.colors.map(cnt), high: cnt(), chains: [] as number[], falls: 0, pen: [0, 0], maxLv: { power: 0, assist: 0 } };
}

let slot = new ModernSlot(spec, 5);
let speed = 1, paused = false, last = performance.now(), idleAt = 0;
const logLines: string[] = [];
const log = (s: string) => { logLines.push(s); if (logLines.length > 60) logLines.shift(); };

function onEv(e: Ev, show: boolean, now: number) {
  const tt = e.t.toFixed(1).padStart(7);
  if (e.type === 'hold') { if (!e.hold.forced) st.draws++; if (show && e.hold.saki) fx.sakibare(); }
  else if (e.type === 'discard') { st.draws++; st.discards++; }
  else if (e.type === 'spin') {
    const r = e.hold.reels;
    if (!show) return;
    const sec = (e.end - e.t);
    if (sec > 0) { fx.spin(now, r, e.hold.act); if (e.hold.act === 'allSpin') fx.allSpinFx(SYMS[r[0] - 1], sec); else fx.reach(e.hold.act!, SYMS[r[0] - 1], sec, e.hold.outcome === 'win'); }
  } else if (e.type === 'stop') {
    const h = e.hold, w = h.outcome === 'win' ? 1 : 0;
    st.spins[e.mode]++; st.wins[e.mode] += w;
    if (h.act && h.act !== 'allSpin') { st.reach.n++; st.reach.win += w; }
    if (h.act) { const c = (st.act[h.act] ??= cnt()); c.n++; c.win += w; }
    if (h.saki) { st.saki.n++; st.saki.win += w; }
    if (h.high) { st.high.n++; st.high.win += w; }
    st.color[h.color].n++; st.color[h.color].win += w;
    if (h.act || h.saki || h.outcome !== 'miss' || h.high || h.color) log(`${tt}s 徳${h.toku.toFixed(1)} ${MODE_NAME[e.mode].padEnd(4, '　')} ${OUT_NAME[h.outcome]} [${h.reels.join('')}] ${h.act ? `リーチ:${actName(h.act)}` : ''} 色:${spec.colors[h.color]}${h.saki ? ' 先バレ' : ''}${h.high ? ' 高確率' : ''}`);
    if (show) { fx.stop(h.reels, h.outcome); idleAt = now + Math.min(600, spec.interval[slot.mode] * 500); }
  } else if (e.type === 'win') {
    if (e.first) st.first.push(e.t - st.normalAt);
    st.maxLv.power = Math.max(st.maxLv.power, slot.lv.power); st.maxLv.assist = Math.max(st.maxLv.assist, slot.lv.assist);
    const txt = e.first ? `初当たり アシスト ${lvText(spec, e.pay.add)}` : `${e.pay.kind === 'power' ? 'パワーアップ' : 'アシスト'} +${e.pay.add} → ${lvText(spec, slot.lv[e.pay.kind])}（${e.chain}連）`;
    log(`${tt}s ★${txt} 徳→${e.toku.toFixed(1)}`); if (show) fx.toast(txt);
  } else if (e.type === 'fall') { st.falls++; log(`${tt}s ▼転落`); }
  else if (e.type === 'penalty') { st.pen[e.n - 1]++; log(`${tt}s ▼ペナルティ発生（${e.n}回目）`); if (show) fx.toast(`ペナルティ発生（${e.n}回目）`, true); }
  else if (e.type === 'mode') { log(`${tt}s → ${MODE_NAME[e.mode]}`); if (e.mode === 'normal') st.normalAt = e.t; }
  else if (e.type === 'end') { st.chains.push(e.chain); log(`${tt}s 連チャン終了 ${e.chain}連 最高 パワー${lvText(spec, e.maxLv.power)}・アシスト${lvText(spec, e.maxLv.assist)}`); }
}

function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused) {
    const show = speed === 1, fixed = $<HTMLInputElement>('#fixed').checked, want = Number($<HTMLInputElement>('#toku').value);
    let left = dt * speed;
    while (left > 0) { const d = Math.min(left, 0.25); left -= d; if (fixed) slot.setToku(want); slot.step(d); st.sec += d; for (const e of slot.ev) onEv(e, show, now); slot.ev = []; }
    if (!fixed) { $<HTMLInputElement>('#toku').value = String(slot.toku); }
    if (show && idleAt && now >= idleAt && !slot.cur) { idleAt = 0; fx.idle(now); }
  }
  fx.frame(now);
  fx.holds(slot.holds, slot.cur?.hold ?? null);
  fx.mode(slot.mode, slot.backLeft, `パワーアップ ${lvText(spec, slot.lv.power)}・アシスト ${lvText(spec, slot.lv.assist)}`);
  $('#tokuV').textContent = slot.toku.toFixed(1);
  $('#now').textContent = `経過 ${st.sec.toFixed(0)}秒（シミュレーション）`;
  requestAnimationFrame(loop);
}
setInterval(() => { renderStats(); $('#log').textContent = logLines.slice().reverse().join('\n'); }, 300);

function renderStats() {
  const s = st, f = [...s.first].sort((a, b) => a - b), ch = s.chains, maxC = Math.max(0, ...ch);
  const dist = Array.from({ length: Math.min(maxC, 10) + 1 }, (_, i) => `<td>${i === 10 ? '10+' : i}</td>`).join('');
  const distN = Array.from({ length: Math.min(maxC, 10) + 1 }, (_, i) => `<td>${ch.filter((c) => (i === 10 ? c >= 10 : c === i)).length}</td>`).join('');
  const rel = (c: Cnt) => `<td>${c.n}</td><td>${c.win}</td><td>${pct(c.win, c.n)}</td>`;
  $('#stats').innerHTML = `<table>
<tr><th>抽選（保留を積んだ／捨てた）</th><td colspan="3">${s.draws}／${s.discards}（${pct(s.discards, s.draws)}）</td></tr>
<tr><th>初当たり</th><td colspan="3">${f.length}回、通常に入ってからの秒数 平均 ${f.length ? (f.reduce((a, b) => a + b, 0) / f.length).toFixed(0) : '-'}・中央値 ${f.length ? f[f.length >> 1].toFixed(0) : '-'}</td></tr>
${(['normal', 'ct', 'back'] as Mode[]).map((m) => `<tr><th>当選率（${MODE_NAME[m]}）</th><td colspan="3">${oneIn(s.wins[m], s.spins[m])}（${s.wins[m]}/${s.spins[m]}回転）</td></tr>`).join('')}
<tr><th></th><th>回数</th><th>当選</th><th>信頼度</th></tr>
<tr><th>リーチ（全体）</th>${rel(s.reach)}</tr>
${Object.keys(spec.reach).concat('allSpin').map((a) => `<tr><th>　${actName(a)}</th>${rel(s.act[a] ?? cnt())}</tr>`).join('')}
<tr><th>先バレ</th>${rel(s.saki)}</tr><tr><th>高確率保留</th>${rel(s.high)}</tr>
${spec.colors.map((c, i) => `<tr><th>保留 <span class="sw" style="background:${HOLD_COLORS[i]}"></span> ${c}</th>${rel(s.color[i])}</tr>`).join('')}
<tr><th>転落・ペナルティ（1回目／2回目）</th><td colspan="3">${s.falls}・${s.pen[0]}／${s.pen[1]}</td></tr>
<tr><th>最高到達レベル</th><td colspan="3">パワーアップ ${lvText(spec, s.maxLv.power)}・アシスト ${lvText(spec, s.maxLv.assist)}</td></tr>
</table>
<div style="margin-top:4px">連チャン数の分布（${ch.length}回、平均 ${ch.length ? (ch.reduce((a, b) => a + b, 0) / ch.length).toFixed(2) : '-'}）<table><tr><th>連</th>${dist}</tr><tr><th>回</th>${distN}</tr></table></div>`;
}

// 選択率の表（書き換え）と、徳0・5・10での信頼度
function renderRates() {
  const R = spec.reach, T = [0, 5, 10], rs = T.map((t) => reliability(spec, t));
  const inp = (path: string, v: number, step = 1) => `<input type="number" data-p="${path}" value="${+v.toFixed(6)}" step="${step}">`;
  const rel = (f: (r: ReturnType<typeof reliability>) => number) => rs.map((r) => `<td>${(f(r) * 100).toFixed(1)}%</td>`).join('');
  $('#rates').innerHTML = `<table><tr><th></th><th>当選時</th><th>外れ時</th><th>秒</th>${T.map((t) => `<th>徳${t}</th>`).join('')}</tr>
<tr><th>当選確率（通常）</th><td colspan="3"></td>${rel((r) => r.win)}</tr>
<tr><th>リーチ（全体）</th><td>${inp('allSpin', 1 - spec.allSpin, 0.001).replace('data-p="allSpin"', 'data-p="!reachWin"')}</td><td>${inp('reachMiss', spec.reachMiss, 0.001)}</td><td></td>${rel((r) => r.reach)}</tr>
${Object.keys(R).map((a) => `<tr><th>　${R[a].name}</th><td>${inp(`reach.${a}.win`, R[a].win)}</td><td>${inp(`reach.${a}.miss`, R[a].miss)}</td><td>${inp(`reach.${a}.sec`, R[a].sec, 0.1)}</td>${rel((r) => r.act[a])}</tr>`).join('')}
<tr><th>全回転（当選の割合）</th><td>${inp('allSpin', spec.allSpin, 0.001)}</td><td>0</td><td>${inp('allSpinSec', spec.allSpinSec, 0.1)}</td><td colspan="3">当選確定</td></tr>
<tr><th>先バレ（発生率）</th><td>${inp('sakibare.win', spec.sakibare.win, 0.01)}</td><td>${inp('sakibare.miss', spec.sakibare.miss, 0.0001)}</td><td></td>${rel((r) => r.saki)}</tr>
${spec.colors.map((c, i) => `<tr><th>保留 <span class="sw" style="background:${HOLD_COLORS[i]}"></span> ${c}</th><td>${inp(`colorWin.${i}`, spec.colorWin[i])}</td><td>${inp(`colorMiss.${i}`, spec.colorMiss[i])}</td><td></td>${rel((r) => r.color[i])}</tr>`).join('')}
</table><div style="color:#888">演出・色は重み（当選時どうし・外れ時どうしで割合になる）。リーチ（全体）の当選時＝1−全回転</div>`;
  $<HTMLTextAreaElement>('#spec').value = `SLOT_MODERN: ${JSON.stringify(spec, null, 2)},`;
}
$('#rates').addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement, p = el.dataset.p!, v = Number(el.value);
  if (!Number.isFinite(v)) return;
  if (p === '!reachWin') spec.allSpin = 1 - v;
  else { const ks = p.split('.'); let o: any = spec; for (const q of ks.slice(0, -1)) o = o[q]; o[ks.at(-1)!] = v; }
  renderRates();
});
$('#apply').onclick = () => {
  try { const j = JSON.parse($<HTMLTextAreaElement>('#spec').value.replace(/^\s*SLOT_MODERN:\s*/, '').replace(/,\s*$/, '')); Object.assign(spec, j); renderRates(); $('#applyMsg').textContent = '読み込んだ'; }
  catch (e: any) { $('#applyMsg').textContent = `読み込めない: ${e.message}`; }
};
renderRates();

// 操作
$<HTMLInputElement>('#toku').value = '5';
$('#toku').oninput = () => slot.setToku(Number($<HTMLInputElement>('#toku').value));
for (const b of document.querySelectorAll<HTMLElement>('[data-sp]')) b.onclick = () => { speed = Number(b.dataset.sp); document.querySelectorAll('[data-sp]').forEach((x) => x.classList.toggle('on', x === b)); if (speed !== 1) fx.clearFx(); };
$('#pause').onclick = () => { paused = !paused; $('#pause').classList.toggle('on', paused); };
$('#reset').onclick = () => { slot = new ModernSlot(spec, Number($<HTMLInputElement>('#toku').value)); st = newStats(); logLines.length = 0; fx.clearFx(); };
const sakiEl = $<HTMLInputElement>('#saki'), sndEl = $<HTMLInputElement>('#snd');
sakiEl.checked = load('slotSaki') !== '0'; sndEl.checked = load('slotSnd') !== '0';
const applyCustom = () => { fx.sakiOn = sakiEl.checked; fx.sound = sndEl.checked; save('slotSaki', sakiEl.checked ? '1' : '0'); save('slotSnd', sndEl.checked ? '1' : '0'); };
sakiEl.onchange = sndEl.onchange = applyCustom; applyCustom();
const out = () => $<HTMLSelectElement>('#fOut').value as 'win' | 'miss';
// 当選のそろい目（おまかせ＝払い出しの抽選に合う絵柄）
const sym = (o: string) => { const v = Number($<HTMLSelectElement>('#fSym').value); return o === 'win' && v ? { reels: [v, v, v] } : {}; };
$('#fReach').onclick = () => slot.force({ outcome: out(), act: $<HTMLSelectElement>('#fAct').value, ...sym(out()) });
$('#fAll').onclick = () => slot.force({ outcome: 'win', act: 'allSpin', ...sym('win') });
$('#fSaki').onclick = () => slot.force({ outcome: out(), saki: true, ...sym(out()) });
$('#fColor').onclick = () => slot.force({ outcome: out(), color: Number($<HTMLSelectElement>('#fCol').value), ...sym(out()) });
$('#fHigh').onclick = () => { slot.nextHigh = true; };
$('#fFall').onclick = () => slot.force({ outcome: 'fall' });

(window as any).slotPage = { get slot() { return slot; }, get stats() { return st; }, spec, renderStats, fx };
requestAnimationFrame(loop);
