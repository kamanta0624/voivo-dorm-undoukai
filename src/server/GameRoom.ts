import { Room, Client, ServerError, CloseCode } from 'colyseus';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG as C, Rect, Pt, wallRects, roomLayout, roomKindAt, isBackAt, slotRate, penaltyRate, bossIntensity, bodyUp } from '../shared/config';
import { CHARS, PICKABLE, E2E_BOTS, BOSS_CHAR, visionRadius, eyeRadius, roleOf, charHp, charSpeed, charAtk, aaRange, aaMode, moveWalls } from '../shared/chars';
import { lineOfSight, inRect, moveBody, pushOut, cage } from '../shared/geom';
import { SKILLS, STATUS_ORDER, ENTS } from './skills';
import { findPath } from './pathfind';
import { stepPlayer } from '../shared/netcode';
import MAP from '../shared/map.json';
import { Director } from './commentary';
import * as OG from './outgame';

const T = C.TILE;
const BAD_DECAY = (-C.TOKU.courier * C.BAD_MULT.courier) / C.BAD_DECAY_SEC; // 反省中に毎秒減る悪行ポイント（config の BAD_DECAY_SEC）
// マップ外周の壁（外 ' ' か地図の端に接する壁）は壊せない
export const PERIMETER = MAP.tiles.map((row, y) => [...row].map((c, x) => c === '#' && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (MAP.tiles[y + dy]?.[x + dx] ?? ' ') === ' '))));

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
const CENTER_ROOMS = MAP.rooms.filter((r) => r.type === 'center').map((r) => r.id); // 中央の部屋（自然湧きの徳を出さない。徳はコバコが置く）

type Ult = { form: string; tier: number; until: number; pending: boolean }; // pending: 撤退中に選ばれ、復活後に始まる
export type Player = {
  id: string; team: number; char: string; x: number; y: number; hp: number; alive: boolean;
  dx: number; dy: number; face: number; // face: 向き(ラジアン)
  rage: number; bad: number; wantedHold: boolean; // bad: 悪行ポイント（徳を下げた量 × BAD_MULT の累計。反省中は BAD_DECAY_SEC の速さで減る）。wantedHold: 撃破で手配を外し、復帰後に悪行が増えるまで手配しない
  cooldownUntil: number; stunUntil: number; respawnAt: number; respawnTotal: number; // respawnTotal: 撤退時間の合計
  lastHitBy: Map<string, number>;
  bot: boolean; role: 'gather' | 'raid'; path: Pt[]; pathAt: number; raidBase: number; visited: number[]; // raidBase: 見回り中の敵陣の部屋（-1=未決定）、visited: 見回り済みの部屋
  aim: string; tgt: Thing | null; // 照準モードと、今狙っている対象
  inputs: { seq: number; dx: number; dy: number; rt?: number }[]; ack: number; // 人間の入力待ちと、処理済みの入力番号
  viewT?: number; // 人間: 最後に処理した入力の描画時刻（クライアントの画面のサーバー時刻 elapsed。近接AAの巻き戻し判定）
  skillReadyAt: number; st: Record<string, Status>; sk: Record<string, any>; // st: 状態（key → 期限と効果）、sk: 技処理の持ち物（server/skills が使う）
  assist: boolean; tier: number; ult: Ult | null; // assist: アシストユニット（復活しない）、tier: アシストの強さ（POWER_* の添字）
  goal: string; stuckX: number; stuckY: number; stuckSince: number; penalty: Map<string, number>; // Bot: 今の目的地、詰まり判定、避ける目的地（期限）
  qAt: number | null; recallAt: number | null; // Q を押した時刻と、リコールの溜めの開始時刻（被弾で溜め直し）
  boostUntil: number; // 白上虎太郎の移動速度上昇
  inDx: number; inDy: number; // 人間: 最後に届いた移動入力
  eating: boolean; // Bot: リコールして給湯室でご飯を食べている（HPが満タンになるまで）
  ok: boolean; // 待機画面で出撃済み
  slowUntil: number; weakUntil: number; // スロットの罰: 移動速度低下・攻撃力低下
  koAt: number; // 撃破された時刻（撃破の演出 KO_FX）
  hitAt: number; // 最後に被弾した時刻（Bot のリコール判断の「脅威あり」）
  lowFight: boolean; lowUntil: number; // Bot: 低HPで脅威ありのときの攻撃(true)／逃亡(false)と、その決定を維持する時刻
  name?: string; ip?: string; bid?: string; // 人間: プレイヤー名（自動）、IP・ブラウザ保存ID（管理ページの表示と BAN）
};
type Courier = { id: number; team: number; x: number; y: number; hp: number; path: Pt[]; pathAt: number; wp: number; dir: number; box: string }; // ブイブイ・コバコ（中立 team=-1）。wp: 巡回経路の次の地点、dir: 往復の向き（+1 / -1）、box: 持っている荷物（ult / assist）
export type Boss = { team: number; base: number; x: number; y: number; hp: number; dmgAtBase: number; target: string | null; cooldownUntil: number; moved: boolean; moving: boolean; shotAt: number; holdUntil: number }; // moved: 1回でも拠点移動した（第2形態）、moving: 移動の予告中（無敵）、shotAt: 第2形態の次の弾の時刻、holdUntil: この時刻までは拠点移動を始めない（技が止める）
type Slot = { start: number; reels: number[]; win: boolean; pen: boolean; chain: number; tier: number; payoutAt: number | null; holdUntil: number }; // start: 回転の開始時刻、reels: この回転の結果（陣営のキャラの添字。-1=罰の絵柄）、pen: 罰の出目、payoutAt: 次の払い出しの時刻（払い出し中だけ）
// 決着演出: kind=boss（大将撃破）／timeout（時間切れ）、stage=今の段（FINALE の順）、t=段の経過(実秒)、boss=倒された大将の位置、killer=止めを刺したキャラ（アシストは assist）
type Finale = { kind: 'boss' | 'timeout'; winner: number; stage: 'slow' | 'boss' | 'killer' | 'timeup' | 'win'; t: number; boss: { team: number; x: number; y: number } | null; killer: { id: string; char: string; team: number; assist: boolean; x: number; y: number } | null };
type Team = { toku: number; wanted: string | null; slot: Slot }; // toku: 徳、wanted: 指名手配中のプレイヤーid
type Warn = { id: number; team: number; owner: string; x: number; y: number; r: number; at: number; dmg: number; follow: string | null; boss?: boolean; push?: number; color?: string }; // アシストの範囲攻撃の予告（at に発動。follow があればその位置で発動）。boss: 大将の拠点移動前の広範囲攻撃（owner は使わない）。push: 発動で外向きにはじく距離、color: 発動の円の色（なければ赤い輪）
type Material = { id: number; x: number; y: number; hi: boolean; big?: boolean }; // hi: 裏側に出た高ポイントの資材、big: コバコが置いた高性能の徳
type Item = { id: number; kind: string; team: number; x: number; y: number; e2e?: boolean }; // kind: heal（回復アイテム）/ box_ult / box_assist（コバコの荷物）。team は常に -1。e2e: テスト用の仕掛けで置いたもの
type Shot = { id: number; kind: 'bullet' | 'arrow' | 'cannon'; team: number; owner: string; x: number; y: number; vx: number; vy: number; sp: number; left: number; dmg: number; boom?: number; onHit?: (t: Thing) => void; steer?: (s: Shot, dt: number) => void; aa?: boolean; courier?: boolean }; // steer: 毎tick 進む前に向き（vx・vy）を変える（誘導する技が渡す）。boom: 大将の弾（着弾地点で半径 boom の爆発。owner は使わない）、onHit: 命中時にダメージの代わりに起きること（発射した技が渡す）、aa: 通常攻撃の弾、courier: コバコに当たる（通常攻撃の弾はコバコを狙うときだけ）
// 状態: until まで有効。効果は共通処理が見る（値は付与した技が渡す）。speed: 移動倍率、regen: 毎秒の回復、noSkill: 技不可、lock: 移動不可（still: その場で止まる lock。自キャラの見た目を補間に切り替えない）、atk: 与えるダメージの倍率、noAttack: 攻撃不可、invincible: 無敵（敵の状態も付かない）、noPush: はじき無効、cancel: KO・試合終了で消える、hidden: 敵の対象にならない、fragile: 被弾で即死、noAuto: オートアタックしない
// at: 付与した時刻（技処理が使う）、view: スナップショットで送る描画用の値
export type Status = { until: number; at?: number; speed?: number; regen?: number; noSkill?: boolean; lock?: boolean; still?: boolean; atk?: number; noAttack?: boolean; invincible?: boolean; noPush?: boolean; cancel?: boolean; hidden?: boolean; fragile?: boolean; noAuto?: boolean; noAaDmg?: boolean; view?: () => any };
// 場の物（技が出す物）。kind: 種類（server/skills の ENTS）、body: unit=ユニット扱い（自動照準の優先・はじき可）、null=攻撃対象にならない。ほかの項目は種類ごとの持ち物。v: スナップショットで送る描画用の値（あれば）
export type Ent = { id: number; kind: string; team: number; owner: string; x: number; y: number; r: number; hp?: number; body: 'unit' | null; [k: string]: any };
type Fx = { id: number; kind: string; team: number; x: number; y: number; [k: string]: any };
// 攻撃・技の対象（敵プレイヤー・大将・場の物・コバコ）
export type Thing =
  | { k: 'p'; o: Player; x: number; y: number; r: number }
  | { k: 'boss'; o: Boss; x: number; y: number; r: number }
  | { k: 'e'; o: Ent; x: number; y: number; r: number }
  | { k: 'c'; o: Courier; x: number; y: number; r: number };
export const thingId = (t: Thing) => (t.k === 'p' ? `p:${t.o.id}` : t.k === 'boss' ? `boss:${t.o.team}` : `${t.k}:${t.o.id}`);
export const isUnit = (t: Thing) => t.k === 'p' || t.k === 'boss' || (t.k === 'e' && t.o.body === 'unit'); // ユニット（プレイヤー・大将・ユニット扱いの場の物）

