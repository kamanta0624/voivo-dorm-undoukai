// DOM の HUD（refac3 で main.ts から切り出し。中身は変えていない）: 一覧・バフ・徳・スロット・キルログ・バナー・通知・浮く文字・カットイン・開幕の演出・練習パネル。形は「関数(scene, …)」
import { CONFIG as C } from '../shared/config';
import { BOSS_CHAR } from '../shared/chars';
import { powerText, assistText } from '../shared/slot_modern';
import { ModernFx } from './slot_modern_fx';
import { type GameScene, $, css16, TEAM_COLOR, TEAM_NAME, setCss, fx, TACHIE, setText, mapEl, BUFF, CHARS, charName, boxes } from './main';

export function rosterHud(sc: GameScene, s: any, myTeam: number, sinceSnap: number) {
  const c = css16(TEAM_COLOR[myTeam]), hp: number[] = [], bar = (p: any) => (hp.push(p ? Math.min(1, p.hp / p.maxHp) : 1), '<span class="hp"><i></i></span>'); // HP バーの長さは骨組みと分けて transform で（HP が変わるたびに HTML を作り直さない）
  const rs: string[] = []; // 復活までの秒（数字の要素の文字だけ書く。一覧ごと作り直さない。dom1）
  const tag = (t: string) => `<em class="pt">${t}</em>`, ut = (r: any) => (r.ult !== null && r.ult !== undefined && r.alive ? tag(C.POWER_TAGS[Math.min(r.ult, C.POWER_TAGS.length - 1)]) : ''); // 強さの札: パワーアップ中は 1〜MAX、アシストは★
  const allies = '<div class="rw">' + s.roster.filter((r: any) => r.team === myTeam).map((r: any) => {
    const p = s.players.find((q: any) => q.id === r.id), alive = p ? p.alive : r.alive;
    return `<div class="mem" style="--c:${c}">${sc.icon(r.char, myTeam, !alive)}${alive ? bar(p) : (rs.push(String(Math.max(0, Math.ceil((p?.respawnIn ?? 0) - sinceSnap)))), '<b class="rs"></b>')}${ut(r)}</div>`;
  }).join('') + '</div>' + s.players.filter((p: any) => p.assist && p.alive && p.team === myTeam).map((p: any) => `<div class="mem as" style="--c:${c}">${sc.icon(p.char, myTeam)}${bar(p)}${tag(C.ASSIST_TAGS[Math.min(p.tier, C.ASSIST_TAGS.length - 1)])}</div>`).join(''); // アシスト（撃破されたら消える）
  const foes = '<div class="rw">' + s.roster.filter((r: any) => r.team !== myTeam).map((r: any) => `<div class="mem">${sc.icon(r.char, 1 - myTeam, !r.alive)}${ut(r)}</div>`).join('') + '</div>';
  const html = myTeam === 0 ? [allies, foes] : [foes, allies];
  html.forEach((h, k) => { if (h !== sc.rosterHtml[k]) { sc.rosterHtml[k] = h; $(`.r${k}`).innerHTML = h; } });
  $(`.r${myTeam}`).querySelectorAll<HTMLElement>('.hp i').forEach((e, i) => sc.setTf(e, `scaleX(${Math.max(0, hp[i] ?? 1)})`));
  $(`.r${myTeam}`).querySelectorAll<HTMLElement>('.rs').forEach((e, i) => setText(e, rs[i] ?? ''));
}

