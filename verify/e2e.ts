// 通常の `npm run dev` に対し、実クライアントを実キー入力で操作して完成基準を確認する
// 実行: npx tsx verify/e2e.ts   （証拠: verify/evidence/）
// サーバーは `E2E_HOOKS=1 npm run dev` で起動する（大将の逃亡・反撃の確認に使うテスト用の仕掛けを有効にする）
import { CONFIG as C, wallRects, roomLayout } from '../src/shared/config';
import { CHARS as DEFS, visionRadius } from '../src/shared/chars';
import { lineOfSight } from '../src/shared/geom';
import MAP from '../src/shared/map.json';
import { OUT, launch, Tab, log, check, failures, sleep } from './lib';
import CHARS from '../src/shared/chars.json';


const hudCoord = (h: string) => h.match(/自キャラ座標: (\d+), (\d+)/)!.slice(1).map(Number);
const hudTime = (h: string) => Number(h.match(/残り (\d+)秒/)![1]);
const dist = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
// 区間ごとの所要時間
const T0 = Date.now();
let lap = T0;
const mark = (name: string) => { const n = Date.now(); log(`  [時間] ${name}: ${((n - lap) / 1000).toFixed(0)}秒（累計 ${((n - T0) / 1000).toFixed(0)}秒）`); lap = n; };
// 待機画面で出撃: キャラ（省略時は今選んでいるキャラ）にカーソルを乗せてクリック → OK? → 出撃
async function sortie(T: Tab, char?: string) {
  const s = await T.snap(), k = char ?? s.roster.find((r: any) => r.id === s.me).char;
  await T.page.click(`.card[data-k="${k}"]`); await T.page.click('#okbtn'); await T.page.click('#okbtn');
}
async function match1() {
  log('=== 試合1: タブA(人間) → 開始 → 途中でタブB参加。画面の表示だけを確認（ゲームの判定はサーバー単体テスト npm run test:server）');
  const b = await launch();
  const A = await Tab.open(b, 'A');
  const send = (T: Tab, type: string, m: any = {}) => T.page.evaluate(([t, x]) => (window as any).room.send(t, x), [type, m] as const);
  const alive = (T: Tab) => T.until((x) => x.players.find((p: any) => p.id === x.me)?.alive, 16000);
  const meOf = (x: any) => x.players.find((p: any) => p.id === x.me);

  // 待機画面 → 開始
  let s = await A.snap();
  log('待機画面の表示:', (await A.page.locator('#lobby').innerText()).replace(/\n/g, ' / '));
  await A.shot('1a_lobby');
  check('基準1 入室で待機画面', s.phase === 'waiting' && (await A.page.locator('#lobby').isVisible()));
  await send(A, 'e2eBossGuard', { on: true }); // Bot の攻撃で大将が減らない（確認の途中で決着しないように）
  await sortie(A, 'aru'); // 突撃の確認に使う（人間1人なので出撃で開始）
  await intro(A);
  s = await A.snap();
  await A.shot('1b_started');
  const mm: any = {};
  miniWatch(A, mm); // ミニマップの資材（HUD の確認で結果を見る）
  check('基準1 開始で待機画面が消える', s.phase === 'playing' && !(await A.page.locator('#lobby').isVisible()));
  mark('起動〜開始の演出');
  await sleep(C.GAME_START_MS); // GAME START の表示が消えてから
  await walkCheck(A);

  // 基準2 自キャラが動く・タイマー表示が減る（リコールと撤退中の視点の確認の間に進んだ分と比べる）
  const h0 = await A.hud();
  await A.hold('w', 1000);
  await sleep(150);
  const h1 = await A.hud();
  const [x0, y0] = hudCoord(h0), [x1, y1] = hudCoord(h1);
  check('基準2 Wを1秒押すと自キャラ座標が変わる', y1 < y0 - 100, { before: [x0, y0], after: [x1, y1] });
  await A.shot('2a_moved');
  const tm0 = hudTime(await A.hud()), w0 = Date.now();
  await recallCheck(A);
  await freeCamCheck(A);
  const tm1 = hudTime(await A.hud()), real = (Date.now() - w0) / 1000;
  check('基準2 タイマー表示が実時間どおり減る', Math.abs(tm0 - tm1 - real) <= 1.5, { before: tm0, after: tm1, real: real.toFixed(1) });
  mark('歩き・移動・リコール・撤退中の視点');

  // タブBが参加（ずんだもん軍のBotと入れ替わる。入れ替わりの判定はサーバー単体テスト）
  const B = await Tab.open(b, 'B');
  await B.page.waitForFunction(() => (window as any).hist.length > 0);
  await B.shot('5a_B_joined');
  mark('タブB参加');

  await slotCheck(A, B);
  await tokuCheck(A, B);
  mark('徳・スロット・指名手配');
  await courierCheck(A);
  await assistCheck(A, B);
  mark('コバコ・アシスト');
  await send(A, 'e2eSlotMiss', { on: true }); // ここからの技の検証中はスロットが当たらない（ウルト変身で技が出ないことによる揺らぎをなくす）
  await aruCheck(A);
  mark('アルの突撃');
  await hanamaruCheck(A);
  mark('花丸');
  await bossCheck(A);
  mark('大将の第2形態');

  // HUD: 味方・敵の撤退（復活までの秒数・暗いアイコン）とキルログ。ミニマップの資材（Aの隣に置いて見える状態にする）
  await alive(A);
  await send(A, 'e2eMaterial'); await sleep(1200);
  await alive(B);
  for (const T of [B, A]) for (let i = 0; i < 3 && meOf(await T.snap()).alive; i++) { await send(T, 'e2eKill'); await sleep(150); } // ウルト中は1回目で元のキャラに戻るだけ
  await hudCheck(A, mm);
  mark('HUD');

  // 形勢・終了前の表示・リザルト
  await ending(A);
  await A.shot('o7_end_A');
  await result(A);
  await hudSide(B);
  mark('終了前〜リザルト');
  await backAndRematch(A, B);
  for (const T of [A, B]) await T.page.evaluate(() => (window as any).room.leave()); // タブを閉じたのと同じ（ブラウザごと閉じると pagehide が出ず、再接続待ちで部屋が残る）
  await b.close();
}

const bannerText = (T: Tab) => T.page.evaluate(() => { const el = document.querySelector<HTMLElement>('#fx .banner')!; return el.style.display === 'none' ? '' : el.querySelector('b')?.textContent ?? ''; });
const inR = (p: any, r: any) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

// 開始の演出: INTRO_MODE で新旧を切り替え
const intro = (A: Tab) => (C.INTRO_MODE === 'old' ? introOld(A) : introNew(A));

