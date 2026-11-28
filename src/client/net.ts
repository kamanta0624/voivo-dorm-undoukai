// 通信（refac3 で main.ts から切り出し。中身は変えていない）: 接続後の受信と、入力の送信・予測・計測のつなぎ。形は「関数(scene, …)」
import { CloseCode, type Room } from '@colyseus/sdk';
import { CONFIG as C } from '../shared/config';
import { BOSS_CHAR } from '../shared/chars';
import { ClientMeasure } from '../shared/netmeasure';
import { sendC2S, type Snapshot, SNAP_KEEP, SNAP_PKEEP } from '../shared/protocol';
import { type GameScene, MOVE_PHASES, HIT_FX_KIND, TEAM_NAME, PENALTY_LABEL, charName, commentary } from './main';

// 接続後: 再接続・切断の扱いと、サーバーからのメッセージの受け取り（refac3 で main.ts の create から切り出し。中身は変えていない）
export function connect(sc: GameScene) {
  // 入室はタイトル画面（title.ts）が済ませている（再読み込みしたタブは再接続、?e2e=<値> はテスト専用の部屋）
  const e2e = new URLSearchParams(location.search).get('e2e'), tokenKey = e2e ? 'rtE2e' : 'rt';
  const room: Room = (window as any).__room;
  {
    sc.room = room;
    (window as any).room = room; // 検証用
    sessionStorage.setItem(tokenKey, room.reconnectionToken);
    if ((window as any).__rejoin) sc.ctl.sendAim();
    // 通信の再接続（自動）。戻ったら照準モードを送り直す。再接続できなければ入り直す
    room.onReconnect(() => { sessionStorage.setItem(tokenKey, room.reconnectionToken); sc.ctl.sendAim(); });
    // 切れたら再読み込み（保存した合言葉で戻る）。キック・BAN（reason）と「タイトルへ」はタイトル画面へ
    room.onLeave((code: number, reason?: string) => {
      if (code !== CloseCode.CONSENTED) return location.reload();
      sessionStorage.removeItem(tokenKey);
      if (reason === 'kick' || reason === 'ban') sessionStorage.setItem('leaveMsg', reason === 'ban' ? '入室できません' : '部屋から外されました');
      if (reason === 'kick' || reason === 'ban' || sc.toTitle) location.reload();
    });
    addEventListener('pagehide', () => { sc.finishMeasure(); if (sc.snap?.phase === 'waiting') room.leave(); }); // 待機画面でタブを閉じたら待たせずに抜ける（試合中は再読み込みで戻れるよう再接続を待つ）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { sc.hiddenAt = performance.now(); return; }
      if (room.connection.isOpen && performance.now() - sc.hiddenAt >= C.RESUME_RECONNECT_SEC * 1000) room.connection.close(CloseCode.MAY_TRY_RECONNECT); // 止まっていた接続を張り直す
    });
    room.onMessage('netPong', (m: any) => {
      if (sc.measure && !sc.measureSent && m.id === sc.measureId && m.at === sc.pingPending) {
        sc.measure.rtt.add(performance.now() - m.at); sc.pingPending = null;
      }
    });
    room.onMessage('rp', (m: any) => sendC2S(room, 'rq', { n: m.n })); // サーバーの往復の遅延の計測: すぐ返す（sync1）
    room.onMessage('netFinish', (m: any) => { if (m.id === sc.measureId) sc.finishMeasure(); });
    room.onMessage('s', (s: Snapshot) => {
      // 差分（sync2）: 省かれた項目は前のスナップショット・キャラごとの前の値で埋める（以後は全部そろった形として扱う）
      if (!sc.snapFull) { if (!('roster' in s)) return; sc.snapFull = true; } // 全部そろったスナップショットが届くまでは使わない（snapFull を送った後に最初の全部が届く）
      for (const k of SNAP_KEEP) if (!(k in s)) (s as any)[k] = sc.snap?.[k];
      for (const p of s.players as any[]) { if ('char' in p) sc.pKeep.set(p.id, Object.fromEntries(SNAP_PKEEP.map((k) => [k, p[k]]))); else Object.assign(p, sc.pKeep.get(p.id)); }
      if (s.phase === 'playing' && s.netMeasure && s.netMeasure !== sc.measureId) {
        sc.measureId = s.netMeasure; sc.measure = new ClientMeasure(); sc.measureSent = false; sc.measureFrameAt = null;
        sc.pingAt = -Infinity; sc.pingPending = null;
      }
      if (s.phase !== 'playing' && sc.snap?.phase === 'playing') sc.finishMeasure();
      sc.snap = s;
      sc.snapAt = performance.now();
      if ((s.me && s.phase !== 'waiting' ? s.players.find((p: any) => p.id === s.me)?.char ?? sc.sideChar : null) !== sc.sideChar) sc.sideFit(); // 余白の立ち絵・色（自キャラが変わった時だけ）
      if (s.sortie != null || s.phase === 'intro') sc.warmup(s); // 出撃の秒数（常設の部屋）の間に、戦闘画面で使う画像を先に読み込む
      sc.sortieVoice(s); // 出撃セリフ（本人の端末だけ）
      sc.powerFx(s); // パワーアップ中の余白の演出
      if (s.cracks) sc.applyCracks(s.cracks); // 壁の段階（小破・中破）: 変わった分だけ届くので、フレームを待たず受け取った時に割れ目を重ねる（マップの絵は描き直さない）
      sc.interp.push(s.t, sc.snapAt, [...s.players, ...s.bosses.map((b: any) => ({ ...b, id: 'boss' + b.team })), ...s.couriers.map((c: any) => ({ ...c, id: 'c' + c.id })), ...s.shots.map((sh: any) => ({ x: sh.x, y: sh.y, id: 'shot:' + sh.id }))]); // 自キャラも移動不可の状態（突撃など）では補間で描く
      for (const sh of s.shots) sc.shotData.set(sh.id, { ...sh, seen: s.t }); // 弾の種類・向き（描く時刻の位置は interp から）
      for (const [id, d] of sc.shotData) if (d.seen < s.t - 2) sc.shotData.delete(id); // 2秒前から届いていない弾を片付ける（描く時刻はそれより新しい）
      if (sc.measure && !sc.measureSent && s.phase === 'playing') sc.measure.snapshot(sc.snapAt, sc.interp.offset!);
      const m = s.players.find((p: any) => p.id === s.me);
      if (m) {
        if (!m.alive || !MOVE_PHASES.includes(s.phase) || m.lock) sc.pred.reset(m.x, m.y);
        else sc.pred.reconcile(m.x, m.y, m.ack, m.spd, sc.obstacles(s, m));
      }
      if (s.phase === 'waiting' && sc.reactKoBy.size) sc.reactKoBy.clear(); // 立ち絵の反応の「同じ相手」は試合ごとに数える
      for (const f of s.fx ?? []) sc.fxQueue.push(HIT_FX_KIND(f, s.me) ? { ...f, at: s.t } : f); // 当たった時の演出（汗・他人の斬撃・爆発）は弾・他キャラと同じ時刻（NET_INTERP_DELAY 前）で出す
      (window as any).snap = s;
    });
    sendC2S(room, 'snapFull'); // 受け取りの準備ができたので全部送ってもらう（それまでに届いた差分は捨てられている。sync2）
    room.onMessage('notice', (m: any) => sc.notify(m.text));
    room.onMessage('cm', (u: any) => commentary.receive(u)); // 実況（全員に同じもの）
    room.onMessage('cmStop', () => commentary.clear()); // 決着の瞬間: 喋っている途中のセリフを打ち切る
    // 単発の出来事（撃破・キルログ・アシスト・大将に当てた）は、他キャラ・fx と同じ時刻（補間の時刻が at に来てから）で出す（sync1）。koed・recalled は自キャラ（予測で今を描く）の出来事なので届いた時に出す
    const atSnap = (m: any, f: () => void) => sc.evQueue.push({ at: m?.at, f });
    room.onMessage('kill', (k: any) => atSnap(k, () => sc.killLog(k.kc ?? BOSS_CHAR[k.kt], k.kt, k.vc, k.vt)));
    room.onMessage('assist', (m: any) => atSnap(m, () => sc.notify(`${TEAM_NAME[m.team]}のアシスト: ${charName(m.char)}（${C.ASSIST_TAGS[m.tier]}）`))); // 召喚の通知（両陣営）
    room.onMessage('slot', (m: any) => sc.slotWin(m.team, m.chain, m.kind, m.tier, m.char));
    room.onMessage('assistUp', (m: any) => atSnap(m, () => sc.notify(`${TEAM_NAME[m.team]}のアシスト強化: ${charName(m.char)}（${C.ASSIST_TAGS[m.tier]}）`))); // 両陣営
    room.onMessage('penalty', (m: any) => sc.notify(`${TEAM_NAME[m.team]}に罰: ${PENALTY_LABEL[m.kind]}`)); // 両陣営
    room.onMessage('mslot', (m: any) => sc.mslotEv(m));
    room.onMessage('mslotWin', (m: any) => sc.mslotWin(m));
    room.onMessage('mpenalty', (m: any) => sc.mslotToast(m.team, `ペナルティ（${m.n === 1 ? '転落' : '引き戻し失敗'}）\n全員にダメージ・攻撃ダウン・速度ダウン`, true));
    room.onMessage('ko', (k: any) => atSnap(k, () => {
      const mine = sc.snap?.players.find((p: any) => p.id === sc.snap.me);
      if (mine) sc.cutin(mine.char, k.victimChar, k.how);
      sc.react('kill');
    }));
    room.onMessage('koed', (k: any) => {
      sc.koedBy = { kc: k.kc, how: k.how };
      // 立ち絵の反応: 同じ相手に2回目以降→怒る、出会い頭（倒した相手が最初に当てた時に見えていなかった・交戦の始まりから REACT.surpriseSec 秒以内）→驚く、それ以外→悲しむ。差分のない出来事は飛ばして次へ
      const n = k.kid ? (sc.reactKoBy.get(k.kid) ?? 0) + 1 : 0;
      if (k.kid) sc.reactKoBy.set(k.kid, n);
      if (!(n >= 2 && sc.react('angry')) && !((k.unseen || (k.sec !== null && k.sec <= C.REACT.surpriseSec)) && sc.react('surprise'))) sc.react('sad');
    });
    room.onMessage('recalled', (m: any) => { if (m.r <= C.REACT.relief) sc.react('relief'); }); // 残りHPが少ない状態で帰還
    room.onMessage('bossHit', (m: any) => atSnap(m, () => { const t = performance.now(); if (t - sc.reactJoyAt >= C.REACT.joyEvery * 1000 && sc.react('joy')) sc.reactJoyAt = t; })); // 大将に当てた（REACT.joyEvery 秒に1回まで）
    room.onMessage('result', (r: any) => (sc.result = r)); // 試合結果画面のデータ（決着後に1回）
    sendC2S(room, 'resultReq'); // 結果画面の間に入室・再接続した時の分（受け取る準備ができてから）
  }
}

