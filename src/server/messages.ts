// クライアントからのメッセージの処理（sec1 で GameRoom.ts から切り出し。中身は変えていない）。形は skills と同じ「関数(room, client, m)」
// GameRoom.messages は bindMessages で作る: 受信の検証（shared/protocol.ts）→ 毎秒の数の上限 → 処理。処理中の例外はログに残して捨てる（部屋は止めない）
import type { Client } from 'colyseus';
import type { GameRoom } from './GameRoom';
import { CONFIG as C, isBackAt } from '../shared/config';
import { PICKABLE } from '../shared/chars';
import { pushOut } from '../shared/geom';
import { SKILLS } from './skills';
import { clientReport } from '../shared/netmeasure';
import { CHECK, checkE2e, type C2S } from '../shared/protocol';
import MAP from '../shared/map.json';

const T = MAP.tileSize;

export const HANDLERS = {
  netPing: (room: GameRoom, client: Client, m: { id: number; at: number }) => {
    if (room.measure && m?.id === room.measureId && Number.isFinite(m.at)) client.send('netPong', m);
  },
  netReport: (room: GameRoom, client: Client, m: { id: number; value: unknown }) => {
    if (!room.measure || m?.id !== room.measureId || Object.hasOwn(room.reports, client.sessionId)) return;
    const report = clientReport(m.value);
    if (report) room.reports[client.sessionId] = report;
  },
  input: (room: GameRoom, client: Client, m: { seq: number; dx: number; dy: number; rt?: number }) => {
    const p = room.players.get(room.owners.get(client.sessionId) ?? '');
    if (!p) return;
    p.inputs.push(m); // 1tickに1つずつ処理する（クライアントの予測と同じ刻み）
    p.inDx = m.dx; p.inDy = m.dy; // 最後に届いた移動入力（アルの突撃の方向に使う）
    if (p.inputs.length > C.NET_QUEUE_MAX) { p.inputs.shift(); if (room.measure && room.phase === 'playing') room.measure.client(client.sessionId).dropped++; }
  },
  // Q を押した: 押している間リコールを溜める
  resultReq: (room: GameRoom, client: Client) => { const r = room.rec.summary(); if (room.phase === 'ended' && r) client.send('result', r); }, // 試合結果画面のデータ: 結果画面の間に入室・再接続した人は、受け取る準備ができてから求める
  qdown: (room: GameRoom, client: Client, m?: { seq?: number }) => {
    const p = room.players.get(room.owners.get(client.sessionId) ?? '');
    if (p && room.phase === 'playing' && p.alive && p.qAt === null) { p.qAt = p.recallAt = room.now; p.qSeq = Number.isFinite(m?.seq) ? m!.seq! : -Infinity; } // seq: 押す前に送った移動入力（まだ処理待ちの分で中断しない）
  },
  // Q を離した: 溜めを捨てる（短押しは何もしない）
  qup: (room: GameRoom, client: Client) => {
    const p = room.players.get(room.owners.get(client.sessionId) ?? '');
    if (!p || p.qAt === null) return;
    p.qAt = p.recallAt = null;
  },
  // 観戦者の視点の切り替え（観戦者だけ。参加者は無視）
  spec: (room: GameRoom, client: Client, m: { view: unknown }) => {
    if (!room.owners.has(client.sessionId) && (['all', 'focus', 0, 1] as unknown[]).includes(m?.view)) room.specView.set(client.sessionId, m.view as 'all' | 'focus' | 0 | 1);
  },
  // リザルトの「戻る」
  back: (room: GameRoom, client: Client) => {
    const id = room.owners.get(client.sessionId);
    if (id && room.phase === 'ended') { room.backVotes.add(id); room.checkBack(); }
  },
  skill: (room: GameRoom, client: Client) => {
    const id = room.owners.get(client.sessionId);
    if (id) room.skill(id);
  },
  // 技の入力を離した。a: 矢印の向き（動かしていなければなし＝自動照準）
  skillUp: (room: GameRoom, client: Client, m?: { a?: number }) => {
    const id = room.owners.get(client.sessionId);
    if (id) room.skillUp(id, m?.a);
  },
  // タメ中に技の入力を押し直して矢印を動かした（アルの突撃・花丸パンチ）。a: 矢印の向き
  skillAim: (room: GameRoom, client: Client, m?: { a?: number }) => {
    const p = room.players.get(room.owners.get(client.sessionId) ?? '');
    if (p?.alive && Number.isFinite(m?.a)) SKILLS[p.char]?.reAim?.(room, p, m!.a!);
  },
  aim: (room: GameRoom, client: Client, m: { mode: string }) => {
    const p = room.players.get(room.owners.get(client.sessionId) ?? '');
    if (p && C.AIM_MODES.includes(m.mode)) p.aim = m.mode;
  },
  // 待機画面で今選んでいる（表示している）キャラ。猶予の時間切れで未出撃なら、このキャラで出撃する
  pick: (room: GameRoom, client: Client, m: { char: string }) => {
    const p = room.players.get(room.owners.get(client.sessionId) ?? '');
    if (p && room.phase === 'waiting' && room.sortieLeft === null && PICKABLE.includes(m.char)) p.char = m.char; // 出撃の秒数の間は変えられない
  },
  // 出撃: そのキャラで出撃済みにする。開始の判定（全員出撃で開始、最初の出撃で選択猶予のカウント開始）
  go: (room: GameRoom, client: Client, m: { char: string }) => {
    const p = room.players.get(room.owners.get(client.sessionId) ?? '');
    if (!p || room.phase !== 'waiting' || room.sortieLeft !== null || !PICKABLE.includes(m.char)) return;
    Object.assign(p, { char: m.char, ok: true });
    if (room.practice) { room.startPractice(PICKABLE[Math.floor(Math.random() * PICKABLE.length)]); return; } // 練習: 相手は選べるキャラからランダムで即開始
    if (room.lobbyLeft === null) room.lobbyLeft = C.LOBBY_GRACE;
    room.updateLobby(0);
  },
  // 出撃を取り消す（キャラはそのまま。カウントは止まらない）
  unpick: (room: GameRoom, client: Client) => {
    const p = room.players.get(room.owners.get(client.sessionId) ?? '');
    if (p && room.phase === 'waiting' && room.sortieLeft === null) p.ok = false;
  },
  // 待機画面で陣営を移る（満員なら移れない）
  team: (room: GameRoom, client: Client, m: { team: number }) => {
    const p = room.players.get(room.owners.get(client.sessionId) ?? '');
    if (!p || room.phase !== 'waiting' || room.sortieLeft !== null || (m.team !== 0 && m.team !== 1) || p.team === m.team) return;
    if ([...room.players.values()].filter((q) => q.team === m.team).length >= C.TEAM_SIZE) return;
    room.players.delete(p.id);
    room.addPlayer(p.id, m.team, false).char = p.char;
  },
  // 練習の部屋の操作（練習パネル）: 相手の差し替え・相手の動き・パワーアップのレベル・アシスト召喚・大将の全快・選択画面へ
  pr: (room: GameRoom, client: Client, m: any) => {
    const me = room.players.get(room.owners.get(client.sessionId) ?? ''), foe = room.players.get('foe');
    if (!room.practice || !me || room.phase !== 'playing') return;
    if (m?.op === 'foe' && foe && PICKABLE.includes(m.char)) room.practiceFoe(foe, m.char);
    if (m?.op === 'mode' && ['stand', 'passive', 'bot'].includes(m.mode)) room.practiceMode(m.mode);
    if (m?.op === 'power' && (m.d === 1 || m.d === -1)) { const q = m.who === 'foe' ? foe : me; if (q) room.practicePower(q, m.d); }
    if (m?.op === 'assist' && C.ASSIST.units[m.char] && Number.isInteger(m.tier) && m.tier >= 0 && m.tier < C.ASSIST_TAGS.length && (m.side === 'mine' || m.side === 'foe')) {
      const team = m.side === 'mine' ? me.team : 1 - me.team;
      for (const a of [...room.players.values()]) if (a.assist && a.team === team) room.players.delete(a.id); // 同時1体なので、今のアシストと入れ替える
      room.summonAssist(team, m.tier, m.char);
    }
    if (m?.op === 'boss') for (const b of room.bosses) Object.assign(b, { hp: C.BOSS_HP, dmgAtBase: 0 });
    if (m?.op === 'back') room.practiceBack();
  },
  // e2e 専用（環境変数 E2E_HOOKS=1 のときだけ有効）: 自キャラを敵大将の左隣へ移す
  ...(process.env.E2E_HOOKS ? {
    e2eWarp: (room: GameRoom, client: Client) => {
      const p = room.players.get(room.owners.get(client.sessionId) ?? '');
      if (!p || !p.alive || room.phase !== 'playing') return;
      const boss = room.bosses[1 - p.team];
      room.relocate(`p:${p.id}`, p, { x: boss.x - (C.BOSS_RADIUS + C.PLAYER_RADIUS + 8), y: boss.y });
      Object.assign(p, { dx: 0, dy: 0, face: 0 });
    },
    // 時間の早送り（1tickの間にサーバーの処理を k 回まわす）
    e2eSpeed: (room: GameRoom, _c: Client, m: { k: number }) => { room.speed = Math.max(1, Math.round(m.k)); },
    // 残り時間を sec 秒にする（試合終了までの待ちを省く）
    e2eTimeLeft: (room: GameRoom, _c: Client, m: { sec: number }) => { if (Number.isFinite(m.sec)) room.now = C.MATCH_TIME - m.sec; },
    // 自分の近くに資材を1個置く（資材の出現を待たずに、拾う確認をするため）
    e2eMaterial: (room: GameRoom, c: Client) => {
      const p = room.players.get(room.owners.get(c.sessionId) ?? '');
      if (p) { const q = pushOut(p.x + 40, p.y, 4, room.obstacles()); room.materials.push({ id: room.nextId++, ...q, hi: isBackAt(Math.floor(q.x / T), Math.floor(q.y / T)) }); }
    },
    // 自分の足元に回復アイテム・荷物を置く
    e2eItem: (room: GameRoom, c: Client, m: { kind: string }) => {
      const p = room.players.get(room.owners.get(c.sessionId) ?? '');
      if (p) room.items.push({ id: room.nextId++, kind: m.kind, team: -1, x: p.x + 8, y: p.y, e2e: true });
    },
    // 自分の画面に全ユニットを送る（観戦者と同じ）
    e2eReveal: (room: GameRoom, c: Client, m: { on: boolean }) => { if (m.on) room.reveal.add(c.sessionId); else room.reveal.delete(c.sessionId); },
    // 開始の演出とカウントを飛ばす
    e2eSkipIntro: (room: GameRoom) => { if (room.phase === 'intro' || room.phase === 'countdown') room.beginPlay(); },
    // 陣営 team の徳を v にする
    e2eToku: (room: GameRoom, _c: Client, m: { team: number; v: number }) => { if (room.teams[m.team]) room.teams[m.team].toku = m.v; },
    // 陣営 team のスロットを今すぐ回し直し、結果を決める（win: 当たり、reach: 2つそろい）。chain: チャンスアップの確率
    e2eSlot: (room: GameRoom, _c: Client, m: { team: number; win?: boolean; pen?: boolean; reach?: boolean; chain?: number }) => {
      const sl = room.teams[m.team]?.slot;
      if (!sl) return;
      const ms = room.teams[m.team].m; // モダン: 次に回る保留を差し替える（pen＝転落、reach＝リーチのみの演出つき）
      if (ms) { ms.force({ outcome: m.win ? 'win' : m.pen ? 'fall' : 'miss', act: m.reach ? 'plain' : null }); return; }
      room.startSpin(m.team, m.win ? 'win' : m.pen ? 'pen' : 'miss', !m.win && !m.pen ? (m.reach ? 'plain' : null) : undefined);
      if (m.chain !== undefined) room.slotChance = m.chain;
    },
    // 自分の陣営にアシストを召喚する（near: 自分の隣に出す）
    e2eAssist: (room: GameRoom, c: Client, m: { char: string; tier: number; dx?: number; dy?: number; ready?: boolean }) => {
      const p = room.players.get(room.owners.get(c.sessionId) ?? '');
      if (!p) return;
      const a = room.summonAssist(p.team, m.tier, m.char);
      if (m.dx !== undefined) room.relocate(`p:${a.id}`, a, pushOut(p.x + m.dx, p.y + (m.dy ?? 0), C.PLAYER_RADIUS, room.obstacles())); // 自分からの位置
      if (m.ready) a.skillReadyAt = room.now; // 技をすぐ使える
    },
    // 自分の悪行ポイントを v にする（指名手配の確認用）
    e2eBad: (room: GameRoom, c: Client, m: { v: number }) => { const p = room.players.get(room.owners.get(c.sessionId) ?? ''); if (p) { p.bad = m.v; p.wantedHold = false; } },
    // 自キャラを (x, y) へ移す
    e2eTeleport: (room: GameRoom, c: Client, m: { x: number; y: number }) => { const p = room.players.get(room.owners.get(c.sessionId) ?? ''); if (p?.alive) { room.relocate(`p:${p.id}`, p, pushOut(m.x, m.y, C.PLAYER_RADIUS, room.obstacles())); p.dx = p.dy = 0; } },
    // 自キャラのキャラを変える（花丸の確認用）
    e2eChar: (room: GameRoom, c: Client, m: { char: string }) => { const p = room.players.get(room.owners.get(c.sessionId) ?? ''); if (p && PICKABLE.includes(m.char)) { for (const k of SKILLS[p.char]?.statuses ?? []) delete p.st[k]; p.char = m.char; p.hp = room.maxHp(p); } }, // 前のキャラの技の状態（アルのタメなど）は消す。替えた後のキャラでは終わらず残るので
    // 自キャラの技のクールタイムを明ける（charge: CT 明けから何秒たったことにするか。花丸パンチのチャージの確認用）
    e2eReady: (room: GameRoom, c: Client, m?: { charge?: number }) => { const p = room.players.get(room.owners.get(c.sessionId) ?? ''); if (p) { p.skillReadyAt = room.now - (m?.charge ?? 0); if (m?.charge) Object.assign(p.sk, { from: undefined, koAt: p.koAt }); } }, // from: 花丸の撤退からのチャージの起点。koAt もそろえる（撤退から戻った直後だと、次の tick で戻ったとみなされてチャージが0からになる）
    // コバコを自分の近くに出す（dist: 自分からの距離）
    e2eCourier: (room: GameRoom, c: Client, m: { dist?: number; box?: string }) => {
      const p = room.players.get(room.owners.get(c.sessionId) ?? '');
      if (!p) return;
      if (!room.couriers.length) room.spawnCourier();
      room.relocate(`c:${room.couriers[0].id}`, room.couriers[0], pushOut(p.x + (m.dist ?? 40), p.y, C.PLAYER_RADIUS, room.obstacles()));
      if (m.box) room.couriers[0].box = m.box;
    },
    // Bot の攻撃で大将が減らないようにする（人間の確認の途中で試合が決着しないように）
    e2eBossGuard: (room: GameRoom, _c: Client, m: { on: boolean }) => { room.bossGuard = m.on; },
    e2eCourierGuard: (room: GameRoom, _c: Client, m: { on: boolean }) => { room.courierGuard = m.on; },
    // 自キャラの変身（パワーアップ）を解き、落ちている荷物の箱を片付ける
    e2eClearUlt: (room: GameRoom, c: Client) => { const p = room.players.get(room.owners.get(c.sessionId) ?? ''); if (p?.ult) room.endUlt(p); room.items = room.items.filter((it) => !it.kind.startsWith('box_')); },
    // スロットの自然な回転を外れに固定する（e2eSlot で結果を決める回転は別）
    e2eSlotMiss: (room: GameRoom, _c: Client, m: { on: boolean }) => { room.slotMiss = m.on; },
    // 敵大将に、拠点移動が起きるだけのダメージを与える（拠点移動・第2形態の確認用）
    e2eBossMove: (room: GameRoom, c: Client) => {
      const p = room.players.get(room.owners.get(c.sessionId) ?? '');
      if (p && room.phase === 'playing') { const b = room.bosses[1 - p.team]; room.damageBoss(b, Math.max(1, C.BOSS_MOVE_THRESHOLD - b.dmgAtBase), p); }
    },
    // 自キャラの自動攻撃を止める／戻す（検証の前提を崩さないように）
    e2eNoAuto: (room: GameRoom, c: Client, m: { on: boolean }) => { const id = room.owners.get(c.sessionId); if (id) { if (m.on) room.noAuto.add(id); else room.noAuto.delete(id); } },
    // 両陣営のアシストをすべて消す（前の確認で出したアシストが後の確認に干渉しないように）
    e2eClearAssists: (room: GameRoom) => { for (const p of [...room.players.values()]) if (p.assist) room.players.delete(p.id); },
    // 自キャラを撤退させる
    e2eKill: (room: GameRoom, c: Client) => {
      const p = room.players.get(room.owners.get(c.sessionId) ?? '');
      if (p) room.damagePlayer(p, 1e9, null);
    },
  } : {}),};

