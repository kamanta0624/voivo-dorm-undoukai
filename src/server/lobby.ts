// 待機・入退室・練習・観戦（Colyseus の呼び口は GameRoom に残し、中身をここへ委譲）（refac2 で GameRoom.ts から切り出し。中身は変えていない）。形は skills と同じ「関数(room, …)」
import { Client, CloseCode, ServerError } from 'colyseus';
import { CONFIG as C } from '../shared/config';
import * as OG from './outgame';
import { type Player, type GameRoom } from './GameRoom';

// 待機画面の開始の判定: 接続中の人間（再接続待ちは除く）が全員出撃済みなら開始。選択猶予が切れたら、未出撃の人は今選んでいるキャラで開始
// 接続中の人間がいないまま猶予が切れたら開始せず、カウントを止める（誰も操作できない試合を始めない）
export function updateLobby(room: GameRoom, dt: number) {
  const humans = [...room.players.values()].filter((p) => !p.bot && !room.dropped.has(p.id));
  if (room.sortieLeft !== null) { // 出撃の秒数が過ぎたら戦闘画面へ（その間に人間がいなくなったら始めない）
    room.sortieLeft -= dt;
    if (room.sortieLeft > 0) return;
    room.sortieLeft = null;
    if (humans.length) room.startMatch();
    return;
  }
  if (room.lobbyLeft === null) return;
  room.lobbyLeft = Math.max(0, room.lobbyLeft - dt);
  if (humans.length && humans.every((p) => p.ok)) return decideStart(room);
  if (room.lobbyLeft > 0) return;
  if (humans.length) decideStart(room); else room.lobbyLeft = null;
}

// 開始が決まった: 常設の部屋は SORTIE_SEC 秒、選択画面のまま置いてから戦闘画面へ（e2e の部屋はすぐ）
export function decideStart(room: GameRoom) {
  if (!room.pub) return room.startMatch();
  room.lobbyLeft = null; room.sortieLeft = C.SORTIE_SEC;
}

// 人間全員が「戻る」を押したら（Botは押した扱い）待機画面へ。Botは消し、人間は陣営と選んだキャラのまま
export function checkBack(room: GameRoom) {
  const list = [...room.players.values()].filter((p) => !p.assist);
  if (room.phase !== 'ended' || !list.every((p) => p.bot || room.backVotes.has(p.id))) return;
  const humans = list.filter((p) => !p.bot);
  room.players.clear();
  room.setup();
  for (const h of humans) room.addPlayer(h.id, h.team, false).char = h.char;
  promoteSpectators(room);
  room.unlock();
}

// 待機画面に戻るとき: 観戦者を入室順に参加者へ（陣営は人数の少ない側）。参加者が TEAM_SIZE×2・人間が ROOM_FULL に達したら残りは観戦のまま
export function promoteSpectators(room: GameRoom) {
  for (const c of room.clients) {
    if (room.owners.has(c.sessionId)) continue;
    if (room.players.size >= C.TEAM_SIZE * 2 || (room.pub && room.humanCount() >= C.ROOM_FULL)) break;
    joinPlayer(room, c, room.specName.get(c.sessionId));
  }
  room.abandonLeft = null;
}

// 参加者として加える（待機画面）。名前は部品の組み合わせでなければ付け直し、重複は番号
export function joinPlayer(room: GameRoom, client: Client, name?: string) {
  const counts = [0, 0];
  room.players.forEach((p) => counts[p.team]++);
  const p = room.addPlayer(client.sessionId, counts[0] <= counts[1] ? 0 : 1, false);
  const base = OG.cleanName(name) ?? OG.randomName(); // 本人が入力した名前（空・長すぎる時は自動の名前）。同じ部屋で重なったら末尾に番号
  Object.assign(p, { name: OG.uniqueName(base, [...room.players.values()].filter((q) => q !== p).map((q) => q.name ?? '')), ip: client.auth?.ip, bid: client.auth?.bid });
  room.owners.set(client.sessionId, client.sessionId);
  room.specName.delete(client.sessionId); room.specView.delete(client.sessionId);
}

