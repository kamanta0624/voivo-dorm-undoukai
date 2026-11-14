// キャラの性能定義（キャラ key → 定義）。素材・表示の対応表は chars.json（Python の素材生成も読む）
// HP・移動・攻撃の実数値は書かない。共通の基本値（config.ts）× ROLES × MELEE_BONUS × mult をここの関数で算出する
import { CONFIG as C } from './config';
import CHARS_JSON from './chars.json';

// 通常攻撃のモード。kind: melee=前方の扇形（ATTACK_ARC）、shot=弾。dmg: ダメージ倍率。far: 対象がこれより遠い（対象なしを含む）ときだけ使う
export type AaMode = { name: string; kind: 'melee' | 'shot'; range: number; cd: number; dmg: number; shot?: 'bullet' | 'cannon'; speed?: number; far?: number };
export type CharDef = {
  role?: string; // ROLES の key（なし可）
  walk: 'normal'; // 歩行タイプ
  aa: AaMode[]; // 通常攻撃のモード（使えるもののうち最後のものを使う）
  mult: { speed?: number }; // キャラ固有の倍率
  melee: boolean; // 近接補正（MELEE_BONUS）の対象
  breaker: boolean; // 壊し屋（構造物へ BREAKER_MULT）
  toku: number; // 徳の初期値の補正（陣営の全員分を足す）
  skill: { name: string; ct: number; [k: string]: any }; // 技（R）。ct=クールタイム(秒)、ほかは技処理（server/skills・client/skills）が使う値
};

const MELEE: AaMode = { name: '近接', kind: 'melee', range: C.ATTACK_RANGE, cd: C.ATTACK_COOLDOWN_MELEE, dmg: 1 };
const def = (d: Partial<CharDef> & Pick<CharDef, 'skill'>): CharDef => ({ walk: 'normal', aa: [MELEE], mult: {}, melee: true, breaker: false, toku: 0, ...d });

