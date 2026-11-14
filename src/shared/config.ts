// 調整用の数値はすべてここ（すべて仮置き）
export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

import MAP from './map.json';
import CHARS from './chars.json';

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

// '#' タイルを貪欲に矩形へまとめる（tiles は壁破壊で変わる試合中のタイル）
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
  return out;
}

export const CONFIG = {
  PORT: 2567,
  TICK_HZ: 20, // サーバー判定・同期レート
  // 通信（自キャラの予測と他キャラの補間）
  NET_STEP: 0.05, // 入力1つぶんの時間(秒)。クライアントはこの間隔で入力を送り、サーバーは1tickに1つ処理する
  NET_EPS: 0.5, // 予測とサーバーの位置の差がこれ未満なら一致とみなす(px)
  NET_SNAP: 80, // これ以上のずれ（はじき・突撃・復活など）は補間せずそのまま反映(px)
  NET_SMOOTH_MS: 120, // 予測の補正を見た目上戻す時間
  RECONNECT_SEC: 30, // 通信が切れた人（スマホのバックグラウンド等）の再接続を待つ秒数。待つ間は Bot が代わりに動かす
  RESUME_RECONNECT_SEC: 5, // この秒数以上バックグラウンドにいたら、戻ったときに接続を張り直す
  // スマホのタッチ操作: dead=スティックの遊び(px)、r=スティックの台座の半径(px、論理解像度)
  TOUCH: { dead: 6, r: 32 },
  NET_CORR_SPEED: 300, // 補正で見た目が動く速さの上限(px/秒)。大きなずれは時間をかけて戻す
  NET_INTERP_DELAY: 0.25, // 他キャラはこの秒数だけ過去の位置を補間して描く（通信の揺らぎを吸収）
  NET_OFFSET_DRIFT: 0.0005, // 時計合わせの追従量（受信ごと、秒）
  NET_EXTRAPOLATE: 0.1, // 補間の材料が届いていないとき、直前の速度で先を推測する上限(秒)
  NET_HIST_MAX: 100, // 予測の入力履歴の上限
  NET_CATCHUP: 3, // サーバー側の入力待ちがこれを超えたら1tickに2つ処理して追いつく
  NET_QUEUE_MAX: 20, // サーバー側の入力待ちの上限
  TEAM_SIZE: 4, // 開始時に足りない枠はBotで埋める
  MAX_CLIENTS: 16, // 超過分は観戦
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
  KILL_LOG_MAX: 4, // キルログの件数。超えたら古い順に消える
  INTRO_GAP: 40, // 開始演出で study に横並びにする間隔(px)
  INTRO_ZOOM: 2.5, // 開始演出のカメラの拡大率
  INTRO_CAM_MS: 600 / INTRO_SPEED, // 開始演出のカメラの寄り・戻りの時間
  SLOT_CUTIN_MS: 2000, // スロットの当たり・連チャンのカットインの長さ
  SLOT_REEL_MS: 70, // 回転中のリールの絵柄が切り替わる間隔

  MAP_W: W,
  MAP_H: H,
  TILE: T,
  WALLS: wallRects(),
  BOSS_ROOM_CANDIDATES,
  BOSS_ROOM_DIST_SUM_MAX: 3774, // 3部屋の、中央（hall の中心）からの経路距離の合計の上限(px)
  HEAL_SPOTS: TEAM_KEYS.flatMap((t) => { const i = inner(room(t, 'kitchen')); return [0.2, 0.35, 0.65, 0.8].flatMap((fx) => [0.3, 0.7].map((fy) => [i.x + i.w * fx, i.y + i.h * fy])); }), // 回復アイテム（ご飯）の場所: 給湯室（kitchen）だけに各8個。大将の拠点＝部屋の中心と重ならない位置
  BOSS_ROOM_COUNT: 3, // 試合開始時に候補からランダムに選ぶ数（左右で同じ部屋）。大将の出現・逃亡先になる
  SPAWNS: TEAM_KEYS.map((t) => { const i = inner(room(t, 'study')); return { x: i.x + i.w / 2, y: i.y + i.h * 0.75 }; }), // 大将の拠点（study中心）と重ならない位置
  START_ROOMS: TEAM_KEYS.map((t) => inner(room(t, 'dining'))), // 開始した部屋（食堂。カウント中はここから出られない）
  RECALL_ROOMS: TEAM_KEYS.map((t) => inner(room(t, 'kitchen'))), // リコールの行き先（給湯室）
  COURIER_START: center(ROOMS.find((r) => r.id === 'entrance')!), // ブイブイ・コバコの出現・復活場所（マップ中央下部）
  COURIER_ROUTE: [...ROOMS].map(center).sort((a, b) => Math.atan2(a.y - H / 2, a.x - W / 2) - Math.atan2(b.y - H / 2, b.x - W / 2)), // コバコの巡回経路: 全部屋・廊下の中心を、マップ中心から見た角度の順に回る

  PLAYER_HP: 100,
  PLAYER_RADIUS: 10,
  PLAYER_SPEED: 170, // px/秒
  ATTACK_DAMAGE: 20,
  ATTACK_RANGE: 50,
  ATTACK_ARC: Math.PI / 2, // 前方扇形の角度
  ATTACK_COOLDOWN_MELEE: 1, // 通常攻撃（オート・手動とも）の間隔: 近接
  ATTACK_COOLDOWN_RANGED: 1.5, // 遠距離（zunko、kiritan のきりたん砲）
  VISION_RADIUS: 300,
  // ロールごとの倍率（キャラの role は chars.json）
  ROLES: {
    balance: { hp: 1, speed: 1, atk: 1, vision: 1 },
    attacker: { hp: 0.7, speed: 1, atk: 1.4, vision: 1 },
    speed: { hp: 0.8, speed: 1.3, atk: 0.8, vision: 1.3 },
    defense: { hp: 1.4, speed: 0.85, atk: 0.9, vision: 1 },
    support: { hp: 0.7, speed: 1, atk: 0.6, vision: 1 },
  } as Record<string, { hp: number; speed: number; atk: number; vision: number }>,
  BALANCE_ALONE_RADIUS: 200, // balance: この半径に味方がいないとき被ダメ軽減
  BALANCE_ALONE_CUT: 0.2,
  DEFENSE_CUT: 0.2, // defense: 被ダメ軽減
  ATTACKER_BOSS_MULT: 2, // attacker: 大将へのダメージ倍率（技にも掛かる）
  BREAKERS: ['hanamaru', 'sayo', 'aru'], // バリケード・罠へのダメージ倍率が掛かるキャラ（技にも掛かる）
  BREAKER_MULT: 3,
  MELEE_BONUS: { hp: 1.2, speed: 1.1, atk: 1.2 }, // 近接補正: MELEE_EXCLUDE 以外のキャラの最大HP・移動・通常攻撃に掛ける（引き撃ち対策）
  MELEE_EXCLUDE: ['zunko', 'kiritan'],
  RANGED: { zunko: 200 } as Record<string, number>, // 通常攻撃が弾になるキャラと射程
  KIRITAN: { speed: 0.8, knifeRange: 60, cannonRange: 260, cannonSpeed: 300, cannonDmg: 0.7, knifeDmg: 1.2 }, // きりたん: 足が遅い。対象が knifeRange より遠ければきりたん砲（弾速遅め・ダメージ控えめ）、近ければ包丁
  BULLET_SPEED: 600, // 弾・矢の速さ(px/秒)
  BULLET_RADIUS: 4,
  AIM_MODES: ['nearest', 'lowhp', 'boss', 'manual'], // 照準モード（Tabで順に切り替え）
  AIM_LABEL: { nearest: '一番近い敵', lowhp: '一番HPが低い敵', boss: '大将優先', manual: '手動' } as Record<string, string>,
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

  MATERIAL_SPAWN_INTERVAL: 3, // 資材の再出現の間隔(秒)。MATERIAL_MAX に足りない分を1個ずつ
  MATERIAL_MAX: 14, // マップに落ちている資材の数（試合開始時にこの数だけ置く）
  MATERIAL_TOUCH: 16, // 資材に触れたとみなす距離（キャラ中心から）。触れると拾う（持ち運ばない）
  MATERIAL_GAP: 32, // 資材どうしを離す距離(px)
  MATERIAL_BACK: 0.7, // 資材が裏側（FRONT_ROOMS 以外の部屋・廊下）に出る比率。裏側の資材は高ポイント（TOKU.materialBack）
  FRONT_ROOMS: ['dining', 'smoking', 'hall', 'entrance'], // 表側: 食堂（11/12）と中央（25/26/27）
  // 資材を拾ったときのフレーバー（部屋の種類 → 文言）。path=廊下、wall=壁に隣接したマス、other=それ以外
  MATERIAL_FLAVOR: { study: '脆弱性に対応した', kitchen: '掃除した', path: 'ゴミを捨てた', wall: '壁を補修した', other: '掃除した' } as Record<string, string>,

  // 徳（陣営ごとの共有値）。小数で管理し、TOKU_MIN〜TOKU_MAX で止める
  TOKU_MIN: 0,
  TOKU_MAX: 10,
  TOKU_INIT: 5,
  TOKU_CHAR: {} as Record<string, number>, // キャラごとの初期値の補正（陣営の全員分を足す）。今は全キャラ0
  TOKU: { material: 0.6, materialBack: 1.2, wantedKo: 1.5, hit: -0.06, ko: -1.5, wall: -0.9, eat: -0.9, courier: -1.5 } as Record<string, number>,
  TOKU_TEXT: { hit: '攻撃した', ko: 'KOした', wantedKo: '手配犯を倒した', wall: '壁を壊した', eat: '盗み食い', courier: 'コバコを攻撃した' } as Record<string, string>,
  WANTED_MIN: 3, // 悪行ポイント（徳を下げた量の累計）がこれ以上で一番多い人に指名手配が付く（陣営ごとに1人）

  // スロット（陣営ごと）。徳で当たる確率が決まる
  SLOT: {
    spin: 5, // 1回転の秒数
    stops: [0.5, 0.7, 1], // 各リールが止まる時刻（1回転に対する割合）。2つ目が止まった時点で2つそろっていればリーチ
    rate: [[0, 0.01], [5, 0.08], [10, 0.25]] as number[][], // [徳, 当たる確率]。間は線形補間
    rateMult: 0.7, // 当たる確率（rate）に掛ける倍率
    winToku: -2, // 当たったときの徳の増減（最初の当選時だけ）
    payout: { ult: 50, assist: 50 } as Record<string, number>, // 払い出しの抽選（ult=自陣の生存者全員が変身、assist=アシスト1体）
    chain: 0.5, // 払い出しのあと連チャンする確率
    chainBreak: 0.25, // 連チャンの先がバランスブレーカー（POWER_TIERS の最後）のときの確率
    firstTier: 1, // 最初の払い出しの強さ（POWER_TIERS の添字。連チャンのたびに1段階上がる）
    gap: 1.5, // 連チャンの払い出しの間隔(秒)。この間スロットは止まる
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
  REFLECT_TOKU: 0.05, // 反省中（KOされて復活待ち）の人数 n に対し、陣営の徳が毎秒 REFLECT_TOKU × n² 上がる
  POWER_TIERS: ['ハズレ', '普通', '強い', 'バランスブレーカー'], // ウルト・アシストの強さ
  POWER_MULT: [0.7, 1, 1.4, 2],
  POWER_WEIGHTS: [30, 40, 22, 0], // コバコの荷物の強さの抽選（バランスブレーカーはスロットの連チャン限定）
  ULT_DURATION: 20, // ウルトの効果時間(秒)
  // 変身先: hp=最大HP倍率 def=被ダメ倍率 speed=移動倍率 atk=攻撃倍率 range=射程 arc=攻撃の角度 ranged=弾を撃つ
  ULT_FORMS: {
    melee: { name: '近接', hp: 1.44, def: 0.7, speed: 1.3, atk: 1.2, range: 45, arc: Math.PI / 3 },
    ranged: { name: '遠距離', hp: 0.88, def: 1, speed: 1, atk: 1.5, range: 280, arc: Math.PI / 2, ranged: true },
    area: { name: '近接範囲', hp: 1.6, def: 0.6, speed: 0.8, atk: 1.1, range: 80, arc: Math.PI * 2 },
  } as Record<string, { name: string; hp: number; def: number; speed: number; atk: number; range: number; arc: number; ranged?: boolean }>,
  COURIER: { speed: 0.6, respawn: 5, reach: 24, box: { ult: 50, assist: 50 } as Record<string, number> }, // ブイブイ・コバコ（中立、1発でKO）: 移動（プレイヤーの基本速度に対する倍率）、KOから復活までの秒数、巡回の地点に着いたとみなす距離(px)、荷物の抽選
  // アシスト（男性キャラ3人の専用ユニット）。hp・speed はプレイヤーの基本値に対する倍率。強さ（POWER_MULT）はHP・攻撃・技の効果に掛ける
  ASSIST: {
    hp: 5, speed: 0.5, scale: 2, max: 1, // scale: 表示倍率（DOT_SCALE に対する倍率。大将と同じ）、max: 各陣営で同時に出せる数（超える召喚は今のアシストの強化になる）
    units: {
      kurono: { name: '玄野武宏', sense: 200, every: 6, r: 128, warn: 1, dmg: 40 }, // 周囲に敵がいるとき、自分中心の範囲攻撃（warn 秒の予告のあと）
      shirakami: { name: '白上虎太郎', sense: 200, every: 6, heal: 30, boost: 1.3, dur: 4 }, // 周囲に味方がいるとき、周囲の味方と自分を回復＋移動速度上昇
      aoyama: { name: '青山龍星', sense: 250, every: 6, r: 64, warn: 1, dmg: 50 }, // 周囲に敵がいるとき、一番近い敵の位置に範囲攻撃（予告の位置は発動時点で固定）
    } as Record<string, any>,
  },
  RECALL_HOLD: 3, // Q をこの秒数押し続けるとリコール（自陣の給湯室へワープ）
  RECALL_TAP: 0.3, // これ未満の短押しはバリケード設置
  BOT_RECALL_HP: 0.3, // Bot: HP割合がこれ未満でリコール
  BOT_COURIER_RANGE: 90, // Bot: コバコがこの距離以内（落とした荷物をすぐ拾える位置）のときだけ攻撃する
  HEAL_ITEM_AMOUNT: 30, // 回復アイテムの回復量
  HEAL_RESPAWN: 3, // 回復アイテム（ご飯）が取られてから同じ場所に再出現するまでの秒数
  DAMAGE_MULT: 1.3, // 全キャラの通常攻撃と技のダメージに掛ける倍率
  TRAP_RADIUS: 20, // bii の罠の大きさ
  BARRICADE_SIZE: 40,
  BARRICADE_HP: 80,
  BARRICADE_MAX: 3, // 各陣営の同時設置数。超えたら一番古いものが消える
  PLACE_DIST: 32, // Qの設置位置: キャラ中心から向いている方向への距離

  RAGE_KILL: 10,
  RAGE_ASSIST: 5,
  RAGE_BOSS_DMG_COEF: 0.1,
  ASSIST_WINDOW: 5,
  RESPAWN_BASE: 3,
  RESPAWN_COEF: 0.1,
  RESPAWN_MAX: 15,

  BOT_AGGRO_RANGE: 250, // 自陣営の視界内かつこの距離以内の敵を攻撃
  BOT_REPATH: 0.5, // 経路の再計算間隔(秒)
  GRID_CELL: 16, // A* のマス目サイズ
  BOT_WALLBREAK_SAVE: 320, // hanamaru のBot: 壁破壊で経路がこれ(px)以上短くなるなら使う
  BOT_WALLBREAK_CHECK: 0.25, // 上の判定の間隔(秒)
  E2E_FIGHT_SECONDS: 60, // e2e: 試合1の残り時間の戦闘を打ち切る秒数（その後フックで試合終了へ）
  E2E_SPEED: 6, // e2e: 試合2（Botだけ）の早送り倍率
  E2E_BOT_SECONDS: 120, // e2e: 試合2を早送りで進める試合内の秒数（その後フックで時間切れへ）
  BOT_STUCK_TIME: 3, // Bot: この秒数のあいだ BOT_STUCK_RADIUS 以内しか動いていなければ詰まりとみなす
  BOT_STUCK_RADIUS: 32,
  BOT_PENALTY_TIME: 15, // 詰まった目的地・訪れた部屋を避ける秒数
  LOITER_RADIUS: 64, // 留まり回数の計測: この半径以内に LOITER_TIME 秒以上
  LOITER_TIME: 10,
  BOT_SKILL_SENSE: 300, // Botが技を使う判定に使う敵との距離（加速・ずんだアローなど）

  // キャラ技（Rで発動）。ct=クールタイム(秒)
  SKILLS: {
    hanamaru: { name: '巨大拳飛ばし', ct: 10, speed: 360, range: 520, r: 30, dmg: 40, reach: 3, w: 3, d: 2, push: 0.05 }, // 巨大拳: 前方へ直進（speed px/秒、range px で消える）、半径 r の拳がキャラ（1体1回）にダメージ・壁を破壊して貫通。パッシブ: 壁へ push 秒押し込み続けるとその壁を壊す（reach: 前方の壁を探すタイル数、w×d: 壊す範囲(タイル)）
    sayo: { name: '疾風乱舞', ct: 8, dur: 3, speed: 1.6, every: 0.3, r: 60, dmg: 12 },
    zunko: { name: 'ずんだアロー', ct: 18, range: 300, dur: 4, speed: 0.5 }, // 当たった敵はずんだ餅（移動×speed、技不可）
    whitecul: { name: '吹雪', ct: 7.2, len: 200, w: 80, dmg: 20, push: 80 },
    aru: { name: '突撃', ct: 6, windup: 0.8, speed: 1, side: 0.4, dur: 2, len: 160, w: 126, head: 40, dmg: 60, smoke: 0.6, spin: 9 }, // windup: タメの秒数、speed/side: 進む速さ・進行方向に垂直な移動の速さ（移動速度に対する倍率）、dur: 最大秒数、len×w: エフェクト（＝攻撃判定）の大きさ、head: 頭の中心の自キャラからの距離、smoke: 煙が消えるまでの秒数、spin: 渦の回転(ラジアン/秒)
    bii: { name: '罠設置', ct: 10, range: 140, arc: (100 * Math.PI) / 180, every: 1, dmg: 10, hp: 60, decay: 3, max: 2 }, // 向いた方向の扇形の敵を攻撃し続ける罠
    mochiko: { name: 'ファンネル', ct: 30, n: 6, hp: 20, life: 15, sense: 250, dmg: 6, every: 1, range: 60, speed: 220, radius: 6, pathMax: 400, ring: 44, slotStep: Math.PI / 3, retarget: 0.5 }, // pathMax: 向かう敵までの経路長の上限、ring: 敵を囲む半径、slotStep: 射撃ごとに回り込む角度、retarget: 対象と経路の見直し間隔
    kiritan: { name: 'きりたん砲飛行', ct: 7.2, dur: 5, speed: 1.8 }, // 飛行中は移動が速いが包丁（近距離）しか使えない
    metan: { name: 'ドリル', ct: 4.8, range: 70, arc: Math.PI / 2, dmg: 30, push: 120 },
    ierutan: { name: '加速', ct: 8, r: 150, speed: 1.5, dur: 5, regen: 3 }, // regen: 効果中の毎秒の回復量
  } as Record<string, any>,

  // 見た目
  VIEW_W: 640, // 論理解像度。ウィンドウには整数倍で表示
  VIEW_H: 360,
  DOT_SCALE: 1, // ドット（32x42）の表示倍率。大将はこの2倍
  CAM_LERP: 0.08, // カメラ追従の強さ（1で即追従）
  FREE_CAM_SPEED: 400, // 撤退中に WASD で視点を動かす速さ(px/秒)
  WALK_FRAME_MS: 200, // 歩きの1コマの長さ（walk1 ⇔ walk2 の交互）
  CUTIN_MS: 1000, // KOカットインの長さ
  RANGE_ALPHA: 0.25, // 自キャラの射程円の不透明度
  SLASH_MS: 200, // 斬撃エフェクトの長さ
  HIT_FLASH_MS: 120, // 被弾時の白点滅の長さ
  POPUP_MS: 900, // ダメージ数値・+1・注意表示の長さ
  NOTIFY_MS: 3000, // 画面中央の通知の長さ
  SKILL_FX_MS: 450, // 技の範囲エフェクトの長さ
  TARGET_RING_ALPHA: 0.9, // 狙っている対象の足元の輪
  // アルの突撃の見た目。渦: 筋の本数・[色, 太さ, 不透明度]（交互）・回り込む量(ラジアン)・半径（始め〜終わり）・尾へずれる量(px)。警告: 点滅の間隔・矢印の数。タメ中の白い点滅の間隔
  ARU_FX: { strands: 7, lines: [[0xff8a00, 6, 0.85], [0xffe14a, 4, 0.9]], turn: Math.PI * 2.6, r0: 4, r1: 70, back: 80, warnBlinkMs: 120, arrows: 5, blinkMs: 90 },
};

// キャラのロール倍率。char なし（大将）や role なしは null
export const roleOf = (char?: string) => { const r = (CHARS as Record<string, any>)[char ?? '']?.role; return r ? { name: r as string, ...CONFIG.ROLES[r] } : null; };
// キャラの視界半径（ロール係数込み）。char なし（大将）は基本値
export const visionRadius = (char?: string) => CONFIG.VISION_RADIUS * (roleOf(char)?.vision ?? 1);

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
// 大将の攻撃の激しさ（第2形態）: 時間係数×HP係数。t=試合の経過秒、hpRatio=HP/最大HP
export const bossIntensity = (t: number, hpRatio: number) => {
  const { time: T, hp: H } = CONFIG.BOSS_INTENSITY;
  const kt = T.max - (T.max - T.min) * Math.min(1, t / CONFIG.MATCH_TIME) ** T.curve;
  const kh = H.min + (H.max - H.min) * Math.max(0, 1 - hpRatio) ** H.curve;
  return kt * kh;
};
// 徳 → スロットの罰の出る確率（SLOT.penalty.rate の線形補間）
export const penaltyRate = (toku: number) => {
  const r = CONFIG.SLOT.penalty.rate;
  for (let i = 1; i < r.length; i++) if (toku <= r[i][0]) return r[i - 1][1] + ((r[i][1] - r[i - 1][1]) * (toku - r[i - 1][0])) / (r[i][0] - r[i - 1][0]);
  return r[r.length - 1][1];
};