// バフ／デバフ欄（自キャラだけ。常に左上の組のアイコン列の下）: 時間制限つきの状態を名前＋残り秒数で。良い効果は緑、悪い効果は赤。指名手配中は悪行ポイント
export function buffHud(sc: GameScene, s: any, mine: any, myTeam: number, sinceSnap: number) {
  const items: [string, string, boolean][] = []; // 名前, 値, 良い効果か
  if (mine?.alive && s.phase === 'playing') {
    for (const [k, v] of Object.entries((s.buffs ?? {}) as Record<string, number>)) {
      const b = BUFF[k], left = v - sinceSnap;
      if (b && left > 0) items.push([b[0], `${Math.ceil(left)}`, b[1]]);
    }
    if (mine.ult && mine.ult.left !== null && mine.ult.left - sinceSnap > 0) items.push([`パワーアップ${powerText(C.SLOT_MODERN, mine.ult.tier + 1)}`, `${Math.ceil(mine.ult.left - sinceSnap)}`, true]);
    if (s.teams?.[myTeam]?.wanted === s.me) items.push(['指名手配', `悪行${(mine.bad ?? 0).toFixed(1)}`, false]);
  }
  const html = items.map(([n, , good]) => `<span class="${good ? 'good' : 'bad'}"></span>`).join(''); // 骨組みは項目が変わった時だけ作り、文字（名前と秒）は項目ごとに変わった時だけ書く（欄ごと作り直さない。dom1）
  const el = $('.buffs');
  if (html !== sc.buffHtml) { sc.buffHtml = html; el.innerHTML = html; }
  el.querySelectorAll<HTMLElement>('span').forEach((e, i) => setText(e, items[i] ? `${items[i][0]} ${items[i][1]}` : ''));
  // 位置: 左上の一覧（.r0）の下に自分の情報パネル（上に WANTED の分を空ける）、その下にバフ欄。一覧の中身・パネルの表示が変わった時と、ResizeObserver が測り直した時だけ置き直す（位置は boxes。ここでは読まない。dom1）
  const meP = $('.me'), meOn = !!mine && s.phase !== 'waiting', key = `${sc.rosterHtml[0]}|${meOn}|${boxes.ver}`;
  if (key !== sc.buffTopOf || sc.fxFit > 0) {
    sc.buffTopOf = key;
    setCss(meP, 'display', meOn ? 'block' : 'none');
    if (!boxes.r0 || !boxes.fx) return;
    const z = sc.game.scale.zoom, top = boxes.r0.bottom - boxes.fx.top + 4; // 顔パネルは zoom（HUD_SCALE）で大きくしているので、表示上の下端から
    const meTop = top + 13 * z; // WANTED の表記の高さ
    setCss(meP, 'top', `${meTop}px`);
    setCss(el, 'top', `${meOn ? meTop + boxes.meH + 4 : top}px`);
  }
}

// 徳のゲージとスロット（左＝陣営0、右＝陣営1）。クラシック・モダンとも保留つきの表示（modernHud）
export function tokuHud(sc: GameScene, s: any) {
  [0, 1].forEach((t, k) => {
    const tm = s.teams[t], chars = s.roster.filter((r: any) => r.team === t).map((r: any) => r.char);
    modernHud(sc, s, t, k, tm, chars);
  });
}

