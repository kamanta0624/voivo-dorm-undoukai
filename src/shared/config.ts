// 調整用の数値はすべてここ（すべて仮置き）
export type Rect = { x: number; y: number; w: number; h: number; m?: Rect & { k: number } }; // m: 移動の当たり判定の形（wallRects が付ける。終端を短くした長方形と、丸める凸角 k: 1=左上 2=右上 4=右下 8=左下）
export type Pt = { x: number; y: number };

import MAP from './map.json';

// map.json（tools/gen_map.py が生成）から壁・部屋を作る。1タイル = MAP.tileSize px
const T = MAP.tileSize;
const W = MAP.width * T;
const H = MAP.height * T;
type Room = { id: string; team: string | null; type: string; rect: number[] };
const ROOMS = MAP.rooms as Room[];
const inner = (r: Room): Rect => ({ x: (r.rect[0] + 1) * T, y: (r.rect[1] + 1) * T, w: (r.rect[2] - r.rect[0] - 1) * T, h: (r.rect[3] - r.rect[1] - 1) * T });
const center = (r: Room): Pt => { const i = inner(r); return { x: i.x + i.w / 2, y: i.y + i.h / 2 }; };
const room = (team: string, id: string) => ROOMS.find((r) => r.id === `${id}_${team === 'kiritan' ? 'L' : 'R'}`)!;
const TEAM_KEYS = ['kiritan', 'zundamon']; // 陣営0, 1
const INTRO_SPEED = 2; // 試合開始前の演出（横並び・ズーム・カットイン・カウント・GAME START）の速さの倍率。各時間をこの値で割る
const BOSS_ROOM_CANDIDATES = ['bath', 'library', 'kitchen', 'svcA', 'svcB', 'svcC']; // 自陣側の study・dining（開始部屋）と廊下を除く6部屋

const WALL_EDGE = { trim: 4, round: 8 }; // 移動の当たり判定: 壁の終端（厚み1タイルの壁の端の面）を見た目より短くする量(px)、凸角の丸みの半径(px)

// '#' タイルを貪欲に矩形へまとめる（tiles は壁破壊で変わる試合中のタイル）
// 移動の当たり判定の形 m も付ける: 凸角（角の点を囲む4タイルのうち壁がその1つだけ）を丸め、両端が凸角の1タイル幅の面（壁の終端）を短くする。長方形どうしの継ぎ目は凸角にならない
export function wallRects(tiles: string[] = MAP.tiles): Rect[] {
  const used = tiles.map((row) => [...row].map((c) => c !== '#'));
  const out: Rect[] = [];
  for (let y = 0; y < MAP.height; y++) {
    for (let x = 0; x < MAP.width; x++) {
      if (used[y][x]) continue;
      let w = 1;
      while (x + w < MAP.width && !used[y][x + w]) w++;
      let h = 1;
      while (y + h < MAP.height && used[y + h].slice(x, x + w).every((u) => !u)) h++;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[yy][xx] = true;
      out.push({ x: x * T, y: y * T, w: w * T, h: h * T });
    }
  }
  const wall = (x: number, y: number) => tiles[y]?.[x] === '#';
  const convex = (x: number, y: number, ix: number, iy: number) => { const ox = 2 * x - 1 - ix, oy = 2 * y - 1 - iy; return !wall(ox, iy) && !wall(ix, oy) && !wall(ox, oy); }; // 角の点 (x, y) と、その角にある長方形の内側のタイル (ix, iy)
  for (const r of out) {
    const x0 = r.x / T, y0 = r.y / T, x1 = x0 + r.w / T, y1 = y0 + r.h / T;
    const tl = convex(x0, y0, x0, y0), tr = convex(x1, y0, x1 - 1, y0), br = convex(x1, y1, x1 - 1, y1 - 1), bl = convex(x0, y1, x0, y1 - 1);
    const s = WALL_EDGE.trim, L = tl && bl && r.h === T ? s : 0, R = tr && br && r.h === T ? s : 0, U = tl && tr && r.w === T ? s : 0, D = bl && br && r.w === T ? s : 0;
    r.m = { x: r.x + L, y: r.y + U, w: r.w - L - R, h: r.h - U - D, k: (tl ? 1 : 0) | (tr ? 2 : 0) | (br ? 4 : 0) | (bl ? 8 : 0) };
  }
  return out;
}

// 視界だけ通す壁（map.json の clear: glass＝アトリウムの南のガラス、fence＝屋外の部屋・犬走りの外側と、ウッドデッキと犬走りの間の柵）。移動・攻撃・弾・Bot の照準は '#' のまま遮る
const SEE_THROUGH = new Set([...MAP.clear.glass, ...MAP.clear.fence].map(([x, y]) => y * MAP.width + x));
export const seeThrough = (tx: number, ty: number) => SEE_THROUGH.has(ty * MAP.width + tx);
// 視界の壁（サーバーの visibleTo・クライアントの資材の表示）: 透過壁を床として wallRects でまとめる
export const seeRects = (tiles: string[] = MAP.tiles): Rect[] => wallRects(tiles.map((row, y) => [...row].map((c, x) => (c === '#' && seeThrough(x, y) ? '.' : c)).join('')));

