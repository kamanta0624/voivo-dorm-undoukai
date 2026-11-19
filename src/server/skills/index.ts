// キャラ key → 技処理。共通処理（GameRoom.ts）はこの表を引くだけで、キャラ key を見ない
import type { GameRoom, Player, Ent } from '../GameRoom';
import type { Pt, Rect } from '../../shared/config';
import hanamaru from './hanamaru';
import whitecul from './whitecul';
import sayo from './sayo';
import metan from './metan';
import mochiko from './mochiko';
import aru from './aru';
import bii from './bii';
import ierutan from './ierutan';
import zunko from './zunko';
import kiritan from './kiritan';
import himari from './himari';
import itako from './itako';
import yurei from './yurei';
import sora from './sora';

// 場の物の種類: update=毎tick（種類ごとにこの表の順で全部の物を更新）、fog=敵の視界の外では送らない
export type EntKind = { update(room: GameRoom, e: Ent, dt: number): void; fog: boolean };
export type Skill = {
  use(room: GameRoom, p: Player, a: number): void | false; // 発動。a: 技の向き。CT は共通処理が入れる（false を返したら入れない。技処理が room の p.skillReadyAt を入れる）
  release?(room: GameRoom, p: Player): void; // 技ボタンを離した（押している間タメる技）
  botUse(room: GameRoom, p: Player): boolean; // Bot: 今使う価値があるか
  afterMove?(room: GameRoom, p: Player, dt: number, px: number, py: number, locked: boolean): void; // 毎tick: 移動の直後（px,py: 移動前の位置、locked: このtickの移動不可）
  tick?(room: GameRoom, p: Player, dt: number): void; // 毎tick: ウルトの時間切れ・状態の回復の後、オートアタックの前
  ended?(room: GameRoom, p: Player, dt: number): void; // 結果画面の毎tick（見た目だけ）
  attack?(room: GameRoom, p: Player, a: number): boolean; // 通常攻撃（オートアタック）の上書き。true なら通常の攻撃をしない。a: 攻撃の向き
  botMove?(room: GameRoom, p: Player, to: Pt, obs: Rect[]): boolean; // Bot: 見回りの移動中（true なら移動しない）
  statuses?: string[]; // この技が付ける状態の key（移動倍率はこの表の順に掛ける）
  ents?: Record<string, EntKind>; // この技が出す場の物の種類
};

// 並び順＝状態の移動倍率を掛ける順・場の物を更新する順（変えると挙動が変わる）
const MODS: Record<string, Skill> = { hanamaru, whitecul, sayo, metan, mochiko, aru, bii, ierutan, zunko, kiritan, himari, itako, yurei, sora };
export const SKILLS = MODS;
export const STATUS_ORDER = Object.values(MODS).flatMap((m) => m.statuses ?? []);
export const ENTS: Record<string, EntKind> = Object.assign({}, ...Object.values(MODS).map((m) => m.ents ?? {}));
