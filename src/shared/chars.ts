// キャラの性能定義（キャラ key → 定義）。素材・表示の対応表は chars.json（Python の素材生成も読む）
// HP・移動・攻撃の実数値は書かない。共通の基本値（config.ts）× ROLES × MELEE_BONUS × mult をここの関数で算出する
import { CONFIG as C, wallRects, Rect } from './config';
import CHARS_JSON from './chars.json';
import MAP from './map.json';

// 通常攻撃のモード。kind: melee=前方の扇形（ATTACK_ARC）、shot=弾。dmg: ダメージ倍率。far: 対象がこれより遠い（対象なしを含む）ときだけ使う。fx: 近接の斬撃のエフェクトを技ごとの描画（client/skills の fx）に差し替える color
export type AaMode = { name: string; kind: 'melee' | 'shot'; range: number; cd: number; dmg: number; shot?: 'bullet' | 'cannon'; speed?: number; far?: number; fx?: string };
export type CharDef = {
  role?: string; // ROLES の key（なし可）
  walk: 'normal' | 'hover'; // 歩行タイプ。normal=歩きの2コマを交互、hover=移動中は歩きの1コマ目で固定
  aa: AaMode[]; // 通常攻撃のモード（使えるもののうち最後のものを使う）
  mult: { speed?: number }; // キャラ固有の倍率
  melee: boolean; // 近接補正（MELEE_BONUS）の対象
  ghost?: boolean; // 壊せる壁をすり抜けて移動する（外周の壁だけ当たる。弾・視界・他キャラは変わらない）
  toku: number; // 徳の初期値の補正（陣営の全員分を足す）
  skill: { name: string; ct: number; [k: string]: any }; // 技（R）。ct=クールタイム(秒)、ほかは技処理（server/skills・client/skills）が使う値
  desc: string; // キャラ選択のステータス窓に出す技の説明文（技名は skill.name）
  passive?: string; // 同じくパッシブの説明文（あるキャラだけ）
};

const MELEE: AaMode = { name: '近接', kind: 'melee', range: C.ATTACK_RANGE, cd: C.ATTACK_COOLDOWN_MELEE, dmg: 1 };
const def = (d: Partial<CharDef> & Pick<CharDef, 'skill' | 'desc'>): CharDef => ({ walk: 'normal', aa: [MELEE], mult: {}, melee: true, toku: 0, ...d });