// 新開幕: 入力ロックのまま、カメラがパンで 敵大将（↓やっつけろ！）→ 味方大将（↓まもれ！）→ 散らかった一角（徳を積め！）→ 味方全員（なかよくしろ！）→ 準備してね → 3,2,1,0
async function introNew(A: Tab) {
  // カメラの中心を毎フレーム記録（パンかカット切り替えかを見る）
  await A.page.evaluate(`(() => { const w = window, cam = w.game.scene.scenes[0].cameras.main; w.camLog = []; const f = () => { w.camLog.push([cam.midPoint.x, cam.midPoint.y]); if (w.snap.phase !== 'playing') requestAnimationFrame(f); }; requestAnimationFrame(f); })()`);
  const seen: { key: string; cam: number[]; zoom: number; view: any }[] = [], slots: string[] = [], zooms: number[] = [];
  await A.page.keyboard.down('d'); // 演出中は押していても動かない。カウント中は動ける（少し歩いて離す）
  let cntAt = 0; const digitAt: Record<string, number> = {};
  for (let i = 0; i < 400; i++) {
    const r = await A.page.evaluate(() => { const w = window as any, cam = w.game.scene.scenes[0].cameras.main, b = document.querySelector<HTMLElement>('#fx .banner')!;
      const lbl = [...document.querySelectorAll('#fx .lbl.introlbl')].map((e) => e.textContent)[0];
      return { key: lbl ?? (b.style.display === 'none' ? '' : b.querySelector('b')?.textContent ?? ''), cam: [cam.midPoint.x, cam.midPoint.y], zoom: cam.zoom, view: { x: cam.worldView.x, y: cam.worldView.y, width: cam.worldView.width, height: cam.worldView.height }, phase: w.snap.phase, sl: document.querySelector('#fx .tk .s0 .sl')?.innerHTML ?? '' }; });
    if (r.phase === 'countdown') { slots.push(r.sl); if (!cntAt) cntAt = Date.now(); else if (Date.now() - cntAt > 800) await A.page.keyboard.up('d'); }
    if (['3', '2', '1', '0'].includes(r.key) && !digitAt[r.key]) { digitAt[r.key] = Date.now(); if (r.key === '2') await A.shot('s3_countdown'); }
    zooms.push(r.zoom);
    if (r.key) { const last = seen[seen.length - 1]; if (last?.key === r.key) { Object.assign(last, r); if (!(last as any).shot && Date.now() - (last as any).at > C.INTRO2.panMs + 100) { (last as any).shot = true; await A.shot(`s1_intro_${seen.length}`); } } else seen.push({ ...r, at: Date.now() } as any); } // パンが終わってから撮る
    if (r.phase === 'playing' && seen.some((x) => x.key === '0')) break;
    await sleep(60);
  }
  await A.page.keyboard.up('d');
  const s = await A.snap(), me = s.players.find((p: any) => p.id === s.me);
  const keys = seen.map((x) => x.key);
  const want = ['↓やっつけろ！', '↓まもれ！', '徳を積め！', 'なかよくしろ！', '準備してね', '3', '2', '1', '0'];
  check(`新開幕: ${want.join(' → ')} の順に出る`, JSON.stringify(keys.filter((k) => want.includes(k))) === JSON.stringify(want), keys);
  const clampTo = (v: number, half: number, max: number) => Math.min(Math.max(v, half), max - half); // カメラはマップの外を映さない（端の部屋の大将は中心からずれる）
  const near = (x: any, p: any) => p && Math.hypot(x.cam[0] - clampTo(p.x, x.view.width / 2, C.MAP_W), x.cam[1] - clampTo(p.y - C.INTRO2.lift, x.view.height / 2, C.MAP_H)) < 40; // 大将は少し下寄りに映す
  const hi = (await A.hist()).find((x) => x.phase === 'intro'); // 試合開始後は敵大将が見えないので、開幕中の位置を使う
  const foe = hi.bosses.find((b: any) => b.team === 1), own = hi.bosses.find((b: any) => b.team === 0), allies = hi.players.filter((p: any) => p.team === 0 && !p.assist); // カウント中は Bot が動くので開幕中の位置
  const at = (k: string) => seen.find((x) => x.key === k)!;
  const fit = at('なかよくしろ！'), v = fit?.view;
  check('新開幕: カメラが敵大将・味方大将を映し、味方全員を収める', near(at('↓やっつけろ！'), foe) && near(at('↓まもれ！'), own) && !!v && allies.every((p: any) => (A as any) && p.x >= v.x && p.x <= v.x + v.width && p.y >= v.y && p.y <= v.y + v.height), { foe: at('↓やっつけろ！')?.cam, own: at('↓まもれ！')?.cam, v, allies: allies.map((p: any) => [Math.round(p.x), Math.round(p.y)]) });
  const log: number[][] = await A.page.evaluate(() => (window as any).camLog);
  const steps = log.slice(1).map((c, i) => Math.hypot(c[0] - log[i][0], c[1] - log[i][1])), far = Math.hypot(foe.x - own.x, foe.y - own.y);
  check(`新開幕: カメラはパンで動く（1フレームの移動は最大${Math.round(Math.max(...steps))}px、大将間${Math.round(far)}px）`, Math.max(...steps) < far * 0.35 && steps.filter((d) => d > 1).length > 20, { frames: log.length });
  const ih = (await A.hist()).filter((x) => x.phase === 'intro').map((x) => x.players.find((p: any) => p.id === x.me));
  const ch = (await A.hist()).filter((x) => x.phase === 'countdown').map((x) => x.players.find((p: any) => p.id === x.me));
  check('新開幕: 演出の間は入力ロック（キーを押しても動かない）', ih.length > 10 && ih.every((p: any) => p.x === ih[0].x && p.y === ih[0].y));
  check('新開幕: カウント中は入力ロックなし。開始部屋（食堂）の中を動ける', ch.length > 5 && ch[ch.length - 1].x > ih[0].x + 20 && ch.every((p: any) => inR(p, C.START_ROOMS[0])), { from: ih[0]?.x, to: ch[ch.length - 1]?.x });
  const gaps = ['2', '1', '0'].map((k, i) => (digitAt[k] - digitAt[['3', '2', '1'][i]]) / 1000);
  check('新開幕: 3,2,1 は1カウント1秒（実秒数）', gaps.every((g) => Math.abs(g - 1) < 0.3), gaps);
  check('新開幕: ズームなし（演出の間ずっと拡大率1）', zooms.length > 20 && zooms.every((z) => Math.abs(z - 1) < 1e-6), [Math.min(...zooms), Math.max(...zooms)]);
  await send(A, 'e2eTeleport', { x: ih[0].x, y: ih[0].y }); // カウント中に歩いた分を戻す（以降の確認は開幕の位置から）
  check('開始前（カウント中）のスロットは止まったまま表示', slots.length >= 2 && slots.every((x) => x && x === slots[0]), slots.length);
  await A.shot('s4_game_start');
  check('0 で試合タイマー開始、カメラは自キャラ追従（拡大は1）', s.phase === 'playing' && s.timeLeft > C.MATCH_TIME - 2 && Math.abs(await A.page.evaluate(() => (window as any).game.scene.scenes[0].cameras.main.zoom) - 1) < 0.05, { timeLeft: s.timeLeft, me: [me.x, me.y] });
}

// 旧開幕: 味方4人の横並び（万歳）→ 1人ずつカットイン（各2秒）→ カウント3（開始した部屋から出られない）→ GAME START
async function introOld(A: Tab) {
  const t0 = Date.now();
  await sleep(1000);
  await A.shot('s1_intro_lineup');
  let s = await A.snap();
  const allies = s.roster.filter((r: any) => r.team === 0).map((r: any) => r.char);
  // ゲーム画面上のスプライト: 味方4人が study の中に横一列、万歳。カメラは寄せている。中央の別表示のドットはない
  const v = await A.page.evaluate(() => { const sc = (window as any).game.scene.scenes[0], s = (window as any).snap; return { zoom: sc.cameras.main.zoom, extra: document.querySelectorAll('#fx .intro .line img').length, u: s.players.filter((p: any) => p.team === 0).map((p: any) => { const e = sc.units.get(p.id); return { tex: e?.s.texture.key, x: e?.s.x, y: e?.s.y }; }) }; });
  const row = v.u.every((u: any, i: number) => u.tex === `${allies[i]}_banzai` && inR(u, C.START_ROOMS[0]) && Math.abs(u.y - v.u[0].y) < 1 && (!i || Math.abs(u.x - v.u[i - 1].x - C.INTRO_GAP) <= 1));
  check('演出: 開始時の部屋（study）のゲーム画面上に味方4人が横並び・万歳、カメラが寄る（別表示のドットなし）', s.phase === 'intro' && v.u.length === 4 && row && Math.abs(v.zoom - C.INTRO_ZOOM) < 0.01 && v.extra === 0, v);
  // カットイン: 名前ロゴが味方の順に切り替わる（切り替わった時刻も記録）
  const seen: { name: string; t: number }[] = [];
  while ((await A.snap()).phase === 'intro') {
    const name = await A.page.evaluate(() => { const e = document.querySelector<HTMLElement>('#fx .intro .logo'); if (!e || e.dataset.seen) return null; e.dataset.seen = '1'; return e.textContent; }); // カットインごとに作り直される（同じキャラが続いても数える）
    if (name) { seen.push({ name, t: (Date.now() - t0) / 1000 }); await A.shot(`s2_intro_cutin${seen.length}`); }
    await sleep(100);
  }
  const names = allies.map((k: string) => (CHARS as any)[k].name);
  const gaps = seen.slice(1).map((x, i) => x.t - seen[i].t);
  check(`演出: 1人ずつ立ち絵と名前ロゴのカットイン（${C.INTRO_CUTIN}秒ずつ）`, JSON.stringify(seen.map((x) => x.name)) === JSON.stringify(names) && gaps.every((g) => Math.abs(g - C.INTRO_CUTIN) < 0.5)
    && (await A.page.locator('#fx .intro').evaluate((e) => (e as HTMLElement).style.display)) !== 'block', { seen, gaps, names });
  // カウント: 数字が出る。扉の方へ歩いても開始した部屋から出られない
  s = await A.snap();
  const zoomCnt = await A.page.evaluate(() => (window as any).game.scene.scenes[0].cameras.main.zoom);
  await A.shot('s3_countdown');
  const sl0 = await A.page.evaluate(() => document.querySelector('#fx .tk .s0 .sl')?.innerHTML); await sleep(200); const sl1 = await A.page.evaluate(() => document.querySelector('#fx .tk .s0 .sl')?.innerHTML);
  check('開始前（カウント中）のスロットは止まったまま表示', !!sl0 && sl0 === sl1);
  const cnt = await bannerText(A);
  await A.keys(1, 0); await sleep(Math.max(0, (s.phaseLeft - 0.4) * 1000)); await A.keys(0, 0);
  const inside = (await A.hist()).filter((x) => x.phase === 'countdown').every((x) => inR(x.players.find((p: any) => p.id === x.me), C.START_ROOMS[0]));
  check('カウント: 3・2・1 を表示し、開始した部屋から出られない', s.phase === 'countdown' && ['3', '2', '1'].includes(cnt) && inside, { cnt, inside, zoomCnt });
  check('カウント: カメラの拡大が通常（1）に戻る', await A.page.evaluate(() => (window as any).game.scene.scenes[0].cameras.main.zoom) === 1);
  const gs = await A.page.waitForFunction(() => { const el = document.querySelector<HTMLElement>('#fx .banner')!; return el.style.display !== 'none' && el.querySelector('b')?.textContent === 'GAME START'; }, null, { timeout: 3000 }).then(() => 'GAME START', () => '');
  await A.shot('s4_game_start');
  const tl = (await A.snap()).timeLeft;
  check('カウント0で GAME START を表示し、試合時間はここから数える', gs === 'GAME START' && tl > C.MATCH_TIME - 1, { banner: gs, timeLeft: tl });
}

