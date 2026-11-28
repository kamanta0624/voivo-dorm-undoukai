import { Room, Client, ServerError, CloseCode } from 'colyseus';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG as C, Rect, Pt, wallRects, seeRects, roomLayout, roomKindAt, isBackAt, bossIntensity, bodyUp } from '../shared/config';
import { CHARS, PICKABLE, E2E_BOTS, BOSS_CHAR, visionRadius, eyeRadius, roleOf, charHp, charSpeed, charAtk, aaRange, aaMode, moveWalls } from '../shared/chars';
import { lineOfSight, inRect, moveBody, pushOut, cage } from '../shared/geom';
import { SKILLS, STATUS_ORDER, ENTS } from './skills';
import { reserveBiiContacts } from './skills/bii';
import { findPath } from './pathfind';
import { stepPlayer } from '../shared/netcode';
import MAP from '../shared/map.json';
import { Director } from './commentary';
import { ServerMeasure, clientReport, LIMITS } from '../shared/netmeasure';
import * as OG from './outgame';
import { ModernSlot, type Pay } from '../shared/slot_modern';
import { MatchRec } from './matchlog';
import { solarAt } from '../shared/solar';
import { bindMessages } from './messages';
import * as snap from './snapshot';
import * as lag from './lagcomp';
import * as Slots from './slot';
import * as Bots from './bot';
import * as Lobby from './lobby';

const T = C.TILE;
// 強さの倍率の表（POWER_MULT・ULT_HP_MULT）の添字 tier の値。表の最後（Lv4）を超えた Lv4+N は Lv4 の値から +lvStep ずつ（handoff_slot3。クラシックは超えない）
const lvMult = (a: number[], tier: number) => (tier < a.length ? a[tier] : a[a.length - 1] * (1 + C.SLOT_MODERN.game.lvStep * (tier - a.length + 1)));
const BAD_DECAY = (-C.TOKU.courier * C.BAD_MULT.courier) / C.BAD_DECAY_SEC; // 反省中に毎秒減る悪行ポイント（config の BAD_DECAY_SEC）
// マップ外周の壁（外 ' ' か地図の端に接する壁）は壊せない
export const PERIMETER = MAP.tiles.map((row, y) => [...row].map((c, x) => c === '#' && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (MAP.tiles[y + dy]?.[x + dx] ?? ' ') === ' '))));
// 壊せない壁か（技の範囲が触れても壊さない壁。地図の外も含む）。今は外周だけ
export const unbreakable = (tx: number, ty: number) => PERIMETER[ty]?.[tx] ?? true;

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
export const pick = <X>(a: X[]) => a[Math.floor(Math.random() * a.length)];
const CENTER_ROOMS = MAP.rooms.filter((r) => r.type === 'center').map((r) => r.id); // 中央の部屋（自然湧きの徳を出さない。徳はコバコが置く）

