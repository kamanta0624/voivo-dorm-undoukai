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
export type EntView = { layer: 'ground' | 'fx'; draw(g: G, e: any, time: number, tc: number): void };
export type ClientSkill = {
  status?: Record<string, StatusView>;
  ents?: Record<string, EntView>;
  colors?: Record<string, number>; // 技のエフェクト（サーバーの fx）の色
  frame?(g: G, time: number): void; // 毎フレーム: 状態のエフェクトの後（煙など自前の粒）
  frames?: string[]; // 追加で読み込むドットのコマ（tools/make_dot.py が書き出す）
};

// 並び順＝描画の重なり順（先に描いたものが下）
const MODS: Record<string, ClientSkill> = { zunko, ierutan, sayo, kiritan, aru, mochiko, hanamaru, bii, himari };
export const CLIENT_SKILLS = Object.values(MODS);
export const STATUS_VIEW: Record<string, StatusView> = Object.assign({}, ...CLIENT_SKILLS.map((m) => m.status ?? {}));
export const ENT_VIEW: Record<string, EntView> = Object.assign({}, ...CLIENT_SKILLS.map((m) => m.ents ?? {}));
export const DOT_EXTRA = Object.entries(MODS).flatMap(([k, m]) => (m.frames ?? []).map((f) => [k, f])); // [キャラ key, コマ]
export const SKILL_COLORS: Record<string, number> = Object.assign({}, ...CLIENT_SKILLS.map((m) => m.colors ?? {}));