// 観戦者の数（owners にない client）
export function spectators(room: GameRoom) { return room.clients.filter((c) => !room.owners.has(c.sessionId)).length; }

// 対戦中に参加者の人間（再接続待ちは数えない）が0人で観戦者だけ残ったら、ABANDON_SEC 秒で打ち切って待機画面へ。参加者が戻れば解除
export function updateAbandon(room: GameRoom, dt: number) {
  if (!room.pub || !room.spectators() || [...room.players.values()].some((p) => !p.bot && !p.assist)) { room.abandonLeft = null; return; }
  room.abandonLeft = (room.abandonLeft ?? C.ABANDON_SEC) - dt;
  if (room.abandonLeft > 0) return;
  if (room.measure && room.startedAt) room.writeLog('disconnect');
  room.players.clear(); room.setup(); room.lobbyLeft = null;
  promoteSpectators(room);
  room.unlock();
}

// 練習の開始: 相手1体（Bot、id 'foe'）を足し、開始演出・カウントなしで始める。相手の動きは棒立ちから
export function startPractice(room: GameRoom, foe: string) {
  room.addPlayer('foe', 1, true).char = foe;
  room.practiceMode('stand');
  room.startMatch();
  room.beginPlay();
}

// 練習: 相手のキャラをその場で入れ替える（位置・向きはそのまま、HP は満タン）
export function practiceFoe(room: GameRoom, foe: Player, char: string) {
  const f = room.addPlayer('foe', 1, true);
  Object.assign(f, { char, x: foe.x, y: foe.y, face: foe.face, role: foe.role });
  f.hp = room.maxHp(f);
  if (!foe.alive) Object.assign(f, { alive: false, koAt: foe.koAt, respawnAt: foe.respawnAt });
}

// 練習: 相手の動き（棒立ち・攻撃なしは自動攻撃も止める。技は practice の判定で止める）
export function practiceMode(room: GameRoom, mode: GameRoom['foeMode']) {
  room.foeMode = mode;
  if (mode === 'bot') room.noAuto.delete('foe'); else room.noAuto.add('foe');
  const foe = room.players.get('foe');
  if (foe && mode === 'stand') Object.assign(foe, { dx: 0, dy: 0, path: [] });
}

// 練習: パワーアップのレベルを1つ上げ下げ（なし〜POWER_TAGS の上限）。変えたら効果時間とHPは最初から
export function practicePower(room: GameRoom, q: Player, d: 1 | -1) {
  const cur = q.ult ? q.ult.tier : -1, to = Math.max(-1, Math.min(C.POWER_TAGS.length - 1, cur + d));
  if (to === cur) return;
  if (to < 0) return room.endUlt(q);
  if (!q.ult) return room.giveUlt(q, to);
  q.ult.tier = to;
  if (!q.ult.pending) { q.ult.until = room.now + C.ULT_DURATION; q.hp = room.maxHp(q); }
}

// 練習: 選択画面へ（部屋はそのまま。本人だけ残して待機に戻す）
export function practiceBack(room: GameRoom) {
  const h = [...room.players.values()].find((p) => !p.bot && !p.assist);
  room.players.clear();
  room.setup();
  room.practiceMode('bot');
  if (h) Object.assign(room.addPlayer(h.id, h.team, false), { char: h.char, name: h.name, ip: h.ip, bid: h.bid });
}

// 入室の判定: BAN は全部の部屋、常設の部屋はメンテ中・対戦中・満員も拒否（再接続はここを通らない）
export function onAuth(room: GameRoom, _client: Client, options: any, ctx?: { ip?: string; headers?: Headers }) {
  const ip = ctx?.headers?.get?.('cf-connecting-ip') ?? ctx?.ip ?? '', bid = typeof options?.bid === 'string' ? options.bid.slice(0, 64) : '';
  if (OG.banned(ip, bid)) throw new ServerError(4403, '入室できません');
  if ((room.pub || room.practice) && OG.maintenance()) throw new ServerError(4503, OG.maintText());
  if (room.practice && room.humanCount() >= 1) throw new ServerError(4409, 'この部屋には入れません'); // 練習の部屋は作った本人だけ
  if (room.pub && room.phase !== 'waiting' && spectators(room) >= C.SPECTATOR_MAX) throw new ServerError(4429, '観戦席が満員です'); // 対戦中は観戦で入る
  if (room.pub && room.phase === 'waiting' && room.humanCount() >= C.ROOM_FULL) throw new ServerError(4429, 'この部屋は満員です');
  return { ip, bid };
}

