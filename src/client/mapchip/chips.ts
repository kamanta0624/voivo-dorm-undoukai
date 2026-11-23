// マップチップの対応表（本体の描画 mapchip/paint.ts と試験ページ /maptest が読む）。素材は public/assets/mapchip/（管理外）
// チップの位置: BaseChip_nimono.png の [列, 行]（16px 単位、左上が [0, 0]）
// 壁の正面: BaseChip の 52〜77行・78〜81行にある 2マス高の組の左上 [列, 行]（左端・中・右端・1マスだけ、の順に4列並ぶ）
type Chip = [number, number];

// 床の系統（handoff_maptile3 の2章）。同じ系統の部屋は同じ床（硬い床とパーティールームだけ部屋ごとに色を変えてよい）
export const KIND: Record<string, { floor: Chip; face: Chip }> = {
  washitsu: { floor: [6, 43], face: [0, 52] }, // 和室: 畳／白い壁
  anteroom: { floor: [7, 42], face: [0, 52] }, // 前室: 灰色の石／白い壁
  western: { floor: [0, 38], face: [0, 52] }, // 洋室: 明るい板張り（参考画像B）／白い壁
  hard: { floor: [4, 38], face: [0, 52] }, // 硬い床: 無地（コンクリート・リノリウム風）。色は部屋ごとに floor で上書き
  open: { floor: [2, 41], face: [0, 52] }, // オープンスペース: 灰色の石タイル（参考画像A）／白い壁
  outdoor: { floor: [3, 0], face: [0, 52] }, // 屋外: 土
  deck: { floor: [1, 39], face: [0, 52] }, // ウッドデッキ（maptile2 のまま）
  dogrun: { floor: [6, 39], face: [0, 52] }, // 犬走り（maptile2 のまま）
};

// 部屋（map.json の rooms の id）→ 名前・系統。floor・face があれば系統より優先。name は map.json の name（tools/gen_map.py）と同じにする。廊下は未定
export const ROOMS: Record<string, { name: string; kind: string; floor?: Chip; face?: Chip }> = {
  study_L: { name: '道場', kind: 'washitsu' },
  study_R: { name: '茶室', kind: 'washitsu' },
  bath_L: { name: '道場', kind: 'western' }, // 板張り（study と1つの空間。畳と木が混ざる）
  bath_R: { name: '茶室', kind: 'western' },
  library_L: { name: '弓道場', kind: 'outdoor' },
  library_R: { name: '窯小屋の近く', kind: 'outdoor' },
  kitchen_L: { name: 'ジム', kind: 'hard', floor: [6, 38] }, // 濃い灰色
  kitchen_R: { name: '音楽室', kind: 'western' },
  svcA_L: { name: '会議室', kind: 'western' },
  svcA_R: { name: '工作室', kind: 'hard', floor: [5, 38] }, // ベージュ
  svcB_L: { name: 'PCルーム', kind: 'western' },
  svcB_R: { name: 'アトリエ', kind: 'hard', floor: [4, 38] }, // 明るい灰色
  svcC_L: { name: '階段ホール', kind: 'open' },
  svcC_R: { name: '階段ホール', kind: 'open' },
  dining_L: { name: 'パーティールーム', kind: 'western', floor: [3, 43] }, // 本人指定の例外: ローズ色の絨毯（参考画像C）
  dining_R: { name: 'リビングダイニングキッチン', kind: 'western' },
  smoking: { name: 'ウッドデッキ', kind: 'deck' },
  corrTop: { name: '犬走り', kind: 'dogrun' },
  hall: { name: 'ホール', kind: 'western' }, // 絨毯は RUGS
  entrance: { name: 'アトリウム', kind: 'open', face: [4, 68] }, // 壁は木（下半分が木の縦張り・上が白）
  corrN_L: { name: '廊下', kind: 'open' },
  corrN_R: { name: '廊下', kind: 'open' },
  corrV_L: { name: '廊下', kind: 'open' },
  corrV_R: { name: '廊下', kind: 'open' },
  corrS_L: { name: '廊下', kind: 'open' },
  corrS_R: { name: '廊下', kind: 'open' },
};
// どの部屋の内側にも入らない床（部屋の境目の扉の穴）
export const FLOOR_DEFAULT: Chip = KIND.open.floor;
// 建物の外（map.json の ' '）: 屋外と同じ土
export const OUTSIDE: Chip = KIND.outdoor.floor;

// 絨毯: 部屋の内側に重ねる（壁際は床が見える）。9分割の左上 [列, 行]（3×3 の角・辺・中）。inset: 壁からの空き（マス）
export const RUGS: Record<string, { chip: Chip; inset: number }> = {
  hall: { chip: [0, 44], inset: 2 }, // 赤い絨毯
};

// 壁（天井オートタイル: WOLF 形式、16×80 の5パーツ）と正面
export const WALL = {
  ceiling: 'Auto_B04.png', // 白っぽい壁
  atrium: 'Auto_B03.png', // 本人指定: 木目の代わりに薄茶色の天井
  dark: 'Auto_A02.png', // 壊れない壁（外周。ゲームの PERIMETER と同じ判定）
  darkFace: [4, 54] as Chip, // 壊れない壁の正面（濃い灰色）
  glass: 'Auto_C08.png', // 透過壁（map.json の clear.glass）: ガラス
  fenceFace: [0, 80] as Chip, // 透過壁（clear.fence）の北側: 鉄柵（2マス高、左端・中・右端。1マスだけは中）
  fencePost: [1, 167] as Chip, // 透過壁（clear.fence）の北側以外: 細い手すり（縦）
  fenceRail: [2, 167] as Chip, // 同（横）
};