export const CHARS: Record<string, CharDef> = {
  hanamaru: def({ desc: '大きな拳をまっすぐ飛ばす。当たった敵にダメージ、壁を壊して突き進む', passive: '壁に押し込み続けると、その壁を壊す', role: 'balance', skill: { name: '巨大拳飛ばし', ct: 10, speed: 360, range: 520, r: 30, dmg: 40, reach: 3, w: 3, d: 2, push: 0.05, botSave: 320, botCheck: 0.25 } }), // 巨大拳: 前方へ直進（speed px/秒、range px で消える）、半径 r の拳がキャラ（1体1回）にダメージ・壁を破壊して貫通。パッシブ: 壁へ push 秒押し込み続けるとその壁を壊す（reach: 前方の壁を探すタイル数、w×d: 壊す範囲(タイル)）。Bot: 壁破壊で経路が botSave(px)以上短くなるなら使う（botCheck 秒ごとに判定）
  whitecul: def({ desc: '前方に吹雪を起こし、範囲の敵にダメージを与えてはじき飛ばす', role: 'speed', skill: { name: '吹雪', ct: 7.2, len: 200, w: 80, dmg: 20, push: 80 } }),
  sayo: def({ desc: 'しばらく足が速くなり、自分のまわりの敵を斬り続ける', role: 'attacker', skill: { name: '疾風乱舞', ct: 8, dur: 3, speed: 1.6, every: 0.3, r: 60, dmg: 12 } }),
  // ドリル: dur 秒、前方（向きは移動・照準に追従）に長さ len・幅 w のドリルを出しっぱなし。触れた敵に dmg ＋自分から離れる向きへ push はじく。同じ相手には rehit 秒おき。ドリル中は通常攻撃しない（移動は可）
  metan: def({ desc: 'しばらく前方にドリルを出し続ける。触れた敵にダメージを与えてはじく（その間は通常攻撃しない）', role: 'defense', skill: { name: 'ドリル', ct: 4.8, dur: 2.4, len: 70, w: 36, dmg: 12, push: 40, rehit: 0.4 } }),
  mochiko: def({ desc: 'ファンネル6機を出す。敵を囲んで撃つ（ファンネルは攻撃されると壊れる）', role: 'defense', walk: 'hover', skill: { name: 'ファンネル', ct: 30, n: 6, hp: 20, life: 15, sense: 250, dmg: 6, every: 1, range: 60, speed: 220, radius: 6, pathMax: 400, ring: 44, slotStep: Math.PI / 3, retarget: 0.5 } }), // pathMax: 向かう敵までの経路長の上限、ring: 敵を囲む半径、slotStep: 射撃ごとに回り込む角度、retarget: 対象と経路の見直し間隔
  // windup: タメの秒数、speed/side: 進む速さ・進行方向に垂直な移動の速さ（移動速度に対する倍率）、dur: 最大秒数、len×w: エフェクト（＝攻撃判定）の大きさ、head: 頭の中心の自キャラからの距離、smoke: 煙が消えるまでの秒数、spin: 渦の回転(ラジアン/秒)
  // fx: 見た目。渦: 筋の本数・[色, 太さ, 不透明度]（交互）・回り込む量(ラジアン)・半径（始め〜終わり）・尾へずれる量(px)。警告: 点滅の間隔・矢印の数。タメ中の白い点滅の間隔
  aru: def({ desc: 'タメてから決めた方向へ突撃。壁を壊し、触れた敵にダメージ', role: 'speed', skill: { name: '突撃', ct: 6, windup: 0.8, speed: 1, side: 0.4, dur: 2, len: 160, w: 126, head: 40, dmg: 60, smoke: 0.6, spin: 9, fx: { strands: 7, lines: [[0xff8a00, 6, 0.85], [0xffe14a, 4, 0.9]], turn: Math.PI * 2.6, r0: 4, r1: 70, back: 80, warnBlinkMs: 120, arrows: 5, blinkMs: 90 } } }),
  // 再現江湖: 射程 range 内の敵（照準モードに従う。いなければ向いている方向）へ残像を残して高速移動（speed px/秒、最大 range。移動中は通常攻撃のダメージを受けない）。敵に当たったらさらに extra 進み、止まった瞬間に当てた相手を中心に半径 r の爆発（dmg、大将へは bossDmg＝旧めたんのドリルと同じ基本値30）。範囲の壁も壊す。当たらなければ爆発なし
  bii: def({ desc: '敵へ残像を残して高速で飛び込み、当たると爆発（壁も壊す）。外すと爆発しない', role: 'support', skill: { name: '再現江湖', ct: 10, range: 200, speed: 900, extra: 60, r: 70, dmg: 60, bossDmg: 30 } }),
  ierutan: def({ desc: 'まわりの味方と自分の足を速くし、しばらく回復し続ける', role: 'support', skill: { name: '加速', ct: 8, r: 150, speed: 1.5, dur: 5, regen: 3 } }), // regen: 効果中の毎秒の回復量
  zunko: def({ desc: '矢を撃ち、当たった敵をずんだ餅にする（足が遅くなり、技が使えない）', role: 'attacker', melee: false, aa: [{ name: '遠距離', kind: 'shot', range: 200, cd: C.ATTACK_COOLDOWN_RANGED, dmg: 1, shot: 'bullet', speed: C.BULLET_SPEED }], skill: { name: 'ずんだアロー', ct: 12, range: 300, dur: 4, speed: 0.5 } }), // 当たった敵はずんだ餅（移動×speed、技不可）
  // 足が遅い。対象が 60 より遠ければきりたん砲（弾速遅め・ダメージ控えめ）、近ければ包丁
  // 全弾斉射: 1回目でロックオン（射程 range 内の敵に近い順で lockEvery 秒ごとに1体ずつ。最大 lockMax 秒）、2回目でロックした全員へホーミング弾（各 perTarget 発 × volleys 回、volleyGap 秒おき、1発 dmg）。CT は発射（またはロックの時間切れ）から
  // 弾道（3種を順に）: straight=直進して追う、spread=左右へゆっくり展開（spreadT 秒、spreadSpeed）→加速（accel）して目標へ、brake=前方／後方へ偏差的に速く飛ぶ（leadT 秒、leadSpeed、leadAngle）→急制動（brakeT 秒）→目標へ。速さの上限 maxSpeed、life 秒で消える、弾の半径 r
  // 死神の鎌: 発動で透明化（dur 秒。敵の対象にならない・オートアタックしない・被弾で即死）。透明化中は対象が範囲に入ると自動で鎌（前方 range・arc、dmg、大将へは bossDmg＝旧めたんのドリルと同じ基本値30、アシストへは dmg×assistMult）。当てたら攻撃の向きへ jump px を通常移動の jumpSpeed 倍で跳ぶ（壁で止まる）。eyes: 透明化中の目のドット（tools/make_dot.py）
  himari: def({ desc: '姿を消す。消えている間は近づいた敵を鎌で一撃で倒し、攻撃の向きへ跳ぶ（攻撃を受けると即やられる）', role: 'attacker', skill: { name: '死神の鎌', ct: 15, dur: 5, range: 60, arc: Math.PI / 2, dmg: 999, bossDmg: 30, assistMult: 0.5, jump: C.PLAYER_RADIUS * 2 * 5, jumpSpeed: 2 } }),
  // 東北イタコ: 通常攻撃はキツネ（狐火の見た目）。間隔は半分、1発は半分
  // 狐火: 自分中心の半径 r の円周に n 個の火の玉を出し、時計回りに spin(ラジアン/秒) で回す（dur 秒で消える）。触れた敵に dmg、同じ相手には rehit 秒おき。ballR: 火の玉の半径
  // 展開中に再発動: 射程 range 内の最寄りの敵を標的に、各火の玉は標的の方向を12時とした9時の位置で円から離れ、homeSpeed(px/秒)・旋回 turn(ラジアン/秒) で追う。命中で homeDmg を与えて消える。life 秒・壁で消える。CT は再発動（または時間切れ）から
  itako: def({ desc: '自分のまわりに狐火を回し、触れた敵にダメージ。回っている間にもう一度使うと、狐火が近くの敵を追いかけて飛ぶ', role: 'balance', aa: [{ ...MELEE, cd: C.ATTACK_COOLDOWN_MELEE / 2, dmg: 0.5, fx: 'kitsune' }], skill: { name: '狐火', ct: 8, n: 5, r: 50, spin: 3, dur: 6, ballR: 8, dmg: 8, rehit: 0.5, range: 260, homeSpeed: 360, turn: 6, homeDmg: 15, life: 3 } }),
  // ユーレイちゃん: 足がなく浮遊（hover）。壊せる壁をすり抜ける（ghost）。通常攻撃の間隔は2倍
  // エンマビーム: 光弾が螺旋を描きながら直進（speed px/秒、range px、壁で消える）。当たり判定は先頭の光弾（半径 r）だけ。プレイヤーへのダメージは悪行量に比例（悪行0で minDmg、WANTED_MIN 手前で maxDmg、指名手配中は即死 killDmg）。大将・場の物には minDmg
  // 見た目: 光弾 orbs 個、螺旋の半径 spiralR・1周の長さ spiralLen(px)
  yurei: def({ desc: '螺旋を描く光弾をまっすぐ撃つ。悪行が多い敵ほど大ダメージ、指名手配中なら一撃', passive: '壊せる壁をすり抜けて移動できる', role: 'support', walk: 'hover', ghost: true, aa: [{ ...MELEE, cd: C.ATTACK_COOLDOWN_MELEE * 2 }], skill: { name: 'エンマビーム', ct: 10, speed: 420, range: 320, r: 8, minDmg: 1, maxDmg: 50, killDmg: 999, orbs: 4, spiralR: 6, spiralLen: 40 } }),
  kiritan: def({
    desc: '1回目で射程内の敵をロックオン、2回目でロックした全員へホーミング弾を撃ち込む', melee: false, mult: { speed: 0.8 },
    aa: [{ ...MELEE, name: '包丁', dmg: 1.2 }, { name: 'きりたん砲', kind: 'shot', range: 310, cd: C.ATTACK_COOLDOWN_RANGED, dmg: 0.85, shot: 'cannon', speed: 300, far: 60 }],
    skill: { name: '全弾斉射', ct: 7.2, range: 310, lockEvery: 0.1, lockMax: 3, perTarget: 4, volleys: 3, volleyGap: 0.3, dmg: 7.5, r: 4, life: 3, maxSpeed: 650, straightSpeed: 450, spreadT: 0.35, spreadSpeed: 70, accel: 1400, leadT: 0.3, leadSpeed: 520, leadAngle: 0.5, brakeT: 0.12 },
  }),
};