export function onJoin(room: GameRoom, client: Client, options?: { name?: string }) {
  room.crackSent.delete(client.sessionId); // 壁の段階は最初から送る
  if (room.phase === 'playing') room.measure?.client(client.sessionId);
  if (room.phase === 'waiting') {
    if (room.players.size >= C.TEAM_SIZE * 2) { room.specName.set(client.sessionId, options?.name ?? ''); return; } // 観戦
    joinPlayer(room, client, options?.name);
    if (room.practice) room.lock(); // 練習の部屋は本人だけ
  } else if (room.pub) {
    room.specName.set(client.sessionId, options?.name ?? ''); // 常設の部屋の対戦中は観戦（Bot とは入れ替えない）。待機画面に戻るときに参加者になる
  } else if (room.phase !== 'ended') {
    // 人間の少ない陣営のBotと入れ替わる。Botがいなければ観戦
    const humans = [0, 0];
    room.players.forEach((p) => { if (!p.bot) humans[p.team]++; });
    const team = humans[0] <= humans[1] ? 0 : 1;
    const bot = [...room.players.values()].find((p) => p.team === team && p.bot && !p.assist && !room.dropped.has(p.id));
    if (bot) {
      bot.bot = false;
      bot.dx = bot.dy = 0;
      bot.aim = C.AIM_MODES[0];
      bot.inputs = []; bot.ack = 0;
      bot.qAt = bot.recallAt = null;
      room.owners.set(client.sessionId, bot.id);
    }
  }
}

// 通信が切れた（スマホのバックグラウンド等）: RECONNECT_SEC 秒は再接続を待つ。待つ間は Bot が代わりに動かす。待ちきれなければ onLeave
export function onDrop(room: GameRoom, client: Client) {
  const p = room.players.get(room.owners.get(client.sessionId) ?? '');
  if (p && room.phase !== 'waiting') Object.assign(p, { bot: true, path: [], aim: C.BOT_AIM, qAt: null, recallAt: null });
  if (p) room.dropped.add(p.id);
  room.allowReconnection(client, C.RECONNECT_SEC);
}

// 再接続できた: 操作を本人に戻す（照準モードはクライアントが送り直す）
export function onReconnect(room: GameRoom, client: Client) {
  room.crackSent.delete(client.sessionId); // 壁の段階は最初から送り直す（ページを読み直した時もそろう）
  const p = room.players.get(room.owners.get(client.sessionId) ?? '');
  if (p && room.kicked.has(p.id)) { room.dropped.delete(p.id); return client.leave(CloseCode.CONSENTED, OG.banned(p.ip ?? '', p.bid ?? '') ? 'ban' : 'kick'); }
  if (p) { Object.assign(p, { bot: false, dx: 0, dy: 0 }); room.dropped.delete(p.id); }
}

export function onLeave(room: GameRoom, client: Client) {
  const id = room.owners.get(client.sessionId);
  room.owners.delete(client.sessionId);
  room.specName.delete(client.sessionId); room.specView.delete(client.sessionId);
  if (id) {
    room.dropped.delete(id);
    if (room.phase === 'waiting') room.players.delete(id);
    else {
      const p = room.players.get(id);
      if (p) { p.bot = true; p.path = []; p.aim = C.BOT_AIM; p.qAt = p.recallAt = null; }
      checkBack(room);
    }
  }
  // 常設の部屋: 人間が誰もいなくなったら（再接続待ちもなし）、試合を打ち切って待機に戻す
  if (room.pub && room.phase !== 'waiting' && !room.clients.length && !room.dropped.size) { if (room.measure && room.startedAt) room.writeLog('disconnect'); room.players.clear(); room.setup(); room.lobbyLeft = null; room.unlock(); }
}