export class GameRoom extends Room {
  static logFile = ''; // 試合ログの出力先（JSON Lines、空なら書かない）。src/server/index.ts で設定
  maxClients = C.MAX_CLIENTS;
  static live = new Set<GameRoom>(); // 動いている部屋（管理ページの一覧）
  static sealed = false; // 常設の部屋を作り終えたら true（以後は e2e の部屋しか作らせない。src/server/index.ts）
  pub = false; // 常設の部屋（タイトルの一覧に出る。e2e の部屋は false）
  now = 0;
  phase: 'waiting' | 'intro' | 'countdown' | 'playing' | 'finale' | 'ended' = 'waiting'; // intro: 開始の演出（動けない）、countdown: 開始前のカウント（開始した部屋の中だけ動ける）、finale: 決着演出（入力なし。CONFIG.FINALE）
  finale: Finale | null = null; // 決着演出の状態
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
  ents: Ent[] = []; // 場の物（技が出す物）
  shots: Shot[] = [];
  couriers: Courier[] = []; // ブイブイ・コバコ（1体。KO中は空）
  courierAt = 0; // コバコの復活時刻
  warns: Warn[] = [];
  dropped = new Set<string>(); // 再接続待ちのプレイヤーid（途中参加の入れ替え先にしない）
  kicked = new Set<string>(); // 管理ページでキックしたプレイヤーid（再接続待ちの間にキックされたら、戻ってきた時点で外す）
  backVotes = new Set<string>(); // リザルトで「戻る」を押した人間のプレイヤーid
  fx: Fx[] = []; // このティックに起きた技のエフェクト（送信後に空にする）
  tiles = [...MAP.tiles]; // 試合中のタイル（壁破壊で変わる）
  walls = C.WALLS;
  broken: number[][] = []; // 壊れた壁のタイル [x, y]
  nextId = 1;
  materialTimer = 0;
  healAt: (number | null)[] = []; // 回復アイテムの置き場所（HEAL_SPOTS）ごとの再出現の時刻（置いてあれば null）
  bossRooms: string[] = []; // この試合の大将の部屋（左右で同じ名前）。大将の出現・逃亡先
  bases: Pt[][] = [];
  homes: Rect[][] = [];
  speed = 1; // e2e の早送り倍率（E2E_HOOKS のときだけ変わる）
  reveal = new Set<string>(); // e2e: 視界の制限なしで送るクライアント（E2E_HOOKS のときだけ使う）
  bossGuard = false; // e2e: Bot の攻撃では大将が減らない（E2E_HOOKS のときだけ変わる）
  courierGuard = false; // e2e: Bot の攻撃ではコバコが倒れない（E2E_HOOKS のときだけ変わる）
  slotChain: number = C.SLOT.chain; // 連チャンの確率（e2e で変えられる）
  lobbyLeft: number | null = null; // 待機画面: 選択猶予の残り秒数（最初の出撃で始まり、止まらない）。null は未開始
  slotMiss = false; // e2e: スロットの自然な回転を外れに固定（技の検証中にウルト変身で技が出なくならないように）
  noAuto = new Set<string>(); // e2e: 自動攻撃しないプレイヤーid（E2E_HOOKS のときだけ使う）
  introMess: Pt = { x: 0, y: 0 }; // 新開幕でカメラが映す「散らかったマップの一角」
  startedAt = 0; // GAME START の時刻（試合ログ用、ミリ秒）
  bossDmg = [{ player: 0, assist: 0 }, { player: 0, assist: 0 }]; // 陣営ごとの、敵大将に与えたダメージ（試合ログ用）
  cm!: Director; // 実況ディレクター（試合ごとに作り直す）