type JsonChar = { name: string; boss?: number };
const JSON_CHARS = Object.fromEntries(Object.entries(CHARS_JSON).filter(([k]) => k !== '_')) as Record<string, JsonChar>;
export const PICKABLE = Object.keys(JSON_CHARS).filter((k) => JSON_CHARS[k].boss === undefined); // 大将以外
// e2e（E2E_HOOKS）の試合の Bot の編成（順に割り当てる）。一撃で倒すひまり・壁を壊すビィは入れない（検証が揺らぐため。両者の検証は人間の操作で行う）
export const E2E_BOTS = ['hanamaru', 'whitecul', 'sayo', 'metan', 'mochiko', 'aru', 'ierutan', 'zunko', 'kiritan'];
export const BOSS_CHAR = [0, 1].map((t) => Object.keys(JSON_CHARS).find((k) => JSON_CHARS[k].boss === t)!); // 陣営 → 大将のキャラ

// キャラのロール倍率。char なし（大将）や role なしは null
export const roleOf = (char?: string) => { const r = CHARS[char ?? '']?.role; return r ? { name: r, ...C.ROLES[r] } : null; };
// キャラの視界半径（ロール係数込み）。char なし（大将）は基本値
export const visionRadius = (char?: string) => C.VISION_RADIUS * (roleOf(char)?.vision ?? 1);
// 撃破後の視界半径（サーバー・クライアント共通）。ko: 撃破からの秒数（null＝生存）。大爆発までは visionRadius、その後 RESPAWN_BASE までに (1−t)^2 で0へ縮む。アシストは大爆発で0
export const eyeRadius = (char: string, ko: number | null, assist = false) => {
  const r = visionRadius(char), K = C.KO_FX, end = K.shake + K.boom;
  if (ko === null || ko < end) return r;
  const t = (ko - end) / (C.RESPAWN_BASE - end);
  return assist || t >= 1 ? 0 : r * (1 - t) ** 2;
};
// 近接補正の対象か（定義のないアシストなども対象）
export const melee = (char: string) => CHARS[char]?.melee ?? true;
export const walkOf = (char: string) => CHARS[char]?.walk ?? 'normal';