// モダンのスロット（handoff_slot3）: 徳のゲージの下にリール・保留・モード（slot_modern_fx）。リールの絵柄は試合の編成（モダン: 奇数＝陣営のプレイヤー、偶数＝アシスト、7＝大将。クラシック: SLOT.syms）
// 演出（リーチ・全回転）は自陣だけ、演出の層（.mfxl）に出す。編成が変わったら作り直す
export function modernHud(sc: GameScene, s: any, t: number, k: number, tm: any, chars: string[]) {
  // 編成・HUD の文字は受信したスナップショットが変わった時だけ組み立てる（毎フレーム作り直さない）
  if (s !== sc.mfxSnap) { sc.mfxSnap = s; sc.mfxMyTeam = s.players.find((p: any) => p.id === s.me)?.team ?? -1; sc.mfxKeyNow = `${sc.mfxMyTeam}:${s.roster.map((r: any) => `${r.team}${r.char}`).join()}`; }
  const myTeam = sc.mfxMyTeam, key = sc.mfxKeyNow;
  if (key !== sc.mfxKey) {
    sc.mfxKey = key; sc.mfxMine = myTeam; sc.slotHtml = ['', '']; sc.mfxView = ['', '']; sc.mfxMask = ''; sc.mfxTm = [null, null];
    $('.mfxl').replaceChildren();
    sc.mfx = [0, 1].map((team) => {
      const el = $(`.tk .s${team}`), cs = s.roster.filter((r: any) => r.team === team).map((r: any) => r.char), ass = Object.keys(C.ASSIST.units);
      el.innerHTML = '<div class="tkg"></div><div class="mh"></div>';
      const syms = C.SLOT_MODE === 'modern' ? C.SLOT_MODERN.reel.syms.map((x) => (x === 'boss' ? BOSS_CHAR[team] : x.startsWith('assist:') ? ass[Number(x.slice(7))] : cs[Number(x.slice(7))] ?? cs[0]))
        : C.SLOT.syms.flatMap((x) => (x === 'boss' ? [BOSS_CHAR[team]] : x.startsWith('assist:') ? [ass[Number(x.slice(7))]] : cs[Number(x.slice(7))] ? [cs[Number(x.slice(7))]] : [])); // クラシック: プレイヤー＋アシスト＋7（大将）。いないプレイヤーの絵柄は外す（サーバーの slotSyms と同じ並び）
      const f = new ModernFx(el.querySelector<HTMLElement>('.mh')!, team === myTeam ? $('.mfxl') : document.createElement('div'), syms, cs, css16(TEAM_COLOR[team]));
      { const row = document.createElement('div'); row.className = 'mfx-row'; f.modeEl.replaceWith(row); row.append(f.modeEl, f.label); } // リーチ！・当選！はリールの横ではなく保留の丸の下（「大当たり N連」と同じ行）。文字を大きくして隣の組のリールに隠れたため（font1）
      f.idle(performance.now());
      return f;
    });
  }
  const f = sc.mfx[t]!, m = tm.m, now = performance.now(), fresh = tm !== sc.mfxTm[k]; // fresh: この陣営の値が新しいスナップショットで届いた
  sc.mfxTm[k] = tm;
  if (fresh) {
    const rf = tm.reflect ? `<span class="rf">反省中×${tm.reflect} +${(C.REFLECT_TOKU * tm.reflect * tm.reflect).toFixed(2)}/秒</span>` : '';
    const html = `<div class="tg" style="--c:${css16(TEAM_COLOR[t])}"><i></i></div><div class="tv"></div>`, g = $(`.tk .s${k} .tkg`); // 骨組みは陣営が変わった時だけ作り、ゲージは transform・文字は変わった時だけ書く
    if (html !== sc.slotHtml[k]) { sc.slotHtml[k] = html; g.innerHTML = html; }
    sc.setTf(g.querySelector('i')!, `scaleX(${Math.max(0, Math.min(1, tm.toku / C.TOKU_MAX))})`);
    const tv = g.querySelector<HTMLElement>('.tv')!, tvh = `徳 ${tm.toku.toFixed(1)}${rf}`;
    if ((tv as any)._h !== tvh) { (tv as any)._h = tvh; tv.innerHTML = tvh; }
  }
  if (sc.mfxIdleAt[t] && now >= sc.mfxIdleAt[t]) { sc.mfxIdleAt[t] = 0; f.idle(now); }
  f.run(s.phase === 'playing'); // リールは試合中だけ回す
  const v = fresh ? JSON.stringify([m.mode, m.backLeft, m.holds, m.cur, m.lv]) : sc.mfxView[k];
  if (v !== sc.mfxView[k]) {
    sc.mfxView[k] = v;
    const h = (x: number[]) => ({ color: x[0], saki: !!x[1], high: !!x[2] }) as any;
    f.holds(m.holds.map(h), m.cur && h(m.cur));
    if (m.kind === 'classic') setText(f.modeEl, m.chain ? `大当たり${m.chain > 1 ? ` ${m.chain}連` : ''}` : ''); // 同じ文字なら書かない（dom1） // 連チャンの回数（強さの段と同じ数）
    else f.mode(m.mode, m.backLeft, `パワーアップ${powerText(C.SLOT_MODERN, m.lv.power)}・アシスト${assistText(C.SLOT_MODERN, m.lv.assist)}`);
  }
  if (t === sc.mfxMine && m.kind !== 'classic') { // フィーバータイム中は右上に「攻め時」。矢印は敵陣の側（陣営0＝左なら →）
    const fe = $('.fever'), on = m.mode === 'ct' && s.phase === 'playing', txt = `${t === 0 ? '→' : '←'}攻め時！？`, disp = on ? 'block' : 'none';
    if (fe.style.display !== disp) fe.style.display = disp;
    if (fe.textContent !== txt) fe.textContent = txt;
  }
}