// HUD: 味方4人（アイコン・名前・HP／撤退中は復活までの秒数）、敵4人（アイコン、撤退中は暗く）、キルログ、ミニマップの資材
// ミニマップの資材: 描いた黄色の点の数（直前のフレーム）と、味方の視界内の資材の数を比べる。試合中ずっと見張る
async function miniWatch(A: Tab, mm: any) {
  while (!mm.stop) {
    const r = await A.page.evaluate(() => {
      const w = window as any, s = w.snap, buf: number[] = w.game.scene.scenes[0].ui.commandBuffer;
      let mats = 0;
      for (let k = 0; k < buf.length - 1; k++) if (buf[k + 1] === 0xffd700 || buf[k + 1] === 0xff7ad9) mats++; // 通常（黄）と高ポイント（ピンク）
      return { mats, s: { me: s.me, phase: s.phase, players: s.players.map((p: any) => ({ id: p.id, team: p.team, alive: p.alive, x: p.x, y: p.y, char: p.char })), bosses: s.bosses, materials: s.materials, broken: s.broken } };
    });
    const s = r.s, me = s.players.find((p: any) => p.id === s.me);
    if (s.phase === 'playing' && me) {
      const eyes = [...s.players.filter((p: any) => p.team === me.team && p.alive), ...s.bosses.filter((b: any) => b.team === me.team)];
      const obs = wallsAt(s.broken);
      const vis = s.materials.filter((m: any) => eyes.some((e: any) => dist(e, m) <= visionRadius(e.char) && lineOfSight(e.x, e.y, m.x, m.y, obs))).length;
      if (r.mats === vis && vis > 0 && !mm.shown) { mm.shown = { drawn: r.mats, visible: vis, all: s.materials.length }; await A.shot('s5b_minimap_materials'); }
      if (r.mats === vis && s.materials.length > vis) mm.hidden = { drawn: r.mats, visible: vis, all: s.materials.length };
    }
    await sleep(500);
  }
}

async function hudCheck(A: Tab, mm: any) {
  let hud: any = null, reflect: string | null = null;
  for (let i = 0; i < 40; i++) {
    const r = await A.page.evaluate(() => {
      const w = window as any, s = w.snap, sc = w.game.scene.scenes[0];
      const allies = [...document.querySelectorAll('#fx .r0 .mem:not(.as)')].map((e) => ({ hp: !!e.querySelector('.hp'), rs: e.querySelector('.rs')?.textContent ?? null, dead: e.querySelector('.ic')!.classList.contains('dead') }));
      const foes = [...document.querySelectorAll('#fx .r1 .ic')].map((e) => e.classList.contains('dead'));
      const kills = document.querySelectorAll('#fx .kills > div').length;
      return { allies, foes, kills, snap: { roster: s.roster } };
    });
    const s = r.snap;
    const allyOk = r.allies.length === 4 && r.allies.every((a: any, k: number) => { const ro = s.roster.filter((x: any) => x.team === 0)[k]; return a.dead === !ro.alive && (ro.alive ? a.hp : /^\d+$/.test(a.rs ?? '')); });
    const foeOk = r.foes.length === 4 && r.foes.every((d: boolean, k: number) => d === !s.roster.filter((x: any) => x.team === 1)[k].alive);
    const deadAlly = r.allies.some((a: any) => a.rs), deadFoe = r.foes.some((d: boolean) => d);
    if (allyOk && foeOk && r.kills > 0 && !hud) { hud = { allies: r.allies, foes: r.foes, kills: r.kills }; await A.shot('s5_hud'); }
    if (deadAlly && !reflect) { reflect = await A.page.evaluate(() => document.querySelector('#fx .tk .s0 .rf')?.textContent ?? null); if (reflect) await A.shot('t6_reflect'); }
    if (allyOk && foeOk && r.kills > 0 && (deadAlly && deadFoe || i >= 30)) { hud = { allies: r.allies, foes: r.foes, kills: r.kills }; await A.shot('s5_hud'); break; }
    await sleep(500);
  }
  check('HUD: 味方4人（アイコン横並び・下部に体力、反省中はグレーに残り秒数）、敵4人（反省中はグレー）', !!hud, hud);
  check(`反省中: 徳のゲージの横に人数と徳の上昇（「${reflect}」）`, !!reflect && /^反省中×\d \+\d\.\d\d\/秒$/.test(reflect), reflect);
  check(`HUD: キルログ（${C.KILL_LOG_MAX}件まで）`, !!hud && hud.kills > 0 && hud.kills <= C.KILL_LOG_MAX, hud?.kills);
  mm.stop = true;
  check('HUD: ミニマップに味方の視界内の資材だけを表示（見えているものは描き、見えていないものは描かない）', !!mm.shown && !!mm.hidden, mm);
}

// 形勢（残り3分）・終了前の残り秒数（30秒）・終了カウント
async function ending(A: Tab) {
  const send = (sec: number) => A.page.evaluate((x) => (window as any).room.send('e2eTimeLeft', { sec: x }), sec);
  await send(C.SITUATION_AT[0] + 3); await sleep(300); // 形勢の最初の区切りの手前へ
  const tl = (await A.snap()).timeLeft, a = C.SITUATION_AT.find((x) => x < tl - 1)!; // まだ来ていない区切り
  await send(a + 0.5); await sleep(1300);
  const s = await A.snap(), d = s.teams[0].bossHpRatio - s.teams[1].bossHpRatio;
  const want = d >= C.SITUATION_DIFF ? '優勢' : d <= -C.SITUATION_DIFF ? '劣勢' : '接戦';
  const sit = await bannerText(A);
  await A.shot('s6_situation');
  check(`形勢: 残り${a / 60}分で両大将のHP割合の差から優勢／接戦／劣勢`, sit === want, { banner: sit, want, diff: d.toFixed(2) });
  await send(C.END_WARN_AT[0] + 0.5); await sleep(1300);
  const w = await bannerText(A);
  await A.shot('s7_end_warn');
  check(`終了前: 残り${C.END_WARN_AT[0]}秒の表示`, w === `残り${C.END_WARN_AT[0]}秒`, { banner: w });
  await send(C.END_COUNT + 0.6); await sleep(900);
  const c = await bannerText(A);
  await A.shot('s8_end_count');
  check('終了前: 3・2・1 のカウント', ['3', '2', '1'].includes(c), { banner: c });
}

