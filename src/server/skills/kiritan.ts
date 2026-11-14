// 東北きりたん: 全弾斉射（1回目でロックオン、2回目でロックした全員へホーミング弾を3回に分けて発射）
import type { GameRoom, Player, Ent, Thing } from '../GameRoom';
import { thingId } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';
import { inRect } from '../../shared/geom';

const S = CHARS.kiritan.skill;
const PATTERNS = ['straight', 'spread', 'brake'];

// ロックできる敵（射程内・見える・対象にできる）。近い順
const candidates = (room: GameRoom, p: Player) => room.enemyThings(p.team)
  .filter((t) => (t.k === 'p' || t.k === 'boss') && room.targetable(t) && Math.hypot(t.x - p.x, t.y - p.y) <= S.range + t.r && room.reach(p, t))
  .sort((u, v) => Math.hypot(u.x - p.x, u.y - p.y) - Math.hypot(v.x - p.x, v.y - p.y));
const find = (room: GameRoom, team: number, id: string) => room.enemyThings(team).find((t) => thingId(t) === id && room.targetable(t));

// 1斉射: ロックした全員へ perTarget 発ずつ（弾道は3種を順に、左右も交互）
function volley(room: GameRoom, p: Player, n: number) {
  for (const id of p.sk.fireMarks as string[]) {
    const t = find(room, p.team, id);
    if (!t) continue;
    const a0 = Math.atan2(t.y - p.y, t.x - p.x);
    for (let j = 0; j < S.perTarget; j++) {
      const k = n * S.perTarget + j, pat = PATTERNS[k % PATTERNS.length], side = k % 2 ? -1 : 1;
      room.ents.push({ id: room.nextId++, kind: 'missile', team: p.team, owner: p.id, x: p.x, y: p.y, r: S.r, body: null, tgt: id, pat, side, a0, a: a0, t: 0, vx: 0, vy: 0, lx: t.x, ly: t.y });
    }
  }
}

// ホーミング弾: 弾道ごとの速度で進み、狙った敵に当たったらダメージ。壁・寿命で消える。狙った敵が消えたら最後に見た位置へ
function updateMissile(room: GameRoom, e: Ent, dt: number) {
  const owner = room.players.get(e.owner), t = find(room, e.team, e.tgt);
  e.t += dt;
  if (!owner || e.t > S.life) return room.removeEnt(e);
  if (t) { e.lx = t.x; e.ly = t.y; }
  const dx = e.lx - e.x, dy = e.ly - e.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  let vx: number, vy: number;
  if (e.pat === 'spread' && e.t < S.spreadT) { const a = e.a0 + (e.side * Math.PI) / 2; vx = Math.cos(a) * S.spreadSpeed; vy = Math.sin(a) * S.spreadSpeed; } // 左右へゆっくり展開
  else if (e.pat === 'spread') { const sp = Math.min(S.maxSpeed, S.spreadSpeed + S.accel * (e.t - S.spreadT)); vx = ux * sp; vy = uy * sp; } // 徐々に加速して目標へ
  else if (e.pat === 'brake' && e.t < S.leadT) { const a = e.a0 + (e.side > 0 ? 0 : Math.PI) + e.side * S.leadAngle; vx = Math.cos(a) * S.leadSpeed; vy = Math.sin(a) * S.leadSpeed; } // 前方／後方へ偏差的に
  else if (e.pat === 'brake' && e.t < S.leadT + S.brakeT) { vx = e.vx * 0.5; vy = e.vy * 0.5; } // 急制動
  else { const sp = e.pat === 'straight' ? S.straightSpeed : S.maxSpeed; vx = ux * sp; vy = uy * sp; }
  e.vx = vx; e.vy = vy; e.a = Math.atan2(vy, vx);
  let step = Math.hypot(vx, vy) * dt;
  const sx = vx / (Math.hypot(vx, vy) || 1), sy = vy / (Math.hypot(vx, vy) || 1);
  while (step > 0) {
    const m = Math.min(8, step);
    e.x += sx * m; e.y += sy * m; step -= m;
    if (room.walls.some((w) => inRect(e.x, e.y, w))) return room.removeEnt(e);
    if (t && Math.hypot(t.x - e.x, t.y - e.y) <= t.r + e.r) { room.hitThing(owner, t, S.dmg); return room.removeEnt(e); }
  }
  if (!t && Math.hypot(e.lx - e.x, e.ly - e.y) < 8) room.removeEnt(e); // 狙った敵が消えた: 最後に見た位置で消える
}

const marksView = (room: GameRoom, p: Player) => (p.sk.marks as string[]).map((id) => find(room, p.team, id)).filter((t): t is Thing => !!t).map((t) => ({ x: t.x, y: t.y }));

const skill: Skill = {
  use(room, p) {
    if (!room.stat(p, 'lockon')) { // 1回目: ロックオン（CT はまだ）
      p.st.lockon = { until: room.now + S.lockMax, at: room.now, cancel: true, view: () => ({ marks: marksView(room, p) }) };
      Object.assign(p.sk, { marks: [], nextLock: room.now });
      return false;
    }
    // 2回目: 発射（3回に分けて）。CT はここから
    delete p.st.lockon;
    p.sk.fireMarks = p.sk.marks;
    p.sk.volleys = Array.from({ length: S.volleys }, (_, i) => room.now + i * S.volleyGap);
    p.sk.volleyN = 0;
  },
  tick(room, p) {
    const lk = p.st.lockon;
    if (lk && room.now >= lk.until) { delete p.st.lockon; p.skillReadyAt = room.now + S.ct; } // ロックの時間切れ: 撃たずに CT
    else if (lk && room.now >= p.sk.nextLock) { // 近い順に1体ずつ
      const t = candidates(room, p).find((t) => !p.sk.marks.includes(thingId(t)));
      if (t) { p.sk.marks.push(thingId(t)); p.sk.nextLock = room.now + S.lockEvery; }
    }
    while (p.sk.volleys?.length && room.now >= p.sk.volleys[0]) { p.sk.volleys.shift(); volley(room, p, p.sk.volleyN++); }
  },
  // Bot: 射程内に敵がいればロック開始。射程内の敵を全員ロックしたか1秒たったら発射
  botUse(room, p) {
    const lk = room.stat(p, 'lockon');
    if (!lk) return room.nearFoe(p, S.range, (t) => t.k === 'p' || t.k === 'boss');
    return p.sk.marks.length > 0 && (p.sk.marks.length >= candidates(room, p).length || room.now - lk.at! >= 1);
  },
  statuses: ['lockon'],
  ents: { missile: { update: updateMissile, fog: true } },
};
export default skill;
