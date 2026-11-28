// クライアントからのメッセージの処理（sec1 で GameRoom.ts から切り出し。中身は変えていない）。形は skills と同じ「関数(room, client, m)」
// GameRoom.messages は bindMessages で作る: 受信の検証（shared/protocol.ts）→ 毎秒の数の上限 → 処理。処理中の例外はログに残して捨てる（部屋は止めない）
import type { Client } from 'colyseus';
import type { GameRoom } from './GameRoom';
import { CONFIG as C } from '../shared/config';
import { PICKABLE } from '../shared/chars';
import { SKILLS } from './skills';
import { clientReport } from '../shared/netmeasure';
import { CHECK, checkE2e, type C2S } from '../shared/protocol';
import { E2E_HANDLERS } from './e2e';
import { rttPong as lagRtt } from './lagcomp';

export const HANDLERS = {
  netPing: (room: GameRoom, client: Client, m: { id: number; at: number }) => {
    if (room.measure && m?.id === room.measureId && Number.isFinite(m.at)) client.send('netPong', m);
  },
  rq: (room: GameRoom, client: Client, m: { n: number }) => { const p = room.players.get(room.owners.get(client.sessionId) ?? ''); if (p) lagRtt(room, p, m.n); }, // 往復の遅延の計測の返事（sync1）
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
  snapFull: (room: GameRoom, client: Client) => { room.snapSent.delete(client.sessionId); room.crackSent.delete(client.sessionId); }, // 壁の段階（変わった分だけ送る）も最初から // 差分（sync2）: 受け取りの準備ができる前（main の読み込み中）に届いた分は捨てられるので、準備ができたら全部送り直す
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
  ...(process.env.E2E_HOOKS ? E2E_HANDLERS : {}), // e2e 専用（環境変数 E2E_HOOKS=1 のときだけ足す。中身は e2e.ts。refac1）
};

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