// リザルト: 勝利／敗北／引き分けの表示（集合・部屋から出られないはサーバー単体テスト）
async function result(A: Tab) {
  await A.until((x) => x.phase === 'ended', 5000 + (C.FINALE.timeup + C.FINALE.win) * 1000); // 時間切れの決着演出（時間切れ → WIN）のあと
  await sleep(500);
  const s = await A.snap();
  const want = s.winner === 2 ? '引き分け' : s.winner === 0 ? '勝利' : '敗北';
  const res = await bannerText(A);
  await A.shot('s9_result');
  check('リザルト: 勝敗を表示', res === want, { banner: res, want });
  // 結果画面でも技（R）を使える。エフェクトは出るが壁は壊れない（部屋からは出られない）
  const b0 = s.broken.length;
  await A.page.keyboard.down('d'); await sleep(150); await A.press('r'); await sleep(100); await A.page.keyboard.up('d');
  const ch = await A.until((x) => !!x.players.find((p: any) => p.id === x.me)?.st.charge, 1500); await sleep(200); await A.shot('s9c_result_skill_windup');
  const da = await A.until((x) => !!x.players.find((p: any) => p.id === x.me)?.st.rush, 1500); await sleep(300); await A.shot('s9c_result_skill_dash');
  const s2 = await A.snap(), me2 = s2.players.find((p: any) => p.id === s2.me), room = roomLayout(s2.bossRooms).homes[0][s2.bosses.find((b: any) => b.team === 0).base];
  check('リザルト: 技を使える（エフェクトは出る）。壁は壊れず、部屋から出ない', ch && da && s2.broken.length === b0 && inR(me2, room), { ch, da, broken: [b0, s2.broken.length] });
}

const scene = (T: Tab, f: string) => T.page.evaluate(`(() => { const sc = window.game.scene.scenes[0], s = window.snap; return ${f}; })()`) as Promise<any>;
const meSprite = (T: Tab) => scene(T, '(() => { const e = sc.units.get(s.me); return { tex: e.s.texture.key, flip: e.s.flipX, x: e.s.x, y: e.s.y }; })()');

// 歩き: walk1 ⇔ walk2 の交互（1コマ WALK_FRAME_MS）。左へはPSDのまま、右へは左右反転。止まったら idle
async function walkCheck(A: Tab) {
  const anim = await scene(A, `(() => { const a = sc.anims.get(s.players.find((p) => p.id === s.me).char + '_walk'); return { frames: a.frames.map((f) => f.textureKey.replace(/^.*_/, '')), ms: a.msPerFrame }; })()`);
  const seen: Record<string, Set<string>> = { a: new Set(), d: new Set() }, flips: Record<string, boolean[]> = { a: [], d: [] };
  for (const key of ['a', 'd']) {
    await A.page.keyboard.down(key);
    for (let i = 0; i < 10; i++) {
      await sleep(70); const m = await meSprite(A); seen[key].add(m.tex.replace(/^.*_/, '')); flips[key].push(m.flip);
      if (i === 5) { const z = (await A.page.evaluate(() => (window as any).game.scale.zoom)) as number, r = await A.page.evaluate(() => (window as any).game.canvas.getBoundingClientRect().toJSON()), c = await scene(A, '[sc.units.get(s.me).s.x - sc.cameras.main.worldView.x, sc.units.get(s.me).s.y - sc.cameras.main.worldView.y]');
        await A.page.screenshot({ path: `${OUT}/w_walk_${key === 'a' ? 'left' : 'right'}.png`, clip: { x: r.x + c[0] * z - 100, y: r.y + c[1] * z - 140, width: 200, height: 180 } }); log(`  screenshot: ${OUT}/w_walk_${key === 'a' ? 'left' : 'right'}.png`); }
    }
    await A.page.keyboard.up(key);
  }
  await sleep(300);
  const idle = (await meSprite(A)).tex.replace(/^.*_/, '');
  check(`歩き: walk1 ⇔ walk2 の交互（1コマ${C.WALK_FRAME_MS}ms）、止まったら idle`, JSON.stringify(anim.frames) === '["walk1","walk2"]' && Math.abs(anim.ms - C.WALK_FRAME_MS) < 1 && ['a', 'd'].every((k) => seen[k].has('walk1') && seen[k].has('walk2')) && ['idle', 'half', 'close'].includes(idle), { anim, seen: { a: [...seen.a], d: [...seen.d] }, idle });
  check('歩き: 左へはPSDのまま、右へは左右反転', flips.a.every((f) => !f) && flips.d.every((f) => f), flips);
}

// リコール: Q を3秒押し続けると自陣の annexN へ。溜め中はゲージ（短押し・離す・被弾はサーバー単体テスト）
async function recallCheck(A: Tab) {
  let mid: any = null, me: any = null;
  for (let i = 0; i < 3; i++) { // 被弾すると溜めが0に戻る（仕様）ので、そのときはやり直す
    await A.until((x) => x.players.find((p: any) => p.id === x.me)?.alive, 16000);
    const hp0 = (await A.me()).hp;
    await A.page.keyboard.down('q'); await sleep(1500);
    mid = await A.me(); await A.shot('r1_recall_gauge');
    await sleep((C.RECALL_HOLD - 1.5) * 1000 + 400); await A.page.keyboard.up('q'); await sleep(200);
    me = await A.me();
    if (inR(me, C.RECALL_ROOMS[0]) || (mid.hp >= hp0 && me.hp >= hp0)) break;
    log('  リコール中に被弾（やり直し）', { hp0, mid: mid.hp, end: me.hp });
  }
  check(`リコール: Q を${C.RECALL_HOLD}秒押し続けると自陣の給湯室へワープ（溜め中はゲージ）`, mid.recall > 0.3 && mid.recall < 1 && inR(me, C.RECALL_ROOMS[0]) && me.recall === null, { mid: mid.recall, at: [Math.round(me.x), Math.round(me.y)] });
  await A.shot('r2_recalled');
}

// 撤退中の視点: WASD でカメラだけ動く（壁に関係なく）。復活したら自キャラに戻る
async function freeCamCheck(A: Tab) {
  const cam = () => scene(A, '({ x: sc.cameras.main.scrollX, y: sc.cameras.main.scrollY, w: sc.cameras.main.width, h: sc.cameras.main.height })');
  let c0: any, m0: any, c1: any, m1: any;
  // 撃破の演出中（揺れ・大爆発・絞り。RESPAWN_BASE 秒）はカメラが自キャラの位置のまま。絞り切った後の反省中は WASD で視点だけ動く
  // 反省時間が RESPAWN_BASE ちょうど（激昂0）だと演出の直後に復活するので、視点移動は反省時間が足りるときだけ確かめる
  let still: any = null, free: any = null;
  for (let tries = 0; tries < 3 && !still; tries++) { // Bot に先に倒されていた場合などはやり直す
    await aliveOf(A);
    await A.page.evaluate(() => (window as any).room.send('e2eKill'));
    await A.until((x) => !x.players.find((p: any) => p.id === x.me).alive, 2000); await sleep(200);
    c0 = await cam(); m0 = await A.me();
    if (m0.alive || m0.ko > 0.5) { log('  撤退中の視点: 撃破の直後を測れない（再試行）', { alive: m0.alive, ko: m0.ko }); continue; }
    await A.hold('d', 800); await A.hold('s', 600);
    c1 = await cam(); m1 = await A.me();
    still = { from: c0, to: c1, ko: m1.ko };
    if (!m1.alive && m1.respawnIn > 1.8) {
      await A.until((x) => { const p = x.players.find((q: any) => q.id === x.me); return p.alive || p.ko >= C.RESPAWN_BASE; }, 3000);
      const c2 = await cam(); await A.hold('d', 800); await A.hold('s', 600); const c3 = await cam(); free = { from: c2, to: c3 };
    }
  }
  await A.shot('d1_free_camera');
  check('撃破の演出中（RESPAWN_BASE 秒）は WASD を押してもカメラが自キャラの位置のまま', !!still && Math.hypot(c1.x - c0.x, c1.y - c0.y) < 40 && m1.x === m0.x && m1.y === m0.y, still);
  if (free) check('演出の後の反省中は WASD で視点だけ動く（壁に関係なく）', free.to.x - free.from.x > 150 && free.to.y - free.from.y > 100, free);
  else log('  演出の後の視点移動: 反省時間が RESPAWN_BASE ちょうどで、演出の直後に復活したので確かめていない');
  await A.until((x) => x.players.find((p: any) => p.id === x.me).alive, 16000); await sleep(1500);
  const c2 = await cam(), m2 = await A.me();
  await A.shot('d2_respawn_camera');
  const want = { x: Math.max(0, Math.min(C.MAP_W - c2.w, m2.x - c2.w / 2)), y: Math.max(0, Math.min(C.MAP_H - c2.h, m2.y - c2.h / 2)) }; // マップの端ではカメラが止まる
  check('復活したらカメラが自キャラに戻る', Math.abs(c2.x - want.x) < 60 && Math.abs(c2.y - want.y) < 60, { cam: c2, want, me: [Math.round(m2.x), Math.round(m2.y)] });
}

