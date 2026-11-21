// キャラ key → 技の描画。共通処理（main.ts）はこの表を引くだけで、キャラ key・状態 key・場の物の種類を見ない
import type Phaser from 'phaser';
import zunko from './zunko';
import ierutan from './ierutan';
import sayo from './sayo';
import kiritan from './kiritan';
import aru from './aru';
import mochiko from './mochiko';
import hanamaru from './hanamaru';
import bii from './bii';
import himari from './himari';
import whitecul from './whitecul';
import metan from './metan';
import itako from './itako';
import yurei from './yurei';
import sora from './sora';

type G = Phaser.GameObjects.Graphics;
// 状態の描画。v: サーバーが送った描画用の値（なければ true）
export type StatusView = {
  mark?(g: G, u: { x: number; y: number; sp: Phaser.GameObjects.Sprite; time: number; v: any }): void; // ユニットの描画中（足元・頭上の目印、スプライトの表示・点滅）
  fx?(g: G, u: { x: number; y: number; time: number; v: any }): void; // 技のエフェクトの層（生きているユニットだけ）
  hud?: string; // 技ボタンに出す文字（技を使えない状態）
  frame?: string; // この間スプライトをこのドットのコマに差し替える（歩き・瞬きもしない）
  bare?: boolean; // 足元の陣営色・HP・目印を出さず、敵のミニマップにも出さない
};
// 場の物の描画。layer: ground=床（資材などと同じ層）、fx=技のエフェクトの層。tc: 陣営色
export type EntView = { layer: 'ground' | 'fx'; draw(g: G, e: any, time: number, tc: number, pos: (id: string) => { x: number; y: number } | null): void }; // pos: 対象のid（p:/boss:/c:/e:）→ 描画位置
// 技の fx（サーバーの addFx）の描画を差し替える。color でどの技の fx か分かる。ms: 出している時間（既定 SKILL_FX_MS）、k: 0→1 の経過、s: 今のスナップショット
export type FxView = { ms?: number; draw(g: G, f: any, time: number, k: number, s: any): void };
export type ClientSkill = {
  status?: Record<string, StatusView>;
  ents?: Record<string, EntView>;
  colors?: Record<string, number>; // 技のエフェクト（サーバーの fx）の色
  frame?(g: G, time: number): void; // 毎フレーム: 状態のエフェクトの後（煙など自前の粒）
  frames?: string[]; // 追加で読み込むドットのコマ（tools/make_dot.py が書き出す）
  fx?: Record<string, FxView>; // fx の color → 描画（共通の形の描画の代わり）
  shots?: Record<string, (g: G, sh: any, time: number) => void>; // 弾の種類 → 描画（共通の弾の描画の代わり）
  self?(g: G, c: SelfCtx): void; // 自キャラがこのキャラで技が使える間、本人の画面にだけ毎フレーム（技の範囲の予告など）
};
// self の材料: me=自キャラの描画位置（予測）、s=スナップショット、myTeam、pos=他キャラの描画位置（補間）
export type SelfCtx = { me: { x: number; y: number }; s: any; myTeam: number; time: number; pos: (id: string) => { x: number; y: number } | null };

// 並び順＝描画の重なり順（先に描いたものが下）
const MODS: Record<string, ClientSkill> = { zunko, ierutan, sayo, kiritan, aru, mochiko, hanamaru, bii, himari, whitecul, metan, itako, yurei, sora };
export const CLIENT_SKILLS = Object.values(MODS);
export const STATUS_VIEW: Record<string, StatusView> = Object.assign({}, ...CLIENT_SKILLS.map((m) => m.status ?? {}));
export const ENT_VIEW: Record<string, EntView> = Object.assign({}, ...CLIENT_SKILLS.map((m) => m.ents ?? {}));
export const SELF_VIEW: Record<string, ClientSkill['self']> = Object.fromEntries(Object.entries(MODS).filter(([, m]) => m.self).map(([k, m]) => [k, m.self])); // キャラ → 技が使える間の本人だけの描画
export const DOT_EXTRA = Object.entries(MODS).flatMap(([k, m]) => (m.frames ?? []).map((f) => [k, f])); // [キャラ key, コマ]
export const FX_VIEW: Record<string, FxView> = Object.assign({}, ...CLIENT_SKILLS.map((m) => m.fx ?? {}));
export const SHOT_VIEW: Record<string, (g: G, sh: any, time: number) => void> = Object.assign({}, ...CLIENT_SKILLS.map((m) => m.shots ?? {}));
export const SKILL_COLORS: Record<string, number> = Object.assign({}, ...CLIENT_SKILLS.map((m) => m.colors ?? {}));
