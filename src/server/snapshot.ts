// スナップショット（'s'）の組み立てと送信（refac1 で GameRoom.ts から切り出し。中身は変えていない）。形は skills と同じ「関数(room, …)」
import type { GameRoom, Player, Slot, CHold } from './GameRoom';
import type { ModernSlot } from '../shared/slot_modern';
import { CONFIG as C } from '../shared/config';
import { SKILLS, ENTS } from './skills';
import { thingId } from './GameRoom';
import { type Snapshot, SNAP_KEEP, SNAP_PKEEP, SNAP_FOE_DROP } from '../shared/protocol';
import { Packr } from 'msgpackr';

const packr = new Packr({ useRecords: false }); // Colyseus の送信と同じ詰め方（スナップショットの大きさの計測だけに使う。sync2）

export function sendSnapshots(room: GameRoom) {
  const obs = room.seeWalls; // 敵の表示は視界の壁（透過壁を通す）
  const vis = [0, 1].map((team) => ({
    players: [...room.players.values()].filter((p) => p.team === team || ((p.alive || room.dying(p)) && room.bodySeen(team, { k: 'p', o: p, x: p.x, y: p.y, r: C.PLAYER_RADIUS }, obs))), // 体の一部でも見えれば送る（hitbox1） // 撃破の演出中の敵も視界内なら送る
    bosses: room.bosses.filter((b) => b.team === team || room.phase === 'intro' || room.bodySeen(team, { k: 'boss', o: b, x: b.x, y: b.y, r: C.BOSS_RADIUS }, obs)), // 開幕中は敵大将も映す
    ents: room.ents.filter((e) => e.team === team || !ENTS[e.kind].fog || room.visibleTo(team, e.x, e.y, obs)),
    shots: room.shots.filter((s) => s.team === team || room.visibleTo(team, s.x, s.y + (s.up ?? 0), obs)), // 弾は真下の床の位置で
    fx: room.fx.filter((f) => f.team === team || room.visibleTo(team, f.x, f.y, obs)), // 視界内なら他プレイヤーの技も見える
    warns: room.warns.filter((w) => w.team === team || room.visibleTo(team, w.x, w.y, obs)),
  }));
  const wanted = room.teams.map((t) => room.players.get(t.wanted ?? '')).filter((p) => p?.alive).map((p) => ({ id: p!.id, team: p!.team, x: p!.x, y: p!.y }));
  const all = { players: [...room.players.values()], bosses: room.bosses, ents: room.ents, shots: room.shots, fx: room.fx, warns: room.warns };
  const roster = [...room.players.values()].filter((p) => !p.assist).map((p) => ({ id: p.id, team: p.team, bot: p.bot, char: p.char, alive: p.alive, ok: p.ok, name: p.name, ult: p.ult && !p.ult.pending ? p.ult.tier : null })); // ult: パワーアップ中の強さ（一覧の札。両陣営に送る）
  const keep: Record<string, string> = {}; // 変わった時だけ送る項目（全員に同じ値）の今の中身（sync2 1章）
  const keepSrc: Record<(typeof SNAP_KEEP)[number], unknown> = { roster, materials: room.materials, items: room.items, broken: room.broken, bossRooms: room.bossRooms };
  for (const k of SNAP_KEEP) keep[k] = JSON.stringify(keepSrc[k]);
  for (const client of room.clients) {
    const me = room.players.get(room.owners.get(client.sessionId) ?? '');
    let sent = room.snapSent.get(client.sessionId), full = false;
    if (!sent) { room.snapSent.set(client.sessionId, (sent = { k: {}, p: new Map() })); full = true; } // 送った記録が無い（入室・snapFull・再接続・試合の作り直しの後）: 全部入りに印を付ける
    const cn = room.crackSent.get(client.sessionId) ?? 0, cracks = cn < room.crackLog.length ? room.crackLog.slice(cn) : null; // 壁の段階（小破・中破）は変わった分だけ
    room.crackSent.set(client.sessionId, room.crackLog.length);
    const sv = me ? null : room.specView.get(client.sessionId) ?? 'all'; // 観戦者の視点
    const v = me && !room.reveal.has(client.sessionId) && room.phase !== 'finale' ? vis[me.team] : (sv === 0 || sv === 1) && room.phase !== 'finale' ? vis[sv] : all; // 観戦者（組の視界以外）・決着演出中はフォグなし（全員に倒された大将・止めのキャラを映す）
    const myTeam = me ? me.team : 0;
    const pr = room.practice ? { mode: room.foeMode, lv: [me?.ult?.tier ?? -1, room.players.get('foe')?.ult?.tier ?? -1], foe: room.players.get('foe')?.char ?? null } : null; // 練習パネルの表示（相手は視界外でも）
    const snap: Snapshot = {
      ...(pr ? { practice: pr } : {}),
      ...(process.env.E2E_HOOKS && me ? { e2eFists: room.e2eFists.get(me.id) ?? 0 } : {}),
      ...(me ? {} : { spec: { view: sv, focus: room.cm.focus, abandon: room.abandonLeft === null ? null : Math.ceil(room.abandonLeft) } }), // 観戦者: 視点・実況のフォーカス・打ち切りまでの秒数
      netMeasure: room.measure ? room.measureId : 0, me: me?.id ?? null, t: room.elapsed, roster, buffs: me ? buffView(room, me) : null, ...(room.phase === 'intro' ? { introMess: room.introMess } : {}), back: room.phase === 'ended' ? room.backCount() : null, finale: room.finale, lobbyLeft: room.lobbyLeft, sortie: room.sortieLeft, phase: room.phase, phaseLeft: room.phaseLeft, timeLeft: room.timeLeft, winner: room.winner,
      teams: room.teams.map((t, i) => ({ toku: t.toku, wanted: t.wanted, reflect: room.reflecting(i), bossHpRatio: room.bosses[i].hp / C.BOSS_HP, m: t.m ? modernView(room, t.m) : classicView(room, t.slot, me?.id) })),
      wanted: wanted, // 指名手配中のキャラの位置（敵の視界外でもミニマップに出す）
      players: v.players.map((p) => ({
        id: p.id, team: p.team, char: p.char, bot: p.bot, x: p.x, y: p.y, hp: p.hp, alive: p.alive, rage: p.rage, bad: p.bad,
        face: p.face, stunned: room.now < p.stunUntil, cd: Math.max(0, p.cooldownUntil - room.now),
        respawnIn: p.alive ? 0 : p.respawnAt - room.now, ko: p.alive ? null : room.now - p.koAt, // ko: 撃破からの秒数（演出用）
        ack: p.ack, cage: room.cageOf(p), maxHp: room.maxHp(p), spd: room.speedOf(p), aim: p.aim, tgt: p.tgt ? thingId(p.tgt) : null, skillCd: Math.max(0, p.skillReadyAt - room.now), ...(p === me ? arrowView(room, p) : {}),
        st: statusView(room, p), lock: room.effect(p, 'lock'), still: room.stillLock(p),
        recall: p.recallAt === null ? null : (room.now - p.recallAt) / C.RECALL_HOLD,
        assist: p.assist, tier: p.tier, ult: p.ult ? { form: p.ult.form, tier: p.ult.tier, left: p.ult.pending ? null : p.ult.until - room.now } : null,
        boost: room.now < p.boostUntil, slow: room.now < p.slowUntil, weak: room.now < p.weakUntil, cdMax: room.atkCooldown(p),
      })),
      bosses: v.bosses.map((b) => ({ team: b.team, x: b.x, y: b.y, hp: b.hp, base: b.base })),
      materials: room.materials.map((m) => ({ id: m.id, x: m.x, y: m.y, hi: m.hi, big: !!m.big })), items: room.items,
      ents: v.ents.map((e) => ({ id: e.id, kind: e.kind, team: e.team, x: e.x, y: e.y, r: e.r, body: e.body, hp: e.hp, a: e.a, v: e.v })), // v: 技処理が渡す描画用の値
      couriers: room.couriers.map((c) => ({ id: c.id, team: c.team, x: c.x, y: c.y, box: c.box })), // コバコは両陣営に見せる（ミニマップ）
      warns: v.warns.map((w) => ({ id: w.id, team: w.team, x: w.x, y: w.y, r: w.r, left: w.at - room.now, boss: !!w.boss })),
      shots: v.shots.map((s) => ({ id: s.id, kind: s.kind, team: s.team, x: s.x, y: s.y, vx: s.vx, vy: s.vy })),
      fx: v.fx, broken: room.broken, ...(cracks ? { cracks } : {}), bossRooms: room.bossRooms, ...(room.reveal.has(client.sessionId) ? { reveal: true } : {}),
    };
    // 変わった時だけ送る（sync2 1章）: 前に送った中身と同じ項目は省く（クライアントが前の値を使う）。キャラごとの変わらない項目も同じ
    for (const k of SNAP_KEEP) { if (k in sent.k && sent.k[k] === keep[k]) delete (snap as any)[k]; else sent.k[k] = keep[k]; } // 初めては値が無くても載せる（全部入りに全項目がそろう）
    if (full) snap.full = true; // クライアントは全部入りが届くまで差分を使わない（sync2）
    for (const p of snap.players as any[]) {
      if (me && v !== all && p.team !== me.team) for (const k of SNAP_FOE_DROP) delete p[k]; // 敵には描画・表示に使わない項目を送らない（sync2 2章。改造クライアントで敵のクールタイム等が見えないように）
      const key = JSON.stringify(SNAP_PKEEP.map((k) => p[k]));
      if (sent.p.get(p.id) === key) for (const k of SNAP_PKEEP) delete p[k]; else sent.p.set(p.id, key);
    }
    if (room.measure && room.phase === 'playing' && room.measure.tick.n % 10 === 0) room.measure.client(client.sessionId).bytes.add(packr.pack(snap).length + 3); // 大きさの計測（sync2。10tick に1回。詰める手間を本番で増やしすぎない）。+3: 見出し（種類の番号・'s'）
    client.send('s', snap);
  }
}