const send = (T: Tab, type: string, m: any = {}) => T.page.evaluate(([t, x]) => (window as any).room.send(t, x), [type, m] as const);
const waitText = (T: Tab, sel: string, re: string, ms: number) => T.page.waitForFunction(([q, r]) => [...document.querySelectorAll(q)].map((e) => e.textContent ?? '').find((t) => new RegExp(r).test(t)) ?? false, [sel, re] as const, { timeout: ms }).then((h) => h.jsonValue() as Promise<string>, () => null);
const HALL = { x: 1552, y: 952 }; // 中央の hall の中（広いので突撃・アシストの確認に使う）
const LIBRARY = { x: 40 * 16, y: 19 * 16 }; // 自陣の図書室（敵が来にくい。コバコの確認に使う）
const aliveOf = (T: Tab) => T.until((x) => x.players.find((p: any) => p.id === x.me)?.alive, 16000);

// 徳のゲージとスロット: 回転中 → 自陣は罰の出目（××でリーチ → ×××、両陣営に通知、効果の目印）、敵陣は当たり（両陣営にカットイン）
async function slotCheck(A: Tab, B: Tab) {
  await A.shot('t0_slot_spin');
  const reels = await A.page.evaluate(() => document.querySelectorAll('#fx .tk .s0 .sl .ic').length);
  const gauge = await A.page.evaluate(() => [...document.querySelectorAll('#fx .tk .tv')].map((e) => e.textContent));
  const reach = A.page.waitForFunction(() => !!document.querySelector('#fx .tk .s0 .sl.reach'), null, { timeout: (C.SLOT.spin + 2) * 1000 }).then(() => true, () => false);
  const cut = [A, B].map((T) => waitText(T, '#fx .scut', '大当たり！ずんだもん軍', (C.SLOT.spin + 3) * 1000)); // 自然に当たった別陣営のカットインと区別
  const pen = [A, B].map((T) => waitText(T, '#fx .notes div', 'あんこもん軍に罰', (C.SLOT.spin + 3) * 1000));
  await send(A, 'e2eSlot', { team: 0, pen: true, chain: 0 }); await send(A, 'e2eSlot', { team: 1, win: true });
  const r = await reach; await A.shot('t1_slot_reach');
  const [ca, cb] = await Promise.all(cut); await Promise.all([A.shot('t2_slot_win_A'), B.shot('t2_slot_win_B')]);
  const [pa, pb] = await Promise.all(pen); await sleep(300);
  const xs = await A.page.evaluate(() => document.querySelectorAll('#fx .tk .s0 .sl .ic.pen').length);
  await A.shot('t5_penalty');
  check('徳: 時計の下に陣営別のゲージ（左＝自陣、右＝敵陣）', gauge.length === 2 && gauge.every((t) => /^徳 \d+\.\d/.test(t ?? '')), gauge);
  check('スロット: 3リールが回り、2つそろうとリーチ演出、当たりは両陣営にカットイン（当てた陣営）', reels === 3 && r && !!ca?.includes('ずんだもん軍') && !!cb?.includes('ずんだもん軍'), { reels, reach: r, ca, cb });
  check('スロットの罰: ×××の出目、両陣営に通知（陣営と罰の内容）', xs === 3 && !!pa && !!pb, { xs, pa, pb });
}

// 頭上の徳の増減（資材を拾う）と、指名手配マーク（頭上と、敵のミニマップ）
async function tokuCheck(A: Tab, B: Tab) {
  await aliveOf(A);
  await send(A, 'e2eTeleport', HALL); await sleep(150); // 表側（中央）の資材: 通常
  await send(A, 'e2eMaterial');
  const pop = waitText(A, '#fx .pop.plus', `\\+${C.TOKU.material}`, 3000);
  await A.hold('d', 400);
  const txt = await pop; await A.shot('t3_toku_popup');
  check(`頭上に徳の増減だけ（「${txt}」）`, txt === `徳+${C.TOKU.material}`, txt);
  // 裏側（図書室）の資材: 高ポイント。地面の箱・ミニマップ・頭上の表示で区別できる
  await aliveOf(A); await send(A, 'e2eTeleport', LIBRARY); await sleep(150);
  await A.page.waitForFunction(() => !document.querySelector('#fx .notes div, #fx .scut'), null, { timeout: 8000 }).catch(() => {}); // スクショ用: 通知・カットインが消えるまで
  await send(A, 'e2eMaterial'); await sleep(400);
  const look = await scene(A, '({ ground: sc.g.commandBuffer.includes(0xff7ad9), mini: sc.ui.commandBuffer.includes(0xff7ad9), hi: s.materials.filter((m) => m.hi).length })');
  await A.shot('t3b_material_hi');
  const pop2 = waitText(A, '#fx .pop.plus.hi', `^徳\\+${C.TOKU.materialBack}`, 3000);
  await A.hold('d', 400);
  const txt2 = await pop2; await A.shot('t3c_toku_popup_hi');
  check(`裏側の資材は高ポイント: 地面はピンクの光る箱、ミニマップもピンク、頭上はピンク（「${txt2}」）`, look.ground && look.mini && look.hi >= 1 && !!txt2, { look, txt2 });
  await send(A, 'e2eBad', { v: C.WANTED_MIN + 2 });
  await A.until((x) => x.teams[0].wanted === x.me, 2000);
  const lbl = await waitText(A, '#fx .lbl.wanted', '手配', 2000);
  await sleep(300);
  const mini = await scene(B, '(() => { const b = sc.ui.commandBuffer; let n = 0; for (const v of b) if (v === 0xff3030) n++; return n; })()');
  await A.shot('t4_wanted'); await B.shot('t4_wanted_B_minimap');
  check('指名手配: 頭上に手配マーク、敵の視界外でも敵のミニマップに位置', !!lbl && mini >= 1, { lbl, mini });
  await send(A, 'e2eBad', { v: 0 });
}

