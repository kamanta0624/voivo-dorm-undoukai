// 猫使ビィ: オーバードライブ（加速・通常攻撃なし・残像のおとりを置く。触れた敵にダメージ予約 → 終了時にポーズ → 予約の全員へダメージ。途中で倒されたら不発）
import type { GameRoom, Player, Ent, Thing } from '../GameRoom';
import { thingId } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS, moveWalls } from '../../shared/chars';
import { moveBody } from '../../shared/geom';

const B = CHARS.bii.skill;
type Mark = { id: string; ko: number }; // 予約した敵（thingId）と、予約した時点の撃破時刻（倒れて復活した相手は外す）

// 予約がまだ有効な敵（生きていて、予約後に倒れていない）
const marked = (room: GameRoom, e: Ent) => (e.marks as Mark[])
  .map((m) => ({ m, t: room.enemyThings(e.team).find((t) => thingId(t) === m.id) }))
  .filter((x): x is { m: Mark; t: Thing } => !!x.t && (x.t.k !== 'p' || x.t.o.koAt === x.m.ko))
  .map((x) => x.t);

// オーバードライブの進行（ビィ1人に1つ。owner のビィが倒れたら予約ごと消える）
function update(room: GameRoom, e: Ent, dt: number) {
  const p = room.players.get(e.owner);
  if (!p?.alive || (!p.st.overload && !p.st.overloadPose)) return room.removeEnt(e); // 途中で倒された: 不発
  Object.assign(e, { x: p.x, y: p.y });
  if (room.stat(p, 'overload')) {
    if (room.now >= e.nextDecoy - 1e-9) { e.nextDecoy += B.every; decoy(room, p); } // 1e-9: 時刻の足し算の誤差でtickが1つずれないように
    // 触れた敵に予約（同じ敵は1回）
    if (room.phase === 'playing') for (const t of room.enemyThings(p.team)) {
      const b = room.body(t), c = room.bodyOf(p); // 接触は体の中心どうし
      if ((t.k !== 'p' && t.k !== 'boss') || !room.targetable(t) || Math.hypot(b.x - c.x, b.y - c.y) > t.r + B.touch) continue;
      const id = thingId(t);
      if (!e.marks.some((m: Mark) => m.id === id)) e.marks.push({ id, ko: t.k === 'p' ? t.o.koAt : 0 });
    }
  } else if (p.st.overload) {
    // 終了: 予約がいればポーズ（硬直）、いなければ何もしない。ポーズの終わり＝爆発は技の終了時刻＋pose（予約の残り秒の表示と一致させる）
    const end = p.st.overload.until;
    delete p.st.overload;
    if (!marked(room, e).length) return room.removeEnt(e);
    p.st.overloadPose = { until: end + B.pose, lock: true, still: true, noAttack: true, cancel: true };
  } else if (!room.stat(p, 'overloadPose')) {
    // ポーズの終わり: 予約の全員へダメージ
    delete p.st.overloadPose;
    for (const t of marked(room, e)) { room.hitThing(p, t, t.k === 'boss' ? B.bossDmg : B.dmg); room.addFx({ x: t.x, y: t.y, team: p.team }, 'aura', { r: t.r + 16, color: 'boom' }); }
    return room.removeEnt(e);
  }
  // 予約の目印（両陣営に送る）。位置はクライアントが対象の描画位置から引く。at: 爆発の時刻（技の終了時刻＋pose）、left: 爆発までの残り秒
  const at = p.st.overloadPose?.until ?? (p.st.overload?.until ?? room.now) + B.pose;
  e.v = marked(room, e).map((t) => ({ id: thingId(t), r: t.r, at, left: Math.max(0, at - room.now) }));
}

// 残像（おとり）をその場に置く
function decoy(room: GameRoom, p: Player) {
  room.ents.push({ id: room.nextId++, kind: 'biiDecoy', team: p.team, owner: p.id, x: p.x, y: p.y, r: C.PLAYER_RADIUS, body: 'unit', hp: B.decoyHp, a: p.face, until: room.now + B.decoyLife });
}
// 残像: decoyLife 秒で消える（攻撃を受けたら hitThing が消す）
function updateDecoy(room: GameRoom, e: Ent) {
  if (room.now >= e.until) room.removeEnt(e);
}

const skill: Skill = {
  use(room, p) {
    p.st.overload = { until: room.now + B.dur, speed: B.speed, noAttack: true, cancel: true };
    room.ents = room.ents.filter((e) => !(e.kind === 'overload' && e.owner === p.id));
    room.ents.push({ id: room.nextId++, kind: 'overload', team: p.team, owner: p.id, x: p.x, y: p.y, r: 0, body: null, marks: [], nextDecoy: room.now + B.every, v: [] });
    decoy(room, p); // 発動した位置に1つ目
  },
  // Bot: オーバードライブ中は、まだ予約していない一番近い敵へ寄る（通常の移動の代わり）
  afterMove(room, p, dt, px, py, locked) {
    if (!p.bot || locked || !room.stat(p, 'overload')) return;
    const e = room.ents.find((x) => x.kind === 'overload' && x.owner === p.id);
    const t = room.enemyThings(p.team).filter((t) => (t.k === 'p' || t.k === 'boss') && room.targetable(t) && room.reach(p, t) && !e?.marks.some((m: Mark) => m.id === thingId(t)))
      .sort((u, v) => Math.hypot(u.x - px, u.y - py) - Math.hypot(v.x - px, v.y - py))[0];
    if (!t) return;
    const d = Math.hypot(t.x - px, t.y - py) || 1, sp = Math.min(room.speedOf(p) * dt, d);
    Object.assign(p, moveBody(px, py, ((t.x - px) / d) * sp, ((t.y - py) / d) * sp, C.PLAYER_RADIUS, moveWalls(p.char, room.obstacles())));
  },
  botUse: (room, p) => room.nearFoe(p, B.botRange, (t) => t.k === 'p' || t.k === 'boss'),
  statuses: ['overload', 'overloadPose'],
  ents: { overload: { update, fog: false }, biiDecoy: { update: updateDecoy, fog: true } },
};
export default skill;