export const CHARS: Record<string, CharDef> = {
  hanamaru: def({ role: 'balance', breaker: true, skill: { name: '巨大拳飛ばし', ct: 10, speed: 360, range: 520, r: 30, dmg: 40, reach: 3, w: 3, d: 2, push: 0.05, botSave: 320, botCheck: 0.25 } }), // 巨大拳: 前方へ直進（speed px/秒、range px で消える）、半径 r の拳がキャラ（1体1回）にダメージ・壁を破壊して貫通。パッシブ: 壁へ push 秒押し込み続けるとその壁を壊す（reach: 前方の壁を探すタイル数、w×d: 壊す範囲(タイル)）。Bot: 壁破壊で経路が botSave(px)以上短くなるなら使う（botCheck 秒ごとに判定）
  whitecul: def({ role: 'speed', skill: { name: '吹雪', ct: 7.2, len: 200, w: 80, dmg: 20, push: 80 } }),
  sayo: def({ role: 'attacker', breaker: true, skill: { name: '疾風乱舞', ct: 8, dur: 3, speed: 1.6, every: 0.3, r: 60, dmg: 12 } }),
  metan: def({ role: 'defense', skill: { name: 'ドリル', ct: 4.8, range: 70, arc: Math.PI / 2, dmg: 30, push: 120 } }),
  mochiko: def({ role: 'defense', skill: { name: 'ファンネル', ct: 30, n: 6, hp: 20, life: 15, sense: 250, dmg: 6, every: 1, range: 60, speed: 220, radius: 6, pathMax: 400, ring: 44, slotStep: Math.PI / 3, retarget: 0.5 } }), // pathMax: 向かう敵までの経路長の上限、ring: 敵を囲む半径、slotStep: 射撃ごとに回り込む角度、retarget: 対象と経路の見直し間隔
  // windup: タメの秒数、speed/side: 進む速さ・進行方向に垂直な移動の速さ（移動速度に対する倍率）、dur: 最大秒数、len×w: エフェクト（＝攻撃判定）の大きさ、head: 頭の中心の自キャラからの距離、smoke: 煙が消えるまでの秒数、spin: 渦の回転(ラジアン/秒)
  // fx: 見た目。渦: 筋の本数・[色, 太さ, 不透明度]（交互）・回り込む量(ラジアン)・半径（始め〜終わり）・尾へずれる量(px)。警告: 点滅の間隔・矢印の数。タメ中の白い点滅の間隔
  aru: def({ role: 'speed', breaker: true, skill: { name: '突撃', ct: 6, windup: 0.8, speed: 1, side: 0.4, dur: 2, len: 160, w: 126, head: 40, dmg: 60, smoke: 0.6, spin: 9, fx: { strands: 7, lines: [[0xff8a00, 6, 0.85], [0xffe14a, 4, 0.9]], turn: Math.PI * 2.6, r0: 4, r1: 70, back: 80, warnBlinkMs: 120, arrows: 5, blinkMs: 90 } } }),
  bii: def({ role: 'support', skill: { name: '罠設置', ct: 10, range: 140, arc: (100 * Math.PI) / 180, every: 1, dmg: 10, hp: 60, decay: 3, max: 2, r: 20 } }), // 向いた方向の扇形の敵を攻撃し続ける罠（r: 罠の大きさ）
  ierutan: def({ role: 'support', skill: { name: '加速', ct: 8, r: 150, speed: 1.5, dur: 5, regen: 3 } }), // regen: 効果中の毎秒の回復量
  zunko: def({ role: 'attacker', melee: false, aa: [{ name: '遠距離', kind: 'shot', range: 200, cd: C.ATTACK_COOLDOWN_RANGED, dmg: 1, shot: 'bullet', speed: C.BULLET_SPEED }], skill: { name: 'ずんだアロー', ct: 18, range: 300, dur: 4, speed: 0.5 } }), // 当たった敵はずんだ餅（移動×speed、技不可）
  // 足が遅い。対象が 60 より遠ければきりたん砲（弾速遅め・ダメージ控えめ）、近ければ包丁。技: 飛行中は移動が速いが包丁（近距離）しか使えない
  kiritan: def({
    melee: false, mult: { speed: 0.8 },
    aa: [{ ...MELEE, name: '包丁', dmg: 1.2 }, { name: 'きりたん砲', kind: 'shot', range: 260, cd: C.ATTACK_COOLDOWN_RANGED, dmg: 0.7, shot: 'cannon', speed: 300, far: 60 }],
    skill: { name: 'きりたん砲飛行', ct: 7.2, dur: 5, speed: 1.8 },
  }),
};

type JsonChar = { name: string; boss?: number };
const JSON_CHARS = Object.fromEntries(Object.entries(CHARS_JSON).filter(([k]) => k !== '_')) as Record<string, JsonChar>;
export const PICKABLE = Object.keys(JSON_CHARS).filter((k) => JSON_CHARS[k].boss === undefined); // 大将以外
export const BOSS_CHAR = [0, 1].map((t) => Object.keys(JSON_CHARS).find((k) => JSON_CHARS[k].boss === t)!); // 陣営 → 大将のキャラ

// キャラのロール倍率。char なし（大将）や role なしは null
export const roleOf = (char?: string) => { const r = CHARS[char ?? '']?.role; return r ? { name: r, ...C.ROLES[r] } : null; };
// キャラの視界半径（ロール係数込み）。char なし（大将）は基本値
export const visionRadius = (char?: string) => C.VISION_RADIUS * (roleOf(char)?.vision ?? 1);
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
const aaOf = (char: string) => CHARS[char]?.aa ?? [MELEE];
// 通常攻撃の射程（使えるモードのうち一番長いもの）。meleeOnly: 近接のモードだけ使える状態
export const aaRange = (char: string, meleeOnly = false) => Math.max(...aaOf(char).filter((m) => !(meleeOnly && m.kind === 'shot')).map((m) => m.range));
// 使う通常攻撃のモード。d: 対象までの距離（対象なしは null）
export const aaMode = (char: string, d: number | null, meleeOnly = false) => {
  const ok = aaOf(char).filter((m) => !(meleeOnly && m.kind === 'shot') && (m.far === undefined || d === null || d > m.far));
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