// コバコ: 巡回している（位置が変わる）。攻撃すると1発でKOし、荷物を落とす
async function courierCheck(A: Tab) {
  await aliveOf(A);
  await send(A, 'e2eCourierGuard', { on: true }); // 測っている間に Bot がコバコを倒さないように
  await send(A, 'e2eTeleport', LIBRARY); await sleep(150);
  let c0: any = null, c1: any = null;
  for (let i = 0; i < 3 && !(c0 && c1 && c0.id === c1.id); i++) { // 測っている間に巻き込まれて倒れたら出し直す
    await send(A, 'e2eCourier', { dist: 120, box: 'assist' }); // ウルト箱だと拾ったとき変身して、あとの突撃の確認で技が使えない
    await A.until((x) => x.couriers.length > 0, 1000);
    c0 = (await A.snap()).couriers[0]; await sleep(500); c1 = (await A.snap()).couriers[0];
  }
  await A.shot('c1_courier_patrol');
  const aimTo = async (mode: string) => { for (let i = 0; i < 2 * C.AIM_MODES.length && (await A.me()).aim !== mode; i++) { await A.press('Tab'); await sleep(250); } }; // 1回ずつ、届くのを待って押す
  await aimTo('courier'); // 照準を「コバコ」へ（Tab で 一番近い敵 → HP → 大将優先 → コバコ。1回ずつ届くのを待つ）
  let ko = false;
  for (let i = 0; i < 6 && !ko; i++) {
    await aliveOf(A); if (i) { await send(A, 'e2eTeleport', LIBRARY); await sleep(100); } // Bot に倒されていたら復活を待って戻る
    await send(A, 'e2eCourier', { dist: 44, box: 'assist' }); await sleep(100);
    const c = (await A.snap()).couriers[0]; if (!c) continue;
    await A.face(c.x, c.y); await send(A, 'e2eNoAuto', { on: false }); // 照準「コバコ」の自動攻撃で倒す
    ko = await A.until((x) => !x.couriers.length, 1500); // 足元で倒すとすぐ荷物を拾うので、KOだけを見る（落とした荷物はスクショで確認）
    await send(A, 'e2eNoAuto', { on: true });
  }
  await A.shot('c2_courier_drop');
  await aimTo('nearest'); // 照準を「一番近い敵」に戻す
  await send(A, 'e2eCourierGuard', { on: false });
  const moved = c0 && c1 ? Math.round(Math.hypot(c1.x - c0.x, c1.y - c0.y)) : 0;
  check('コバコ: 寮の中を巡回し、頭上に荷物のアイコン。攻撃すると1発でKOして荷物を落とす', moved > 20 && ko, { moved, ko });
}

// アシスト: 大将と同じ大きさ、召喚の通知、2回目の召喚は強化（通知・頭上の強さ）。両陣営のアシストは互いを最優先（予告 → 発動）
async function assistCheck(A: Tab, B: Tab) {
  await aliveOf(A); await aliveOf(B);
  await send(A, 'e2eTeleport', HALL); await send(B, 'e2eTeleport', { x: HALL.x + 220, y: HALL.y + 200 });
  await sleep(200);
  const had = (await A.snap()).players.find((p: any) => p.assist && p.team === 0); // コバコの確認で拾ったアシスト箱で、もう出ていることがある
  const note = had ? Promise.resolve('（既に出ていた）') : waitText(A, '#fx .notes div', 'あんこもん軍のアシスト: ', 3000);
  await send(A, 'e2eAssist', { char: 'kurono', tier: 1, dx: -40, dy: 0 });
  const tier1 = had ? Math.min(3, had.tier + 1) : 1;
  await A.until((x) => x.players.some((p: any) => p.assist && p.team === 0), 2000); await sleep(150);
  const up = waitText(A, '#fx .notes div', 'レベルアップ', 3000);
  await send(A, 'e2eAssist', { char: 'kurono', tier: 1, dx: -40, dy: 0 }); // 2回目は強化
  const [n, u] = await Promise.all([note, up]); await sleep(200);
  const lbl = await A.page.evaluate(() => [...document.querySelectorAll('#fx .lbl')].map((e) => e.textContent).filter((t) => t?.startsWith('ASSIST')));
  await A.shot('a0_assist_up');
  const s0 = await A.snap(), mine = s0.players.filter((p: any) => p.assist && p.team === 0);
  const v = await scene(A, `(() => s.players.filter((p) => p.assist).map((p) => ({ char: p.char, scale: sc.units.get(p.id)?.s.scale })))()`);
  check(`アシスト: 大将と同じ大きさ（×${C.ASSIST.scale}）、召喚の通知（${n}）、同時1体で2回目は強化（${u}、頭上 ${lbl}）`, mine.length === 1 && mine[0].tier >= Math.min(3, tier1 + 1) && v.every((x: any) => x.scale === C.DOT_SCALE * C.ASSIST.scale) && !!n && !!u && lbl.includes(`ASSIST ${C.POWER_TIERS[mine[0].tier]}`), { mine: mine.map((p: any) => p.tier), v, lbl });
  // 相手陣営（B）のアシストを近くに出す → 互いに向かって交戦。技はすぐ使える
  await send(B, 'e2eAssist', { char: 'aoyama', tier: 2, dx: -260, dy: -200, ready: true });
  await A.until((x) => x.players.filter((p: any) => p.assist).length >= 2, 2000);
  await sleep(500); await A.shot('a1_assist_vs_warn');
  await sleep(900); await A.shot('a2_assist_vs_fire');
  const h = await A.hist(), ids = (await A.snap()).players.filter((p: any) => p.assist).map((p: any) => p.id);
  const dmg = (id: string) => h.some((x, k) => k > 0 && (x.players.find((p: any) => p.id === id)?.hp ?? 1e9) < (h[k - 1].players.find((p: any) => p.id === id)?.hp ?? 0));
  const warned = h.some((x: any) => (x.warns ?? []).length > 0) || (await A.snap()).warns.length > 0;
  const as = (await A.snap()).players.filter((p: any) => p.assist), foeOf = (id: string) => as.find((p: any) => p.id !== id);
  check('アシスト同士: 両陣営のアシストが互いを最優先で交戦（予告 → 発動、両方が被弾。白上は大将しか攻撃しない）', ids.length >= 2 && ids.every((id: string) => dmg(id) || foeOf(id)?.char === 'shirakami'), { ids, warned, chars: as.map((p: any) => p.char) });
}

// 花丸: 巨大拳（半透明の拳が直進し、壁を壊して貫通）とパッシブ（壁へ押し込み続けると壊す）
// 花丸のパッシブを確かめる場所: 立つマス (x,y) と上下が床、西隣の縦3マスが壊れていない壁（外周以外）、東隣も床。自陣側（マップの左半分）で図書室に一番近いもの
function pushSpot(broken: number[][]) {
  const tile = (x: number, y: number) => (broken.some(([bx, by]) => bx === x && by === y) ? '.' : MAP.tiles[y]?.[x] ?? ' ');
  const perimeter = (x: number, y: number) => [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (MAP.tiles[y + dy]?.[x + dx] ?? ' ') === ' '));
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let y = 1; y < MAP.height - 1; y++) for (let x = 2; x < MAP.width / 2; x++) {
    const ok = [-1, 0, 1].every((d) => tile(x, y + d) === '.' && tile(x - 1, y + d) === '#' && !perimeter(x - 1, y + d)) && tile(x + 1, y) === '.';
    const d = Math.hypot(x * 16 - LIBRARY.x, y * 16 - LIBRARY.y);
    if (ok && d < bd) { best = { x, y }; bd = d; }
  }
  return best!;
}

async function hanamaruCheck(A: Tab) {
  await aliveOf(A);
  const kitchen = { x: C.RECALL_ROOMS[0].x + C.RECALL_ROOMS[0].w / 2, y: C.RECALL_ROOMS[0].y + C.RECALL_ROOMS[0].h - 20 }; // 給湯室（まだ壁が壊れていない）から上へ撃つ
  await send(A, 'e2eClearUlt'); // 前の確認で荷物を拾って変身していると技が封印される。変身を解き、落ちている箱も片付ける
  await send(A, 'e2eChar', { char: 'hanamaru' }); await send(A, 'e2eTeleport', kitchen); await send(A, 'e2eReady'); await sleep(200);
  const b0 = (await A.snap()).broken.length;
  await A.page.keyboard.down('w'); await sleep(120); await A.page.keyboard.up('w'); await A.press('r');
  const flying = await A.until((x) => x.ents.some((e: any) => e.kind === 'fist'), 1500); await sleep(250);
  const drawn = await A.page.evaluate(() => (window as any).snap.ents.filter((e: any) => e.kind === 'fist').length); await A.shot('h1_fist');
  await A.until((x) => !x.ents.some((e: any) => e.kind === 'fist'), 3000); await sleep(200);
  const b1 = (await A.snap()).broken.length; await A.shot('h2_fist_after');
  check('花丸の巨大拳: 拳が前方へ飛び、壁を壊して貫通する（マップに反映）', flying && drawn > 0 && b1 > b0, { drawn, broken: [b0, b1] });
  // パッシブ: 自陣側で、今も壊れていない壁（外周以外、縦3マス）へ西向きに押し込む。前の確認や Bot が壊した壁は避ける（図書室に一番近い場所）
  const spot = pushSpot((await A.snap()).broken);
  await aliveOf(A); await send(A, 'e2eTeleport', { x: spot.x * 16 + 11, y: spot.y * 16 + 8 }); await sleep(150);
  const p0 = (await A.snap()).broken.length;
  await A.page.keyboard.down('a'); await sleep(DEFS.hanamaru.skill.push * 1000 + 500); await A.page.keyboard.up('a');
  await sleep(150); const p1 = (await A.snap()).broken.length; await A.shot('h3_push');
  check(`花丸のパッシブ: 壁へ押し込むと壊す（${DEFS.hanamaru.skill.push}秒。触れてすぐ壊れないことはサーバー単体で確認）`, p1 > p0, { p0, p1 });
  await send(A, 'e2eChar', { char: 'aru' }); // 結果画面の確認はアルで行う
}