export const CONFIG = {
  PORT: 2567,
  TICK_HZ: 20, // サーバー判定・同期レート
  // 通信（自キャラの予測と他キャラの補間）
  NET_MEASURE: true, // 通信・tick 計測（試合ごとに固定）
  NET_STEP: 0.05, // 入力1つぶんの時間(秒)。クライアントはこの間隔で入力を送り、サーバーは1tickに1つ処理する
  NET_EPS: 0.5, // 予測とサーバーの位置の差がこれ未満なら一致とみなす(px)
  NET_SNAP: 80, // これ以上のずれ（はじき・突撃・復活など）は補間せずそのまま反映(px)
  NET_SMOOTH_MS: 120, // 予測の補正を見た目上戻す時間
  RECONNECT_SEC: 30, // 通信が切れた人（スマホのバックグラウンド等）の再接続を待つ秒数。待つ間は Bot が代わりに動かす
  RESUME_RECONNECT_SEC: 5, // この秒数以上バックグラウンドにいたら、戻ったときに接続を張り直す
  // スマホのタッチ操作: dead=スティックの遊び(px)、r=スティックの台座の半径(px、論理解像度)
  TOUCH: { dead: 6, r: 32 },
  NET_CORR_SPEED: 300, // 補正で見た目が動く速さの上限(px/秒)。大きなずれは時間をかけて戻す
  NET_INTERP_DELAY: 0.2, // 他キャラはこの秒数だけ過去の位置を補間して描く（通信の揺らぎを吸収）。2026-11-21 0.25→0.2（lagcomp1。0.1・0.15 は揺らぎ100msで他キャラが飛ぶ）
  NET_REWIND_MAX: 0.35, // 近接の通常攻撃の巻き戻し判定の上限(秒)。人間の近接AAは、相手の位置をその人の画面の時刻（入力に載せた描画時刻）まで戻して測る。仮置き
  NET_OFFSET_DRIFT: 0.0005, // 時計合わせの追従量（受信ごと、秒）
  NET_EXTRAPOLATE: 0.1, // 補間の材料が届いていないとき、直前の速度で先を推測する上限(秒)
  NET_HIST_MAX: 100, // 予測の入力履歴の上限
  NET_CATCHUP: 3, // サーバー側の入力待ちがこれを超えたら1tickに2つ処理して追いつく
  NET_QUEUE_MAX: 20, // サーバー側の入力待ちの上限
  TEAM_SIZE: 4, // 開始時に足りない枠はBotで埋める
  LOBBY_GRACE: 15, // 待機画面: 人間が複数のとき、最初の出撃から開始までの選択猶予(秒)
  MAX_CLIENTS: 16, // 超過分は観戦（e2e の部屋だけ。常設の部屋は ROOM_FULL で満員）
  ROOMS: 2, // 常設の部屋の数（サーバー起動時に作り、空になっても残す）。仮置き
  PRACTICE_ROOMS: 4, // 練習の部屋を同時に作れる数（仮置き。handoff_practice1）
  ROOM_FULL: 8, // 常設の部屋の満員（人間の参加者の数）。仮置き
  STATUS_POLL_SEC: 3, // タイトル画面の部屋一覧の自動更新の間隔(秒)
  TUTORIAL: { autoBase: 1.5, autoPerChar: 0.12 }, // ルール説明のオートで音声のない行: autoBase + 文字数 × autoPerChar 秒で次へ
  MATCH_TIME: 300, // 秒
  // 開始と終了の演出
  INTRO_SPEED,
  INTRO_MODE: 'new' as 'new' | 'old', // 開幕演出: new=カメラが敵大将→味方大将→散らかった一角→味方全員→準備してね→3,2,1,0 / old=旧（横並び万歳→味方カットイン→3,2,1→GAME START）
  // 新開幕の各カット [名前, 秒数]（INTRO_SPEED で割る）。この後に count 秒のカウント（3,2,1。実秒数、INTRO_SPEED の影響なし。開始部屋の中は動ける）、0 で試合開始。panMs: カット間のカメラのパン（拡大はしない）
  INTRO2: {
    cuts: [['enemyBoss', 3], ['ownBoss', 3], ['mess', 3], ['allies', 3], ['ready', 2]].map(([k, t]) => [k, (t as number) / INTRO_SPEED]) as [string, number][],
    panMs: 700 / INTRO_SPEED,
    count: 3,
    messR: 240, // 「散らかった一角」: 資材がこの半径に一番多く集まっている場所
    lift: 50, // 大将を映すとき、カメラの中心を大将より上にずらす量(px)。頭上の文字が画面上部の表示に隠れないように
    labelUp: 85, // 大将の頭上の文字の高さ(px)
  },
  INTRO_LINEUP: 2 / INTRO_SPEED, // 開始時に味方を横並び（万歳）で見せる秒数
  INTRO_CUTIN: 2 / INTRO_SPEED, // 続く味方1人ずつのカットインの秒数
  COUNTDOWN: 3 / INTRO_SPEED, // カットインの後のカウント秒数（この間は開始した部屋から出られない）。表示は 3・2・1
  GAME_START_MS: 1200 / INTRO_SPEED, // 「GAME START」カットインの長さ
  SITUATION_AT: [180, 120, 60], // 形勢（優勢／接戦／劣勢）を知らせる残り秒数
  SITUATION_DIFF: 0.1, // 両大将のHP割合の差がこれ以上なら優勢／劣勢
  SITUATION_MS: 2000, // 形勢カットインの長さ
  END_WARN_AT: [30, 10], // 試合終了前に残り秒数を知らせる
  END_COUNT: 3, // 終了直前のカウント（3・2・1）
  KILL_LOG_MAX: 3, // キルログの件数。超えたら古い順に消える
  KILL_LOG_SEC: 3, // キルログの1行の寿命(秒)
  INTRO_GAP: 40, // 開始演出で study に横並びにする間隔(px)
  INTRO_ZOOM: 2.5, // 開始演出のカメラの拡大率
  INTRO_CAM_MS: 600 / INTRO_SPEED, // 開始演出のカメラの寄り・戻りの時間
  SE_VOLUME: 0.5, // スロットの先バレ音・当選音の音量（0〜1。仮置き）
  SLOT_CUTIN_MS: 2000, // スロットの当たり・連チャンのカットインの長さ
  SLOT_REEL_MS: 70, // 回転中のリールの絵柄が切り替わる間隔

  MAP_W: W,
  MAP_H: H,
  TILE: T,
  WALLS: wallRects(),
  SEE_WALLS: seeRects(), // 視界の壁（透過壁を除く）
  BOSS_ROOM_CANDIDATES,
  BOSS_ROOM_DIST_SUM_MAX: 3774, // 3部屋の、中央（hall の中心）からの経路距離の合計の上限(px)
  HEAL_SPOTS: TEAM_KEYS.flatMap((t) => { const i = inner(room(t, 'kitchen')); return [0.2, 0.8].map((fx) => [i.x + i.w * fx, i.y + i.h * 0.5]); }), // 回復アイテム（ご飯）の場所: 給湯室（kitchen）だけに各2個（上限）。大将の拠点＝部屋の中心と重ならない位置。前半が陣営0、後半が陣営1
  BOSS_ROOM_COUNT: 3, // 試合開始時に候補からランダムに選ぶ数（左右で同じ部屋）。大将の出現・逃亡先になる
  SPAWNS: TEAM_KEYS.map((t) => { const i = inner(room(t, 'study')); return { x: i.x + i.w / 2, y: i.y + i.h * 0.75 }; }), // 大将の拠点（study中心）と重ならない位置
  START_ROOMS: TEAM_KEYS.map((t) => inner(room(t, 'dining'))), // 開始した部屋（食堂。カウント中はここから出られない）
  RECALL_ROOMS: TEAM_KEYS.map((t) => inner(room(t, 'kitchen'))), // リコールの行き先（給湯室）
  COURIER_START: center(ROOMS.find((r) => r.id === 'entrance')!), // ブイブイ・コバコの出現・復活場所（マップ中央下部）
  COURIER_ROUTE: ['entrance', 'hall', 'smoking'].map((id) => { const r = ROOMS.find((q) => q.id === id)!; return { ...center(r), room: id, area: inner(r) }; }), // コバコの巡回経路: 中央3部屋の中心を往復する（entrance から出発、両端で折り返し。room: 部屋の id、area: 部屋の内側）
  COURIER_DROP: { n: 2, cap: 9 }, // コバコが巡回の部屋に着くたび、その部屋に高性能の徳（TOKU.materialBig）を n 個置く。部屋の未取得のコバコの徳が cap 個以上なら置かない
  WALL_EDGE, // 移動の当たり判定の壁の終端・凸角（wallRects）

  PLAYER_HP: 100,
  PLAYER_RADIUS: 10,
  PLAYER_SPEED: 170, // px/秒
  ATTACK_DAMAGE: 20,
  ATTACK_RANGE: 50,
  ATTACK_ARC: Math.PI / 2, // 前方扇形の角度
  ATTACK_COOLDOWN_MELEE: 1, // 通常攻撃（オート・手動とも）の間隔: 近接
  ATTACK_COOLDOWN_RANGED: 1.5, // 遠距離（弾のモード）
  VISION_RADIUS: 300,
  VISION_SCALE: 0.6, // 視界の率: 全キャラ・大将の視界半径（stat.vision・VISION_RADIUS）に掛ける。標準（300）が画面の縦（VIEW_H/2＝180）に収まる値。サーバー・クライアントとも visionRadius 経由で使う
  // ロール固有の効果（キャラの role は chars.ts。HP・攻撃・移動・視界は各キャラの stat）
  BALANCE_ALONE_RADIUS: 200, // balance: この半径に味方がいないとき被ダメ軽減
  BALANCE_ALONE_CUT: 0.2,
  DEFENSE_CUT: 0.2, // defense: 被ダメ軽減
  ATTACKER_BOSS_MULT: 2, // attacker: 大将へのダメージ倍率（技にも掛かる）
  BULLET_SPEED: 600, // 弾・矢の速さ(px/秒)
  BULLET_RADIUS: 4,
  AIM_MODES: ['nearest', 'lowhp', 'boss', 'courier'], // 照準モード（Tabで順に切り替え）。courier: コバコ最優先（ほかのモードでは通常攻撃がコバコに当たらない）
  AIM_LABEL: { nearest: '一番近い敵', lowhp: '一番HPが低い敵', boss: '大将優先', courier: 'コバコ' } as Record<string, string>,
  BOT_AIM: 'boss',

  BOSS_HP: 1000,
  BOSS_RADIUS: 24,
  BOSS_DAMAGE: 15,
  BOSS_DAMAGE_MULT: 1.2, // 大将の反撃ダメージの倍率
  BOSS_ASSIST_MULT: 3, // アシストへの反撃はさらにこの倍率
  BOSS_RANGE: 120,
  BOSS_COOLDOWN: 1,
  BOSS_MOVE_THRESHOLD: 200, // 同じ拠点での被ダメ累計がこれ以上で移動（予告→広範囲攻撃→移動。この間は無敵）。1回目の移動以降が第2形態
  BOSS_SHOT: { range: 260, speed: 600, boom: 40, dmg: 12, every: 2 }, // 第2形態: 範囲 range 内の敵全員に1体ずつ弾（弾速 speed）。着弾地点で半径 boom の爆発、ダメージ dmg、間隔 every 秒
  BOSS_BLAST: { r: 220, warn: 1.5, dmg: 30 }, // 拠点移動の前の広範囲攻撃: 半径・予告の秒数・ダメージ
  // 第2形態の攻撃の激しさ＝時間係数×HP係数。弾と反撃の間隔を割り、ダメージに掛ける
  // 時間係数: 試合開始で max、MATCH_TIME で min（(経過/MATCH_TIME)^curve で減る）。HP係数: HP満タンで min、0で max（(減った割合)^curve で上がる）
  BOSS_INTENSITY: { time: { max: 1.5, min: 0.8, curve: 1 }, hp: { min: 1, max: 1.6, curve: 1 } },

  MATERIAL_SPAWN_INTERVAL: 1.5, // 資材の再出現の間隔(秒)。MATERIAL_MAX に足りない分を1個ずつ
  MATERIAL_MAX: 14, // マップに落ちている資材の数の基準（×MATERIAL_MAX_MULT。試合開始時にこの数だけ置く）
  MATERIAL_MAX_MULT: 3,
  PICKUP_BOX: { w: 24, up: 36, down: 8 }, // アイテム（回復・荷物）の取得判定: 全キャラ共通の縦長長方形。足元（キャラの位置）から左右 w/2、上へ up、下へ down(px)。触れると拾う（持ち運ばない）
  MATERIAL_PICKUP_BOX: { w: 48, up: 56, down: 20 }, // 徳（資材）の取得判定: PICKUP_BOX と同じ形で広い（隣を通れば拾える）
  MATERIAL_GAP: 32, // 資材どうしを離す距離(px)
  MATERIAL_BACK: 0.7, // 資材が裏側（FRONT_ROOMS 以外の部屋・廊下）に出る比率。裏側の資材は高ポイント（TOKU.materialBack）
  FRONT_ROOMS: ['dining', 'smoking', 'hall', 'entrance'], // 表側: 食堂（11/12）と中央（25/26/27）

  // 徳（陣営ごとの共有値）。小数で管理し、TOKU_MIN〜TOKU_MAX で止める
  TOKU_MIN: 0,
  TOKU_MAX: 10,
  TOKU_INIT: 5,
  TOKU: { material: 0.2, materialBack: 0.4, materialBig: 0.4, wantedKo: 1.5, hit: -0.06, ko: -1.5, wall: -0.9, eat: -0.9, courier: -1.5 } as Record<string, number>,
  TOKU_TEXT: { hit: '攻撃した', ko: 'KOした', wantedKo: '手配犯を倒した', wall: '壁を壊した', eat: '盗み食い', courier: 'コバコを攻撃した' } as Record<string, string>,
  WANTED_MIN: 3, // 悪行ポイント（徳を下げた量 × BAD_MULT の累計）がこれ以上で一番多い人に指名手配が付く（陣営ごとに1人）
  BAD_MULT: { courier: 3, wall: 2 } as Record<string, number>, // 悪行ポイントの倍率（TOKU の key ごと。ないものは1）。徳の増減は変えない
  BAD_DECAY_SEC: 10, // 反省中の悪行ポイントの減る速さ: コバコ撃破1回分（-TOKU.courier × BAD_MULT.courier）をこの秒数で減らす

  // スロット（陣営ごと）。徳で当たる確率が決まる
  SLOT: {
    spin: 5, // 1回転の秒数
    stops: [0.5, 0.7, 1], // 各リールが止まる時刻（1回転に対する割合）。2つ目が止まった時点で2つそろっていればリーチ
    rate: [[0, 0.01], [5, 0.08], [10, 0.25]] as number[][], // [徳, 当たる確率]。間は線形補間
    rateMult: 0.7, // 当たる確率（rate）に掛ける倍率
    winToku: -2, // 当たったときの徳の増減（チャンスアップでは変わらない）
    // 以下 handoff_slot4。値は仮置き
    // リールの絵柄（自陣のプレイヤー4人＋アシスト4人＝ASSIST.units の順＋7＝陣営の大将）。プレイヤーが4人未満なら、いない人の絵柄は外す。7 は当たり（全回転）でだけ止まる
    syms: ['player:0', 'assist:0', 'player:1', 'assist:1', 'player:2', 'assist:2', 'boss', 'assist:3', 'player:3'],
    seven: [[9, 0.03], [10, 0.06]] as number[][], // 当選のうち7（全員レベルアップ・全回転専用）になる割合: [徳, 割合]。間は線形、最初の徳未満は0
    assistShare: 0.5, // 当選がアシストの絵柄になる確率（残りは今いるプレイヤーで等分）。アシストが出ているときはそのアシストの絵柄だけ
    chance: { n: 3, rate: [[0, 0.2], [5, 0.35], [10, 0.6]] as number[][] }, // チャンスアップ: 当選後に外れるまで最大 n 回の連続抽選。rate: [徳, 当たる確率]（当選時の徳。間は線形補間）。当たるたびにレベル+1（初当たりは POWER_TIERS[0]）
    assistHeal: 0.2, // 出ているアシストの絵柄で、レベルが上がらないときの回復（最大HPに対する割合）。上がったときは最大HPの増えた分だけ回復
    // 先バレ: 自分がパワーアップの対象で当たる保留だけ、本人に出す（7 は全員が対象）。miss は外れ側（ほかの保留）で1人ごとに出る固定の確率。徳5・4人のとき信頼度40%になる値
    saki: { win: 0.3, miss: (0.3 * ((0.7 * 0.08 * 0.5) / 4) * 0.6) / (0.4 * (1 - (0.7 * 0.08 * 0.5) / 4)) },
    gap: 1.5, // チャンスアップの段の間隔(秒)。この間スロットは止まる
    penHold: 1.5, // 罰の出目を見せる秒数（この間スロットは止まる）
    // 罰の出目（徳が低いほど出やすい）。当たり・罰・外れを1回のくじで決める。kinds: 罰の内容の抽選
    penalty: {
      rate: [[0, 0.2], [5, 0], [10, 0]] as number[][], // [徳, 罰が出る確率]。間は線形補間
      kinds: { dmg: 1, slow: 1, weak: 1 } as Record<string, number>,
      dmg: 0.2, // 全員にダメージ（最大HPに対する割合）
      slow: 0.7, // 全員の移動速度の倍率
      weak: 0.7, // 全員の攻撃力の倍率
      dur: 8, // 移動速度・攻撃力の低下の秒数
    },
  },
  SLOT_MODE: 'classic' as 'modern' | 'classic', // 試合のスロット: classic＝抽選・払い出しは SLOT、保留・色・先バレ・リーチ演出はモダンの見た目（handoff_tune5）、modern＝SLOT_MODERN（handoff_slot3）
  // モダン（転落スペック）のスロット。handoff_slot2。単体画面（slot.html）と試合（SLOT_MODE が modern のとき）で使う。値はすべて仮置き
  // クラシックでも保留の数・色・リーチ演出の選択率と秒数はここの値を使う（当否・先バレ・リールの絵柄は SLOT）
  // 確率は徳 5 の基準値。徳 t で 当選 × 2^((t−5)/win)、転落 × 2^((5−t)/fall)。t < lowBelow で当選 × lowWin・転落 × lowFall
  SLOT_MODERN: {
    interval: { normal: 2, ct: 1, back: 0.5 }, // 抽選間隔(秒)。通常・チャンスタイム（CT）・引き戻し
    base: { normal: 1 / 120, ct: 1 / 15, fall: 1 / 30, back: 1 / 120 }, // 当選（モードごと）・転落（CT 中だけ。当選と同じ1回の抽選で排他）
    tokuDiv: { win: 2.5, fall: 5 }, lowBelow: 1, lowWin: 0.5, lowFall: 2,
    winToku: -1, // 当選のたびの徳の増減（初当たり・CT 当選・引き戻し当選すべて）
    backSpins: 30, // 引き戻しの抽選回数（0.5秒間隔で15秒）。全部外れでペナルティ2回目 → 通常へ
    lvCap: 4, // これを超えたレベルは「Lv.4+N」と表示（頭打ちにしない）
    holds: 4, // 保留の数（常に4つ。満杯のときの抽選は捨てる）
    high: { normal: 1 / 4, ct: 1 / 2, back: 1 / 4 }, // 高確率保留の当選確率（徳によらない・転落なし）。back は仮置き（通常と同じ）
    // 演出: 保留を積む時点で当否を決め、当否ごとの選択率で選ぶ（外れ時の選択率は徳によらず固定）
    allSpin: 0.01, // 当選のうち全回転（リーチを経由しない当選確定）の割合。残りはすべてリーチ
    reachMiss: 1 / 13.4, // 外れ時のリーチ率（徳5でリーチ信頼度10%）。転落はリーチなし（仮置き）
    reach: { // リーチ演出: 当選時・外れ時の選択率（重み）と、リールが止まらない秒数（最大3秒）
      plain: { name: 'リーチのみ', win: 20, miss: 70, sec: 1.5 },
      chibi: { name: 'ちびキャラ', win: 30, miss: 20, sec: 3 },
      cutin: { name: 'カットイン', win: 30, miss: 8, sec: 3 },
      fish: { name: '魚群', win: 14, miss: 2, sec: 3 },
      fishSp: { name: '特別な魚群', win: 6, miss: 0.2, sec: 3 }, // 画面全体の視界外を使う（special）。通常の魚群より信頼度が高い
    } as Record<string, { name: string; win: number; miss: number; sec: number }>,
    allSpinSec: 3, // 全回転の秒数
    colors: ['白', '青', '緑', '赤', '虹'], // 保留の色（期待度の順）。虹は当選確定（外れ時0）
    colorWin: [40, 20, 15, 20, 5], colorMiss: [91, 6, 2, 1, 0], // 保留の色の選択率（当選時・外れ時。転落は外れと同じ）
    sakibare: { win: 0.3, miss: (0.3 * (1 / 120) * 0.6) / (0.4 * (119 / 120)) }, // 先バレの発生率（当選時・外れ時）。外れ時は徳5の通常で信頼度40%になる固定値。転落では出さない
    special: ['allSpin', 'fishSp'], // 画面全体の視界外を使える特別な演出（それ以外は視界外の隅だけ）
    // 演出を出せる範囲（論理解像度 VIEW_W×VIEW_H の座標）。視界は画面中央・半径 VISION_RADIUS×VISION_SCALE の円。キルログ域は #fx .kills（上から22%・3行）の仮の外枠
    area: { killLog: { x: 230, y: 76, w: 180, h: 56 } },
    fish: { n: 7, speed: 170, gap: 26 }, // 魚群: 匹数・速さ(px/秒)・間隔(px)
    fishSp: { n: 12, speed: 220, gap: 30, scale: 1.5, rows: [26, 300] }, // 特別な魚群: 匹数・速さ・間隔・表示倍率・横切る高さ（上下2列。論理解像度の y）
    // リールの絵柄 1〜9（添字＋1が絵柄の番号）。player:n＝陣営のプレイヤー n 番目、assist:n＝アシスト n 番目（ASSIST.units の順）、boss＝陣営の大将
    // group: 絵柄ごとのそろい目の種類。first・ct: そろい目の種類ごとの、当選時の選択率（w）と効果（add）。そろい目の絵柄は種類の中から等確率
    // 効果はパワーアップ・アシストの両方に同じ。初当たり（first）の add＝両方のレベル、CT・引き戻し（ct）の add＝両方のレベルの上げ幅（0＝変えない）
    reel: {
      syms: ['player:0', 'assist:0', 'player:1', 'assist:1', 'player:2', 'assist:2', 'boss', 'assist:3', 'player:3'],
      group: ['odd', 'even', 'odd', 'even', 'odd', 'even', 'seven', 'even', 'odd'],
      first: { even: { w: 85, add: 1 }, odd: { w: 12, add: 2 }, seven: { w: 3, add: 2 } } as Record<string, { w: number; add: number }>, // 奇数（7を含む）15%＝Lv2、偶数85%＝Lv1。7 は奇数5絵柄の1つ分（15×1/5）
      ct: { even: { w: 50, add: 0 }, odd: { w: 40, add: 1 }, seven: { w: 10, add: 2 } } as Record<string, { w: number; add: number }>,
    },
    // 試合での効果（handoff_slot3。仮置き）。ultAdd: 当たりごとのパワーアップの残り時間の延長(秒)。lvStep: Lv4+N の1段ごとの強化（攻撃・最大値を Lv4 の値から +lvStep ずつ）
    // courierToku: コバコ撃破の徳（クラシックの TOKU.courier の代わり）。penalty: 転落・引き戻し失敗（陣営全員とアシスト。撤退中は対象外。dmg＝最大HPの割合、atk・speed＝倍率、dur 秒。重ねがけは時間の延長）
    game: { ultAdd: 10, lvStep: 0.05, courierToku: -3, penalty: { dmg: 0.2, atk: 0.8, speed: 0.8, dur: 20 } },
  },
  REFLECT_TOKU: 0.05, // 反省中（KOされて復活待ち）の人数 n に対し、陣営の徳が毎秒 REFLECT_TOKU × n² 上がる
  POWER_TIERS: ['レベル1', 'レベル2', 'レベル3', 'レベル4'], // ウルト・アシストの強さ
  POWER_MULT: [0.49, 0.7, 0.98, 1.4], // 強さの倍率（見た目のレベル表現 POWERUP_AURA などは別）
  ULT_HP_MULT: [0.49, 0.49, 0.686, 0.98], // パワーアップ中の最大HP（0になると変身が解ける＝シールド）の倍率。2026-11-18 POWER_MULT から分離: Lv4=旧Lv3、Lv2・3は旧値×(旧Lv3÷旧Lv4=0.7)、Lv1据え置き
  POWER_WEIGHTS: [30, 40, 0, 0], // コバコの荷物の強さの抽選（レベル3・4はスロットの連チャン限定）
  ULT_DURATION: 20, // ウルトの効果時間(秒)
  // 変身先: hp=最大HP倍率 def=被ダメ倍率 speed=移動倍率 atk=攻撃倍率 range=射程 arc=攻撃の角度 ranged=弾を撃つ
  ULT_FORMS: {
    melee: { name: '近接', hp: 1.44, def: 0.7, speed: 1.1, atk: 1.2, range: 45, arc: Math.PI / 3 },
    ranged: { name: '遠距離', hp: 0.88, def: 1, speed: 1, atk: 1.5, range: 280, arc: Math.PI / 2, ranged: true },
    area: { name: '近接範囲', hp: 1.6, def: 0.6, speed: 0.8, atk: 1.1, range: 80, arc: Math.PI * 2 },
  } as Record<string, { name: string; hp: number; def: number; speed: number; atk: number; range: number; arc: number; ranged?: boolean }>,
  COURIER: { speed: 0.6, respawn: 5, reach: 24, box: { ult: 50, assist: 50 } as Record<string, number> }, // ブイブイ・コバコ（中立、1発でKO）: 移動（プレイヤーの基本速度に対する倍率）、KOから復活までの秒数、巡回の地点に着いたとみなす距離(px)、荷物の抽選
  // アシスト（選べないキャラの専用ユニット）。hp・speed はプレイヤーの基本値に対する倍率（units の hpMult・speedMult があれば、さらに掛ける）。強さ（POWER_MULT）はHP・攻撃・技の効果に掛ける
  ASSIST: {
    hp: 5, speed: 0.5, scale: 2, max: 1, // scale: 表示倍率（DOT_SCALE に対する倍率。大将と同じ）、max: 各陣営で同時に出せる数（超える召喚は今のアシストの強化になる）
    units: {
      kurono: { name: '玄野武宏', sense: 200, every: 6, r: 128, warn: 1, dmg: 40 }, // 周囲に敵がいるとき、自分中心の範囲攻撃（warn 秒の予告のあと）
      shirakami: { name: '白上虎太郎', sense: 200, every: 6, heal: 30, boost: 1.1, dur: 4 }, // 周囲に味方がいるとき、周囲の味方と自分を回復＋移動速度上昇
      aoyama: { name: '青山龍星', sense: 250, every: 6, r: 64, warn: 1, dmg: 50 }, // 周囲に敵がいるとき、一番近い敵の位置に範囲攻撃（予告の位置は発動時点で固定）
      ritsu: { name: '波音リツ', sense: 200, every: 6, r: 128, warn: 1, dmg: 30, push: 60, hpMult: 2, speedMult: 0.5, heavy: true }, // 周囲に敵がいるとき、自分中心の吹雪（warn 秒の予告のあと。ダメージ＋外向きに push はじく。はじく距離は強さを掛けない）。hpMult・speedMult: HP・移動速度の倍率（他のアシストに対する）。heavy: はじかれない（めたんのドリルは逆にめたんをはじく）
    } as Record<string, any>,
  },
  RECALL_HOLD: 3, // Q をこの秒数押し続けるとリコール（自陣の給湯室へワープ）。溜め中に移動・攻撃（通常攻撃・技）・被弾で中断（溜めは0に戻る）
  RECALL_HEAL: 0.5, // リコール完了時の回復量（最大HPに対する割合。最大HPで頭打ち）
  BOT_RECALL_HP: 0.3, // Bot: HP割合がこれ未満でリコール（脅威ありの間は始めず、溜め中に脅威ありになったら中断）
  BOT_RECALL_SAFE: 1.5, // Bot: 直近この秒数以内に被弾していたら脅威あり（射程外・視界外からの攻撃）
  BOT_RECALL_BREAKS: 3, BOT_RECALL_BAN: 5, // Bot: リコールの溜め中に BREAKS 回中断されたら、BAN 秒間リコールを始めない（回数はリコール成功・撤退・禁止の開始で0に戻す）。仮置き
  BOT_FLEE_RATIO: 1.0, // Bot: 低HPで脅威ありのとき、狙う敵の残りHP ≤ 自分の残りHP × これなら攻撃、それ以外は給湯室へ逃亡
  BOT_FLEE_COMMIT: 1, // Bot: 攻撃・逃亡を一度決めたらこの秒数は維持
  BOT_COURIER_RANGE: 90, // Bot: コバコがこの距離以内（落とした荷物をすぐ拾える位置）のときだけ攻撃する
  HEAL_ITEM_AMOUNT: 60, // 回復アイテムの回復量
  HEAL_RESPAWN: 20, // 回復アイテムが欠けた置き場所（HEAL_SPOTS）に再出現するまでの秒数
  DAMAGE_MULT: 1.3, // 全キャラの通常攻撃と技のダメージに掛ける倍率

  RAGE_KILL: 10,
  RAGE_ASSIST: 5,
  RAGE_BOSS_DMG_COEF: 0.1,
  ASSIST_WINDOW: 5,
  RESPAWN_BASE: 3,
  KO_FX: { shake: 1.6, boom: 0.6, amp: 4, hz: 6, pop: 0.12, popLife: 0.3 }, // 撃破の演出(秒): その場で揺れる（左右の振れ幅 amp px・hz 回/秒、pop 秒ごとに popLife 秒の小爆発）→大爆発（ここでキャラが消える。ここまで本人の視界を残す）→残り（RESPAWN_BASE − shake − boom）で倒されたキャラの視界半径を0へ縮める（陣営の共有視界。eyeRadius）
  RESPAWN_COEF: 0.1,
  RESPAWN_MAX: 15,

  BOT_AGGRO_RANGE: 250, // 自陣営の視界内かつこの距離以内の敵を攻撃
  BOT_REPATH: 0.5, // 経路の再計算間隔(秒)
  GRID_CELL: 16, // A* のマス目サイズ
  E2E_FIGHT_SECONDS: 60, // e2e: 試合1の残り時間の戦闘を打ち切る秒数（その後フックで試合終了へ）
  E2E_SPEED: 6, // e2e: 試合2（Botだけ）の早送り倍率
  E2E_BOT_SECONDS: 120, // e2e: 試合2を早送りで進める試合内の秒数（その後フックで時間切れへ）
  BOT_STUCK_TIME: 3, // Bot: この秒数のあいだ BOT_STUCK_RADIUS 以内しか動いていなければ詰まりとみなす
  BOT_STUCK_RADIUS: 32,
  BOT_PENALTY_TIME: 15, // 詰まった目的地・訪れた部屋を避ける秒数
  LOITER_RADIUS: 64, // 留まり回数の計測: この半径以内に LOITER_TIME 秒以上
  LOITER_TIME: 10,
  BOT_SKILL_SENSE: 300, // Botが技を使う判定に使う敵との距離（アップグレード・ずんだアローなど）

  // 実況（docs/commentary_spec.md）。すべて仮
  CM: {
    every: 1, // 時間で動く判定（注目度の減衰・戦闘の終了・追跡・視界・優劣の記録）の間隔(秒)
    attn: { max: 100, assistIn: 60, bossNear: 40, dodge: 40, courier: 50, box: 50, spot: 15, dmg: 10, decay: 15 }, // 注目度: 上限・各トリガーの加算・毎秒の減衰
    killR: 150, // 撃破: 倒した側・倒された側からこの半径内の対象も注目度を上限に
    focusOn: 50, focusOff: 25, focusGap: 20, // フォーカスの開始・解除の注目度、移る差
    battleR: 300, // 戦闘の半径（VISION_RADIUS）
    battleEnd: 3, // 参加者間のダメージがこの秒数途切れたら戦闘の終了
    comboWin: 5, comboRatio: 0.3, // 連携: 倒されたキャラへ直近 comboWin 秒で与えたダメージが最大HPの comboRatio 以上
    lowHp: 0.2, // 瀕死（HP割合）
    killHold: 1, // 撃破の保留(秒)。この間に同じ戦闘で次の撃破があれば連続
    chaseSec: 2, chaseGap: 150, // 追跡: 逃げる相手に chaseSec 秒以上、chaseGap px 以内でついていく
    bossNearR: 300, bossNearCd: 30, // 大将に接近: 敵大将からこの半径内で大将側の視界に入った。同じキャラは bossNearCd 秒に1回
    spotCd: 30, // 敵を視界に捉える: 同じキャラは spotCd 秒に1回
    prefixWait: 1.2, // 前置きの後に続くセリフをこの秒数まで待つ（来なければ前置きだけ。型1の文言）
    preOrder: 0.5, // フォーカス変更の場所と状況のまとめ方: 型1（状況→場所 pre_t1）になる確率。残りは型2（場所→状況 pre_t2）
    fill: { silence: 1, board: 0.5, short: 2.5 }, // つなぎ: この秒数黙ったら1つ。フォーカスなしで盤面コメントを選ぶ割合（残りは雑談）。フォーカス中は short 秒以下の盤面コメントだけ
    topicCd: 5, // 話題のクールタイム(秒): 同じ話題カテゴリ（shared/commentary.ts の topicOf）は言い始めてからこの秒数出さない（決着・試合後は対象外）。クールタイム中のセリフは捨てる
    drop: 3, // 待たされたセリフを捨てる秒数（決着・全員反省中・大将HP・撃破系・試合後は捨てない）
    lagSkip: 2, // クライアント: 再生の遅れがこの秒数を超えたら、待っているつなぎを飛ばす
    charSec: 0.13, // 音声のない部品の長さの見積もり（1文字あたり秒）
    bossHpAfter: 30, // 盤面コメント「大将の残りHP」: 試合開始からこの秒数以降
    slotDry: 60, slotHot: 60, // 盤面コメント「スロット」: 当たりなしがこの秒数以上／この秒数内に2回以上当たり（どちらもなく当たりがまだなければ「まだ静か」）
    flow: { pace: 60, even: 0.05, widen: 0.05, widenWin: 30 }, // 盤面コメント「試合の流れ」: 直近 pace 秒ずっと同じ組が上→ペース、優劣の差 even 未満→どちらに転ぶか、直近 widenWin 秒で差が widen 以上広がった→じわじわ
    timeMin: 120, // 盤面コメント「残り時間」: 残りこの秒数以上のときだけ
    rampWin: 10, // 盤面コメント「アシスト」: 直近この秒数にダメージを与えていれば「暴れています」
    wallRatio: 0.1, // 盤面コメント「壁の壊れ方」: 壊せる壁のうち壊れた割合
    lootMin: 5, // 盤面コメント「リソースの散らばり」: 未取得の徳アイテムがこの数以上ある部屋
    review: { late: 60, behind: 0.2, swaps: 3, close: 0.03, near: 0.1, oneSided: 0.5 }, // 試合後の総評: 残り late 秒以降に behind 以上負けていた→大逆転、リード入れ替わり swaps 回以上、最終の差 close／near 未満、入れ替わりなしで oneSided 以上
    boardCd: 15, reachCd: 20, rampageCd: 10, reverseCd: 20, // 盤面・リーチ（組ごと）・助っ人の活躍・優劣逆転のクールタイム(秒)
    bossHpAt: [0.75, 0.5, 0.25, 0.1], // 大将HPの割り込み
  },


  // 見た目
  VIEW_W: 640, // 論理解像度。ウィンドウには整数倍で表示
  VIEW_H: 360,
  DOT_SCALE: 1, // ドット（32x42）の表示倍率。大将はこの2倍
  BODY_UP: 42 * (0.85 - 0.5), // 体の中心は足元からこれだけ上（×DOT_SCALE×表示倍率）。ドット（高さ42）を足元基準 origin(0.5, 0.85) で描くため。自分中心の範囲判定とその輪のエフェクトの基準
  CAM_LERP: 0.08, // カメラ追従の強さ（1で即追従）
  FREE_CAM_SPEED: 400, // 撤退中に WASD で視点を動かす速さ(px/秒)
  WALK_FRAME_MS: 200, // 歩きの1コマの長さ（walk1 ⇔ walk2 の交互）
  CUTIN_MS: 1000, // KOカットインの長さ
  // 決着演出（サーバーの段。秒は実時間）。大将撃破: slow（ゲームを slowRate 倍でスロー、入力なし）→ boss（カメラを倒された大将へ cam 秒で移し、boom 秒で爆発）→ killer（カメラを止めのキャラへ cam 秒で移し、立ち絵と名前を killer 秒）→ win（WIN 表示 win 秒）→ 現行の決着後（ended）
  // 時間切れ: timeup（ゲームを止めて「時間切れ」を timeup 秒）→ win → ended。bossScale: 大将の爆発の大きさ（撃破の演出 KO_FX に対する倍率）
  FINALE: { slowRate: 0.25, slow: 2, cam: 0.8, boom: 2.2, killer: 2.6, win: 2.6, timeup: 2, bossScale: 2.5 },
  KO_CUTIN_GAP: 25, // 撃破した側のカットイン: 2人の立ち絵の中心どうしの間隔（画面幅の%）。画面中央を挟んで並べる
  RANGE_ALPHA: 0.25, // 自キャラの射程円の不透明度
  SLASH_MS: 200, // 斬撃エフェクトの長さ
  SWEAT_MS: 500, // 通常攻撃が当たった側の汗のエフェクトの長さ
  HIT_FLASH_MS: 300, // 被弾時の白点滅の長さ（全段階共通）
  HIT_BLINK_MS: 60, // 被弾時の点滅の間隔（白とふつうを交互）
  // 被ダメージの表示の段階（被弾側の最大HP比）: mid 未満=点滅だけ、mid 以上=ダメージ量に比例した着弾エフェクト、big 以上=派手な着弾エフェクト＋揺れ
  // 見た目: ms/bigMs=長さ、r0+r×比=半径(px)、bigScale=大の半径の倍率、火花の数 sparks+sparksPer×比（大は bigSparks）、揺れ shakeMs・キャラの振れ幅 amp(px)・自キャラ被弾時の画面の揺れ cam（Phaser の強さ）
  HIT_FX: { mid: 0.1, big: 0.3, ms: 320, bigMs: 560, r0: 4, r: 30, bigScale: 1.5, sparks: 3, sparksPer: 20, bigSparks: 16, shakeMs: 260, amp: 3, cam: 0.006 },
  POPUP_MS: 900, // ダメージ数値・+1・注意表示の長さ
  NOTIFY_MS: 3000, // 画面中央の通知の長さ
  SKILL_FX_MS: 450, // 技の範囲エフェクトの長さ
  RECALL_FX_MS: 600, // リコールで元いた場所に残るエフェクトの長さ
  POWERUP_AURA: { scale: [1.2, 1.2 + 0.8 / 3, 1.2 + 1.6 / 3, 2], alpha: 0.4 }, // パワーアップ中の背後のドット: レベルごとの拡大率（DOT_SCALE に掛ける。レベル4は大将と同じ）と不透明度
  TARGET_RING_ALPHA: 0.9, // 狙っている対象の足元の輪
};