// ステータスの算出（サーバーの maxHp・speedOf・attack もこれを使う）
export const charHp = (char: string) => {
  let hp = C.PLAYER_HP * (roleOf(char)?.hp ?? 1);
  if (melee(char)) hp *= C.MELEE_BONUS.hp;
  return hp;
};
export const charSpeed = (char: string) => {
  let sp = C.PLAYER_SPEED * (roleOf(char)?.speed ?? 1);
  if (melee(char)) sp *= C.MELEE_BONUS.speed;
  const m = CHARS[char]?.mult.speed;
  if (m !== undefined) sp *= m;
  return sp;
};
export const charAtk = (char: string) => {
  let dmg = C.ATTACK_DAMAGE * (roleOf(char)?.atk ?? 1);
  if (melee(char)) dmg *= C.MELEE_BONUS.atk;
  return dmg;
};
// 移動の当たり判定に使う壁。ghost のキャラは外周の壁（壊せない壁）だけ。walls: 今の壁（壁破壊で変わる）
const OUTER_WALLS = wallRects(MAP.tiles.map((row, y) => [...row].map((c, x) => (c === '#' && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (MAP.tiles[y + dy]?.[x + dx] ?? ' ') === ' ')) ? '#' : '.')).join('')));
export const moveWalls = (char: string | undefined, walls: Rect[]) => (CHARS[char ?? '']?.ghost ? OUTER_WALLS : walls);
const aaOf = (char: string) => CHARS[char]?.aa ?? [MELEE];
// 通常攻撃の射程（モードのうち一番長いもの）
export const aaRange = (char: string) => Math.max(...aaOf(char).map((m) => m.range));
// 使う通常攻撃のモード。d: 対象までの距離（対象なしは null）
export const aaMode = (char: string, d: number | null) => {
  const ok = aaOf(char).filter((m) => m.far === undefined || d === null || d > m.far);
  return ok[ok.length - 1] ?? aaOf(char)[0];
};

// 表示用ステータス（各1〜5段階）。閾値: この値以上で 2,3,4,5 段階。技CTは短いほど高段階
export const STAT_STEPS = {
  hp: [80, 100, 120, 140],
  speed: [150, 180, 200, 220],
  ct: [-15, -9, -7.5, -6], // -CT（秒）
  atk: [12, 17, 22, 27], // 秒間ダメージ
  range: [60, 150, 210, 250],
};
const step = (v: number, th: number[]) => 1 + th.filter((t) => v >= t).length;
export const charStats = (char: string) => {
  const d = CHARS[char];
  return {
    hp: step(charHp(char), STAT_STEPS.hp),
    speed: step(charSpeed(char), STAT_STEPS.speed),
    ct: step(-d.skill.ct, STAT_STEPS.ct),
    aa: d.aa.map((m) => ({ name: m.name, kind: m.kind, atk: step((charAtk(char) * m.dmg) / m.cd, STAT_STEPS.atk), range: step(m.range, STAT_STEPS.range) })),
  };
};