// 大将: 拠点移動の予告（範囲表示）→ 広範囲攻撃 → 移動。移動後（第2形態）は範囲内の敵に1体ずつ弾を撃ち、着弾地点で爆発
async function bossCheck(A: Tab) {
  const BL = C.BOSS_BLAST, SH = C.BOSS_SHOT;
  await aliveOf(A);
  await A.page.evaluate(([br, sr]) => {
    const w = window as any; w.bossLog = [];
    w.room.onMessage('s', (s: any) => w.bossLog.push({ warn: s.warns.some((x: any) => x.boss), blast: s.fx.some((f: any) => f.kind === 'aura' && f.color === 'dash' && f.r === br), boom: s.fx.some((f: any) => f.kind === 'aura' && f.color === 'dash' && f.r === sr), shots: s.shots.filter((x: any) => x.team === 1).length }));
  }, [BL.r, SH.boom]);
  const log = () => A.page.evaluate(() => (window as any).bossLog as any[]);
  // from 番目以降の記録に key が出るまで待つ（描画フレームごとに確認し、出たらすぐ撮れるように）
  const waitLog = (key: string, ms: number, from = 0) => A.page.waitForFunction(([k, f]) => (window as any).bossLog.slice(f).some((e: any) => e[k]), [key, from] as const, { polling: 'raf', timeout: ms }).then(() => true, () => false);
  const foeBoss = async () => (await A.snap()).bosses.find((b: any) => b.team === 1);
  // 敵大将の隣へ → 拠点移動を起こす
  await send(A, 'e2eWarp'); await sleep(200);
  const b0 = await foeBoss();
  await send(A, 'e2eChar', { char: (await A.me()).char }); await send(A, 'e2eBossMove'); await sleep(150); // HPを戻し、大将の隣（必ず見える位置）で反撃と広範囲攻撃を受ける
  const warned = await waitLog('warn', 1000); await sleep(BL.warn * 500); await A.shot('b1_boss_warn');
  const blasted = await waitLog('blast', BL.warn * 1000 + 1000); await A.shot('b2_boss_blast');
  await send(A, 'e2eReveal', { on: true }); await sleep(150); const b1 = await foeBoss(); await send(A, 'e2eReveal', { on: false });
  check(`大将の拠点移動: 予告（半径${BL.r}）→ 広範囲攻撃 → 別の拠点へ移動`, warned && blasted && !!b1 && (b1.x !== b0.x || b1.y !== b0.y), { warned, blasted, from: [b0.x, b0.y], to: b1 && [b1.x, b1.y] });
  // 第2形態: 移動先の大将の射程内（反撃の届かない距離）で弾と爆発を待つ
  // 倒されないよう e2eChar でHPを戻し、反撃の届かない距離で上下左右を試す（壁の陰だと撃たれない）
  let shotSeen = false, boomed = false; const t0 = (await log()).length;
  for (const [ox, oy] of [[-180, 0], [180, 0], [0, -180], [0, 180]]) {
    await aliveOf(A); await send(A, 'e2eChar', { char: (await A.me()).char }); await send(A, 'e2eTeleport', { x: b1.x + ox, y: b1.y + oy }); await sleep(100);
    shotSeen = await A.until((x) => x.shots.some((sh: any) => sh.team === 1 && Math.hypot(sh.x - b1.x, sh.y - b1.y) < SH.range), 4000);
    if (!shotSeen) continue;
    await A.shot('b3_boss_shots');
    boomed = await waitLog('boom', 3000, (await log()).length); await A.shot('b4_boss_boom');
    if (boomed) break;
  }
  check('大将の第2形態: 範囲内の敵に弾を撃ち、着弾地点で爆発（画面に表示）', shotSeen && boomed && (await log()).slice(t0).some((e) => e.shots > 0), { shotSeen, boomed });
}

// アルの突撃: 四方向。タメ中は進路の警告と白い点滅、突撃中は渦と煙。壁を壊して抜けたあとのマップ
async function aruCheck(A: Tab) {
  await send(A, 'e2eClearAssists'); // アシストの確認で出したアシストが hall に残り、突撃中の自キャラを倒すので片付ける
  const want: Record<string, number> = { d: 0, a: Math.PI, w: -Math.PI / 2, s: Math.PI / 2 };
  const b0 = (await A.snap()).broken.length, got: any[] = [];
  for (const key of ['d', 'a', 'w', 's']) for (let tries = 0; tries < 2; tries++) {
    await aliveOf(A); await A.until((x) => !x.players.find((p: any) => p.id === x.me)?.ult, (C.ULT_DURATION + 1) * 1000); // 自然に当たったスロットのウルト中は技が出ない
    await send(A, 'e2eTeleport', HALL); await send(A, 'e2eReady'); await sleep(150);
    await A.page.keyboard.down(key); await sleep(150); await A.press('r'); await sleep(100); await A.page.keyboard.up(key);
    await sleep(300);
    const c = (await A.me()).st.charge; await A.shot(`r1_windup_${key}`);
    await A.until((x) => !!x.players.find((p: any) => p.id === x.me)?.st.rush, 1500); await sleep(300);
    const d = (await A.me()).st.rush; await A.shot(`r2_dash_${key}`);
    await A.until((x) => !x.players.find((p: any) => p.id === x.me)?.st.rush, 2500);
    if (c && d || tries === 1) { got.push({ key, charge: c && +c.a.toFixed(2), dash: d && +d.a.toFixed(2) }); break; }
    const m = await A.me(); log('  突撃が出なかった（再試行）', key, { alive: m.alive, mochi: m.st.mochi, ult: m.ult, skillCd: m.skillCd });
  }
  await A.shot('r3_after_wall');
  const b1 = (await A.snap()).broken.length;
  check('アルの突撃: 四方向とも移動入力の方向にタメ（警告）→ 突撃（渦と煙）', got.every((g) => g.charge !== null && g.dash !== null && Math.abs(Math.atan2(Math.sin(g.dash - want[g.key]), Math.cos(g.dash - want[g.key]))) < 0.01), got);
  check(`アルの突撃: 壁を壊して抜ける（壊れた壁 ${b0} → ${b1} マス、マップに反映）`, b1 > b0, { b0, b1 });
}