// 毎フレーム: 通信の計測の ping と、入力を NET_STEP ごとに番号を付けて送り、自キャラを予測で動かす（refac3 で main.ts の update から切り出し。中身は変えていない）。dx・dy は update の後の処理（歩きの絵・自由カメラ）でも使う
export function sendInputs(sc: GameScene, s: any, dtMs: number, now: number) {
  sc.interp.measure = s.phase === 'playing' && !sc.measureSent ? sc.measure : null;
  if (sc.interp.measure) {
    sc.interp.measure.beginFrame(sc.measureFrameAt === null ? null : now - sc.measureFrameAt);
    sc.measureFrameAt = now;
    if (now - sc.pingAt >= 1000 && (sc.pingPending === null || now - sc.pingPending > 10000)) {
      sc.pingAt = sc.pingPending = now;
      sendC2S(sc.room, 'netPing', { id: sc.measureId, at: now });
    }
  }
  const k = sc.keys;
  const { dx, dy } = sc.ctl.move({ up: k.W.isDown, down: k.S.isDown, left: k.A.isDown, right: k.D.isDown });
  if (dx || dy) sc.face = Math.atan2(dy, dx);
  // 入力は NET_STEP ごとに番号を付けて送り、同時に自キャラを予測で動かす
  const me0 = s.players.find((p: any) => p.id === s.me);
  sc.acc = Math.min(sc.acc + dtMs, 250);
  while (sc.acc >= C.NET_STEP * 1000) {
    sc.acc -= C.NET_STEP * 1000;
    const move = !!me0 && me0.alive && MOVE_PHASES.includes(s.phase) && !me0.stunned && !me0.lock; // 移動不可の状態（突撃など）は予測で動かさない
    sendC2S(sc.room, 'input', { ...sc.pred.step(dx, dy, me0?.spd ?? 0, sc.obstacles(s, me0), move), rt: sc.interp.renderTime(performance.now()) }); // rt: この画面の時刻（サーバーの近接AAの巻き戻し判定）
  }
  return { dx, dy };
}