// キルログ: 倒した側 → 倒された側。1行ずつ KILL_LOG_SEC 秒で消え、KILL_LOG_MAX 件を超えたら古い順に消える
export function killLog(sc: GameScene, kc: string, kt: number, vc: string, vt: number) {
  const el = document.createElement('div');
  el.innerHTML = `${sc.icon(kc, kt)}<span>${charName(kc)}</span><span style="color:${css16(TEAM_COLOR[kt])}">▶</span>${sc.icon(vc, vt)}<span>${charName(vc)}</span>`; // アイコンの横にキャラ名
  const box = $('.kills');
  box.appendChild(el);
  setTimeout(() => el.remove(), C.KILL_LOG_SEC * 1000);
  while (box.children.length > C.KILL_LOG_MAX) box.firstElementChild!.remove();
}

// 画面中央の大きな表示。key が変わったときだけ作り直す（出るときのアニメーションのため）
export function banner(sc: GameScene, key: string, text = '', sub = '', color = '#fff') {
  const el = $('.banner');
  if (key === sc.bannerKey) return;
  sc.bannerKey = key;
  setCss(el, 'display', key ? 'block' : 'none');
  setCss(el, '--c', color); // 色が変わる時だけ書く（dom1）
  el.innerHTML = key ? `<b>${text}</b>${sub ? `<small>${sub}</small>` : ''}` : '';
}

export function notify(sc: GameScene, text: string) {
  const el = document.createElement('div');
  el.textContent = text;
  $('.notes').appendChild(el);
  setTimeout(() => el.remove(), C.NOTIFY_MS);
}

// ワールド座標に付く一時表示（ダメージ数値・+1・注意）
export function popup(sc: GameScene, text: string, x: number, y: number, cls: string) {
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.textContent = text;
  el.style.setProperty('--d', `${C.POPUP_MS}ms`);
  mapEl.appendChild(el);
  sc.pops.push({ el, x, y, until: performance.now() + C.POPUP_MS });
}

// KOした時のカットイン（プレイは止めない）。how: 倒した手段
export function cutin(sc: GameScene, me: string, foe: string, how: string) {
  fx.querySelector('.cut')?.remove(); // 同時KOは最後の1体だけ出す
  const el = document.createElement('div');
  el.className = 'cut';
  el.style.setProperty('--d', `${C.CUTIN_MS}ms`);
  el.innerHTML = `<img class="me" src="${TACHIE(me, 'ko')}"><img class="foe" src="${TACHIE(foe, 'select')}"><img class="foe gray" src="${TACHIE(foe, 'select')}"><div class="how"><b>撃破</b><span>${CHARS[foe].name}</span><span>${how}</span></div>`;
  fx.appendChild(el);
  setTimeout(() => el.remove(), C.CUTIN_MS);
}

