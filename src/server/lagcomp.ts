// 近接AAの巻き戻し判定（ラグ補償。refac1 で GameRoom.ts から切り出し。中身は変えていない）。位置の履歴 hist・瞬間移動の記録 jumps は GameRoom に置いたまま
import type { GameRoom, Player, Thing } from './GameRoom';
import type { Pt } from '../shared/config';
import { CONFIG as C } from '../shared/config';
import { thingId } from './GameRoom';

export function noteJump(room: GameRoom, id: string, before: Pt, after: Pt, born = false) {
  if (room.phase !== 'playing' || (!born && before.x === after.x && before.y === after.y)) return;
  room.contactTick?.jumped.add(id);
  const events = room.jumps.get(id) ?? [];
  events.push({ t: room.elapsed, before: { x: before.x, y: before.y }, after: { x: after.x, y: after.y }, born });
  room.jumps.set(id, events);
}

export function recordHist(room: GameRoom) {
  for (const [id, events] of room.jumps) {
    const kept = events.filter((e) => e.t >= room.elapsed - C.NET_REWIND_MAX - 0.2);
    if (kept.length) room.jumps.set(id, kept); else room.jumps.delete(id);
  }
  const pos = new Map<string, Pt>();
  for (const p of room.players.values()) pos.set(`p:${p.id}`, { x: p.x, y: p.y });
  for (const b of room.bosses) pos.set(`boss:${b.team}`, { x: b.x, y: b.y });
  for (const c of room.couriers) pos.set(`c:${c.id}`, { x: c.x, y: c.y });
  const last = room.hist[room.hist.length - 1];
  if (last && last.t === room.elapsed) last.pos = pos; else room.hist.push({ t: room.elapsed, pos });
  while (room.hist.length > 2 && room.hist[1].t < room.elapsed - C.NET_REWIND_MAX - 0.2) room.hist.shift();
}

// 巻き戻す時刻: 人間（アシスト・Bot 以外）で、描画時刻があれば。上限 NET_REWIND_MAX
export function lagT(room: GameRoom, p: Player): number | null {
  if (p.bot || p.assist || p.viewT === undefined) return null;
  return Math.min(room.elapsed, Math.max(p.viewT, room.elapsed - C.NET_REWIND_MAX));
}

// 相手の位置を時刻 T に戻した写し（記録の間は線形補間。記録のない相手・場の物は今の位置）。o は本物なのでダメージはそのまま入る
export function rewound(room: GameRoom, things: Thing[], T: number): Thing[] {
  const h = room.hist;
  let i = h.length - 1;
  while (i > 0 && h[i - 1].t >= T) i--;
  const b = h[i], a = i > 0 ? h[i - 1] : b;
  return things.filter((t) => !(room.jumps.get(thingId(t)) ?? []).some((e) => e.born && T < e.t)).map((t) => {
    if (t.k === 'e') return t; // 場の物は従来どおり現在位置（位置履歴を持たない）
    if (h.length && T > h[h.length - 1].t) return t;
    const id = thingId(t), pa = a?.pos.get(id), pb = b?.pos.get(id);
    if (pb && T === b.t) return { ...t, x: pb.x, y: pb.y } as Thing;
    const events = (room.jumps.get(id) ?? []).filter((e) => e.t >= (a?.t ?? -Infinity) && e.t <= (T >= (b?.t ?? 0) ? room.elapsed : (b?.t ?? room.elapsed)));
    const next = events.find((e) => T < e.t), prev = events.filter((e) => e.t <= T).at(-1);
    if (next || prev) {
      const left = prev ? { t: prev.t, p: prev.after } : { t: a?.t ?? next!.t, p: pa ?? next!.before };
      const right = next ? { t: next.t, p: next.before } : { t: Math.max(b?.t ?? room.elapsed, left.t), p: pb ?? prev!.after };
      const k = right.t > left.t ? Math.max(0, Math.min(1, (T - left.t) / (right.t - left.t))) : 0;
      return { ...t, x: left.p.x + (right.p.x - left.p.x) * k, y: left.p.y + (right.p.y - left.p.y) * k } as Thing;
    }
    if (!pa || !pb || T > b.t) return t;
    const k = b.t > a.t ? Math.max(0, Math.min(1, (T - a.t) / (b.t - a.t))) : 1;
    return { ...t, x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k } as Thing;
  });
}
