// 四国めたん: ドリル（一定時間、前方にドリルを出しっぱなし。触れた敵にダメージ＋はじき（重いアシストには逆にめたんがはじかれる）。同じ相手には一定間隔で再ヒット）
import type { GameRoom, Player } from '../GameRoom';
import { thingId } from '../GameRoom';
import type { Skill } from './index';
import { CONFIG as C } from '../../shared/config';
import { CHARS } from '../../shared/chars';

const S = CHARS.metan.skill;

// ドリルの1tick: 向き（ドリルの長さで照準ルールに従う。対象なしは移動の向きに追従）の前方の長方形に入った敵へ、rehit 秒おきにダメージ＋はじき
function drill(room: GameRoom, p: Player) {
  if (!room.stat(p, 'drill')) return;
  const a = room.skillAim(p, S.len), next: Record<string, number> = p.sk.drillNext;
  for (const t of room.inRectAhead(p, a, S.len, S.w)) {
    const id = thingId(t);
    if (room.now < (next[id] ?? 0) || !room.reach(p, t)) continue;
    next[id] = room.now + S.rehit;
    room.hitThing(p, t, S.dmg);
    const d = Math.hypot(t.x - p.x, t.y - p.y) || 1;
    if (room.heavy(t)) room.push({ k: 'p', o: p, x: p.x, y: p.y, r: C.PLAYER_RADIUS }, (p.x - t.x) / d, (p.y - t.y) / d, S.push); // 重い相手: 逆にめたんが離れる向きへはじかれる
    else room.push(t, (t.x - p.x) / d, (t.y - p.y) / d, S.push);
  }
}

const skill: Skill = {
  use(room, p) {
    p.st.drill = { until: room.now + S.dur, noAttack: true, view: () => ({ a: room.skillAim(p, S.len) }) };
    p.sk.drillNext = {};
  },
  afterMove: (room, p) => drill(room, p),
  botUse: (room, p) => room.inRectAhead(p, room.skillAim(p, S.len), S.len, S.w).some((t) => (t.k === 'p' || t.k === 'boss') && room.targetable(t) && room.reach(p, t)),
  statuses: ['drill'],
};
export default skill;
