// e2e 専用のメッセージ（環境変数 E2E_HOOKS=1 のときだけ messages.ts が足す。refac1 で messages.ts から切り出し。中身は変えていない）
import type { Client } from 'colyseus';
import type { GameRoom } from './GameRoom';
import { CONFIG as C, isBackAt } from '../shared/config';
import { PICKABLE } from '../shared/chars';
import { pushOut } from '../shared/geom';
import { SKILLS } from './skills';
import MAP from '../shared/map.json';

const T = MAP.tileSize;

export const E2E_HANDLERS = {
  // 自キャラを敵大将の左隣へ移す
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
  e2eSlot: (room: GameRoom, _c: Client, m: { team: number; win?: boolean; pen?: boolean; reach?: boolean; chain?: number; act?: string }) => { // act: モダンの演出の種類を決める（chibi・fish・fishSp・allSpin など。verify/perfgate の場面）
    const sl = room.teams[m.team]?.slot;
    if (!sl) return;
    const ms = room.teams[m.team].m; // モダン: 次に回る保留を差し替える（pen＝転落、reach＝リーチのみの演出つき）
    if (ms) { ms.force({ outcome: m.win ? 'win' : m.pen ? 'fall' : 'miss', act: m.act ?? (m.reach ? 'plain' : null) }); return; }
    room.startSpin(m.team, m.win ? 'win' : m.pen ? 'pen' : 'miss', m.act ?? (!m.win && !m.pen ? (m.reach ? 'plain' : null) : undefined));
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
};
