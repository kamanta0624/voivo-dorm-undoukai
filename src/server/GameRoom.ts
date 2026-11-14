import { Room, Client } from 'colyseus';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG as C, Rect, Pt, visionRadius, roleOf, wallRects, roomLayout, roomKindAt, isBackAt, slotRate, penaltyRate, bossIntensity } from '../shared/config';
import { lineOfSight, inRect, moveBody, pushOut, canPlace, cage, inDashShape, circleRect } from '../shared/geom';
import { findPath } from './pathfind';
import { stepPlayer } from '../shared/netcode';
import CHARS from '../shared/chars.json';
import MAP from '../shared/map.json';

const PICKABLE = Object.entries(CHARS).filter(([k, c]) => k !== '_' && !('boss' in (c as object))).map(([k]) => k); // 大将以外
const T = C.TILE;
// マップ外周の壁（外 ' ' か地図の端に接する壁）は壊せない
const PERIMETER = MAP.tiles.map((row, y) => [...row].map((c, x) => c === '#' && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (MAP.tiles[y + dy]?.[x + dx] ?? ' ') === ' '))));

// 経路の長さ(px)
export const pathLength = (from: Pt, to: Pt, obstacles = C.WALLS, walls = C.WALLS) => {
  const path = findPath(from, to, obstacles, walls);
  if (!path.length) return Infinity;
  let len = 0, prev = from;
  for (const q of path) { len += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q; }
  return len;
};
// 大将の部屋の候補ごとの、中央（hall の中心）からの経路距離（左側。右側は鏡写しで同じ）
const hall = MAP.rooms.find((r) => r.id === 'hall')!.rect;
export const HALL_CENTER = { x: ((hall[0] + hall[2]) / 2 + 0.5) * T, y: ((hall[1] + hall[3]) / 2 + 0.5) * T };
export const ROOM_DIST: Record<string, number> = Object.fromEntries(C.BOSS_ROOM_CANDIDATES.map((n) => [n, pathLength(HALL_CENTER, roomLayout([n]).bases[0][0])]));
// 候補から BOSS_ROOM_COUNT 部屋を選ぶ全組み合わせと、距離の合計
export const ROOM_COMBOS = (function combos(list: string[], k: number): string[][] {
  if (!k) return [[]];
  return list.flatMap((n, i) => combos(list.slice(i + 1), k - 1).map((c) => [n, ...c]));
})(C.BOSS_ROOM_CANDIDATES, C.BOSS_ROOM_COUNT).map((names) => ({ names, sum: names.reduce((a, n) => a + ROOM_DIST[n], 0) }));

// 重み付きの抽選（weights の添字を返す）
export const lottery = (weights: number[], rnd = Math.random) => {
  let r = rnd() * weights.reduce((a, w) => a + w, 0);
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
  return weights.length - 1;
};
const pick = <X>(a: X[]) => a[Math.floor(Math.random() * a.length)];
const melee = (char: string) => !C.MELEE_EXCLUDE.includes(char); // 近接補正の対象

type Ult = { form: string; tier: number; until: number; pending: boolean }; // pending: 撤退中に選ばれ、復活後に始まる
type Player = {
  id: string; team: number; char: string; x: number; y: number; hp: number; alive: boolean;
  dx: number; dy: number; face: number; // face: 向き(ラジアン)
  rage: number; bad: number; // bad: 悪行ポイント（徳を下げた量の累計。倒されると0）
  cooldownUntil: number; stunUntil: number; respawnAt: number; respawnTotal: number; // respawnTotal: 撤退時間の合計
  lastHitBy: Map<string, number>;
  bot: boolean; role: 'gather' | 'raid'; path: Pt[]; pathAt: number; raidBase: number; visited: number[]; // raidBase: 見回り中の敵陣の部屋（-1=未決定）、visited: 見回り済みの部屋
  aim: string; tgt: Thing | null; // 照準モードと、今狙っている対象
  inputs: { seq: number; dx: number; dy: number }[]; ack: number; // 人間の入力待ちと、処理済みの入力番号
  skillReadyAt: number; danceUntil: number; danceNext: number; mochiUntil: number; accelUntil: number; flyUntil: number; wallCheckAt: number;
  assist: boolean; tier: number; ult: Ult | null; // assist: アシストユニット（復活しない）、tier: アシストの強さ（POWER_* の添字）
  goal: string; stuckX: number; stuckY: number; stuckSince: number; penalty: Map<string, number>; // Bot: 今の目的地、詰まり判定、避ける目的地（期限）
  qAt: number | null; recallAt: number | null; // Q を押した時刻と、リコールの溜めの開始時刻（被弾で溜め直し）
  chargeAt: number | null; chargeA: number; dashUntil: number; dashHit: Set<string>; dashBroke: boolean; // アルの突撃: タメの開始時刻、方向、突撃の終わる時刻、当てた相手、壁を壊したか
  boostUntil: number; // 白上虎太郎の移動速度上昇
  inDx: number; inDy: number; // 人間: 最後に届いた移動入力
  eating: boolean; // Bot: リコールして給湯室でご飯を食べている（HPが満タンになるまで）
  pushTile: string | null; pushAt: number; // 花丸のパッシブ: 押し込んでいる壁のタイルと、押し込み始めた時刻
  slowUntil: number; weakUntil: number; // スロットの罰: 移動速度低下・攻撃力低下
};
type Courier = { id: number; team: number; x: number; y: number; hp: number; path: Pt[]; pathAt: number; wp: number; box: string }; // ブイブイ・コバコ（中立 team=-1）。wp: 巡回経路の次の地点、box: 持っている荷物（ult / assist）
type Boss = { team: number; base: number; x: number; y: number; hp: number; dmgAtBase: number; target: string | null; cooldownUntil: number; moved: boolean; moving: boolean; shotAt: number }; // moved: 1回でも拠点移動した（第2形態）、moving: 移動の予告中（無敵）、shotAt: 第2形態の次の弾の時刻
type Slot = { start: number; reels: number[]; win: boolean; pen: boolean; chain: number; tier: number; payoutAt: number | null; holdUntil: number }; // start: 回転の開始時刻、reels: この回転の結果（陣営のキャラの添字。-1=罰の絵柄）、pen: 罰の出目、payoutAt: 次の払い出しの時刻（払い出し中だけ）
type Team = { toku: number; wanted: string | null; slot: Slot }; // toku: 徳、wanted: 指名手配中のプレイヤーid
type Warn = { id: number; team: number; owner: string; x: number; y: number; r: number; at: number; dmg: number; follow: string | null; boss?: boolean }; // アシストの範囲攻撃の予告（at に発動。follow があればその位置で発動）。boss: 大将の拠点移動前の広範囲攻撃（owner は使わない）
type Material = { id: number; x: number; y: number; hi: boolean }; // hi: 裏側に出た高ポイントの資材
type Item = { id: number; kind: string; team: number; x: number; y: number; e2e?: boolean }; // kind: heal（回復アイテム）/ box_ult / box_assist（コバコの荷物）。team は常に -1。e2e: テスト用の仕掛けで置いたもの
type Trap = { id: number; team: number; owner: string; x: number; y: number; a: number; hp: number; nextAtk: number }; // bii の罠（a: 向き）
type Barricade = { id: number; team: number; x: number; y: number; w: number; h: number; hp: number };
type Funnel = { id: number; team: number; owner: string; x: number; y: number; hp: number; until: number; nextAtk: number; slot: number; tgt: string | null; path: Pt[]; retargetAt: number }; // slot: 対象を囲む位置の角度
type Shot = { id: number; kind: 'bullet' | 'arrow' | 'cannon'; team: number; owner: string; x: number; y: number; vx: number; vy: number; sp: number; left: number; dmg: number; boom?: number }; // boom: 大将の弾（着弾地点で半径 boom の爆発。owner は使わない）
type Fist = { id: number; team: number; owner: string; x: number; y: number; a: number; left: number; hit: Set<string>; broke: boolean }; // 花丸の巨大拳（a: 向き、left: 残りの距離、hit: 当てた相手、broke: 壁を壊したか）
type Fx = { id: number; kind: string; team: number; x: number; y: number; [k: string]: any };
// 攻撃・技の対象（敵プレイヤー・大将・ファンネル・バリケード・罠）
type Thing =
  | { k: 'p'; o: Player; x: number; y: number; r: number }
  | { k: 'boss'; o: Boss; x: number; y: number; r: number }
  | { k: 'f'; o: Funnel; x: number; y: number; r: number }
  | { k: 'bar'; o: Barricade; x: number; y: number; r: number }
  | { k: 'trap'; o: Trap; x: number; y: number; r: number }
  | { k: 'c'; o: Courier; x: number; y: number; r: number };
const thingId = (t: Thing) => (t.k === 'p' ? `p:${t.o.id}` : t.k === 'boss' ? `boss:${t.o.team}` : `${t.k}:${t.o.id}`);
const S = C.SKILLS;
const K = C.KIRITAN;

export class GameRoom extends Room {
  static logFile = ''; // 試合ログの出力先（JSON Lines、空なら書かない）。src/server/index.ts で設定
  maxClients = C.MAX_CLIENTS;
  now = 0;
  phase: 'waiting' | 'intro' | 'countdown' | 'playing' | 'ended' = 'waiting'; // intro: 開始の演出（動けない）、countdown: 開始前のカウント（開始した部屋の中だけ動ける）
  phaseLeft = 0; // intro / countdown の残り秒数
  elapsed = 0; // スナップショットの時刻（試合の前後も進む。他キャラの補間の時計合わせに使う）
  timeLeft = C.MATCH_TIME;
  winner = -1; // 0,1=陣営 2=引き分け
  players = new Map<string, Player>();
  owners = new Map<string, string>(); // sessionId -> 操作中のプレイヤーid（なければ観戦）
  botSeq = 0;
  bosses: Boss[] = [];
  teams: Team[] = [];
  materials: Material[] = [];
  items: Item[] = [];
  traps: Trap[] = [];
  barricades: Barricade[] = [];
  funnels: Funnel[] = [];
  shots: Shot[] = [];
  fists: Fist[] = [];
  couriers: Courier[] = []; // ブイブイ・コバコ（1体。KO中は空）
  courierAt = 0; // コバコの復活時刻
  warns: Warn[] = [];
  dropped = new Set<string>(); // 再接続待ちのプレイヤーid（途中参加の入れ替え先にしない）
  backVotes = new Set<string>(); // リザルトで「戻る」を押した人間のプレイヤーid
  fx: Fx[] = []; // このティックに起きた技のエフェクト（送信後に空にする）
  tiles = [...MAP.tiles]; // 試合中のタイル（壁破壊で変わる）
  walls = C.WALLS;
  broken: number[][] = []; // 壊れた壁のタイル [x, y]
  nextId = 1;
  materialTimer = 0;
  healAt: number[] = []; // 回復アイテムの場所ごとの再出現時刻（-1=置いてある）
  bossRooms: string[] = []; // この試合の大将の部屋（左右で同じ名前）。大将の出現・逃亡先
  bases: Pt[][] = [];
  homes: Rect[][] = [];
  speed = 1; // e2e の早送り倍率（E2E_HOOKS のときだけ変わる）
  reveal = new Set<string>(); // e2e: 視界の制限なしで送るクライアント（E2E_HOOKS のときだけ使う）
  bossGuard = false; // e2e: Bot の攻撃では大将が減らない（E2E_HOOKS のときだけ変わる）
  slotChain: number = C.SLOT.chain; // 連チャンの確率（e2e で変えられる）
  introMess: Pt = { x: 0, y: 0 }; // 新開幕でカメラが映す「散らかったマップの一角」
  startedAt = 0; // GAME START の時刻（試合ログ用、ミリ秒）
  bossDmg = [{ player: 0, assist: 0 }, { player: 0, assist: 0 }]; // 陣営ごとの、敵大将に与えたダメージ（試合ログ用）