// HUD: ずんだもん軍のプレイヤーでも左＝陣営0、右＝陣営1（大将HPバー・一覧）。一覧の自軍側は右
async function hudSide(B: Tab) {
  const r = await scene(B, `(() => { const q = (c) => document.querySelector(c); return { l: q('#fx .b0 i').style.background, lw: q('#fx .b0 i').style.width, rw: q('#fx .b1 i').style.width, ally: q('#fx .r1 .mem .ic').style.getPropertyValue('--c'), foe: q('#fx .r0 .ic').style.getPropertyValue('--c'), teams: s.teams.map((t) => t.bossHpRatio) }; })()`);
  await B.shot('h1_hud_zundamon_side');
  check('HUD: ずんだもん軍のプレイヤーでも左＝陣営0（大将HPバー・一覧）、右＝陣営1（自軍の一覧は右）', /255, 140, 40|#ff8c28/.test(r.l) && Math.abs(parseFloat(r.lw) - r.teams[0] * 100) < 0.5 && Math.abs(parseFloat(r.rw) - r.teams[1] * 100) < 0.5 && r.ally === '#3cc850' && r.foe === '#ff8c28', r);
}

// リザルトの「戻る」: 押した人数／全人数。人間全員が押したら待機画面へ。同じ部屋で次の試合を始められる
async function backAndRematch(A: Tab, B: Tab) {
  const txt = (T: Tab) => T.page.locator('#fx .back').textContent();
  const t0 = await txt(A);
  await A.page.click('#fx .back'); await sleep(500);
  const t1 = await txt(A), still = (await A.snap()).phase;
  await A.shot('b1_back_pressed');
  await B.page.click('#fx .back');
  const back = await A.until((x) => x.phase === 'waiting', 3000) && await B.until((x) => x.phase === 'waiting', 3000);
  await sleep(300); await A.shot('b2_back_lobby');
  check('リザルト: 「戻る」で押した人数／全人数（Botは押した扱い）。人間全員が押したら全員が待機画面へ', t0 === '戻る（6/8）' && t1 === '待機中 7/8' && still === 'ended' && back && await A.page.locator('#lobby').isVisible() && await B.page.locator('#lobby').isVisible(), { t0, t1, still });
  await sortie(A); await sortie(B); // 人間2人: 全員が出撃したら開始
  await A.until((x) => x.phase === 'intro', 3000);
  await A.page.evaluate(() => (window as any).room.send('e2eSkipIntro'));
  const ok = await A.until((x) => x.phase === 'playing', 3000); await sleep(1500);
  const s = await A.snap();
  await A.shot('b3_rematch');
  check('待機画面から同じ部屋で次の試合を始められる', ok && s.roster.length === 8 && s.roster.filter((r: any) => !r.bot).length === 2 && s.broken.length < 20 && s.timeLeft < C.MATCH_TIME && s.timeLeft > C.MATCH_TIME - 5 && s.teams.every((t: any) => Math.abs(t.toku - C.TOKU_INIT) < 2), { roster: s.roster.length, humans: s.roster.filter((r: any) => !r.bot).length, broken: s.broken.length, timeLeft: s.timeLeft, toku: s.teams.map((t: any) => t.toku) });
}

// その時点で壊れていた壁を反映した壁の一覧（ミニマップの資材の確認で使う）
const wallCache = new Map<number, any[]>();
function wallsAt(broken: number[][]) {
  if (!wallCache.has(broken.length)) {
    const t = [...(MAP.tiles as string[])];
    for (const [x, y] of broken) t[y] = t[y].slice(0, x) + '.' + t[y].slice(x + 1);
    wallCache.set(broken.length, wallRects(t));
  }
  return wallCache.get(broken.length)!;
}

// 基準4: 通信遅延ありで、他キャラの描画が1体につき1つだけ、位置が滑らかに動く（毎フレームのスプライトを記録）
async function verifySmooth(A: Tab) {
  const rec: any = await A.page.evaluate(`new Promise((res) => {
    const sc = window.game.scene.scenes[0], out = [], snaps = [];
    window.room.onMessage('s', (m) => snaps.push({ r: performance.now(), t: m.t, p: m.players.map((q) => [q.id, q.x, q.y]) }));
    function f() {
      const auras = new Set([...sc.units.values()].map((e) => e.aura)); // パワーアップ中の背後のドット（ユニット本体ではない）
      const sprites = sc.children.list.filter((o) => o.type === 'Sprite' && !auras.has(o)); // ずんだ餅の間は絵を隠すので、隠したものも数える
      const dying = new Set(window.snap.players.filter((p) => !p.alive).map((p) => p.id)); // 撃破の演出中（左右に揺れる）
      out.push({ t: performance.now(), T: sc.interp.renderTime(performance.now()), n: sprites.length, uniq: new Set([...sc.units.values()].map((e) => e.s)).size, units: sc.units.size, u: [...sc.units].filter(([id]) => !dying.has(id)).map(([id, e]) => [id, e.s.x, e.s.y]) });
      if (out.length < 480) requestAnimationFrame(f); else res({ out, snaps });
    }
    requestAnimationFrame(f);
  })`);
  const { out, snaps } = rec;
  let j = 0, ahead = 0;
  for (const f of out) { while (j < snaps.length && snaps[j].r <= f.t) j++; if (snaps[j - 1] && f.T > snaps[j - 1].t) ahead++; } // 届いていない時刻を描いた（推測した）フレーム
  const one = out.every((f: any) => f.n === f.units && f.uniq === f.units);
  const by: Record<string, any[]> = {};
  out.forEach((f: any, i: number) => f.u.forEach(([id, x, y]: any) => (by[id] ??= []).push({ i, x, y, dt: i ? f.t - out[i - 1].t : 1000 / 60 }))); // dt: フレーム間隔(ms)
  const rows: any[] = [];
  let bad = 0;
  for (const [id, a] of Object.entries(by)) {
    if (id === (await A.snap()).me) continue;
    let back = 0, maxStep = 0, pd: number[] | null = null;
    for (let k = 1; k < a.length; k++) {
      if (a[k].i !== a[k - 1].i + 1) { pd = null; continue; }
      const d = [a[k].x - a[k - 1].x, a[k].y - a[k - 1].y], m = Math.hypot(d[0], d[1]);
      if (m < C.NET_SNAP) maxStep = Math.max(maxStep, m / Math.max(1, a[k].dt / (1000 / 60))); // NET_SNAP 以上は復活などの正当な移動。フレームが止まった分は割り引く（60fps の1フレームあたりに直す）
      if (m >= 3 && pd && d[0] * pd[0] + d[1] * pd[1] < 0) back++; // 3px 以上の後戻り
      if (m > 0) pd = d;
    }
    // サーバーの位置そのものの方向転換の回数（Botが本当に向きを変えた分は後戻りに数えてよい）
    let turn = 0, p: any = null, q: number[] | null = null, fast = 0; // fast: サーバーでの1tickの移動の最大（はじき・突撃など技の速い移動。NET_SNAP 未満）
    for (const sn of snaps) { const e = sn.p.find((x: any) => x[0] === id); if (!e) { p = null; continue; } if (p) { const d = [e[1] - p[1], e[2] - p[2]], m = Math.hypot(d[0], d[1]); if (m < C.NET_SNAP) fast = Math.max(fast, m); if (q && d[0] * q[0] + d[1] * q[1] < 0 && m >= 3) turn++; if (d[0] || d[1]) q = d; } p = e; }
    if (back > turn + 2 || maxStep > Math.max(20, fast * 0.6)) bad++; // 歩きは1フレーム（60fps 換算）20px以下。技で速く動いた分はその速さまで
    rows.push({ id, frames: a.length, maxStep: +maxStep.toFixed(1), fast: +fast.toFixed(1), back, turn });
  }
  log('  他キャラの描画（遅延100ms±50ms、480フレーム）', rows);
  check('基準4 遅延100ms±50msで、他キャラの描画が1体につき1つだけ', one, { frames: out.length });
  check('基準4 遅延100ms±50msで、他キャラの位置が滑らか（推測描画なし・後戻りはサーバーの方向転換の分だけ・1フレーム20px以下、技の速い移動はその速さまで）', ahead <= out.length * 0.05 && bad === 0, { aheadFrames: ahead });
}

async function match2() {
  log('=== 試合2: 通信遅延ありのタブ1つで開始し、他キャラの描画を見る（Botだけの試合の決着はサーバー単体テスト）');
  const b = await launch();
  const A = await Tab.open(b, 'A2', [100, 50]); // 通信遅延 100ms・揺らぎ 50ms
  await sortie(A);
  await A.until((x) => x.phase === 'intro', 3000);
  await A.page.evaluate(() => (window as any).room.send('e2eSkipIntro')); // 開始の演出は試合1で確認済み
  await A.until((x) => x.phase === 'playing', 3000);
  await A.shot('m2a_start');
  await verifySmooth(A);
  await A.page.evaluate(() => (window as any).room.leave()); // 次の実行が残った部屋に入らないように
  await b.close();
}

const which = process.argv[2];
if (!which || which === '1') await match1();
mark('試合1 合計');
if (!which || which === '2') await match2();
mark('試合2 合計');
log(`  [時間] 全体 ${((Date.now() - T0) / 1000).toFixed(0)}秒`);
log(failures() ? `FAILED ${failures()}` : 'ALL PASS');
process.exit(failures() ? 1 : 0);