// スナップショットで送る状態: 有効な状態の key → 描画用の値（なければ true）
export function statusView(room: GameRoom, p: Player) {
  const out: Record<string, any> = {};
  for (const k in p.st) if (room.now < p.st[k].until) out[k] = p.st[k].view?.() ?? true;
  return out;
}

// モダンのスロットの表示用（当否は送らない）: モード・引き戻しの残り・保留（色・先バレ・高確率）・回転中の保留・レベル（Lv.4+N の表示）
// クラシックの保留の表示（色・先バレ）。先バレは見る人（me）が対象の保留だけ。cur: 回っている保留（払い出し・罰の表示中はなし）、chain: 払い出し中のカットインの段
export function classicView(room: GameRoom, sl: Slot, me?: string) {
  const h = (x: CHold) => [x.color, me && x.saki.includes(me) ? 1 : 0, 0];
  return { kind: 'classic', holds: sl.holds.map(h), cur: sl.cur && sl.payoutAt === null && !sl.holdUntil ? h(sl.cur) : null, chain: sl.payoutAt !== null ? sl.chain : 0 };
}

export function modernView(room: GameRoom, m: ModernSlot) {
  const h = (x: { color: number; saki: boolean; high: boolean }) => [x.color, x.saki ? 1 : 0, x.high ? 1 : 0];
  return { mode: m.mode, backLeft: m.backLeft, holds: m.holds.map(h), cur: m.cur ? h(m.cur.hold) : null, lv: m.lv };
}

// 自キャラのバフ／デバフ欄: 時間制限つきの状態の残り秒数（状態 key → 秒）。スロットの罰の減速・攻撃力低下は pen_slow・pen_weak、アシストの加速は boost。終わりのない状態（溜め中など）は含めない
export function buffView(room: GameRoom, p: Player) {
  const out: Record<string, number> = {};
  for (const k in p.st) { const u = p.st[k].until; if (Number.isFinite(u) && room.now < u) out[k] = u - room.now; }
  if (room.now < p.slowUntil) out.pen_slow = p.slowUntil - room.now;
  if (room.now < p.weakUntil) out.pen_weak = p.weakUntil - room.now;
  if (room.now < p.boostUntil) out.boost = p.boostUntil - room.now;
  return out;
}

// 技の矢印（本人にだけ送る）: skA=矢印の向き（タメ中は今の向き、ほかは自動照準）、skR=矢印の長さ（技の射程。L があればそれ）、skRe=タメ中で向きを変えられる
export function arrowView(room: GameRoom, p: Player) {
  const ar = SKILLS[p.char]?.arrow?.(room, p);
  return ar ? { skA: ar.a ?? room.skillAim(p, ar.R), skR: ar.L ?? ar.R, skRe: ar.a !== undefined } : {};
}