  messages = {
    input: (client: Client, m: { seq: number; dx: number; dy: number }) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (!p) return;
      p.inputs.push(m); // 1tickに1つずつ処理する（クライアントの予測と同じ刻み）
      p.inDx = m.dx; p.inDy = m.dy; // 最後に届いた移動入力（アルの突撃の方向に使う）
      if (p.inputs.length > C.NET_QUEUE_MAX) p.inputs.shift();
    },
    attack: (client: Client) => {
      const id = this.owners.get(client.sessionId);
      if (id) this.attack(id);
    },
    place: (client: Client) => {
      const id = this.owners.get(client.sessionId);
      if (id) this.place(id);
    },
    // Q を押した: 押している間リコールを溜める
    qdown: (client: Client) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (p && this.phase === 'playing' && p.alive && p.qAt === null) p.qAt = p.recallAt = this.now;
    },
    // Q を離した: 短押しならバリケード設置、そうでなければ溜めを捨てる
    qup: (client: Client) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (!p || p.qAt === null) return;
      const tap = this.now - p.qAt < C.RECALL_TAP;
      p.qAt = p.recallAt = null;
      if (tap) this.place(p.id);
    },
    // リザルトの「戻る」
    back: (client: Client) => {
      const id = this.owners.get(client.sessionId);
      if (id && this.phase === 'ended') { this.backVotes.add(id); this.checkBack(); }
    },
    skill: (client: Client) => {
      const id = this.owners.get(client.sessionId);
      if (id) this.skill(id);
    },
    aim: (client: Client, m: { mode: string }) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (p && C.AIM_MODES.includes(m.mode)) p.aim = m.mode;
    },
    pick: (client: Client, m: { char: string }) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (p && this.phase === 'waiting' && PICKABLE.includes(m.char)) p.char = m.char;
    },
    // 待機画面で陣営を移る（満員なら移れない）
    team: (client: Client, m: { team: number }) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (!p || this.phase !== 'waiting' || (m.team !== 0 && m.team !== 1) || p.team === m.team) return;
      if ([...this.players.values()].filter((q) => q.team === m.team).length >= C.TEAM_SIZE) return;
      this.players.delete(p.id);
      this.addPlayer(p.id, m.team, false).char = p.char;
    },
    start: () => {
      if (this.phase === 'waiting') this.startMatch();
    },
    // e2e 専用（環境変数 E2E_HOOKS=1 のときだけ有効）: 自キャラを敵大将の左隣へ移す
    ...(process.env.E2E_HOOKS ? {
      e2eWarp: (client: Client) => {
        const p = this.players.get(this.owners.get(client.sessionId) ?? '');
        if (!p || !p.alive || this.phase !== 'playing') return;
        const boss = this.bosses[1 - p.team];
        Object.assign(p, { x: boss.x - (C.BOSS_RADIUS + C.PLAYER_RADIUS + 8), y: boss.y, dx: 0, dy: 0, face: 0 });
      },
      // 時間の早送り（1tickの間にサーバーの処理を k 回まわす）
      e2eSpeed: (_c: Client, m: { k: number }) => { this.speed = Math.max(1, Math.round(m.k)); },
      // 残り時間を sec 秒にする（試合終了までの待ちを省く）
      e2eTimeLeft: (_c: Client, m: { sec: number }) => { if (Number.isFinite(m.sec)) this.now = C.MATCH_TIME - m.sec; },
      // 自分の近くに資材を1個置く（資材の出現を待たずに、拾う確認をするため）
      e2eMaterial: (c: Client) => {
        const p = this.players.get(this.owners.get(c.sessionId) ?? '');
        if (p) { const q = pushOut(p.x + 40, p.y, 4, this.obstacles()); this.materials.push({ id: this.nextId++, ...q, hi: isBackAt(Math.floor(q.x / T), Math.floor(q.y / T)) }); }
      },
      // 自分の足元に回復アイテム・荷物を置く
      e2eItem: (c: Client, m: { kind: string }) => {
        const p = this.players.get(this.owners.get(c.sessionId) ?? '');
        if (p) this.items.push({ id: this.nextId++, kind: m.kind, team: -1, x: p.x + 8, y: p.y, e2e: true });
      },
      // 自分の画面に全ユニットを送る（観戦者と同じ）
      e2eReveal: (c: Client, m: { on: boolean }) => { if (m.on) this.reveal.add(c.sessionId); else this.reveal.delete(c.sessionId); },
      // 開始の演出とカウントを飛ばす
      e2eSkipIntro: () => { if (this.phase === 'intro' || this.phase === 'countdown') this.beginPlay(); },
      // 陣営 team の徳を v にする
      e2eToku: (_c: Client, m: { team: number; v: number }) => { if (this.teams[m.team]) this.teams[m.team].toku = m.v; },
      // 陣営 team のスロットを今すぐ回し直し、結果を決める（win: 当たり、reach: 2つそろい）。chain: 連チャンの確率
      e2eSlot: (_c: Client, m: { team: number; win?: boolean; pen?: boolean; reach?: boolean; chain?: number }) => {
        const sl = this.teams[m.team]?.slot;
        if (!sl) return;
        this.startSpin(m.team, m.win ? 'win' : m.pen ? 'pen' : 'miss');
        if (!m.win && m.reach) sl.reels = [0, 0, 1];
        if (m.chain !== undefined) this.slotChain = m.chain;
      },
      // 自分の陣営にアシストを召喚する（near: 自分の隣に出す）
      e2eAssist: (c: Client, m: { char: string; tier: number; dx?: number; dy?: number; ready?: boolean }) => {
        const p = this.players.get(this.owners.get(c.sessionId) ?? '');
        if (!p) return;
        const a = this.summonAssist(p.team, m.tier, m.char);
        if (m.dx !== undefined) Object.assign(a, pushOut(p.x + m.dx, p.y + (m.dy ?? 0), C.PLAYER_RADIUS, this.obstacles())); // 自分からの位置
        if (m.ready) a.skillReadyAt = this.now; // 技をすぐ使える
      },
      // 自分の悪行ポイントを v にする（指名手配の確認用）
      e2eBad: (c: Client, m: { v: number }) => { const p = this.players.get(this.owners.get(c.sessionId) ?? ''); if (p) p.bad = m.v; },
      // 自キャラを (x, y) へ移す
      e2eTeleport: (c: Client, m: { x: number; y: number }) => { const p = this.players.get(this.owners.get(c.sessionId) ?? ''); if (p?.alive) Object.assign(p, pushOut(m.x, m.y, C.PLAYER_RADIUS, this.obstacles()), { dx: 0, dy: 0 }); },
      // 自キャラのキャラを変える（花丸の確認用）
      e2eChar: (c: Client, m: { char: string }) => { const p = this.players.get(this.owners.get(c.sessionId) ?? ''); if (p && PICKABLE.includes(m.char)) { p.char = m.char; p.hp = this.maxHp(p); } },
      // 自キャラの技のクールタイムを明ける
      e2eReady: (c: Client) => { const p = this.players.get(this.owners.get(c.sessionId) ?? ''); if (p) p.skillReadyAt = this.now; },
      // コバコを自分の近くに出す（dist: 自分からの距離）
      e2eCourier: (c: Client, m: { dist?: number; box?: string }) => {
        const p = this.players.get(this.owners.get(c.sessionId) ?? '');
        if (!p) return;
        if (!this.couriers.length) this.spawnCourier();
        Object.assign(this.couriers[0], pushOut(p.x + (m.dist ?? 40), p.y, C.PLAYER_RADIUS, this.obstacles()), m.box ? { box: m.box } : {});
      },
      // Bot の攻撃で大将が減らないようにする（人間の確認の途中で試合が決着しないように）
      e2eBossGuard: (_c: Client, m: { on: boolean }) => { this.bossGuard = m.on; },
      // 敵大将に、拠点移動が起きるだけのダメージを与える（拠点移動・第2形態の確認用）
      e2eBossMove: (c: Client) => {
        const p = this.players.get(this.owners.get(c.sessionId) ?? '');
        if (p && this.phase === 'playing') { const b = this.bosses[1 - p.team]; this.damageBoss(b, Math.max(1, C.BOSS_MOVE_THRESHOLD - b.dmgAtBase), p); }
      },
      // 自キャラを撤退させる
      e2eKill: (c: Client) => {
        const p = this.players.get(this.owners.get(c.sessionId) ?? '');
        if (p) this.damagePlayer(p, 1e9, null);
      },
    } : {}),
  };

  // 人間・Bot共通の操作経路
  setInput(id: string, dx: number, dy: number) {
    const p = this.players.get(id);
    if (!p) return;
    const len = Math.hypot(dx, dy);
    p.dx = len > 0 ? dx / len : 0;
    p.dy = len > 0 ? dy / len : 0;
    if (len > 0) p.face = Math.atan2(p.dy, p.dx);
  }

  // 大将の部屋を決める（その試合の出現・逃亡先と自宅）
  setBossRooms(names: string[]) {
    this.bossRooms = names;
    ({ bases: this.bases, homes: this.homes } = roomLayout(names));
  }

  // 現在の試合: 中央からの経路距離の合計が上限以下になる組み合わせから選ぶ
  onCreate(_options?: { e2e?: boolean }) {
    this.setup();
    this.setSimulationInterval((dtMs) => { for (let i = 0; i < this.speed; i++) this.tick(dtMs / 1000, i === this.speed - 1); }, 1000 / C.TICK_HZ);
  }

  // 試合の初期状態（部屋を作ったときと、リザルトから待機画面に戻ったとき）
  setup() {
    Object.assign(this, { now: 0, phase: 'waiting', phaseLeft: 0, timeLeft: C.MATCH_TIME, winner: -1, bosses: [], teams: [], materials: [], items: [], traps: [], barricades: [], funnels: [], shots: [], fists: [], couriers: [], courierAt: 0, warns: [], fx: [], tiles: [...MAP.tiles], walls: C.WALLS, broken: [], materialTimer: 0, healAt: [] });
    this.backVotes.clear();
    this.bossDmg = [{ player: 0, assist: 0 }, { player: 0, assist: 0 }];
    this.setBossRooms(pick(ROOM_COMBOS.filter((c) => c.sum <= C.BOSS_ROOM_DIST_SUM_MAX)).names);
    for (let t = 0; t < 2; t++) {
      const base = Math.floor(Math.random() * this.bases[t].length); // 候補部屋からランダムに出現
      const b = this.bases[t][base];
      this.bosses.push({ team: t, base, x: b.x, y: b.y, hp: C.BOSS_HP, dmgAtBase: 0, target: null, cooldownUntil: 0, moved: false, moving: false, shotAt: 0 });
      this.teams.push({ toku: C.TOKU_INIT, wanted: null, slot: { start: 0, reels: [0, 1, 2], win: false, pen: false, chain: 0, tier: 0, payoutAt: null, holdUntil: 0 } });
    }
  }

  // 人間全員が「戻る」を押したら（Botは押した扱い）待機画面へ。Botは消し、人間は陣営と選んだキャラのまま
  checkBack() {
    const list = [...this.players.values()].filter((p) => !p.assist);
    if (this.phase !== 'ended' || !list.every((p) => p.bot || this.backVotes.has(p.id))) return;
    const humans = list.filter((p) => !p.bot);
    this.players.clear();
    this.setup();
    for (const h of humans) this.addPlayer(h.id, h.team, false).char = h.char;
    this.unlock();
  }

  // 最大HP（ロール、ウルト中は変身先、アシストは強さの倍率）
  maxHp(p: Player) {
    if (p.assist) return C.PLAYER_HP * C.ASSIST.hp * C.POWER_MULT[p.tier];
    let hp = C.PLAYER_HP * (roleOf(p.char)?.hp ?? 1);
    if (melee(p.char)) hp *= C.MELEE_BONUS.hp;
    if (p.ult && !p.ult.pending) hp *= C.ULT_FORMS[p.ult.form].hp * C.POWER_MULT[p.ult.tier];
    return hp;
  }

  addPlayer(id: string, team: number, bot: boolean) {
    const idx = [...this.players.values()].filter((p) => p.team === team).length;
    const s = C.SPAWNS[team];
    const p: Player = {
      id, team, char: pick(PICKABLE), x: s.x, y: s.y + (idx - 1.5) * 40, hp: C.PLAYER_HP, alive: true,
      dx: 0, dy: 0, face: team === 0 ? 0 : Math.PI, rage: 0, bad: 0,
      cooldownUntil: 0, stunUntil: 0, respawnAt: 0, respawnTotal: 0, lastHitBy: new Map(),
      bot, role: 'gather', path: [], pathAt: -Infinity, raidBase: -1, visited: [],
      aim: bot ? C.BOT_AIM : C.AIM_MODES[0], tgt: null, inputs: [], ack: 0,
      skillReadyAt: 0, danceUntil: 0, danceNext: 0, mochiUntil: 0, accelUntil: 0, flyUntil: 0, wallCheckAt: 0,
      assist: false, tier: 1, ult: null,
      goal: '', stuckX: 0, stuckY: 0, stuckSince: 0, penalty: new Map(), qAt: null, recallAt: null,
      chargeAt: null, chargeA: 0, dashUntil: 0, dashHit: new Set(), dashBroke: false, boostUntil: 0, inDx: 0, inDy: 0, slowUntil: 0, weakUntil: 0, eating: false, pushTile: null, pushAt: 0,
    };
    this.players.set(id, p);
    return p;
  }

  onJoin(client: Client) {
    if (this.phase === 'waiting') {
      if (this.players.size >= C.TEAM_SIZE * 2) return; // 観戦
      const counts = [0, 0];
      this.players.forEach((p) => counts[p.team]++);
      this.addPlayer(client.sessionId, counts[0] <= counts[1] ? 0 : 1, false);
      this.owners.set(client.sessionId, client.sessionId);
    } else if (this.phase !== 'ended') {
      // 人間の少ない陣営のBotと入れ替わる。Botがいなければ観戦
      const humans = [0, 0];
      this.players.forEach((p) => { if (!p.bot) humans[p.team]++; });
      const team = humans[0] <= humans[1] ? 0 : 1;
      const bot = [...this.players.values()].find((p) => p.team === team && p.bot && !p.assist && !this.dropped.has(p.id));
      if (bot) {
        bot.bot = false;
        bot.dx = bot.dy = 0;
        bot.aim = C.AIM_MODES[0];
        bot.inputs = []; bot.ack = 0;
        bot.qAt = bot.recallAt = null;
        this.owners.set(client.sessionId, bot.id);
      }
    }
  }

  // 通信が切れた（スマホのバックグラウンド等）: RECONNECT_SEC 秒は再接続を待つ。待つ間は Bot が代わりに動かす。待ちきれなければ onLeave
  onDrop(client: Client) {
    const p = this.players.get(this.owners.get(client.sessionId) ?? '');
    if (p && this.phase !== 'waiting') Object.assign(p, { bot: true, path: [], aim: C.BOT_AIM, qAt: null, recallAt: null });
    if (p) this.dropped.add(p.id);
    this.allowReconnection(client, C.RECONNECT_SEC);
  }

  // 再接続できた: 操作を本人に戻す（照準モードはクライアントが送り直す）
  onReconnect(client: Client) {
    const p = this.players.get(this.owners.get(client.sessionId) ?? '');
    if (p) { Object.assign(p, { bot: false, dx: 0, dy: 0 }); this.dropped.delete(p.id); }
  }

  onLeave(client: Client) {
    const id = this.owners.get(client.sessionId);
    this.owners.delete(client.sessionId);
    if (!id) return;
    this.dropped.delete(id);
    if (this.phase === 'waiting') this.players.delete(id);
    else {
      const p = this.players.get(id);
      if (p) { p.bot = true; p.path = []; p.aim = C.BOT_AIM; p.qAt = p.recallAt = null; }
      this.checkBack();
    }
  }

  startMatch() {
    for (let t = 0; t < 2; t++) {
      while ([...this.players.values()].filter((p) => p.team === t).length < C.TEAM_SIZE) this.addPlayer(`bot${++this.botSeq}`, t, true);
      [...this.players.values()].filter((p) => p.team === t).forEach((p, i) => (p.role = i % 2 === 0 ? 'gather' : 'raid'));
    }
    for (const p of this.players.values()) p.hp = this.maxHp(p); // キャラ確定後にロールのHPを反映
    // 開始演出: 各陣営を開始した部屋（study）に横並びにする
    for (let t = 0; t < 2; t++) {
      const r = C.START_ROOMS[t], list = [...this.players.values()].filter((p) => p.team === t);
      list.forEach((p, i) => Object.assign(p, { x: r.x + r.w / 2 + (i - (list.length - 1) / 2) * C.INTRO_GAP, y: r.y + r.h / 2 }));
    }
    this.phase = 'intro';
    this.phaseLeft = C.INTRO_MODE === 'old' ? C.INTRO_LINEUP + C.TEAM_SIZE * C.INTRO_CUTIN : C.INTRO2.cuts.reduce((a, [, t]) => a + t, 0);
    // 徳の初期値（キャラごとの補正を足す）、資材、コバコ、スロット
    this.teams.forEach((t, i) => (t.toku = this.clampToku(C.TOKU_INIT + [...this.players.values()].filter((p) => p.team === i).reduce((a, p) => a + (C.TOKU_CHAR[p.char] ?? 0), 0))));
    while (this.materials.length < C.MATERIAL_MAX) this.spawnMaterial();
    for (const [x, y] of C.HEAL_SPOTS) this.items.push({ id: this.nextId++, kind: 'heal', team: -1, x, y }); // ご飯は最初から置いておく
    this.spawnCourier();
    // 新開幕の「散らかったマップの一角」: 資材が一番多く集まっている場所
    const dense = (m: Pt) => this.materials.filter((q) => Math.hypot(q.x - m.x, q.y - m.y) <= C.INTRO2.messR).length;
    const best = [...this.materials].sort((u, v) => dense(v) - dense(u))[0];
    this.introMess = best ? { x: best.x, y: best.y } : { x: C.MAP_W / 2, y: C.MAP_H / 2 };
  }

  // カウント0（GAME START）: 部屋から出られるようになり、試合時間を数え始める
  beginPlay() {
    this.phase = 'playing';
    this.startedAt = Date.now();
    this.phaseLeft = 0;
    this.teams.forEach((_, i) => this.startSpin(i)); // スロットは GAME START から回す
  }

  // 出られない部屋: 開始前のカウント中は開始した部屋、終了後は自陣の大将が最後にいた部屋
  cageOf(p: Player): Rect | null {
    if (this.phase === 'countdown') return C.START_ROOMS[p.team];
    if (this.phase === 'ended') return this.homes[p.team][this.bosses[p.team].base];
    return null;
  }

  // 試合の前後: 人間の入力だけ処理する（演出中は動けない。カウント中と終了後は部屋の中だけ動ける）
  moveHumans() {
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const c = this.cageOf(p), obs = c && [...this.obstacles(), ...cage(c)];
      for (let i = p.inputs.length > C.NET_CATCHUP ? 2 : 1; i > 0 && p.inputs.length; i--) {
        const m = p.inputs.shift()!;
        if (obs && p.alive && p.chargeAt === null && this.now >= p.dashUntil) { this.setInput(p.id, m.dx, m.dy); Object.assign(p, stepPlayer(p.x, p.y, m.dx, m.dy, this.speedOf(p), obs)); }
        p.ack = m.seq;
      }
    }
  }

  // 新開幕のカウント中: Botも目的地へ動き出す（開始した部屋からは出られない）
  moveBotsCaged(dt: number) {
    const obs = this.obstacles();
    for (const p of this.players.values()) {
      if (!p.bot || !p.alive) continue;
      this.botThink(p, obs);
      const sp = this.speedOf(p) * dt;
      Object.assign(p, moveBody(p.x, p.y, p.dx * sp, p.dy * sp, C.PLAYER_RADIUS, [...obs, ...cage(C.START_ROOMS[p.team])]));
    }
  }

  obstacles(): Rect[] {
    return [...this.walls, ...this.barricades];
  }

  tick(dt: number, send = true) {
    if (send) this.elapsed += dt; // 早送り中も実時間で進める
    if (this.phase === 'intro' || this.phase === 'countdown') {
      this.phaseLeft -= dt;
      if (this.phase === 'intro' && this.phaseLeft <= 0) { this.phase = 'countdown'; this.phaseLeft += C.INTRO_MODE === 'old' ? C.COUNTDOWN : C.INTRO2.count; }
      else if (this.phase === 'countdown' && this.phaseLeft <= 0) this.beginPlay();
    }
    if (this.phase === 'intro' || this.phase === 'countdown' || this.phase === 'ended') this.moveHumans();
    if (this.phase === 'countdown' && C.INTRO_MODE !== 'old') this.moveBotsCaged(dt);
    if (this.phase === 'ended') this.updateEnded(dt);
    if (this.phase === 'playing') {
      this.now += dt;
      this.timeLeft = Math.max(0, C.MATCH_TIME - this.now);
      this.updateBots();
      this.updatePlayers(dt);
      this.updateShots(dt);
      this.updateFists(dt);
      this.updateFunnels(dt);
      this.updateTraps(dt);
      this.unstick();
      this.updateBosses();
      this.updateMaterials(dt);
      this.updateHealItems();
      this.updateCouriers(dt);
      this.updateAssists();
      this.updateWarns();
      this.updateWanted();
      this.updateReflect(dt);
      this.updateSlots();
      if (this.timeLeft <= 0) {
        const r = this.bosses.map((b) => b.hp / C.BOSS_HP);
        this.endMatch(r[0] > r[1] ? 0 : r[1] > r[0] ? 1 : 2, 'timeout');
      }
    }
    if (!send) return; // 早送り中は最後の1回だけ送る
    this.sendSnapshots();
    this.fx = [];
  }

  // 結果画面: 技（R）の見た目だけ進める（ダメージ・徳・壁の破壊は起きない。部屋から出られないのは今のまま）
  updateEnded(dt: number) {
    this.now += dt;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.chargeAt !== null && this.now - p.chargeAt >= S.aru.windup) Object.assign(p, { chargeAt: null, dashUntil: this.now + S.aru.dur, dashHit: new Set(), dashBroke: false });
      if (this.now < p.dashUntil) this.dashStep(p, dt);
      if (this.now < p.danceUntil && this.now >= p.danceNext) { p.danceNext += S.sayo.every; this.addFx(p, 'ring', { r: S.sayo.r }); }
    }
    this.updateShots(dt);
    this.updateFists(dt);
    this.updateFunnels(dt);
    this.updateTraps(dt);
  }

  // 保険: 壁・バリケードと重なっているキャラ・大将・ファンネルを最寄りの空き位置へ押し出す
  unstick() {
    const obs = this.obstacles();
    for (const p of this.players.values()) if (p.alive) Object.assign(p, pushOut(p.x, p.y, C.PLAYER_RADIUS, obs));
    for (const b of this.bosses) Object.assign(b, pushOut(b.x, b.y, C.BOSS_RADIUS, obs));
    for (const f of this.funnels) Object.assign(f, pushOut(f.x, f.y, S.mochiko.radius, obs));
  }

  endMatch(winner: number, kind: 'boss' | 'timeout' = 'timeout') {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.winner = winner;
    this.writeLog(kind);
    // 各陣営の全員を、自陣の大将が最後にいた部屋に集める（倒れていた人も戻す）
    for (const t of [0, 1]) {
      const r = this.cageOf({ team: t } as Player)!, list = [...this.players.values()].filter((p) => p.team === t);
      list.forEach((p, i) => {
        const x = r.x + r.w / 2 + ((i % 4) - 1.5) * 28, y = r.y + r.h / 2 + C.BOSS_RADIUS + 20 + Math.floor(i / 4) * 28;
        Object.assign(p, { alive: true, dx: 0, dy: 0, chargeAt: null, dashUntil: 0 }, pushOut(Math.max(r.x + 12, Math.min(r.x + r.w - 12, x)), Math.min(r.y + r.h - 12, y), C.PLAYER_RADIUS, this.obstacles()));
        p.hp = this.maxHp(p);
      });
    }
    this.lock();
  }

  // 試合ログ: 1試合1行。kind: boss=大将撃破、timeout=時間切れ（winner 2 は引き分け）
  writeLog(kind: string) {
    if (!GameRoom.logFile || !this.startedAt) return;
    const end = Date.now(), r = (n: number) => Math.round(n * 10) / 10;
    const line = {
      start: new Date(this.startedAt).toISOString(), end: new Date(end).toISOString(), sec: Math.round((end - this.startedAt) / 1000),
      winner: this.winner, kind,
      teams: [0, 1].map((t) => ({
        members: [...this.players.values()].filter((p) => p.team === t && !p.assist).map((p) => ({ char: p.char, human: !p.bot || this.dropped.has(p.id) })),
        bossDmg: { player: r(this.bossDmg[t].player), assist: r(this.bossDmg[t].assist) },
      })),
    };
    mkdirSync(dirname(GameRoom.logFile), { recursive: true });
    appendFileSync(GameRoom.logFile, JSON.stringify(line) + '\n');
    this.startedAt = 0;
  }

  // 陣営の人間のクライアントへ通知
  notice(team: number, text: string) {
    for (const c of this.clients) if (this.players.get(this.owners.get(c.sessionId) ?? '')?.team === team) c.send('notice', { text });
  }

  // 移動速度（ロール・技・ウルトの効果込み）
  speedOf(p: Player) {
    const slow = this.now < p.slowUntil ? C.SLOT.penalty.slow : 1; // スロットの罰
    if (p.assist) return C.PLAYER_SPEED * C.ASSIST.speed * slow * (this.now < p.boostUntil ? C.ASSIST.units.shirakami.boost : 1);
    const role = roleOf(p.char);
    let sp = C.PLAYER_SPEED * (role?.speed ?? 1);
    if (melee(p.char)) sp *= C.MELEE_BONUS.speed;
    if (p.char === 'kiritan') sp *= K.speed; // きりたんは足が遅い
    if (this.now < p.boostUntil) sp *= C.ASSIST.units.shirakami.boost;
    sp *= slow;
    if (this.now < p.danceUntil) sp *= S.sayo.speed;
    if (this.now < p.accelUntil) sp *= S.ierutan.speed;
    if (this.now < p.mochiUntil) sp *= S.zunko.speed;
    if (this.now < p.flyUntil) sp *= S.kiritan.speed;
    if (p.ult && !p.ult.pending) sp *= C.ULT_FORMS[p.ult.form].speed;
    return sp;
  }

  updatePlayers(dt: number) {
    const obs = this.obstacles();
    for (const p of this.players.values()) {
      if (!p.alive) {
        while (p.inputs.length) p.ack = p.inputs.shift()!.seq; // 倒れている間の入力は捨てる
        if (this.now >= p.respawnAt) this.respawn(p);
        continue;
      }
      const locked = p.chargeAt !== null || this.now < p.dashUntil; // アルの突撃: タメ中・突撃中は通常の移動をしない
      const px = p.x, py = p.y; // 花丸のパッシブ（押し込み）の判定用
      if (!p.bot) {
        // 人間: 届いた入力を1tickに1つ（溜まっていれば2つ）、クライアントと同じ計算で処理
        p.dx = p.dy = 0;
        for (let i = p.inputs.length > C.NET_CATCHUP ? 2 : 1; i > 0 && p.inputs.length; i--) {
          const m = p.inputs.shift()!;
          this.setInput(p.id, m.dx, m.dy);
          if (this.now >= p.stunUntil && !locked) Object.assign(p, stepPlayer(p.x, p.y, m.dx, m.dy, this.speedOf(p), obs));
          p.ack = m.seq;
        }
      } else if (this.now >= p.stunUntil && !locked) {
        const sp = this.speedOf(p) * dt;
        Object.assign(p, moveBody(p.x, p.y, p.dx * sp, p.dy * sp, C.PLAYER_RADIUS, obs));
      }
      if (!locked && this.now >= p.stunUntil) this.hanamaruPush(p, px, py);
      // アルの突撃: タメが終わったら突撃を始め、突撃中は決めた方向へ進み続ける
      if (p.chargeAt !== null && this.now - p.chargeAt >= S.aru.windup) Object.assign(p, { chargeAt: null, dashUntil: this.now + S.aru.dur, dashHit: new Set(), dashBroke: false });
      if (this.now < p.dashUntil) this.dashStep(p, dt);
      if (!p.assist) {
        // 資材は触れると拾う（持ち運ばない。徳が上がる）
        for (const m of [...this.materials]) {
          if (Math.hypot(m.x - p.x, m.y - p.y) > C.MATERIAL_TOUCH) continue;
          this.materials = this.materials.filter((x) => x !== m);
          this.addToku(p.team, p, m.hi ? 'materialBack' : 'material', this.flavor(m));
        }
        // 回復アイテム・荷物も触れるだけで拾う
        for (const it of [...this.items]) if (Math.hypot(it.x - p.x, it.y - p.y) <= C.MATERIAL_TOUCH) this.takeItem(p, it);
      }
      // リコール: 溜まったら自陣の給湯室へワープ（Bot はそこでご飯を食べて回復する）
      if (p.recallAt !== null && this.now - p.recallAt >= C.RECALL_HOLD) {
        const r = C.RECALL_ROOMS[p.team];
        p.recallAt = null;
        Object.assign(p, pushOut(r.x + r.w / 2, r.y + r.h / 2, C.PLAYER_RADIUS, obs));
        this.addFx(p, 'aura', { r: 30, color: 'assist' });
        if (p.bot) p.eating = true;
      }
      // ウルトの時間切れ: 元のキャラがその場にHP100%で戻る
      if (p.ult && !p.ult.pending && this.now >= p.ult.until) this.endUlt(p);
      // 加速中は少しずつ回復（最大HPまで）
      if (this.now < p.accelUntil && p.hp < this.maxHp(p)) p.hp = Math.min(this.maxHp(p), p.hp + S.ierutan.regen * dt);
      // 疾風乱舞: 一定間隔で自分中心の円にダメージ
      if (this.now < p.danceUntil && this.now >= p.danceNext) {
        p.danceNext += S.sayo.every;
        this.inCircle(p, p.x, p.y, S.sayo.r).forEach((t) => this.hitThing(p, t, S.sayo.dmg));
        this.addFx(p, 'ring', { r: S.sayo.r });
      }
      // オートアタック: 照準モードで選んだ対象へ、クールタイムが明けたら自動で攻撃（タメ中・突撃中は攻撃しない）
      p.tgt = p.aim === 'manual' ? null : this.pickTarget(p);
      if (p.tgt && !locked && this.now >= p.cooldownUntil) this.attack(p.id, Math.atan2(p.tgt.y - p.y, p.tgt.x - p.x));
    }
  }

  // 自陣の給湯室（リコール先）にいるか
  atBase(p: Player) {
    return inRect(p.x, p.y, C.RECALL_ROOMS[p.team]);
  }

  respawn(p: Player) {
    const s = C.SPAWNS[p.team];
    if (p.ult?.pending) Object.assign(p.ult, { pending: false, until: this.now + C.ULT_DURATION }); // 撤退中に選ばれたウルトは復活後に始まる
    Object.assign(p, { alive: true, x: s.x, y: s.y, eating: false, stunUntil: 0, danceUntil: 0, mochiUntil: 0, accelUntil: 0, flyUntil: 0, recallAt: null, chargeAt: null, dashUntil: 0, boostUntil: 0 });
    p.hp = this.maxHp(p);
    p.lastHitBy.clear();
  }

  // ---- 徳・資材・回復アイテム・荷物・ウルト・アシスト ----

  clampToku(v: number) { return Math.max(C.TOKU_MIN, Math.min(C.TOKU_MAX, v)); }

  // 徳の増減（陣営の共有値）。p がいれば頭上に内容と増減を出し、下げた分は悪行ポイントに足す。アシストの行動は徳に影響しない
  addToku(team: number, p: Player | null, key: string, text = C.TOKU_TEXT[key]) {
    if (p?.assist) return;
    const d = key === 'slot' ? C.SLOT.winToku : C.TOKU[key];
    this.teams[team].toku = this.clampToku(this.teams[team].toku + d);
    if (!p) return;
    if (d < 0) p.bad -= d;
    this.addFx(p, 'toku', { text, d, hi: key === 'materialBack' });
  }

  // 資材のフレーバー: study / kitchen / 廊下 → 壁に隣接したマス → それ以外
  flavor(m: Pt) {
    const tx = Math.floor(m.x / T), ty = Math.floor(m.y / T), kind = roomKindAt(tx, ty) ?? '';
    const F = C.MATERIAL_FLAVOR;
    if (F[kind] && kind !== 'other' && kind !== 'wall') return F[kind];
    const nearWall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.tiles[ty + dy]?.[tx + dx] === '#');
    return nearWall ? F.wall : F.other;
  }

  // 資材を1個、マップのどこか（全部屋・廊下の床）に置く。MATERIAL_BACK の比率で裏側に出す（高ポイント）。ほかの資材とは重ねない
  spawnMaterial() {
    const back = Math.random() < C.MATERIAL_BACK;
    for (let i = 0; i < 200; i++) {
      const tx = Math.floor(Math.random() * MAP.width), ty = Math.floor(Math.random() * MAP.height);
      if (this.tiles[ty]?.[tx] !== '.' || roomKindAt(tx, ty) === null || isBackAt(tx, ty) !== back) continue;
      const x = tx * T + T / 2, y = ty * T + T / 2;
      if (this.materials.some((m) => Math.hypot(m.x - x, m.y - y) < C.MATERIAL_GAP)) continue;
      this.materials.push({ id: this.nextId++, x, y, hi: back });
      return;
    }
  }

  takeItem(p: Player, it: Item) {
    this.items = this.items.filter((x) => x !== it);
    if (it.kind === 'heal') {
      if (p.hp < this.maxHp(p)) p.hp = Math.min(this.maxHp(p), p.hp + C.HEAL_ITEM_AMOUNT);
      this.addFx(p, 'aura', { r: 24, color: 'heal' });
      this.addToku(p.team, p, 'eat'); // 盗み食い
    } else if (it.kind === 'box_ult') this.giveUlt(p, lottery(C.POWER_WEIGHTS)); // 拾った本人が変身
    else if (it.kind === 'box_assist') this.summonAssist(p.team, lottery(C.POWER_WEIGHTS)); // 拾った陣営にアシスト
  }

  // アシストを召喚: 3人からランダム。召喚した陣営の大将の所に現れ、敵大将へ向かう。両陣営に通知
  summonAssist(team: number, tier: number, char = pick(Object.keys(C.ASSIST.units))) {
    // 同時に出せる数を超える召喚は、今のアシストの強化: 強さを1段階上げ（上限あり）、HPを新しい最大値まで回復
    const cur = [...this.players.values()].filter((q) => q.assist && q.team === team && q.alive);
    if (cur.length >= C.ASSIST.max) {
      const a = cur[0];
      a.tier = Math.min(C.POWER_TIERS.length - 1, a.tier + 1);
      a.hp = this.maxHp(a);
      for (const c of this.clients) c.send('assistUp', { char: a.char, tier: a.tier, team }); // 両陣営に通知
      this.addFx(a, 'aura', { r: 40, color: 'assist' });
      return a;
    }
    const boss = this.bosses[team];
    const a = this.addPlayer(`assist${this.nextId++}`, team, true);
    Object.assign(a, { char, assist: true, tier, role: 'raid', aim: C.BOT_AIM, x: boss.x + C.BOSS_RADIUS + C.PLAYER_RADIUS + 4, y: boss.y, skillReadyAt: this.now + C.ASSIST.units[char].every });
    Object.assign(a, pushOut(a.x, a.y, C.PLAYER_RADIUS, this.obstacles()));
    a.hp = this.maxHp(a);
    for (const c of this.clients) c.send('assist', { char, tier, team }); // 両陣営に通知
    this.addFx(a, 'aura', { r: 40, color: 'assist' });
    return a;
  }

  // ウルト: 変身先はランダム。変身中なら効果時間だけリセット。撤退中なら復活後に始まる
  giveUlt(q: Player, tier: number) {
    if (q.ult) { q.ult.until = this.now + C.ULT_DURATION; return; }
    q.ult = { form: pick(Object.keys(C.ULT_FORMS)), tier, until: this.now + C.ULT_DURATION, pending: !q.alive };
    if (q.alive) { q.hp = this.maxHp(q); this.addFx(q, 'aura', { r: 50, color: 'ult' }); }
  }

  // ブイブイ・コバコ: マップ中央下部に出て、荷物を1つ持って巡回を始める
  spawnCourier() {
    const s = C.COURIER_START, box = Object.keys(C.COURIER.box)[lottery(Object.values(C.COURIER.box))];
    this.couriers = [{ id: this.nextId++, team: -1, x: s.x, y: s.y, hp: 1, path: [], pathAt: -Infinity, wp: 0, box }];
    const near = C.COURIER_ROUTE.map((q, i) => ({ i, d: Math.hypot(q.x - s.x, q.y - s.y) })).sort((u, v) => u.d - v.d)[0];
    this.couriers[0].wp = near.i;
  }

  // コバコ: 巡回経路（全部屋）を順に回る。KO中は復活を待つ
  updateCouriers(dt: number) {
    if (!this.couriers.length) { if (this.now >= this.courierAt) this.spawnCourier(); return; }
    const c = this.couriers[0], obs = this.obstacles(), to = C.COURIER_ROUTE[c.wp];
    if (Math.hypot(to.x - c.x, to.y - c.y) < C.COURIER.reach) { c.wp = (c.wp + 1) % C.COURIER_ROUTE.length; c.path = []; return; }
    if (this.now - c.pathAt >= C.BOT_REPATH || !c.path.length) { c.path = findPath(c, to, obs, this.walls); c.pathAt = this.now; }
    while (c.path.length && Math.hypot(c.path[0].x - c.x, c.path[0].y - c.y) < 6) c.path.shift();
    if (!c.path.length && Math.hypot(to.x - c.x, to.y - c.y) > C.COURIER.reach && findPath(c, to, obs, this.walls).length === 0) { c.wp = (c.wp + 1) % C.COURIER_ROUTE.length; return; } // 行けない地点は飛ばす
    const n = c.path[0] ?? to, d = Math.hypot(n.x - c.x, n.y - c.y) || 1, m = Math.min(C.PLAYER_SPEED * C.COURIER.speed * dt, d);
    Object.assign(c, moveBody(c.x, c.y, ((n.x - c.x) / d) * m, ((n.y - c.y) / d) * m, C.PLAYER_RADIUS, obs));
  }

  // コバコが攻撃を受けた: 1発でKO。荷物をその場に落とし、COURIER.respawn 秒後に復活
  koCourier(c: Courier) {
    if (!this.couriers.includes(c)) return;
    this.couriers = [];
    this.courierAt = this.now + C.COURIER.respawn;
    this.items.push({ id: this.nextId++, kind: `box_${c.box}`, team: -1, x: c.x, y: c.y });
    this.addFx({ x: c.x, y: c.y, team: -1 }, 'aura', { r: 30, color: c.box });
  }

  endUlt(p: Player) {
    p.ult = null;
    p.hp = this.maxHp(p);
  }

  // 回復アイテム（ご飯）: 給湯室の各場所（HEAL_SPOTS）に、取られてから HEAL_RESPAWN 秒で再出現する（実質いくらでも食べられる）
  updateHealItems() {
    C.HEAL_SPOTS.forEach(([x, y], i) => {
      if (this.items.some((it) => it.kind === 'heal' && Math.hypot(it.x - x, it.y - y) < 8)) { this.healAt[i] = -1; return; }
      if (this.healAt[i] === undefined || this.healAt[i] < 0) this.healAt[i] = this.now + C.HEAL_RESPAWN; // 取られた: 再出現を待つ
      if (this.now >= this.healAt[i]) { this.items.push({ id: this.nextId++, kind: 'heal', team: -1, x, y }); this.healAt[i] = -1; }
    });
  }

  // 敵の攻撃対象の一覧
  enemyThings(team: number): Thing[] {
    const out: Thing[] = [];
    for (const e of this.players.values()) if (e.team !== team && e.alive) out.push({ k: 'p', o: e, x: e.x, y: e.y, r: C.PLAYER_RADIUS });
    const b = this.bosses[1 - team];
    out.push({ k: 'boss', o: b, x: b.x, y: b.y, r: C.BOSS_RADIUS });
    for (const f of this.funnels) if (f.team !== team) out.push({ k: 'f', o: f, x: f.x, y: f.y, r: S.mochiko.radius });
    for (const o of this.barricades) if (o.team !== team) out.push({ k: 'bar', o, x: o.x + o.w / 2, y: o.y + o.h / 2, r: o.w / 2 });
    for (const o of this.traps) if (o.team !== team) out.push({ k: 'trap', o, x: o.x, y: o.y, r: C.TRAP_RADIUS });
    for (const o of this.couriers) if (o.team !== team) out.push({ k: 'c', o, x: o.x, y: o.y, r: C.PLAYER_RADIUS });
    return out;
  }

  // 壁・バリケードに遮られていないか（対象のバリケード自身は除く）
  reach(p: Pt, t: Thing) {
    return lineOfSight(p.x, p.y, t.x, t.y, t.k === 'bar' ? this.obstacles().filter((o) => o !== t.o) : this.obstacles());
  }

  // 通常攻撃の射程（ウルト中は変身先、きりたんは飛行中なら包丁・普段はきりたん砲）
  atkRange(p: Player) {
    if (p.ult && !p.ult.pending) return C.ULT_FORMS[p.ult.form].range;
    if (p.char === 'kiritan') return this.now < p.flyUntil ? C.ATTACK_RANGE : K.cannonRange;
    return C.RANGED[p.char] ?? C.ATTACK_RANGE;
  }

  // 照準モードで対象を選ぶ。敵プレイヤー・大将・ファンネルを優先し、いなければバリケード・罠
  pickTarget(p: Player): Thing | null {
    const R = this.atkRange(p);
    const d = (t: Thing) => Math.hypot(t.x - p.x, t.y - p.y);
    const inRange = this.enemyThings(p.team).filter((t) => t.k !== 'c' && d(t) <= R + t.r && this.reach(p, t)); // コバコは自動では狙わない
    const units = inRange.filter((t) => t.k === 'p' || t.k === 'boss' || t.k === 'f');
    const byDist = (a: Thing[]) => [...a].sort((u, v) => d(u) - d(v))[0] ?? null;
    const wanted = this.teams[1 - p.team]?.wanted;
    if (p.assist && p.char === 'shirakami') return units.find((t) => t.k === 'boss') ?? null; // 白上虎太郎は大将だけを攻撃
    if (p.assist) { const ea = units.find((t) => t.k === 'p' && t.o.assist); if (ea) return ea; } // アシストは相手のアシストを優先
    if (p.bot && !p.assist && wanted) { const w = units.find((t) => t.k === 'p' && t.o.id === wanted); if (w) return w; } // Bot は指名手配中の敵を優先
    if (units.length) {
      if (p.aim === 'lowhp') return [...units].sort((u, v) => (u.o as any).hp - (v.o as any).hp)[0];
      if (p.aim === 'boss') return units.find((t) => t.k === 'boss') ?? byDist(units);
      return byDist(units);
    }
    return byDist(inRange);
  }

  // 技・攻撃の向き: 狙っている対象があればその方向、なければ向いている方向
  aimOf(p: Player) {
    return p.tgt ? Math.atan2(p.tgt.y - p.y, p.tgt.x - p.x) : p.face;
  }

  inArc(p: Player, tx: number, ty: number, tr: number, aim = p.face, range = C.ATTACK_RANGE, arc = C.ATTACK_ARC): boolean {
    const d = Math.hypot(tx - p.x, ty - p.y);
    if (d > range + tr) return false;
    let a = Math.atan2(ty - p.y, tx - p.x) - aim;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.abs(a) <= arc / 2;
  }

  // 通常攻撃の間隔: 遠距離（zunko、kiritan のきりたん砲）と近接（kiritan の包丁を含む）
  atkCooldown(p: Player) {
    const cannon = p.char === 'kiritan' && !(p.ult && !p.ult.pending) && this.now >= p.flyUntil && (p.tgt ? Math.hypot(p.tgt.x - p.x, p.tgt.y - p.y) > K.knifeRange : true);
    return (p.char === 'zunko' && !(p.ult && !p.ult.pending)) || cannon ? C.ATTACK_COOLDOWN_RANGED : C.ATTACK_COOLDOWN_MELEE;
  }

  attack(id: string, aim?: number) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'playing' || !p.alive || p.chargeAt !== null || this.now < p.dashUntil || this.now < p.stunUntil || this.now < p.cooldownUntil) return;
    p.cooldownUntil = this.now + this.atkCooldown(p);
    const a = aim ?? p.face;
    let dmg = C.ATTACK_DAMAGE * (roleOf(p.char)?.atk ?? 1);
    if (p.assist) dmg *= C.POWER_MULT[p.tier];
    else if (melee(p.char)) dmg *= C.MELEE_BONUS.atk;
    let range = C.ATTACK_RANGE, arc = C.ATTACK_ARC;
    if (p.ult && !p.ult.pending) {
      const f = C.ULT_FORMS[p.ult.form];
      dmg *= f.atk * C.POWER_MULT[p.ult.tier];
      if (f.ranged) return this.shoot(p, 'bullet', a, f.range, dmg);
      range = f.range; arc = f.arc;
    } else if (p.char === 'kiritan') {
      // きりたん: 対象が遠ければきりたん砲（弾速遅め・ダメージ控えめ）、近いか飛行中なら包丁
      const far = p.tgt ? Math.hypot(p.tgt.x - p.x, p.tgt.y - p.y) > K.knifeRange : true;
      if (far && this.now >= p.flyUntil) return this.shoot(p, 'cannon', a, K.cannonRange, dmg * K.cannonDmg, K.cannonSpeed);
      dmg *= K.knifeDmg;
    } else if (C.RANGED[p.char]) return this.shoot(p, 'bullet', a, C.RANGED[p.char], dmg); // 遠距離: 弾を撃つ
    for (const t of this.enemyThings(p.team)) {
      if (this.inArc(p, t.x, t.y, t.r, a, range, arc) && this.reach(p, t)) this.hitThing(p, t, dmg);
    }
  }

  // 対象にダメージ。全体の倍率、attacker の大将へ×2、壊し屋のバリケード・罠へ×3（技にも掛かる）
  hitThing(p: Player, t: Thing, base: number) {
    if (this.phase !== 'playing') return; // 結果画面の技は見た目だけ
    if (this.now < p.weakUntil) base *= C.SLOT.penalty.weak; // スロットの罰の攻撃力低下
    if (t.k === 'c') { this.addToku(p.team, p, 'courier'); return this.koCourier(t.o); } // コバコは1発でKO
    this.addToku(p.team, p, 'hit');
    let dmg = base * C.DAMAGE_MULT;
    if (t.k === 'boss' && roleOf(p.char)?.name === 'attacker') dmg *= C.ATTACKER_BOSS_MULT;
    if ((t.k === 'bar' || t.k === 'trap') && C.BREAKERS.includes(p.char)) dmg *= C.BREAKER_MULT;
    if (t.k === 'p') this.damagePlayer(t.o, dmg, p.id);
    else if (t.k === 'boss') this.damageBoss(t.o, dmg, p);
    else if (t.k === 'f') { t.o.hp -= dmg; if (t.o.hp <= 0) this.funnels = this.funnels.filter((x) => x !== t.o); }
    else if (t.k === 'bar') { t.o.hp -= dmg; if (t.o.hp <= 0) this.barricades = this.barricades.filter((x) => x !== t.o); }
    else { t.o.hp -= dmg; if (t.o.hp <= 0) this.traps = this.traps.filter((x) => x !== t.o); }
  }

  damagePlayer(v: Player, dmg: number, attacker: string | null, raw = false) {
    if (!v.alive || this.phase !== 'playing' || this.now < v.dashUntil) return; // 突撃中のアルは無敵
    // 被ダメ軽減（重なるときは掛け算）: defense / balance（近くに味方がいない）/ ウルトの変身先。raw（罰のダメージ）は軽減しない
    const role = raw ? undefined : roleOf(v.char)?.name;
    if (role === 'defense') dmg *= 1 - C.DEFENSE_CUT;
    if (role === 'balance' && ![...this.players.values()].some((a) => a !== v && a.team === v.team && a.alive && Math.hypot(a.x - v.x, a.y - v.y) <= C.BALANCE_ALONE_RADIUS)) dmg *= 1 - C.BALANCE_ALONE_CUT;
    if (v.ult && !v.ult.pending && !raw) dmg *= C.ULT_FORMS[v.ult.form].def;
    v.hp -= Math.round(dmg);
    if (v.recallAt !== null) v.recallAt = this.now; // 被弾でリコールの溜め直し
    if (attacker) v.lastHitBy.set(attacker, this.now);
    if (v.hp > 0) return;
    if (v.ult && !v.ult.pending) return this.endUlt(v); // ウルト中に撃破されたら、元のキャラがその場にHP100%で戻る
    v.alive = false;
    v.hp = 0;
    v.recallAt = null;
    v.chargeAt = null; // タメ中に倒されたら突撃は不発（CTは消費済み）
    const killer = attacker ? this.players.get(attacker) : undefined;
    if (killer && !v.assist) for (const c of this.clients) if (this.owners.get(c.sessionId) === killer.id) c.send('ko', { victimChar: v.char }); // KOカットイン用（アシストは立ち絵がないので出さない）
    for (const c of this.clients) c.send('kill', { kc: killer?.char ?? null, kt: killer?.team ?? 1 - v.team, vc: v.char, vt: v.team }); // キルログ用（kc なし＝大将の反撃）
    if (killer) killer.rage += C.RAGE_KILL;
    // 徳: 相手をKOすると下がる。指名手配中の相手なら上がる（アシストを倒したときは数えない）
    if (killer && !v.assist) this.addToku(killer.team, killer, this.teams[v.team].wanted === v.id ? 'wantedKo' : 'ko');
    v.bad = 0; // 倒されると悪行ポイントは0、指名手配も外れる
    if (this.teams[v.team].wanted === v.id) this.teams[v.team].wanted = null;
    for (const [aid, t] of v.lastHitBy) {
      const a = this.players.get(aid);
      if (a && aid !== attacker && this.now - t <= C.ASSIST_WINDOW) a.rage += C.RAGE_ASSIST;
    }
    if (v.assist) { this.players.delete(v.id); return; } // アシストは復活しない
    v.respawnTotal = Math.min(C.RESPAWN_MAX, C.RESPAWN_BASE + C.RESPAWN_COEF * v.rage);
    v.respawnAt = this.now + v.respawnTotal;
  }

  damageBoss(boss: Boss, dmg: number, p: Player) {
    if (this.phase !== 'playing' || (this.bossGuard && p.bot) || boss.moving) return; // 移動の予告中は無敵
    this.bossDmg[1 - boss.team][p.assist ? 'assist' : 'player'] += Math.min(dmg, boss.hp);
    boss.hp = Math.max(0, boss.hp - dmg);
    boss.target = p.id;
    boss.dmgAtBase += dmg;
    p.rage += dmg * C.RAGE_BOSS_DMG_COEF;
    if (boss.hp <= 0) return this.endMatch(1 - boss.team, 'boss');
    if (boss.dmgAtBase >= C.BOSS_MOVE_THRESHOLD) {
      // 無敵になり、予告のあと広範囲攻撃、それから移動（updateWarns）
      boss.moving = true;
      this.warns.push({ id: this.nextId++, team: boss.team, owner: '', x: boss.x, y: boss.y, r: C.BOSS_BLAST.r, at: this.now + C.BOSS_BLAST.warn, dmg: C.BOSS_BLAST.dmg, follow: null, boss: true });
    }
  }

  // 大将の拠点移動: 別の拠点へ。以降は第2形態
  moveBoss(boss: Boss) {
    const others = this.bases[boss.team].map((_, i) => i).filter((i) => i !== boss.base);
    boss.base = others[Math.floor(Math.random() * others.length)];
    const b = this.bases[boss.team][boss.base];
    Object.assign(boss, { x: b.x, y: b.y, dmgAtBase: 0, moving: false, moved: true });
  }

  // 大将の爆発: 陣営 team の敵プレイヤー（アシスト含む）のうち半径 r に触れるものにダメージ
  explode(team: number, x: number, y: number, r: number, dmg: number) {
    for (const q of this.players.values()) if (q.team !== team && q.alive && Math.hypot(q.x - x, q.y - y) <= r + C.PLAYER_RADIUS) this.damagePlayer(q, dmg, null);
    this.addFx({ team, x, y }, 'aura', { r, color: 'dash' });
  }

  updateBosses() {
    const obs = this.obstacles();
    for (const b of this.bosses) {
      const k = b.moved ? bossIntensity(this.now, b.hp / C.BOSS_HP) : 1; // 攻撃の激しさ（第2形態だけ）
      if (b.moved && this.now >= b.shotAt) this.bossShots(b, k, obs);
      // 近くに敵のアシストがいれば、反撃の対象はアシストを優先
      const as = [...this.players.values()].filter((q) => q.assist && q.alive && q.team !== b.team && Math.hypot(q.x - b.x, q.y - b.y) <= C.BOSS_RANGE && lineOfSight(b.x, b.y, q.x, q.y, obs)).sort((u, v) => Math.hypot(u.x - b.x, u.y - b.y) - Math.hypot(v.x - b.x, v.y - b.y))[0];
      if (as) b.target = as.id;
      if (!b.target) continue;
      const t = this.players.get(b.target);
      if (!t || !t.alive) { b.target = null; continue; }
      if (this.now < b.cooldownUntil) continue;
      if (Math.hypot(t.x - b.x, t.y - b.y) <= C.BOSS_RANGE && lineOfSight(b.x, b.y, t.x, t.y, obs)) {
        b.cooldownUntil = this.now + C.BOSS_COOLDOWN / k;
        this.damagePlayer(t, C.BOSS_DAMAGE * C.BOSS_DAMAGE_MULT * (t.assist ? C.BOSS_ASSIST_MULT : 1) * k, null); // アシストへは特に強い
      }
    }
  }

  // 第2形態の弾: 範囲内の敵全員（アシスト含む）に1体ずつ。狙った位置で爆発する
  bossShots(b: Boss, k: number, obs: Rect[]) {
    const B = C.BOSS_SHOT;
    const foes = [...this.players.values()].filter((q) => q.team !== b.team && q.alive && Math.hypot(q.x - b.x, q.y - b.y) <= B.range && lineOfSight(b.x, b.y, q.x, q.y, obs));
    if (!foes.length) return;
    b.shotAt = this.now + B.every / k;
    for (const q of foes) {
      const a = Math.atan2(q.y - b.y, q.x - b.x);
      this.shots.push({ id: this.nextId++, kind: 'bullet', team: b.team, owner: '', x: b.x, y: b.y, vx: Math.cos(a) * B.speed, vy: Math.sin(a) * B.speed, sp: B.speed, left: Math.hypot(q.x - b.x, q.y - b.y), dmg: B.dmg * k, boom: B.boom });
    }
  }

  // 資材: 足りない分を一定間隔で1個ずつ、マップのどこかに出す
  updateMaterials(dt: number) {
    this.materialTimer += dt;
    if (this.materialTimer < C.MATERIAL_SPAWN_INTERVAL) return;
    this.materialTimer = 0;
    if (this.materials.length < C.MATERIAL_MAX) this.spawnMaterial();
  }

  // 指名手配: 陣営ごとに、悪行ポイントがしきい値以上で一番多い人1人（アシストは除く）
  updateWanted() {
    this.teams.forEach((t, team) => {
      const top = [...this.players.values()].filter((p) => p.team === team && !p.assist && p.bad >= C.WANTED_MIN).sort((u, v) => v.bad - u.bad)[0];
      t.wanted = top?.id ?? null;
    });
  }

  // ---- スロット ----

  // 回転を始める。結果はこの時点で1回のくじで決める（当たり・罰の確率は徳で決まる、残りは外れ）。罰は ×××、外れは3つそろわない並び
  startSpin(team: number, result?: 'win' | 'pen' | 'miss') {
    const toku = this.teams[team].toku, u = Math.random(), pw = slotRate(toku);
    const res = result ?? (u < pw ? 'win' : u < pw + penaltyRate(toku) ? 'pen' : 'miss');
    const sl = this.teams[team].slot, n = Math.max(2, [...this.players.values()].filter((p) => p.team === team && !p.assist).length);
    const r = () => Math.floor(Math.random() * n);
    let reels: number[];
    if (res === 'win') { const k = r(); reels = [k, k, k]; }
    else if (res === 'pen') reels = [-1, -1, -1];
    else do reels = [r(), r(), r()]; while (reels[0] === reels[1] && reels[1] === reels[2]);
    Object.assign(sl, { start: this.now, reels, win: res === 'win', pen: res === 'pen', chain: 0, tier: 0, payoutAt: null, holdUntil: 0 });
  }

  // 罰: その陣営の生存者全員（アシストを除く）に、抽選した1つを掛ける。徳は変わらない。両陣営に通知
  penalty(team: number) {
    const P = C.SLOT.penalty, kind = Object.keys(P.kinds)[lottery(Object.values(P.kinds))];
    for (const q of this.players.values()) {
      if (q.team !== team || !q.alive || q.assist) continue;
      if (kind === 'dmg') this.damagePlayer(q, this.maxHp(q) * P.dmg, null, true);
      else if (kind === 'slow') q.slowUntil = this.now + P.dur;
      else q.weakUntil = this.now + P.dur;
      this.addFx(q, 'aura', { r: 26, color: `pen_${kind}` });
    }
    for (const c of this.clients) c.send('penalty', { team, kind });
  }

  // 反省中（KOされて復活待ち）の人数 n に応じて、陣営の徳が毎秒 REFLECT_TOKU × n² 上がる
  updateReflect(dt: number) {
    this.teams.forEach((t, team) => {
      const n = this.reflecting(team);
      if (n) t.toku = this.clampToku(t.toku + C.REFLECT_TOKU * n * n * dt);
    });
  }

  reflecting(team: number) {
    return [...this.players.values()].filter((p) => p.team === team && !p.assist && !p.alive).length;
  }

  // 回転が終わったら: 当たりなら徳が下がり、払い出し（連チャンは間を空けて続ける）。外れなら次の回転
  updateSlots() {
    this.teams.forEach((t, team) => {
      const sl = t.slot;
      if (sl.payoutAt === null) {
        if (this.now - sl.start < C.SLOT.spin) return;
        if (sl.holdUntil) { if (this.now >= sl.holdUntil) this.startSpin(team); return; } // 罰の出目を見せ終わったら次の回転
        if (sl.pen) { this.penalty(team); sl.holdUntil = this.now + C.SLOT.penHold; return; }
        if (!sl.win) return this.startSpin(team);
        this.addToku(team, null, 'slot');
        Object.assign(sl, { chain: 1, tier: C.SLOT.firstTier, payoutAt: this.now });
      }
      if (this.now < sl.payoutAt!) return;
      this.payout(team, sl.chain, sl.tier);
      const top = C.POWER_TIERS.length - 1;
      if (Math.random() < (sl.tier + 1 >= top ? C.SLOT.chainBreak : this.slotChain)) Object.assign(sl, { chain: sl.chain + 1, tier: Math.min(C.POWER_TIERS.length - 1, sl.tier + 1), payoutAt: this.now + C.SLOT.gap });
      else this.startSpin(team);
    });
  }

  // 払い出し: ウルト（自陣の生存者全員が変身）かアシスト召喚（1体）。両陣営にカットイン
  payout(team: number, chain: number, tier: number) {
    const kind = Object.keys(C.SLOT.payout)[lottery(Object.values(C.SLOT.payout))];
    if (kind === 'ult') for (const q of this.players.values()) { if (q.team === team && q.alive && !q.assist) this.giveUlt(q, tier); }
    else this.summonAssist(team, tier);
    for (const c of this.clients) c.send('slot', { team, chain, kind, tier });
  }

  // バリケードを置く。陣営ごとの上限を超えたら一番古いものを消す
  addBarricade(team: number, x: number, y: number) {
    const s = C.BARRICADE_SIZE;
    this.barricades.push({ id: this.nextId++, team, x: x - s / 2, y: y - s / 2, w: s, h: s, hp: C.BARRICADE_HP });
    const mine = this.barricades.filter((b) => b.team === team);
    if (mine.length > C.BARRICADE_MAX) this.barricades = this.barricades.filter((b) => b !== mine[0]);
  }

  // 位置を持つもの（キャラ・大将・ファンネル）
  bodies() {
    return [
      ...[...this.players.values()].filter((p) => p.alive).map((p) => ({ x: p.x, y: p.y, r: C.PLAYER_RADIUS })),
      ...this.bosses.map((b) => ({ x: b.x, y: b.y, r: C.BOSS_RADIUS })),
      ...this.funnels.map((f) => ({ x: f.x, y: f.y, r: S.mochiko.radius })),
    ];
  }

  // Q: 壁破壊で壊れた場所に、資材なしでバリケードを置く。キャラと重なる位置には置けない
  place(id: string) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'playing' || !p.alive) return;
    const x = p.x + Math.cos(p.face) * C.PLACE_DIST, y = p.y + Math.sin(p.face) * C.PLACE_DIST;
    if (!canPlace('barricade', x, y, this.bodies())) return;
    if (this.broken.some(([bx, by]) => bx === Math.floor(x / T) && by === Math.floor(y / T))) this.addBarricade(p.team, x, y);
  }

  // ---- 弾・ファンネル・罠 ----

  shoot(p: Player, kind: Shot['kind'], a: number, range: number, dmg: number, sp = C.BULLET_SPEED) {
    this.shots.push({ id: this.nextId++, kind, team: p.team, owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, sp, left: range, dmg });
  }

  // 弾・矢: 壁で止まり、敵（プレイヤー・大将・ファンネル・バリケード・罠）に当たると消える
  updateShots(dt: number) {
    for (const s of [...this.shots]) {
      const owner = this.players.get(s.owner);
      let step = Math.min(s.sp * dt, s.left), done = !owner && !s.boom;
      while (step > 0 && !done) {
        const d = Math.min(8, step);
        s.x += (s.vx / s.sp) * d; s.y += (s.vy / s.sp) * d; s.left -= d; step -= d;
        if (this.walls.some((w) => inRect(s.x, s.y, w))) { done = true; break; }
        const hit = this.enemyThings(s.team).find((t) => Math.hypot(t.x - s.x, t.y - s.y) <= t.r + C.BULLET_RADIUS || (t.k === 'bar' && inRect(s.x, s.y, t.o)));
        if (hit) {
          done = true;
          if (s.boom) break;
          if (s.kind !== 'arrow') this.hitThing(owner!, hit, s.dmg);
          else if (hit.k === 'p' && this.now >= hit.o.dashUntil && this.phase === 'playing') hit.o.mochiUntil = this.now + S.zunko.dur; // ずんだアロー: ずんだ餅に変える（大将・突撃中のアルには効かない）
          break;
        }
        if (this.barricades.some((b) => b.team === s.team && inRect(s.x, s.y, b))) { done = true; break; } // 味方のバリケードでも止まる
      }
      if (!(done || s.left <= 0)) continue;
      this.shots = this.shots.filter((x) => x !== s);
      if (s.boom && this.phase === 'playing') this.explode(s.team, s.x, s.y, s.boom, s.dmg); // 大将の弾: 着弾地点で爆発
    }
  }

  // 花丸の巨大拳: 直進し、キャラ（1体1回）にダメージ、壁は壊して貫通。射程を飛ぶか外周の壁に当たると消える。結果画面では壁を壊さない
  updateFists(dt: number) {
    const H = S.hanamaru;
    for (const f of [...this.fists]) {
      const owner = this.players.get(f.owner);
      let step = Math.min(H.speed * dt, f.left), gone = !owner;
      while (step > 0 && !gone) {
        const d = Math.min(8, step);
        f.x += Math.cos(f.a) * d; f.y += Math.sin(f.a) * d; f.left -= d; step -= d;
        const tiles: number[][] = [];
        for (let ty = Math.floor((f.y - H.r) / T); ty <= Math.floor((f.y + H.r) / T); ty++) for (let tx = Math.floor((f.x - H.r) / T); tx <= Math.floor((f.x + H.r) / T); tx++) {
          if (this.tiles[ty]?.[tx] !== '#' || !circleRect(f.x, f.y, H.r, { x: tx * T, y: ty * T, w: T, h: T })) continue;
          if (PERIMETER[ty]?.[tx] ?? true) gone = true; else tiles.push([tx, ty]);
        }
        if (gone) break;
        if (tiles.length && this.phase === 'playing') {
          this.breakWalls(tiles);
          this.addFx(f, 'wall', { tiles, r: 0 });
          if (!f.broke) { f.broke = true; this.addToku(f.team, owner!, 'wall'); } // 1回の技につき1回
        }
        for (const t of this.enemyThings(f.team)) {
          if ((t.k !== 'p' && t.k !== 'boss') || f.hit.has(thingId(t)) || Math.hypot(t.x - f.x, t.y - f.y) > H.r + t.r) continue;
          f.hit.add(thingId(t));
          this.hitThing(owner!, t, H.dmg);
        }
      }
      if (gone || f.left <= 0) this.fists = this.fists.filter((x) => x !== f);
    }
  }

  // 花丸のパッシブ: 壁へ押し込み続ける（移動入力の向きに壁があって進めない）と、push 秒でその壁を壊す。触れた瞬間では壊れない
  // 対象は移動を実際に止めている壁タイル（進む向きに少しずらした体と新たに重なる壁のうち、体の中心に一番近いもの）。壁の端・角に一部だけ触れていても壊せる
  hanamaruPush(p: Player, px: number, py: number) {
    const H = S.hanamaru, [ix, iy] = this.moveIntent(p);
    if (p.char !== 'hanamaru' || (!ix && !iy)) { p.pushTile = null; return; }
    const [dx, dy] = Math.abs(ix) >= Math.abs(iy) ? [Math.sign(ix), 0] : [0, Math.sign(iy)];
    const moved = dx ? Math.abs(p.x - px) : Math.abs(p.y - py), R = C.PLAYER_RADIUS, nx = p.x + dx * 4.5, ny = p.y + dy * 4.5; // 4.5: 移動の1ステップ（最大4px）より少し先
    const blockers: number[][] = [];
    for (let ty = Math.floor((ny - R) / T); ty <= Math.floor((ny + R) / T); ty++) {
      for (let tx = Math.floor((nx - R) / T); tx <= Math.floor((nx + R) / T); tx++) {
        const b = { x: tx * T, y: ty * T, w: T, h: T };
        if (this.tiles[ty]?.[tx] === '#' && !PERIMETER[ty][tx] && circleRect(nx, ny, R, b) && !circleRect(p.x, p.y, R, b)) blockers.push([tx, ty]);
      }
    }
    const hit = blockers.sort((u, v) => Math.hypot((u[0] + 0.5) * T - p.x, (u[1] + 0.5) * T - p.y) - Math.hypot((v[0] + 0.5) * T - p.x, (v[1] + 0.5) * T - p.y))[0];
    if (!hit || moved > 0.5) { p.pushTile = null; return; }
    const key = `${hit[0]},${hit[1]}`;
    if (p.pushTile !== key) { p.pushTile = key; p.pushAt = this.now; return; }
    if (this.now - p.pushAt < H.push) return;
    const tiles = this.breakTiles(p, Math.atan2(dy, dx), hit);
    p.pushTile = null;
    if (!tiles.length) return;
    this.breakWalls(tiles);
    this.addToku(p.team, p, 'wall');
    this.addFx(p, 'wall', { tiles, r: 0 });
  }

  // ファンネル: 経路で届く敵を選び、敵を囲む円周上の自分の位置へ移動 → 止まって射撃 → 次の位置へ、を繰り返す
  updateFunnels(dt: number) {
    const F = S.mochiko;
    this.funnels = this.funnels.filter((f) => this.now < f.until);
    const obs = this.obstacles();
    for (const f of this.funnels) {
      const owner = this.players.get(f.owner);
      const find = (id: string | null) => (id ? this.enemyThings(f.team).find((t) => thingId(t) === id && (t.k === 'p' || t.k === 'boss')) : undefined);
      let tgt = find(f.tgt);
      if (this.now >= f.retargetAt || !tgt) {
        f.retargetAt = this.now + F.retarget;
        // 近い順に、経路長が上限以下の敵（壁の向こうで回り道が長すぎる敵は選ばない）
        const near = this.enemyThings(f.team).filter((t) => (t.k === 'p' || t.k === 'boss') && Math.hypot(t.x - f.x, t.y - f.y) <= F.sense)
          .sort((u, v) => Math.hypot(u.x - f.x, u.y - f.y) - Math.hypot(v.x - f.x, v.y - f.y)).slice(0, 2);
        tgt = near.find((t) => pathLength(f, t, obs, this.walls) <= F.pathMax);
        f.tgt = tgt ? thingId(tgt) : null;
        const to = tgt ? { x: tgt.x + Math.cos(f.slot) * F.ring, y: tgt.y + Math.sin(f.slot) * F.ring } : owner;
        f.path = to ? findPath(f, to, obs, this.walls) : [];
      }
      const slot = tgt ? { x: tgt.x + Math.cos(f.slot) * F.ring, y: tgt.y + Math.sin(f.slot) * F.ring } : null;
      const to = slot ?? (owner?.alive ? owner : null);
      if (!to) continue;
      const stop = slot ? 3 : 40;
      if (Math.hypot(to.x - f.x, to.y - f.y) > stop) {
        // 移動中（射撃しない）: 経路の次の点、なければ目的地へ
        while (f.path.length > 1 && Math.hypot(f.path[0].x - f.x, f.path[0].y - f.y) < 6) f.path.shift();
        const n = f.path.length > 1 ? f.path[0] : to, d = Math.hypot(n.x - f.x, n.y - f.y) || 1, m = Math.min(F.speed * dt, d);
        Object.assign(f, moveBody(f.x, f.y, ((n.x - f.x) / d) * m, ((n.y - f.y) / d) * m, F.radius, obs));
      } else if (tgt && this.now >= f.nextAtk && Math.hypot(tgt.x - f.x, tgt.y - f.y) <= F.range && lineOfSight(f.x, f.y, tgt.x, tgt.y, obs)) {
        // 止まって射撃し、次の射撃位置へ回り込む
        f.nextAtk = this.now + F.every;
        if (owner) this.hitThing(owner, tgt, F.dmg);
        this.addFx(f, 'beam', { x2: tgt.x, y2: tgt.y });
        f.slot += F.slotStep;
        f.retargetAt = 0;
      }
    }
  }

  // bii の罠: 向いた方向の扇形にいる敵を一定間隔で攻撃。時間でも耐久が減る
  updateTraps(dt: number) {
    const B = S.bii;
    for (const tr of [...this.traps]) {
      const owner = this.players.get(tr.owner);
      tr.hp -= B.decay * dt;
      if (tr.hp <= 0 || !owner) { this.traps = this.traps.filter((x) => x !== tr); continue; }
      if (this.now < tr.nextAtk) continue;
      const hits = this.enemyThings(tr.team).filter((t) => (t.k === 'p' || t.k === 'boss' || t.k === 'f') && this.inArc({ ...owner, x: tr.x, y: tr.y }, t.x, t.y, t.r, tr.a, B.range, B.arc) && lineOfSight(tr.x, tr.y, t.x, t.y, this.obstacles()));
      if (!hits.length) continue;
      tr.nextAtk = this.now + B.every;
      hits.forEach((t) => this.hitThing(owner, t, B.dmg));
      this.addFx(tr, 'arc', { a: tr.a, r: B.range, arc: B.arc, color: 'trap' });
    }
  }

  // ---- キャラ技（R） ----

  addFx(p: Pt & { team: number }, kind: string, extra: Record<string, any>) {
    this.fx.push({ id: this.nextId++, kind, team: p.team, x: p.x, y: p.y, ...extra });
  }

  inCircle(p: Player, x: number, y: number, r: number) {
    return this.enemyThings(p.team).filter((t) => Math.hypot(t.x - x, t.y - y) <= r + t.r);
  }

  // 前方の長方形（長さ len、幅 w）に入る敵
  inRectAhead(p: Player, a: number, len: number, w: number) {
    const ux = Math.cos(a), uy = Math.sin(a);
    return this.enemyThings(p.team).filter((t) => {
      const rx = t.x - p.x, ry = t.y - p.y, along = rx * ux + ry * uy, side = Math.abs(-rx * uy + ry * ux);
      return along >= -t.r && along <= len + t.r && side <= w / 2 + t.r;
    });
  }

  // はじき: 向き(ux,uy)へ dist 動かす。大将・構造物には効かない。壁・バリケードで止まる
  push(t: Thing, ux: number, uy: number, dist: number) {
    if (t.k !== 'p' && t.k !== 'f') return;
    if (t.k === 'p' && this.now < t.o.dashUntil) return; // 突撃中のアルははじかれない
    Object.assign(t.o, moveBody(t.o.x, t.o.y, ux * dist, uy * dist, t.k === 'p' ? C.PLAYER_RADIUS : S.mochiko.radius, this.obstacles(), false));
  }

  // hanamaru: 前方の壁（幅 w × 奥行 d タイル）。外周の壁は除く
  // from: 壊し始める壁タイル（なければ p の正面 reach マス以内の最初の壁）
  breakTiles(p: Pt, a: number, from?: number[]): number[][] {
    const H = S.hanamaru;
    const [dx, dy] = Math.abs(Math.cos(a)) >= Math.abs(Math.sin(a)) ? [Math.sign(Math.cos(a)), 0] : [0, Math.sign(Math.sin(a))];
    let sx: number, sy: number;
    if (from) [sx, sy] = from;
    else {
      const tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
      let k = 1;
      while (k <= H.reach && this.tiles[ty + dy * k]?.[tx + dx * k] !== '#') k++;
      if (k > H.reach) return [];
      sx = tx + dx * k; sy = ty + dy * k;
    }
    const out: number[][] = [];
    for (let j = 0; j < H.d; j++) {
      for (let i = -Math.floor(H.w / 2); i <= Math.floor(H.w / 2); i++) {
        const x = sx + dx * j + (dy ? i : 0), y = sy + dy * j + (dx ? i : 0);
        if (this.tiles[y]?.[x] === '#' && !PERIMETER[y][x]) out.push([x, y]);
      }
    }
    return out;
  }

  breakWalls(tiles: number[][]) {
    for (const [x, y] of tiles) this.tiles[y] = this.tiles[y].slice(0, x) + '.' + this.tiles[y].slice(x + 1);
    this.broken.push(...tiles);
    this.walls = wallRects(this.tiles); // 当たり判定・視界・経路探索に即反映
  }

  skill(id: string) {
    const p = this.players.get(id);
    const sk = p && S[p.char];
    if (!p || !sk || (this.phase !== 'playing' && this.phase !== 'ended') || !p.alive || this.now < p.skillReadyAt || this.now < p.mochiUntil) return; // ずんだ餅の間は技を使えない
    if (p.ult && !p.ult.pending) return; // ウルト中はキャラ技を使えない
    p.skillReadyAt = this.now + sk.ct;
    const a = this.aimOf(p), ux = Math.cos(a), uy = Math.sin(a);
    const allies = (r: number) => [...this.players.values()].filter((q) => q.team === p.team && q.alive && Math.hypot(q.x - p.x, q.y - p.y) <= r);
    switch (p.char) {
      case 'hanamaru':
        // 巨大拳飛ばし: 前方へ直進する拳を出す（命中・破壊は updateFists）
        this.fists.push({ id: this.nextId++, team: p.team, owner: p.id, x: p.x, y: p.y, a, left: sk.range, hit: new Set(), broke: false });
        break;
      case 'sayo':
        p.danceUntil = this.now + sk.dur; p.danceNext = this.now;
        break;
      case 'zunko':
        this.shoot(p, 'arrow', a, sk.range, 0);
        break;
      case 'whitecul':
        for (const t of this.inRectAhead(p, a, sk.len, sk.w)) { this.hitThing(p, t, sk.dmg); this.push(t, ux, uy, sk.push); }
        this.addFx(p, 'rect', { a, len: sk.len, w: sk.w });
        break;
      case 'aru':
        // 突撃: タメに入る（方向はこの瞬間に決める: 移動入力 → 照準の対象 → 向いている方向）
        const [ix, iy] = this.moveIntent(p);
        p.chargeAt = this.now;
        p.chargeA = ix || iy ? Math.atan2(iy, ix) : a;
        break;
      case 'bii': {
        // 罠設置: 向いている方向に置く（前が塞がっていれば足元）。同時に max 個まで、超えたら古い方が消える
        let x = p.x + Math.cos(p.face) * C.PLACE_DIST, y = p.y + Math.sin(p.face) * C.PLACE_DIST;
        if (!canPlace('trap', x, y, this.bodies().filter((b) => b.x !== p.x || b.y !== p.y))) { x = p.x; y = p.y; }
        this.traps.push({ id: this.nextId++, team: p.team, owner: p.id, x, y, a: p.face, hp: sk.hp, nextAtk: this.now });
        const mine = this.traps.filter((t) => t.owner === p.id);
        if (mine.length > sk.max) this.traps = this.traps.filter((t) => t !== mine[0]);
        this.addFx({ x, y, team: p.team }, 'arc', { a: p.face, r: sk.range, arc: sk.arc, color: 'trap' });
        break;
      }
      case 'mochiko':
        for (let i = 0; i < sk.n; i++) {
          const ang = (i / sk.n) * Math.PI * 2;
          this.funnels.push({ id: this.nextId++, team: p.team, owner: p.id, x: p.x + Math.cos(ang) * 20, y: p.y + Math.sin(ang) * 20, hp: sk.hp, until: this.now + sk.life, nextAtk: this.now, slot: ang, tgt: null, path: [], retargetAt: 0 });
        }
        this.addFx(p, 'aura', { r: 30, color: 'funnel' });
        break;
      case 'metan':
        for (const t of this.enemyThings(p.team)) {
          if (!this.inArc(p, t.x, t.y, t.r, a, sk.range, sk.arc)) continue;
          this.hitThing(p, t, sk.dmg);
          const d = Math.hypot(t.x - p.x, t.y - p.y) || 1;
          this.push(t, (t.x - p.x) / d, (t.y - p.y) / d, sk.push);
        }
        this.addFx(p, 'arc', { a, r: sk.range, arc: sk.arc });
        break;
      case 'ierutan':
        allies(sk.r).forEach((q) => (q.accelUntil = this.now + sk.dur));
        this.addFx(p, 'aura', { r: sk.r, color: 'accel' });
        break;
      case 'kiritan':
        p.flyUntil = this.now + sk.dur;
        this.addFx(p, 'aura', { r: 30, color: 'fly' });
        break;
    }
  }

  // 移動入力: 人間は最後に届いた入力（tickの境目で入力が空になっても途切れない）、Bot は今の移動方向
  moveIntent(p: Player): [number, number] {
    return p.bot ? [p.dx, p.dy] : [p.inDx, p.inDy];
  }

  // アルの突撃の1tick: 決めた方向へ進み、垂直方向は移動入力で少し動ける。エフェクトの範囲の壁・バリケードを壊し、触れた敵に1回ずつ当たる
  dashStep(p: Player, dt: number) {
    const sk = S.aru, a = p.chargeA, ux = Math.cos(a), uy = Math.sin(a), sp = this.speedOf(p);
    const [ix, iy] = this.moveIntent(p), il = Math.hypot(ix, iy) || 1;
    const side = Math.max(-1, Math.min(1, (-ix * uy + iy * ux) / il)); // 移動入力の垂直成分
    const nx = p.x + ux * sp * sk.speed * dt - uy * side * sp * sk.side * dt, ny = p.y + uy * sp * sk.speed * dt + ux * side * sp * sk.side * dt;
    if (this.phase === 'ended') { Object.assign(p, moveBody(p.x, p.y, nx - p.x, ny - p.y, C.PLAYER_RADIUS, [...this.obstacles(), ...cage(this.cageOf(p)!)], false)); return; } // 結果画面: 部屋の中を動くだけ
    // 進んだ先のエフェクトの範囲に入る壁タイル（外周に当たったら壊さずそこで終わる）
    const tiles: number[][] = [];
    let stop = false;
    const R = sk.len + sk.w;
    for (let ty = Math.floor((ny - R) / T); ty <= Math.floor((ny + R) / T); ty++) for (let tx = Math.floor((nx - R) / T); tx <= Math.floor((nx + R) / T); tx++) {
      if (this.tiles[ty]?.[tx] !== '#' || !inDashShape(tx * T + T / 2, ty * T + T / 2, nx, ny, a, T / 2)) continue;
      if (PERIMETER[ty][tx]) stop = true; else tiles.push([tx, ty]);
    }
    if (stop) { p.dashUntil = 0; return; }
    if (tiles.length) { this.breakWalls(tiles); if (!p.dashBroke) { p.dashBroke = true; this.addToku(p.team, p, 'wall'); } }
    this.barricades = this.barricades.filter((b) => !inDashShape(Math.max(b.x, Math.min(nx + ux * sk.head, b.x + b.w)), Math.max(b.y, Math.min(ny + uy * sk.head, b.y + b.h)), nx, ny, a));
    Object.assign(p, moveBody(p.x, p.y, nx - p.x, ny - p.y, C.PLAYER_RADIUS, this.obstacles(), false));
    for (const t of this.enemyThings(p.team)) {
      if (t.k === 'bar' || t.k === 'trap' || p.dashHit.has(thingId(t)) || !inDashShape(t.x, t.y, p.x, p.y, a, t.r)) continue;
      p.dashHit.add(thingId(t));
      this.hitThing(p, t, sk.dmg);
    }
  }

  // ---- アシスト（男性キャラ3人の専用ユニット） ----

  // 技: 一定時間ごと、条件がそろえば発動。強さの倍率を効果に掛ける
  updateAssists() {
    for (const p of this.players.values()) {
      if (!p.assist || !p.alive || this.now < p.skillReadyAt) continue;
      const U = C.ASSIST.units[p.char], k = C.POWER_MULT[p.tier], d = (o: Pt) => Math.hypot(o.x - p.x, o.y - p.y);
      const foes = this.enemyThings(p.team).filter((t) => (t.k === 'p' || t.k === 'boss') && d(t) <= U.sense);
      if (p.char === 'kurono' && foes.length) {
        this.warns.push({ id: this.nextId++, team: p.team, owner: p.id, x: p.x, y: p.y, r: U.r, at: this.now + U.warn, dmg: U.dmg * k, follow: p.id }); // 自分中心（予告の間も付いていく）
      } else if (p.char === 'aoyama' && foes.length) {
        const t = foes.find((u) => u.k === 'p' && u.o.assist) ?? [...foes].sort((u, v) => d(u) - d(v))[0]; // 相手のアシストを優先
        this.warns.push({ id: this.nextId++, team: p.team, owner: p.id, x: t.x, y: t.y, r: U.r, at: this.now + U.warn, dmg: U.dmg * k, follow: null }); // 位置は今の時点で固定
      } else if (p.char === 'shirakami') {
        const allies = [...this.players.values()].filter((q) => q.team === p.team && q.alive && q !== p && d(q) <= U.sense);
        if (!allies.length) continue;
        for (const q of [p, ...allies]) { q.hp = Math.min(this.maxHp(q), q.hp + U.heal * k); q.boostUntil = this.now + U.dur; }
        this.addFx(p, 'ring', { r: U.sense, color: 'heal' });
      } else continue;
      p.skillReadyAt = this.now + U.every;
    }
  }

  // 範囲攻撃の予告: 時間になったら発動（追従するものは持ち主の今の位置）。持ち主が倒れていたら消える
  updateWarns() {
    for (const w of [...this.warns]) {
      if (w.boss) {
        if (this.now < w.at) continue;
        this.warns = this.warns.filter((x) => x !== w);
        this.explode(w.team, w.x, w.y, w.r, w.dmg);
        this.moveBoss(this.bosses[w.team]);
        continue;
      }
      const owner = this.players.get(w.owner);
      if (!owner?.alive) { this.warns = this.warns.filter((x) => x !== w); continue; }
      if (w.follow) { w.x = owner.x; w.y = owner.y; }
      if (this.now < w.at) continue;
      this.warns = this.warns.filter((x) => x !== w);
      for (const t of this.enemyThings(w.team)) if ((t.k === 'p' || t.k === 'boss' || t.k === 'f') && Math.hypot(t.x - w.x, t.y - w.y) <= w.r + t.r) this.hitThing(owner, t, w.dmg);
      this.addFx(w, 'ring', { r: w.r, color: 'dash' });
    }
  }

  // ---- Bot ----

  updateBots() {
    const obs = this.obstacles();
    for (const p of this.players.values()) if (p.bot && p.alive) this.botThink(p, obs);
  }

  // Botが技を使う価値があるか（技の範囲内に対象がいるか）
  botSkillUseful(p: Player): boolean {
    const sk = S[p.char], a = this.aimOf(p);
    const near = (r: number, kinds = ['p', 'boss', 'f']) => this.inCircle(p, p.x, p.y, r).filter((t) => kinds.includes(t.k) && this.reach(p, t)).length > 0;
    switch (p.char) {
      case 'hanamaru': return this.inRectAhead(p, a, sk.range, sk.r * 2).some((t) => (t.k === 'p' || t.k === 'boss') && this.reach(p, t)); // 拳の進路に敵
      case 'sayo': return near(sk.r + 10, ['p', 'boss', 'f', 'bar']);
      case 'zunko': return near(sk.range, ['p']);
      case 'whitecul': return this.inRectAhead(p, a, sk.len, sk.w).some((t) => this.reach(p, t));
      case 'aru': { const d = p.dx || p.dy ? Math.atan2(p.dy, p.dx) : a; return this.inRectAhead(p, d, sk.speed * this.speedOf(p) * sk.dur, sk.w).some((t) => t.k === 'p' || t.k === 'boss'); } // 予測進路に敵か敵大将
      case 'bii': return near(sk.range, ['p', 'boss']);
      case 'mochiko': return near(sk.sense, ['p', 'boss']);
      case 'metan': return this.enemyThings(p.team).some((t) => this.inArc(p, t.x, t.y, t.r, a, sk.range, sk.arc) && this.reach(p, t));
      case 'ierutan': return near(C.BOT_SKILL_SENSE, ['p', 'boss']);
      case 'kiritan': return near(C.BOT_SKILL_SENSE, ['p', 'boss']);
    }
    return false;
  }

  // hanamaru のBot: 壁を壊すと目的地への経路が大きく短くなるなら壁破壊（その方向を向いて使う）
  botWallBreak(p: Player, to: Pt, obs: Rect[]): boolean {
    if (p.char !== 'hanamaru' || this.phase !== 'playing' || this.now < p.skillReadyAt || this.now < p.mochiUntil || this.now < p.wallCheckAt) return false;
    p.wallCheckAt = this.now + C.BOT_WALLBREAK_CHECK;
    const base = findPath(p, to, obs, this.walls).length;
    if (!base) return false;
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      if (!this.breakTiles(p, a).length) continue;
      // 壊した後の経路長 ≒ 壁の向こうの床からの経路長 + 壁までと壁の厚み
      const dx = Math.round(Math.cos(a)), dy = Math.round(Math.sin(a)), tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
      let k = 1;
      while (this.tiles[ty + dy * k]?.[tx + dx * k] !== '#') k++;
      const bx = tx + dx * (k + S.hanamaru.d), by = ty + dy * (k + S.hanamaru.d);
      if (this.tiles[by]?.[bx] !== '.') continue; // 壁が厚くて抜けない
      const rest = findPath({ x: bx * T + T / 2, y: by * T + T / 2 }, to, obs, this.walls).length;
      const len = rest && rest + k + S.hanamaru.d;
      if (len && (base - len) * C.GRID_CELL >= C.BOT_WALLBREAK_SAVE) {
        p.face = a; p.tgt = null; // 壁の方向へ使う
        this.skill(p.id);
        return true;
      }
    }
    return false;
  }

  // 詰まり判定: 戦闘中でないのに一定時間ほとんど動いていなければ、今の目的地を一時的に避ける
  botStuck(p: Player, fighting: boolean) {
    if (fighting || Math.hypot(p.x - p.stuckX, p.y - p.stuckY) > C.BOT_STUCK_RADIUS) {
      Object.assign(p, { stuckX: p.x, stuckY: p.y, stuckSince: this.now });
      return;
    }
    if (this.now - p.stuckSince < C.BOT_STUCK_TIME || !p.goal) return;
    p.penalty.set(p.goal, this.now + C.BOT_PENALTY_TIME);
    p.path = []; p.pathAt = -Infinity;
    if (p.goal.startsWith('room:')) { p.visited.push(p.raidBase); p.raidBase = -1; }
    Object.assign(p, { stuckX: p.x, stuckY: p.y, stuckSince: this.now });
  }

  botThink(p: Player, obs: Rect[]) {
    if (p.assist) return this.assistThink(p, obs);
    const dist = (o: Pt) => Math.hypot(o.x - p.x, o.y - p.y);
    // 近い順。同じくらい近い候補はランダムに選ぶ。詰まった目的地（penalty）は避ける（全部避けるべきなら避けない）
    const avoid = (key: string) => (p.penalty.get(key) ?? 0) > this.now;
    const best = <X extends Pt>(a: X[], key: (x: X) => string) => {
      const ok = a.filter((x) => !avoid(key(x)));
      const list = (ok.length ? ok : a).map((x) => ({ x, d: Math.round(dist(x) / C.GRID_CELL), r: Math.random() })).sort((u, v) => u.d - v.d || u.r - v.r);
      return list[0]?.x;
    };
    const go = (to: Pt, key: string) => { p.goal = key; this.botGoto(p, to, obs); };
    // リコール: HPが低いとき（給湯室にいるときは使わない）。給湯室に着いたら、HPが満タンになるまでご飯を食べる
    if (p.recallAt === null && !this.atBase(p) && p.hp < this.maxHp(p) * C.BOT_RECALL_HP) p.recallAt = this.now;
    if (p.eating && (p.hp >= this.maxHp(p) || !this.atBase(p))) p.eating = false;
    // 0. 技: CTが明けていて範囲内に対象がいれば使う
    if (this.phase === 'playing' && this.now >= p.skillReadyAt && this.now >= p.mochiUntil && this.botSkillUseful(p)) this.skill(p.id);
    // 1. 近くの敵を攻撃（指名手配中の敵を優先）
    const foes = [...this.players.values()].filter((e) => e.team !== p.team && e.alive && dist(e) <= C.BOT_AGGRO_RANGE && this.visibleTo(p.team, e.x, e.y, obs));
    const wanted = foes.find((e) => e.id === this.teams[1 - p.team].wanted);
    const enemy = wanted ?? best(foes, (e) => `p:${e.id}`);
    this.botStuck(p, !!enemy || !!p.tgt);
    if (enemy) return this.botFight(p, enemy, C.PLAYER_RADIUS, obs);
    if (p.eating) { const f = best(this.items.filter((i) => i.kind === 'heal' && inRect(i.x, i.y, C.RECALL_ROOMS[p.team])), (i) => `item:${i.id}`); if (f) return go(f, `item:${f.id}`); }
    // 2. コバコ: 落とした荷物をすぐ拾える位置にいるときだけ攻撃する
    const c = this.couriers[0];
    if (c && dist(c) <= C.BOT_COURIER_RANGE && this.visibleTo(p.team, c.x, c.y, obs)) {
      p.goal = `c:${c.id}`;
      if (dist(c) <= C.ATTACK_RANGE + C.PLAYER_RADIUS - 4 && lineOfSight(p.x, p.y, c.x, c.y, obs)) { this.setInput(p.id, 0, 0); return this.attack(p.id, Math.atan2(c.y - p.y, c.x - p.x)); }
      return this.botGoto(p, c, obs);
    }
    // 3. 見えている荷物を拾いに行く（触れると拾う）
    const box = best(this.items.filter((i) => i.kind.startsWith('box_') && this.visibleTo(p.team, i.x, i.y, obs)), (i) => `item:${i.id}`);
    if (box) return go(box, `item:${box.id}`);
    // 壊し屋（バリケード・罠へ×3）は視界内の敵のバリケード・罠を優先して壊す
    if (C.BREAKERS.includes(p.char)) {
      const st = best(this.enemyThings(p.team).filter((t) => (t.k === 'bar' || t.k === 'trap') && this.visibleTo(p.team, t.x, t.y, obs)), (t) => thingId(t));
      if (st) { p.goal = thingId(st); return this.botFight(p, st, st.r, obs); }
    }
    // 4. 役割: 資材集め（一番近い資材）か、敵陣の見回り
    if (p.role === 'gather') {
      const m = best(this.materials, (m) => `mat:${m.id}`);
      return m ? go(m, `mat:${m.id}`) : go({ x: C.MAP_W / 2, y: C.MAP_H / 2 }, 'center');
    }
    const boss = this.bosses[1 - p.team];
    if (this.visibleTo(p.team, boss.x, boss.y, obs)) { p.goal = 'boss'; return this.botFight(p, boss, C.BOSS_RADIUS, obs); }
    const bs = this.bases[1 - p.team];
    // 未見回りの部屋のうち近い部屋（同じくらいならランダム、詰まった部屋は避ける）
    const next = () => best(bs.map((b, i) => ({ ...b, i })).filter((b) => !p.visited.includes(b.i)), (b) => `room:${b.i}`)!.i;
    if (p.raidBase < 0) { if (p.visited.length >= bs.length) p.visited = []; p.raidBase = next(); }
    if (dist(bs[p.raidBase]) < 40) { // 見えないので次の拠点へ
      p.visited.push(p.raidBase);
      if (p.visited.length >= bs.length) p.visited = [p.raidBase];
      p.raidBase = next();
    }
    const b = bs[p.raidBase];
    if (this.botWallBreak(p, b, obs)) return;
    go(b, `room:${p.raidBase}`);
  }

  // アシスト: 敵大将へ経路探索で前進し、着いたら攻撃する（途中の敵は射程内ならオートアタック、前進は止めない）
  // 両陣営のアシストが出ているときは、互いを最優先の目標にする（相手が倒れたら敵大将への前進に戻る）
  assistThink(p: Player, obs: Rect[]) {
    const foe = this.enemyAssist(p);
    if (foe) { p.goal = `p:${foe.id}`; return this.botFight(p, foe, C.PLAYER_RADIUS, obs); }
    const boss = this.bosses[1 - p.team];
    p.goal = 'boss';
    this.botFight(p, boss, C.BOSS_RADIUS, obs);
  }

  enemyAssist(p: Player) {
    return [...this.players.values()].find((q) => q.assist && q.alive && q.team !== p.team);
  }

  // 射程まで近づく（攻撃はオートアタック）
  botFight(p: Player, t: Pt, tr: number, obs: Rect[]) {
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d <= this.atkRange(p) + tr - 6 && lineOfSight(p.x, p.y, t.x, t.y, obs.filter((o) => !inRect(t.x, t.y, o)))) {
      this.setInput(p.id, 0, 0);
      p.face = Math.atan2(t.y - p.y, t.x - p.x);
    } else this.botGoto(p, t, obs);
  }

  botGoto(p: Player, to: Pt, obs: Rect[]) {
    if (this.now - p.pathAt >= C.BOT_REPATH || !p.path.length) {
      p.path = findPath(p, to, obs, this.walls);
      // 経路がないとき: 敵のバリケードを無視した経路で、塞いでいるバリケードへ向かう（オートアタックで壊してから進む）
      if (!p.path.length) {
        const own = this.barricades.filter((b) => b.team === p.team);
        const path2 = findPath(p, to, [...this.walls, ...own], this.walls);
        const block = path2.map((q) => this.barricades.find((b) => b.team !== p.team && Math.hypot(b.x + b.w / 2 - q.x, b.y + b.h / 2 - q.y) <= b.w / 2 + C.PLAYER_RADIUS + 8)).find((b) => b);
        if (block) p.path = findPath(p, { x: block.x + block.w / 2, y: block.y + block.h / 2 }, obs.filter((o) => o !== block), this.walls);
      }
      p.pathAt = this.now;
    }
    while (p.path.length && Math.hypot(p.path[0].x - p.x, p.path[0].y - p.y) < 6) p.path.shift();
    const n = p.path[0];
    if (n) this.setInput(p.id, n.x - p.x, n.y - p.y);
    else this.setInput(p.id, 0, 0);
  }

  // 陣営 team から見えるか（自陣営のプレイヤー・大将の視界、壁とバリケードで遮断）
  visibleTo(team: number, x: number, y: number, obs: Rect[]): boolean {
    const eyes = [...this.players.values()].filter((p) => p.team === team && p.alive) as { x: number; y: number; char?: string }[];
    eyes.push(this.bosses[team]);
    return eyes.some((e) => Math.hypot(e.x - x, e.y - y) <= visionRadius(e.char) && lineOfSight(e.x, e.y, x, y, obs));
  }

  // 「戻る」を押した人数（Botは押した扱い）／全人数
  backCount() {
    const list = [...this.players.values()].filter((p) => !p.assist);
    return { n: list.filter((p) => p.bot || this.backVotes.has(p.id)).length, total: list.length };
  }

  sendSnapshots() {
    const obs = this.obstacles();
    const vis = [0, 1].map((team) => ({
      players: [...this.players.values()].filter((p) => p.team === team || (p.alive && this.visibleTo(team, p.x, p.y, obs))),
      bosses: this.bosses.filter((b) => b.team === team || this.phase === 'intro' || this.visibleTo(team, b.x, b.y, obs)), // 開幕中は敵大将も映す
      funnels: this.funnels.filter((f) => f.team === team || this.visibleTo(team, f.x, f.y, obs)),
      shots: this.shots.filter((s) => s.team === team || this.visibleTo(team, s.x, s.y, obs)),
      fists: this.fists.filter((f) => f.team === team || this.visibleTo(team, f.x, f.y, obs)),
      fx: this.fx.filter((f) => f.team === team || this.visibleTo(team, f.x, f.y, obs)), // 視界内なら他プレイヤーの技も見える
      warns: this.warns.filter((w) => w.team === team || this.visibleTo(team, w.x, w.y, obs)),
    }));
    const wanted = this.teams.map((t) => this.players.get(t.wanted ?? '')).filter((p) => p?.alive).map((p) => ({ id: p!.id, team: p!.team, x: p!.x, y: p!.y }));
    const all = { players: [...this.players.values()], bosses: this.bosses, funnels: this.funnels, shots: this.shots, fists: this.fists, fx: this.fx, warns: this.warns };
    const roster = [...this.players.values()].filter((p) => !p.assist).map((p) => ({ id: p.id, team: p.team, bot: p.bot, char: p.char, alive: p.alive }));
    for (const client of this.clients) {
      const me = this.players.get(this.owners.get(client.sessionId) ?? '');
      const v = me && !this.reveal.has(client.sessionId) ? vis[me.team] : all; // 観戦者はフォグなし
      const myTeam = me ? me.team : 0;
      client.send('s', {
        me: me?.id ?? null, t: this.elapsed, roster, ...(this.phase === 'intro' ? { introMess: this.introMess } : {}), back: this.phase === 'ended' ? this.backCount() : null, phase: this.phase, phaseLeft: this.phaseLeft, timeLeft: this.timeLeft, winner: this.winner,
        teams: this.teams.map((t, i) => ({ toku: t.toku, wanted: t.wanted, reflect: this.reflecting(i), bossHpRatio: this.bosses[i].hp / C.BOSS_HP, slot: { reels: t.slot.reels, win: t.slot.win, pen: t.slot.pen, chain: t.slot.chain, payout: t.slot.payoutAt !== null, left: C.SLOT.spin - (this.now - t.slot.start) } })),
        wanted: wanted, // 指名手配中のキャラの位置（敵の視界外でもミニマップに出す）
        players: v.players.map((p) => ({
          id: p.id, team: p.team, char: p.char, bot: p.bot, x: p.x, y: p.y, hp: p.hp, alive: p.alive, rage: p.rage, bad: p.bad,
          face: p.face, stunned: this.now < p.stunUntil, cd: Math.max(0, p.cooldownUntil - this.now),
          respawnIn: p.alive ? 0 : p.respawnAt - this.now,
          ack: p.ack, cage: this.cageOf(p), maxHp: this.maxHp(p), spd: this.speedOf(p), aim: p.aim, tgt: p.tgt ? thingId(p.tgt) : null, skillCd: Math.max(0, p.skillReadyAt - this.now),
          mochi: this.now < p.mochiUntil, accel: this.now < p.accelUntil, dance: this.now < p.danceUntil, fly: this.now < p.flyUntil,
          recall: p.recallAt === null ? null : (this.now - p.recallAt) / C.RECALL_HOLD,
          assist: p.assist, tier: p.tier, ult: p.ult ? { form: p.ult.form, tier: p.ult.tier, left: p.ult.pending ? null : p.ult.until - this.now } : null,
          charge: p.chargeAt !== null ? { a: p.chargeA, len: this.speedOf(p) * S.aru.speed * S.aru.dur, left: S.aru.windup - (this.now - p.chargeAt) } : null, dash: this.now < p.dashUntil ? { a: p.chargeA } : null, boost: this.now < p.boostUntil, slow: this.now < p.slowUntil, weak: this.now < p.weakUntil, cdMax: this.atkCooldown(p),
        })),
        bosses: v.bosses.map((b) => ({ team: b.team, x: b.x, y: b.y, hp: b.hp, base: b.base })),
        materials: this.materials.map((m) => ({ id: m.id, x: m.x, y: m.y, hi: m.hi })), items: this.items, traps: this.traps, barricades: this.barricades,
        funnels: v.funnels.map((f) => ({ id: f.id, team: f.team, x: f.x, y: f.y, hp: f.hp })),
        couriers: this.couriers.map((c) => ({ id: c.id, team: c.team, x: c.x, y: c.y, box: c.box })), // コバコは両陣営に見せる（ミニマップ）
        warns: v.warns.map((w) => ({ id: w.id, team: w.team, x: w.x, y: w.y, r: w.r, left: w.at - this.now, boss: !!w.boss })),
        shots: v.shots.map((s) => ({ id: s.id, kind: s.kind, team: s.team, x: s.x, y: s.y, vx: s.vx, vy: s.vy })),
        fists: v.fists.map((f) => ({ id: f.id, team: f.team, x: f.x, y: f.y, a: f.a })),
        fx: v.fx, broken: this.broken, bossRooms: this.bossRooms, ...(this.reveal.has(client.sessionId) ? { reveal: true } : {}),
      });
    }
  }
}