type Ult = { form: string; tier: number; until: number; pending: boolean; dur?: number }; // pending: 撤退中に選ばれ、復活後に始まる。dur: 復活後の効果時間（モダンの当たりで延びる。なければ ULT_DURATION）
export type Player = {
  id: string; team: number; char: string; x: number; y: number; hp: number; alive: boolean;
  dx: number; dy: number; face: number; // face: 向き(ラジアン)
  rage: number; bad: number; wantedHold: boolean; // bad: 悪行ポイント（徳を下げた量 × BAD_MULT の累計。反省中は BAD_DECAY_SEC の速さで減る）。wantedHold: 撃破で手配を外し、復帰後に悪行が増えるまで手配しない
  cooldownUntil: number; stunUntil: number; respawnAt: number; respawnTotal: number; // respawnTotal: 撤退時間の合計
  lastHitBy: Map<string, number>;
  budget: number; // 入力の予算（sec1。C.NET_INPUT_BUDGET）
  engage: { at: number; seen: Map<string, boolean> } | null; // 交戦（react1）: 最初に当てられた時刻と、当てた相手ごとの「最初に当てた時に自陣営から見えていたか」。REACT.engageGap 秒被弾しなければ次の交戦
  bot: boolean; role: 'gather' | 'raid' | 'counter' | 'guard'; phys?: string; seenAt?: Map<string, number>; // phys: Bot のフィジカル（なし＝中。CONFIG.BOT_PHYS）、seenAt: 反応の遅い Bot が敵を見つけた時刻（敵id → 時刻）
  path: Pt[]; pathAt: number; raidBase: number; visited: number[]; // raidBase: 見回り中の敵陣の部屋（-1=未決定）、visited: 見回り済みの部屋
  aim: string; tgt: Thing | null; // 照準モードと、今狙っている対象
  inputs: { seq: number; dx: number; dy: number; rt?: number }[]; ack: number; // 人間の入力待ちと、処理済みの入力番号
  rtts?: number[]; rttN?: number; rttAt?: number | null; rttNext?: number; // 人間: サーバーが測った往復の遅延（秒、直近 NET_RTT_KEEP 回）・送った計測の番号と時刻・次に送る時刻（sync1。lagcomp.ts）
  viewT?: number; // 人間: 最後に処理した入力の描画時刻（クライアントの画面のサーバー時刻 elapsed。近接AAの巻き戻し判定）
  skillReadyAt: number; st: Record<string, Status>; sk: Record<string, any>; // st: 状態（key → 期限と効果）、sk: 技処理の持ち物（server/skills が使う）
  assist: boolean; tier: number; ult: Ult | null; // assist: アシストユニット（復活しない）、tier: アシストの強さ（POWER_* の添字）
  goal: string; stuckX: number; stuckY: number; stuckSince: number; penalty: Map<string, number>; // Bot: 今の目的地、詰まり判定、避ける目的地（期限）
  qAt: number | null; recallAt: number | null; // Q を押した時刻と、リコールの溜めの開始時刻（被弾で溜め直し）
  qSeq: number; // Q を押した時点でクライアントが送り終えていた移動入力の番号（これ以前の入力では溜めを中断しない）
  boostUntil: number; // 白上虎太郎の移動速度上昇
  inDx: number; inDy: number; // 人間: 最後に届いた移動入力
  skillA?: number; // 人間: 技の矢印で決めた向き（技の発動の間だけ。skillAim がこれを返す）
  eating: boolean; // Bot: リコールして給湯室でご飯を食べている（HPが満タンになるまで）
  ok: boolean; // 待機画面で出撃済み
  slowUntil: number; weakUntil: number; // スロットの罰: 移動速度低下・攻撃力低下
  koAt: number; // 撃破された時刻（撃破の演出 KO_FX）
  hitAt: number; // 最後に被弾した時刻（Bot のリコール判断の「脅威あり」）
  lowFight: boolean; lowUntil: number; // Bot: 低HPで脅威ありのときの攻撃(true)／逃亡(false)と、その決定を維持する時刻
  recallBreaks: number; recallBanUntil: number; // Bot: リコールの溜め中に中断された回数と、リコールを始めない時刻（BOT_RECALL_BREAKS・BOT_RECALL_BAN）
  name?: string; ip?: string; bid?: string; // 人間: プレイヤー名（自動）、IP・ブラウザ保存ID（管理ページの表示と BAN）
};
type Courier = { id: number; team: number; x: number; y: number; hp: number; path: Pt[]; pathAt: number; wp: number; dir: number; box: string }; // ブイブイ・コバコ（中立 team=-1）。wp: 巡回経路の次の地点、dir: 往復の向き（+1 / -1）、box: 持っている荷物（ult / assist）
export type Boss = { team: number; base: number; x: number; y: number; hp: number; dmgAtBase: number; target: string | null; cooldownUntil: number; moved: boolean; moving: boolean; shotAt: number; holdUntil: number }; // moved: 1回でも拠点移動した（第2形態）、moving: 移動の予告中（無敵）、shotAt: 第2形態の次の弾の時刻、holdUntil: この時刻までは拠点移動を始めない（技が止める）
export type Slot = { start: number; reels: number[]; win: boolean; pen: boolean; chain: number; tier: number; top: number; payoutAt: number | null; holdUntil: number; holds: CHold[]; cur: CHold | null; reachSent: boolean }; // start: 回転の開始時刻、reels: この回転の結果（リールの絵柄の番号 1〜。-1=罰の絵柄）、pen: 罰の出目、chain: 当選のカットインの段（1＝大当たり、2〜＝チャンスアップ）、tier: 今の段のレベル、top: チャンスアップで決まった最後のレベル、payoutAt: 次の段の時刻（払い出し中だけ）。holds: 保留（先頭が次の回転）、cur: 今の回転の保留、reachSent: リーチ・全回転の演出を送った
export type SlotTarget = { kind: 'ult'; id: string } | { kind: 'assist'; char: string } | { kind: 'seven' }; // 当選の払い出しの対象（そろった絵柄）: プレイヤー1人のパワーアップ、アシスト、7（プレイヤー全員のレベルアップ）
export type CHold = { outcome: 'win' | 'miss' | 'pen'; color: number; saki: string[]; act: string | null; target: SlotTarget | null; reels: number[] }; // クラシックの保留: 積んだ時点の徳で当否と対象を決め、見た目（色・演出）はモダンの選択率（handoff_tune5）。saki: 先バレを見せるプレイヤーの id（handoff_slot4）。reels は回転を始めるときに決める
// 決着演出: kind=boss（大将撃破）／timeout（時間切れ）、stage=今の段（FINALE の順）、t=段の経過(実秒)、boss=倒された大将の位置、killer=止めを刺したキャラ（アシストは assist）
type Finale = { kind: 'boss' | 'timeout'; winner: number; stage: 'slow' | 'boss' | 'killer' | 'timeup' | 'win'; t: number; boss: { team: number; x: number; y: number } | null; killer: { id: string; char: string; team: number; assist: boolean; x: number; y: number } | null };
type Team = { toku: number; wanted: string | null; slot: Slot; m: ModernSlot | null; powerTier: number }; // toku: 徳、wanted: 指名手配中のプレイヤーid。m: モダンのスロット（SLOT_MODE が modern のとき）、powerTier: モダンのパワーアップの陣営のレベル（POWER_* の添字。Lv4 以降は 3+N）
type Warn = { id: number; team: number; owner: string; x: number; y: number; r: number; at: number; dmg: number; follow: string | null; boss?: boolean; push?: number; color?: string }; // アシストの範囲攻撃の予告（at に発動。follow があればその位置で発動）。boss: 大将の拠点移動前の広範囲攻撃（owner は使わない）。push: 発動で外向きにはじく距離、color: 発動の円の色（なければ赤い輪）
type Material = { id: number; x: number; y: number; hi: boolean; big?: boolean }; // hi: 裏側に出た高ポイントの資材、big: コバコが置いた高性能の徳
type Item = { id: number; kind: string; team: number; x: number; y: number; e2e?: boolean }; // kind: heal（回復アイテム）/ box_ult / box_assist（コバコの荷物）。team は常に -1。e2e: テスト用の仕掛けで置いたもの
type Shot = { id: number; kind: 'bullet' | 'arrow' | 'cannon' | 'kunai'; team: number; owner: string; x: number; y: number; vx: number; vy: number; sp: number; left: number; dmg: number; boom?: number; onHit?: (t: Thing) => void; steer?: (s: Shot, dt: number) => void; aa?: boolean; courier?: boolean; up?: number }; // up: 足元からの高さ（撃つ側の体の中心。壁・視界は真下の床 y+up で見る） // steer: 毎tick 進む前に向き（vx・vy）を変える（誘導する技が渡す）。boom: 大将の弾（着弾地点で半径 boom の爆発。owner は使わない）、onHit: 命中時にダメージの代わりに起きること（発射した技が渡す）、aa: 通常攻撃の弾、courier: コバコに当たる（通常攻撃の弾はコバコを狙うときだけ）
// 状態: until まで有効。効果は共通処理が見る（値は付与した技が渡す）。speed: 移動倍率、cd: 通常攻撃の間隔の倍率（アシストには掛けない）、regen: 毎秒の回復、noSkill: 技不可、lock: 移動不可（still: その場で止まる lock。自キャラの見た目を補間に切り替えない）、atk: 与えるダメージの倍率、noAttack: 攻撃不可、invincible: 無敵（敵の状態も付かない）、noPush: はじき無効、cancel: KO・試合終了で消える、hidden: 敵の対象にならない、fragile: 被弾で即死、noAuto: オートアタックしない
// at: 付与した時刻（技処理が使う）、view: スナップショットで送る描画用の値
export type Status = { until: number; at?: number; speed?: number; cd?: number; regen?: number; noSkill?: boolean; lock?: boolean; still?: boolean; atk?: number; noAttack?: boolean; invincible?: boolean; noPush?: boolean; cancel?: boolean; hidden?: boolean; fragile?: boolean; noAuto?: boolean; noAaDmg?: boolean; view?: () => any };
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
  static matchlogDir = ''; static matchlogSource: 'human' | 'bot' = 'human'; static matchSeed: number | null = null; // 試合の記録部の書き出し先（空なら書かない）・source・乱数の種（Bot 戦だけ。tools/botsim.ts）
  macros: string[] = ['std', 'std']; // チームのマクロ（CONFIG.BOT_MACROS・BOT_LAYER。本番は std。tools/botai.ts が試合の前に変える）
  endDefend = [false, false]; // マクロの層 e で終盤の守りに入ったか（記録用）
  counterMode = ['hold', 'hold']; counterN = [0, 0]; counterBoss = [0, 0];
  sc: ({ abort: boolean; fired: boolean; charge: number | null; foeHp: number | null; dmg: number; deaths: number; noSpot: boolean; foeLib: boolean; koAt: number } | null)[] = [null, null]; // マクロ soracannon（botai4）の状態と記録: abort=作戦をやめて std へ、fired=発射した、charge・foeHp=発射時のチャージと敵の大将の残りHP、dmg=そら砲の大将ダメージ、deaths=そら役の撤退回数、noSpot=撃つ場所が無かった、foeLib=敵の大将が library にいた // マクロ counter・split: 構え(hold)／逆襲(attack)、逆襲に入った回数と逆襲中の大将ダメージ（記録用）
  rec = new MatchRec(); // 試合の記録部（常時ON。要約は rec.summary()）
  maxClients = C.MAX_CLIENTS;
  static live = new Set<GameRoom>(); // 動いている部屋（管理ページの一覧）
  static sealed = false; // 常設の部屋を作り終えたら true（以後は e2e の部屋しか作らせない。src/server/index.ts）
  pub = false; // 常設の部屋（タイトルの一覧に出る。e2e の部屋は false）
  practice = false; // 練習の部屋（handoff_practice1）: 本人1人 vs 相手1体（id 'foe'）。一覧・/status に出ない。時間無制限・スロットなし・即復活・大将は HP1 で止まる・資材/ご飯/コバコ/実況なし
  foeMode: 'stand' | 'passive' | 'bot' = 'bot'; // 練習の相手の動き: 棒立ち／攻撃なし（移動は Bot どおり）／通常の Bot
  now = 0;
  private _phase: 'waiting' | 'intro' | 'countdown' | 'playing' | 'finale' | 'ended' = 'waiting';
  get phase() { return this._phase; }
  set phase(value: typeof this._phase) {
    if (value !== this._phase) { this.hist = []; this.jumps.clear(); this.contactTick = null; }
    this._phase = value;
  } // intro: 開始の演出（動けない）、countdown: 開始前のカウント（開始した部屋の中だけ動ける）、finale: 決着演出（入力なし。CONFIG.FINALE）
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
  specName = new Map<string, string>(); // 観戦者（owners にない client）の名前。待機画面で参加者になるときに使う
  specView = new Map<string, 'all' | 'focus' | 0 | 1>(); // 観戦者の視点: 全体・実況追従・組の視界（陣営）
  e2eFists = new Map<string, number>(); // e2e: プレイヤーごとの花丸パンチの拳を出した回数（E2E_HOOKS のときだけ数え、本人のスナップショットに載せる）
  abandonLeft: number | null = null; // 参加者の人間がいなくなってからの打ち切りまでの秒数（観戦者だけ残ったとき）
  fx: Fx[] = []; // このティックに起きた技のエフェクト（送信後に空にする）
  tiles = [...MAP.tiles]; // 試合中のタイル（壁破壊で変わる）
  walls = C.WALLS;
  seeWalls = C.SEE_WALLS; // 視界の壁（visibleTo 用。透過壁を除く）
  broken: number[][] = []; // 壊れた壁のタイル [x, y]
  wallDmg = new Map<number, number>(); // 小破・中破の壁（y * MAP.width + x → 進んだ段階 1〜WALL_HITS-1）
  crackLog: number[][] = []; // 小破・中破になった順 [x, y, 段階]（クライアントへは送っていない分だけ送る）
  snapSent = new Map<string, { k: Record<string, string>; p: Map<string, string> }>(); // クライアントごとの送ったスナップショットの差分の元（sync2。途中参加・再接続・試合の作り直しは全部送り直す）
  crackSent = new Map<string, number>(); // クライアント（sessionId）ごとの送った crackLog の数（途中参加・再接続は0から）
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
  slotChance: number | null = null; // チャンスアップの確率（e2e で決める。null＝徳で決まる）
  sortieLeft: number | null = null; // 出撃: 開始が決まってから戦闘画面へ移るまでの残り秒数（常設の部屋だけ。SORTIE_SEC）。null は出撃前
  lobbyLeft: number | null = null; // 待機画面: 選択猶予の残り秒数（最初の出撃で始まり、止まらない）。null は未開始
  modern = C.SLOT_MODE === 'modern'; // この試合のスロットがモダンか（startMatch で CONFIG.SLOT_MODE から決める）
  slotMiss = false; // e2e: スロットの自然な回転を外れに固定（技の検証中にウルト変身で技が出なくならないように）
  noAuto = new Set<string>(); // e2e: 自動攻撃しないプレイヤーid（E2E_HOOKS のときだけ使う）
  introMess: Pt = { x: 0, y: 0 }; // 新開幕でカメラが映す「散らかったマップの一角」
  startedAt = 0; // GAME START の時刻（試合ログ用、ミリ秒）
  bossDmg = [{ player: 0, assist: 0 }, { player: 0, assist: 0 }]; // 陣営ごとの、敵大将に与えたダメージ（試合ログ用）
  cm!: Director; // 実況ディレクター（試合ごとに作り直す）

  measure: ServerMeasure | null = null;
  measureId = 0;
  reports: Record<string, ReturnType<typeof clientReport>> = Object.create(null);
  private lastTick: number | null = null;
  private pendingLog: { line: any; file: string; timer: ReturnType<typeof setTimeout> } | null = null;

  // 例外の受け止め（sec1）: 定義すると Colyseus がメッセージ・タイマー・tick（setSimulationInterval）・入退室を try/catch で包む。例外はログ（logs/server.log）に残して部屋は止めない
  onUncaughtException(error: any, methodName: string) { this.logError(methodName, error); }
  logError(where: string, e: any, msg?: string) {
    const err = e?.cause ?? e;
    console.error(`${new Date().toISOString()} [error] room=${this.roomId ?? '-'} where=${where}${msg ? ` message=${msg}` : ''} ${err?.name ?? ''}: ${err?.message ?? err}\n${err?.stack ?? ''}`);
  }
  // クライアントからのメッセージ（中身は server/messages.ts。受信の検証・毎秒の数の上限・例外の受け止めを通す。sec1）
  messages = bindMessages(this);

  // 人間・Bot共通の操作経路
  setInput(id: string, dx: number, dy: number, keepRecall = false) {
    const p = this.players.get(id);
    if (!p) return;
    const len = Math.hypot(dx, dy);
    p.dx = len > 0 ? dx / len : 0;
    p.dy = len > 0 ? dy / len : 0;
    if (len > 0) { p.face = Math.atan2(p.dy, p.dx); if (!keepRecall) this.cancelRecall(p); } // 移動でリコール中断（Q を押す前に送った入力は除く）
  }

  // リコールの中断: 溜めを0に戻す（Q を押し直すまで溜めない）
  cancelRecall(p: Player) {
    if (p.bot && p.recallAt !== null && ++p.recallBreaks >= C.BOT_RECALL_BREAKS) { p.recallBreaks = 0; p.recallBanUntil = this.now + C.BOT_RECALL_BAN; } // Bot: 溜め中の中断を数え、続いたらしばらくリコールしない
    p.qAt = p.recallAt = null;
  }

  // 大将の部屋を決める（その試合の出現・逃亡先と自宅）
  setBossRooms(names: string[]) {
    this.bossRooms = names;
    ({ bases: this.bases, homes: this.homes } = roomLayout(names));
  }

  // 現在の試合: 中央からの経路距離の合計が上限以下になる組み合わせから選ぶ
  onCreate(options?: { e2e?: string; practice?: boolean }) {
    if (options?.e2e && !process.env.E2E_HOOKS) throw new ServerError(4403, 'e2e の部屋は作れません'); // e2e の部屋は E2E_HOOKS のサーバーだけ（sec1）
    this.practice = !!options?.practice && !options?.e2e;
    this.pub = !options?.e2e && !this.practice;
    if (this.practice && [...GameRoom.live].filter((r) => r.practice).length >= C.PRACTICE_ROOMS) throw new ServerError(4429, '練習の部屋がいっぱいです。しばらくしてから試してください');
    if (this.pub && GameRoom.sealed) throw new Error('常設の部屋は増やせない');
    if (this.pub) this.autoDispose = false; // 空になっても残す
    GameRoom.live.add(this);
    this.setup();
    this.setSimulationInterval((dtMs) => { for (let i = 0; i < this.speed; i++) this.tick(dtMs / 1000, i === this.speed - 1); }, 1000 / C.TICK_HZ);
  }

  // 試合の初期状態（部屋を作ったときと、リザルトから待機画面に戻ったとき）
  setup() {
    Object.assign(this, { now: 0, phase: 'waiting', sortieLeft: null, finale: null, phaseLeft: 0, timeLeft: C.MATCH_TIME, winner: -1, bosses: [], teams: [], materials: [], items: [], ents: [], shots: [], couriers: [], courierAt: 0, warns: [], fx: [], tiles: [...MAP.tiles], walls: C.WALLS, seeWalls: C.SEE_WALLS, broken: [], wallDmg: new Map(), crackLog: [], materialTimer: 0, healAt: C.HEAL_SPOTS.map(() => null) });
    this.flushLog(); this.measure = null; this.lastTick = null;
    this.backVotes.clear();
    this.crackSent.clear(); this.snapSent.clear();
    this.modern = C.SLOT_MODE === 'modern';
    this.cm = new Director(this);
    this.bossDmg = [{ player: 0, assist: 0 }, { player: 0, assist: 0 }];
    this.setBossRooms(pick(ROOM_COMBOS.filter((c) => c.sum <= C.BOSS_ROOM_DIST_SUM_MAX)).names);
    for (let t = 0; t < 2; t++) {
      const base = Math.floor(Math.random() * this.bases[t].length); // 候補部屋からランダムに出現
      const b = this.bases[t][base];
      this.bosses.push({ team: t, base, x: b.x, y: b.y, hp: C.BOSS_HP, dmgAtBase: 0, target: null, cooldownUntil: 0, moved: false, moving: false, shotAt: 0, holdUntil: 0 });
      this.teams.push({ toku: C.TOKU_INIT, wanted: null, slot: { start: 0, reels: [1, 2, 3], win: false, pen: false, chain: 0, tier: 0, top: 0, payoutAt: null, holdUntil: 0, holds: [], cur: null, reachSent: false }, m: this.modern ? new ModernSlot(C.SLOT_MODERN, C.TOKU_INIT) : null, powerTier: 0 });
      if (!this.modern) this.teams[t].slot.holds = Array.from({ length: C.SLOT_MODERN.holds }, () => Slots.classicHold(this, t));
    }
  }

  updateLobby(dt: number) { return Lobby.updateLobby(this, dt); } // 中身は lobby.ts（refac2）


  checkBack() { return Lobby.checkBack(this); } // 中身は lobby.ts（refac2）



  spectators() { return Lobby.spectators(this); } // 中身は lobby.ts（refac2）


  // 最大HP（ロール、ウルト中は変身先、アシストは強さの倍率）
  maxHp(p: Player) {
    if (p.assist) return C.PLAYER_HP * C.ASSIST.hp * lvMult(C.POWER_MULT, p.tier) * (C.ASSIST.units[p.char]?.hpMult ?? 1);
    let hp = charHp(p.char);
    if (p.ult && !p.ult.pending) hp *= C.ULT_FORMS[p.ult.form].hp * lvMult(C.ULT_HP_MULT, p.ult.tier);
    return hp;
  }

  addPlayer(id: string, team: number, bot: boolean) {
    const idx = [...this.players.values()].filter((p) => p.team === team).length;
    const s = C.SPAWNS[team];
    const p: Player = {
      id, team, char: pick(PICKABLE), x: s.x, y: s.y + (idx - 1.5) * 40, hp: C.PLAYER_HP, alive: true,
      dx: 0, dy: 0, face: team === 0 ? 0 : Math.PI, rage: 0, bad: 0, wantedHold: false,
      cooldownUntil: 0, stunUntil: 0, respawnAt: 0, respawnTotal: 0, lastHitBy: new Map(), budget: C.NET_INPUT_BUDGET, engage: null,
      bot, role: 'gather', path: [], pathAt: -Infinity, raidBase: -1, visited: [],
      aim: bot ? C.BOT_AIM : C.AIM_MODES[0], tgt: null, inputs: [], ack: 0,
      skillReadyAt: 0, st: {}, sk: {},
      assist: false, tier: 1, ult: null,
      goal: '', stuckX: 0, stuckY: 0, stuckSince: 0, penalty: new Map(), qAt: null, recallAt: null, qSeq: -Infinity,
      boostUntil: 0, inDx: 0, inDy: 0, slowUntil: 0, weakUntil: 0, eating: false, ok: false, koAt: 0,
      hitAt: -Infinity, lowFight: false, lowUntil: -Infinity, recallBreaks: 0, recallBanUntil: -Infinity,
    };
    this.players.set(id, p);
    return p;
  }

  onDispose() { if (this.measure && this.startedAt) this.writeLog('disconnect'); this.flushLog(); GameRoom.live.delete(this); }

  // 人間の参加者の数（再接続待ちを含む）
  humanCount() { return [...this.players.values()].filter((p) => !p.bot && !p.assist).length + [...this.dropped].filter((id) => this.players.get(id)?.bot).length; }

  onAuth(_client: Client, options: any, ctx?: { ip?: string; headers?: Headers }) { return Lobby.onAuth(this, _client, options, ctx); } // Colyseus の呼び口。中身は lobby.ts（refac2）

  onJoin(client: Client, options?: { name?: string }) { return Lobby.onJoin(this, client, options); } // Colyseus の呼び口。中身は lobby.ts（refac2）

  onDrop(client: Client) { return Lobby.onDrop(this, client); } // Colyseus の呼び口。中身は lobby.ts（refac2）

  onReconnect(client: Client) { return Lobby.onReconnect(this, client); } // Colyseus の呼び口。中身は lobby.ts（refac2）

  onLeave(client: Client) { return Lobby.onLeave(this, client); } // Colyseus の呼び口。中身は lobby.ts（refac2）

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

  startPractice(foe: string) { return Lobby.startPractice(this, foe); } // 中身は lobby.ts（refac2）

  practiceFoe(foe: Player, char: string) { return Lobby.practiceFoe(this, foe, char); } // 中身は lobby.ts（refac2）

  practiceMode(mode: GameRoom['foeMode']) { return Lobby.practiceMode(this, mode); } // 中身は lobby.ts（refac2）

  practicePower(q: Player, d: 1 | -1) { return Lobby.practicePower(this, q, d); } // 中身は lobby.ts（refac2）

  practiceBack() { return Lobby.practiceBack(this); } // 中身は lobby.ts（refac2）

  startMatch() {
    this.lobbyLeft = null;
    for (let t = 0; t < 2; t++) {
      while (!this.practice && [...this.players.values()].filter((p) => p.team === t).length < C.TEAM_SIZE) {
        const b = this.addPlayer(`bot${++this.botSeq}`, t, true);
        if (process.env.E2E_HOOKS) b.char = E2E_BOTS[(this.botSeq - 1) % E2E_BOTS.length]; // e2e: Bot は固定の編成（検証が揺らがないように）
      }
      const mc = this.macros[t].split('+')[0]; // マクロの土台の役割の割り振り（std は今の交互）
      [...this.players.values()].filter((p) => p.team === t).forEach((p, i) => (p.role = mc === 'soracannon' ? 'guard' : mc === 'rush' ? 'raid' : mc === 'farm' ? 'gather' : mc === 'counter' ? 'counter' : mc === 'split' ? (i % 2 === 0 ? 'counter' : 'raid') : i % 2 === 0 ? 'gather' : 'raid'));
      this.endDefend[t] = false; this.counterMode[t] = 'hold'; this.counterN[t] = 0; this.counterBoss[t] = 0;
      this.sc[t] = mc === 'soracannon' ? { abort: false, fired: false, charge: null, foeHp: null, dmg: 0, deaths: 0, noSpot: false, foeLib: false, koAt: -1 } : null;
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
    if (!this.practice) { // 練習は資材・ご飯・コバコなし
      while (this.materials.length < C.MATERIAL_MAX * C.MATERIAL_MAX_MULT) this.spawnMaterial();
      for (const [x, y] of C.HEAL_SPOTS) this.items.push({ id: this.nextId++, kind: 'heal', team: -1, x, y }); // ご飯は最初から置いておく
      this.spawnCourier();
    }
    // 新開幕の「散らかったマップの一角」: 資材が一番多く集まっている場所
    const dense = (m: Pt) => this.materials.filter((q) => Math.hypot(q.x - m.x, q.y - m.y) <= C.INTRO2.messR).length;
    const best = [...this.materials].sort((u, v) => dense(v) - dense(u))[0];
    this.introMess = best ? { x: best.x, y: best.y } : { x: C.MAP_W / 2, y: C.MAP_H / 2 };
    this.cm.intro();
  }

  // カウント0（GAME START）: 部屋から出られるようになり、試合時間を数え始める
  beginPlay() {
    this.flushLog();
    this.measure = C.NET_MEASURE ? new ServerMeasure() : null;
    for (const c of this.clients) this.measure?.client(c.sessionId);
    this.measureId++; this.reports = Object.create(null); this.lastTick = null;
    this.phase = 'playing';
    this.startedAt = Date.now();
    this.phaseLeft = 0;
    if (!this.practice) this.rec.start(this, GameRoom.matchSeed);
    if (!this.modern && !this.practice) this.teams.forEach((_, i) => Slots.startSpin(this, i)); // スロットは GAME START から回す（モダンは playing の間だけ進める）。練習は回さない
    this.cm.play();
  }

  // 出られない部屋: 開始前のカウント中は開始した部屋、終了後は自陣の大将が最後にいた部屋
  cageOf(p: Player): Rect | null {
    if (this.phase === 'countdown') return C.START_ROOMS[p.team];
    if (this.phase === 'ended') return this.homes[p.team][this.bosses[p.team].base];
    return null;
  }

  // 試合の前後: 人間の入力だけ処理する（演出中は動けない。カウント中と終了後は部屋の中だけ動ける）
  moveHumans(dt = C.NET_STEP) {
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const c = this.cageOf(p), obs = c && [...moveWalls(p.char, this.obstacles()), ...cage(c)];
      p.budget = Math.min(C.NET_INPUT_BUDGET, p.budget + dt / C.NET_STEP); // 入力の予算（sec1）: 経過時間ぶん（50ms の tick で +1）足し、処理するごとに -1。tick ごとの +1 だと、サーバーの tick が 50ms より遅れた分だけ正常な入力も待ちにあふれる
      for (let i = p.inputs.length > C.NET_CATCHUP ? 2 : 1; i > 0 && p.inputs.length && p.budget >= 1; i--) {
        p.budget--;
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
      Bots.botThink(this, p, obs);
      const sp = this.speedOf(p) * dt;
      Object.assign(p, moveBody(p.x, p.y, p.dx * sp, p.dy * sp, C.PLAYER_RADIUS, [...moveWalls(p.char, obs), ...cage(C.START_ROOMS[p.team])]));
    }
  }

  obstacles(): Rect[] {
    return this.walls;
  }

  tick(dt: number, send = true) {
    this.clipCache.clear(); // 体の箱の高さ（壁で切った後）は tick ごとに測り直す
    const measure = this.measure, start = measure && this.phase === 'playing' ? performance.now() : null;
    if (start !== null) {
      if (this.lastTick !== null) measure!.interval.add(start - this.lastTick);
      this.lastTick = start;
    }
    this.tickGame(dt, send);
    if (send) lag.rttPing(this); // 往復の遅延の計測（sync1）
    if (start !== null) measure!.tick.add(performance.now() - start);
  }

  private tickGame(dt: number, send = true) {
    if (send) this.elapsed += dt; // 早送り中も実時間で進める
    if (this.phase === 'intro' || this.phase === 'countdown') {
      this.phaseLeft -= dt;
      if (this.phase === 'intro' && this.phaseLeft <= 0) { this.phase = 'countdown'; this.phaseLeft += C.INTRO_MODE === 'old' ? C.COUNTDOWN : C.INTRO2.count; }
      else if (this.phase === 'countdown' && this.phaseLeft <= 0) this.beginPlay();
    }
    if (this.phase === 'waiting') Lobby.updateLobby(this, dt);
    if (this.phase === 'intro' || this.phase === 'countdown' || this.phase === 'ended') this.moveHumans(dt);
    if (this.phase === 'countdown' && C.INTRO_MODE !== 'old') this.moveBotsCaged(dt);
    if (this.phase === 'ended') this.updateEnded(dt);
    if (this.phase === 'finale') this.updateFinale(dt);
    if (this.phase !== 'waiting') this.cm.flow(dt); // 実況のタイムライン（試合前後も進める）
    if (this.phase !== 'waiting') Lobby.updateAbandon(this, dt);
    if (this.phase === 'playing') {
      this.now += dt;
      this.timeLeft = this.practice ? C.MATCH_TIME : Math.max(0, C.MATCH_TIME - this.now); // 練習は時間無制限
      this.beginContactTick();
      Bots.updateBots(this);
      this.updatePlayers(dt);
      this.updateShots(dt);
      this.updateEnts(dt);
      this.unstick();
      this.updateBosses();
      if (!this.practice) { this.updateMaterials(dt); this.updateHeals(); this.updateCouriers(dt); }
      this.updateAssists();
      this.updateWarns();
      this.updateWanted();
      Slots.updateReflect(this, dt);
      if (!this.practice) { if (this.modern) Slots.updateModern(this, dt); else Slots.updateSlots(this); } // 練習はスロットを止める
      this.finishContactTick();
      this.cm.tick(dt);
      this.rec.tick(this, dt);
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

  // ビィの接触用。tick後半の壁補正・大将移動・はじきまで含めて確定する。
  contactTick: { starts: Map<string, Pt>; jumped: Set<string> } | null = null;

  beginContactTick() {
    const starts = new Map<string, Pt>();
    for (const p of this.players.values()) if (p.alive) starts.set(`p:${p.id}`, this.bodyOf(p));
    for (const b of this.bosses) starts.set(`boss:${b.team}`, this.body({ k: 'boss', o: b, x: b.x, y: b.y, r: C.BOSS_RADIUS }));
    this.contactTick = { starts, jumped: new Set() };
  }

  finishContactTick() {
    if (this.phase === 'playing') for (const e of this.ents) if (e.kind === 'overload') reserveBiiContacts(this, e);
    this.contactTick = null;
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
    for (const p of this.players.values()) if (p.alive) this.relocate(`p:${p.id}`, p, pushOut(p.x, p.y, C.PLAYER_RADIUS, moveWalls(p.char, obs)));
    for (const b of this.bosses) this.relocate(`boss:${b.team}`, b, pushOut(b.x, b.y, C.BOSS_RADIUS, obs));
    for (const e of this.ents) if (e.body === 'unit') this.relocate(`e:${e.id}`, e, pushOut(e.x, e.y, e.r, obs));
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
    this.rec.end(this, kind, GameRoom.matchlogDir, GameRoom.matchlogSource);
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
    const sum = this.rec.summary(); if (sum) for (const c of this.clients) c.send('result', sum); // 試合結果画面のデータ（全員へ1回。結果画面の間に入った人には onJoin で送る）
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
    if (!this.pub) this.lock(); // 常設の部屋は結果画面でも観戦で入れる（入室の判定は onAuth）
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
    this.startedAt = 0;
    if (!this.measure) { this.appendLog(GameRoom.logFile, line); return; }
    const server = this.measure, reports = this.reports;
    const clients = this.clients.map((c) => c.sessionId);
    for (const id of clients) server.client(id);
    this.pendingLog = { file: GameRoom.logFile, line: { ...line, net: { id: this.measureId, limitsMs: LIMITS, server, clients: reports } }, timer: setTimeout(() => this.flushLog(), 2000) };
    this.pendingLog.timer.unref();
    for (const c of this.clients) c.send('netFinish', { id: this.measureId });
  }


  private appendLog(file: string, line: unknown) {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(line) + '\n');
  }

  flushLog() {
    const pending = this.pendingLog;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.line.net.missingClients = Object.keys(pending.line.net.server.clients).filter((id) => !Object.hasOwn(pending.line.net.clients, id));
    this.appendLog(pending.file, pending.line);
    this.pendingLog = null;
  }

  // 陣営の人間のクライアントへ通知
  notice(team: number, text: string) {
    for (const c of this.clients) if (this.players.get(this.owners.get(c.sessionId) ?? '')?.team === team) c.send('notice', { text });
  }

  // 移動速度（ロール・技・ウルトの効果込み）
  speedOf(p: Player) {
    const slow = this.now < p.slowUntil ? (this.modern ? C.SLOT_MODERN.game.penalty.speed : C.SLOT.penalty.slow) : 1; // スロットの罰
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
        if (this.measure) {
          const m = this.measure.client([...this.owners].find(([, id]) => id === p.id)?.[0] ?? p.id);
          m.queue.add(p.inputs.length); if (p.inputs.length > C.NET_CATCHUP) m.catchup++;
        }
        p.budget = Math.min(C.NET_INPUT_BUDGET, p.budget + dt / C.NET_STEP); // 入力の予算（sec1）: 経過時間ぶん（50ms の tick で +1）足し、処理するごとに -1。tick ごとの +1 だと、サーバーの tick が 50ms より遅れた分だけ正常な入力も待ちにあふれる
        for (let i = p.inputs.length > C.NET_CATCHUP ? 2 : 1; i > 0 && p.inputs.length && p.budget >= 1; i--) {
          p.budget--;
          const m = p.inputs.shift()!;
          this.setInput(p.id, m.dx, m.dy, m.seq <= p.qSeq);
          if (Number.isFinite(m.rt)) p.viewT = m.rt; // この入力を送ったときの画面の時刻
          if (this.now >= p.stunUntil && !locked) Object.assign(p, stepPlayer(p.x, p.y, m.dx, m.dy, this.speedOf(p), moveWalls(p.char, obs)));
          p.ack = m.seq;
        }
      } else if (this.now >= p.stunUntil && !locked) {
        const sp = this.speedOf(p) * dt;
        Object.assign(p, moveBody(p.x, p.y, p.dx * sp, p.dy * sp, C.PLAYER_RADIUS, moveWalls(p.char, obs), true, (q) => this.noteJump(`p:${p.id}`, p, q)));
      }
      SKILLS[p.char]?.afterMove?.(this, p, dt, px, py, locked);
      if (!p.assist) {
        // 資材は触れると拾う（持ち運ばない。徳が上がる）
        for (const m of [...this.materials]) {
          if (!this.touches(p, m, C.MATERIAL_PICKUP_BOX)) continue;
          this.materials = this.materials.filter((x) => x !== m);
          this.rec.mat(p, m);
          this.addToku(p.team, p, m.big ? 'materialBig' : m.hi ? 'materialBack' : 'material', ''); // 表示は「徳+XX」だけ
        }
        // 回復アイテム・荷物も触れるだけで拾う
        for (const it of [...this.items]) if (this.touches(p, it)) this.takeItem(p, it);
      }
      // リコール: 溜まったら自陣の給湯室へワープ（Bot はそこでご飯を食べて回復する）
      if (p.recallAt !== null && this.now - p.recallAt >= C.RECALL_HOLD) {
        const r = C.RECALL_ROOMS[p.team];
        p.recallAt = null; p.recallBreaks = 0;
        if (!p.bot) for (const c of this.clients) if (this.owners.get(c.sessionId) === p.id) c.send('recalled', { r: p.hp / this.maxHp(p) }); // 帰還成功を本人へ（帰還前のHPの割合。立ち絵の反応。react1）
        this.addFx(p, 'recall', {}); // 元いた場所に瞬間移動の跡
        this.relocate(`p:${p.id}`, p, pushOut(r.x + r.w / 2, r.y + r.h / 2, C.PLAYER_RADIUS, obs));
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
      if (p.tgt && !locked && this.now >= p.cooldownUntil && !this.effect(p, 'noAuto') && !this.noAuto.has(p.id) && (p.bot || p.recallAt === null)) this.attack(p.id, this.aimAt(p, p.tgt));
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
    if (p.ult?.pending) Object.assign(p.ult, { pending: false, until: this.now + (p.ult.dur ?? C.ULT_DURATION) }); // 撤退中に選ばれたウルトは復活後に始まる
    this.noteJump(`p:${p.id}`, p, s);
    Object.assign(p, { alive: true, x: s.x, y: s.y, eating: false, stunUntil: 0, st: {}, recallAt: null, boostUntil: 0 });
    p.hp = this.maxHp(p);
    p.lastHitBy.clear(); p.engage = null;
  }

  // ---- 徳・資材・回復アイテム・荷物・ウルト・アシスト ----

  clampToku(v: number) { return Math.max(C.TOKU_MIN, Math.min(C.TOKU_MAX, v)); }

  // 徳の増減（陣営の共有値）。p がいれば頭上に内容と増減を出し（text が空なら増減だけ）、下げた分は悪行ポイントに足す。アシストの行動は徳に影響しない
  // n: 何回分か（壁の即破壊は WALL_HITS 回分）
  addToku(team: number, p: Player | null, key: string, text = C.TOKU_TEXT[key], n = 1) {
    if (p?.assist) return;
    const d = n * (key === 'slot' ? C.SLOT.winToku : key === 'courier' && this.modern ? C.SLOT_MODERN.game.courierToku : C.TOKU[key]);
    const t0 = this.teams[team].toku;
    this.teams[team].toku = this.clampToku(this.teams[team].toku + d);
    if (!p) return;
    const bad = d < 0 ? -d * (C.BAD_MULT[key] ?? 1) : 0;
    this.rec.toku(this, p, this.teams[team].toku - t0, bad);
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
      a.tier = Math.min(C.ASSIST_TAGS.length - 1, a.tier + 1);
      a.hp = this.maxHp(a);
      for (const c of this.clients) c.send('assistUp', { char: a.char, tier: a.tier, team, at: this.elapsed }); // 両陣営に通知。at: スナップショットの t と同じ時計（クライアントは補間の時刻がここに来てから出す。sync1）
      this.addFx(a, 'aura', { r: 40, color: 'assist' });
      this.cm.assistUp(a);
      return a;
    }
    const boss = this.bosses[team];
    const a = this.addPlayer(`assist${this.nextId++}`, team, true);
    const before = { x: a.x, y: a.y };
    Object.assign(a, { char, assist: true, tier, role: 'raid', aim: C.BOT_AIM, x: boss.x + C.BOSS_RADIUS + C.PLAYER_RADIUS + 4, y: boss.y, skillReadyAt: this.now + C.ASSIST.units[char].every });
    Object.assign(a, pushOut(a.x, a.y, C.PLAYER_RADIUS, this.obstacles()));
    this.noteJump(`p:${a.id}`, before, a, true);
    a.hp = this.maxHp(a);
    for (const c of this.clients) c.send('assist', { char, tier, team, at: this.elapsed }); // 両陣営に通知（at は sync1）
    this.addFx(a, 'aura', { r: 40, color: 'assist' });
    this.cm.assistIn(a, quiet);
    return a;
  }

  // ウルト: 変身先はランダム。変身中なら効果時間だけリセット。撤退中なら復活後に始まる
  giveUlt(q: Player, tier: number) {
    if (q.ult) { q.ult.until = this.now + C.ULT_DURATION; return; }
    q.ult = { form: pick(Object.keys(C.ULT_FORMS)), tier, until: this.now + C.ULT_DURATION, pending: !q.alive };
    this.rec.ult(q);
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
    Object.assign(c, moveBody(c.x, c.y, ((n.x - c.x) / d) * m, ((n.y - c.y) / d) * m, C.PLAYER_RADIUS, obs, true, (q) => this.noteJump(`c:${c.id}`, c, q)));
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

  // コバコが攻撃を受けた: 1発でKO。荷物をその場に落とし、COURIER.respawn 秒後に復活。モダンは荷物の代わりに、倒した陣営（team）の次の保留を高確率保留にする
  koCourier(c: Courier, team = -1) {
    if (!this.couriers.includes(c)) return;
    this.couriers = [];
    this.courierAt = this.now + C.COURIER.respawn;
    if (this.modern) { const m = this.teams[team]?.m; if (m) m.nextHigh = true; this.addFx({ x: c.x, y: c.y, team: -1 }, 'aura', { r: 30, color: 'ult' }); return; }
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

  // 壁に遮られていないか（体の足元・中心・頭のどこかへ見通せれば届く）
  reach(p: Pt, t: Thing) {
    const obs = this.obstacles();
    return this.bodyPts(t).some((q) => lineOfSight(p.x, p.y, q.x, q.y, obs));
  }

  // 体の当たり（hitbox1）: 足元を下辺の中央とする体の箱（BODY_BOX×表示倍率）。足元から上へ見て最初の壁で切る（壁に隠れた頭は体に数えない）。
  // 当たりは縦長のカプセル（半径 w/2、足元から上へ h−w/2 の線分）で表す。下は足元の円（今の判定）を含む。箱を持たない場の物（ファンネルなど）は今の足元の円
  boxScale(t: Thing) { return t.k === 'p' ? (t.o.assist ? C.ASSIST.scale : 1) : t.k === 'boss' ? 2 : t.k === 'c' ? 1 : t.o.dot ?? 0; }
  clipCache = new Map<string, number>(); // 体の箱の高さ（壁で切った後）。tick ごとに消す
  hitShape(t: Thing) {
    const s = this.boxScale(t);
    if (!s) return { r: t.r, lo: 0, hi: 0, h: 0 }; // lo・hi: カプセルの線分（足元から上への高さ）
    const key = `${t.x}|${t.y}|${s}`;
    let h = this.clipCache.get(key);
    if (h === undefined) {
      h = C.BODY_BOX.h * s;
      for (const w of this.walls) if (t.x >= w.x && t.x <= w.x + w.w && w.y + w.h <= t.y && w.y + w.h > t.y - h) h = t.y - (w.y + w.h); // 足元の真上の一番近い壁の下端まで
      this.clipCache.set(key, h);
    }
    const r = Math.min((C.BODY_BOX.w / 2) * s, h / 2);
    return { r, lo: 0, hi: h - r, h }; // 線分は足元から: カプセルの下は足元より r だけ下まで（今の足元の円を含む）
  }
  // 体の箱の中心（狙いの先）
  boxCenter(t: Thing): Pt { return { x: t.x, y: t.y - this.hitShape(t).h / 2 }; }
  // 撃つ側の体の箱の中心の、足元からの高さ（弾・ビーム・矢はここから出る）
  shotUp(p: Player) { return (C.BODY_BOX.h / 2) * (p.assist ? C.ASSIST.scale : 1); }
  // p の体の中心から t の体の箱の中心への向き（オートアタック・技の自動照準）
  aimAt(p: Player, t: Thing) { const c = this.boxCenter(t); return Math.atan2(c.y - (p.y - this.shotUp(p)), c.x - p.x); }
  // 点 (x, y) から体までの一番近い距離（体の内側は 0 以下）
  bodyDist(t: Thing, x: number, y: number) {
    const b = this.hitShape(t), cy = Math.max(t.y - b.hi, Math.min(t.y - b.lo, y));
    return Math.hypot(x - t.x, y - cy) - b.r;
  }
  // 体を円の列で表す（扇・長方形など円以外の形との重なり用。隣の円の間隔は半径以下）
  bodyCircles(t: Thing) {
    const b = this.hitShape(t), len = b.hi - b.lo, n = len > 0 ? Math.ceil(len / b.r) + 1 : 1;
    return Array.from({ length: n }, (_, i) => ({ x: t.x, y: t.y - b.lo - (n > 1 ? (len * i) / (n - 1) : 0), r: b.r }));
  }
  // 体の見える・見通せるかを調べる点: 足元・中心・頭・中心の高さの左右の端（箱を持たないものは足元だけ）
  bodyPts(t: Thing) {
    const b = this.hitShape(t);
    if (!b.h) return [{ x: t.x, y: t.y }];
    const m = t.y - b.h / 2, w = C.BODY_BOX.w / 2 * this.boxScale(t);
    return [{ x: t.x, y: t.y }, { x: t.x, y: m }, { x: t.x, y: t.y - b.h + 1 }, { x: t.x - w + 1, y: m }, { x: t.x + w - 1, y: m }];
  }
  // 陣営 team から体の一部でも見えるか（visibleTo を体の点で）
  bodySeen(team: number, t: Thing, obs: Rect[]) {
    return this.bodyPts(t).some((q) => this.visibleTo(team, q.x, q.y, obs));
  }

  // 通常攻撃の射程（ウルト中は変身先、ほかはモードのうち一番長いもの）
  atkRange(p: Player) {
    if (p.ult && !p.ult.pending) return C.ULT_FORMS[p.ult.form].range;
    return aaRange(p.char);
  }

  // 照準モードで対象を選ぶ。コバコのモードは射程内のコバコを最優先。ほかはユニット（敵プレイヤー・大将・ユニット扱いの場の物）を優先し、いなければコバコ以外の対象
  // T: 相手の位置をこのサーバー時刻（elapsed）まで戻して選ぶ（人間の近接AAの巻き戻し判定）
  pickTarget(p: Player, R = this.atkRange(p), T?: number): Thing | null {
    const d = (t: Thing) => this.bodyDist(t, p.x, p.y); // 自分の足元から相手の体までの一番近い距離
    const all = (T === undefined ? this.enemyThings(p.team) : this.rewound(this.enemyThings(p.team), T)).filter((t) => d(t) <= R && this.targetable(t) && this.reach(p, t) && this.seenBy(p.team, t)); // 自陣営の画面に映っている敵だけ（見えない敵には自動で撃たない・向かない）
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

  jumps = new Map<string, { t: number; before: Pt; after: Pt; born: boolean }[]>();

  noteJump(id: string, before: Pt, after: Pt, born = false) { return lag.noteJump(this, id, before, after, born); } // 中身は lagcomp.ts（refac1）

  relocate(id: string, object: Pt, to: Pt) {
    this.noteJump(id, object, to);
    Object.assign(object, to);
  }

  recordHist() { return lag.recordHist(this); } // 中身は lagcomp.ts（refac1）

  rttClock = () => performance.now(); // 往復の遅延の計測の時計（ms。検証で差し替える）
  lagT(p: Player): number | null { return lag.lagT(this, p); } // 中身は lagcomp.ts（refac1）

  rewound(things: Thing[], T: number): Thing[] { return lag.rewound(this, things, T); } // 中身は lagcomp.ts（refac1）

  // その対象への通常攻撃が近接になるか（ウルトの近接の変身を含む）
  meleeAt(p: Player, t: Thing) {
    if (p.ult && !p.ult.pending) return !C.ULT_FORMS[p.ult.form].ranged;
    return aaMode(p.char, Math.hypot(t.x - p.x, t.y - p.y)).kind === 'melee';
  }

  // 敵の対象にできるか（敵の対象にならない状態のプレイヤーは除く）
  // 陣営 team の画面に映っているか（スナップショットの出し分け sendSnapshots と同じ判定。コバコと霧に隠れない場の物は常に映る、開幕中は敵大将も映る）
  seenBy(team: number, t: Thing) {
    if (t.k === 'c' || (t.k === 'e' && !ENTS[t.o.kind].fog) || (t.k === 'boss' && this.phase === 'intro')) return true;
    return this.bodySeen(team, t, this.seeWalls);
  }

  targetable(t: Thing) {
    return !(t.k === 'p' && this.effect(t.o, 'hidden'));
  }

  // 技・攻撃の向き: 狙っている対象があればその方向、なければ向いている方向
  aimOf(p: Player) {
    return p.tgt ? this.aimAt(p, p.tgt) : p.face;
  }

  // 技の向き: 技の矢印で決めた向きがあればそれ。なければ技の射程 R で通常攻撃と同じ照準ルール（pickTarget）で選んだ対象の方向、いなければ向いている方向
  skillAim(p: Player, R: number) {
    if (p.skillA !== undefined) return p.skillA;
    const t = this.pickTarget(p, R);
    return t ? this.aimAt(p, t) : p.face;
  }

  inArc(p: Player, tx: number, ty: number, tr: number, aim = p.face, range = C.ATTACK_RANGE, arc = C.ATTACK_ARC): boolean {
    const d = Math.hypot(tx - p.x, ty - p.y);
    if (d > range + tr) return false;
    let a = Math.atan2(ty - p.y, tx - p.x) - aim;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.abs(a) <= arc / 2;
  }

  // 通常攻撃の間隔: 使うモードの間隔（ウルト中は近接）× 状態の間隔倍率（アシストには掛けない）
  atkCooldown(p: Player) {
    let cd = p.ult && !p.ult.pending ? C.ATTACK_COOLDOWN_MELEE : aaMode(p.char, p.tgt ? Math.hypot(p.tgt.x - p.x, p.tgt.y - p.y) : null).cd;
    if (!p.assist) for (const k of STATUS_ORDER) { const s = this.stat(p, k); if (s?.cd !== undefined) cd *= s.cd; }
    return cd;
  }

  // courier: コバコにも当てる（照準モードがコバコのとき。Bot のコバコ攻撃は true を渡す）
  attack(id: string, aim?: number, courier?: boolean) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'playing' || !p.alive || this.effect(p, 'noAttack') || this.now < p.stunUntil || this.now < p.cooldownUntil) return;
    p.cooldownUntil = this.now + this.atkCooldown(p);
    this.cancelRecall(p); // 攻撃でリコール中断
    const a = aim ?? p.face, toC = courier ?? p.aim === 'courier';
    if (SKILLS[p.char]?.attack?.(this, p, a)) return; // 技による通常攻撃の上書き
    const aaShot = (s: Shot) => Object.assign(s, { aa: true, courier: toC, left: p.assist ? s.left : s.left * C.AA_SHOT_REACH }); // キャラの通常攻撃の弾は射程より遠くまで飛ぶ（アシストの弾は射程まで）
    let dmg = p.assist ? C.ATTACK_DAMAGE * lvMult(C.POWER_MULT, p.tier) : charAtk(p.char);
    let range = C.ATTACK_RANGE, arc = C.ATTACK_ARC, fx: string | undefined;
    if (p.ult && !p.ult.pending) {
      const f = C.ULT_FORMS[p.ult.form];
      dmg *= f.atk * lvMult(C.POWER_MULT, p.ult.tier);
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
    if (lt !== null && this.measure) {
      const m = this.measure.client([...this.owners].find(([, id]) => id === p.id)?.[0] ?? p.id);
      const requested = this.elapsed - p.viewT!;
      m.requested.add(requested * 1000); m.actual.add((this.elapsed - lt) * 1000);
      if (requested >= C.NET_REWIND_MAX) m.capped++;
    }
    for (const t of lt === null ? this.enemyThings(p.team) : this.rewound(this.enemyThings(p.team), lt)) {
      if ((toC || t.k !== 'c') && this.bodyCircles(t).some((q) => this.inArc(p, q.x, q.y, q.r, a, range, arc)) && this.reach(p, t)) this.hitThing(p, t, dmg, true);
    }
  }

  // 対象にダメージ。全体の倍率、attacker の大将へ×2（技にも掛かる）。aa: 通常攻撃（当たった側に汗のエフェクト。KOの表示の手段）
  hitThing(p: Player, t: Thing, base: number, aa = false) {
    if (this.phase !== 'playing') return; // 結果画面の技は見た目だけ
    if (this.now < p.weakUntil) base *= this.modern ? C.SLOT_MODERN.game.penalty.atk : C.SLOT.penalty.weak; // スロットの罰の攻撃力低下
    for (const k in p.st) if (this.now < p.st[k].until && p.st[k].atk !== undefined) base *= p.st[k].atk!; // 与えるダメージの倍率の状態（ずんだ餅など）
    if (t.k === 'c' && this.courierGuard && p.bot) return; // e2e: Bot の攻撃ではコバコが倒れない
    if (aa && t.k === 'p' && this.effect(t.o, 'noAaDmg')) return; // 通常攻撃のダメージを受けない状態
    if (t.k === 'c') { this.addToku(p.team, p, 'courier'); this.cm.courier(p); this.rec.courier(this, p); return this.koCourier(t.o, p.team); } // コバコは1発でKO
    this.addToku(p.team, p, 'hit');
    let dmg = base * C.DAMAGE_MULT;
    if (t.k === 'boss' && roleOf(p.char)?.name === 'attacker') dmg *= C.ATTACKER_BOSS_MULT;
    if (aa) this.addFx({ x: t.x, y: t.y, team: t.o.team }, 'sweat', { target: thingId(t) });
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
    this.rec.hurt(v, attacker ? this.players.get(attacker) : null, raw, Math.min(Math.max(0, v.hp), Math.round(dmg)));
    if (attacker) { // 交戦の始まり・当てた相手が最初に当てた時に見えていたか（本人の立ち絵の反応用。react1）
      if (!v.engage || this.now - (v.hitAt ?? -Infinity) > C.REACT.engageGap) v.engage = { at: this.now, seen: new Map() };
      const a = this.players.get(attacker);
      if (a && !v.engage.seen.has(attacker)) v.engage.seen.set(attacker, this.bodySeen(v.team, { k: 'p', o: a, x: a.x, y: a.y, r: C.PLAYER_RADIUS }, this.seeWalls));
    }
    v.hp -= Math.round(dmg);
    v.hitAt = this.now;
    if (!v.bot && v.qAt !== null) v.recallAt = this.now; // 被弾: 押し続けている人間は溜め直し（0から）
    else this.cancelRecall(v); // Bot は中断
    if (attacker) v.lastHitBy.set(attacker, this.now);
    this.cm.damage(v, attacker ? this.players.get(attacker) ?? null : null, dmg, how);
    if (v.hp > 0) return;
    if (v.ult && !v.ult.pending) return this.endUlt(v); // ウルト中に撃破されたら、元のキャラがその場にHP100%で戻る
    v.alive = false;
    v.hp = 0;
    v.koAt = this.now;
    v.qAt = v.recallAt = null; v.recallBreaks = 0;
    this.cancelStatuses(v); // KOで消える状態（タメ中に倒されたら突撃は不発。CTは消費済み）
    const killer = attacker ? this.players.get(attacker) : undefined;
    this.rec.ko(this, v, killer);
    if (killer && !v.assist) for (const c of this.clients) if (this.owners.get(c.sessionId) === killer.id) c.send('ko', { victimChar: v.char, how, at: this.elapsed }); // KOカットイン用（アシストは立ち絵がないので出さない）
    // 倒された本人へ: 誰に（kc: キャラ。大将は大将のキャラ、罰は null）何で倒されたか
    for (const c of this.clients) if (this.owners.get(c.sessionId) === v.id) c.send('koed', { kc: killer?.char ?? (raw ? null : BOSS_CHAR[1 - v.team]), kt: killer?.team ?? 1 - v.team, how, kid: killer?.id ?? null, unseen: !!killer && v.engage?.seen.get(killer.id) === false, sec: v.engage ? this.now - v.engage.at : null }); // kid: 倒した人、unseen: 倒した人が最初に当てた時に見えていなかった、sec: 交戦の始まりから倒されるまで（react1）
    for (const c of this.clients) c.send('kill', { kc: killer?.char ?? null, kt: killer?.team ?? 1 - v.team, vc: v.char, vt: v.team, at: this.elapsed }); // キルログ用（kc なし＝大将の反撃）
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
    v.respawnTotal = this.practice ? 0 : Math.min(C.RESPAWN_MAX, C.RESPAWN_BASE + C.RESPAWN_COEF * v.rage); // 練習は反省なしで即復活
    v.respawnAt = this.now + v.respawnTotal;
  }

  damageBoss(boss: Boss, dmg: number, p: Player) {
    if (this.phase !== 'playing' || (this.bossGuard && p.bot) || boss.moving) return; // 移動の予告中は無敵
    this.bossDmg[1 - boss.team][p.assist ? 'assist' : 'player'] += Math.min(dmg, boss.hp);
    this.rec.boss(this, p, Math.min(dmg, boss.hp));
    if (this.counterMode[1 - boss.team] === 'attack' && !p.assist) this.counterBoss[1 - boss.team] += Math.min(dmg, boss.hp); // 記録用（counter の逆襲中の大将ダメージ）
    boss.hp = Math.max(this.practice ? 1 : 0, boss.hp - dmg); // 練習の大将は倒れない（HP1で止まる）
    boss.target = p.id;
    boss.dmgAtBase += dmg;
    p.rage += dmg * C.RAGE_BOSS_DMG_COEF;
    this.cm.bossDmgBy(p, dmg);
    const sc = this.sc[p.team]; if (sc && p.char === 'sora' && p.st.solar) sc.dmg += dmg; // 記録用（そら砲の大将ダメージ。botai4）
    if (!p.assist) for (const c of this.clients) if (this.owners.get(c.sessionId) === p.id) c.send('bossHit', { at: this.elapsed }); // 当てた本人へ（立ち絵の反応。画面側で間引く。react1）
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
    this.noteJump(`boss:${boss.team}`, boss, b);
    Object.assign(boss, { x: b.x, y: b.y, dmgAtBase: 0, moving: false, moved: true });
    this.cm.bossMoved(boss, first);
  }

  // 大将の爆発: 陣営 team の敵プレイヤー（アシスト含む）のうち半径 r に触れるものにダメージ
  explode(team: number, x: number, y: number, r: number, dmg: number) {
    for (const q of this.players.values()) if (q.team !== team && q.alive && this.bodyDist({ k: 'p', o: q, x: q.x, y: q.y, r: C.PLAYER_RADIUS }, x, y) <= r) this.damagePlayer(q, dmg, null);
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

  classicHold(team: number, result?: CHold['outcome'], act?: string | null): CHold { return Slots.classicHold(this, team, result, act); } // 中身は slot.ts（refac2）

  slotPlayers(team: number) { return Slots.slotPlayers(this, team); } // 中身は slot.ts（refac2）
  teamAssist(team: number) { return [...this.players.values()].find((p) => p.assist && p.team === team && p.alive); }

  slotTarget(team: number): SlotTarget { return Slots.slotTarget(this, team); } // 中身は slot.ts（refac2）

  slotSyms(team: number): SlotTarget[] { return Slots.slotSyms(this, team); } // 中身は slot.ts（refac2）

  startSpin(team: number, result?: CHold['outcome'], act?: string | null) { return Slots.startSpin(this, team, result, act); } // 中身は slot.ts（refac2）


  penalty(team: number) { return Slots.penalty(this, team); } // 中身は slot.ts（refac2）

  updateReflect(dt: number) { return Slots.updateReflect(this, dt); } // 中身は slot.ts（refac2）

  reflecting(team: number) { return Slots.reflecting(this, team); } // 中身は slot.ts（refac2）

  updateSlots() { return Slots.updateSlots(this); } // 中身は slot.ts（refac2）

  payout(team: number, t: SlotTarget, tier: number) { return Slots.payout(this, team, t, tier); } // 中身は slot.ts（refac2）

  // ---- モダンのスロット（handoff_slot3）----

  updateModern(dt: number) { return Slots.updateModern(this, dt); } // 中身は slot.ts（refac2）



  payModern(team: number, pay: Pay, first: boolean, chain: number) { return Slots.payModern(this, team, pay, first, chain); } // 中身は slot.ts（refac2）

  penaltyModern(team: number, n: 1 | 2) { return Slots.penaltyModern(this, team, n); } // 中身は slot.ts（refac2）

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
    const up = this.shotUp(p), s: Shot = { id: this.nextId++, kind, team: p.team, owner: p.id, x: p.x, y: p.y - up, up, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, sp, left: range, dmg }; // 撃つ側の体の中心から（up: 足元からの高さ。壁との当たりは真下の床で）
    this.shots.push(s);
    return s;
  }

  // 弾・矢: 壁で止まり、敵（プレイヤー・大将・場の物）に当たると消える
  updateShots(dt: number) {
    for (const s of [...this.shots]) {
      const owner = this.players.get(s.owner);
      s.steer?.(s, dt);
      let step = Math.min(s.sp * dt, s.left), done = (!owner || (owner.assist && !owner.alive)) && !s.boom; // 持ち主がいない（倒れたアシストを含む）弾は消える
      let out: 'hit' | 'miss' | 'wall' | null = done ? null : 'miss'; // 通常攻撃の弾の結果（記録用）
      while (step > 0 && !done) {
        const d = Math.min(8, step);
        s.x += (s.vx / s.sp) * d; s.y += (s.vy / s.sp) * d; s.left -= d; step -= d;
        if (this.walls.some((w) => inRect(s.x, s.y + (s.up ?? 0), w))) { done = true; out = 'wall'; break; } // 壁は弾の真下の床の位置で
        const hit = this.enemyThings(s.team).find((t) => (!s.aa || s.courier || t.k !== 'c') && this.bodyDist(t, s.x, s.y) <= C.BULLET_RADIUS); // 通常攻撃の弾はコバコを狙うときだけコバコに当たる
        if (hit) {
          done = true; out = 'hit';
          if (s.boom) break;
          if (s.onHit) s.onHit(hit);
          else this.hitThing(owner!, hit, s.dmg, s.aa);
          break;
        }
      }
      if (!(done || s.left <= 0)) continue;
      this.shots = this.shots.filter((x) => x !== s);
      if (s.aa && owner && out) this.rec.aaShot(owner, out);
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
    return this.enemyThings(p.team).filter((t) => this.bodyDist(t, c.x, c.y) <= r); // 相手は体の箱で測る（hitbox1）
  }

  inCircle(p: Player, x: number, y: number, r: number) {
    return this.enemyThings(p.team).filter((t) => this.bodyDist(t, x, y) <= r);
  }

  // 前方の長方形（長さ len、幅 w）に入る敵
  inRectAhead(p: Player, a: number, len: number, w: number) {
    const ux = Math.cos(a), uy = Math.sin(a);
    return this.enemyThings(p.team).filter((t) => this.bodyCircles(t).some((q) => {
      const rx = q.x - p.x, ry = q.y - p.y, along = rx * ux + ry * uy, side = Math.abs(-rx * uy + ry * ux);
      return along >= -q.r && along <= len + q.r && side <= w / 2 + q.r;
    }));
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
    Object.assign(t.o, moveBody(t.o.x, t.o.y, ux * dist, uy * dist, t.k === 'p' ? C.PLAYER_RADIUS : t.o.r, this.obstacles(), false, (q) => this.noteJump(thingId(t), t.o, q)));
  }

  // 壁の段階（0=無傷、WALL_HITS-1 まで。壊れた壁は扱わない）
  wallStage(x: number, y: number) { return this.wallDmg.get(y * MAP.width + x) ?? 0; }

  // 壊せる壁を n 段階進める（WALL_HITS 段階で破壊）。hit: この発動で段階を進めたマス（1回の発動で同じマスは1回まで）。段階を進めたマスを [x, y, 進んだ段階数] で返す
  hitWalls(tiles: number[][], hit: Set<number>, n = 1, by?: Player) { // by: 壊したキャラ（記録用）
    const adv: number[][] = [], gone: number[][] = [];
    for (const [x, y] of tiles) {
      const k = y * MAP.width + x;
      if (hit.has(k) || this.tiles[y]?.[x] !== '#') continue;
      hit.add(k);
      const s0 = this.wallDmg.get(k) ?? 0, s = s0 + n;
      adv.push([x, y, Math.min(n, C.WALL_HITS - s0)]);
      if (s >= C.WALL_HITS) { this.wallDmg.delete(k); gone.push([x, y]); }
      else { this.wallDmg.set(k, s); this.crackLog.push([x, y, s]); }
    }
    if (gone.length) this.breakWalls(gone);
    this.rec.wall(by, adv.reduce((a, t) => a + t[2], 0));
    return adv;
  }

  breakWalls(tiles: number[][]) {
    for (const [x, y] of tiles) this.tiles[y] = this.tiles[y].slice(0, x) + '.' + this.tiles[y].slice(x + 1);
    this.broken.push(...tiles);
    this.walls = wallRects(this.tiles); // 当たり判定・視界・経路探索に即反映
    this.clipCache.clear(); // 体の箱を切る壁も変わる
    this.seeWalls = seeRects(this.tiles); // 視界の壁も同じく
  }

  // a: 技の矢印で決めた向き（なし＝自動照準）
  skill(id: string, a?: number) {
    const p = this.players.get(id);
    const sk = p && CHARS[p.char]?.skill, h = p && SKILLS[p.char];
    if (!p || !sk || !h || (this.phase !== 'playing' && this.phase !== 'ended') || !p.alive || this.now < p.skillReadyAt || this.effect(p, 'noSkill')) return; // 技不可の状態（ずんだ餅など）
    p.skillA = Number.isFinite(a) ? a : undefined;
    let used;
    try { used = h.use(this, p, this.aimOf(p)); } finally { p.skillA = undefined; }
    if (used !== false) p.skillReadyAt = this.now + sk.ct; // false: CT は技処理が始める
    this.cancelRecall(p); // 技でリコール中断
    if (this.phase === 'playing') { this.cm.skill(p); this.rec.skill(p); } // 実況: 回避の判定
  }

  // 技の入力を離した: 矢印の技はここで発動（タメ中なら向きを変えるだけ）。a: 矢印の向き（なし＝自動照準）
  skillUp(id: string, a?: number) {
    const p = this.players.get(id), h = p && SKILLS[p.char];
    if (!p?.alive || !h?.arrow) return;
    if (h.reAim?.(this, p, Number.isFinite(a) ? a! : undefined)) return;
    this.skill(id, a);
  }

  arrowView(p: Player) { return snap.arrowView(this, p); } // 中身は snapshot.ts（refac1）

  // 移動入力: 人間は最後に届いた入力（tickの境目で入力が空になっても途切れない）、Bot は今の移動方向
  moveIntent(p: Player): [number, number] {
    return p.bot ? [p.dx, p.dy] : [p.inDx, p.inDy];
  }

  // ---- アシスト（選べないキャラの専用ユニット） ----

  // 技: 一定時間ごと、条件がそろえば発動。強さの倍率を効果に掛ける
  updateAssists() {
    for (const p of this.players.values()) {
      if (!p.assist || !p.alive || this.now < p.skillReadyAt) continue;
      const U = C.ASSIST.units[p.char], k = lvMult(C.POWER_MULT, p.tier), d = (o: Pt) => Math.hypot(o.x - p.x, o.y - p.y);
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
        if (!isUnit(t) || this.bodyDist(t, w.x, w.y) > w.r) continue;
        this.hitThing(owner, t, w.dmg);
        if (w.push) { const d = Math.hypot(t.x - w.x, t.y - w.y) || 1; this.push(t, (t.x - w.x) / d, (t.y - w.y) / d, w.push); } // 外向きにはじく
      }
      this.addFx(w, w.color ? 'aura' : 'ring', { r: w.r, color: w.color ?? 'dash' });
    }
  }

  // ---- Bot ----

  updateBots() { return Bots.updateBots(this); } // 中身は bot.ts（refac2）

  botSkillUseful(p: Player): boolean { return Bots.botSkillUseful(this, p); } // 中身は bot.ts（refac2）

  nearFoe(p: Player, r: number, ok: (t: Thing) => boolean) { return Bots.nearFoe(this, p, r, ok); } // 中身は bot.ts（refac2）


  botThink(p: Player, obs: Rect[]) { return Bots.botThink(this, p, obs); } // 中身は bot.ts（refac2）

  // ---- マクロ soracannon（botai4。実験用。本番の Bot は使わない） ----
  // そら役: その陣営で最初の九州そら（人間を除く）
  scSora(t: number) { return [...this.players.values()].find((q) => q.team === t && q.bot && !q.assist && q.char === 'sora'); }
  // そら役が撤退した時、残り時間でチャージが keys の最後から2番目の秒数（265）を超えられなければ作戦をやめる。撤退の回数を数える
  scUpdate(t: number) {
    const sc = this.sc[t], s = this.scSora(t);
    if (!sc || !s || s.alive || this.phase !== 'playing') return;
    if (s.koAt !== sc.koAt) { sc.koAt = s.koAt; sc.deaths++; } // 撤退の回数（作戦をやめた後も数える）
    if (sc.abort) return;
    const K = CHARS.sora.skill.keys as number[][], left = this.timeLeft - Math.max(0, s.respawnAt - this.now) - CHARS.sora.skill.ct;
    if (!sc.fired && left < K[K.length - 2][0]) { sc.abort = true; delete s.st.scHold; }
  }
  // 撃つ場所: 自陣側（中立・敵陣へは出ない）の床の格子のうち、そこから敵の大将までのビームが外周の壁に当たらない所（敵の大将の位置ごとに一度だけ求める）
  static scSpots = new Map<string, Pt[]>();
  scSpots(t: number, boss: Pt) {
    const key = `${t}|${Math.round(boss.x)}|${Math.round(boss.y)}`, S = C.BOT_SORA, T = MAP.tileSize, hw = (CHARS.sora.skill.w as number) / 2, tl = MAP.tiles as string[];
    let out = GameRoom.scSpots.get(key);
    if (out) return out;
    out = [];
    const clear = (a: Pt) => { const len = Math.hypot(boss.x - a.x, boss.y - a.y), ux = (boss.x - a.x) / len, uy = (boss.y - a.y) / len; for (let s = 0; s <= len; s += 4) { const x = a.x + ux * s, y = a.y + uy * s; for (let ty = Math.floor((y - hw) / T); ty <= Math.floor((y + hw) / T); ty++) for (let tx = Math.floor((x - hw) / T); tx <= Math.floor((x + hw) / T); tx++) if (tl[ty]?.[tx] === '#' && PERIMETER[ty]?.[tx]) return false; } return true; };
    for (let y = S.spotStep / 2; y < C.MAP_H; y += S.spotStep) for (let x = S.spotStep / 2; x < C.MAP_W; x += S.spotStep) {
      if (t === 0 ? x >= C.MAP_W / 2 : x <= C.MAP_W / 2) continue; // 自陣側だけ
      const tx = Math.floor(x / T), ty = Math.floor(y / T);
      if ([-1, 0, 1].some((d) => tl[ty + d]?.[tx] !== '.' || tl[ty]?.[tx + d] !== '.')) continue; // 床（まわり1マスも床）
      if (clear({ x, y })) out.push({ x, y });
    }
    GameRoom.scSpots.set(key, out);
    return out;
  }
  // soracannon の Bot の考え。扱ったら true（扱わない＝ふつうの流れ。守り役は p.role の guard）
  scThink(p: Player, obs: Rect[]) {
    const t = p.team, sc = this.sc[t]!, S = C.BOT_SORA, sora = this.scSora(t), boss = this.bosses[1 - t];
    const go = (to: Pt, key: string) => { p.goal = key; Bots.botGoto(this, p, to, obs); };
    const dist = (o: Pt) => Math.hypot(o.x - p.x, o.y - p.y);
    if (p !== sora) { // 偵察役: 発射の準備の間（残り prep 秒）、そら役以外で最初の Bot が敵の大将を視界に入れに行く（大将は攻撃しない）
      const scout = [...this.players.values()].find((q) => q.team === t && q.bot && !q.assist && q !== sora && q.alive);
      if (!sora || sc.fired || this.timeLeft > S.prep || p !== scout) { delete p.st.scScout; return false; }
      p.st.scScout ??= { until: Infinity, noAuto: true }; // 敵の大将（予告中＝無敵を含む）を撃たないよう、通常攻撃をしない
      this.rec.bot(p, 'raid');
      if (dist(boss) > S.scoutStop) go(boss, 'scout'); else this.setInput(p.id, 0, 0);
      return true;
    }
    p.st.scHold ??= { until: Infinity, noAuto: true }; // そら役は通常攻撃をしない（悪行を溜めない）
    const K = CHARS.sora.skill.keys as number[][], c = p.sk.charge ?? 0;
    const want = !sc.fired && (c >= K[K.length - 1][0] || boss.hp <= solarAt(c, 1, true) * C.DAMAGE_MULT * C.ATTACKER_BOSS_MULT);
    const foes = [...this.players.values()].filter((e) => e.team !== t && e.alive && !this.effect(e, 'hidden') && dist(e) <= C.BOT_AGGRO_RANGE && this.visibleTo(t, e.x, e.y, obs));
    const room = C.RECALL_ROOMS[t], safe = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
    if (want) { // 発射: 撃つ場所へ向かい、着いたら（敵の大将が予告中でなく、CT が明けていれば）敵の大将へ撃つ
      const spots = this.scSpots(t, boss);
      if (!spots.length) { sc.noSpot = true; sc.foeLib ||= roomKindAt(Math.floor(boss.x / MAP.tileSize), Math.floor(boss.y / MAP.tileSize)) === 'library'; }
      else {
        const spot = spots.reduce((a, b) => (dist(b) < dist(a) ? b : a));
        this.rec.bot(p, 'raid');
        if (dist(spot) > S.spotNear) { go(spot, 'scspot'); return true; }
        this.setInput(p.id, 0, 0);
        if (!boss.moving && this.now >= p.skillReadyAt && p.recallAt === null) {
          p.skillA = Math.atan2(boss.y - p.y, boss.x - p.x); this.skill(p.id); p.skillA = undefined;
          if (p.st.solar) { sc.fired = true; sc.charge = c; sc.foeHp = boss.hp; }
        }
        return true;
      }
    }
    // ふだん: 敵が見えたら戦わずに給湯室へ。HP が recallHp 未満で脅威がなければ帰還。それ以外は自陣側の裏側の部屋の資材を拾う
    const threat = foes.length > 0 || this.now - p.hitAt < C.BOT_RECALL_SAFE;
    if (threat) { if (p.recallAt !== null) this.cancelRecall(p); this.rec.bot(p, 'flee'); go(safe, 'flee'); return true; }
    if (!this.atBase(p) && p.hp < this.maxHp(p) * S.recallHp && p.recallAt === null && this.now >= p.recallBanUntil) p.recallAt = this.now;
    if (p.recallAt !== null) { this.rec.bot(p, 'recall'); this.setInput(p.id, 0, 0); return true; }
    if (p.eating && (p.hp >= this.maxHp(p) || !this.atBase(p))) p.eating = false;
    if (p.eating) { const f = this.items.find((i) => i.kind === 'heal' && inRect(i.x, i.y, room)); if (f) { this.rec.bot(p, 'eat'); go(f, `item:${f.id}`); return true; } }
    const own = (x: number) => (t === 0 ? x < C.MAP_W / 2 : x > C.MAP_W / 2), mats = this.materials.filter((m) => m.hi && own(m.x));
    this.rec.bot(p, 'gather');
    const m = mats.length ? mats.reduce((a, b) => (dist(b) < dist(a) ? b : a)) : null;
    if (m) go(m, `mat:${m.id}`); else go(safe, 'flee');
    return true;
  }

  assistThink(p: Player, obs: Rect[]) { return Bots.assistThink(this, p, obs); } // 中身は bot.ts（refac2）



  botGoto(p: Player, to: Pt, obs: Rect[]) { return Bots.botGoto(this, p, to, obs); } // 中身は bot.ts（refac2）


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

  statusView(p: Player) { return snap.statusView(this, p); } // 中身は snapshot.ts（refac1）

  classicView(sl: Slot, me?: string) { return snap.classicView(this, sl, me); } // 中身は snapshot.ts（refac1）



  sendSnapshots() { return snap.sendSnapshots(this); } // 中身は snapshot.ts（refac1）
}