// 開始カウント・GAME START・形勢・終了前の残り秒数とカウント・リザルト
export function staging(sc: GameScene, s: any, mine: any, myTeam: number, sinceSnap: number) {
  const now = performance.now();
  if (s.phase === 'playing' && (sc.prevPhase === 'countdown' || sc.prevPhase === 'intro')) sc.timed = { key: 'start', text: C.INTRO_MODE === 'old' ? 'GAME START' : '0', sub: '', color: '#ffe066', until: now + C.GAME_START_MS };
  if (s.phase === 'playing' && mine && s.timeLeft < sc.prevTimeLeft) {
    for (const a of C.SITUATION_AT) if (sc.prevTimeLeft > a && s.timeLeft <= a) {
      const d = s.teams[myTeam].bossHpRatio - s.teams[1 - myTeam].bossHpRatio;
      const [text, color] = d >= C.SITUATION_DIFF ? ['優勢', '#ffd040'] : d <= -C.SITUATION_DIFF ? ['劣勢', '#6aa8ff'] : ['接戦', '#fff'];
      sc.timed = { key: `sit${a}`, text, sub: `残り${a / 60}分`, color, until: now + C.SITUATION_MS };
    }
    for (const a of C.END_WARN_AT) if (sc.prevTimeLeft > a && s.timeLeft <= a) sc.timed = { key: `warn${a}`, text: `残り${a}秒`, sub: '', color: '#ff8060', until: now + C.SITUATION_MS };
  }
  sc.prevPhase = s.phase;
  sc.prevTimeLeft = s.timeLeft;
  const left = Math.max(0, s.timeLeft - (s.phase === 'playing' ? sinceSnap : 0));
  if (s.phase === 'ended') {
    const res = s.winner === 2 ? '引き分け' : !mine ? `${TEAM_NAME[s.winner]}の勝ち` : s.winner === myTeam ? '勝利' : '敗北';
    sc.banner('result', res, `${TEAM_NAME[0]} ${Math.round(s.teams[0].bossHpRatio * 100)}% − ${Math.round(s.teams[1].bossHpRatio * 100)}% ${TEAM_NAME[1]}`, res === '勝利' ? '#ffd040' : res === '敗北' ? '#6aa8ff' : '#fff');
  } else if (s.phase === 'countdown') {
    const n = Math.max(1, Math.ceil((s.phaseLeft - sinceSnap) * (C.INTRO_MODE === 'old' ? C.INTRO_SPEED : 1))); // 旧開幕は倍速でも 3・2・1、新開幕は実秒数
    sc.banner(`cnt${n}`, String(n), C.INTRO_MODE === 'old' ? '部屋から出られるのは GAME START の後' : '', '#fff');
  } else if (s.phase === 'intro' && sc.introBanner) {
    sc.banner(`intro_${sc.introBanner[0]}`, sc.introBanner[1], '', '#ffe066');
  } else if (s.phase === 'playing' && left > 0 && left <= C.END_COUNT) sc.banner(`end${Math.ceil(left)}`, String(Math.ceil(left)), '', '#ff8060');
  else if (sc.timed && now < sc.timed.until) sc.banner(sc.timed.key, sc.timed.text, sc.timed.sub, sc.timed.color);
  else sc.banner('');
}

export function practiceHud(sc: GameScene, s: any) {
  const on = !!s.practice && s.phase === 'playing', prw = $('.prw');
  setCss(prw, 'display', on ? 'block' : 'none');
  setCss($('.timer'), 'visibility', s.practice ? 'hidden' : '');
  if (!on) { if (prw.classList.contains('open')) prw.classList.remove('open'); return; }
  const P = s.practice, lv = (t: number) => (t < 0 ? 'なし' : C.POWER_TAGS[t]);
  setText($('.lv0'), lv(P.lv[0])); setText($('.lv1'), lv(P.lv[1]));
  if (P.mode !== sc.prMode) { sc.prMode = P.mode; (sc.prModes ??= [...$('.prp').querySelectorAll<HTMLElement>('[data-mode]')]).forEach((b) => b.classList.toggle('on', b.dataset.mode === P.mode)); } // 値が変わった時だけ書く
  const sel = $('.pfoe') as HTMLSelectElement;
  if (P.foe && document.activeElement !== sel && sel.value !== P.foe) sel.value = P.foe;
}