// その試合の大将の部屋（名前の一覧）→ 陣営ごとの大将の拠点（部屋の中心）と部屋の内側
export const roomLayout = (names: string[]) => ({
  bases: TEAM_KEYS.map((t) => names.map((id) => center(room(t, id)))),
  homes: TEAM_KEYS.map((t) => names.map((id) => inner(room(t, id)))),
});

// 部屋の種類（資材のフレーバー用）。tx,ty はタイル座標。部屋の id から陣営の接尾辞を除いた名前、廊下は 'path'、どこにも入らなければ null
export const roomKindAt = (tx: number, ty: number) => {
  const r = ROOMS.find((q) => tx > q.rect[0] && tx < q.rect[2] && ty > q.rect[1] && ty < q.rect[3]);
  return r ? (r.type === 'path' ? 'path' : r.id.replace(/_[LR]$/, '')) : null;
};
// 裏側（表側＝食堂・中央 以外の部屋・廊下）のタイルか
export const isBackAt = (tx: number, ty: number) => { const k = roomKindAt(tx, ty); return k !== null && !CONFIG.FRONT_ROOMS.includes(k); };
// 徳 → スロットの当たる確率（SLOT.rate の線形補間）
export const slotRate = (toku: number) => {
  const r = CONFIG.SLOT.rate, m = CONFIG.SLOT.rateMult;
  for (let i = 1; i < r.length; i++) if (toku <= r[i][0]) return m * (r[i - 1][1] + ((r[i][1] - r[i - 1][1]) * (toku - r[i - 1][0])) / (r[i][0] - r[i - 1][0]));
  return m * r[r.length - 1][1];
};
// 体の中心の足元からの高さ（px）。scale: 表示倍率（プレイヤー1、アシスト・大将2）
export const bodyUp = (scale = 1) => CONFIG.BODY_UP * CONFIG.DOT_SCALE * scale;
// 大将の攻撃の激しさ（第2形態）: 時間係数×HP係数。t=試合の経過秒、hpRatio=HP/最大HP
export const bossIntensity = (t: number, hpRatio: number) => {
  const { time: T, hp: H } = CONFIG.BOSS_INTENSITY;
  const kt = T.max - (T.max - T.min) * Math.min(1, t / CONFIG.MATCH_TIME) ** T.curve;
  const kh = H.min + (H.max - H.min) * Math.max(0, 1 - hpRatio) ** H.curve;
  return kt * kh;
};
// 徳 → スロットのチャンスアップの当たる確率（SLOT.chance.rate の線形補間）
export const chanceRate = (toku: number) => {
  const r = CONFIG.SLOT.chance.rate;
  for (let i = 1; i < r.length; i++) if (toku <= r[i][0]) return r[i - 1][1] + ((r[i][1] - r[i - 1][1]) * (toku - r[i - 1][0])) / (r[i][0] - r[i - 1][0]);
  return r[r.length - 1][1];
};
// 徳 → 当選のうち7になる割合（SLOT.seven の線形補間。最初の徳未満は0）
export const sevenRate = (toku: number) => {
  const r = CONFIG.SLOT.seven;
  if (toku < r[0][0]) return 0;
  for (let i = 1; i < r.length; i++) if (toku <= r[i][0]) return r[i - 1][1] + ((r[i][1] - r[i - 1][1]) * (toku - r[i - 1][0])) / (r[i][0] - r[i - 1][0]);
  return r[r.length - 1][1];
};
// 徳 → スロットの罰の出る確率（SLOT.penalty.rate の線形補間）
export const penaltyRate = (toku: number) => {
  const r = CONFIG.SLOT.penalty.rate;
  for (let i = 1; i < r.length; i++) if (toku <= r[i][0]) return r[i - 1][1] + ((r[i][1] - r[i - 1][1]) * (toku - r[i - 1][0])) / (r[i][0] - r[i - 1][0]);
  return r[r.length - 1][1];
};