  messages = {
    input: (client: Client, m: { seq: number; dx: number; dy: number; rt?: number }) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (!p) return;
      p.inputs.push(m); // 1tickに1つずつ処理する（クライアントの予測と同じ刻み）
      p.inDx = m.dx; p.inDy = m.dy; // 最後に届いた移動入力（アルの突撃の方向に使う）
      if (p.inputs.length > C.NET_QUEUE_MAX) p.inputs.shift();
    },
    // Q を押した: 押している間リコールを溜める
    qdown: (client: Client) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (p && this.phase === 'playing' && p.alive && p.qAt === null) p.qAt = p.recallAt = this.now;
    },
    // Q を離した: 溜めを捨てる（短押しは何もしない）
    qup: (client: Client) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (!p || p.qAt === null) return;
      p.qAt = p.recallAt = null;
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
    skillUp: (client: Client) => {
      const id = this.owners.get(client.sessionId);
      if (id) this.skillUp(id);
    },
    aim: (client: Client, m: { mode: string }) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (p && C.AIM_MODES.includes(m.mode)) p.aim = m.mode;
    },
    // 待機画面で今選んでいる（表示している）キャラ。猶予の時間切れで未出撃なら、このキャラで出撃する
    pick: (client: Client, m: { char: string }) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (p && this.phase === 'waiting' && PICKABLE.includes(m.char)) p.char = m.char;
    },
    // 出撃: そのキャラで出撃済みにする。開始の判定（全員出撃で開始、最初の出撃で選択猶予のカウント開始）
    go: (client: Client, m: { char: string }) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (!p || this.phase !== 'waiting' || !PICKABLE.includes(m.char)) return;
      Object.assign(p, { char: m.char, ok: true });
      if (this.lobbyLeft === null) this.lobbyLeft = C.LOBBY_GRACE;
      this.updateLobby(0);
    },
    // 出撃を取り消す（キャラはそのまま。カウントは止まらない）
    unpick: (client: Client) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (p && this.phase === 'waiting') p.ok = false;
    },
    // 待機画面で陣営を移る（満員なら移れない）
    team: (client: Client, m: { team: number }) => {
      const p = this.players.get(this.owners.get(client.sessionId) ?? '');
      if (!p || this.phase !== 'waiting' || (m.team !== 0 && m.team !== 1) || p.team === m.team) return;
      if ([...this.players.values()].filter((q) => q.team === m.team).length >= C.TEAM_SIZE) return;
      this.players.delete(p.id);
      this.addPlayer(p.id, m.team, false).char = p.char;
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
      e2eBad: (c: Client, m: { v: number }) => { const p = this.players.get(this.owners.get(c.sessionId) ?? ''); if (p) { p.bad = m.v; p.wantedHold = false; } },
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
      e2eCourierGuard: (_c: Client, m: { on: boolean }) => { this.courierGuard = m.on; },
      // 自キャラの変身（パワーアップ）を解き、落ちている荷物の箱を片付ける
      e2eClearUlt: (c: Client) => { const p = this.players.get(this.owners.get(c.sessionId) ?? ''); if (p?.ult) this.endUlt(p); this.items = this.items.filter((it) => !it.kind.startsWith('box_')); },
      // スロットの自然な回転を外れに固定する（e2eSlot で結果を決める回転は別）
      e2eSlotMiss: (_c: Client, m: { on: boolean }) => { this.slotMiss = m.on; },
      // 敵大将に、拠点移動が起きるだけのダメージを与える（拠点移動・第2形態の確認用）
      e2eBossMove: (c: Client) => {
        const p = this.players.get(this.owners.get(c.sessionId) ?? '');
        if (p && this.phase === 'playing') { const b = this.bosses[1 - p.team]; this.damageBoss(b, Math.max(1, C.BOSS_MOVE_THRESHOLD - b.dmgAtBase), p); }
      },
      // 自キャラの自動攻撃を止める／戻す（検証の前提を崩さないように）
      e2eNoAuto: (c: Client, m: { on: boolean }) => { const id = this.owners.get(c.sessionId); if (id) { if (m.on) this.noAuto.add(id); else this.noAuto.delete(id); } },
      // 両陣営のアシストをすべて消す（前の確認で出したアシストが後の確認に干渉しないように）
      e2eClearAssists: () => { for (const p of [...this.players.values()]) if (p.assist) this.players.delete(p.id); },
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
    if (len > 0) { p.face = Math.atan2(p.dy, p.dx); this.cancelRecall(p); } // 移動でリコール中断
  }

  // リコールの中断: 溜めを0に戻す（Q を押し直すまで溜めない）
  cancelRecall(p: Player) {
    p.qAt = p.recallAt = null;
  }

  // 大将の部屋を決める（その試合の出現・逃亡先と自宅）
  setBossRooms(names: string[]) {
    this.bossRooms = names;
    ({ bases: this.bases, homes: this.homes } = roomLayout(names));
  }

  // 現在の試合: 中央からの経路距離の合計が上限以下になる組み合わせから選ぶ
  onCreate(options?: { e2e?: string }) {
    this.pub = !options?.e2e;
    if (this.pub && GameRoom.sealed) throw new Error('常設の部屋は増やせない');
    if (this.pub) this.autoDispose = false; // 空になっても残す
    GameRoom.live.add(this);
    this.setup();
    this.setSimulationInterval((dtMs) => { for (let i = 0; i < this.speed; i++) this.tick(dtMs / 1000, i === this.speed - 1); }, 1000 / C.TICK_HZ);
  }

  // 試合の初期状態（部屋を作ったときと、リザルトから待機画面に戻ったとき）
  setup() {
    Object.assign(this, { now: 0, phase: 'waiting', finale: null, phaseLeft: 0, timeLeft: C.MATCH_TIME, winner: -1, bosses: [], teams: [], materials: [], items: [], ents: [], shots: [], couriers: [], courierAt: 0, warns: [], fx: [], tiles: [...MAP.tiles], walls: C.WALLS, broken: [], materialTimer: 0, healAt: C.HEAL_SPOTS.map(() => null) });
    this.backVotes.clear();
    this.cm = new Director(this);
    this.bossDmg = [{ player: 0, assist: 0 }, { player: 0, assist: 0 }];
    this.setBossRooms(pick(ROOM_COMBOS.filter((c) => c.sum <= C.BOSS_ROOM_DIST_SUM_MAX)).names);
    for (let t = 0; t < 2; t++) {
      const base = Math.floor(Math.random() * this.bases[t].length); // 候補部屋からランダムに出現
      const b = this.bases[t][base];
      this.bosses.push({ team: t, base, x: b.x, y: b.y, hp: C.BOSS_HP, dmgAtBase: 0, target: null, cooldownUntil: 0, moved: false, moving: false, shotAt: 0, holdUntil: 0 });
      this.teams.push({ toku: C.TOKU_INIT, wanted: null, slot: { start: 0, reels: [0, 1, 2], win: false, pen: false, chain: 0, tier: 0, payoutAt: null, holdUntil: 0 } });
    }
  }

  // 待機画面の開始の判定: 接続中の人間（再接続待ちは除く）が全員出撃済みなら開始。選択猶予が切れたら、未出撃の人は今選んでいるキャラで開始
  // 接続中の人間がいないまま猶予が切れたら開始せず、カウントを止める（誰も操作できない試合を始めない）
  updateLobby(dt: number) {
    if (this.lobbyLeft === null) return;
    this.lobbyLeft = Math.max(0, this.lobbyLeft - dt);
    const humans = [...this.players.values()].filter((p) => !p.bot && !this.dropped.has(p.id));
    if (humans.length && humans.every((p) => p.ok)) return this.startMatch();
    if (this.lobbyLeft > 0) return;
    if (humans.length) this.startMatch(); else this.lobbyLeft = null;
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
    if (p.assist) return C.PLAYER_HP * C.ASSIST.hp * C.POWER_MULT[p.tier] * (C.ASSIST.units[p.char]?.hpMult ?? 1);
    let hp = charHp(p.char);
    if (p.ult && !p.ult.pending) hp *= C.ULT_FORMS[p.ult.form].hp * C.ULT_HP_MULT[p.ult.tier];
    return hp;
  }

  addPlayer(id: string, team: number, bot: boolean) {
    const idx = [...this.players.values()].filter((p) => p.team === team).length;
    const s = C.SPAWNS[team];
    const p: Player = {
      id, team, char: pick(PICKABLE), x: s.x, y: s.y + (idx - 1.5) * 40, hp: C.PLAYER_HP, alive: true,
      dx: 0, dy: 0, face: team === 0 ? 0 : Math.PI, rage: 0, bad: 0, wantedHold: false,
      cooldownUntil: 0, stunUntil: 0, respawnAt: 0, respawnTotal: 0, lastHitBy: new Map(),
      bot, role: 'gather', path: [], pathAt: -Infinity, raidBase: -1, visited: [],
      aim: bot ? C.BOT_AIM : C.AIM_MODES[0], tgt: null, inputs: [], ack: 0,
      skillReadyAt: 0, st: {}, sk: {},
      assist: false, tier: 1, ult: null,
      goal: '', stuckX: 0, stuckY: 0, stuckSince: 0, penalty: new Map(), qAt: null, recallAt: null,
      boostUntil: 0, inDx: 0, inDy: 0, slowUntil: 0, weakUntil: 0, eating: false, ok: false, koAt: 0,
      hitAt: -Infinity, lowFight: false, lowUntil: -Infinity,
    };
    this.players.set(id, p);
    return p;
  }

  onDispose() { GameRoom.live.delete(this); }

  // 人間の参加者の数（再接続待ちを含む）
  humanCount() { return [...this.players.values()].filter((p) => !p.bot && !p.assist).length + [...this.dropped].filter((id) => this.players.get(id)?.bot).length; }

  // 入室の判定: BAN は全部の部屋、常設の部屋はメンテ中・対戦中・満員も拒否（再接続はここを通らない）
  onAuth(_client: Client, options: any, ctx?: { ip?: string; headers?: Headers }) {
    const ip = ctx?.headers?.get?.('cf-connecting-ip') ?? ctx?.ip ?? '', bid = typeof options?.bid === 'string' ? options.bid.slice(0, 64) : '';
    if (OG.banned(ip, bid)) throw new ServerError(4403, '入室できません');
    if (this.pub && OG.maintenance()) throw new ServerError(4503, OG.maintText());
    if (this.pub && this.phase !== 'waiting') throw new ServerError(4409, 'この部屋は対戦中です');
    if (this.pub && this.humanCount() >= C.ROOM_FULL) throw new ServerError(4429, 'この部屋は満員です');
    return { ip, bid };
  }

  onJoin(client: Client, options?: { name?: string }) {
    if (this.phase === 'waiting') {
      if (this.players.size >= C.TEAM_SIZE * 2) return; // 観戦
      const counts = [0, 0];
      this.players.forEach((p) => counts[p.team]++);
      const p = this.addPlayer(client.sessionId, counts[0] <= counts[1] ? 0 : 1, false);
      const base = OG.validName(options?.name) ? options!.name! : OG.randomName(); // 部品の組み合わせでない名前は付け直す
      Object.assign(p, { name: OG.uniqueName(base, [...this.players.values()].filter((q) => q !== p).map((q) => q.name ?? '')), ip: client.auth?.ip, bid: client.auth?.bid });
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
    if (p && this.kicked.has(p.id)) { this.dropped.delete(p.id); return client.leave(CloseCode.CONSENTED, OG.banned(p.ip ?? '', p.bid ?? '') ? 'ban' : 'kick'); }
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
    // 常設の部屋: 人間が誰もいなくなったら（再接続待ちもなし）、試合を打ち切って待機に戻す
    if (this.pub && this.phase !== 'waiting' && !this.clients.length && !this.dropped.size) { this.players.clear(); this.setup(); this.lobbyLeft = null; this.unlock(); }
  }

  // 管理ページ: キック（枠は Bot が引き継ぐ。再接続させない）。ban なら以後の入室も拒否
  kick(id: string, ban: boolean) {
    const p = this.players.get(id);
    if (!p || p.bot && !this.dropped.has(id)) return;
    if (ban) OG.addBan({ ip: p.ip ?? '', bid: p.bid ?? '', name: p.name ?? '', at: new Date().toISOString() });
    this.kicked.add(id);
    const sid = [...this.owners].find(([, v]) => v === id)?.[0];
    const client = this.clients.find((c) => c.sessionId === sid);
    if (client) client.leave(CloseCode.CONSENTED, ban ? 'ban' : 'kick'); // onLeave（Bot が引き継ぐ）
  }

  startMatch() {
    this.lobbyLeft = null;
    for (let t = 0; t < 2; t++) {
      while ([...this.players.values()].filter((p) => p.team === t).length < C.TEAM_SIZE) {
        const b = this.addPlayer(`bot${++this.botSeq}`, t, true);
        if (process.env.E2E_HOOKS) b.char = E2E_BOTS[(this.botSeq - 1) % E2E_BOTS.length]; // e2e: Bot は固定の編成（検証が揺らがないように）
      }
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
    this.teams.forEach((t, i) => (t.toku = this.clampToku(C.TOKU_INIT + [...this.players.values()].filter((p) => p.team === i).reduce((a, p) => a + (CHARS[p.char]?.toku ?? 0), 0))));
    while (this.materials.length < C.MATERIAL_MAX * C.MATERIAL_MAX_MULT) this.spawnMaterial();
    for (const [x, y] of C.HEAL_SPOTS) this.items.push({ id: this.nextId++, kind: 'heal', team: -1, x, y }); // ご飯は最初から置いておく
    this.spawnCourier();
    // 新開幕の「散らかったマップの一角」: 資材が一番多く集まっている場所
    const dense = (m: Pt) => this.materials.filter((q) => Math.hypot(q.x - m.x, q.y - m.y) <= C.INTRO2.messR).length;
    const best = [...this.materials].sort((u, v) => dense(v) - dense(u))[0];
    this.introMess = best ? { x: best.x, y: best.y } : { x: C.MAP_W / 2, y: C.MAP_H / 2 };
    this.cm.intro();
  }

  // カウント0（GAME START）: 部屋から出られるようになり、試合時間を数え始める
  beginPlay() {
    this.phase = 'playing';
    this.startedAt = Date.now();
    this.phaseLeft = 0;
    this.teams.forEach((_, i) => this.startSpin(i)); // スロットは GAME START から回す
    this.cm.play();
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
      const c = this.cageOf(p), obs = c && [...moveWalls(p.char, this.obstacles()), ...cage(c)];
      for (let i = p.inputs.length > C.NET_CATCHUP ? 2 : 1; i > 0 && p.inputs.length; i--) {
        const m = p.inputs.shift()!;
        if (obs && p.alive && !this.effect(p, 'lock')) { this.setInput(p.id, m.dx, m.dy); Object.assign(p, stepPlayer(p.x, p.y, m.dx, m.dy, this.speedOf(p), obs)); }
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
      Object.assign(p, moveBody(p.x, p.y, p.dx * sp, p.dy * sp, C.PLAYER_RADIUS, [...moveWalls(p.char, obs), ...cage(C.START_ROOMS[p.team])]));
    }
  }

  obstacles(): Rect[] {
    return this.walls;
  }

  tick(dt: number, send = true) {
    if (send) this.elapsed += dt; // 早送り中も実時間で進める
    if (this.phase === 'intro' || this.phase === 'countdown') {
      this.phaseLeft -= dt;
      if (this.phase === 'intro' && this.phaseLeft <= 0) { this.phase = 'countdown'; this.phaseLeft += C.INTRO_MODE === 'old' ? C.COUNTDOWN : C.INTRO2.count; }
      else if (this.phase === 'countdown' && this.phaseLeft <= 0) this.beginPlay();
    }
    if (this.phase === 'waiting') this.updateLobby(dt);
    if (this.phase === 'intro' || this.phase === 'countdown' || this.phase === 'ended') this.moveHumans();
    if (this.phase === 'countdown' && C.INTRO_MODE !== 'old') this.moveBotsCaged(dt);
    if (this.phase === 'ended') this.updateEnded(dt);
    if (this.phase === 'finale') this.updateFinale(dt);
    if (this.phase !== 'waiting') this.cm.flow(dt); // 実況のタイムライン（試合前後も進める）
    if (this.phase === 'playing') {
      this.now += dt;
      this.timeLeft = Math.max(0, C.MATCH_TIME - this.now);
      this.updateBots();
      this.updatePlayers(dt);
      this.updateShots(dt);
      this.updateEnts(dt);
      this.unstick();
      this.updateBosses();
      this.updateMaterials(dt);
      this.updateHeals();
      this.updateCouriers(dt);
      this.updateAssists();
      this.updateWarns();
      this.updateWanted();
      this.updateReflect(dt);
      this.updateSlots();
      this.cm.tick(dt);
      if (this.timeLeft <= 0) {
        const r = this.bosses.map((b) => b.hp / C.BOSS_HP);
        this.startFinale(r[0] > r[1] ? 0 : r[1] > r[0] ? 1 : 2, 'timeout', null);
      }
    }
    if (this.phase === 'playing') this.recordHist();
    if (!send) return; // 早送り中は最後の1回だけ送る
    this.sendSnapshots();
    this.fx = [];
  }

  // 結果画面: 技（R）の見た目だけ進める（ダメージ・徳・壁の破壊は起きない。部屋から出られないのは今のまま）
  updateEnded(dt: number) {
    this.now += dt;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      SKILLS[p.char]?.ended?.(this, p, dt);
    }
    this.updateShots(dt);
    this.updateEnts(dt);
  }

  // 場の物: 種類ごとに（ENTS の順）更新
  updateEnts(dt: number) {
    for (const kind in ENTS) for (const e of this.ents.filter((x) => x.kind === kind)) ENTS[kind].update(this, e, dt);
  }

  removeEnt(e: Ent) {
    this.ents = this.ents.filter((x) => x !== e);
  }

  // 有効な状態（なければ undefined）
  stat(p: Player, key: string) {
    const s = p.st[key];
    return s && this.now < s.until ? s : undefined;
  }

  // 有効な状態のどれかに効果 flag があるか
  effect(p: Player, flag: keyof Status) {
    for (const k in p.st) if (this.now < p.st[k].until && p.st[k][flag]) return true;
    return false;
  }

  // 有効な lock がすべて still（その場で止まる lock）か
  stillLock(p: Player) {
    const locks = Object.values(p.st).filter((s) => this.now < s.until && s.lock);
    return locks.length > 0 && locks.every((s) => s.still);
  }

  // KO・試合終了で消える状態を消す
  cancelStatuses(p: Player) {
    for (const k in p.st) if (p.st[k].cancel) delete p.st[k];
  }

  // 保険: 壁と重なっているキャラ・大将・ユニット扱いの場の物を最寄りの空き位置へ押し出す
  unstick() {
    const obs = this.obstacles();
    for (const p of this.players.values()) if (p.alive) Object.assign(p, pushOut(p.x, p.y, C.PLAYER_RADIUS, moveWalls(p.char, obs)));
    for (const b of this.bosses) Object.assign(b, pushOut(b.x, b.y, C.BOSS_RADIUS, obs));
    for (const e of this.ents) if (e.body === 'unit') Object.assign(e, pushOut(e.x, e.y, e.r, obs));
  }

  // 決着: 演出（finale）を始める。試合ログはここで書く（試合時間に演出を含めない）
  startFinale(winner: number, kind: 'boss' | 'timeout', killer: Player | null) {
    if (this.phase !== 'playing') return;
    this.phase = 'finale';
    this.winner = winner;
    const b = kind === 'boss' ? this.bosses[1 - winner] : null;
    this.finale = { kind, winner, stage: kind === 'boss' ? 'slow' : 'timeup', t: 0, boss: b && { team: b.team, x: b.x, y: b.y }, killer: null };
    for (const p of this.players.values()) { p.dx = p.dy = 0; p.qAt = p.recallAt = null; }
    this.writeLog(kind);
    this.cm.finale(this.finale, killer);
    this._killer = killer;
  }
  private _killer: Player | null = null;

  // 決着演出の進行: スロー中は弾・場の物だけ slowRate 倍で進める（キャラ・Bot・スロットなどは止める）。入力は捨てる。段の終わりで次の段へ、最後に現行の決着後へ
  updateFinale(dt: number) {
    const f = this.finale!, F = C.FINALE;
    for (const p of this.players.values()) while (p.inputs.length) p.ack = p.inputs.shift()!.seq;
    f.t += dt;
    if (f.stage === 'slow') { const d = dt * F.slowRate; this.now += d; this.updateShots(d); this.updateEnts(d); }
    const len = { slow: F.slow, boss: F.cam + F.boom, killer: F.cam + F.killer, timeup: F.timeup, win: F.win }[f.stage];
    if (f.t < len) return;
    f.t = 0;
    if (f.stage === 'slow') f.stage = 'boss';
    else if (f.stage === 'boss') {
      const k = this._killer;
      f.stage = 'killer';
      f.killer = k && { id: k.id, char: k.char, team: k.team, assist: k.assist, x: k.x, y: k.y };
    } else if (f.stage === 'killer' || f.stage === 'timeup') f.stage = 'win';
    else return this.endMatch(f.winner, f.kind);
    this.cm.finale(f, this._killer);
  }

  endMatch(winner: number, kind: 'boss' | 'timeout' = 'timeout') {
    if (this.phase === 'ended') return;
    this.finale = null; this._killer = null;
    this.phase = 'ended';
    this.winner = winner;
    this.writeLog(kind);
    this.cm.end(winner, kind);
    // 各陣営の全員を、自陣の大将が最後にいた部屋に集める（倒れていた人も戻す。撃破の演出中のアシストは消す）
    for (const p of [...this.players.values()]) if (p.assist && !p.alive) this.players.delete(p.id);
    for (const t of [0, 1]) {
      const r = this.cageOf({ team: t } as Player)!, list = [...this.players.values()].filter((p) => p.team === t);
      list.forEach((p, i) => {
        const x = r.x + r.w / 2 + ((i % 4) - 1.5) * 28, y = r.y + r.h / 2 + C.BOSS_RADIUS + 20 + Math.floor(i / 4) * 28;
        this.cancelStatuses(p);
        Object.assign(p, { alive: true, dx: 0, dy: 0 }, pushOut(Math.max(r.x + 12, Math.min(r.x + r.w - 12, x)), Math.min(r.y + r.h - 12, y), C.PLAYER_RADIUS, this.obstacles()));
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
    if (p.assist) return C.PLAYER_SPEED * C.ASSIST.speed * (C.ASSIST.units[p.char]?.speedMult ?? 1) * slow * (this.now < p.boostUntil ? C.ASSIST.units.shirakami.boost : 1);
    let sp = charSpeed(p.char);
    if (this.now < p.boostUntil) sp *= C.ASSIST.units.shirakami.boost;
    sp *= slow;
    for (const k of STATUS_ORDER) { const s = this.stat(p, k); if (s?.speed !== undefined) sp *= s.speed; } // 状態の移動倍率
    if (p.ult && !p.ult.pending) sp *= C.ULT_FORMS[p.ult.form].speed;
    return sp;
  }

  updatePlayers(dt: number) {
    const obs = this.obstacles();
    for (const p of this.players.values()) {
      if (!p.alive) {
        while (p.inputs.length) p.ack = p.inputs.shift()!.seq; // 倒れている間の入力は捨てる
        p.bad = Math.max(0, p.bad - BAD_DECAY * dt); // 反省中は悪行ポイントが減る（0で止まる）
        if (p.assist) { if (!this.dying(p)) this.players.delete(p.id); } // 倒れたアシストは大爆発の後に消える
        else if (this.now >= p.respawnAt) this.respawn(p);
        continue;
      }
      const locked = this.effect(p, 'lock'); // 移動不可の状態では通常の移動をしない
      const px = p.x, py = p.y; // 移動前の位置（技処理の判定用）
      if (!p.bot) {
        // 人間: 届いた入力を1tickに1つ（溜まっていれば2つ）、クライアントと同じ計算で処理
        p.dx = p.dy = 0;
        for (let i = p.inputs.length > C.NET_CATCHUP ? 2 : 1; i > 0 && p.inputs.length; i--) {
          const m = p.inputs.shift()!;
          this.setInput(p.id, m.dx, m.dy);
          if (Number.isFinite(m.rt)) p.viewT = m.rt; // この入力を送ったときの画面の時刻
          if (this.now >= p.stunUntil && !locked) Object.assign(p, stepPlayer(p.x, p.y, m.dx, m.dy, this.speedOf(p), moveWalls(p.char, obs)));
          p.ack = m.seq;
        }
      } else if (this.now >= p.stunUntil && !locked) {
        const sp = this.speedOf(p) * dt;
        Object.assign(p, moveBody(p.x, p.y, p.dx * sp, p.dy * sp, C.PLAYER_RADIUS, moveWalls(p.char, obs)));
      }
      SKILLS[p.char]?.afterMove?.(this, p, dt, px, py, locked);
      if (!p.assist) {
        // 資材は触れると拾う（持ち運ばない。徳が上がる）
        for (const m of [...this.materials]) {
          if (!this.touches(p, m, C.MATERIAL_PICKUP_BOX)) continue;
          this.materials = this.materials.filter((x) => x !== m);
          this.addToku(p.team, p, m.big ? 'materialBig' : m.hi ? 'materialBack' : 'material', ''); // 表示は「徳+XX」だけ
        }
        // 回復アイテム・荷物も触れるだけで拾う
        for (const it of [...this.items]) if (this.touches(p, it)) this.takeItem(p, it);
      }
      // リコール: 溜まったら自陣の給湯室へワープ（Bot はそこでご飯を食べて回復する）
      if (p.recallAt !== null && this.now - p.recallAt >= C.RECALL_HOLD) {
        const r = C.RECALL_ROOMS[p.team];
        p.recallAt = null;
        this.addFx(p, 'recall', {}); // 元いた場所に瞬間移動の跡
        Object.assign(p, pushOut(r.x + r.w / 2, r.y + r.h / 2, C.PLAYER_RADIUS, obs));
        p.hp = Math.min(this.maxHp(p), p.hp + this.maxHp(p) * C.RECALL_HEAL);
        this.fxAtBody(p, 'aura', { r: 30, color: 'assist' });
        if (p.bot) p.eating = true;
      }
      // ウルトの時間切れ: 元のキャラがその場にHP100%で戻る
      if (p.ult && !p.ult.pending && this.now >= p.ult.until) this.endUlt(p);
      // 回復する状態の間は少しずつ回復（最大HPまで）
      for (const k of STATUS_ORDER) { const s = this.stat(p, k); if (s?.regen !== undefined && p.hp < this.maxHp(p)) p.hp = Math.min(this.maxHp(p), p.hp + s.regen * dt); }
      SKILLS[p.char]?.tick?.(this, p, dt);
      // オートアタック: 照準モードで選んだ対象へ、クールタイムが明けたら自動で攻撃（移動不可の状態では攻撃しない）
      // 人間の近接AAは、相手の位置をその人の画面の時刻まで戻して対象を選ぶ（巻き戻した対象が近接で届くときだけ。弾のモードは今の位置）
      p.tgt = this.pickTarget(p);
      const lt = this.lagT(p), rt = lt === null ? null : this.pickTarget(p, undefined, lt);
      if (rt && this.meleeAt(p, rt)) p.tgt = rt;
      if (p.tgt && !locked && this.now >= p.cooldownUntil && !this.effect(p, 'noAuto') && !this.noAuto.has(p.id)) this.attack(p.id, Math.atan2(p.tgt.y - p.y, p.tgt.x - p.x));
    }
  }

  // アイテムの取得判定: 全キャラ共通の縦長長方形（足元から上へ。キャラの大きさによらない）。徳は MATERIAL_PICKUP_BOX
  touches(p: Pt, o: Pt, B = C.PICKUP_BOX) {
    return Math.abs(o.x - p.x) <= B.w / 2 && o.y >= p.y - B.up && o.y <= p.y + B.down;
  }

  // 自陣の給湯室（リコール先）にいるか
  atBase(p: Player) {
    return inRect(p.x, p.y, C.RECALL_ROOMS[p.team]);
  }

  respawn(p: Player) {
    const s = C.SPAWNS[p.team];
    if (p.ult?.pending) Object.assign(p.ult, { pending: false, until: this.now + C.ULT_DURATION }); // 撤退中に選ばれたウルトは復活後に始まる
    Object.assign(p, { alive: true, x: s.x, y: s.y, eating: false, stunUntil: 0, st: {}, recallAt: null, boostUntil: 0 });
    p.hp = this.maxHp(p);
    p.lastHitBy.clear();
  }

  // ---- 徳・資材・回復アイテム・荷物・ウルト・アシスト ----

  clampToku(v: number) { return Math.max(C.TOKU_MIN, Math.min(C.TOKU_MAX, v)); }

  // 徳の増減（陣営の共有値）。p がいれば頭上に内容と増減を出し（text が空なら増減だけ）、下げた分は悪行ポイントに足す。アシストの行動は徳に影響しない
  addToku(team: number, p: Player | null, key: string, text = C.TOKU_TEXT[key]) {
    if (p?.assist) return;
    const d = key === 'slot' ? C.SLOT.winToku : C.TOKU[key];
    this.teams[team].toku = this.clampToku(this.teams[team].toku + d);
    if (!p) return;
    const bad = d < 0 ? -d * (C.BAD_MULT[key] ?? 1) : 0;
    this.cm.tokuBy(p, d, bad);
    if (bad) { p.bad += bad; if (p.alive) p.wantedHold = false; }
    this.addFx(p, 'toku', { text, d, hi: key === 'materialBack' || key === 'materialBig' });
  }

  // 資材を1個、マップのどこか（中央の部屋を除く全部屋・廊下の床）に置く。MATERIAL_BACK の比率で裏側に出す（高ポイント）。ほかの資材とは重ねない
  spawnMaterial() {
    const back = Math.random() < C.MATERIAL_BACK;
    for (let i = 0; i < 200; i++) {
      const tx = Math.floor(Math.random() * MAP.width), ty = Math.floor(Math.random() * MAP.height);
      const kind = roomKindAt(tx, ty);
      if (this.tiles[ty]?.[tx] !== '.' || kind === null || CENTER_ROOMS.includes(kind) || isBackAt(tx, ty) !== back) continue;
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
      this.fxAtBody(p, 'aura', { r: 24, color: 'heal' });
      this.addToku(p.team, p, 'eat'); // 盗み食い
    } else if (it.kind === 'box_ult') { this.giveUlt(p, lottery(C.POWER_WEIGHTS)); this.cm.pickup(p, it.kind); } // 拾った本人が変身
    else if (it.kind === 'box_assist') { this.summonAssist(p.team, lottery(C.POWER_WEIGHTS), undefined, true); this.cm.pickup(p, it.kind); } // 拾った陣営にアシスト
  }

  // アシストを召喚: ASSIST.units からランダム。召喚した陣営の大将の所に現れ、敵大将へ向かう。両陣営に通知
  // quiet: 実況の「助っ人の登場」を出さない（荷物から呼んだときは荷物のセリフで兼ねる）
  summonAssist(team: number, tier: number, char = pick(Object.keys(C.ASSIST.units)), quiet = false) {
    // 同時に出せる数を超える召喚は、今のアシストの強化: 強さを1段階上げ（上限あり）、HPを新しい最大値まで回復
    const cur = [...this.players.values()].filter((q) => q.assist && q.team === team && q.alive);
    if (cur.length >= C.ASSIST.max) {
      const a = cur[0];
      a.tier = Math.min(C.POWER_TIERS.length - 1, a.tier + 1);
      a.hp = this.maxHp(a);
      for (const c of this.clients) c.send('assistUp', { char: a.char, tier: a.tier, team }); // 両陣営に通知
      this.addFx(a, 'aura', { r: 40, color: 'assist' });
      this.cm.assistUp(a);
      return a;
    }
    const boss = this.bosses[team];
    const a = this.addPlayer(`assist${this.nextId++}`, team, true);
    Object.assign(a, { char, assist: true, tier, role: 'raid', aim: C.BOT_AIM, x: boss.x + C.BOSS_RADIUS + C.PLAYER_RADIUS + 4, y: boss.y, skillReadyAt: this.now + C.ASSIST.units[char].every });
    Object.assign(a, pushOut(a.x, a.y, C.PLAYER_RADIUS, this.obstacles()));
    a.hp = this.maxHp(a);
    for (const c of this.clients) c.send('assist', { char, tier, team }); // 両陣営に通知
    this.addFx(a, 'aura', { r: 40, color: 'assist' });
    this.cm.assistIn(a, quiet);
    return a;
  }

  // ウルト: 変身先はランダム。変身中なら効果時間だけリセット。撤退中なら復活後に始まる
  giveUlt(q: Player, tier: number) {
    if (q.ult) { q.ult.until = this.now + C.ULT_DURATION; return; }
    q.ult = { form: pick(Object.keys(C.ULT_FORMS)), tier, until: this.now + C.ULT_DURATION, pending: !q.alive };
    if (q.alive) { q.hp = this.maxHp(q); this.fxAtBody(q, 'aura', { r: 50, color: 'ult' }); }
  }

  // ブイブイ・コバコ: entrance（中央下部）に出て、荷物を1つ持って中央3部屋の往復を始める
  spawnCourier() {
    const s = C.COURIER_START, box = Object.keys(C.COURIER.box)[lottery(Object.values(C.COURIER.box))];
    this.couriers = [{ id: this.nextId++, team: -1, x: s.x, y: s.y, hp: 1, path: [], pathAt: -Infinity, wp: 1, dir: 1, box }];
  }

  // 往復の次の地点（両端で折り返す）
  nextWp(c: Courier) {
    if (c.wp + c.dir < 0 || c.wp + c.dir >= C.COURIER_ROUTE.length) c.dir = -c.dir;
    c.wp += c.dir;
  }

  // コバコ: 巡回経路（中央3部屋）を往復する。KO中は復活を待つ
  updateCouriers(dt: number) {
    if (!this.couriers.length) { if (this.now >= this.courierAt) this.spawnCourier(); return; }
    const c = this.couriers[0], obs = this.obstacles(), to = C.COURIER_ROUTE[c.wp];
    if (Math.hypot(to.x - c.x, to.y - c.y) < C.COURIER.reach) { this.courierArrive(to); this.nextWp(c); c.path = []; return; }
    if (this.now - c.pathAt >= C.BOT_REPATH || !c.path.length) { c.path = findPath(c, to, obs, this.walls); c.pathAt = this.now; }
    while (c.path.length && Math.hypot(c.path[0].x - c.x, c.path[0].y - c.y) < 6) c.path.shift();
    if (!c.path.length && Math.hypot(to.x - c.x, to.y - c.y) > C.COURIER.reach && findPath(c, to, obs, this.walls).length === 0) { this.nextWp(c); return; } // 行けない地点は飛ばす
    const n = c.path[0] ?? to, d = Math.hypot(n.x - c.x, n.y - c.y) || 1, m = Math.min(C.PLAYER_SPEED * C.COURIER.speed * dt, d);
    Object.assign(c, moveBody(c.x, c.y, ((n.x - c.x) / d) * m, ((n.y - c.y) / d) * m, C.PLAYER_RADIUS, obs));
  }

  // コバコが巡回の部屋に着いた: その部屋の未取得のコバコの徳が cap 個未満なら、高性能の徳を COURIER_DROP.n 個置く
  courierArrive(to: (typeof C.COURIER_ROUTE)[number]) {
    const A = to.area, D = C.COURIER_DROP;
    let n = this.materials.filter((m) => m.big && inRect(m.x, m.y, A)).length < D.cap ? D.n : 0;
    for (let i = 0; i < 200 && n > 0; i++) {
      const tx = Math.floor((A.x + Math.random() * A.w) / T), ty = Math.floor((A.y + Math.random() * A.h) / T);
      if (this.tiles[ty]?.[tx] !== '.') continue;
      const x = tx * T + T / 2, y = ty * T + T / 2;
      if ([...this.materials, ...this.items].some((m) => Math.hypot(m.x - x, m.y - y) < C.MATERIAL_GAP)) continue; // 既存のアイテムと重ねない
      this.materials.push({ id: this.nextId++, x, y, hi: false, big: true });
      n--;
    }
  }

  // 回復アイテム: 欠けた置き場所（HEAL_SPOTS）ごとに、HEAL_RESPAWN 秒後に再出現する
  updateHeals() {
    C.HEAL_SPOTS.forEach(([x, y], i) => {
      if (this.items.some((it) => it.kind === 'heal' && Math.hypot(it.x - x, it.y - y) < 8)) { this.healAt[i] = null; return; }
      if (this.healAt[i] == null) this.healAt[i] = this.now + C.HEAL_RESPAWN;
      else if (this.now >= this.healAt[i]!) { this.items.push({ id: this.nextId++, kind: 'heal', team: -1, x, y }); this.healAt[i] = null; }
    });
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

  // 敵の攻撃対象の一覧
  enemyThings(team: number): Thing[] {
    const out: Thing[] = [];
    for (const e of this.players.values()) if (e.team !== team && e.alive) out.push({ k: 'p', o: e, x: e.x, y: e.y, r: C.PLAYER_RADIUS });
    const b = this.bosses[1 - team];
    out.push({ k: 'boss', o: b, x: b.x, y: b.y, r: C.BOSS_RADIUS });
    for (const o of this.ents) if (o.body === 'unit' && o.team !== team) out.push({ k: 'e', o, x: o.x, y: o.y, r: o.r });
    for (const o of this.couriers) if (o.team !== team) out.push({ k: 'c', o, x: o.x, y: o.y, r: C.PLAYER_RADIUS });
    return out;
  }

  // 壁に遮られていないか
  reach(p: Pt, t: Thing) {
    return lineOfSight(p.x, p.y, t.x, t.y, this.obstacles());
  }

  // 通常攻撃の射程（ウルト中は変身先、ほかはモードのうち一番長いもの）
  atkRange(p: Player) {
    if (p.ult && !p.ult.pending) return C.ULT_FORMS[p.ult.form].range;
    return aaRange(p.char);
  }

  // 照準モードで対象を選ぶ。コバコのモードは射程内のコバコを最優先。ほかはユニット（敵プレイヤー・大将・ユニット扱いの場の物）を優先し、いなければコバコ以外の対象
  // T: 相手の位置をこのサーバー時刻（elapsed）まで戻して選ぶ（人間の近接AAの巻き戻し判定）
  pickTarget(p: Player, R = this.atkRange(p), T?: number): Thing | null {
    const d = (t: Thing) => Math.hypot(t.x - p.x, t.y - p.y);
    const all = (T === undefined ? this.enemyThings(p.team) : this.rewound(this.enemyThings(p.team), T)).filter((t) => d(t) <= R + t.r && this.targetable(t) && this.reach(p, t));
    const c = p.aim === 'courier' && all.find((t) => t.k === 'c');
    if (c) return c;
    const inRange = all.filter((t) => t.k !== 'c'); // コバコはコバコのモードでだけ狙う
    const units = inRange.filter(isUnit);
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

  // ---- 近接AAの巻き戻し判定（ラグ補償） ----
  hist: { t: number; pos: Map<string, Pt> }[] = []; // tick ごとのプレイヤー・大将・コバコの位置（elapsed で記録。NET_REWIND_MAX より少し長く持つ）

  recordHist() {
    const pos = new Map<string, Pt>();
    for (const p of this.players.values()) pos.set(`p:${p.id}`, { x: p.x, y: p.y });
    for (const b of this.bosses) pos.set(`boss:${b.team}`, { x: b.x, y: b.y });
    for (const c of this.couriers) pos.set(`c:${c.id}`, { x: c.x, y: c.y });
    const last = this.hist[this.hist.length - 1];
    if (last && last.t === this.elapsed) last.pos = pos; else this.hist.push({ t: this.elapsed, pos });
    while (this.hist.length > 2 && this.hist[1].t < this.elapsed - C.NET_REWIND_MAX - 0.2) this.hist.shift();
  }

  // 巻き戻す時刻: 人間（アシスト・Bot 以外）で、描画時刻があれば。上限 NET_REWIND_MAX
  lagT(p: Player): number | null {
    if (p.bot || p.assist || p.viewT === undefined) return null;
    return Math.min(this.elapsed, Math.max(p.viewT, this.elapsed - C.NET_REWIND_MAX));
  }

  // 相手の位置を時刻 T に戻した写し（記録の間は線形補間。記録のない相手・場の物は今の位置）。o は本物なのでダメージはそのまま入る
  rewound(things: Thing[], T: number): Thing[] {
    const h = this.hist;
    let i = h.length - 1;
    while (i > 0 && h[i - 1].t >= T) i--;
    const b = h[i], a = i > 0 ? h[i - 1] : b;
    return things.map((t) => {
      const id = thingId(t), pa = a?.pos.get(id), pb = b?.pos.get(id);
      if (!pa || !pb || T >= b.t) return t;
      const k = b.t > a.t ? Math.max(0, Math.min(1, (T - a.t) / (b.t - a.t))) : 1;
      return { ...t, x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k } as Thing;
    });
  }

  // その対象への通常攻撃が近接になるか（ウルトの近接の変身を含む）
  meleeAt(p: Player, t: Thing) {
    if (p.ult && !p.ult.pending) return !C.ULT_FORMS[p.ult.form].ranged;
    return aaMode(p.char, Math.hypot(t.x - p.x, t.y - p.y)).kind === 'melee';
  }

  // 敵の対象にできるか（敵の対象にならない状態のプレイヤーは除く）
  targetable(t: Thing) {
    return !(t.k === 'p' && this.effect(t.o, 'hidden'));
  }

  // 技・攻撃の向き: 狙っている対象があればその方向、なければ向いている方向
  aimOf(p: Player) {
    return p.tgt ? Math.atan2(p.tgt.y - p.y, p.tgt.x - p.x) : p.face;
  }

  // 技の向き: 技の射程 R で通常攻撃と同じ照準ルール（pickTarget）で選んだ対象の方向、いなければ向いている方向
  skillAim(p: Player, R: number) {
    const t = this.pickTarget(p, R);
    return t ? Math.atan2(t.y - p.y, t.x - p.x) : p.face;
  }

  inArc(p: Player, tx: number, ty: number, tr: number, aim = p.face, range = C.ATTACK_RANGE, arc = C.ATTACK_ARC): boolean {
    const d = Math.hypot(tx - p.x, ty - p.y);
    if (d > range + tr) return false;
    let a = Math.atan2(ty - p.y, tx - p.x) - aim;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.abs(a) <= arc / 2;
  }

  // 通常攻撃の間隔: 使うモードの間隔（ウルト中は近接）
  atkCooldown(p: Player) {
    if (p.ult && !p.ult.pending) return C.ATTACK_COOLDOWN_MELEE;
    return aaMode(p.char, p.tgt ? Math.hypot(p.tgt.x - p.x, p.tgt.y - p.y) : null).cd;
  }

  // courier: コバコにも当てる（照準モードがコバコのとき。Bot のコバコ攻撃は true を渡す）
  attack(id: string, aim?: number, courier?: boolean) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'playing' || !p.alive || this.effect(p, 'noAttack') || this.now < p.stunUntil || this.now < p.cooldownUntil) return;
    p.cooldownUntil = this.now + this.atkCooldown(p);
    this.cancelRecall(p); // 攻撃でリコール中断
    const a = aim ?? p.face, toC = courier ?? p.aim === 'courier';
    if (SKILLS[p.char]?.attack?.(this, p, a)) return; // 技による通常攻撃の上書き
    const aaShot = (s: Shot) => Object.assign(s, { aa: true, courier: toC });
    let dmg = p.assist ? C.ATTACK_DAMAGE * (roleOf(p.char)?.atk ?? 1) * C.POWER_MULT[p.tier] : charAtk(p.char);
    let range = C.ATTACK_RANGE, arc = C.ATTACK_ARC, fx: string | undefined;
    if (p.ult && !p.ult.pending) {
      const f = C.ULT_FORMS[p.ult.form];
      dmg *= f.atk * C.POWER_MULT[p.ult.tier];
      if (f.ranged) { aaShot(this.shoot(p, 'bullet', a, f.range, dmg)); return; }
      range = f.range; arc = f.arc;
    } else {
      // 通常攻撃のモード（対象までの距離と状態で決まる）: 弾なら撃つ、近接なら前方の扇形
      const m = aaMode(p.char, p.tgt ? Math.hypot(p.tgt.x - p.x, p.tgt.y - p.y) : null);
      if (m.kind === 'shot') { aaShot(this.shoot(p, m.shot!, a, m.range, dmg * m.dmg, m.speed)); return; }
      dmg *= m.dmg; range = m.range; fx = m.fx;
    }
    this.addFx(p, 'slash', { a, r: range, arc, who: p.id, ...(fx && { color: fx }) }); // 斬撃のエフェクト（向き・射程・角度）。fx: 技ごとの描画に差し替える。who: 自分の斬撃は画面の自キャラの位置に描く
    const lt = this.lagT(p); // 人間の近接AA: 相手の位置をその人の画面の時刻まで戻して当てる（攻撃した側は今の位置、壁は今の壁）
    for (const t of lt === null ? this.enemyThings(p.team) : this.rewound(this.enemyThings(p.team), lt)) {
      if ((toC || t.k !== 'c') && this.inArc(p, t.x, t.y, t.r, a, range, arc) && this.reach(p, t)) this.hitThing(p, t, dmg, true);
    }
  }

  // 対象にダメージ。全体の倍率、attacker の大将へ×2（技にも掛かる）。aa: 通常攻撃（当たった側に汗のエフェクト。KOの表示の手段）
  hitThing(p: Player, t: Thing, base: number, aa = false) {
    if (this.phase !== 'playing') return; // 結果画面の技は見た目だけ
    if (this.now < p.weakUntil) base *= C.SLOT.penalty.weak; // スロットの罰の攻撃力低下
    for (const k in p.st) if (this.now < p.st[k].until && p.st[k].atk !== undefined) base *= p.st[k].atk!; // 与えるダメージの倍率の状態（ずんだ餅など）
    if (t.k === 'c' && this.courierGuard && p.bot) return; // e2e: Bot の攻撃ではコバコが倒れない
    if (aa && t.k === 'p' && this.effect(t.o, 'noAaDmg')) return; // 通常攻撃のダメージを受けない状態
    if (t.k === 'c') { this.addToku(p.team, p, 'courier'); this.cm.courier(p); return this.koCourier(t.o); } // コバコは1発でKO
    this.addToku(p.team, p, 'hit');
    let dmg = base * C.DAMAGE_MULT;
    if (t.k === 'boss' && roleOf(p.char)?.name === 'attacker') dmg *= C.ATTACKER_BOSS_MULT;
    if (aa) this.addFx({ x: t.x, y: t.y, team: t.o.team }, 'sweat', {});
    if (t.k === 'p') this.damagePlayer(t.o, dmg, p.id, false, aa ? '通常攻撃' : p.assist ? '技' : CHARS[p.char]?.skill.name ?? '技');
    else if (t.k === 'boss') this.damageBoss(t.o, dmg, p);
    else if (t.k === 'e') { t.o.hp! -= dmg; if (t.o.hp! <= 0) { this.removeEnt(t.o); this.cm.entDown(p, t.o, aa); } }
  }

  // how: 手段（KOの表示用。attacker なしは 大将の攻撃／スロットの罰）
  damagePlayer(v: Player, dmg: number, attacker: string | null, raw = false, how = raw ? 'スロットの罰' : '大将の攻撃') {
    if (!v.alive || this.phase !== 'playing' || this.effect(v, 'invincible')) return; // 無敵の状態
    if (this.effect(v, 'fragile')) dmg = 1e9; // 被弾で即死の状態
    // 被ダメ軽減（重なるときは掛け算）: defense / balance（近くに味方がいない）/ ウルトの変身先。raw（罰のダメージ）は軽減しない
    const role = raw ? undefined : roleOf(v.char)?.name;
    if (role === 'defense') dmg *= 1 - C.DEFENSE_CUT;
    if (role === 'balance' && ![...this.players.values()].some((a) => a !== v && a.team === v.team && a.alive && Math.hypot(a.x - v.x, a.y - v.y) <= C.BALANCE_ALONE_RADIUS)) dmg *= 1 - C.BALANCE_ALONE_CUT;
    if (v.ult && !v.ult.pending && !raw) dmg *= C.ULT_FORMS[v.ult.form].def;
    v.hp -= Math.round(dmg);
    v.hitAt = this.now;
    this.cancelRecall(v); // 被弾でリコール中断
    if (attacker) v.lastHitBy.set(attacker, this.now);
    this.cm.damage(v, attacker ? this.players.get(attacker) ?? null : null, dmg, how);
    if (v.hp > 0) return;
    if (v.ult && !v.ult.pending) return this.endUlt(v); // ウルト中に撃破されたら、元のキャラがその場にHP100%で戻る
    v.alive = false;
    v.hp = 0;
    v.koAt = this.now;
    v.recallAt = null;
    this.cancelStatuses(v); // KOで消える状態（タメ中に倒されたら突撃は不発。CTは消費済み）
    const killer = attacker ? this.players.get(attacker) : undefined;
    if (killer && !v.assist) for (const c of this.clients) if (this.owners.get(c.sessionId) === killer.id) c.send('ko', { victimChar: v.char, how }); // KOカットイン用（アシストは立ち絵がないので出さない）
    // 倒された本人へ: 誰に（kc: キャラ。大将は大将のキャラ、罰は null）何で倒されたか
    for (const c of this.clients) if (this.owners.get(c.sessionId) === v.id) c.send('koed', { kc: killer?.char ?? (raw ? null : BOSS_CHAR[1 - v.team]), kt: killer?.team ?? 1 - v.team, how });
    for (const c of this.clients) c.send('kill', { kc: killer?.char ?? null, kt: killer?.team ?? 1 - v.team, vc: v.char, vt: v.team }); // キルログ用（kc なし＝大将の反撃）
    this.cm.kill(v, killer, how, raw);
    if (killer) killer.rage += C.RAGE_KILL;
    // 徳: 相手をKOすると下がる。指名手配中の相手なら上がる（アシストを倒したときは数えない）
    if (killer && !v.assist) this.addToku(killer.team, killer, this.teams[v.team].wanted === v.id ? 'wantedKo' : 'ko');
    v.wantedHold = true; // 倒されると指名手配が外れ、復帰後に悪行が増えるまで手配しない（悪行ポイントは反省中に減る）
    if (this.teams[v.team].wanted === v.id) this.teams[v.team].wanted = null;
    for (const [aid, t] of v.lastHitBy) {
      const a = this.players.get(aid);
      if (a && aid !== attacker && this.now - t <= C.ASSIST_WINDOW) a.rage += C.RAGE_ASSIST;
    }
    if (v.assist) return; // アシストは復活しない（撃破の演出の大爆発の後に消す: updatePlayers）
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
    this.cm.bossDmgBy(p, dmg);
    if (boss.hp <= 0) return this.startFinale(1 - boss.team, 'boss', p); // 止めを刺したキャラ（大将は大将を攻撃しない）
    this.cm.bossHit(boss);
    if (boss.dmgAtBase >= C.BOSS_MOVE_THRESHOLD && this.now >= boss.holdUntil) {
      this.cm.bossWarn(boss);
      // 無敵になり、予告のあと広範囲攻撃、それから移動（updateWarns）
      boss.moving = true;
      this.warns.push({ id: this.nextId++, team: boss.team, owner: '', x: boss.x, y: boss.y, r: C.BOSS_BLAST.r, at: this.now + C.BOSS_BLAST.warn, dmg: C.BOSS_BLAST.dmg, follow: null, boss: true });
    }
  }

  // 大将の拠点移動: 別の拠点へ。以降は第2形態
  moveBoss(boss: Boss) {
    const others = this.bases[boss.team].map((_, i) => i).filter((i) => i !== boss.base);
    boss.base = others[Math.floor(Math.random() * others.length)];
    const b = this.bases[boss.team][boss.base], first = !boss.moved;
    Object.assign(boss, { x: b.x, y: b.y, dmgAtBase: 0, moving: false, moved: true });
    this.cm.bossMoved(boss, first);
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
      const as = [...this.players.values()].filter((q) => q.assist && q.alive && q.team !== b.team && !this.effect(q, 'hidden') && Math.hypot(q.x - b.x, q.y - b.y) <= C.BOSS_RANGE && lineOfSight(b.x, b.y, q.x, q.y, obs)).sort((u, v) => Math.hypot(u.x - b.x, u.y - b.y) - Math.hypot(v.x - b.x, v.y - b.y))[0];
      if (as) b.target = as.id;
      if (!b.target) continue;
      const t = this.players.get(b.target);
      if (!t || !t.alive || this.effect(t, 'hidden')) { b.target = null; continue; }
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
    const foes = [...this.players.values()].filter((q) => q.team !== b.team && q.alive && !this.effect(q, 'hidden') && Math.hypot(q.x - b.x, q.y - b.y) <= B.range && lineOfSight(b.x, b.y, q.x, q.y, obs));
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
    if (this.materials.filter((m) => !m.big).length < C.MATERIAL_MAX * C.MATERIAL_MAX_MULT) this.spawnMaterial(); // コバコが置いた高性能の徳は数えない
  }

  // 指名手配: 陣営ごとに、悪行ポイントがしきい値以上で一番多い人1人（アシストは除く）
  updateWanted() {
    this.teams.forEach((t, team) => {
      const top = [...this.players.values()].filter((p) => p.team === team && !p.assist && !p.wantedHold && p.bad >= C.WANTED_MIN).sort((u, v) => v.bad - u.bad)[0];
      t.wanted = top?.id ?? null;
    });
  }

  // ---- スロット ----

  // 回転を始める。結果はこの時点で1回のくじで決める（当たり・罰の確率は徳で決まる、残りは外れ）。罰は ×××、外れは3つそろわない並び
  startSpin(team: number, result?: 'win' | 'pen' | 'miss') {
    const toku = this.teams[team].toku, u = Math.random(), pw = slotRate(toku);
    const res = result ?? (this.slotMiss ? 'miss' : u < pw ? 'win' : u < pw + penaltyRate(toku) ? 'pen' : 'miss');
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
      this.fxAtBody(q, 'aura', { r: 26, color: `pen_${kind}` });
    }
    for (const c of this.clients) c.send('penalty', { team, kind });
    this.cm.penalty(team, kind);
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
    this.cm.slot(team, chain, kind);
  }

  // 位置を持つもの（キャラ・大将・ユニット扱いの場の物）
  bodies() {
    return [
      ...[...this.players.values()].filter((p) => p.alive).map((p) => ({ x: p.x, y: p.y, r: C.PLAYER_RADIUS })),
      ...this.bosses.map((b) => ({ x: b.x, y: b.y, r: C.BOSS_RADIUS })),
      ...this.ents.filter((e) => e.body === 'unit').map((e) => ({ x: e.x, y: e.y, r: e.r })),
    ];
  }

  // ---- 弾 ----

  shoot(p: Player, kind: Shot['kind'], a: number, range: number, dmg: number, sp = C.BULLET_SPEED) {
    const s: Shot = { id: this.nextId++, kind, team: p.team, owner: p.id, x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, sp, left: range, dmg };
    this.shots.push(s);
    return s;
  }

  // 弾・矢: 壁で止まり、敵（プレイヤー・大将・場の物）に当たると消える
  updateShots(dt: number) {
    for (const s of [...this.shots]) {
      const owner = this.players.get(s.owner);
      s.steer?.(s, dt);
      let step = Math.min(s.sp * dt, s.left), done = (!owner || (owner.assist && !owner.alive)) && !s.boom; // 持ち主がいない（倒れたアシストを含む）弾は消える
      while (step > 0 && !done) {
        const d = Math.min(8, step);
        s.x += (s.vx / s.sp) * d; s.y += (s.vy / s.sp) * d; s.left -= d; step -= d;
        if (this.walls.some((w) => inRect(s.x, s.y, w))) { done = true; break; }
        const hit = this.enemyThings(s.team).find((t) => (!s.aa || s.courier || t.k !== 'c') && Math.hypot(t.x - s.x, t.y - s.y) <= t.r + C.BULLET_RADIUS); // 通常攻撃の弾はコバコを狙うときだけコバコに当たる
        if (hit) {
          done = true;
          if (s.boom) break;
          if (s.onHit) s.onHit(hit);
          else this.hitThing(owner!, hit, s.dmg, s.aa);
          break;
        }
      }
      if (!(done || s.left <= 0)) continue;
      this.shots = this.shots.filter((x) => x !== s);
      if (s.boom && this.phase === 'playing') this.explode(s.team, s.x, s.y, s.boom, s.dmg); // 大将の弾: 着弾地点で爆発
    }
  }

  // ---- キャラ技（R） ----

  addFx(p: Pt & { team: number }, kind: string, extra: Record<string, any>) {
    this.fx.push({ id: this.nextId++, kind, team: p.team, x: p.x, y: p.y, ...extra });
  }

  // 体の中心（自分中心の範囲判定とその輪のエフェクトの基準）。足元から bodyUp（表示倍率: プレイヤー1・アシスト／大将2・コバコ1・ユニット扱いの場の物1、それ以外の場の物は足元＝中心）
  body(t: Thing): Pt {
    const s = t.k === 'p' ? (t.o.assist ? C.ASSIST.scale : 1) : t.k === 'boss' ? 2 : t.k === 'c' || t.o.body === 'unit' ? 1 : 0;
    return { x: t.x, y: t.y - bodyUp(s) };
  }
  bodyOf(p: Player) { return this.body({ k: 'p', o: p, x: p.x, y: p.y, r: C.PLAYER_RADIUS }); }
  // 自分中心の輪のエフェクト: 体の中心に出す
  fxAtBody(p: Player, kind: string, extra: Record<string, any>) { this.addFx({ ...this.bodyOf(p), team: p.team }, kind, extra); }
  // 自分の体の中心から半径 r（＋相手の半径）以内の敵。相手も体の中心で測る
  inBodyCircle(p: Player, r: number) {
    const c = this.bodyOf(p);
    return this.enemyThings(p.team).filter((t) => { const b = this.body(t); return Math.hypot(b.x - c.x, b.y - c.y) <= r + t.r; });
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

  // 重いアシスト（はじかれない。config の ASSIST.units の heavy）
  heavy(t: Thing) {
    return t.k === 'p' && t.o.assist && !!C.ASSIST.units[t.o.char]?.heavy;
  }

  // はじき: 向き(ux,uy)へ dist 動かす。大将・重いアシストには効かない。壁で止まる
  push(t: Thing, ux: number, uy: number, dist: number) {
    if (t.k !== 'p' && !(t.k === 'e' && t.o.body === 'unit')) return;
    if (t.k === 'p' && this.effect(t.o, 'noPush')) return; // はじき無効の状態
    if (this.heavy(t)) return;
    Object.assign(t.o, moveBody(t.o.x, t.o.y, ux * dist, uy * dist, t.k === 'p' ? C.PLAYER_RADIUS : t.o.r, this.obstacles(), false));
  }

  breakWalls(tiles: number[][]) {
    for (const [x, y] of tiles) this.tiles[y] = this.tiles[y].slice(0, x) + '.' + this.tiles[y].slice(x + 1);
    this.broken.push(...tiles);
    this.walls = wallRects(this.tiles); // 当たり判定・視界・経路探索に即反映
  }

  skill(id: string) {
    const p = this.players.get(id);
    const sk = p && CHARS[p.char]?.skill, h = p && SKILLS[p.char];
    if (!p || !sk || !h || (this.phase !== 'playing' && this.phase !== 'ended') || !p.alive || this.now < p.skillReadyAt || this.effect(p, 'noSkill')) return; // 技不可の状態（ずんだ餅など）
    if (h.use(this, p, this.aimOf(p)) !== false) p.skillReadyAt = this.now + sk.ct; // false: CT は技処理が始める
    this.cancelRecall(p); // 技でリコール中断
    if (this.phase === 'playing') this.cm.skill(p); // 実況: 回避の判定
  }

  // 技ボタンを離した（押している間タメる技だけが使う）
  skillUp(id: string) {
    const p = this.players.get(id);
    if (p?.alive) SKILLS[p.char]?.release?.(this, p);
  }

  // 移動入力: 人間は最後に届いた入力（tickの境目で入力が空になっても途切れない）、Bot は今の移動方向
  moveIntent(p: Player): [number, number] {
    return p.bot ? [p.dx, p.dy] : [p.inDx, p.inDy];
  }

  // ---- アシスト（選べないキャラの専用ユニット） ----

  // 技: 一定時間ごと、条件がそろえば発動。強さの倍率を効果に掛ける
  updateAssists() {
    for (const p of this.players.values()) {
      if (!p.assist || !p.alive || this.now < p.skillReadyAt) continue;
      const U = C.ASSIST.units[p.char], k = C.POWER_MULT[p.tier], d = (o: Pt) => Math.hypot(o.x - p.x, o.y - p.y);
      const foes = this.enemyThings(p.team).filter((t) => (t.k === 'p' || t.k === 'boss') && this.targetable(t) && d(t) <= U.sense);
      if (p.char === 'kurono' && foes.length) {
        this.warns.push({ id: this.nextId++, team: p.team, owner: p.id, x: p.x, y: p.y, r: U.r, at: this.now + U.warn, dmg: U.dmg * k, follow: p.id }); // 自分中心（予告の間も付いていく）
      } else if (p.char === 'ritsu' && foes.length) {
        this.warns.push({ id: this.nextId++, team: p.team, owner: p.id, x: p.x, y: p.y, r: U.r, at: this.now + U.warn, dmg: U.dmg * k, follow: p.id, push: U.push, color: 'snow' }); // 自分中心の吹雪（予告の間も付いていく）。はじく距離は強さを掛けない
      } else if (p.char === 'aoyama' && foes.length) {
        const t = foes.find((u) => u.k === 'p' && u.o.assist) ?? [...foes].sort((u, v) => d(u) - d(v))[0]; // 相手のアシストを優先
        this.warns.push({ id: this.nextId++, team: p.team, owner: p.id, x: t.x, y: t.y, r: U.r, at: this.now + U.warn, dmg: U.dmg * k, follow: null }); // 位置は今の時点で固定
      } else if (p.char === 'shirakami') {
        const c = this.bodyOf(p), allies = [...this.players.values()].filter((q) => { const b = this.bodyOf(q); return q.team === p.team && q.alive && q !== p && Math.hypot(b.x - c.x, b.y - c.y) <= U.sense; }); // 回復の範囲は体の中心どうし（輪と一致）
        if (!allies.length) continue;
        for (const q of [p, ...allies]) { q.hp = Math.min(this.maxHp(q), q.hp + U.heal * k); q.boostUntil = this.now + U.dur; }
        this.fxAtBody(p, 'ring', { r: U.sense, color: 'heal' });
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
      for (const t of this.enemyThings(w.team)) {
        if (!isUnit(t) || Math.hypot(t.x - w.x, t.y - w.y) > w.r + t.r) continue;
        this.hitThing(owner, t, w.dmg);
        if (w.push) { const d = Math.hypot(t.x - w.x, t.y - w.y) || 1; this.push(t, (t.x - w.x) / d, (t.y - w.y) / d, w.push); } // 外向きにはじく
      }
      this.addFx(w, w.color ? 'aura' : 'ring', { r: w.r, color: w.color ?? 'dash' });
    }
  }

  // ---- Bot ----

  updateBots() {
    const obs = this.obstacles();
    for (const p of this.players.values()) if (p.bot && p.alive) this.botThink(p, obs);
  }

  // Botが技を使う価値があるか（技の範囲内に対象がいるか）
  botSkillUseful(p: Player): boolean {
    return SKILLS[p.char]?.botUse(this, p) ?? false;
  }

  // Bot の技の判定用: 半径 r 内に ok を満たす敵の対象がいて、遮られていないか
  nearFoe(p: Player, r: number, ok: (t: Thing) => boolean) {
    return this.inCircle(p, p.x, p.y, r).some((t) => ok(t) && this.targetable(t) && this.reach(p, t));
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
    const foes = [...this.players.values()].filter((e) => e.team !== p.team && e.alive && !this.effect(e, 'hidden') && dist(e) <= C.BOT_AGGRO_RANGE && this.visibleTo(p.team, e.x, e.y, obs));
    // リコール: HPが低いとき（給湯室にいるときは使わない）。脅威あり（近くに見える敵／直近の被弾）の間は始めず、溜め中なら中断。給湯室に着いたら、HPが満タンになるまでご飯を食べる
    const low = !this.atBase(p) && p.hp < this.maxHp(p) * C.BOT_RECALL_HP, threat = foes.length > 0 || this.now - p.hitAt < C.BOT_RECALL_SAFE;
    if (threat) { if (p.recallAt !== null) this.cancelRecall(p); }
    else if (low && p.recallAt === null) p.recallAt = this.now;
    if (p.recallAt !== null) { this.setInput(p.id, 0, 0); return; } // 溜め中は止まる（移動・技で中断するため）
    if (p.eating && (p.hp >= this.maxHp(p) || !this.atBase(p))) p.eating = false;
    // 0. 技: CTが明けていて範囲内に対象がいれば使う
    if (this.phase === 'playing' && this.now >= p.skillReadyAt && !this.effect(p, 'noSkill') && this.botSkillUseful(p)) this.skill(p.id);
    // 1. 近くの敵を攻撃（指名手配中の敵を優先）
    const wanted = foes.find((e) => e.id === this.teams[1 - p.team].wanted);
    const enemy = wanted ?? best(foes, (e) => `p:${e.id}`);
    this.botStuck(p, !!enemy || !!p.tgt);
    // 低HPで脅威あり: 狙う敵の残りHPが自分以下なら攻撃、それ以外（見える敵がいない被弾を含む）は自陣の給湯室へ逃亡（射程内の敵には通常攻撃が自動で出る）。決定は BOT_FLEE_COMMIT 秒維持
    if (low && threat) {
      if (this.now >= p.lowUntil) { p.lowFight = !!enemy && enemy.hp <= p.hp * C.BOT_FLEE_RATIO; p.lowUntil = this.now + C.BOT_FLEE_COMMIT; }
      if (!p.lowFight || !enemy) { const r = C.RECALL_ROOMS[p.team]; return go({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, 'flee'); }
    }
    if (enemy) return this.botFight(p, enemy, C.PLAYER_RADIUS, obs);
    if (p.eating) { const f = best(this.items.filter((i) => i.kind === 'heal' && inRect(i.x, i.y, C.RECALL_ROOMS[p.team])), (i) => `item:${i.id}`); if (f) return go(f, `item:${f.id}`); }
    // 2. コバコ: 落とした荷物をすぐ拾える位置にいるときだけ攻撃する
    const c = this.couriers[0];
    if (c && dist(c) <= C.BOT_COURIER_RANGE && this.visibleTo(p.team, c.x, c.y, obs)) {
      p.goal = `c:${c.id}`;
      if (dist(c) <= C.ATTACK_RANGE + C.PLAYER_RADIUS - 4 && lineOfSight(p.x, p.y, c.x, c.y, obs)) { this.setInput(p.id, 0, 0); return this.attack(p.id, Math.atan2(c.y - p.y, c.x - p.x), true); }
      return this.botGoto(p, c, obs);
    }
    // 3. 見えている荷物を拾いに行く（触れると拾う）
    const box = best(this.items.filter((i) => i.kind.startsWith('box_') && this.visibleTo(p.team, i.x, i.y, obs)), (i) => `item:${i.id}`);
    if (box) return go(box, `item:${box.id}`);
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
    if (SKILLS[p.char]?.botMove?.(this, p, b, obs)) return;
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
      p.path = findPath(p, to, moveWalls(p.char, obs), moveWalls(p.char, this.walls));
      p.pathAt = this.now;
    }
    const reach = Math.max(6, this.speedOf(p) / C.TICK_HZ); // 6px 以内、または1tick の移動量以内なら着いた（速いキャラが経由点を行き過ぎて往復しないように）
    while (p.path.length && Math.hypot(p.path[0].x - p.x, p.path[0].y - p.y) < reach) p.path.shift();
    const n = p.path[0];
    if (n) this.setInput(p.id, n.x - p.x, n.y - p.y);
    else this.setInput(p.id, 0, 0);
  }

  // 撃破の演出中で、まだ消えていない（爆発まで。視界を残し、敵にも送る）
  dying(p: Player) {
    return !p.alive && this.now < p.koAt + C.KO_FX.shake + C.KO_FX.boom;
  }

  // 陣営 team から見えるか（自陣営のプレイヤー・大将の視界、壁で遮断）。倒されたキャラは大爆発の後に視界が縮む（eyeRadius）
  visibleTo(team: number, x: number, y: number, obs: Rect[]): boolean {
    const eyes = [...this.players.values()].filter((p) => p.team === team).map((p) => ({ x: p.x, y: p.y, r: eyeRadius(p.char, p.alive ? null : this.now - p.koAt, p.assist) }));
    const b = this.bosses[team];
    eyes.push({ x: b.x, y: b.y, r: visionRadius() });
    return eyes.some((e) => e.r > 0 && Math.hypot(e.x - x, e.y - y) <= e.r && lineOfSight(e.x, e.y, x, y, obs));
  }

  // 「戻る」を押した人数（Botは押した扱い）／全人数
  backCount() {
    const list = [...this.players.values()].filter((p) => !p.assist);
    return { n: list.filter((p) => p.bot || this.backVotes.has(p.id)).length, total: list.length };
  }

  // スナップショットで送る状態: 有効な状態の key → 描画用の値（なければ true）
  statusView(p: Player) {
    const out: Record<string, any> = {};
    for (const k in p.st) if (this.now < p.st[k].until) out[k] = p.st[k].view?.() ?? true;
    return out;
  }

  sendSnapshots() {
    const obs = this.obstacles();
    const vis = [0, 1].map((team) => ({
      players: [...this.players.values()].filter((p) => p.team === team || ((p.alive || this.dying(p)) && this.visibleTo(team, p.x, p.y, obs))), // 撃破の演出中の敵も視界内なら送る
      bosses: this.bosses.filter((b) => b.team === team || this.phase === 'intro' || this.visibleTo(team, b.x, b.y, obs)), // 開幕中は敵大将も映す
      ents: this.ents.filter((e) => e.team === team || !ENTS[e.kind].fog || this.visibleTo(team, e.x, e.y, obs)),
      shots: this.shots.filter((s) => s.team === team || this.visibleTo(team, s.x, s.y, obs)),
      fx: this.fx.filter((f) => f.team === team || this.visibleTo(team, f.x, f.y, obs)), // 視界内なら他プレイヤーの技も見える
      warns: this.warns.filter((w) => w.team === team || this.visibleTo(team, w.x, w.y, obs)),
    }));
    const wanted = this.teams.map((t) => this.players.get(t.wanted ?? '')).filter((p) => p?.alive).map((p) => ({ id: p!.id, team: p!.team, x: p!.x, y: p!.y }));
    const all = { players: [...this.players.values()], bosses: this.bosses, ents: this.ents, shots: this.shots, fx: this.fx, warns: this.warns };
    const roster = [...this.players.values()].filter((p) => !p.assist).map((p) => ({ id: p.id, team: p.team, bot: p.bot, char: p.char, alive: p.alive, ok: p.ok, name: p.name }));
    for (const client of this.clients) {
      const me = this.players.get(this.owners.get(client.sessionId) ?? '');
      const v = me && !this.reveal.has(client.sessionId) && this.phase !== 'finale' ? vis[me.team] : all; // 観戦者・決着演出中はフォグなし（全員に倒された大将・止めのキャラを映す）
      const myTeam = me ? me.team : 0;
      client.send('s', {
        me: me?.id ?? null, t: this.elapsed, roster, ...(this.phase === 'intro' ? { introMess: this.introMess } : {}), back: this.phase === 'ended' ? this.backCount() : null, finale: this.finale, lobbyLeft: this.lobbyLeft, phase: this.phase, phaseLeft: this.phaseLeft, timeLeft: this.timeLeft, winner: this.winner,
        teams: this.teams.map((t, i) => ({ toku: t.toku, wanted: t.wanted, reflect: this.reflecting(i), bossHpRatio: this.bosses[i].hp / C.BOSS_HP, slot: { reels: t.slot.reels, win: t.slot.win, pen: t.slot.pen, chain: t.slot.chain, payout: t.slot.payoutAt !== null, left: C.SLOT.spin - (this.now - t.slot.start) } })),
        wanted: wanted, // 指名手配中のキャラの位置（敵の視界外でもミニマップに出す）
        players: v.players.map((p) => ({
          id: p.id, team: p.team, char: p.char, bot: p.bot, x: p.x, y: p.y, hp: p.hp, alive: p.alive, rage: p.rage, bad: p.bad,
          face: p.face, stunned: this.now < p.stunUntil, cd: Math.max(0, p.cooldownUntil - this.now),
          respawnIn: p.alive ? 0 : p.respawnAt - this.now, ko: p.alive ? null : this.now - p.koAt, // ko: 撃破からの秒数（演出用）
          ack: p.ack, cage: this.cageOf(p), maxHp: this.maxHp(p), spd: this.speedOf(p), aim: p.aim, tgt: p.tgt ? thingId(p.tgt) : null, skillCd: Math.max(0, p.skillReadyAt - this.now),
          st: this.statusView(p), lock: this.effect(p, 'lock'), still: this.stillLock(p),
          recall: p.recallAt === null ? null : (this.now - p.recallAt) / C.RECALL_HOLD,
          assist: p.assist, tier: p.tier, ult: p.ult ? { form: p.ult.form, tier: p.ult.tier, left: p.ult.pending ? null : p.ult.until - this.now } : null,
          boost: this.now < p.boostUntil, slow: this.now < p.slowUntil, weak: this.now < p.weakUntil, cdMax: this.atkCooldown(p),
        })),
        bosses: v.bosses.map((b) => ({ team: b.team, x: b.x, y: b.y, hp: b.hp, base: b.base })),
        materials: this.materials.map((m) => ({ id: m.id, x: m.x, y: m.y, hi: m.hi, big: !!m.big })), items: this.items,
        ents: v.ents.map((e) => ({ id: e.id, kind: e.kind, team: e.team, x: e.x, y: e.y, r: e.r, body: e.body, hp: e.hp, a: e.a, v: e.v })), // v: 技処理が渡す描画用の値
        couriers: this.couriers.map((c) => ({ id: c.id, team: c.team, x: c.x, y: c.y, box: c.box })), // コバコは両陣営に見せる（ミニマップ）
        warns: v.warns.map((w) => ({ id: w.id, team: w.team, x: w.x, y: w.y, r: w.r, left: w.at - this.now, boss: !!w.boss })),
        shots: v.shots.map((s) => ({ id: s.id, kind: s.kind, team: s.team, x: s.x, y: s.y, vx: s.vx, vy: s.vy })),
        fx: v.fx, broken: this.broken, bossRooms: this.bossRooms, ...(this.reveal.has(client.sessionId) ? { reveal: true } : {}),
      });
    }
  }
}