// クライアントごとの毎秒の受信数（超えた分は捨てる。切断はしない）。秒は部屋の経過時間（elapsed。実時間で進む。実時間より速く回す検証 verify/net.ts でも同じ数え方になるように）
const rate = new WeakMap<object, { room: GameRoom; at: number; n: number }>();
function rateOk(room: GameRoom, client: object) {
  const now = room.elapsed, r = rate.get(client);
  if (!r || r.room !== room || now - r.at >= 1) { rate.set(client, { room, at: now, n: 1 }); return true; } // 部屋ごとに数える
  return ++r.n <= C.NET_MSG_MAX_PER_SEC;
}

// GameRoom.messages: 名前 → (client, m)。'_' は未知の名前の受け皿（捨てる。Colyseus の既定の切断をしない）
export function bindMessages(room: GameRoom) {
  const out: Record<string, (client: Client, m?: any) => void> = {};
  for (const [k, f] of Object.entries(HANDLERS) as [string, (room: GameRoom, client: Client, m?: any) => void][]) {
    const check = (CHECK as Record<string, (m: unknown) => boolean>)[k] ?? (k.startsWith('e2e') ? checkE2e : null);
    out[k] = (client: Client, m?: any) => {
      if (!check || !rateOk(room, client) || !check(m)) return;
      try { f(room, client, m); } catch (e) { room.logError('message', e, k); }
    };
  }
  out._ = () => {};
  return out as { [K in keyof typeof HANDLERS]: (client: Client | { sessionId: string }, m?: K extends keyof C2S ? C2S[K] | unknown : any) => void } & { _: () => void };
}
