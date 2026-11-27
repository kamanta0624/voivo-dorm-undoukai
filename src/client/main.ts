/// <reference types="vite/client" />
import Phaser from 'phaser';
import { Room, CloseCode } from '@colyseus/sdk';
import { CONFIG as C, wallRects, seeRects, seeThrough, roomLayout } from '../shared/config';
import { CHARS as DEFS, PICKABLE, BOSS_CHAR, visionRadius, eyeRadius, walkOf, charStats, moveWalls, aaRange } from '../shared/chars';
import { cage, lineOfSight } from '../shared/geom';
import { solarPct } from '../shared/solar';
import { CLIENT_SKILLS, STATUS_VIEW, ENT_VIEW, SKILL_COLORS, DOT_EXTRA, FX_VIEW, SHOT_VIEW, SELF_VIEW } from './skills';
import { ClientMeasure } from '../shared/netmeasure';
import { Predictor, Interp } from '../shared/netcode';
import MAP from '../shared/map.json';
import { Controls } from './input';
import CHARS_JSON from '../shared/chars.json';
import { Commentary } from './commentary';
import { paintMap, CHIP_DIR, CHIP_FILES, Pics } from './mapchip/paint';
import { GUMI, TEAM_GUMI, VOICES } from '../shared/commentary';
import { ModernFx, CSS as MFX_CSS } from './slot_modern_fx';
import { uf, ufCss } from './uifont';
import { openResult, closeResult, resultOpen } from './result';
import { powerText, assistText } from '../shared/slot_modern';
import { sendC2S, type C2S } from '../shared/protocol';

type React = { diffs: string[]; kill: string | null; sad: string | null; relief: string | null; surprise: string | null; angry: string | null; joy: string | null; tap: (string | string[] | null)[]; parts: number[] }; // tap の配列は同じ部位を触るたびに順番に替わる // 余白の立ち絵の反応（react1。chars.json の react）
type Tachie = { fit?: 'full' | 'knee'; cm?: number; top?: number; foot?: number; base?: number; knee?: number; crate?: number[] }; // 選択画面・余白の立ち絵の出し方（chars.json の tachie。tachie2）
type Char = { name: string; select: string; ko: string; koed: string | null; boss?: number; bg?: string; react?: React; tachie?: Tachie };
const CHARS = Object.fromEntries(Object.entries(CHARS_JSON).filter(([k]) => k !== '_')) as Record<string, Char>;
const DOT_FRAMES = ['idle', 'walk1', 'walk2', 'half', 'close', 'banzai'];
const COURIER_CHAR = 'kobako'; // ブイブイ・コバコのドット
const DOT_KEYS = [...Object.keys(CHARS), COURIER_CHAR, ...Object.keys(C.ASSIST.units)];
const charName = (k: string) => CHARS[k]?.name ?? C.ASSIST.units[k]?.name ?? k; // アシストは chars.json にいない
const DOT = (key: string, frame = 'idle') => `assets/gen/dot/${key}/${frame}.png`;
const MOVE_PHASES = ['countdown', 'playing', 'ended']; // 自キャラが動ける場面（カウント中と終了後は部屋の中だけ）
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const css16 = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const TACHIE = (key: string, slot: string) => `assets/gen/tachie/${key}/${slot}.png`;
const CRATE = 'assets/crate/crate.png'; // 低身長組の足元の木箱（ニコニ・コモンズ nc298408）
// 選択画面・余白の立ち絵の大きさと位置（枠の高さ Hp に対する px）: h=絵の高さ、top=絵の上端（枠の上端から）、crate=木箱（left は絵の左端から）。身長に比例（tachie2）
function tachieFit(k: string, Hp: number) {
  const t = CHARS[k]?.tachie;
  if (!t || t.fit === 'full' || t.top === undefined) return { h: Hp, top: 0, crate: null };
  if (t.fit === 'knee') { const h = Hp / ((t.knee! - t.top) / 100); return { h, top: (-t.top / 100) * h, crate: null }; }
  const h = ((Hp / C.TACHIE_MAX_CM) * t.cm!) / ((t.foot! - t.top) / 100), top = Hp - (t.base! / 100) * h, c = t.crate;
  return { h, top, crate: c ? { left: (c[0] / 100) * h, top: top + (c[1] / 100) * h, size: (c[2] / 100) * h } : null };
}

const TEAM_COLOR = [0xff8c28, 0x3cc850]; // あんこもん軍(オレンジ), ずんだもん軍(緑)
const NEUTRAL_COLOR = 0xcccccc; // 中立（コバコ）
const teamColor = (t: number) => TEAM_COLOR[t] ?? NEUTRAL_COLOR;
const TEAM_NAME = ['だいだい組', 'みどり組'];
const TITLE = 'ブイブイブレイカーズ';
// 待機画面（キャラ選択）の色。ステータスの棒: stat=HP・速度・技CT、melee=近接モードの攻撃・射程、shot=遠距離（弾）モードの攻撃・射程、empty=空き。ロール・性能の色分けは未指定（後で足す）
// 選択バーのカード1枚の幅（論理px。全員分が収まらなければ横にスクロール）、選択バー表示中の立ち絵の高さ（画面の%。左上の窓・右上の組の一覧に顔が被らない大きさ）
const CARD_W = 56, BAR_COPIES = 3; // BAR_COPIES: 選択バーのループのために全員分を並べる回数
const LOBBY_COLOR = { stat: '#ffe066', melee: '#ff7a3c', shot: '#3cb4ff', empty: '#ffffff26', ok: '#66ff99', pending: '#bbbbbb' };
const PICK_SEND_MS = 200; // 待機画面: 表示キャラの切り替えをサーバーへ送る間隔の下限（カーソルを動かすたびに送らない）
const ROLE_LABEL: Record<string, string> = { balance: 'バランス', attacker: 'アタッカー', speed: 'スピード', defense: 'ディフェンス', support: 'サポート' };
const ITEM_COLOR: Record<string, number> = { heal: 0x66ff99, box_ult: 0xff66ff, box_assist: 0x66ccff, assist: 0x66ccff };
const ITEM_LABEL: Record<string, string> = { heal: '回復', box_ult: 'パワーアップ箱', box_assist: 'アシスト箱' };
const PAYOUT_LABEL: Record<string, string> = { ult: 'パワーアップ', assist: 'アシスト' };
// バフ／デバフ欄: サーバーの buffs の key → [名前, 良い効果か]。技名は技名定義から。ここにない key は出さない
const BUFF: Record<string, [string, boolean]> = {
  upgrade: [DEFS.ierutan.skill.name, true], boost: ['加速（アシスト）', true], dance: [DEFS.sayo.skill.name, true], overload: [DEFS.bii.skill.name, true], overloadPose: ['ポーズ', true],
  cloak: ['透明化', true], drill: [DEFS.metan.skill.name, true], lockon: ['ロックオン', true], rush: [DEFS.aru.skill.name, true], solar: [DEFS.sora.skill.name, true],
  mochi: ['ずんだ餅', false], pen_slow: ['移動速度低下（罰）', false], pen_weak: ['攻撃力低下（罰）', false],
};
const PENALTY_LABEL: Record<string, string> = { dmg: `全員にダメージ（最大HPの${C.SLOT.penalty.dmg * 100}%）`, slow: `全員の移動速度低下（×${C.SLOT.penalty.slow}、${C.SLOT.penalty.dur}秒）`, weak: `全員の攻撃力低下（×${C.SLOT.penalty.weak}、${C.SLOT.penalty.dur}秒）` };
// 当たった時の演出（通常攻撃の汗、自分以外の斬撃、大将の弾などの爆発）: 弾・他キャラと同じ時刻で出す。自分の斬撃は自キャラ（今の位置）に合わせてすぐ出す
const HIT_FX_KIND = (f: any, me: string) => f.kind === 'sweat' || (f.kind === 'slash' && f.who !== me) || (f.kind === 'aura' && f.color === 'dash');
const T = MAP.tileSize;
const MINI = 0.6; // ミニマップ: 1タイルあたりのpx
const MM_TOP = 86; // ミニマップの上端（論理座標）。右上の顔パネル（みどり組の側）の下
const HOME_TINT = [0xd9a878, 0x9fca86], HOME_TINT_ALPHA = 0.3; // 大将の候補部屋の床に重ねる組の色（陣営0・1、前の単色の床と同じ色）と濃さ（仮）
const SLASH_R = 64; // 斬撃の絵の半径(px)。射程に合わせて拡大縮小する
const SIDE_BG = '#1a1a22'; // ゲーム画面の外（余白）の既定の色（仮置き）。対戦中は自キャラの色（chars.json の bg）
// 余白: 対戦中は自キャラの立ち絵（既定は右、選択画面の切替で左）。入力の邪魔をしない
const side = document.createElement('div');
side.id = 'side';
side.innerHTML = '<img alt=""><img class="crate" alt="">'; // 2枚目: 低身長組の足元の木箱（立ち絵より後ろ。tachie2）
document.body.prepend(side);
// パワーアップ中の演出（本人の画面だけ。pwfx1）: 反対側の余白にちびキャラ・スチルの枠（素材待ち）。立ち絵側の余白のオーラと光は pwfx2 で消した（別の見た目に差し替える予定）
// DOM は1回だけ作り、表示・強さはクラスの切り替えだけ。動きは CSS の transform・opacity のアニメーションだけ
const side2 = document.createElement('div');
side2.id = 'side2';
side2.innerHTML = '<div class="still"><span>素材待ち</span></div>';
document.body.prepend(side2);
// 反対側の余白の素材（ちびキャラ・スチル）。置き場所 public/assets/pwfx/<キャラのkey>.png。素材が届いたらキーを足す（ないキャラは枠と「素材待ち」）
const PW_STILL: Record<string, string> = {};
{ const st = document.createElement('style'); st.textContent = ufCss(`body{background:${SIDE_BG}}#side{position:fixed;overflow:hidden;pointer-events:none;display:none}#side img{position:absolute;z-index:1}#side img.crate{z-index:0;display:none}
#side2{position:fixed;pointer-events:none;display:none;align-items:center;justify-content:center}
#side2.on{display:flex}
#side2 .still{width:80%;height:60%;max-width:240px;box-sizing:border-box;border:2px dashed #fff6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff8;font:bold 13px sans-serif;background:center bottom/contain no-repeat}
#side2 .still.img{border:0}#side2 .still.img span{display:none}`, (q) => q.includes('#side2')); document.head.append(st); }
let sideLeft = false; // 立ち絵を左の余白に出す（端末に保存）
// 立ち絵ごとの、絵の描かれている左右の範囲（画像の幅に対する割合）。読み込んだ時に1回だけ測る（画像は加工しない）
const OPAQUE = new Map<string, [number, number]>();
let VOICE_TABLE: Promise<any> | null = null; // 出撃セリフの一覧（public/voice/sortie.json。npm run voice:audio）。最初に使う時に1回だけ読む
function measureOpaque(img: HTMLImageElement) {
  if (OPAQUE.has(img.src) || !img.naturalWidth) return;
  const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h).data, col = (x: number) => { for (let y = 0; y < h; y += 2) if (d[(y * w + x) * 4 + 3] > 16) return true; return false; };
  let l = 0, r = w - 1;
  while (l < w && !col(l)) l++;
  while (r > l && !col(r)) r--;
  OPAQUE.set(img.src, [l / w, (r + 1) / w]);
}
try { sideLeft = localStorage.getItem('sideLeft') === '1'; } catch {}
const FX_FIT_FRAMES = 30; // リサイズ等の後、#fx の位置を測り直し続けるフレーム数（キャンバスの配置が遅れて変わる場合に備える）
const TAG_RES = 4; // 頭上の強さの札の絵の解像度の倍率
const CRACK_TEX = 'cracks'; // 壁の割れ目（小破・中破）の絵のキー。コマ '1'（小破）・'2'（中破）。素材に差し替えるときはこのキーで読み込む（makeCrackTexture を外す）
const CULL_MARGIN = 64; // 画面外を描かない判定の余白(px)。カメラの追従の遅れ（描画の直前に動く分）・揺れを含めて余裕を持たせる
const tiles = [...MAP.tiles]; // 試合中のタイル（壁破壊で変わる）
// 視界ポリゴン用の壁（透過壁は視界を通すので壁に数えない）。判定は1フレームに何万回も呼ぶので、壁の版が変わったときだけ真偽の一覧を作り直して引く（結果は都度判定と同一）
let wallGrid: Uint8Array | null = null, wallGridVer = -1;
const wallTile = (tx: number, ty: number) => {
  if (wallGridVer !== wallVer) {
    wallGridVer = wallVer;
    wallGrid = new Uint8Array(MAP.width * MAP.height);
    for (let y = 0; y < MAP.height; y++) for (let x = 0; x < MAP.width; x++) if (tiles[y]?.[x] === '#' && !seeThrough(x, y)) wallGrid[y * MAP.width + x] = 1;
  }
  return tx >= 0 && tx < MAP.width && ty >= 0 && ty < MAP.height ? wallGrid![ty * MAP.width + tx] === 1 : false;
};
const isWall = (x: number, y: number) => wallTile(Math.floor(x / T), Math.floor(y / T));
let wallVer = 0; // 壁が変わるたびに増やす（視界の使い回しの判定）
const RAY_COS = Array.from({ length: 360 }, (_, i) => Math.cos((i / 360) * Math.PI * 2)), RAY_SIN = Array.from({ length: 360 }, (_, i) => Math.sin((i / 360) * Math.PI * 2)); // 視界のレイの向き
const SKILL_FX_COLOR: Record<string, number> = { ring: 0xff7fbf, wall: 0xffa040, rect: 0x9fe8ff, dash: 0xff4040, arc: 0xc080ff, heal: 0x66ff99, ult: 0xff66ff, assist: 0x66ccff, beam: 0xff9ad5, pen_dmg: 0xff2020, pen_slow: 0x4080ff, pen_weak: 0xa040ff, snow: 0x9fe8ff, ...SKILL_COLORS }; // snow: 波音リツの吹雪（WhiteCUL の吹雪の色） // 技ごとの色は client/skills
const views = (p: any) => Object.keys(STATUS_VIEW).filter((k) => p?.st?.[k]).map((k) => STATUS_VIEW[k]); // 有効な状態の描画（client/skills）
const ULT_COLOR: Record<string, number> = { melee: 0xff5050, ranged: 0xffd040, area: 0xb070ff }; // 変身先ごとのエフェクトの色

type Unit = { s: Phaser.GameObjects.Sprite; char: string; tx: number; ty: number; blinkAt: number; hp?: number; flashUntil: number; shakeUntil?: number; aura?: Phaser.GameObjects.Sprite }; // aura: パワーアップ中の背後の拡大したドット、shakeUntil: 大ダメージの揺れの終わり
type SkillFx = { kind: string; t0: number; [k: string]: any };

// 立ち絵の層（DOM）。ドットとは別に高解像度で表示する
// ビルドの識別子（gitの短縮ハッシュ＋ビルド日時、vite.config.ts で埋め込む）を画面の隅に常に出す
const ver = document.getElementById('ver')!; // タイトル画面（title.ts）が作る
const fx = document.createElement('div');
fx.id = 'fx';
fx.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden';
document.body.appendChild(fx);
const css = document.createElement('style');
css.textContent = ufCss(`
#fx .cut{position:absolute;left:0;right:0;bottom:0;height:62%;background:linear-gradient(transparent,#000a 30%,#000a 85%,transparent);animation:cutfade var(--d) linear forwards}
#fx .cut img{position:absolute;bottom:0;height:100%}
#fx .cut .me{left:${50 - C.KO_CUTIN_GAP / 2}%;animation:hop var(--d) linear forwards}
#fx .cut .foe{left:${50 + C.KO_CUTIN_GAP / 2}%;animation:push var(--d) ease-out forwards}
@keyframes cutfade{0%{opacity:0}8%{opacity:1}85%{opacity:1}100%{opacity:0}}
@keyframes hop{0%{transform:translateX(-50%) translateX(-40%)}10%{transform:translateX(-50%)}18%{transform:translateX(-50%) translateX(10%)}26%{transform:translateX(-50%)}34%{transform:translateX(-50%) translateX(10%)}42%{transform:translateX(-50%)}50%{transform:translateX(-50%) translateX(10%)}58%,100%{transform:translateX(-50%)}}
@keyframes push{0%,45%{transform:translateX(-50%);filter:none}65%,100%{transform:translateX(-50%) translateX(30%);filter:grayscale(1) brightness(.8)}}
#fx .down{position:absolute;left:${50 - C.KO_CUTIN_GAP / 2}%;transform:translateX(-50%);bottom:22%;height:62%;display:none;overflow:hidden}
#fx .down img{height:100%;transform-origin:50% 100%}
#fx .down img.fall{animation:fall var(--d) ease-in forwards}
@keyframes fall{0%{transform:none}100%{transform:rotate(-14deg) translateY(28%)}}
#fx .down div{position:absolute;left:0;right:0;bottom:12%;text-align:center;color:#fff;font:bold 3vh sans-serif;text-shadow:0 0 4px #000,0 0 4px #000}
/* 練習パネル（fb1124）: 左端の縦長のタブと、左から出る引き出し（幅は画面の1/4）。開閉は transform のアニメーション。当たり判定は高さ44px以上 */
#fx .prw{display:none;position:absolute;left:0;top:0;bottom:0;width:25%;z-index:5;transform:translateX(-100%);transition:transform .2s ease-out;pointer-events:none}
#fx .prw.open{transform:none}
#fx .prp{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;pointer-events:auto;box-sizing:border-box;background:#050505;border-right:1px solid #ffe066;padding:8px;display:flex;flex-direction:column;gap:6px;color:#fff;font:max(13px,calc(var(--z) * 6.5px)) sans-serif}
#fx .prp>b{color:#ffe066;margin-top:4px}
#fx .prp .r{display:flex;align-items:center;gap:6px}
#fx .prp .r>*{flex:1}
#fx .prp button,#fx .prp select{min-height:44px;font:inherit;color:#fff;background:#333;border:1px solid #888;border-radius:6px;padding:0 8px;cursor:pointer}
#fx .prp button.on{background:#7a5a00;border-color:#ffe066}
#fx .prp .lv{flex:none;min-width:3.2em;text-align:center;font-weight:900;color:#ffe066}
#fx .prp .end{margin-top:8px}
#fx .prbtn{position:absolute;left:100%;top:50%;width:max(44px,calc(var(--z) * 22px));height:max(110px,calc(var(--z) * 55px));pointer-events:auto;box-sizing:border-box;border:1px solid #ffe066;border-left:0;border-radius:0 8px 8px 0;background:#000c;color:#ffe066;font:bold max(15px,calc(var(--z) * 8px)) sans-serif;writing-mode:vertical-rl;letter-spacing:.3em;cursor:pointer}
#lobby.practice #roster,#lobby.practice .grace,#lobby.practice #cmbtn,#lobby.practice #cvbtn{display:none}
#fx .timer{position:absolute;top:1.6%;left:50%;transform:translateX(-50%);background:#000a;color:#fff;font:bold calc(var(--z) * 13px) sans-serif;padding:0 .5em;border-radius:3px}
#fx .bar{position:absolute;top:2.6%;width:31%;height:2.4%;background:#000b;outline:1px solid #000}
#fx .bar.b0{left:1.2%}
#fx .bar.b1{right:1.2%}
#fx .bar i{position:absolute;top:0;bottom:0}
#fx .b0 i{left:0;background:#ff8c28}
#fx .b1 i{right:0;background:#3cc850}
#fx #info{position:absolute;left:.6%;top:40%;color:#fff;background:#0009;font:calc(var(--z) * 6.5px)/1.35 sans-serif;padding:.3em .5em;white-space:pre}
#fx .notes{position:absolute;top:30%;left:50%;transform:translateX(-50%);text-align:center}
#fx .notes div{background:#000b;color:#ffe066;font:bold calc(var(--z) * 8px) sans-serif;padding:.2em .8em;margin-bottom:.3em;border-radius:3px;white-space:nowrap}
#fx .pop{position:absolute;left:0;top:0;font:bold calc(var(--z) * 8px) sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000;white-space:nowrap;animation:popup var(--d) ease-out forwards}
#fx .pop.dmg{color:#ff5050}
#fx .pop.plus{color:#ffe066;font-size:calc(var(--z) * 10px)}
#fx .pop.plus.hi{color:#ff7ad9;font-size:calc(var(--z) * 13px)}
#fx .pop.warn{color:#fff59a;font-size:calc(var(--z) * 7px)}
@keyframes popup{0%{opacity:1;translate:0 0}100%{opacity:0;translate:0 calc(var(--z) * -14px)}}
/* 毎フレーム・毎秒変わる HUD の部品は独立した層にする（変わっても #fx 全体を描き直さない: render_policy 5）。ダメージ数値の浮き上がりは margin ではなく translate（レイアウトを起こさない） */
#fx .timer,#fx .skill,#fx .tk,#fx .prw,#fx .buffs,#fx .roster,#fx #info,#fx .banner,#fx .notes,#fx .down div{will-change:transform}
html.touch,html.touch body{overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
html.touch #ver{left:calc(env(safe-area-inset-left) + 2px)!important;bottom:calc(env(safe-area-inset-bottom) + 1px)!important}
#lobby .pwa{position:absolute;left:50%;transform:translateX(-50%);top:6px;z-index:3;height:18px;display:flex;align-items:center;gap:6px;background:#ffe066;color:#000;font:bold 11px sans-serif;padding:0 2px 0 8px;border-radius:3px}
#lobby .pwa button{border:0;background:none;font:bold 14px/1 sans-serif;padding:0 6px;color:#000}
#fx #lobby{position:absolute;inset:0;display:none;overflow:clip;pointer-events:auto;background:radial-gradient(ellipse at 70% 40%,#3a2f5a,#111 70%);color:#fff;font:calc(var(--z) * 6.5px) sans-serif}
#lobby .tachie{position:absolute;right:50%;transform:translateX(50%);pointer-events:none} /* 大きさ・位置は身長で決まる（tachieFit）。選択の操作では変えない */
#lobby .crate{position:absolute;pointer-events:none;display:none}
#lobby .ttl{position:absolute;left:2%;top:2%;font:900 calc(var(--z) * 12px) sans-serif;color:#ffe066;-webkit-text-stroke:calc(var(--z) * .5px) #000;text-shadow:0 0 calc(var(--z) * 3px) #000}
#lobby .info{position:absolute;left:2%;top:11%;background:#000a;border-radius:calc(var(--z) * 3px);padding:calc(var(--z) * 3px) calc(var(--z) * 5px)}
#lobby .info .nm{font:900 calc(var(--z) * 11px) sans-serif}
#lobby .info .role{color:#ddd;margin-bottom:calc(var(--z) * 2px)}
#lobby .info{width:calc(var(--z) * 136px)}
#lobby .sk{margin-top:calc(var(--z) * 2px);line-height:1.35;white-space:normal}
#lobby .sk b{color:#ffe066}
#lobby .sk p{margin:0}
#lobby .sk .pv{color:#9fe8ff}
#lobby .st{display:flex;align-items:center;gap:calc(var(--z) * 3px);height:calc(var(--z) * 8px)}
#lobby .st b{width:calc(var(--z) * 54px);font-weight:bold;white-space:nowrap;overflow:hidden}
#lobby .st i{display:inline-block;width:calc(var(--z) * 11px);height:calc(var(--z) * 4px);margin-right:1px;background:var(--c);border-radius:1px}
#lobby .selbar{position:absolute;left:0;right:0;bottom:0;height:46%;background:linear-gradient(transparent,#000d 18%);transition:transform .35s;z-index:1}
#lobby:not(.browse) .selbar{transform:translateY(105%)}
#lobby .cards{display:flex;gap:calc(var(--z) * 2px);height:100%;box-sizing:border-box;padding:calc(var(--z) * 10px) calc(var(--z) * 4px) calc(var(--z) * 4px);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;cursor:grab}
#lobby .cards::-webkit-scrollbar{display:none}
#lobby .card{flex:0 0 calc(var(--z) * ${CARD_W}px);min-width:0;display:flex;flex-direction:column;cursor:pointer;border:calc(var(--z) * 1px) solid #fff4;border-radius:calc(var(--z) * 2px);background:#fff1;text-align:center;font-size:calc(var(--z) * 5.5px);white-space:nowrap;overflow:hidden}
#lobby .card img{flex:1 1 0;min-height:0;width:100%;object-fit:cover;object-position:top}
#lobby .card.mine{border-color:#ffd700;background:#ffd70033}
#lobby .rcol{position:absolute;right:2%;top:2%;width:22%;display:flex;flex-direction:column;align-items:flex-end;gap:calc(var(--z) * 4px);z-index:2} /* 右上: 組の一覧、その下に設定のボタン */
#lobby #roster{box-sizing:border-box;width:100%;background:#000a;border-radius:calc(var(--z) * 3px);padding:calc(var(--z) * 2px) calc(var(--z) * 4px);line-height:1.35;z-index:2}
#lobby #roster .tm b{font-size:calc(var(--z) * 7px)}
#lobby #roster .row{display:flex;justify-content:space-between;gap:calc(var(--z) * 3px);white-space:nowrap}
#lobby #roster .row em{font-style:normal;font-weight:bold;flex:none}
#lobby #roster .row .pn{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
#lobby #roster .row .pc{flex:none}
#lobby #roster .row.self .pn{color:#ffe066} /* .me は HUD の自分の情報パネル（#fx .me）と重なるので使わない */
#lobby #roster .foe{color:#aaa;font-size:calc(var(--z) * 5.5px);margin-top:calc(var(--z) * 2px)}
#lobby #roster button{font-size:calc(var(--z) * 5.5px);pointer-events:auto}
#lobby button.big{position:absolute;z-index:2;border:0;cursor:pointer;font:900 calc(var(--z) * 13px) sans-serif;color:#fff;border-radius:calc(var(--z) * 6px);padding:calc(var(--z) * 3px) calc(var(--z) * 14px)}
#lobby #okbtn{display:none;left:50%;bottom:5%;transform:translateX(-50%);font-size:calc(var(--z) * 18px);padding:calc(var(--z) * 4px) calc(var(--z) * 30px);background:linear-gradient(#ff9a3c,#e8541e);box-shadow:0 calc(var(--z) * 2px) 0 #8a2a00;-webkit-text-stroke:calc(var(--z) * .4px) #6a1a00}
#lobby:not(.browse) #okbtn{display:block}
#lobby.sortie #okbtn{font-size:calc(var(--z) * 18px);padding:calc(var(--z) * 4px) calc(var(--z) * 30px);background:linear-gradient(135deg,#ffe14a,#ff7a3c 55%,#ff3c8a);box-shadow:none;-webkit-text-stroke:calc(var(--z) * .5px) #5a0a20;animation:startpulse 1.2s ease-in-out infinite}
/* 出撃ボタンの光: 影＋光（小・橙）と影＋光（大・黄）の2枚をボタンの後ろに置き、透明度で入れ替える（box-shadow を毎フレーム描き直さない: render_policy 5）。両端は以前の box-shadow の点滅と同じ */
#lobby.sortie #okbtn::before,#lobby.sortie #okbtn::after{content:'';position:absolute;inset:0;border-radius:inherit;z-index:-1;pointer-events:none;animation:1.2s ease-in-out infinite}
#lobby.sortie #okbtn::before{box-shadow:0 calc(var(--z) * 2.5px) 0 #8a1a3a,0 0 calc(var(--z) * 6px) #ff7a3c;animation-name:startglowA}
#lobby.sortie #okbtn::after{box-shadow:0 calc(var(--z) * 2.5px) 0 #8a1a3a,0 0 calc(var(--z) * 16px) #ffd04a;animation-name:startglowB}
#lobby.go #okbtn{background:#555;box-shadow:none;cursor:default;-webkit-text-stroke:0}
#lobby #backsel{display:none;left:2%;bottom:4%;font-size:calc(var(--z) * 18px);padding:calc(var(--z) * 4px) calc(var(--z) * 12px);background:#000a;border:calc(var(--z) * 1px) solid #fff8}
#lobby:not(.browse) #backsel{display:block}
#lobby .grace{display:none;position:absolute;left:50%;top:20%;transform:translateX(-50%);z-index:3;background:#000c;border:calc(var(--z) * 1px) solid #ffe066;border-radius:calc(var(--z) * 4px);padding:calc(var(--z) * 2px) calc(var(--z) * 8px);font:900 calc(var(--z) * 10px) sans-serif;color:#ffe066;white-space:nowrap}

@keyframes startpulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}
@keyframes startglowA{0%,100%{opacity:1}50%{opacity:0}}
@keyframes startglowB{0%,100%{opacity:0}50%{opacity:1}}
#fx .skill .seal{display:none;position:absolute;left:-10%;right:-10%;top:38%;background:#b00d;color:#fff;font:900 calc(var(--z) * 8px)/1.3 sans-serif;transform:rotate(-14deg);z-index:2}
#fx .skill.sealed::after{content:'×';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ff3030cc;font:900 calc(var(--z) * 40px)/1 sans-serif;z-index:1}
#fx .skill.sealed .seal{display:block}
#rotate{display:none;position:fixed;inset:0;z-index:10;background:#111;color:#fff;font:bold 20px sans-serif;align-items:center;justify-content:center}
@media (orientation:portrait){html.touch #rotate{display:flex}}
#fx .tb{display:block;position:absolute;pointer-events:auto;touch-action:none;cursor:pointer;width:calc(var(--z) * 36px);height:calc(var(--z) * 36px);border-radius:50%;border:2px solid #fff;background:#335c;color:#fff;font:bold calc(var(--z) * 7px)/1.1 sans-serif;padding:0}
#fx .tb:active{background:#88a}
#fx .rc{right:calc(var(--z) * 8px);bottom:calc(var(--z) * 88px)}
#fx .aimb{right:calc(var(--z) * 62px);bottom:calc(var(--z) * 88px)}
#fx .spec{position:absolute;right:calc(var(--z) * 8px);bottom:calc(var(--z) * 8px);display:none;flex-direction:column;align-items:stretch;gap:calc(var(--z) * 3px);pointer-events:auto}
#fx .spec button{font:bold max(12px,calc(var(--z) * 7px)) sans-serif;padding:.35em .8em;border-radius:4px;border:2px solid #fff;background:#1a2a5acc;color:#fff;cursor:pointer}
#fx .spec button.on{background:#7a5a00;border-color:#ffe066}
#fx .aband{position:absolute;left:0;right:0;top:22%;text-align:center;display:none;font:bold max(14px,calc(var(--z) * 9px)) sans-serif;color:#fff;text-shadow:0 0 4px #000,0 0 4px #000}
html.touch #fx .skill span:last-child{display:none}
#fx .skill{width:calc(var(--z) * 76px);height:calc(var(--z) * 76px);font-size:max(11px,calc(var(--z) * 10px));line-height:1.15;text-shadow:0 1px 2px #000;left:auto;right:calc(var(--z) * 8px);bottom:calc(var(--z) * 6px);transform:none;pointer-events:auto;touch-action:none;cursor:pointer}
#fx .tb{width:calc(var(--z) * 48px);height:calc(var(--z) * 48px);font-size:max(12px,calc(var(--z) * 10px));background:#1a2a5a;text-shadow:0 1px 2px #000}
#fx .tk,#fx .roster{zoom:${C.HUD_SCALE}}
#fx .me{position:absolute;left:1.2%;top:0;width:calc(var(--z) * 84px);box-sizing:border-box;padding:calc(var(--z) * 3px) calc(var(--z) * 5px);background:#000a;border-radius:calc(var(--z) * 3px);color:#fff;display:none;pointer-events:none}
#fx .me.wanted{outline:calc(var(--z) * 1.5px) solid #ff3030}
#fx .me .wt{display:none;position:absolute;left:0;right:0;bottom:100%;margin-bottom:calc(var(--z) * 2px);text-align:center;font:900 calc(var(--z) * 9px) sans-serif;color:#ff3030;letter-spacing:.1em;text-shadow:0 0 3px #000}
#fx .me.wanted .wt{display:block}
#fx .me .hp{font:900 calc(var(--z) * 20px)/1 sans-serif;text-shadow:0 1px 2px #000}
#fx .me .bd{position:relative;margin-top:calc(var(--z) * 3px);height:calc(var(--z) * 6px);background:#2a1a3a;outline:1px solid #b070ff}
#fx .me .bd i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#7a3cff,#c060ff)}
#fx .me .bd span{position:absolute;left:calc(var(--z) * 2px);top:50%;transform:translateY(-50%);font:bold calc(var(--z) * 5px) sans-serif;text-shadow:0 0 2px #000}
#fx .me .nm{margin-top:calc(var(--z) * 3px);font:bold calc(var(--z) * 7px) sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fx .mm{position:absolute;right:calc(var(--z) * 4px);top:calc(var(--z) * ${MM_TOP}px);width:calc(var(--z) * ${MAP.width * MINI}px);height:calc(var(--z) * ${MAP.height * MINI}px);pointer-events:auto;touch-action:none}
#fx .killer{position:absolute;left:${50 + C.KO_CUTIN_GAP / 2}%;transform:translateX(-50%);bottom:22%;height:62%;display:none}
#fx .killer img{height:100%}
#fx .kohow,#fx .cut .how{position:absolute;right:0;top:4%;white-space:nowrap;color:#fff;font:900 calc(var(--z) * 14px) sans-serif;-webkit-text-stroke:calc(var(--z) * .5px) #000;text-shadow:0 0 4px #000,0 0 4px #000}
#fx .cut .how{right:auto;left:50%;top:auto;bottom:16%;transform:translateX(-50%);text-align:center;color:#ffe066}
#fx .kohow{right:auto;left:50%;top:auto;bottom:${62 * 0.16}%;transform:translateX(-50%);white-space:pre;text-align:center;display:none} /* KOされた時の文字: 自分が撃破した時（.cut .how）と同じ画面中央の位置（立ち絵の下端より下） */
#fx .cut .how b{display:block;font-size:calc(var(--z) * 22px);color:#ff5040}
#fx .cut .how span{display:block}
#fx.finale > :not(.fin):not(.cmsub){display:none!important}
#fx .fin{position:absolute;inset:0;display:none;pointer-events:none}
#fx.finale .fin{display:block}
#fx .fin .tu,#fx .fin .wn{position:absolute;left:0;right:0;top:36%;text-align:center;font:900 calc(var(--z) * 40px) sans-serif;-webkit-text-stroke:calc(var(--z) * 1.5px) #000;text-shadow:0 0 10px #000;animation:pop .3s ease-out}
#fx .fin .tu{color:#fff}
#fx .fin .kt{position:absolute;bottom:0;height:78%;animation:fadein .3s}
#fx .fin .kt.k0{left:4%}
#fx .fin .kt.k1{right:4%}
#fx .fin .kt img{height:100%}
#fx .fin .kn{position:absolute;bottom:14%;white-space:nowrap;color:#ffe066;font:900 calc(var(--z) * 18px) sans-serif;-webkit-text-stroke:calc(var(--z) * .6px) #000;text-shadow:0 0 6px #000;animation:pop .3s ease-out}
#fx .fin .kn small{display:block;font-size:calc(var(--z) * 9px);color:#fff}
#fx .fin .kn.k0{left:6%}
#fx .fin .kn.k1{right:6%;text-align:right}
#fx .lbl{position:absolute;left:0;top:0;font:bold calc(var(--z) * 5.5px) sans-serif;white-space:nowrap;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000}
#fx .lbl.home{font-size:calc(var(--z) * 9px);opacity:.9}
#fx .skill{position:absolute;border:2px solid #fff;border-radius:6px;background:#335;color:#fff;font:bold calc(var(--z) * 6px)/1.2 sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden}
#fx .skill{isolation:isolate}
#fx .skill i{position:absolute;inset:0;overflow:hidden} /* CT の暗い扇形（上から時計回り）: 右半分・左半分の窓の中で、半分だけ暗い大きな板を rotate で回す（transform だけ。conic-gradient を毎フレーム描き直さない。dom1） */
#fx .skill i u{position:absolute;top:0;bottom:0;overflow:hidden}#fx .skill i u.a{left:50%;right:0}#fx .skill i u.b{left:0;right:50%}
#fx .skill i em{position:absolute;top:-100%;width:300%;height:300%;transform:rotate(0deg);will-change:transform}
#fx .skill i u.a em{left:-150%;background:linear-gradient(to right,#000b 50%,transparent 50%)}#fx .skill i u.b em{left:-50%;background:linear-gradient(to right,transparent 50%,#000b 50%)}
#fx .skill b,#fx .skill span{position:relative}
#fx .skill s{display:none;position:absolute;left:0;right:0;bottom:0;height:var(--g);background:#ffb020aa} /* そらのチャージのゲージ（下から溜まる。100%超えは色が変わる）。CT の暗い扇形はこの上に重なる */
#fx .skill s.over{background:linear-gradient(#ff4020cc,#ffb020aa)}
#fx .skill small{display:none;position:relative;font:900 calc(var(--z) * 7px)/1.1 sans-serif;color:#fff;-webkit-text-stroke:calc(var(--z) * .3px) #000}
#fx .skill.charge s,#fx .skill.charge small{display:block}
#fx .skill b{font-size:calc(var(--z) * 11px)}
html.touch #fx .skill b{font-size:max(13px,calc(var(--z) * 11px))}
#fx .roster{position:absolute;top:5.8%;display:flex;flex-direction:column;align-items:flex-start;gap:calc(var(--z) * 2px)}
#fx .roster.r0{left:1.2%}
#fx .roster.r1{right:1.2%}
#fx .buffs{position:absolute;left:1.2%;display:flex;flex-direction:column;align-items:flex-start;gap:calc(var(--z) * 1.5px);pointer-events:none}
#fx .buffs span{font:bold calc(var(--z) * 6px) sans-serif;color:#fff;padding:calc(var(--z) * .5px) calc(var(--z) * 3px);border-radius:calc(var(--z) * 2px);text-shadow:0 0 2px #000;white-space:nowrap}
#fx .buffs .good{background:#1f7a3acc;border:1px solid #6fe08f}
#fx .buffs .bad{background:#8a2020cc;border:1px solid #ff8080}
#fx .roster .rw{display:flex;gap:calc(var(--z) * 2px)}
#fx .mem{position:relative;display:flex}
#fx .mem .pt{position:absolute;right:-2px;top:-3px;font:900 calc(var(--z) * 5.5px)/1 sans-serif;font-style:normal;color:#ffe066;background:#000c;padding:0 calc(var(--z) * 1px);border-radius:2px;white-space:nowrap} /* 強さの札（パワーアップ 1〜MAX・アシスト★） */
#fx .mem .hp{position:absolute;left:2px;right:2px;bottom:2px;height:calc(var(--z) * 2.5px);background:#000b}
#fx .mem .hp i{position:absolute;left:0;top:0;bottom:0;right:0;background:var(--c);transform-origin:0 50%} /* 長さは transform（scaleX）で変える（レイアウトを起こさない: render_policy 5） */
#fx .mem .rs{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:900 calc(var(--z) * 9px) sans-serif;text-shadow:0 0 2px #000,0 0 2px #000}
#fx .ic{width:calc(var(--z) * 18px);height:calc(var(--z) * 18px);background:#000a no-repeat calc(var(--z) * -7px) calc(var(--z) * -3px)/calc(var(--z) * 32px) calc(var(--z) * 42px);image-rendering:pixelated;border:1px solid var(--c);border-radius:2px;flex:none}
#fx .ic.dead{filter:grayscale(1) brightness(.35)}
#fx .kills{position:absolute;top:27%;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:1px}
#fx .kills div{display:flex;align-items:center;gap:calc(var(--z) * 3px);background:#0008;padding:1px 4px;color:#fff;font:bold calc(var(--z) * 7px) sans-serif}
#fx .kills .ic{width:calc(var(--z) * 14px);height:calc(var(--z) * 14px);background-position:calc(var(--z) * -9px) calc(var(--z) * -4px)}
#fx .intro{position:absolute;inset:0;display:none;overflow:hidden}
#fx .intro .line{position:absolute;left:0;right:0;top:18%;display:flex;justify-content:center;gap:5%;animation:fadein .4s}
#fx .intro .line div{text-align:center;color:#fff;font:bold calc(var(--z) * 9px) sans-serif}
#fx .intro .line img{height:calc(var(--z) * 126px);image-rendering:pixelated;display:block;margin:0 auto calc(var(--z) * 4px)}
#fx .intro .ttl{position:absolute;left:0;right:0;top:6%;text-align:center;font:900 calc(var(--z) * 16px) sans-serif;color:var(--c);text-shadow:0 0 6px #000}
#fx .intro .stripe{position:absolute;left:0;right:0;top:30%;height:40%;background:linear-gradient(90deg,transparent,var(--c) 25%,var(--c) 75%,transparent);opacity:.35;animation:fadein .3s}
#fx .intro .tc{position:absolute;bottom:0;left:8%;height:95%;animation:slidein .35s ease-out}
#fx .intro .logo{position:absolute;right:7%;top:40%;font:900 calc(var(--z) * 30px) sans-serif;color:#fff;-webkit-text-stroke:calc(var(--z) * 1.2px) var(--c);text-shadow:0 0 calc(var(--z) * 6px) var(--c);transform:skewX(-8deg);animation:logoin .4s ease-out}
#fx .banner{position:absolute;left:0;right:0;top:31%;text-align:center;display:none}
#fx .banner b{display:inline-block;font:900 calc(var(--z) * 40px) sans-serif;color:var(--c);-webkit-text-stroke:calc(var(--z) * 1.5px) #000;text-shadow:0 0 10px #000;animation:pop .3s ease-out}
#fx .banner small{display:block;font:bold calc(var(--z) * 10px) sans-serif;color:#fff;text-shadow:0 0 4px #000,0 0 4px #000}
#fx .rsbtn{position:absolute;left:50%;top:22%;transform:translateX(-50%);display:none;font:bold calc(var(--z) * 9px) sans-serif;padding:.3em 1.4em;border-radius:4px;border:2px solid #ffe066;background:#335;color:#fff;cursor:pointer;pointer-events:auto} /* 試合結果画面を開く（勝敗バナーの上。result.ts） */
#fx .back{position:absolute;left:50%;top:58%;transform:translateX(-50%);display:none;font:bold calc(var(--z) * 9px) sans-serif;padding:.3em 1.4em;border-radius:4px;border:2px solid #fff;background:#335;color:#fff;cursor:pointer;pointer-events:auto}
#fx .back:disabled{background:#555;cursor:default}
#fx .tk{position:absolute;top:6.4%;left:50%;transform:translateX(-50%);display:flex;gap:calc(var(--z) * 8px)}
#fx .tk .side{display:flex;flex-direction:column;align-items:center;gap:calc(var(--z) * 1.5px)}
#fx .tk .tg{position:relative;width:calc(var(--z) * 54px);height:calc(var(--z) * 5px);background:#000b;outline:1px solid var(--c)}
#fx .tk .tg i{position:absolute;left:0;top:0;bottom:0;right:0;background:var(--c);transform-origin:0 50%}
#fx .tk .tv{color:#fff;font:bold calc(var(--z) * 5.5px) sans-serif;text-shadow:0 0 2px #000,0 0 2px #000}
#fx .scut{position:absolute;left:0;right:0;top:40%;padding:.4em 0;text-align:center;background:linear-gradient(90deg,transparent,var(--c) 30%,var(--c) 70%,transparent);animation:cutfade var(--d) linear forwards}
#fx .scut b{display:block;font:900 calc(var(--z) * 22px) sans-serif;color:#ffd700;-webkit-text-stroke:calc(var(--z) * 1px) #000;text-shadow:0 0 8px #000;animation:pop .3s ease-out}
#fx .scut span{display:block;font:bold calc(var(--z) * 9px) sans-serif;color:#fff;text-shadow:0 0 4px #000,0 0 4px #000}
#fx .tk .rf{margin-left:.5em;color:#9fe8ff}
#fx .tk .mh{zoom:calc(var(--z) * .85)}
#fx .tk .mfx-row{display:flex;justify-content:center;align-items:baseline;gap:.4em;white-space:nowrap} /* 文字が長いと組の HUD の幅が広がる（隣の組と重ならない。今までの大当たり N連・モードの文字と同じ） */
#fx .tk .mfx-row .mfx-label{position:static;transform:none}
#fx .mfxl{position:absolute;left:0;top:0;width:${C.VIEW_W}px;height:${C.VIEW_H}px;zoom:var(--z);pointer-events:none} /* モダンのスロットの演出・お知らせ（論理解像度。slot_modern_fx） */
#fx .fever{position:absolute;right:1.2%;top:18%;display:none;font:900 calc(var(--z) * 12px) sans-serif;color:#ffd700;-webkit-text-stroke:calc(var(--z) * .5px) #000;text-shadow:0 0 calc(var(--z) * 4px) #f60;white-space:nowrap;animation:pop .3s ease-out}
#fx .lbl.introlbl{font:900 calc(var(--z) * 12px) sans-serif;color:#ffe066;-webkit-text-stroke:calc(var(--z) * .6px) #000}
#fx .lbl.wanted{color:#ff4040;font-size:calc(var(--z) * 7px)}
#fx .lbl.pick{color:#ffe066;font-size:calc(var(--z) * 6px)}
@keyframes fadein{0%{opacity:0}100%{opacity:1}}
@keyframes slidein{0%{transform:translateX(-40%);opacity:0}100%{transform:none;opacity:1}}
@keyframes logoin{0%{transform:translateX(30%) skewX(-8deg);opacity:0}100%{transform:skewX(-8deg);opacity:1}}
@keyframes pop{0%{transform:scale(1.8);opacity:0}100%{transform:scale(1);opacity:1}}
#fx .cmsub{position:absolute;left:50%;bottom:calc(var(--z) * 6px);transform:translateX(-50%);max-width:56%;display:none;z-index:4;pointer-events:none;background:#000b;color:#fff;font:bold max(11px,calc(var(--z) * 8px))/1.35 sans-serif;padding:.25em .7em;border-radius:4px;text-align:center}
#lobby.practice #sidebtn{display:none}
/* 設定のボタン（実況・立ち絵）: 丸い形・半透明・記号つき。画面遷移の「タイトルへ」（角のある濃い青の板・矢印つき）と見分ける */
#lobby .opts{display:flex;gap:calc(var(--z) * 4px);width:max-content}
#lobby .opt{pointer-events:auto;cursor:pointer;font:bold calc(var(--z) * 10.5px) sans-serif;padding:calc(var(--z) * 3px) calc(var(--z) * 9px);min-height:44px;border-radius:999px;border:calc(var(--z) * 1px) solid #fffa;background:#ffffff26;color:#fff}
#lobby .opt.off{color:#fff8}
#lobby #cmbtn::before,#lobby #cvbtn::before{content:'♪ '}#lobby #sidebtn::before{content:'⇄ '}
#lobby #totitle{left:2%;top:calc(2% + var(--z) * 17px);transition:transform .35s;font-size:calc(var(--z) * 10.5px);padding:0 calc(var(--z) * 9px);height:max(44px, var(--z) * 20px);box-sizing:border-box;border-radius:calc(var(--z) * 2px);background:#1e2f66;border:calc(var(--z) * 1px) solid #6f8fe0}
#lobby #totitle::before{content:'◀ '}
#lobby:not(.browse) #totitle{transform:translateY(calc(-100% - var(--z) * 40px))} /* キャラを選んだ後は画面の外へ（立ち絵と被るため） */
#lobby.browse .info{top:calc(2% + var(--z) * 17px + max(44px, var(--z) * 20px) + var(--z) * 2px)} /* 選んでいる間は「タイトルへ」（左上のゲーム名の下）の下へ。立ち絵の頭と被らないように（tachie2） */
#fx .totitle{position:absolute;left:50%;top:66%;transform:translateX(-50%);display:none;font:bold calc(var(--z) * 7px) sans-serif;padding:.3em 1.2em;border-radius:4px;border:1px solid #fff8;background:#000a;color:#fff;cursor:pointer;pointer-events:auto}
`, (q) => q.includes('#fx') && !q.includes('#lobby')); // 戦闘画面（#fx）の文字だけ UI_FONT_SCALE（選択画面 #lobby は対象外）
document.head.appendChild(css);
{ const st = document.createElement('style'); st.id = 'mfx-css'; st.textContent = ufCss(MFX_CSS); document.head.append(st); } // スロットの演出の CSS（slot_modern_fx）を戦闘画面の文字の大きさで先に置く（ModernFx は同じ id があれば置かない。slot.html は元のまま）
const mapEl = document.createElement('div'); // マップに付く DOM（札・頭上の一時表示）の層。#fx の最初に置き、HUD などほかの表示より必ず後ろにする
mapEl.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
fx.appendChild(mapEl);
const down = document.createElement('div');
down.className = 'down';
down.innerHTML = '<img><div></div>';
fx.appendChild(down);
const finEl = document.createElement('div'); // 決着演出（時間切れ・止めの立ち絵と名前・WIN）。演出中は fx のほかの表示を隠す（#fx.finale）
finEl.className = 'fin';
fx.appendChild(finEl);
const killer = document.createElement('div'); // KOされた時: ラストヒットを取ったキャラの立ち絵と、誰に何で倒されたか
killer.className = 'killer';
killer.innerHTML = '<img>';
fx.appendChild(killer);
const kohow = document.createElement('div'); // KOされた時: 誰に何で倒されたか（画面中央）
kohow.className = 'kohow';
fx.appendChild(kohow);
// HUD（DOM。文字をドットと一緒に縮小しない）
const hudEl = document.createElement('div');
hudEl.innerHTML = '<div class="bar b0"><i></i></div><div class="timer"></div><div class="bar b1"><i></i></div><div class="tk"><div class="side s0"></div><div class="side s1"></div></div><div class="mfxl"></div><div class="fever"></div><div class="roster r0"></div><div class="roster r1"></div><div class="buffs"></div><div class="kills"></div><div id="info"></div><div class="notes"></div><div class="skill"><s></s><i><u class="a"><em></em></u><u class="b"><em></em></u></i><span class="sn"></span><b></b><small></small><em class="seal">封印</em><span>R</span></div><div class="banner"></div><div class="intro"></div><button class="back"></button><button class="rsbtn">リザルト</button><button class="totitle">タイトルへ</button><button class="tb rc">帰還</button><button class="tb aimb"></button><div class="mm"></div><div class="me"><div class="wt">WANTED</div><div class="hp"><b></b></div><div class="bd"><i></i><span></span></div><div class="nm"></div></div><div class="spec"><button data-v="all">全体</button><button data-v="focus">実況</button><button data-v="0">' + TEAM_NAME[0] + '</button><button data-v="1">' + TEAM_NAME[1] + '</button></div><div class="aband"></div>';
fx.appendChild(hudEl);
// HUD の要素。参照は一度だけ取って使い回す（毎フレーム querySelector しない）。中身ごと作り直されて DOM から外れていたら取り直す
const $cache = new Map<string, HTMLElement>();
const $ = (q: string) => { let e = $cache.get(q); if (!e?.isConnected) { e = hudEl.querySelector<HTMLElement>(q)!; $cache.set(q, e); } return e; };
// 毎フレームの style の書き込みは、最後に書いた値と違う時だけ書く（render_policy 5）。ほかの場所から同じ style を書く要素には使わない
const styled = new WeakMap<HTMLElement, Record<string, string>>();
const setCss = (el: HTMLElement, k: string, v: string) => { let m = styled.get(el); if (!m) styled.set(el, (m = {})); if (m[k] !== v) { m[k] = v; el.style.setProperty(k, v); } };
// 練習パネル（handoff_practice1。練習の部屋の試合中だけ）: タイマーの位置のボタンで開閉
// 左端の縦長のタブ「練習」と、左から出る引き出し（fb1124）。引き出しの中は縦1列。タブは引き出しの右端に付いたまま
hudEl.insertAdjacentHTML('beforeend', `<div class="prw"><div class="prp">
<b>相手</b><select class="pfoe">${PICKABLE.map((k) => `<option value="${k}">${CHARS[k].name}</option>`).join('')}</select>
<b>相手の動き</b><button data-mode="stand">棒立ち</button><button data-mode="passive">攻撃なし</button><button data-mode="bot">通常Bot</button>
<b>パワーアップ 自分</b><div class="r"><button data-pw="me" data-d="-1">−</button><span class="lv lv0"></span><button data-pw="me" data-d="1">＋</button></div>
<b>パワーアップ 相手</b><div class="r"><button data-pw="foe" data-d="-1">−</button><span class="lv lv1"></span><button data-pw="foe" data-d="1">＋</button></div>
<b>アシスト</b><select class="pas">${Object.entries(C.ASSIST.units).map(([k, u]) => `<option value="${k}">${u.name}</option>`).join('')}</select><select class="pat">${C.ASSIST_TAGS.map((t, i) => `<option value="${i}">${t}</option>`).join('')}</select><div class="r"><button data-as="mine">自陣に</button><button data-as="foe">敵陣に</button></div>
<div class="r end"><button class="pboss">大将を全快</button><button class="pback">選択画面へ</button></div></div><button class="prbtn">練習</button></div>`);
const setText = (el: HTMLElement, t: string) => { if (el.textContent !== t) el.textContent = t; }; // 同じ文字なら DOM に書かない
// 実況（音声＋字幕）。音声の読み込みは待たない（失敗しても実況なしで続行）
const commentary = new Commentary(fx);
commentary.load();
// スマホ（指で操作する端末）: タッチUIを出し、ブラウザのスクロール・拡大・長押しメニュー・選択を止める
const TOUCH = matchMedia('(pointer: coarse)').matches;
const AIM_SHORT: Record<string, string> = { nearest: '近い', lowhp: 'HP', boss: '大将', courier: 'コバコ' };
if (TOUCH) {
  document.documentElement.classList.add('touch');
  for (const t of ['gesturestart', 'dblclick', 'contextmenu']) document.addEventListener(t, (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (!(e.target as Element).closest?.('#fx .prp, #title')) e.preventDefault(); }, { passive: false }); // キャラ選択も画面内に収めるのでスクロールさせない。練習パネルの中と、タイトル画面（クレジット・更新情報のポップアップを含む）は縦にスクロールできる
}
const rotate = document.createElement('div');
rotate.id = 'rotate';
rotate.textContent = '横にして遊んでね';
document.body.appendChild(rotate);

class GameScene extends Phaser.Scene {
  room!: Room;
  snap: any = null;
  snapAt = 0; // スナップショットを受信した時刻(ms)
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  units = new Map<string, Unit>();
  g!: Phaser.GameObjects.Graphics;
  feet!: Phaser.GameObjects.Graphics;
  fxG!: Phaser.GameObjects.Graphics;
  visG!: Phaser.GameObjects.Graphics;
  fog!: Phaser.GameObjects.Rectangle;
  ui!: Phaser.GameObjects.Graphics;
  me = { x: 0, y: 0, init: false };
  face = 0; // 自キャラの向き（直近の入力方向）
  pred = new Predictor(); // 自キャラの予測（入力番号でサーバーと照合）
  measure: ClientMeasure | null = null;
  measureId = 0;
  measureSent = false;
  measureFrameAt: number | null = null;
  pingAt = -Infinity;
  pingPending: number | null = null;
  sweatFx: { target: string; sp: Phaser.GameObjects.Image; born: number }[] = [];
  tags = new Map<string, Phaser.GameObjects.Image>(); tagSeen = new Set<string>(); // 頭上の強さの札（キャラの id ごと）と、このフレームに置いた札
  shotData = new Map<number, any>(); // 弾の id → 最後に届いた弾の情報（seen: そのスナップショットの時刻）
  kunais = new Map<number, Phaser.GameObjects.Image>(); kunaiSeen = new Set<number>(); // クナイの弾の絵（弾の id ごと）と、このフレームに見えた弾
  finishMeasure() {
    if (!this.measure || this.measureSent || !this.room?.connection.isOpen) return;
    this.measureSent = true;
    sendC2S(this.room, 'netReport', { id: this.measureId, value: this.measure.report() });
    this.interp.measure = null;
  }
  interp = new Interp(); // 他キャラ・大将の補間
  acc = 0; // 次の入力までの経過時間(ms)
  lobbyKey = '';
  selMode: 'browse' | 'confirm' | 'sortie' | 'go' = 'browse'; // 待機画面: browse=選択バー、confirm=OK?、sortie=出撃ボタン（未出撃）、go=出撃済み
  selChar = ''; // 待機画面で表示している（今選んでいる）キャラ
  pickTimer = 0; // 表示キャラをサーバーへ送る予約
  mmCam: { x: number; y: number } | null = null; // ミニマップを押している間のカメラの位置（ワールド座標）
  mouseAt: { x: number; y: number } | null = null; // マウスの位置（画面の clientX/Y）
  aimFrom: { mouse: { x: number; y: number } | null; touch: { id: number; x: number; y: number; nx: number; ny: number } | null } | null = null; // 技の矢印を出した時のマウスの位置・技ボタンに触れた指（nx,ny: 今の位置）
  mmHeld = false; // 直前のフレームでミニマップの視点だった（離したら即座に自キャラへ戻す）
  koedBy: { kc: string | null; how: string } | null = null; // 自分を倒した相手と手段
  pops: { el: HTMLElement; x: number; y: number; until: number }[] = [];
  finKey = ''; // 決着演出の表示中の段（変わったときだけ作り直す）
  centerBar: (() => void) | null = null; // 選択バーを真ん中の組へ（最初に表示した時だけ）
  hits: { x: number; y: number; ratio: number; big: boolean; t0: number; seed: number }[] = []; // 被ダメージの着弾エフェクト（中・大）
  labels = new Map<string, HTMLElement>();
  slotHtml = ['', ''];
  mfx: (ModernFx | null)[] = [null, null]; mfxKey = ''; mfxIdleAt = [0, 0]; mfxView = ['', '']; mfxMask = ''; mfxMaskVis = ''; mfxSnap: any = null; mfxMyTeam = -1; mfxKeyNow = ''; mfxTm: any[] = [null, null]; mfxVis: { raw: { x: number; y: number }[][]; ver: number; wx: number; wy: number; svg: string } | null = null; mfxMine = -1; // モダンのスロット（mfxMask・mfxMaskVis: 最後に渡した演出の範囲。mfxVis: 視界の SVG の使い回し）（陣営ごと。演出は自陣だけ画面に出す）
  lastSeenBoss: { x: number; y: number } | null = null; // 敵の大将を最後に見た位置
  ctl = new Controls((t, m) => { if (this.room) sendC2S(this.room, t, (t === 'qdown' ? { seq: this.pred.seq } : m) as never); }); // キーボード・タッチの入力 → サーバーへ送るコマンド。帰還（qdown）には送り終えた移動入力の番号を付ける
  stickId: number | null = null; // 仮想スティックを動かしている指（Touch.identifier）
  stickAt = { x: 0, y: 0 }; // 仮想スティックの中心（触れた位置、画面のpx）
  hiddenAt = 0; // バックグラウンドに入った時刻(ms)
  visCache = new Map<string, Phaser.Math.Vector2[]>(); // 視界の使い回し（前フレームの分）
  visUsed = new Map<string, Phaser.Math.Vector2[]>(); // このフレームで使った分
  visPool: Phaser.Math.Vector2[][] = []; // 使わなくなった点の配列（作り直さずに再利用）
  visVer = -1;
  perf = new URLSearchParams(location.search).has('perf') ? { n: 0, ray: 0, rayMax: 0, frame: 0, frameMax: 0 } : null; // ?perf=1: 視界の計算・描画の時間を計る
  skillFx: SkillFx[] = [];
  fxQueue: any[] = []; // 受信した技のエフェクト（スナップショットごとに届く）
  // マップの絵（床・壁・家具。静的な層）。1枚のテクスチャ。壁が壊れたらその周りだけ描き直し、その矩形だけ GPU へ送る（mapSub。全体を毎回送ると重い）
  mapTex!: Phaser.Textures.CanvasTexture;
  mapSubCv = document.createElement('canvas'); // 部分転送の矩形を切り出す小さな canvas
  // 壁の割れ目（小破・中破）: マップの絵には描かず、壁のマスごとに Blitter の bob を重ねる（段階が変わったマスだけ足す・差し替える・消す）
  crackBl!: Phaser.GameObjects.Blitter;
  cracks = new Map<number, Phaser.GameObjects.Bob>(); // y * MAP.width + x → bob
  crackCull = [NaN, NaN, NaN]; // 画面外の割れ目を隠した時のカメラ（タイル単位の位置・ズーム）。変わった時だけ表示を切り替える
  mmSnap: any = null; mmMats: any[] = []; // ミニマップに出す資材（mmSnap を受信した時に判定）
  visDrawn: { ver: number; polys: { x: number; y: number }[][] } | null = null; // 今マスク（visG）に描いてある視界ポリゴン
  fxFit = FX_FIT_FRAMES; // #fx の位置を測り直す残りフレーム数（起動時・リサイズ・拡大率の変更の後）
  chips: Pics | null = null; // マップチップの素材（なければ単色）
  homeG!: Phaser.GameObjects.Graphics; // 大将の候補部屋の床に重ねる組の色
  miniTex!: Phaser.Textures.CanvasTexture;
  walls = C.WALLS; // 自キャラの移動予測に使う壁（壁破壊で変わる）
  seeWalls = C.SEE_WALLS; // 視界の壁（透過壁を除く。資材の表示）
  brokenN = 0;
  homes: { x: number; y: number; w: number; h: number }[][] = [[], []]; // この試合の自宅（大将の部屋）
  homesKey = '';
  result: any = null; // 試合結果画面のデータ（サーバーの 'result'。結果画面の間だけ持つ）
  resultPh = ''; resultAsked = false; // 前のフレームの phase（ended から離れた時に結果を捨てる）・ended の間に resultReq を送ったか
  prevPhase = ''; // 演出の切り替え検知用（直前のスナップショットの phase と残り時間）
  prevTimeLeft = Infinity;
  timed: { key: string; text: string; sub: string; color: string; until: number } | null = null; // 時間で消える大きな表示（GAME START・形勢・残り秒数）
  bannerKey = '';
  introKey = '';
  rosterHtml = ['', ''];
  lastPhase = ''; // 連戦（リザルト → 待機画面）の検知用
  backSent = false; // リザルトで「戻る」を押したか
  toTitle = false; // 「タイトルへ」を押した（部屋を出たらタイトル画面へ）
  practice = false; // 練習の部屋か（スナップショットの practice）
  introCam = false; // 開始演出でカメラを寄せているか
  introCut = ''; // 新開幕: 今映しているカット
  introBanner: [string, string] | null = null; // 新開幕: 画面中央の文字
  miniImg!: Phaser.GameObjects.Image;
  tileKinds: number[][] = []; // タイルの種類（0=外 1=床 2=壁）

  preload() {
    for (const k of DOT_KEYS) for (const f of DOT_FRAMES) this.load.image(`${k}_${f}`, `assets/gen/dot/${k}/${f}.png`);
    for (const [k, f] of DOT_EXTRA) this.load.image(`${k}_${f}`, `assets/gen/dot/${k}/${f}.png`); // 技の見た目用のコマ（client/skills）
    for (const [k, f] of Object.entries(CHIP_FILES)) this.load.image(`chip_${k}`, CHIP_DIR + f); // マップチップ（public/assets/mapchip/、管理外）
  }

  create() {
    for (const k of DOT_KEYS) {
      this.anims.create({ key: `${k}_walk`, frames: ['walk1', 'walk2'].map((f) => ({ key: `${k}_${f}` })), frameRate: 1000 / C.WALK_FRAME_MS, repeat: -1 }); // 歩きは walk1 ⇔ walk2 の交互
      this.anims.create({ key: `${k}_blink`, frames: ['half', 'close', 'half', 'idle'].map((f) => ({ key: `${k}_${f}` })), frameRate: 14 });
    }

    // マップ: チップ（mapchip/paint.ts）で1枚の絵に描く（静的な層。壁が壊れた時だけその周りを描き直す）。キャラ・弾・エフェクト・資材より下
    // 素材がなければ単色で描き、画面の隅に出す
    const chipKeys = Object.keys(CHIP_FILES) as (keyof typeof CHIP_FILES)[];
    this.chips = chipKeys.every((k) => this.textures.exists(`chip_${k}`)) ? (Object.fromEntries(chipKeys.map((k) => [k, this.textures.get(`chip_${k}`).getSourceImage()])) as Pics) : null;
    if (!this.chips) { const e = document.createElement('div'); e.textContent = 'マップチップの素材がない（public/assets/mapchip/）。単色で表示中'; e.style.cssText = 'position:absolute;left:4px;top:4px;color:#f88;font:12px sans-serif;background:#000a;padding:2px 6px;pointer-events:none'; fx.appendChild(e); }
    this.mapTex = this.textures.createCanvas('map', MAP.width * T, MAP.height * T)!;
    paintMap(this.mapTex.context, this.chips, tiles); this.mapTex.refresh();
    this.add.image(0, 0, 'map').setOrigin(0).setDepth(0);
    this.makeCrackTexture();
    this.crackBl = this.add.blitter(0, 0, CRACK_TEX).setDepth(0.6);
    this.homeG = this.add.graphics().setDepth(0.5);
    this.tileKinds = MAP.tiles.map((row) => [...row].map((c) => (c === '#' ? 2 : c === '.' ? 1 : 0))); // ミニマップ: 0=外 1=床 2=壁 3,4=自宅の床（陣営色）

    // ミニマップの下絵
    this.miniTex = this.textures.createCanvas('mini', Math.ceil(MAP.width * MINI), Math.ceil(MAP.height * MINI))!;
    this.paintMini();

    this.feet = this.add.graphics().setDepth(1);
    this.g = this.add.graphics().setDepth(2);
    this.fxG = this.add.graphics().setDepth(20);

    // 視界: 味方の視界ポリゴンの外を暗くする
    this.visG = this.make.graphics({}, false);
    const mask = this.visG.createGeometryMask();
    mask.setInvertAlpha(true);
    this.fog = this.add.rectangle(0, 0, C.VIEW_W, C.VIEW_H, 0x000000, 0.85).setOrigin(0).setScrollFactor(0).setDepth(50).setMask(mask);

    // HUD（文字以外: ミニマップ・矢印）
    this.ui = this.add.graphics().setScrollFactor(0).setDepth(101);
    this.miniImg = this.add.image(C.VIEW_W - 4, MM_TOP, 'mini').setOrigin(1, 0).setScrollFactor(0).setDepth(100).setAlpha(0.85);

    this.cameras.main.setBounds(0, 0, C.MAP_W, C.MAP_H).setRoundPixels(true).centerOn(C.MAP_W / 2, C.MAP_H / 2);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,Q,R,TAB') as any;
    this.keys.Q.on('down', () => this.ctl.qDown()); // 長押しでリコール（判定はサーバー）
    this.keys.Q.on('up', () => this.ctl.qUp());
    this.keys.R.on('down', () => this.skillDown('r'));
    this.keys.R.on('up', () => this.skillUp('r'));
    // フィールド上の右クリック長押し: 技の矢印（矢印の技だけ。ミニマップの上は DOM が受けるので来ない）
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (p.rightButtonDown()) this.skillDown('rc'); });
    // 離した判定は右ボタンが押されていないこと（Mac の Ctrl+クリックは Phaser が右ボタン扱いで down を出し、up は button 0 で来る）
    for (const t of ['pointerup', 'pointerupoutside']) this.input.on(t, (p: Phaser.Input.Pointer) => { if (!p.rightButtonDown()) this.skillUp('rc'); });
    // up を取りこぼしても詰まらないよう、ボタンを離した状態の pointermove でも離した扱い（左右同時押しの片方の解放は pointermove で来る）
    window.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; const part = this.sidePart(e.clientX, e.clientY); if (part !== null) this.react(part); }); // 余白の立ち絵のタップ・クリック（部位ごとの反応。react1）
    window.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; this.mouseAt = { x: e.clientX, y: e.clientY }; if (!(e.buttons & 1)) this.skillUp('btn'); if (!e.buttons) this.skillUp('rc'); }); // mousemove は技ボタンの pointerdown の preventDefault で止まるので pointermove
    // フォーカスを失ったら技の矢印を捨てる（発動しない）。R の keyup が来ず詰まるのを防ぐ（Phaser は blur でキーを戻すが up は出さない）
    addEventListener('blur', () => (this.ctl.aim = null));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.ctl.aim = null; });
    this.keys.TAB.on('down', () => this.ctl.cycleAim()); // Tab: 照準モードを順に切り替え
    const refit = () => (this.fxFit = FX_FIT_FRAMES);
    addEventListener('resize', refit); addEventListener('orientationchange', refit); this.scale.on('resize', refit);
    this.buttons();
    if (TOUCH) this.touchControls();
    this.makeAaTextures();

    // 待機画面（キャラ選択）: 背後に選んだキャラの立ち絵・名前・ロール・ステータス、下半分に選択バー、右上に味方の選択状況
    const lobby = document.createElement('div');
    lobby.id = 'lobby';
    lobby.innerHTML = `<img class="crate"><img class="tachie"><div class="ttl">${TITLE}</div><div class="info"><div class="nm"></div><div class="role"></div><div class="stats"></div><div class="sk"></div></div><div class="rcol"><div id="roster"></div><div class="opts"><button id="cmbtn" class="opt"></button><button id="sidebtn" class="opt"></button><button id="cvbtn" class="opt"></button></div></div>`
      + '<div class="selbar"><div class="cards"></div></div><button id="okbtn" class="big">OK?</button><button id="backsel" class="big">↩️</button><div class="grace"></div><button id="totitle" class="big">タイトルへ</button>';
    fx.appendChild(lobby);
    // 実況のオン・オフ（キャラ選択画面だけ。音声と字幕をまとめて切る。端末に保存）
    const cmBtn = document.getElementById('cmbtn')!, cmShow = () => { cmBtn.textContent = commentary.on ? '実況 ON' : '実況 OFF'; cmBtn.classList.toggle('off', !commentary.on); };
    cmBtn.onclick = () => { commentary.setOn(!commentary.on); cmShow(); };
    cmShow();
    // 立ち絵（対戦中の余白）を出す側の切り替え。端末に保存
    const sdBtn = document.getElementById('sidebtn')!, sdShow = () => { sdBtn.textContent = sideLeft ? '立ち絵 左' : '立ち絵 右'; };
    sdBtn.onclick = () => { sideLeft = !sideLeft; try { localStorage.setItem('sideLeft', sideLeft ? '1' : '0'); } catch {} sdShow(); this.fxFit = FX_FIT_FRAMES; };
    sdShow();
    // 実況者の切り替え（No.7／琴詠ニア）。端末に保存（観戦でも同じ）
    const cvBtn = document.getElementById('cvbtn')!, cvShow = () => { cvBtn.textContent = `実況 ${VOICES[commentary.voice].name}`; };
    cvBtn.onclick = () => { commentary.setVoice(commentary.voice === 'no7' ? 'nia' : 'no7'); cvShow(); };
    cvShow();
    // 選択バーは全員分を BAR_COPIES 回並べて左右をつなぐ（複製したカードも同じキャラ。data-k で扱う）
    lobby.querySelector('.cards')!.innerHTML = Array.from({ length: BAR_COPIES }, () => PICKABLE.map((k) => `<div class="card" data-k="${k}"><img src="${TACHIE(k, 'select')}"><div>${CHARS[k].name}</div></div>`).join('')).join('');
    // 選択バーのスクロール: 指・マウスで左右にドラッグ、ホイール（縦・横どちらも横送り）。ドラッグした時はカードを押した扱いにしない
    // 無限ループ: 真ん中の組の範囲（1組の幅の 0.5〜1.5 倍）を出たら1組分戻す（見た目は同じ並びなので継ぎ目は見えない）。戻すのはドラッグ・ホイールの時だけ
    const cards = lobby.querySelector<HTMLElement>('.cards')!;
    const setW = () => { const c = cards.children; return (c[PICKABLE.length] as HTMLElement).offsetLeft - (c[0] as HTMLElement).offsetLeft; };
    const wrap = () => { const w = setW(), d = !w ? 0 : cards.scrollLeft < w * 0.5 ? w : cards.scrollLeft > w * 1.5 ? -w : 0; cards.scrollLeft += d; return d; };
    this.centerBar = () => { const w = setW(); if (w) { cards.scrollLeft = w; this.centerBar = null; } }; // 最初に表示した時に真ん中の組へ
    let drag: { x: number; left: number; moved: boolean; id: number } | null = null, dragged = false;
    cards.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, left: cards.scrollLeft, moved: false, id: e.pointerId }; dragged = false; });
    cards.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (Math.abs(e.clientX - drag.x) > 6) drag.moved = true;
      if (drag.moved) { cards.scrollLeft = drag.left - (e.clientX - drag.x); drag.left += wrap(); }
    });
    const end = () => { if (drag?.moved) dragged = true; drag = null; };
    cards.addEventListener('pointerup', end);
    cards.addEventListener('pointercancel', end);
    cards.addEventListener('pointerleave', end);
    cards.addEventListener('wheel', (e) => { e.preventDefault(); cards.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; wrap(); }, { passive: false });
    // 選択バー: カーソルを乗せる（PC）か1回タップで表示を切り替え、表示中のキャラをもう一度クリック／タップで OK?
    lobby.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      const k = el.dataset.k!;
      el.onpointerenter = (e) => { if (e.pointerType === 'mouse' && !drag?.moved) this.showChar(k); };
      el.onclick = () => { if (dragged) { dragged = false; return; } if (this.selMode !== 'browse') return; if (this.selChar === k) { this.selMode = 'confirm'; this.lobbyRender(); } else this.showChar(k); };
    });
    document.getElementById('okbtn')!.onclick = () => { // OK? → 出撃ボタン（練習は「開始」。相手はサーバーがランダムに選ぶ） → 出撃済み
      if (this.selMode === 'confirm') this.selMode = 'sortie';
      else if (this.selMode === 'sortie') { this.selMode = 'go'; if (this.room && this.selChar) sendC2S(this.room, 'go', { char: this.selChar }); }
      this.lobbyRender();
    };
    document.getElementById('backsel')!.onclick = () => { // 出撃済み → 未出撃、出撃ボタン → OK?、OK? → 選択バー
      if (this.selMode === 'go') { this.selMode = 'sortie'; if (this.room) sendC2S(this.room, 'unpick'); }
      else this.selMode = this.selMode === 'sortie' ? 'confirm' : 'browse';
      this.lobbyRender();
    };
    // ブラウザで開いている時だけ「ホーム画面に追加」で全画面になる案内（閉じたら二度と出さない）
    const ua = navigator.userAgent, standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;
    const how = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua) ? '共有 → ホーム画面に追加' : /Android/.test(ua) && /Chrome\//.test(ua) && !/; wv\)|SamsungBrowser|EdgA|OPR|Firefox/.test(ua) ? 'メニュー（⋮）→ ホーム画面に追加' : '';
    let closed = false;
    try { closed = localStorage.getItem('pwaHintClosed') === '1'; } catch {}
    if (TOUCH && !standalone && how && !closed) {
      const hint = document.createElement('div');
      hint.className = 'pwa';
      hint.innerHTML = `<span>${how} で全画面になる</span><button>×</button>`;
      hint.querySelector('button')!.onclick = () => { hint.remove(); try { localStorage.setItem('pwaHintClosed', '1'); } catch {} };
      lobby.appendChild(hint);
    }
    document.getElementById('roster')!.onclick = (e) => { const t = (e.target as HTMLElement).dataset.t; if (t && this.room) sendC2S(this.room, 'team', { team: Number(t) }); };
    $('.back').onclick = () => { this.backSent = true; if (this.room) sendC2S(this.room, 'back'); };
    $('.rsbtn').onclick = () => { const s = this.snap, mine = s?.players.find((p: any) => p.id === s.me); if (this.result && s) openResult(this.result, { myTeam: mine ? mine.team : null, title: s.winner === 2 ? '引き分け' : !mine ? `${TEAM_NAME[s.winner]}の勝ち` : s.winner === mine.team ? '勝利' : '敗北', colors: TEAM_COLOR.map(css16), names: TEAM_NAME, players: Object.fromEntries(s.roster.map((r: any) => [r.id, r.bot ? 'Bot' : r.name ?? ''])) }); };
    // タイトルへ（待機画面・結果画面）: 部屋を出る（試合後は Bot が引き継ぐ）
    for (const b of [document.getElementById('totitle')!, $('.totitle')]) b.onclick = () => { this.toTitle = true; this.finishMeasure(); this.room?.leave(); };
    // 練習パネル: 操作はサーバーへ（pr）。表示は tick の practiceHud
    const pr = (m: any) => { if (this.room) sendC2S(this.room, 'pr', m); }, prp = $('.prp'), prw = $('.prw');
    $('.prbtn').onclick = () => prw.classList.toggle('open'); // 押すたびに開閉（引き出しの外を触っても閉じない）
    $('.pfoe').onchange = (e) => pr({ op: 'foe', char: (e.target as HTMLSelectElement).value });
    prp.onclick = (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.mode) pr({ op: 'mode', mode: b.dataset.mode });
      if (b.dataset.pw) pr({ op: 'power', who: b.dataset.pw, d: Number(b.dataset.d) });
      if (b.dataset.as) pr({ op: 'assist', side: b.dataset.as, char: ($('.pas') as HTMLSelectElement).value, tier: Number(($('.pat') as HTMLSelectElement).value) });
      if (b.classList.contains('pboss')) pr({ op: 'boss' });
      if (b.classList.contains('pback')) { pr({ op: 'back' }); prw.classList.remove('open'); }
    };

    // 入室はタイトル画面（title.ts）が済ませている（再読み込みしたタブは再接続、?e2e=<値> はテスト専用の部屋）
    const e2e = new URLSearchParams(location.search).get('e2e'), tokenKey = e2e ? 'rtE2e' : 'rt';
    const room: Room = (window as any).__room;
    {
      this.room = room;
      (window as any).room = room; // 検証用
      sessionStorage.setItem(tokenKey, room.reconnectionToken);
      if ((window as any).__rejoin) this.ctl.sendAim();
      // 通信の再接続（自動）。戻ったら照準モードを送り直す。再接続できなければ入り直す
      room.onReconnect(() => { sessionStorage.setItem(tokenKey, room.reconnectionToken); this.ctl.sendAim(); });
      // 切れたら再読み込み（保存した合言葉で戻る）。キック・BAN（reason）と「タイトルへ」はタイトル画面へ
      room.onLeave((code: number, reason?: string) => {
        if (code !== CloseCode.CONSENTED) return location.reload();
        sessionStorage.removeItem(tokenKey);
        if (reason === 'kick' || reason === 'ban') sessionStorage.setItem('leaveMsg', reason === 'ban' ? '入室できません' : '部屋から外されました');
        if (reason === 'kick' || reason === 'ban' || this.toTitle) location.reload();
      });
      addEventListener('pagehide', () => { this.finishMeasure(); if (this.snap?.phase === 'waiting') room.leave(); }); // 待機画面でタブを閉じたら待たせずに抜ける（試合中は再読み込みで戻れるよう再接続を待つ）
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { this.hiddenAt = performance.now(); return; }
        if (room.connection.isOpen && performance.now() - this.hiddenAt >= C.RESUME_RECONNECT_SEC * 1000) room.connection.close(CloseCode.MAY_TRY_RECONNECT); // 止まっていた接続を張り直す
      });
      room.onMessage('netPong', (m: any) => {
        if (this.measure && !this.measureSent && m.id === this.measureId && m.at === this.pingPending) {
          this.measure.rtt.add(performance.now() - m.at); this.pingPending = null;
        }
      });
      room.onMessage('netFinish', (m: any) => { if (m.id === this.measureId) this.finishMeasure(); });
      room.onMessage('s', (s: any) => {
        if (s.phase === 'playing' && s.netMeasure && s.netMeasure !== this.measureId) {
          this.measureId = s.netMeasure; this.measure = new ClientMeasure(); this.measureSent = false; this.measureFrameAt = null;
          this.pingAt = -Infinity; this.pingPending = null;
        }
        if (s.phase !== 'playing' && this.snap?.phase === 'playing') this.finishMeasure();
        this.snap = s;
        this.snapAt = performance.now();
        if ((s.me && s.phase !== 'waiting' ? s.players.find((p: any) => p.id === s.me)?.char ?? this.sideChar : null) !== this.sideChar) this.sideFit(); // 余白の立ち絵・色（自キャラが変わった時だけ）
        if (s.sortie != null || s.phase === 'intro') this.warmup(s); // 出撃の秒数（常設の部屋）の間に、戦闘画面で使う画像を先に読み込む
        this.sortieVoice(s); // 出撃セリフ（本人の端末だけ）
        this.powerFx(s); // パワーアップ中の余白の演出
        if (s.cracks) this.applyCracks(s.cracks); // 壁の段階（小破・中破）: 変わった分だけ届くので、フレームを待たず受け取った時に割れ目を重ねる（マップの絵は描き直さない）
        this.interp.push(s.t, this.snapAt, [...s.players, ...s.bosses.map((b: any) => ({ ...b, id: 'boss' + b.team })), ...s.couriers.map((c: any) => ({ ...c, id: 'c' + c.id })), ...s.shots.map((sh: any) => ({ x: sh.x, y: sh.y, id: 'shot:' + sh.id }))]); // 自キャラも移動不可の状態（突撃など）では補間で描く
        for (const sh of s.shots) this.shotData.set(sh.id, { ...sh, seen: s.t }); // 弾の種類・向き（描く時刻の位置は interp から）
        for (const [id, d] of this.shotData) if (d.seen < s.t - 2) this.shotData.delete(id); // 2秒前から届いていない弾を片付ける（描く時刻はそれより新しい）
        if (this.measure && !this.measureSent && s.phase === 'playing') this.measure.snapshot(this.snapAt, this.interp.offset!);
        const m = s.players.find((p: any) => p.id === s.me);
        if (m) {
          if (!m.alive || !MOVE_PHASES.includes(s.phase) || m.lock) this.pred.reset(m.x, m.y);
          else this.pred.reconcile(m.x, m.y, m.ack, m.spd, this.obstacles(s, m));
        }
        if (s.phase === 'waiting' && this.reactKoBy.size) this.reactKoBy.clear(); // 立ち絵の反応の「同じ相手」は試合ごとに数える
        for (const f of s.fx ?? []) this.fxQueue.push(HIT_FX_KIND(f, s.me) ? { ...f, at: s.t } : f); // 当たった時の演出（汗・他人の斬撃・爆発）は弾・他キャラと同じ時刻（NET_INTERP_DELAY 前）で出す
        (window as any).snap = s;
      });
      room.onMessage('notice', (m: any) => this.notify(m.text));
      room.onMessage('cm', (u: any) => commentary.receive(u)); // 実況（全員に同じもの）
      room.onMessage('cmStop', () => commentary.clear()); // 決着の瞬間: 喋っている途中のセリフを打ち切る
      room.onMessage('kill', (k: any) => this.killLog(k.kc ?? BOSS_CHAR[k.kt], k.kt, k.vc, k.vt));
      room.onMessage('assist', (m: any) => this.notify(`${TEAM_NAME[m.team]}のアシスト: ${charName(m.char)}（${C.ASSIST_TAGS[m.tier]}）`)); // 召喚の通知（両陣営）
      room.onMessage('slot', (m: any) => this.slotWin(m.team, m.chain, m.kind, m.tier, m.char));
      room.onMessage('assistUp', (m: any) => this.notify(`${TEAM_NAME[m.team]}のアシスト強化: ${charName(m.char)}（${C.ASSIST_TAGS[m.tier]}）`)); // 両陣営
      room.onMessage('penalty', (m: any) => this.notify(`${TEAM_NAME[m.team]}に罰: ${PENALTY_LABEL[m.kind]}`)); // 両陣営
      room.onMessage('mslot', (m: any) => this.mslotEv(m));
      room.onMessage('mslotWin', (m: any) => this.mslotWin(m));
      room.onMessage('mpenalty', (m: any) => this.mslotToast(m.team, `ペナルティ（${m.n === 1 ? '転落' : '引き戻し失敗'}）\n全員にダメージ・攻撃ダウン・速度ダウン`, true));
      room.onMessage('ko', (k: any) => {
        const mine = this.snap?.players.find((p: any) => p.id === this.snap.me);
        if (mine) this.cutin(mine.char, k.victimChar, k.how);
        this.react('kill');
      });
      room.onMessage('koed', (k: any) => {
        this.koedBy = { kc: k.kc, how: k.how };
        // 立ち絵の反応: 同じ相手に2回目以降→怒る、出会い頭（倒した相手が最初に当てた時に見えていなかった・交戦の始まりから REACT.surpriseSec 秒以内）→驚く、それ以外→悲しむ。差分のない出来事は飛ばして次へ
        const n = k.kid ? (this.reactKoBy.get(k.kid) ?? 0) + 1 : 0;
        if (k.kid) this.reactKoBy.set(k.kid, n);
        if (!(n >= 2 && this.react('angry')) && !((k.unseen || (k.sec !== null && k.sec <= C.REACT.surpriseSec)) && this.react('surprise'))) this.react('sad');
      });
      room.onMessage('recalled', (m: any) => { if (m.r <= C.REACT.relief) this.react('relief'); }); // 残りHPが少ない状態で帰還
      room.onMessage('bossHit', () => { const t = performance.now(); if (t - this.reactJoyAt >= C.REACT.joyEvery * 1000 && this.react('joy')) this.reactJoyAt = t; }); // 大将に当てた（REACT.joyEvery 秒に1回まで）
      room.onMessage('result', (r: any) => (this.result = r)); // 試合結果画面のデータ（決着後に1回）
      sendC2S(room, 'resultReq'); // 結果画面の間に入室・再接続した時の分（受け取る準備ができてから）
    }
  }

  // ミニマップの下絵を塗る
  paintMini() {
    this.tileKinds.forEach((row, y) => row.forEach((v, x) => {
      if (!v) return;
      this.miniTex.context.fillStyle = ['', '#8a8478', '#222', '#c08050', '#70a060'][v];
      this.miniTex.context.fillRect(x * MINI, y * MINI, MINI + 0.2, MINI + 0.2);
    }));
    this.miniTex.refresh();
  }

  // マップの canvas の矩形 [x0,x1)×[y0,y1)（px）だけを GPU のテクスチャへ送る（texSubImage2D。Phaser の refresh は全量を送るので初回・リセットだけ）
  // Phaser を通さず WebGL を直接呼ぶ: 描画バッチを先に flush し、Phaser の _processTexture と同じく TEXTURE0 で今のバインドを退避→転送→元に戻す
  // 送る設定（premultiplied alpha・flipY・形式）は Phaser が最初に送った時の値（テクスチャの wrapper）をそのまま使う。コンテキストを失っている間は送らない（復帰時に Phaser が canvas から全量で作り直す）
  mapSub(rects: number[][]) {
    const r = this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer, gl = r.gl, w = this.mapTex.source[0].glTexture!, src = this.mapTex.canvas, c = this.mapSubCv;
    if (gl.isContextLost()) return;
    r.flush();
    gl.activeTexture(gl.TEXTURE0);
    const cur = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, w.webGLTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, w.pma);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, w.flipY);
    for (let [x0, y0, x1, y1] of rects) {
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(src.width, x1); y1 = Math.min(src.height, y1);
      if (x0 >= x1 || y0 >= y1) continue;
      c.width = x1 - x0; c.height = y1 - y0;
      c.getContext('2d')!.drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w.format, gl.UNSIGNED_BYTE, c); // canvas のテクスチャは flipY なし
    }
    gl.bindTexture(gl.TEXTURE_2D, cur);
  }

  // 連戦: 待機画面に戻ったら、壊れた壁・自宅の色・キルログなどを最初の状態に戻す
  resetMatch() {
    MAP.tiles.forEach((row, y) => (tiles[y] = row));
    wallVer++;
    paintMap(this.mapTex.context, this.chips, tiles); this.mapTex.refresh(); this.homeG.clear();
    this.crackBl.clear(); this.cracks.clear();
    this.paintMini();
    Object.assign(this, { walls: C.WALLS, seeWalls: C.SEE_WALLS, brokenN: 0, homesKey: '', lastSeenBoss: null, timed: null, prevTimeLeft: Infinity, backSent: false });
    $('.kills').innerHTML = '';
  }

  // この試合の大将の部屋を陣営色に塗る（画面はチップの床に半透明で重ねる・ミニマップ）
  applyHomes(names: string[]) {
    this.homes = roomLayout(names).homes;
    this.homeG.clear();
    this.homes.forEach((hs, t) => hs.forEach((h) => this.homeG.fillStyle(HOME_TINT[t], HOME_TINT_ALPHA).fillRect(h.x, h.y, h.w, h.h)));
    for (const r of MAP.rooms) {
      if (!r.team || !names.includes(r.id.replace(/_[LR]$/, ''))) continue;
      const v = r.team === 'kiritan' ? 3 : 4;
      for (let y = r.rect[1] + 1; y < r.rect[3]; y++) for (let x = r.rect[0] + 1; x < r.rect[2]; x++) {
        if (tiles[y][x] !== '.') continue;
        this.miniTex.context.fillStyle = ['', '', '', '#c08050', '#70a060'][v];
        this.miniTex.context.fillRect(x * MINI, y * MINI, MINI + 0.2, MINI + 0.2);
      }
    }
    this.miniTex.refresh();
  }

  mine() {
    return this.snap?.players.find((p: any) => p.id === this.snap.me);
  }

  // 技の入力を押した。矢印の技（サーバーが skA を送ってくる）は矢印を出し、離した時に発動。ほかの技は今どおり押した瞬間に発動（右クリックは矢印の技だけ）
  // 矢印を出すのは技が使える時（技ボタンが OK）か、タメ中で向きを変えられる時（skRe）だけ
  skillDown(src: string, touch?: { id: number; x: number; y: number; nx: number; ny: number }) {
    const m = this.mine(), s = this.snap;
    if (!m || m.skA === undefined) { if (src !== 'rc') this.ctl.skill(); return; }
    const ready = m.skillCd - (performance.now() - this.snapAt) / 1000 <= 0 && !Object.keys(STATUS_VIEW).some((k) => m.st?.[k] && STATUS_VIEW[k].hud);
    if (!m.alive || !['playing', 'ended'].includes(s.phase) || !(m.skRe || ready)) return;
    if (!this.ctl.aim) this.aimFrom = { mouse: this.mouseAt && { ...this.mouseAt }, touch: null };
    if (touch) this.aimFrom!.touch = touch;
    this.ctl.aimDown(src, !!m.skRe);
  }
  skillUp(src: string) {
    this.ctl.aimUp(src);
    if (!this.ctl.aim) this.aimFrom = null;
  }

  // 技の矢印（毎フレーム・本人の画面だけ）: 技ボタンの指を動かしたらドラッグの向き、マウスを動かしたら自キャラ→カーソル、どちらもなければ自動照準（サーバーの skA）
  aimArrow(g: Phaser.GameObjects.Graphics, m: any) {
    const f = this.aimFrom;
    if (this.ctl.aim && (!m?.alive || !['playing', 'ended'].includes(this.snap?.phase))) this.ctl.aim = null; // 撃破・試合の段階の変化で捨てる（発動しない）
    if (!this.ctl.aim || !f || !m?.alive || m.skA === undefined) return;
    const z = this.game.scale.zoom, t = f.touch;
    if (t && Math.hypot(t.nx - t.x, t.ny - t.y) / z >= C.TOUCH.dead) this.ctl.aimTo(Math.atan2(t.ny - t.y, t.nx - t.x));
    else if (!t && f.mouse && this.mouseAt && Math.hypot(this.mouseAt.x - f.mouse.x, this.mouseAt.y - f.mouse.y) >= 4) {
      const w = this.cameras.main.getWorldPoint(this.scale.transformX(this.mouseAt.x), this.scale.transformY(this.mouseAt.y));
      this.ctl.aimTo(Math.atan2(w.y - this.me.y, w.x - this.me.x));
    }
    const a = this.ctl.aim.a ?? m.skA, L = m.skR, ux = Math.cos(a), uy = Math.sin(a), x = this.me.x, y = this.me.y, ex = x + ux * L, ey = y + uy * L, h = 12;
    g.lineStyle(4, 0x000000, 0.35).lineBetween(x, y, ex - ux * h, ey - uy * h).lineStyle(2, 0xffffff, 0.9).lineBetween(x, y, ex - ux * h, ey - uy * h);
    g.fillStyle(0xffffff, 0.9).fillTriangle(ex, ey, ex - ux * h - uy * h * 0.6, ey - uy * h + ux * h * 0.6, ex - ux * h + uy * h * 0.6, ey - uy * h - ux * h * 0.6);
  }

  // 右下のボタン（PC・スマホ共通。PCはマウスで押す）: 技・帰還（長押し）・照準。その下のミニマップは押している間だけ視点をそこへ移す（スマホは指、PCは右クリック）
  buttons() {
    const btn = (q: string, down: () => void, release?: () => void) => {
      const el = $(q);
      el.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); el.setPointerCapture(e.pointerId); down(); });
      if (release) for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, release);
    };
    // 技ボタン: マウスは左ボタン、タッチは指（押した位置からのドラッグで矢印の向き）
    const skb = $('.skill'), src = (e: PointerEvent) => (e.pointerType === 'mouse' ? 'btn' : `t${e.pointerId}`);
    skb.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); skb.setPointerCapture(e.pointerId); this.skillDown(src(e), e.pointerType === 'mouse' ? undefined : { id: e.pointerId, x: e.clientX, y: e.clientY, nx: e.clientX, ny: e.clientY }); });
    skb.addEventListener('pointermove', (e) => { const t = this.aimFrom?.touch; if (t && t.id === e.pointerId) Object.assign(t, { nx: e.clientX, ny: e.clientY }); });
    for (const t of ['pointerup', 'pointercancel']) addEventListener(t, (e) => this.skillUp(src(e as PointerEvent))); // ボタンの外（捕捉が外れた後など）で離しても届くよう window で受ける
    btn('.rc', () => this.ctl.qDown(), () => this.ctl.qUp());
    btn('.aimb', () => this.ctl.cycleAim());
    // 観戦者の視点の切り替え（全体・実況追従・組の視界）
    for (const b of $('.spec').querySelectorAll<HTMLElement>('button')) btn(`.spec [data-v="${b.dataset.v}"]`, () => { const v = b.dataset.v!; if (this.room) sendC2S(this.room, 'spec', { view: (v === '0' || v === '1' ? Number(v) : v) as C2S['spec']['view'] }); });
    const mm = $('.mm');
    let held: number | null = null;
    const at = (e: PointerEvent) => { const b = mm.getBoundingClientRect(); this.mmCam = { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * C.MAP_W, y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) * C.MAP_H }; };
    mm.addEventListener('contextmenu', (e) => e.preventDefault());
    mm.addEventListener('pointerdown', (e) => {
      if (held !== null || (e.pointerType === 'mouse' && e.button !== 2)) return; // PCは右クリックだけ
      e.preventDefault(); held = e.pointerId; mm.setPointerCapture(e.pointerId); at(e);
    });
    mm.addEventListener('pointermove', (e) => { if (e.pointerId === held) at(e); });
    const up = (e: PointerEvent) => { if (e.pointerId === held && (e.pointerType !== 'mouse' || !(e.buttons & 2))) { held = null; this.mmCam = null; } };
    mm.addEventListener('pointerup', up);
    mm.addEventListener('pointercancel', up);
  }

  // 通常攻撃のエフェクトの絵（ドット・立ち絵とは別のスプライト）: 斬撃（角度ごと、右向き・半径 SLASH_R）と汗
  // 壁の割れ目（仮の線）: 1枚の絵に小破・中破の2コマ（タイル1マスの大きさ）。起動時に1回だけ作る
  makeCrackTexture() {
    if (this.textures.exists(CRACK_TEX)) return;
    const t = this.textures.createCanvas(CRACK_TEX, T * 2, T)!, c = t.context;
    const lines = [[[3, 2], [6, 6], [5, 9], [8, 12], [7, 15]], [[13, 3], [10, 7], [12, 10]], [[1, 11], [4, 10], [5, 9]], [[15, 13], [12, 12], [8, 12]]]; // 中破は全部、小破は最初の1本
    for (const [f, n] of [[0, 1], [1, lines.length]]) {
      for (const [w, col] of [[2, 'rgba(255,255,255,0.35)'], [1, 'rgba(30,20,15,0.9)']] as const) {
        c.lineWidth = w; c.strokeStyle = col; c.lineJoin = 'round';
        for (const l of lines.slice(0, n)) { c.beginPath(); l.forEach(([x, y], i) => (i ? c.lineTo : c.moveTo).call(c, f * T + x + 0.5, y + 0.5)); c.stroke(); }
      }
      t.add(String(f + 1), 0, f * T, 0, T, T);
    }
    t.refresh();
  }

  // 壁の段階（小破・中破）をサーバーから受け取った分だけ反映（壊れた壁のマスは扱わない）
  applyCracks(list: number[][]) {
    for (const [x, y, st] of list) {
      if (tiles[y]?.[x] !== '#') continue;
      const k = y * MAP.width + x, b = this.cracks.get(k);
      if (b) b.setFrame(String(st));
      else this.cracks.set(k, this.crackBl.create(x * T, y * T, String(st)));
    }
    this.crackCull[0] = NaN; // 足したマスの表示を決め直す
  }

  // 画面外の割れ目は描かない（カメラがタイル単位で動いた時・ズームが変わった時だけ切り替える）
  cullCracks() {
    const c = this.cameras.main, cx = Math.floor(c.scrollX / T), cy = Math.floor(c.scrollY / T), q = this.crackCull;
    if (cx === q[0] && cy === q[1] && c.zoom === q[2]) return;
    q[0] = cx; q[1] = cy; q[2] = c.zoom;
    for (const b of this.cracks.values()) b.visible = this.inView(b.x + T / 2, b.y + T / 2, T);
  }

  makeAaTextures() {
    const t = this.textures.createCanvas('sweat', 12, 14)!, c = t.context;
    for (const [x, y, s] of [[4, 6, 1], [9, 3, 0.7]]) {
      c.beginPath(); c.moveTo(x, y - 4 * s); c.quadraticCurveTo(x + 3 * s, y + 1 * s, x, y + 3 * s); c.quadraticCurveTo(x - 3 * s, y + 1 * s, x, y - 4 * s);
      c.fillStyle = '#7fd4ff'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke();
    }
    t.refresh();
    // クナイ（WhiteCUL の通常攻撃の弾）: 右向き。刃（銀）・柄（紺）・輪。起動時に1回だけ作り、弾は Image で置く（render_policy 3）
    const k = this.textures.createCanvas('kunai', 18, 8)!, q = k.context;
    q.fillStyle = '#d8dee8'; q.strokeStyle = '#2a3040'; q.lineWidth = 1;
    q.beginPath(); q.moveTo(17.5, 4); q.lineTo(9, 1); q.lineTo(7, 4); q.lineTo(9, 7); q.closePath(); q.fill(); q.stroke(); // 刃
    q.fillStyle = '#2a3a6a'; q.fillRect(3, 3, 4.5, 2); // 柄
    q.strokeStyle = '#d8dee8'; q.beginPath(); q.arc(2, 4, 1.6, 0, Math.PI * 2); q.stroke(); // 輪
    k.refresh();
    // 強さの札（頭上）: 「1」「2」「3」「MAX」と「★」〜「★★★★」を1枚の絵にコマ分けして起動時に作る（頭上は Image のコマを切り替える: render_policy 3）
    // TAG_RES 倍で描いて 1/TAG_RES で表示する（この絵だけ線形補間）
    const R = TAG_RES, font = `900 ${uf(7) * R}px sans-serif`, labels = [...C.POWER_TAGS, ...C.ASSIST_TAGS], m0 = document.createElement('canvas').getContext('2d')!;
    m0.font = font;
    const ws = labels.map((l) => Math.ceil(m0.measureText(l).width) + 4 * R), H = Math.ceil(uf(7) + 2) * R;
    const tt = this.textures.createCanvas('tags', ws.reduce((a, b) => a + b + 2, 0), H)!, tc = tt.context;
    let x = 0;
    labels.forEach((l, i) => {
      tc.fillStyle = 'rgba(0,0,0,0.8)'; tc.beginPath(); tc.roundRect(x, 0, ws[i], H, 2 * R); tc.fill();
      tc.font = font; tc.textAlign = 'center'; tc.textBaseline = 'middle'; tc.fillStyle = '#ffe066'; tc.fillText(l, x + ws[i] / 2, H / 2 + 0.5 * R);
      tt.add(l, 0, x, 0, ws[i], H); x += ws[i] + 2;
    });
    tt.refresh(); tt.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  // 頭上の強さの札を置く（id ごとに Image を1つ。label が null・画面外なら隠す）
  placeTag(id: string, label: string | null, x: number, y: number) {
    this.tagSeen.add(id);
    let im = this.tags.get(id);
    if (!label) { im?.setVisible(false); return; }
    if (!im) { im = this.add.image(x, y, 'tags', label).setOrigin(0, 0.5).setScale(1 / TAG_RES).setDepth(19); this.tags.set(id, im); }
    if (im.frame.name !== label) im.setFrame(label);
    im.setPosition(Math.round(x), Math.round(y)).setVisible(true);
  }

  // 斬撃の絵（arc の角度ごとに1回だけ作る）: 中心から右向き、外周に三日月の刃
  slashTex(arc: number) {
    const key = `slash${arc.toFixed(3)}`, R = SLASH_R;
    if (this.textures.exists(key)) return key;
    const t = this.textures.createCanvas(key, R * 2, R * 2)!, c = t.context, h = Math.min(arc, Math.PI * 2 - 0.01) / 2;
    const g = c.createRadialGradient(R, R, R * 0.45, R, R, R);
    g.addColorStop(0, '#ffffff00'); g.addColorStop(0.75, '#ffffffaa'); g.addColorStop(0.93, '#ffffff'); g.addColorStop(1, '#ffe06600');
    c.beginPath(); c.arc(R, R, R - 1, -h, h); c.arc(R, R, R * 0.45, h, -h, true); c.closePath();
    c.fillStyle = g; c.fill();
    t.refresh();
    return key;
  }

  // 通常攻撃のエフェクト: 近接の斬撃（攻撃者の向き・射程・角度）と、当たった側の汗
  aaFx(f: any) {
    if (f.kind === 'slash') {
      const sp = this.add.image(f.x, f.y - 8, this.slashTex(f.arc)).setRotation(f.a - 0.4).setScale(f.r / SLASH_R).setDepth(21);
      this.tweens.add({ targets: sp, rotation: f.a + 0.2, alpha: 0, duration: C.SLASH_MS, ease: 'Quad.easeOut', onComplete: () => sp.destroy() });
    } else {
      const sp = this.add.image(f.x + 9, f.y - 30, 'sweat').setDepth(21);
      this.sweatFx.push({ target: f.target, sp, born: this.time.now });
    }
  }

  // 決着演出（サーバーの finale の段）: カメラ（大将へ・止めのキャラへ）、時間切れ・止めの立ち絵と名前・WIN の表示。演出中は fx のほかの表示を隠す
  // 止めの立ち絵・名前は止めのキャラの陣営の側（陣営0=左、1=右）。アシストは立ち絵なしで名前だけ
  finaleView(s: any, sinceSnap: number, camera: Phaser.Cameras.Scene2D.Camera) {
    const f = s.phase === 'finale' ? s.finale : null, F = C.FINALE;
    fx.classList.toggle('finale', !!f);
    if (!f) { if (this.finKey) { this.finKey = ''; finEl.innerHTML = ''; } return; }
    camera.stopFollow();
    const shown = f.stage === 'killer' && f.t + sinceSnap < F.cam ? 'pan' : '', key = `${f.stage}${shown}`;
    if (key === this.finKey) return;
    this.finKey = key;
    const k = f.killer;
    if (f.stage === 'boss' && f.boss) camera.pan(f.boss.x, f.boss.y - 30, F.cam * 1000, 'Sine.easeInOut');
    if (key === 'killerpan' && k) camera.pan(k.x, k.y - 16, F.cam * 1000, 'Sine.easeInOut');
    const g = GUMI[TEAM_GUMI[f.winner]];
    finEl.innerHTML = f.stage === 'timeup' ? '<div class="tu">時間切れ</div>'
      : key === 'killer' && k ? `${k.assist ? '' : `<div class="kt k${k.team}"><img src="${TACHIE(k.char, 'ko')}"></div>`}<div class="kn k${k.team}"><small>止めを刺した</small>${charName(k.char)}</div>`
      : f.stage === 'win' ? (f.winner === 2 || !g ? '<div class="wn" style="color:#fff">DRAW</div>' : `<div class="wn" style="color:${g.color}">${g.en} TEAM WIN</div>`)
      : '';
  }

  // 自陣営の視界（位置と半径）: 味方（自キャラは予測位置）と大将。倒された味方は大爆発の後に縮む（eyeRadius、サーバーの visibleTo と同じ）
  eyes(s: any, myTeam: number, sinceSnap: number) {
    const out = s.players.filter((p: any) => p.team === myTeam).map((p: any) => ({ ...(p.id === s.me ? this.me : p), r: eyeRadius(p.char, p.alive ? null : p.ko === null ? Infinity : p.ko + sinceSnap, p.assist) })).filter((e: any) => e.r > 0) as { x: number; y: number; r: number }[];
    for (const b of s.bosses) if (b.team === myTeam) out.push({ x: b.x, y: b.y, r: visionRadius() });
    return out;
  }

  // 撃破の演出の爆発（KO_FX）: ko=撃破からの秒数。揺れの間は小爆発、その後に大爆発。s: 大きさの倍率、seed: 小爆発の位置の擬似乱数の種
  koBoom(fxG: Phaser.GameObjects.Graphics, d: { x: number; y: number }, ko: number, seed: number, s: number) {
    const K = C.KO_FX;
    if (ko >= K.shake + K.boom) return;
    const cy = d.y - 18 * s; // 体の中心のあたり
    if (ko < K.shake) {
      const i0 = Math.floor(ko / K.pop);
      for (let j = Math.max(0, i0 - Math.ceil(K.popLife / K.pop)); j <= i0; j++) {
        const t = ko - j * K.pop;
        if (t < 0 || t >= K.popLife || j * K.pop >= K.shake) continue;
        const h = Math.sin((j + 1) * 12.9898 + seed * 78.233) * 43758.5453, u = h - Math.floor(h), v = (h * 7.13) - Math.floor(h * 7.13); // 小爆発ごとの位置（決まった擬似乱数）
        const x = d.x + (u - 0.5) * 24 * s, y = d.y - (4 + v * 32) * s, k = t / K.popLife, r = (3 + 6 * k) * s;
        fxG.fillStyle(0xff6020, 0.9 * (1 - k)).fillCircle(x, y, r).fillStyle(0xffe066, 1 - k).fillCircle(x, y, r * 0.55);
      }
    } else {
      const k = (ko - K.shake) / K.boom, e = 1 - (1 - k) ** 3, W = 32 * 2 * s, H = 42 * 1.5 * s; // 横2キャラ・縦1.5キャラ
      fxG.fillStyle(0xff3010, 0.85 * (1 - k)).fillEllipse(d.x, cy, W * (0.5 + 0.5 * e), H * (0.5 + 0.5 * e));
      fxG.fillStyle(0xffa020, 0.9 * (1 - k)).fillEllipse(d.x, cy, W * 0.75 * (0.4 + 0.6 * e), H * 0.75 * (0.4 + 0.6 * e));
      fxG.fillStyle(0xffffff, 1 - k).fillEllipse(d.x, cy, W * 0.4 * (1 - k), H * 0.4 * (1 - k));
    }
  }

  // スマホの操作: ボタン・ミニマップ以外の画面全体（ゲーム画面の外の黒い余白も含む）が仮想スティック（触れた位置に出て、離すまで指に追従）。
  // 余白にも出せるよう、スティックは画面全体の DOM に描く
  touchControls() {
    const stick = document.createElement('div');
    stick.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;display:none';
    stick.innerHTML = '<div style="position:absolute;border-radius:50%;background:#ffffff26;border:2px solid #ffffff80;box-sizing:border-box"></div><div style="position:absolute;border-radius:50%;background:#ffffff80"></div>';
    document.body.insertBefore(stick, fx); // ゲーム画面より上、ボタン（fx）より下
    const [base, knob] = [...stick.children] as HTMLElement[];
    // x, y: 中心からのずれ（画面のpx）。判定はゲームの座標（÷zoom）で今までと同じ大きさ
    const draw = (x: number, y: number) => {
      const z = this.game.scale.zoom, R = C.TOUCH.r * z, r = R * 0.45, l = Math.hypot(x, y), k = l > R ? R / l : 1, { x: cx, y: cy } = this.stickAt;
      Object.assign(base.style, { left: `${cx - R}px`, top: `${cy - R}px`, width: `${R * 2}px`, height: `${R * 2}px` });
      Object.assign(knob.style, { left: `${cx + x * k - r}px`, top: `${cy + y * k - r}px`, width: `${r * 2}px`, height: `${r * 2}px` });
      stick.style.display = 'block';
      this.ctl.setStick(x / z, y / z);
    };
    const find = (e: TouchEvent) => [...e.changedTouches].find((t) => t.identifier === this.stickId);
    document.addEventListener('touchstart', (e) => {
      if (this.stickId !== null) return;
      const t = [...e.changedTouches].find((t) => !(t.target as HTMLElement).closest?.('button, #fx .skill, #fx .mm, #fx .prw, #lobby') && this.sidePart(t.clientX, t.clientY) === null); // ボタン・ミニマップ・練習の引き出し・キャラ選択・余白の立ち絵（タップで反応）の上は除く
      if (!t) return;
      this.stickId = t.identifier; this.stickAt = { x: t.clientX, y: t.clientY }; draw(0, 0);
    });
    document.addEventListener('touchmove', (e) => { const t = find(e); if (t) draw(t.clientX - this.stickAt.x, t.clientY - this.stickAt.y); });
    const up = (e: TouchEvent) => { if (find(e)) { this.stickId = null; this.ctl.releaseStick(); stick.style.display = 'none'; } };
    document.addEventListener('touchend', up);
    document.addEventListener('touchcancel', up);
  }

  // 自キャラの移動予測に使う障害物（カウント中と終了後は部屋の外へ出られない）
  obstacles(s: any, m: any) {
    return [...moveWalls(m?.char, this.walls), ...(m?.cage ? cage(m.cage) : [])];
  }

  // 徳のゲージとスロット（左＝陣営0、右＝陣営1）。クラシック・モダンとも保留つきの表示（modernHud）
  tokuHud(s: any) {
    [0, 1].forEach((t, k) => {
      const tm = s.teams[t], chars = s.roster.filter((r: any) => r.team === t).map((r: any) => r.char);
      this.modernHud(s, t, k, tm, chars);
    });
  }

  // モダンのスロット（handoff_slot3）: 徳のゲージの下にリール・保留・モード（slot_modern_fx）。リールの絵柄は試合の編成（モダン: 奇数＝陣営のプレイヤー、偶数＝アシスト、7＝大将。クラシック: SLOT.syms）
  // 演出（リーチ・全回転）は自陣だけ、演出の層（.mfxl）に出す。編成が変わったら作り直す
  modernHud(s: any, t: number, k: number, tm: any, chars: string[]) {
    // 編成・HUD の文字は受信したスナップショットが変わった時だけ組み立てる（毎フレーム作り直さない）
    if (s !== this.mfxSnap) { this.mfxSnap = s; this.mfxMyTeam = s.players.find((p: any) => p.id === s.me)?.team ?? -1; this.mfxKeyNow = `${this.mfxMyTeam}:${s.roster.map((r: any) => `${r.team}${r.char}`).join()}`; }
    const myTeam = this.mfxMyTeam, key = this.mfxKeyNow;
    if (key !== this.mfxKey) {
      this.mfxKey = key; this.mfxMine = myTeam; this.slotHtml = ['', '']; this.mfxView = ['', '']; this.mfxMask = ''; this.mfxTm = [null, null];
      $('.mfxl').replaceChildren();
      this.mfx = [0, 1].map((team) => {
        const el = $(`.tk .s${team}`), cs = s.roster.filter((r: any) => r.team === team).map((r: any) => r.char), ass = Object.keys(C.ASSIST.units);
        el.innerHTML = '<div class="tkg"></div><div class="mh"></div>';
        const syms = C.SLOT_MODE === 'modern' ? C.SLOT_MODERN.reel.syms.map((x) => (x === 'boss' ? BOSS_CHAR[team] : x.startsWith('assist:') ? ass[Number(x.slice(7))] : cs[Number(x.slice(7))] ?? cs[0]))
          : C.SLOT.syms.flatMap((x) => (x === 'boss' ? [BOSS_CHAR[team]] : x.startsWith('assist:') ? [ass[Number(x.slice(7))]] : cs[Number(x.slice(7))] ? [cs[Number(x.slice(7))]] : [])); // クラシック: プレイヤー＋アシスト＋7（大将）。いないプレイヤーの絵柄は外す（サーバーの slotSyms と同じ並び）
        const f = new ModernFx(el.querySelector<HTMLElement>('.mh')!, team === myTeam ? $('.mfxl') : document.createElement('div'), syms, cs, css16(TEAM_COLOR[team]));
        { const row = document.createElement('div'); row.className = 'mfx-row'; f.modeEl.replaceWith(row); row.append(f.modeEl, f.label); } // リーチ！・当選！はリールの横ではなく保留の丸の下（「大当たり N連」と同じ行）。文字を大きくして隣の組のリールに隠れたため（font1）
        f.idle(performance.now());
        return f;
      });
    }
    const f = this.mfx[t]!, m = tm.m, now = performance.now(), fresh = tm !== this.mfxTm[k]; // fresh: この陣営の値が新しいスナップショットで届いた
    this.mfxTm[k] = tm;
    if (fresh) {
      const rf = tm.reflect ? `<span class="rf">反省中×${tm.reflect} +${(C.REFLECT_TOKU * tm.reflect * tm.reflect).toFixed(2)}/秒</span>` : '';
      const html = `<div class="tg" style="--c:${css16(TEAM_COLOR[t])}"><i></i></div><div class="tv"></div>`, g = $(`.tk .s${k} .tkg`); // 骨組みは陣営が変わった時だけ作り、ゲージは transform・文字は変わった時だけ書く
      if (html !== this.slotHtml[k]) { this.slotHtml[k] = html; g.innerHTML = html; }
      this.setTf(g.querySelector('i')!, `scaleX(${Math.max(0, Math.min(1, tm.toku / C.TOKU_MAX))})`);
      const tv = g.querySelector<HTMLElement>('.tv')!, tvh = `徳 ${tm.toku.toFixed(1)}${rf}`;
      if ((tv as any)._h !== tvh) { (tv as any)._h = tvh; tv.innerHTML = tvh; }
    }
    if (this.mfxIdleAt[t] && now >= this.mfxIdleAt[t]) { this.mfxIdleAt[t] = 0; f.idle(now); }
    if (s.phase === 'playing') f.frame(now);
    const v = fresh ? JSON.stringify([m.mode, m.backLeft, m.holds, m.cur, m.lv]) : this.mfxView[k];
    if (v !== this.mfxView[k]) {
      this.mfxView[k] = v;
      const h = (x: number[]) => ({ color: x[0], saki: !!x[1], high: !!x[2] }) as any;
      f.holds(m.holds.map(h), m.cur && h(m.cur));
      if (m.kind === 'classic') f.modeEl.textContent = m.chain ? `大当たり${m.chain > 1 ? ` ${m.chain}連` : ''}` : ''; // 連チャンの回数（強さの段と同じ数）
      else f.mode(m.mode, m.backLeft, `パワーアップ${powerText(C.SLOT_MODERN, m.lv.power)}・アシスト${assistText(C.SLOT_MODERN, m.lv.assist)}`);
    }
    if (t === this.mfxMine && m.kind !== 'classic') { // フィーバータイム中は右上に「攻め時」。矢印は敵陣の側（陣営0＝左なら →）
      const fe = $('.fever'), on = m.mode === 'ct' && s.phase === 'playing', txt = `${t === 0 ? '→' : '←'}攻め時！？`, disp = on ? 'block' : 'none';
      if (fe.style.display !== disp) fe.style.display = disp;
      if (fe.textContent !== txt) fe.textContent = txt;
    }
  }

  // モダンのスロットの回転・結果・先バレ（サーバーの mslot）。演出と先バレは自陣だけ
  mslotEv(m: any) {
    const f = this.mfx[m.team], own = m.team === this.mfxMine, now = performance.now();
    if (!f) return;
    if (m.type === 'saki') { if (own) f.sakibare(); return; }
    if (m.type === 'spin') {
      if (!(m.sec > 0)) return;
      this.mfxIdleAt[m.team] = 0;
      f.spin(now, m.reels, m.act);
      if (!own) return;
      const ch = f.syms[m.reels[0] - 1];
      if (m.act === 'allSpin') f.allSpinFx(ch, m.sec); else f.reach(m.act, ch, m.sec, m.win);
      this.mfxMask = ''; // 演出の範囲をすぐ合わせる
    } else if (m.type === 'stop') { f.stop(m.reels, m.outcome); this.mfxIdleAt[m.team] = now + 600; }
  }

  // 当選のお知らせ（画面中央）と音。敵陣の当選は陣営名つき、音なし
  mslotWin(m: any) {
    const LP = (tier: number) => powerText(C.SLOT_MODERN, tier + 1), LA = (tier: number) => assistText(C.SLOT_MODERN, tier + 1), P = m.power, A = m.assist;
    const pw = P.new ? `パワーアップ${LP(P.tier)}` : `パワーアップ${P.add ? `+${P.add} → ` : ''}${LP(P.tier)}（+${C.SLOT_MODERN.game.ultAdd}秒）`;
    const as = A.new ? `アシスト${LA(A.tier)} 登場` : `アシスト${A.add ? `+${A.add} → ` : ''}${LA(A.tier)}${A.add ? '' : ' 耐久アップ'}`;
    this.mslotToast(m.team, `${m.first ? '大当たり！' : `${m.chain}連チャン！`}\n${pw}\n${as}`);
    if (m.team === this.mfxMine) this.mfx[m.team]?.se('win');
  }
  // クラシックの払い出し（両陣営）: 当選音（自陣だけ・大当たりのとき）とカットイン
  slotWin(team: number, chain: number, kind: string, tier: number, char: string) {
    this.slotCutin(team, chain, kind, tier, char);
    if (team === this.mfxMine && chain === 1) this.mfx[team]?.se('win'); // 当選音は大当たり（7を含む）のときだけ。チャンスアップの段では鳴らさない
  }
  // スロットの当たり・チャンスアップのカットイン（両陣営）: 当てた陣営、対象の名前と払い出し・レベル。chain 2〜はチャンスアップの段
  slotCutin(team: number, chain: number, kind: string, tier: number, char: string) {
    fx.querySelector('.scut')?.remove();
    const el = document.createElement('div');
    el.className = 'scut';
    el.style.setProperty('--d', `${C.SLOT_CUTIN_MS}ms`);
    el.style.setProperty('--c', css16(TEAM_COLOR[team]) + 'cc');
    const pay = kind === 'seven' ? `7 全員パワーアップ（+${tier + 1}）` : `${charName(char)} ${PAYOUT_LABEL[kind]}${kind === 'assist' ? C.ASSIST_TAGS[tier] : C.POWER_TAGS[tier]}`; // 7 は人ごとに強さが違うので上がる段数
    el.innerHTML = `<b>${chain === 1 ? '大当たり！' : 'チャンスアップ！'}</b><span>${TEAM_NAME[team]}　${pay}</span>`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), C.SLOT_CUTIN_MS);
  }
  mslotToast(team: number, text: string, bad = false) {
    const f = this.mfx[this.mfxMine] ?? this.mfx[0];
    f?.toast(team === this.mfxMine ? text : `${TEAM_NAME[team]}　${text}`, bad);
  }

  // モダンの演出の範囲を、実際の視界（polys: 画面の論理座標の多角形）とキルログ域に合わせる（演出が出ている間だけ）
  // raw: 視界ポリゴン（ワールド座標。visPoly の配列）、wx・wy: カメラの左上。演出が出ている時だけ、視界かカメラか壁が変わった時だけ画面座標の SVG を組み立て直す
  // （visPoly の配列は使い回されるが、壁が変わらない間は同じ配列なら中身も同じ）
  mfxArea(raw: { x: number; y: number }[][], wx: number, wy: number) {
    const f = this.mfx[this.mfxMine];
    if (!f || (!f.normal.childElementCount && !f.special.childElementCount)) return;
    const c = this.mfxVis;
    if (!c || c.ver !== wallVer || c.wx !== wx || c.wy !== wy || c.raw.length !== raw.length || c.raw.some((p, i) => p !== raw[i]))
      this.mfxVis = { raw: [...raw], ver: wallVer, wx, wy, svg: raw.map((p) => `<path d="M${p.map((q) => `${Math.round(q.x - wx)} ${Math.round(q.y - wy)}`).join('L')}Z" fill="black"/>`).join('') };
    const vis = this.mfxVis!.svg;
    const a = C.SLOT_MODERN.area.killLog, kb = $('.kills').getBoundingClientRect(), fb = fx.getBoundingClientRect(), z = this.game.scale.zoom;
    const kx = kb.width ? Math.min(a.x, (kb.left - fb.left) / z) : a.x, ky = kb.height ? Math.min(a.y, (kb.top - fb.top) / z) : a.y;
    const kill = { x: kx, y: ky, w: Math.max(a.x + a.w, kb.width ? (kb.right - fb.left) / z : 0) - kx, h: Math.max(a.y + a.h, kb.height ? (kb.bottom - fb.top) / z : 0) - ky }; // 設定の外枠と今のキルログの和
    const key = JSON.stringify(kill);
    if (vis === this.mfxMaskVis && key === this.mfxMask) return;
    this.mfxMask = key; this.mfxMaskVis = vis; f.setArea(vis, kill);
  }

  // キャラの顔アイコン（陣営色の縁）
  icon(char: string, team: number, dead = false) {
    return `<span class="ic${dead ? ' dead' : ''}" style="background-image:url(${DOT(char)});--c:${css16(teamColor(team))}"></span>`;
  }

  // 余白の表示: 対戦中は自キャラの色と立ち絵（既定は右の余白、ゲーム画面側に寄せて下揃え。はみ出す分は画面の端側で切る）。それ以外は既定の色だけ
  sideChar: string | null = null;
  sideSel = ''; // 余白の立ち絵の通常の絵（select）の URL
  reactTimer = 0; reactJoyAt = -Infinity; reactKoBy = new Map<string, number>(); reactTapN = [0, 0, 0, 0]; // 反応: 通常の絵に戻すタイマー、最後に「喜ぶ」を出した時刻、この試合で倒された相手（id → 回数）
  // 余白の立ち絵の反応（react1）: 出来事・タップの部位（0〜3）に割り当てた差分に、REACT.ms の間だけ差し替える。差分がなければ何もしない（false）
  react(ev: 'kill' | 'sad' | 'relief' | 'surprise' | 'angry' | 'joy' | number) {
    const k = this.sideChar, R = k ? CHARS[k].react : undefined, t = R ? (typeof ev === 'number' ? R.tap[ev] : R[ev]) : null, name = Array.isArray(t) ? t[this.reactTapN[ev as number]++ % t.length] : t;
    if (!k || !R || !name) return false;
    side.querySelector('img')!.src = TACHIE(k, `r${R.diffs.indexOf(name)}`);
    clearTimeout(this.reactTimer);
    this.reactTimer = window.setTimeout(() => { this.reactTimer = 0; if (this.sideChar === k) side.querySelector('img')!.src = this.sideSel; }, C.REACT.ms);
    return true;
  }
  // 画面の (x, y) が余白の立ち絵の描かれている範囲なら、その部位（0=頭 1=顔 2=上半身 3=下半身。境目は chars.json の react.parts）。範囲外・立ち絵なしは null
  sidePart(x: number, y: number) {
    const k = this.sideChar, parts = k ? CHARS[k].react?.parts : undefined;
    if (!k || !parts || side.style.display === 'none') return null;
    const cr = side.getBoundingClientRect();
    if (x < cr.left || x > cr.right || y < cr.top || y > cr.bottom) return null;
    const ir = side.querySelector('img')!.getBoundingClientRect(), o = OPAQUE.get(this.sideSel) ?? [0, 1], fx = (x - ir.left) / ir.width, fy = ((y - ir.top) / ir.height) * 100;
    if (fx < o[0] || fx > o[1]) return null;
    return fy < parts[0] ? 0 : fy < parts[1] ? 1 : fy < parts[2] ? 2 : 3;
  }
  pwTier = -1; // 余白の演出を出している自キャラのパワーアップの強さ（-1 はなし）
  // パワーアップの演出の切り替え（強さが変わった時だけ）。本人の画面だけ（観戦者は自キャラがいないので出ない）
  powerFx(s: any) {
    const mine = s.me && s.phase !== 'waiting' ? s.players.find((p: any) => p.id === s.me) : null, u = mine?.alive && mine.ult && mine.ult.left !== null ? mine.ult : null;
    const t = u ? Math.min(u.tier, C.POWER_TAGS.length - 1) : -1;
    if (t === this.pwTier) return;
    this.pwTier = t;
    const on = t >= 0 && !!this.sideChar, still = side2.querySelector<HTMLElement>('.still')!, src = this.sideChar ? PW_STILL[this.sideChar] : undefined;
    side2.classList.toggle('on', on);
    if (on) { still.classList.toggle('img', !!src); still.style.backgroundImage = src ? `url(${src})` : ''; } // 素材は出す時に1回だけ読む
  }
  sideFit(b?: DOMRect) {
    const s = this.snap, mine = s?.me && s.phase !== 'waiting' ? s.players.find((p: any) => p.id === s.me) : null, k = mine && PICKABLE.includes(mine.char) ? mine.char : null;
    if (k !== this.sideChar) {
      this.sideChar = k;
      document.body.style.background = (k && CHARS[k]?.bg) || SIDE_BG;
      side.style.display = k ? 'block' : 'none';
      clearTimeout(this.reactTimer); this.reactTimer = 0; this.reactTapN = [0, 0, 0, 0];
      if (k) {
        const im = side.querySelector('img')!; im.onload = () => { if (im.src === this.sideSel) { measureOpaque(im); this.sideFit(); } }; im.src = TACHIE(k, 'select'); this.sideSel = im.src;
        for (const i of CHARS[k].react?.diffs.keys() ?? []) new Image().src = TACHIE(k, `r${i}`); // 反応の差分を先に読む（自キャラの分だけ）
      }
      b = undefined;
    }
    if (!k) return;
    b ??= this.game.canvas.getBoundingClientRect();
    const st = side.style, im = side.querySelector('img')!.style;
    st.top = `${b.top}px`; st.height = `${b.height}px`;
    const w = sideLeft ? Math.max(0, b.left) : Math.max(0, innerWidth - b.right);
    st.left = sideLeft ? '0' : `${b.right}px`; st.width = `${w}px`;
    const s2 = side2.style; // 反対側の余白（左右入れ替えに付いていく）
    s2.top = `${b.top}px`; s2.height = `${b.height}px`; s2.left = sideLeft ? `${b.right}px` : '0'; s2.width = `${sideLeft ? Math.max(0, innerWidth - b.right) : Math.max(0, b.left)}px`;
    // 絵の描かれている部分（透明でない範囲）の左右の中心を、余白の左右の中心に合わせる。反応の差分も通常の絵で測った値を使う（差し替えで横に跳ばない）。はみ出す分は両側を切る（高さ・下揃えはそのまま）
    // 大きさと高さは身長で決まる（tachieFit。tachie2）。低身長組は足元の木箱を絵の後ろに置く
    const el = side.querySelector('img')!, o = OPAQUE.get(this.sideSel), f = tachieFit(k, b.height), dw = el.naturalHeight ? (el.naturalWidth * f.h) / el.naturalHeight : 0, left = w / 2 - (o ? (o[0] + o[1]) / 2 : 0.5) * dw;
    im.left = `${left}px`; im.height = `${f.h}px`; im.top = `${f.top}px`;
    const cr = side.querySelector<HTMLImageElement>('img.crate')!;
    setCss(cr, 'display', f.crate ? 'block' : 'none');
    if (f.crate) { if (!cr.src.endsWith(CRATE)) cr.src = CRATE; Object.assign(cr.style, { left: `${left + f.crate.left}px`, top: `${f.crate.top}px`, width: `${f.crate.size}px` }); }
  }

  // 先読み: 戦闘画面で DOM に出す画像を、出撃の秒数の間に読み込んでデコードしておく（同じ画像は1回だけ）
  // ドット（HUD・キルログのアイコン、スロットの演出。全キャラで約0.3MB）は全員分。立ち絵（撃破のカットイン。1枚約0.5MB）は名簿のキャラだけ（Bot は戦闘画面に入った時点で決まるので、そこで読む。使うのは最初の撃破から）
  warmed: Set<string> = new Set();
  warmup(s: any) {
    const dots = [...PICKABLE, ...Object.values(BOSS_CHAR), ...Object.keys(C.ASSIST.units)].flatMap((k) => ['idle', 'walk1', 'walk2', 'banzai'].map((f) => DOT(k, f)));
    const tachie = s.roster.filter((r: any) => PICKABLE.includes(r.char)).flatMap((r: any) => ['ko', 'select'].map((f) => TACHIE(r.char, f)));
    for (const u of [...dots, ...tachie]) { if (this.warmed.has(u)) continue; this.warmed.add(u); const im = new Image(); im.src = u; im.decode().catch(() => {}); }
  }

  // 出撃セリフ（hud2 2章）: 出撃の秒数（常設の部屋）が始まったら、自キャラのセリフを1本ランダムに鳴らす（字幕は出さない）。本人の端末だけ（観戦者は自キャラがいないので鳴らない）。言い終わるまで鳴らす（3秒を超えるセリフは戦闘画面に移っても続く）
  sortieSaid = false;
  sortieVoice(s: any) {
    if (s.sortie == null) { if (s.phase === 'waiting') this.sortieSaid = false; return; }
    const char = s.me && s.roster.find((r: any) => r.id === s.me)?.char;
    if (this.sortieSaid || !char) return;
    this.sortieSaid = true;
    (VOICE_TABLE ??= fetch('voice/sortie.json').then((r) => r.json()).catch(() => ({}))).then((t: Record<string, { src: string; text: string }[]>) => {
      const list = t[char];
      if (!list?.length) return;
      const a = new Audio(list[Math.floor(Math.random() * list.length)].src); // プレイヤーキャラのセリフの字幕は出さない（lobby2）
      a.volume = C.VOICE_VOLUME;
      a.play().catch(() => {});
    });
  }

  // キルログ: 倒した側 → 倒された側。1行ずつ KILL_LOG_SEC 秒で消え、KILL_LOG_MAX 件を超えたら古い順に消える
  killLog(kc: string, kt: number, vc: string, vt: number) {
    const el = document.createElement('div');
    el.innerHTML = `${this.icon(kc, kt)}<span>${charName(kc)}</span><span style="color:${css16(TEAM_COLOR[kt])}">▶</span>${this.icon(vc, vt)}<span>${charName(vc)}</span>`; // アイコンの横にキャラ名
    const box = $('.kills');
    box.appendChild(el);
    setTimeout(() => el.remove(), C.KILL_LOG_SEC * 1000);
    while (box.children.length > C.KILL_LOG_MAX) box.firstElementChild!.remove();
  }

  // 画面中央の大きな表示。key が変わったときだけ作り直す（出るときのアニメーションのため）
  banner(key: string, text = '', sub = '', color = '#fff') {
    const el = $('.banner');
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    el.style.display = key ? 'block' : 'none';
    el.style.setProperty('--c', color);
    el.innerHTML = key ? `<b>${text}</b>${sub ? `<small>${sub}</small>` : ''}` : '';
  }

  // 開始の演出: ゲーム画面上の味方4人の横並び（万歳、カメラは寄せる）→ 1人ずつ立ち絵と名前ロゴのカットイン
  introOld(s: any, myTeam: number, sinceSnap: number) {
    const el = $('.intro');
    if (s.phase !== 'intro') { if (this.introKey) { this.introKey = ''; el.style.display = 'none'; el.innerHTML = ''; } return; }
    const allies = s.roster.filter((r: any) => r.team === myTeam);
    const elapsed = C.INTRO_LINEUP + C.TEAM_SIZE * C.INTRO_CUTIN - Math.max(0, s.phaseLeft - sinceSnap);
    const i = Math.min(allies.length - 1, Math.floor((elapsed - C.INTRO_LINEUP) / C.INTRO_CUTIN));
    const key = elapsed < C.INTRO_LINEUP ? 'line' : `cut${i}`;
    if (key === this.introKey) return;
    this.introKey = key;
    el.style.display = 'block';
    el.style.setProperty('--c', css16(TEAM_COLOR[myTeam]));
    if (key === 'line') el.innerHTML = `<div class="ttl">${TEAM_NAME[myTeam]}</div>`;
    else el.innerHTML = `<div class="ttl">${TEAM_NAME[myTeam]}</div><div class="stripe"></div><img class="tc" src="${TACHIE(allies[i].char, 'select')}"><div class="logo">${CHARS[allies[i].char].name}</div>`;
  }

  // 旧開幕のカメラ: 味方の横並びに寄せる
  introCamOld(s: any, myTeam: number, camera: Phaser.Cameras.Scene2D.Camera) {
    if (s.phase === 'intro' && !this.introCam) {
      this.introCam = true;
      const row = s.players.filter((p: any) => p.team === myTeam);
      camera.stopFollow();
      camera.pan(row.reduce((a: number, p: any) => a + p.x, 0) / row.length, row.reduce((a: number, p: any) => a + p.y, 0) / row.length - 16, C.INTRO_CAM_MS, 'Sine.easeInOut');
      camera.zoomTo(C.INTRO_ZOOM, C.INTRO_CAM_MS);
    } else if (s.phase !== 'intro' && this.introCam) { this.introCam = false; camera.zoomTo(1, C.INTRO_CAM_MS); }
  }

  // 新開幕: 入力ロックのまま、カメラがパンで 敵大将 → 味方大将 → 散らかった一角 → 味方全員 → 自キャラ（準備してね）。カウント（3,2,1）から自キャラに追従
  introCamNew(s: any, myTeam: number, sinceSnap: number, camera: Phaser.Cameras.Scene2D.Camera, labelSeen: Set<string>) {
    const I = C.INTRO2, total = I.cuts.reduce((a, [, t]) => a + t, 0);
    if (s.phase !== 'intro') { // カウント中は自キャラに追従（部屋の中を動ける）
      if (this.introCam) { this.introCam = false; this.introCut = ''; }
      this.introBanner = null;
      return;
    }
    this.introCam = true;
    camera.stopFollow();
    const elapsed = total - Math.max(0, s.phaseLeft - sinceSnap);
    let k = 0, acc = I.cuts[0][1];
    while (k < I.cuts.length - 1 && elapsed >= acc) acc += I.cuts[++k][1];
    const cut = I.cuts[k][0];
    const foe = s.bosses.find((b: any) => b.team !== myTeam), own = s.bosses.find((b: any) => b.team === myTeam);
    const allies = s.players.filter((p: any) => p.team === myTeam && !p.assist);
    if (cut !== this.introCut) {
      this.introCut = cut;
      let to = { x: this.me.x, y: this.me.y };
      if (cut === 'enemyBoss' && foe) to = { x: foe.x, y: foe.y - I.lift };
      else if (cut === 'ownBoss' && own) to = { x: own.x, y: own.y - I.lift };
      else if (cut === 'mess' && s.introMess) to = s.introMess;
      else if (cut === 'allies' && allies.length) {
        const xs = allies.map((p: any) => p.x), ys = allies.map((p: any) => p.y);
        to = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 - 16 };
      }
      camera.pan(to.x, to.y, I.panMs, 'Sine.easeInOut'); // カット切り替えはせずパン（拡大率は1のまま）
    }
    // 頭上・画面中央の文字
    if (cut === 'enemyBoss' && foe) this.label('introFoe', '↓やっつけろ！', foe.x, foe.y - I.labelUp, 'introlbl', labelSeen);
    if (cut === 'ownBoss' && own) this.label('introOwn', '↓まもれ！', own.x, own.y - I.labelUp, 'introlbl', labelSeen);
    if (cut === 'mess') for (const m of s.materials) this.label(`pick${m.id}`, '↓ひろって！', m.x, m.y - 14, 'pick', labelSeen); // 「徳を積め」の間、資材それぞれに
    this.introBanner = cut === 'mess' ? ['mess', '徳を積め！'] : cut === 'allies' ? ['allies', 'なかよくしろ！'] : cut === 'ready' ? ['ready', '準備してね'] : null;
  }

  // 画面上部の一覧（左＝陣営0、右＝陣営1）。どちらもアイコン4つを横並び、反省中はグレー
  // 味方: アイコンの下部に体力バー、反省中は復活までの残り秒数を重ねる。アシストは一番左のアイコンの下に（アイコン＋体力バー）。敵: アイコンだけ
  buffHtml = '';
  buffTopOf: string | null = null; // バフ欄の位置を測った時の .r0 の中身
  rosterHud(s: any, myTeam: number, sinceSnap: number) {
    const c = css16(TEAM_COLOR[myTeam]), hp: number[] = [], bar = (p: any) => (hp.push(p ? Math.min(1, p.hp / p.maxHp) : 1), '<span class="hp"><i></i></span>'); // HP バーの長さは骨組みと分けて transform で（HP が変わるたびに HTML を作り直さない）
    const tag = (t: string) => `<em class="pt">${t}</em>`, ut = (r: any) => (r.ult !== null && r.ult !== undefined && r.alive ? tag(C.POWER_TAGS[Math.min(r.ult, C.POWER_TAGS.length - 1)]) : ''); // 強さの札: パワーアップ中は 1〜MAX、アシストは★
    const allies = '<div class="rw">' + s.roster.filter((r: any) => r.team === myTeam).map((r: any) => {
      const p = s.players.find((q: any) => q.id === r.id), alive = p ? p.alive : r.alive;
      return `<div class="mem" style="--c:${c}">${this.icon(r.char, myTeam, !alive)}${alive ? bar(p) : `<b class="rs">${Math.max(0, Math.ceil((p?.respawnIn ?? 0) - sinceSnap))}</b>`}${ut(r)}</div>`;
    }).join('') + '</div>' + s.players.filter((p: any) => p.assist && p.alive && p.team === myTeam).map((p: any) => `<div class="mem as" style="--c:${c}">${this.icon(p.char, myTeam)}${bar(p)}${tag(C.ASSIST_TAGS[Math.min(p.tier, C.ASSIST_TAGS.length - 1)])}</div>`).join(''); // アシスト（撃破されたら消える）
    const foes = '<div class="rw">' + s.roster.filter((r: any) => r.team !== myTeam).map((r: any) => `<div class="mem">${this.icon(r.char, 1 - myTeam, !r.alive)}${ut(r)}</div>`).join('') + '</div>';
    const html = myTeam === 0 ? [allies, foes] : [foes, allies];
    html.forEach((h, k) => { if (h !== this.rosterHtml[k]) { this.rosterHtml[k] = h; $(`.r${k}`).innerHTML = h; } });
    $(`.r${myTeam}`).querySelectorAll<HTMLElement>('.hp i').forEach((e, i) => this.setTf(e, `scaleX(${Math.max(0, hp[i] ?? 1)})`));
  }

  // バフ／デバフ欄（自キャラだけ。常に左上の組のアイコン列の下）: 時間制限つきの状態を名前＋残り秒数で。良い効果は緑、悪い効果は赤。指名手配中は悪行ポイント
  buffHud(s: any, mine: any, myTeam: number, sinceSnap: number) {
    const items: [string, string, boolean][] = []; // 名前, 値, 良い効果か
    if (mine?.alive && s.phase === 'playing') {
      for (const [k, v] of Object.entries((s.buffs ?? {}) as Record<string, number>)) {
        const b = BUFF[k], left = v - sinceSnap;
        if (b && left > 0) items.push([b[0], `${Math.ceil(left)}`, b[1]]);
      }
      if (mine.ult && mine.ult.left !== null && mine.ult.left - sinceSnap > 0) items.push([`パワーアップ${powerText(C.SLOT_MODERN, mine.ult.tier + 1)}`, `${Math.ceil(mine.ult.left - sinceSnap)}`, true]);
      if (s.teams?.[myTeam]?.wanted === s.me) items.push(['指名手配', `悪行${(mine.bad ?? 0).toFixed(1)}`, false]);
    }
    const html = items.map(([n, v, good]) => `<span class="${good ? 'good' : 'bad'}">${n} ${v}</span>`).join('');
    const el = $('.buffs'), r0 = $('.r0');
    if (html !== this.buffHtml) { this.buffHtml = html; el.innerHTML = html; }
    // 位置: 左上の一覧（.r0）の下に自分の情報パネル（上に WANTED の分を空ける）、その下にバフ欄。一覧の中身・パネルの表示が変わった時と、リサイズ等の後だけ測る（毎フレーム測ると DOM を書いた後なので強制レイアウトになる）
    const meP = $('.me'), meOn = !!mine && s.phase !== 'waiting', key = `${this.rosterHtml[0]}|${meOn}`;
    if (key !== this.buffTopOf || this.fxFit > 0) {
      this.buffTopOf = key;
      const z = this.game.scale.zoom, top = r0.getBoundingClientRect().bottom - fx.getBoundingClientRect().top + 4; // 顔パネルは zoom（HUD_SCALE）で大きくしているので、表示上の下端から
      setCss(meP, 'display', meOn ? 'block' : 'none');
      const meTop = top + 13 * z; // WANTED の表記の高さ
      meP.style.top = `${meTop}px`;
      el.style.top = `${meOn ? meTop + meP.offsetHeight + 4 : top}px`;
    }
  }

  // 開始カウント・GAME START・形勢・終了前の残り秒数とカウント・リザルト
  staging(s: any, mine: any, myTeam: number, sinceSnap: number) {
    const now = performance.now();
    if (s.phase === 'playing' && (this.prevPhase === 'countdown' || this.prevPhase === 'intro')) this.timed = { key: 'start', text: C.INTRO_MODE === 'old' ? 'GAME START' : '0', sub: '', color: '#ffe066', until: now + C.GAME_START_MS };
    if (s.phase === 'playing' && mine && s.timeLeft < this.prevTimeLeft) {
      for (const a of C.SITUATION_AT) if (this.prevTimeLeft > a && s.timeLeft <= a) {
        const d = s.teams[myTeam].bossHpRatio - s.teams[1 - myTeam].bossHpRatio;
        const [text, color] = d >= C.SITUATION_DIFF ? ['優勢', '#ffd040'] : d <= -C.SITUATION_DIFF ? ['劣勢', '#6aa8ff'] : ['接戦', '#fff'];
        this.timed = { key: `sit${a}`, text, sub: `残り${a / 60}分`, color, until: now + C.SITUATION_MS };
      }
      for (const a of C.END_WARN_AT) if (this.prevTimeLeft > a && s.timeLeft <= a) this.timed = { key: `warn${a}`, text: `残り${a}秒`, sub: '', color: '#ff8060', until: now + C.SITUATION_MS };
    }
    this.prevPhase = s.phase;
    this.prevTimeLeft = s.timeLeft;
    const left = Math.max(0, s.timeLeft - (s.phase === 'playing' ? sinceSnap : 0));
    if (s.phase === 'ended') {
      const res = s.winner === 2 ? '引き分け' : !mine ? `${TEAM_NAME[s.winner]}の勝ち` : s.winner === myTeam ? '勝利' : '敗北';
      this.banner('result', res, `${TEAM_NAME[0]} ${Math.round(s.teams[0].bossHpRatio * 100)}% − ${Math.round(s.teams[1].bossHpRatio * 100)}% ${TEAM_NAME[1]}`, res === '勝利' ? '#ffd040' : res === '敗北' ? '#6aa8ff' : '#fff');
    } else if (s.phase === 'countdown') {
      const n = Math.max(1, Math.ceil((s.phaseLeft - sinceSnap) * (C.INTRO_MODE === 'old' ? C.INTRO_SPEED : 1))); // 旧開幕は倍速でも 3・2・1、新開幕は実秒数
      this.banner(`cnt${n}`, String(n), C.INTRO_MODE === 'old' ? '部屋から出られるのは GAME START の後' : '', '#fff');
    } else if (s.phase === 'intro' && this.introBanner) {
      this.banner(`intro_${this.introBanner[0]}`, this.introBanner[1], '', '#ffe066');
    } else if (s.phase === 'playing' && left > 0 && left <= C.END_COUNT) this.banner(`end${Math.ceil(left)}`, String(Math.ceil(left)), '', '#ff8060');
    else if (this.timed && now < this.timed.until) this.banner(this.timed.key, this.timed.text, this.timed.sub, this.timed.color);
    else this.banner('');
  }

  // KOした時のカットイン（プレイは止めない）。how: 倒した手段
  cutin(me: string, foe: string, how: string) {
    fx.querySelector('.cut')?.remove(); // 同時KOは最後の1体だけ出す
    const el = document.createElement('div');
    el.className = 'cut';
    el.style.setProperty('--d', `${C.CUTIN_MS}ms`);
    el.innerHTML = `<img class="me" src="${TACHIE(me, 'ko')}"><img class="foe" src="${TACHIE(foe, 'select')}"><div class="how"><b>撃破</b><span>${CHARS[foe].name}</span><span>${how}</span></div>`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), C.CUTIN_MS);
  }

  // ワールド座標に付く一時表示（ダメージ数値・+1・注意）
  popup(text: string, x: number, y: number, cls: string) {
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.textContent = text;
    el.style.setProperty('--d', `${C.POPUP_MS}ms`);
    mapEl.appendChild(el);
    this.pops.push({ el, x, y, until: performance.now() + C.POPUP_MS });
  }

  notify(text: string) {
    const el = document.createElement('div');
    el.textContent = text;
    $('.notes').appendChild(el);
    setTimeout(() => el.remove(), C.NOTIFY_MS);
  }

  // ワールド座標 → fx 内の座標(px)
  // ワールド座標 → #fx 上の位置（transform で動かす。left/top を毎フレーム書くとレイアウトが起きる）。anchor: 要素のどこを合わせるか
  toScreen(x: number, y: number, anchor: string) {
    const cam = this.cameras.main, v = cam.worldView, z = this.game.scale.zoom * cam.zoom;
    return `translate(${((x - v.x) * z).toFixed(1)}px,${((y - v.y) * z).toFixed(1)}px) ${anchor}`;
  }
  // 値が変わった時だけ transform を書く
  setTf(el: HTMLElement, t: string) { if ((el as any)._tf !== t) { (el as any)._tf = t; el.style.transform = t; } }

  // ワールド座標に付く常時表示のラベル（毎フレーム呼んだものだけ残す）
  label(key: string, text: string, x: number, y: number, cls: string, seen: Set<string>) {
    seen.add(key);
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = `lbl ${cls}`;
      mapEl.appendChild(el);
      this.labels.set(key, el);
    }
    if (el.textContent !== text) el.textContent = text;
    this.setTf(el, this.toScreen(x, y, 'translate(-50%,-50%)'));
  }

  lobbyUpdate(s: any) {
    const lobby = document.getElementById('lobby')!;
    lobby.style.display = s.phase === 'waiting' ? 'block' : 'none';
    if (TOUCH) ver.style.visibility = s.phase === 'waiting' ? '' : 'hidden'; // スマホは試合中のHUDと重なるので、ビルド番号はキャラ選択の時だけ出す
    if (s.phase !== 'waiting') return;
    this.centerBar?.();
    // 選択猶予の残り秒数（最初の出撃から。全員に出す）
    const gr = lobby.querySelector<HTMLElement>('.grace')!, gt = s.lobbyLeft == null ? '' : `あと ${Math.ceil(Math.max(0, s.lobbyLeft - (performance.now() - this.snapAt) / 1000))} 秒で出撃`;
    gr.style.display = gt ? 'block' : 'none';
    if (gr.textContent !== gt) gr.textContent = gt;
    const key = JSON.stringify([s.roster, s.me]);
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    const me = s.roster.find((r: any) => r.id === s.me), myTeam = me?.team ?? 0;
    // サーバーの出撃状態に合わせる（陣営を移ると出撃は外れる）
    if (me?.ok) { this.selMode = 'go'; this.selChar = me.char; } else if (this.selMode === 'go') this.selMode = 'sortie';
    if (!this.selChar && me) this.selChar = me.char;
    // 右上: 味方の選択状況（今選んでいるキャラと、選択中／出撃済み）、敵陣営の一覧と陣営の移動
    // 1人1行: 名前（入りきらなければ末尾を「…」）・キャラ名・状態。自分の行は色と★（lobby2: 一覧の幅を狭めたので「あなた（…）」「人間（…）」はやめた）
    const row = (r: any) => `<div class="row${r.id === s.me ? ' self' : ''}"><span class="pn">${r.bot ? 'Bot' : `${r.id === s.me ? '★' : ''}${esc(r.name ?? '')}`}</span><span class="pc">${CHARS[r.char]?.name ?? ''}</span><em style="color:${r.bot || r.ok ? LOBBY_COLOR.ok : LOBBY_COLOR.pending}">${r.bot ? '' : r.ok ? '出撃済み' : '選択中…'}</em></div>`;
    const team = (t: number) => {
      const list = s.roster.filter((r: any) => r.team === t), rows = list.map(row);
      while (rows.length < C.TEAM_SIZE) rows.push('<div class="row"><span>（空き: 開始時にBot）</span></div>');
      const join = me && me.team !== t && list.length < C.TEAM_SIZE ? ` <button data-t="${t}">この陣営に入る</button>` : '';
      return `<b>${TEAM_NAME[t]}</b>${join}${rows.join('')}`;
    };
    document.getElementById('roster')!.innerHTML = `<div class="tm">${team(myTeam)}</div><div class="tm foe">${team(1 - myTeam)}</div>` + (s.me ? '' : '<div>観戦中</div>');
    this.lobbyRender();
  }

  // 待機画面の表示: 段階（選択バー／OK?／OK!）と、選んでいるキャラの立ち絵・名前・ロール・ステータス
  // 表示キャラを切り替え、サーバーへ送る（PICK_SEND_MS に1回まで。最後に表示したキャラを送る）
  showChar(k: string) {
    if (this.selChar === k) return;
    this.selChar = k;
    this.lobbyRender();
    if (!this.pickTimer) this.pickTimer = window.setTimeout(() => { this.pickTimer = 0; if (this.room && this.selChar) sendC2S(this.room, 'pick', { char: this.selChar }); }, PICK_SEND_MS);
  }

  // 練習パネルの表示: 試合中だけ左端のタブと引き出しを出す（タイマーは隠す）。相手・動き・パワーアップはサーバーの値
  prModes: HTMLElement[] | null = null; prMode = ''; // 練習パネルの動きのボタン（参照は一度だけ取る）と、光らせている動き
  practiceHud(s: any) {
    const on = !!s.practice && s.phase === 'playing', prw = $('.prw');
    setCss(prw, 'display', on ? 'block' : 'none');
    setCss($('.timer'), 'visibility', s.practice ? 'hidden' : '');
    if (!on) { if (prw.classList.contains('open')) prw.classList.remove('open'); return; }
    const P = s.practice, lv = (t: number) => (t < 0 ? 'なし' : C.POWER_TAGS[t]);
    setText($('.lv0'), lv(P.lv[0])); setText($('.lv1'), lv(P.lv[1]));
    if (P.mode !== this.prMode) { this.prMode = P.mode; (this.prModes ??= [...$('.prp').querySelectorAll<HTMLElement>('[data-mode]')]).forEach((b) => b.classList.toggle('on', b.dataset.mode === P.mode)); } // 値が変わった時だけ書く
    const sel = $('.pfoe') as HTMLSelectElement;
    if (P.foe && document.activeElement !== sel && sel.value !== P.foe) sel.value = P.foe;
  }

  // 選択画面の立ち絵: 身長に比例した大きさと位置、低身長組は足元の木箱（tachieFit。リサイズの後にも合わせ直す）
  lobbyTachieFit() {
    const lobby = document.getElementById('lobby'), k = lobby?.dataset.k;
    if (!lobby || !k) return;
    const ti = lobby.querySelector<HTMLImageElement>('.tachie')!, cr = lobby.querySelector<HTMLImageElement>('.crate')!, Hp = lobby.clientHeight, f = tachieFit(k, Hp);
    ti.style.height = `${f.h}px`; ti.style.top = `${f.top}px`;
    setCss(cr, 'display', f.crate ? 'block' : 'none');
    if (f.crate && ti.naturalHeight) { const w = (ti.naturalWidth * f.h) / ti.naturalHeight; if (!cr.src) cr.src = CRATE; Object.assign(cr.style, { left: `${lobby.clientWidth / 2 - w / 2 + f.crate.left}px`, top: `${f.crate.top}px`, width: `${f.crate.size}px` }); }
  }
  lobbyRender() {
    const lobby = document.getElementById('lobby')!, k = this.selChar;
    lobby.className = this.selMode + (this.practice ? ' practice' : '');
    document.getElementById('okbtn')!.textContent = this.selMode === 'sortie' ? (this.practice ? '開始' : '出撃') : this.selMode === 'go' ? '出撃済み' : 'OK?';
    setText(lobby.querySelector<HTMLElement>('.ttl')!, this.practice ? '練習: 自分を選ぶ' : TITLE); // 右隣の「タイトルへ」と重ならない長さ
    lobby.querySelectorAll<HTMLElement>('.card').forEach((el) => el.classList.toggle('mine', el.dataset.k === k)); // 枠の強調は表示中のキャラ
    if (!k || lobby.dataset.k === k) return;
    lobby.dataset.k = k;
    const ti = lobby.querySelector<HTMLImageElement>('.tachie')!; ti.onload = () => this.lobbyTachieFit(); ti.src = TACHIE(k, 'select');
    lobby.querySelector('.nm')!.textContent = CHARS[k].name;
    const role = DEFS[k].role;
    lobby.querySelector('.role')!.textContent = `ロール: ${role ? ROLE_LABEL[role] : 'なし'}`;
    const st = charStats(k), bars = (n: number, c: string) => [1, 2, 3, 4, 5].map((i) => `<i style="--c:${i <= n ? c : LOBBY_COLOR.empty}"></i>`).join('');
    const line = (label: string, n: number, c: string) => `<div class="st"><b>${label}</b>${bars(n, c)}</div>`;
    const modeColor = (kind: string) => (kind === 'shot' ? LOBBY_COLOR.shot : LOBBY_COLOR.melee);
    lobby.querySelector('.stats')!.innerHTML = line('HP', st.hp, LOBBY_COLOR.stat)
      + st.aa.map((m) => line(`攻撃（${m.name}）`, m.atk, modeColor(m.kind))).join('')
      + line('速度', st.speed, LOBBY_COLOR.stat)
      + st.aa.map((m) => line(`射程（${m.name}）`, m.range, modeColor(m.kind))).join('')
      + line('技CT', st.ct, LOBBY_COLOR.stat);
    // 技名（技の定義の name）と説明文・パッシブ（chars.ts の desc・passive）
    const d = DEFS[k], esc = (t: string) => t.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);
    lobby.querySelector('.sk')!.innerHTML = `<b>技: ${esc(d.skill.name)}</b><p>${esc(d.desc)}</p>${d.passive ? `<p class="pv">パッシブ: ${esc(d.passive)}</p>` : ''}`;
  }

  // 1点からの視界ポリゴン（壁タイルで遮る）。結果は「4px刻みの判定点を手前から全部調べて最初に壁に入った点」と同一
  // レイが通るタイルを順にたどり（DDA）、判定点は壁タイルの中とタイルの境目付近だけ実際に調べる。床タイルの内側の点は床と分かっているので飛ばす
  // 目の位置・半径・壁が前回と同じなら前回の点をそのまま返す
  visPoly(ex: number, ey: number, R: number) {
    const key = `${ex},${ey},${R}`;
    if (this.visVer !== wallVer) { this.visVer = wallVer; for (const [k, v] of this.visCache) if (!this.visUsed.has(k)) this.visPool.push(v); this.visCache.clear(); }
    const hit = this.visCache.get(key);
    if (hit) { this.visUsed.set(key, hit); return hit; }
    const pts = this.visPool.pop() ?? Array.from({ length: 360 }, () => new Phaser.Math.Vector2());
    const K = Math.ceil(R / 4) - 1, E = 1e-6; // K: R 未満で最後の判定点の番号。E: 境目付近とみなす幅（丸め誤差より十分大きい）
    for (let i = 0; i < 360; i++) {
      const cx = RAY_COS[i], cy = RAY_SIN[i];
      let d = (K + 1) * 4; // 壁がなければ R 以上で最初の判定点
      if (Math.abs(cx) < 1e-3 || Math.abs(cy) < 1e-3) { d = 0; while (d < R && !isWall(ex + cx * d, ey + cy * d)) d += 4; } // 軸に沿うレイは丸め誤差で格子線の上を這うので全点を調べる
      else {
        let tx = Math.floor(ex / T), ty = Math.floor(ey / T), t0 = 0;
        const sx = cx > 0 ? 1 : -1, sy = cy > 0 ? 1 : -1, dx = T / Math.abs(cx), dy = T / Math.abs(cy);
        let mx = ((cx > 0 ? tx + 1 : tx) * T - ex) / cx, my = ((cy > 0 ? ty + 1 : ty) * T - ey) / cy; // 次の縦・横の境目までの距離
        scan: for (;;) {
          const t1 = Math.min(mx, my);
          const lo = wallTile(tx, ty) ? t0 - E : t1 - E; // 壁タイルは中の点すべて、床タイルは出口の境目付近だけ
          for (let k = Math.max(0, Math.ceil(lo / 4)), hi = Math.min(K, Math.floor((t1 + E) / 4)); k <= hi; k++) { const dk = k * 4; if (isWall(ex + cx * dk, ey + cy * dk)) { d = dk; break scan; } }
          if (t1 + E >= K * 4) break;
          if (mx < my) { tx += sx; t0 = mx; mx += dx; } else { ty += sy; t0 = my; my += dy; }
        }
      }
      for (let w = 0; w < T && d < R && isWall(ex + cx * d, ey + cy * d); w += 2) d += 2; // 壁の厚みまで見せる
      pts[i].set(ex + cx * d, ey + cy * d);
    }
    this.visCache.set(key, pts);
    this.visUsed.set(key, pts);
    return pts;
  }

  // 資材: 黄色の箱。高ポイント（裏側）はピンクの大きい箱、高性能の徳（コバコが置く）は水色のさらに大きい箱で、明滅する光をまとう
  // クナイの弾: 弾の向きに回して置く。画面外は描かない
  placeKunai(sh: any) {
    this.kunaiSeen.add(sh.id);
    let im = this.kunais.get(sh.id);
    if (!im) { im = this.add.image(sh.x, sh.y, 'kunai').setDepth(20); this.kunais.set(sh.id, im); }
    im.setPosition(sh.x, sh.y).setRotation(Math.atan2(sh.vy, sh.vx)).setVisible(this.inView(sh.x, sh.y, 10));
  }

  // (x, y) が今のカメラの表示範囲（余白 m px を足す）に入るか。worldView は描画の直前に更新されるので、スクロール位置・ズームから求める。余白は追従の遅れ・揺れの分も含める（画面外は描かない: render_policy 4）
  inView(x: number, y: number, m: number) {
    const c = this.cameras.main, w = c.width / c.zoom, h = c.height / c.zoom, x0 = c.scrollX + (c.width - w) / 2, y0 = c.scrollY + (c.height - h) / 2, M = m + CULL_MARGIN;
    return x >= x0 - M && x <= x0 + w + M && y >= y0 - M && y <= y0 + h + M;
  }

  drawMaterial(g: Phaser.GameObjects.Graphics, x: number, y: number, s = 10, hi = false, big = false) {
    if (hi || big) { const k = 0.5 + 0.5 * Math.sin(performance.now() / 150); g.fillStyle(0xffffff, 0.2 + 0.3 * k).fillCircle(x, y, (big ? 15 : 12) + 4 * k); s = big ? 16 : 14; }
    const [fill, line] = big ? [0x7fe8ff, 0x1d5f8a] : hi ? [0xff7ad9, 0x8a1d6d] : [0xffd700, 0x8a6d00];
    g.fillStyle(fill).fillRect(x - s / 2, y - s / 2, s, s).lineStyle(1, line).strokeRect(x - s / 2, y - s / 2, s, s).lineBetween(x - s / 2, y, x + s / 2, y);
  }

  // 回復アイテム・荷物: 種類ごとのアイコン（丸い台座に白い縁）。荷物はウルト=星、アシスト=人の形
  drawItem(g: Phaser.GameObjects.Graphics, it: any) {
    const c = ITEM_COLOR[it.kind], x = it.x, y = it.y;
    g.fillStyle(0x222233, 0.9).fillCircle(x, y, 9).lineStyle(1.5, 0xffffff).strokeCircle(x, y, 9);
    if (it.kind === 'heal') g.fillStyle(c).fillRect(x - 1.5, y - 5, 3, 10).fillRect(x - 5, y - 1.5, 10, 3); // 十字
    else if (it.kind === 'box_ult') g.fillStyle(c).fillPoints([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => new Phaser.Math.Vector2(x + Math.cos(-Math.PI / 2 + (i * Math.PI) / 5) * (i % 2 ? 2.5 : 6.5), y + Math.sin(-Math.PI / 2 + (i * Math.PI) / 5) * (i % 2 ? 2.5 : 6.5))), true); // 星
    else g.fillStyle(c).fillCircle(x, y - 3, 2.5).fillRect(x - 3.5, y, 7, 5); // 人の形
  }

  update(time: number, dtMs: number) {
    if (this.fxFit > 0) { // #fx をキャンバスに重ねる（リサイズ・拡大率の変更の後だけ測る。毎フレーム測ると強制レイアウトになる）
      this.fxFit--;
      alignCanvas(); // 実画素の境目にそろえる（ドットを均一に）
      this.scale.updateBounds(); // Phaser が覚えているキャンバスの位置を、そろえた後の位置にする（ずれたままだと Phaser が0.5秒ごとに「動いた」と見て resize を出し、測り直しが止まらない。perf6）
      const r = fx.style, b = this.game.canvas.getBoundingClientRect();
      r.left = `${b.left}px`; r.top = `${b.top}px`; r.width = `${b.width}px`; r.height = `${b.height}px`;
      r.setProperty('--z', String(this.game.scale.zoom));
      this.sideFit(b);
      this.lobbyTachieFit(); // 選択画面の立ち絵も枠の大きさに合わせ直す
    }
    const s = this.snap;
    if (!s) return;
    const dt = dtMs / 1000;
    const now = performance.now();
    this.interp.measure = s.phase === 'playing' && !this.measureSent ? this.measure : null;
    if (this.interp.measure) {
      this.interp.measure.beginFrame(this.measureFrameAt === null ? null : now - this.measureFrameAt);
      this.measureFrameAt = now;
      if (now - this.pingAt >= 1000 && (this.pingPending === null || now - this.pingPending > 10000)) {
        this.pingAt = this.pingPending = now;
        sendC2S(this.room, 'netPing', { id: this.measureId, at: now });
      }
    }
    const k = this.keys;
    const { dx, dy } = this.ctl.move({ up: k.W.isDown, down: k.S.isDown, left: k.A.isDown, right: k.D.isDown });
    if (dx || dy) this.face = Math.atan2(dy, dx);
    // 入力は NET_STEP ごとに番号を付けて送り、同時に自キャラを予測で動かす
    const me0 = s.players.find((p: any) => p.id === s.me);
    this.acc = Math.min(this.acc + dtMs, 250);
    while (this.acc >= C.NET_STEP * 1000) {
      this.acc -= C.NET_STEP * 1000;
      const move = !!me0 && me0.alive && MOVE_PHASES.includes(s.phase) && !me0.stunned && !me0.lock; // 移動不可の状態（突撃など）は予測で動かさない
      sendC2S(this.room, 'input', { ...this.pred.step(dx, dy, me0?.spd ?? 0, this.obstacles(s, me0), move), rt: this.interp.renderTime(performance.now()) }); // rt: この画面の時刻（サーバーの近接AAの巻き戻し判定）
    }
    this.practice = !!s.practice;
    if ((this.lastPhase === 'ended' || (this.practice && this.lastPhase === 'playing')) && s.phase === 'waiting') { this.resetMatch(); this.selMode = 'browse'; this.lobbyKey = ''; commentary.clear(); } // 連戦（練習は「選択画面へ」）は選択バー（未出撃）から。名簿が前と同じでも描き直す。実況は打ち切る
    this.lastPhase = s.phase;
    this.lobbyUpdate(s);

    if (s.bossRooms && s.bossRooms.join() !== this.homesKey) { this.homesKey = s.bossRooms.join(); this.applyHomes(s.bossRooms); }
    // 壁破壊の反映（タイル・ミニマップ・移動予測の壁）
    if (s.broken.length > this.brokenN) {
      const rects: number[][] = []; // 描き直した矩形（px。GPU へ送る範囲）
      for (const [x, y] of s.broken.slice(this.brokenN)) {
        const ck = y * MAP.width + x, cb = this.cracks.get(ck);
        if (cb) { cb.destroy(); this.cracks.delete(ck); } // 割れ目を消す
        tiles[y] = tiles[y].slice(0, x) + '.' + tiles[y].slice(x + 1);
        wallVer++;
        paintMap(this.mapTex.context, this.chips, tiles, x - 2, y - 2, x + 2, y + 2); // そのマスと周りのオートタイル・壁の正面
        rects.push([(x - 2) * T, (y - 2) * T, (x + 3) * T, (y + 3) * T]);
        this.miniTex.context.fillStyle = '#8a8478';
        this.miniTex.context.fillRect(x * MINI, y * MINI, MINI + 0.2, MINI + 0.2);
      }
      this.miniTex.refresh(); this.mapSub(rects);
      this.walls = wallRects(tiles);
      this.seeWalls = seeRects(tiles);
      this.brokenN = s.broken.length;
    }
    this.cullCracks();

    // 自キャラの移動予測
    const mine = s.players.find((p: any) => p.id === s.me);
    if (mine) {
      if (!mine.alive) this.face = mine.face;
      // その場で止まる lock（still）は補間に切り替えず、今の表示位置からサーバーの位置へなめらかに寄せる（補間は0.25秒前の位置なので後ろへ飛ぶ）。サーバーが動かす lock は補間
      const step = (C.NET_CORR_SPEED * dtMs) / 1000, gap = Math.hypot(mine.x - this.me.x, mine.y - this.me.y);
      const rp = mine.lock && mine.still && this.me.init ? (gap <= step ? mine : { x: this.me.x + ((mine.x - this.me.x) / gap) * step, y: this.me.y + ((mine.y - this.me.y) / gap) * step })
        : mine.lock ? (this.interp.at(mine.id, now) ?? mine) : this.pred.render(this.acc / (C.NET_STEP * 1000), dtMs);
      Object.assign(this.me, { x: rp.x, y: rp.y, init: true });
    }
    const myTeam = mine?.team ?? 0;
    const sinceSnap = (now - this.snapAt) / 1000;
    const labelSeen = new Set<string>();
    // 対象のid（p:/boss:/c:/e:）→ 描画位置（自キャラは this.me、他キャラ・大将・コバコは補間の位置。ユニットの描画と同じ）
    const thingPos = (id: string | null): { x: number; y: number } | null => {
      if (!id) return null;
      const k = id.slice(0, id.indexOf(':')), v = id.slice(id.indexOf(':') + 1);
      if (k === 'p') { const q = s.players.find((q: any) => q.id === v); return q ? (q.id === s.me ? this.me : (this.interp.at(q.id, now) ?? q)) : null; }
      if (k === 'boss') { const b = s.bosses.find((b: any) => String(b.team) === v); return b ? (this.interp.at('boss' + b.team, now) ?? b) : null; }
      if (k === 'c') { const c = s.couriers.find((c: any) => String(c.id) === v); return c ? (this.interp.at('c' + c.id, now) ?? c) : null; }
      if (k === 'e') return s.ents.find((e: any) => String(e.id) === v) ?? null;
      return null;
    };

    // ユニット描画（受信したものだけ）
    const seen = new Set<string>();
    const feet = this.feet.clear();
    const draw = (id: string, char: string, team: number, x: number, y: number, face: number, hp: number, maxHp: number, alpha: number, scale: number, p?: any) => {
      seen.add(id);
      let e = this.units.get(id);
      if (!e || e.char !== char) {
        e?.s.destroy(); e?.aura?.destroy();
        e = { s: this.add.sprite(x, y, `${char}_idle`).setOrigin(0.5, 0.85).setScale(scale), char, tx: x, ty: y, blinkAt: time + 1000 + Math.random() * 4000, flashUntil: 0 };
        this.units.set(id, e);
      }
      const isMe = id === s.me;
      const cx = x, cy = y; // 他キャラは補間済みの位置
      const moving = isMe ? MOVE_PHASES.includes(s.phase) && alpha === 1 && (dx || dy) : Math.hypot(cx - e.tx, cy - e.ty) > 0.3;
      e.tx = cx; e.ty = cy;
      const sp = e.s, vs = views(p), frame = vs.find((v) => v.frame)?.frame, bare = vs.some((v) => v.bare); // 状態による見た目の差し替え・目印なし
      if (frame) sp.stop().setTexture(`${char}_${frame}`);
      else if (s.phase === 'intro' && p && C.INTRO_MODE === 'old') sp.stop().setTexture(`${char}_banzai`); // 旧開幕は万歳
      else if (moving && walkOf(char) === 'normal') sp.play(`${char}_walk`, true); // 歩行タイプ（chars.ts の walk）
      else if (moving && walkOf(char) === 'hover') sp.stop().setTexture(`${char}_walk1`);
      else if (!sp.anims.isPlaying && sp.texture.key !== `${char}_idle`) sp.setTexture(`${char}_idle`); // 万歳・ホバー・状態の差し替えから戻す
      else if (sp.anims.isPlaying && sp.anims.currentAnim?.key === `${char}_walk`) sp.stop().setTexture(`${char}_idle`);
      else if (time >= e.blinkAt) { sp.play(`${char}_blink`); e.blinkAt = time + 2000 + Math.random() * 4000; } // ときどき瞬き
      const f = isMe ? this.face : face;
      sp.setPosition(Math.round(cx), Math.round(cy)).setFlipX(Math.cos(f) > 0.01).setAlpha(alpha).setDepth(10 + cy / 10000);
      // パワーアップ中: 背後に自身のドットを拡大して半透明で重ねる（大きさはレベルごと）
      if (p?.alive && p.ult && p.ult.left !== null) {
        e.aura ??= this.add.sprite(cx, cy, sp.texture.key).setOrigin(0.5, 0.85);
        e.aura.setTexture(sp.texture.key).setPosition(sp.x, sp.y).setFlipX(sp.flipX).setScale(C.DOT_SCALE * C.POWERUP_AURA.scale[Math.min(p.ult.tier, C.POWERUP_AURA.scale.length - 1)]).setAlpha(C.POWERUP_AURA.alpha).setDepth(sp.depth - 0.001).setVisible(true);
      } else e.aura?.setVisible(false);
      // 足元の陣営色と頭上のHP（撃破の演出中は出さない）
      const h = sp.displayHeight * 0.85;
      if (p && !p.alive) return;
      const onScr = this.inView(cx, cy, h + 30); // 足元・HP バーなどの図形は画面外なら描かない（30: HP バー・輪の分）
      if (!bare && onScr) feet.fillStyle(teamColor(team), isMe ? 0.9 : 0.5).fillEllipse(cx, cy, 18 * scale, 7 * scale);
      const tagL = p?.ult && p.ult.left !== null ? C.POWER_TAGS[Math.min(p.ult.tier, C.POWER_TAGS.length - 1)] : p?.assist ? C.ASSIST_TAGS[Math.min(p.tier, C.ASSIST_TAGS.length - 1)] : null; // 強さの札（パワーアップ中 1〜MAX、アシスト★）
      this.placeTag(id, alpha === 1 && !bare && s.phase !== 'finale' && onScr ? tagL : null, cx + 12, cy - h - 3.5); // HP バーの右
      const hpV = this.interp.hpAt(id, now) ?? hp; // 頭上の HP バーと被弾の演出は描く時刻（弾・他キャラと同じ NET_INTERP_DELAY 前）の HP で
      if (alpha === 1 && !bare && s.phase !== 'finale' && onScr) feet.fillStyle(0x000000, 0.6).fillRect(cx - 10, cy - h - 5, 20, 3).fillStyle(teamColor(team)).fillRect(cx - 10, cy - h - 5, 20 * Math.max(0, Math.min(1, hpV / maxHp)), 3);
      // 被弾: 点滅（全段階）とダメージ数値。被弾側の最大HP比で 小=点滅だけ、中=ダメージ量に比例した着弾エフェクト、大=派手な着弾エフェクト＋揺れ（HIT_FX）
      if (e.hp !== undefined && hpV < e.hp) {
        const ratio = (e.hp - hpV) / maxHp;
        e.flashUntil = time + C.HIT_FLASH_MS;
        this.popup(String(Math.round(e.hp - hpV)), cx, cy - h - 6, 'dmg');
        if (ratio >= C.HIT_FX.mid) this.hits.push({ x: cx, y: cy - h / 2, ratio, big: ratio >= C.HIT_FX.big, t0: time, seed: Math.random() * 6.283 });
        if (ratio >= C.HIT_FX.big) { e.shakeUntil = time + C.HIT_FX.shakeMs; if (isMe) this.cameras.main.shake(C.HIT_FX.shakeMs, C.HIT_FX.cam); }
      }
      e.hp = hpV;
      if (e.shakeUntil && time < e.shakeUntil) sp.x += Math.round(C.HIT_FX.amp * ((e.shakeUntil - time) / C.HIT_FX.shakeMs) * Math.sin(time * 0.09)); // 大ダメージ: 左右に揺れて収まる
      if (time < e.flashUntil && Math.floor((e.flashUntil - time) / C.HIT_BLINK_MS) % 2 === 0) sp.setTintFill(0xffffff); // 被弾は白く点滅（状態による点滅は状態の目印で上書き）
      else sp.clearTint();
      if (!p || bare) return;
      // 指名手配: 頭上に手配マーク
      if (p.alive && s.teams[p.team]?.wanted === p.id) this.label(`wanted${id}`, '★手配★', cx, cy - h - 30, 'wanted', labelSeen);
      if (p.boost && onScr) feet.lineStyle(2, SKILL_FX_COLOR.heal, 0.9).strokeEllipse(cx, cy, 30, 12); // 白上虎太郎の移動速度上昇
      if (p.slow && onScr) feet.lineStyle(2, SKILL_FX_COLOR.pen_slow, 0.9).strokeEllipse(cx, cy + 2, 24, 8); // 罰: 移動速度低下（足元の青い輪）
      if (p.weak && onScr) { feet.fillStyle(SKILL_FX_COLOR.pen_weak, 0.9).fillTriangle(cx + 9, cy - h + 2, cx + 15, cy - h + 2, cx + 12, cy - h + 8); feet.fillRect(cx + 11, cy - h - 4, 2, 6); } // 罰: 攻撃力低下（下向きの矢印）
      // 状態の目印（client/skills）
      sp.setVisible(true);
      for (const k in STATUS_VIEW) if (p.st?.[k]) STATUS_VIEW[k].mark?.(feet, { x: cx, y: cy, sp, time, v: p.st[k] });
      // ウルト中: 見た目は変えず、変身先の色の光をまとう
      if (p.ult && p.ult.left !== null) {
        const pulse = 0.5 + 0.3 * Math.sin(time / 120);
        if (onScr) feet.lineStyle(3, ULT_COLOR[p.ult.form], pulse).strokeCircle(cx, cy - h / 2, 20).lineStyle(1, 0xffffff, pulse).strokeCircle(cx, cy - h / 2, 23);
      }
      // アシスト: 半透明の縁取りと頭上の「ASSIST」
      if (p.assist) {
        sp.setAlpha(0.8);
        if (onScr) feet.lineStyle(2, ITEM_COLOR.assist, 0.6).strokeRoundedRect(cx - 14, cy - h - 2, 28, h + 6, 5);
        this.label(`assist${id}`, 'ASSIST', cx, cy - h - 14, '', labelSeen); // 強さは HP バーの右の★の札
      }
    };
    const K = C.KO_FX, dying: { p: any; x: number; y: number; ko: number }[] = []; // 撃破の演出中（揺れ・大爆発）
    const fin = s.phase === 'finale' ? s.finale : null, F = C.FINALE; // 決着演出（サーバーの段）
    for (const p of s.players) {
      const pos = p.id === s.me ? this.me : (this.interp.at(p.id, now) ?? p);
      const ko = p.alive ? 0 : p.ko + sinceSnap;
      if (!p.alive && (p.ko === null || ko >= K.shake + K.boom)) continue; // 爆発の後は復活まで描かない
      if (!p.alive) dying.push({ p, x: pos.x, y: pos.y, ko });
      if (!p.alive && ko >= K.shake) continue; // 大爆発でキャラが消える
      const sx = p.alive ? 0 : K.amp * (1 - ko / K.shake) * Math.sin(ko * K.hz * Math.PI * 2); // 左右に揺れて収まる
      draw(p.id, p.char, p.team, pos.x + sx, pos.y, p.face, p.hp, p.maxHp, 1, p.assist ? C.DOT_SCALE * C.ASSIST.scale : C.DOT_SCALE, p); // アシストは大将と同じ大きさ
    }
    for (const b of s.bosses) {
      // 倒された大将: 決着演出の爆発の揺れの間は揺れ、大爆発で消える（決着後も出さない）
      let bx = 0;
      if (b.hp <= 0 && (fin || s.phase === 'ended')) {
        const ko = fin?.stage === 'slow' ? -1 : fin?.stage === 'boss' ? ((fin.t + sinceSnap - F.cam) / F.boom) * (K.shake + K.boom) : Infinity;
        if (ko >= K.shake) continue;
        if (ko >= 0) bx = K.amp * F.bossScale * (1 - ko / K.shake) * Math.sin(ko * K.hz * Math.PI * 2);
      }
      const q = this.interp.at('boss' + b.team, now) ?? b;
      draw('boss' + b.team, BOSS_CHAR[b.team], b.team, q.x + bx, q.y, b.team === 0 ? 0 : Math.PI, b.hp, C.BOSS_HP, 1, C.DOT_SCALE * 2);
    }
    // ブイブイ・コバコ（中立）: 進む向きを見て、頭上に荷物の中身のアイコン
    for (const c of s.couriers) {
      const id = 'c' + c.id, q = this.interp.at(id, now) ?? c, u = this.units.get(id);
      const f = u && Math.abs(q.x - u.tx) > 0.1 ? (q.x > u.tx ? 0 : Math.PI) : u?.s.flipX ? 0 : Math.PI;
      draw(id, COURIER_CHAR, -1, q.x, q.y, f, 1, 1, 1, C.DOT_SCALE);
      if (this.inView(q.x, q.y - 54, 11)) this.drawItem(feet, { kind: `box_${c.box}`, x: q.x, y: q.y - 54 });
    }
    for (const [id, e] of this.units) {
      if (!seen.has(id)) { e.s.destroy(); e.aura?.destroy(); this.units.delete(id); }
    }
    for (const [id, im] of this.tags) if (!this.tagSeen.has(id)) { im.destroy(); this.tags.delete(id); } // 描かなかったキャラの札を片付ける
    this.tagSeen.clear();
    // カメラ: 開始演出は味方の横並びに寄せる。ミニマップを押している間はその位置（離したら即座に自キャラへ）。撤退中は WASD で視点だけ動かす（壁に関係なく）。それ以外は自キャラに追従
    const camera = this.cameras.main, meUnit = this.units.get(s.me);
    const freeCam = !!mine && !mine.alive && s.phase === 'playing' && (mine.ko === null || mine.ko + sinceSnap >= C.RESPAWN_BASE); // 撃破の演出（絞り切るまで）はカメラを自キャラの位置のまま
    if (C.INTRO_MODE === 'old') this.introCamOld(s, myTeam, camera);
    else this.introCamNew(s, myTeam, sinceSnap, camera, labelSeen);
    const fcam = s.phase === 'finale'; // 決着演出のカメラ（finaleView）
    const spec = !mine && s.phase !== 'waiting' && !this.introCam && !fcam ? s.spec : null; // 観戦者: 実況追従はフォーカスの対象へ、それ以外は自由視点（撤退中の視点移動と同じ操作）
    const mmOn = !!this.mmCam && !this.introCam && s.phase !== 'waiting' && !fcam;
    setCss($('.mm'), 'display', this.introCam || s.phase === 'waiting' ? 'none' : 'block');
    if (mmOn) camera.stopFollow();
    else if (this.mmHeld && meUnit && !freeCam && !fcam) { camera.centerOn(meUnit.s.x, meUnit.s.y); camera.startFollow(meUnit.s, true, C.CAM_LERP, C.CAM_LERP); }
    else if (this.mmHeld && freeCam) camera.centerOn(this.me.x, this.me.y);
    this.mmHeld = mmOn;
    if (mmOn) camera.centerOn(this.mmCam!.x, this.mmCam!.y);
    else if (freeCam) {
      camera.stopFollow();
      camera.scrollX += dx * C.FREE_CAM_SPEED * dt; camera.scrollY += dy * C.FREE_CAM_SPEED * dt;
    } else if (spec?.view === 'focus') {
      const fu = spec.focus && this.units.get(spec.focus); // フォーカスなしの間は直前の位置のまま
      if (fu && (camera as any)._follow !== fu.s) camera.startFollow(fu.s, true, C.CAM_LERP, C.CAM_LERP);
    } else if (spec) {
      camera.stopFollow();
      camera.scrollX += dx * C.FREE_CAM_SPEED * dt; camera.scrollY += dy * C.FREE_CAM_SPEED * dt;
    } else if (meUnit && !this.introCam && !fcam && (camera as any)._follow !== meUnit.s) camera.startFollow(meUnit.s, true, C.CAM_LERP, C.CAM_LERP);
    this.finaleView(s, sinceSnap, camera);
    // 観戦者: 視点のボタン、打ち切りのカウントダウン。自キャラ用のボタン（帰還・照準）は出さない
    const specUi = !mine && s.phase !== 'waiting' && !!s.spec;
    setCss($('.spec'), 'display', specUi ? 'flex' : 'none');
    if (specUi) for (const b of $('.spec').querySelectorAll<HTMLElement>('button')) b.classList.toggle('on', b.dataset.v === String(s.spec.view));
    for (const q of ['.rc', '.aimb']) setCss($(q), 'display', mine ? '' : 'none');
    const ab = specUi && s.spec.abandon !== null ? `プレイヤーがいなくなりました。${s.spec.abandon}秒後選択画面に戻ります` : '';
    setCss($('.aband'), 'display', ab ? 'block' : 'none'); setText($('.aband'), ab);
    // 画面に固定の表示（フォグ・ミニマップ）はカメラの拡大で崩れるので、開始演出の間は隠す
    this.miniImg.setVisible(!this.introCam && !fcam); this.ui.setVisible(!this.introCam && !fcam);

    // 自キャラ: 射程の円と、硬直中のクールタイムバー
    if (mine?.alive && s.phase !== 'finale') {
      feet.lineStyle(1, 0xffffff, C.RANGE_ALPHA).strokeCircle(this.me.x, this.me.y, aaRange(mine.char)); // 通常攻撃の最長射程（近接と遠距離を持つキャラは遠距離）
      // 今狙っている対象の足元に輪
      const tp = thingPos(mine.tgt);
      if (tp) feet.lineStyle(2, 0xff3030, C.TARGET_RING_ALPHA).strokeEllipse(tp.x, tp.y, 28, 11);
      // リコールの溜め: 自キャラの上にゲージ
      if (mine.recall !== null) {
        const k = Math.min(1, mine.recall + sinceSnap / C.RECALL_HOLD);
        feet.fillStyle(0x000000, 0.6).fillRect(this.me.x - 14, this.me.y - 50, 28, 4).fillStyle(0x66ccff).fillRect(this.me.x - 14, this.me.y - 50, 28 * k, 4);
        this.label('recall', '帰還', this.me.x, this.me.y - 56, '', labelSeen);
      }
      const cd = mine.cd - sinceSnap;
      if (cd > 0) feet.fillStyle(0x000000, 0.6).fillRect(this.me.x - 10, this.me.y + 5, 20, 3).fillStyle(0xffffff).fillRect(this.me.x - 10, this.me.y + 5, 20 * Math.min(1, cd / mine.cdMax), 3);
    }

    const fxG = this.fxG.clear();
    const sweatPos = (id: string | undefined) => {
      if (!id) return null;
      const pos = thingPos(id), [kind, value] = id.split(':');
      if (!pos) return null;
      if (kind === 'p' && !s.players.find((p: any) => p.id === value)?.alive) return null;
      if (kind === 'boss' && !(s.bosses.find((b: any) => String(b.team) === value)?.hp > 0)) return null;
      const key = kind === 'p' ? value : kind === 'boss' ? `boss${value}` : kind === 'c' ? `c${value}` : null;
      if (!key) return pos;
      const sprite = this.units.get(key)?.s;
      return seen.has(key) && sprite?.visible ? { x: sprite.x, y: sprite.y } : null;
    };
    // 技の範囲エフェクト
    const later: any[] = [];
    for (const f0 of this.fxQueue) {
      if (f0.at !== undefined && !this.interp.reached(f0.at, now)) { later.push(f0); continue; }
      const target = f0.kind === 'sweat' ? sweatPos(f0.target) : null;
      if (f0.kind === 'sweat' && !target) continue;
      const f = target ? { ...f0, ...target } : f0.kind === 'slash' && f0.who === s.me ? { ...f0, x: this.me.x, y: this.me.y } : f0; // 自分の斬撃は画面の自キャラの位置から（向き・射程・角度はサーバーの値）
      const dv = `${f.d > 0 ? '+' : '−'}${Math.abs(f.d).toFixed(2).replace(/0$/, '')}`;
      if ((f.kind === 'slash' && !(f.color && FX_VIEW[f.color])) || f.kind === 'sweat') this.aaFx(f); // 通常攻撃の斬撃・汗（color の描画があれば技の fx の層で描く）
      else if (f.kind === 'toku') this.popup(`徳${dv}`, f.x, f.y - 34, f.d > 0 ? (f.hi ? 'plus hi' : 'plus') : 'dmg'); // 徳の増減を頭上に（すべて「徳±XX」だけ。高ポイントはピンク）
      else this.skillFx.push({ ...f, t0: time });
    }
    this.fxQueue = later;
    this.sweatFx = this.sweatFx.filter((f) => {
      const pos = sweatPos(f.target), age = (time - f.born) / C.SWEAT_MS;
      if (!pos || age >= 1) { f.sp.destroy(); return false; }
      f.sp.setPosition(pos.x + 9, pos.y - 30 + 8 * age * age).setAlpha(1 - age * age);
      return true;
    });
    const fxMs = (f: SkillFx) => (f.kind === 'recall' ? C.RECALL_FX_MS : (f.color && FX_VIEW[f.color]?.ms) || C.SKILL_FX_MS);
    this.skillFx = this.skillFx.filter((f) => time - f.t0 < fxMs(f));
    for (const f of this.skillFx) {
      const v = f.color && FX_VIEW[f.color];
      if (v) { v.draw(fxG, f, time, (time - f.t0) / fxMs(f), s, thingPos); continue; } // 技ごとの描画（client/skills）
      if (f.kind === 'recall') { // リコールの跡: 光の柱が細くなって消え、足元の輪が広がる
        const k = (time - f.t0) / C.RECALL_FX_MS, w = 22 * (1 - k);
        fxG.fillStyle(0x66ccff, 0.5 * (1 - k)).fillRect(f.x - w / 2, f.y - 60 * (1 - k * 0.5), w, 60 * (1 - k * 0.5) + 4).fillStyle(0xffffff, 0.8 * (1 - k)).fillRect(f.x - w / 6, f.y - 56 * (1 - k * 0.5), w / 3, 56 * (1 - k * 0.5));
        fxG.lineStyle(2, 0x66ccff, 1 - k).strokeEllipse(f.x, f.y, 16 + 40 * k, 6 + 14 * k);
        continue;
      }
      const al = 0.5 * (1 - (time - f.t0) / C.SKILL_FX_MS), col = SKILL_FX_COLOR[f.color ?? f.kind];
      if (f.kind === 'ring') fxG.lineStyle(3, col, al * 1.6).strokeCircle(f.x, f.y, f.r);
      if (f.kind === 'aura') fxG.fillStyle(col, al * 0.6).fillCircle(f.x, f.y, f.r).lineStyle(2, col, al * 1.6).strokeCircle(f.x, f.y, f.r);
      if (f.kind === 'wall') {
        fxG.fillStyle(col, al).fillCircle(f.x, f.y, f.r);
        for (const [x, y] of f.tiles) fxG.fillStyle(col, Math.min(1, al * 1.8)).fillRect(x * T, y * T, T, T);
      }
      if (f.kind === 'rect') {
        const ux = Math.cos(f.a), uy = Math.sin(f.a), h = f.w / 2;
        fxG.fillStyle(col, al * 1.2).fillPoints([[0, -h], [f.len, -h], [f.len, h], [0, h]].map(([u, v]) => new Phaser.Math.Vector2(f.x + ux * u - uy * v, f.y + uy * u + ux * v)), true);
      }
      if (f.kind === 'beam') fxG.lineStyle(2, col, Math.min(1, al * 2)).lineBetween(f.x, f.y, f.x2, f.y2); // ファンネルの射撃
      if (f.kind === 'arc') fxG.fillStyle(col, al * 1.4).slice(f.x, f.y, f.r, f.a - f.arc / 2, f.a + f.arc / 2).fillPath();
    }
    // 撃破の演出: 揺れている間はあちこちで小爆発、揺れが収まると大爆発（横2キャラ・縦1.5キャラ分）
    for (const d of dying) this.koBoom(fxG, d, d.ko, d.p.id.length, d.p.assist ? C.ASSIST.scale : 1); // アシストは表示倍率（DOT_SCALE × ASSIST.scale と DOT_SCALE の比）
    // 決着演出: 倒された大将の爆発（撃破の演出 KO_FX の時間を FINALE.boom 秒に伸ばし、大きさを bossScale 倍）
    if (fin?.stage === 'boss' && fin.boss) { const t = fin.t + sinceSnap - F.cam; if (t >= 0) this.koBoom(fxG, fin.boss, (t / F.boom) * (K.shake + K.boom), 7, F.bossScale); }
    // 被ダメージの着弾エフェクト: 撃破の小爆発と同じ橙・黄の円が広がって消え、火花が飛び散る。大きさ・火花の数はダメージ量（最大HP比）に比例。大は白い閃光の輪と大きな火花を足す
    const HF = C.HIT_FX;
    this.hits = this.hits.filter((h) => time - h.t0 < (h.big ? HF.bigMs : HF.ms));
    for (const h of this.hits) {
      const k = (time - h.t0) / (h.big ? HF.bigMs : HF.ms), e = 1 - (1 - k) ** 3, r = (HF.r0 + HF.r * Math.min(1, h.ratio)) * (h.big ? HF.bigScale : 1);
      fxG.fillStyle(0xff6020, 0.85 * (1 - k)).fillCircle(h.x, h.y, r * (0.4 + 0.6 * e)).fillStyle(0xffe066, 1 - k).fillCircle(h.x, h.y, r * 0.55 * (1 - k * 0.5));
      if (h.big) fxG.lineStyle(3, 0xffffff, 1 - k).strokeCircle(h.x, h.y, r * (0.6 + 1.2 * e));
      const n = h.big ? HF.bigSparks : Math.round(HF.sparks + HF.sparksPer * h.ratio);
      for (let i = 0; i < n; i++) {
        const a = h.seed + (i / n) * Math.PI * 2 + Math.sin(i * 7.7) * 0.4, d0 = r * (0.5 + e * (1.3 + 0.5 * Math.sin(i * 3.1))), d1 = d0 + r * 0.45 * (1 - k);
        fxG.lineStyle(h.big ? 2.5 : 1.5, i % 2 ? 0xffe066 : 0xffffff, 1 - k).lineBetween(h.x + Math.cos(a) * d0, h.y + Math.sin(a) * d0, h.x + Math.cos(a) * d1, h.y + Math.sin(a) * d1);
      }
    }
    // アシストの範囲攻撃・大将の広範囲攻撃の予告: 赤い円が満ちていく
    for (const w of s.warns) {
      const k = Math.max(0, Math.min(1, 1 - (w.left - sinceSnap) / (w.boss ? C.BOSS_BLAST.warn : 1)));
      fxG.fillStyle(0xff2020, 0.18).fillCircle(w.x, w.y, w.r).fillStyle(0xff2020, 0.35).fillCircle(w.x, w.y, w.r * k).lineStyle(2, 0xff2020, 0.9).strokeCircle(w.x, w.y, w.r);
    }
    // 状態のエフェクト（突撃の警告・渦など）と、技の場の物（client/skills）
    for (const p of s.players) {
      if (!p.alive) continue;
      const pos = p.id === s.me ? this.me : (this.interp.at(p.id, now) ?? p);
      for (const k in STATUS_VIEW) if (p.st?.[k]) STATUS_VIEW[k].fx?.(fxG, { x: pos.x, y: pos.y, time, v: p.st[k] });
    }
    for (const m of CLIENT_SKILLS) m.frame?.(fxG, time);
    // 技が使える間だけの本人の画面の描画（技ボタンが OK と同じ条件: 試合中・生存・CT明け・技を使えない状態でない）
    const selfView = mine && SELF_VIEW[mine.char];
    if (selfView && !mine.assist && mine.alive && s.phase === 'playing' && mine.skillCd - sinceSnap <= 0 && !Object.keys(STATUS_VIEW).some((k) => mine.st?.[k] && STATUS_VIEW[k].hud))
      selfView(fxG, { me: this.me, s, myTeam, time, pos: (id: string) => this.interp.at(id, now) });
    this.aimArrow(fxG, mine);
    for (const kind in ENT_VIEW) if (ENT_VIEW[kind].layer === 'fx') for (const e of s.ents) if (e.kind === kind) ENT_VIEW[kind].draw(fxG, e, time, teamColor(e.team), thingPos);
    this.kunaiSeen.clear();
    this.interp.shotsAt('shot:', now, (k, x, y) => { // 弾も他キャラと同じ時刻（NET_INTERP_DELAY 前）で描く
      const sh = this.shotData.get(Number(k.slice(5)));
      if (!sh) return;
      sh.x = x; sh.y = y;
      if (SHOT_VIEW[sh.kind]) { SHOT_VIEW[sh.kind](fxG, sh, time); return; } // 技の弾（client/skills）
      if (sh.kind === 'kunai') { this.placeKunai(sh); return; } // クナイ: 起動時に作った絵を Image で置く
      if (sh.kind === 'cannon') fxG.fillStyle(0xc87a3a).fillCircle(sh.x, sh.y, 5).lineStyle(1, 0x5a3010).strokeCircle(sh.x, sh.y, 5); // きりたん砲
      else fxG.fillStyle(0x8fdf5f).fillCircle(sh.x, sh.y, C.BULLET_RADIUS).lineStyle(1, 0x2f6f1f).strokeCircle(sh.x, sh.y, C.BULLET_RADIUS);
    });
    for (const [id, im] of this.kunais) if (!this.kunaiSeen.has(id)) { im.destroy(); this.kunais.delete(id); } // 消えた弾の絵を片付ける


    const g = this.g.clear();
    // 自陣の大将の候補部屋の縁取り
    if (mine) for (const h of this.homes[myTeam]) g.lineStyle(3, TEAM_COLOR[myTeam], 0.9).strokeRect(h.x + 2, h.y + 2, h.w - 4, h.h - 4);
    for (const m of s.materials) if (this.inView(m.x, m.y, 20)) this.drawMaterial(g, m.x, m.y, 10, m.hi, m.big); // 20: 光る資材の光の半径（最大19px）
    for (const it of s.items) {
      if (this.inView(it.x, it.y, 11)) this.drawItem(g, it); // 11: 台座の半径＋縁
      this.label(`item${it.id}`, ITEM_LABEL[it.kind], it.x, it.y - 15, '', labelSeen);
    }
    for (const kind in ENT_VIEW) if (ENT_VIEW[kind].layer === 'ground') for (const e of s.ents) if (e.kind === kind) ENT_VIEW[kind].draw(g, e, time, teamColor(e.team), thingPos);

    // 視界（観戦者はフォグなし）
    const vg = this.visG;
    const fogTeam = mine ? myTeam : s.spec?.view === 0 || s.spec?.view === 1 ? s.spec.view : null; // 観戦者の「組の視界」はその組の視界で
    this.fog.setVisible(fogTeam !== null && !this.introCam && s.phase !== 'finale');
    if (fogTeam !== null) {
      const eyes = this.eyes(s, fogTeam, sinceSnap); // 倒された味方は大爆発の後に視界が縮む（eyeRadius）
      const t0 = performance.now();
      const wv = this.cameras.main.worldView, polys = eyes.map((e) => this.visPoly(e.x, e.y, e.r));
      // 視界ポリゴン（visPoly の配列）と壁が前のフレームと同じなら、マスクの形は描き直さない（壁が変わらない間は同じ配列なら中身も同じ）
      const d = this.visDrawn;
      if (!d || d.ver !== wallVer || d.polys.length !== polys.length || d.polys.some((p, i) => p !== polys[i])) {
        vg.clear().fillStyle(0xffffff);
        // 視界ポリゴンは目から放射状に並んだ点なので、目を中心にした扇形の三角形で塗る（fillPoints だと Phaser が毎フレーム三角形分割をやり直して重い。塗る範囲は同じ）
        eyes.forEach((e, k) => { const pts = polys[k]; for (let i = 0, n = pts.length; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; vg.fillTriangle(e.x, e.y, a.x, a.y, b.x, b.y); } });
        this.visDrawn = { ver: wallVer, polys };
      }
      if (this.mfxMine >= 0) this.mfxArea(polys, wv.x, wv.y);
      for (const [k, v] of this.visCache) if (!this.visUsed.has(k)) this.visPool.push(v);
      [this.visCache, this.visUsed] = [this.visUsed, this.visCache]; this.visUsed.clear(); // 使い回しはこのフレームで使った分だけ残す
      if (this.perf) { const q = this.perf, ray = performance.now() - t0; q.n++; q.ray += ray; q.rayMax = Math.max(q.rayMax, ray); q.frame += dtMs; q.frameMax = Math.max(q.frameMax, dtMs); (window as any).perf = q; }
    } else if (this.visDrawn) { vg.clear(); this.visDrawn = null; }

    // HUD: タイマー、大将HPバー
    const sec = Math.ceil(s.timeLeft);
    setText($('.timer'), `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
    this.practiceHud(s);
    [0, 1].forEach((t) => { const el = $(`.b${t} i`); setCss(el, 'width', `${s.teams[t].bossHpRatio * 100}%`); setCss(el, 'background', css16(TEAM_COLOR[t])); }); // 左＝陣営0、右＝陣営1
    // リザルトの「戻る」: 押した人数／全人数（Botは押した扱い）
    const back = $('.back') as HTMLButtonElement;
    const backDisp = s.phase === 'ended' && mine ? 'block' : 'none';
    setCss(back, 'display', backDisp); setCss($('.totitle'), 'display', backDisp);
    if (this.resultPh === 'ended' && s.phase !== 'ended') { this.result = null; this.resultAsked = false; if (resultOpen()) closeResult(); } // 次の試合へ進んだら捨てる（'result' は phase が ended になるより先に届くことがあるので、ended から離れた時だけ）
    if (s.phase === 'ended' && !this.result && !this.resultAsked) { this.resultAsked = true; if (this.room) sendC2S(this.room, 'resultReq'); } // 保険: ended で結果が無ければ1回だけ求める
    this.resultPh = s.phase;
    setCss($('.rsbtn'), 'display', s.phase === 'ended' && this.result ? 'block' : 'none');
    if (s.back) { const t = this.backSent ? `待機中 ${s.back.n}/${s.back.total}` : `戻る（${s.back.n}/${s.back.total}）`; if (back.textContent !== t) back.textContent = t; back.disabled = this.backSent; }
    this.rosterHud(s, myTeam, sinceSnap);
    this.buffHud(s, mine, myTeam, sinceSnap);
    if (s.phase !== 'waiting') this.tokuHud(s);
    setCss($('.tk'), 'display', s.phase === 'waiting' ? 'none' : 'flex');
    if (C.INTRO_MODE === 'old') this.introOld(s, myTeam, sinceSnap);
    this.staging(s, mine, myTeam, sinceSnap);
    // 技のアイコンとクールタイム
    const sk = mine && DEFS[mine.char]?.skill, skEl = $('.skill');
    setCss(skEl, 'display', sk ? 'flex' : 'none');
    skEl.classList.toggle('sealed', !!sk && ['waiting', 'intro', 'countdown'].includes(s.phase)); // 封印: 戦闘開始前
    if (sk) {
      const cd = Math.max(0, mine.skillCd - sinceSnap);
      const hud = Object.keys(STATUS_VIEW).map((k) => mine.st?.[k] && STATUS_VIEW[k].hud).find((h) => h); // 技を使えない状態の表示
      setText($('.skill .sn'), sk.name);
      setText($('.skill b'), hud ? hud : cd > 0 ? String(Math.ceil(cd)) : 'OK');
      { const a = Math.min(360, (cd / sk.ct) * 360), ea = $('.skill .a em'), eb = $('.skill .b em'); this.setTf(ea, `rotate(${Math.min(a, 180)}deg)`); this.setTf(eb, `rotate(${Math.max(0, a - 180)}deg)`); } // 0〜180度は右の板、180〜360度は左の板
      setCss(skEl, 'border-color', cd > 0 || hud ? '#888' : '#ffe066');
      // そらのチャージ: 技ボタンのゲージと％（本人だけ。撤退中は0%）。スナップショットの値のまま（間を足すと届いたときに数字が戻ることがある）
      const ch = mine.st?.solarCharge;
      skEl.classList.toggle('charge', mine.char === 'sora');
      if (mine.char === 'sora') {
        const pct = mine.alive && ch !== undefined ? Math.round(solarPct(Number(ch))) : 0;
        setText($('.skill small'), `${pct}%`);
        const g = $('.skill s'); setCss(g, '--g', `${Math.min(100, pct)}%`); g.classList.toggle('over', pct > 100);
      }
    }
    { const t = `照準<br>${AIM_SHORT[mine?.aim ?? C.AIM_MODES[this.ctl.aimMode]]}`; if ($('.aimb').innerHTML !== t) $('.aimb').innerHTML = t; }
    // ミニマップ
    const ui = this.ui.clear();
    const mx = C.VIEW_W - 4 - MAP.width * MINI, my = MM_TOP, ms = MINI / T;
    for (const p of s.players) if (p.alive && (p.team === myTeam || !views(p).some((v) => v.bare))) ui.fillStyle(p.id === s.me ? 0xffffff : TEAM_COLOR[p.team]).fillRect(mx + (p.id === s.me ? this.me.x : p.x) * ms - 1, my + (p.id === s.me ? this.me.y : p.y) * ms - 1, 3, 3);
    // 大将: 味方は常時、敵は見えている間は塗り、見えていなければ最後に見た位置を枠だけ
    const foeBoss = s.bosses.find((x: any) => x.team !== myTeam);
    if (foeBoss) this.lastSeenBoss = { x: foeBoss.x, y: foeBoss.y };
    for (const bo of s.bosses) ui.fillStyle(TEAM_COLOR[bo.team]).fillRect(mx + bo.x * ms - 2, my + bo.y * ms - 2, 5, 5).lineStyle(1, 0xffffff).strokeRect(mx + bo.x * ms - 2, my + bo.y * ms - 2, 5, 5);
    if (mine && !foeBoss && this.lastSeenBoss) ui.lineStyle(1, TEAM_COLOR[1 - myTeam]).strokeRect(mx + this.lastSeenBoss.x * ms - 3, my + this.lastSeenBoss.y * ms - 3, 7, 7);
    // ブイブイ・コバコ（両陣営）: 荷物の色の四角に白い縁
    for (const c of s.couriers) ui.fillStyle(ITEM_COLOR[`box_${c.box}`]).fillRect(mx + c.x * ms - 2, my + c.y * ms - 2, 5, 5).lineStyle(1, 0xffffff).strokeRect(mx + c.x * ms - 2, my + c.y * ms - 2, 5, 5);
    // 指名手配中のキャラ: 敵の視界外でも位置を出す（赤い枠）
    for (const w of s.wanted) ui.lineStyle(1.5, 0xff3030).strokeRect(mx + w.x * ms - 3, my + w.y * ms - 3, 7, 7);
    // 資材: 味方の視界内にあるもの（観戦者はすべて）
    // 見えているかの判定（資材×味方の視界の見通し）はスナップショットを受信した時だけ（毎フレームはしない。点の出入りは最大で受信の間隔だけ遅れる）
    if (s !== this.mmSnap) {
      this.mmSnap = s;
      const eyes = this.eyes(s, myTeam, sinceSnap), seeObs = this.seeWalls;
      this.mmMats = mine ? s.materials.filter((m: any) => eyes.some((e) => Math.hypot(e.x - m.x, e.y - m.y) <= e.r && lineOfSight(e.x, e.y, m.x, m.y, seeObs))) : s.materials;
    }
    for (const m of this.mmMats) {
      if (m.big) ui.fillStyle(0x7fe8ff).fillRect(mx + m.x * ms - 2, my + m.y * ms - 2, 4, 4); // 高性能の徳は水色で大きく
      else if (m.hi) ui.fillStyle(0xff7ad9).fillRect(mx + m.x * ms - 2, my + m.y * ms - 2, 4, 4); // 高ポイントはピンクで大きく
      else ui.fillStyle(0xffd700).fillRect(mx + m.x * ms - 1, my + m.y * ms - 1, 2.5, 2.5);
    }
    const cam = this.cameras.main.worldView;
    ui.lineStyle(1, 0xffffff, 0.6).strokeRect(mx + cam.x * ms, my + cam.y * ms, cam.width * ms, cam.height * ms);
    // ワールドに付く一時表示とラベルの位置
    this.pops = this.pops.filter((p) => (now < p.until ? (this.setTf(p.el, this.toScreen(p.x, p.y, 'translate(-50%,-100%)')), true) : (p.el.remove(), false)));
    for (const [key, el] of this.labels) if (!labelSeen.has(key)) { el.remove(); this.labels.delete(key); }

    // KOされた時: やられ顔と復活までの残り時間
    if (mine && !mine.alive && s.phase === 'playing') {
      const img = down.querySelector('img')!, koed = CHARS[mine.char].koed;
      const src = TACHIE(mine.char, koed ? 'koed' : 'select');
      if (!img.src.endsWith(src)) img.src = src;
      setCss(img, 'filter', koed ? '' : 'grayscale(1)');
      img.classList.toggle('fall', !koed); // やられ顔がないキャラは傾けながらずり落とす
      setCss(down, '--d', `${C.CUTIN_MS}ms`);
      setText(down.querySelector('div')!, `反省中 あと${Math.max(0, mine.respawnIn - (performance.now() - this.snapAt) / 1000).toFixed(1)}秒`); // 受信後の経過分を毎フレーム引く
      setCss(down, 'display', 'block');
      // 倒した相手: 立ち絵（KOした時の表情。大将・プレイヤー以外は立ち絵なし）と、誰に何で倒されたか
      const by = this.koedBy, kimg = killer.querySelector('img')!, ksrc = by?.kc && CHARS[by.kc] ? TACHIE(by.kc, 'ko') : '';
      if (ksrc && !kimg.src.endsWith(ksrc)) kimg.src = ksrc;
      setCss(kimg, 'display', ksrc ? '' : 'none');
      const kt = by ? [by.kc ? charName(by.kc) : '', by.how].filter((x) => x).join('\n') : ''; // 1行目: 倒したキャラ名、2行目: 倒した手段
      if (kohow.textContent !== kt) kohow.textContent = kt;
      setCss(killer, 'display', by ? 'block' : 'none'); setCss(kohow, 'display', by ? 'block' : 'none');
    } else { setCss(down, 'display', 'none'); setCss(killer, 'display', 'none'); setCss(kohow, 'display', 'none'); }

    // 自分の情報パネル（左下）: 残りHP・悪行のバー・プレイヤー名。指名手配中は枠と WANTED
    const meP = $('.me'), meR = mine && s.roster.find((r: any) => r.id === s.me);
    setCss(meP, 'display', mine && s.phase !== 'waiting' ? 'block' : 'none');
    if (mine) {
      setText($('.me .hp b'), String(Math.max(0, Math.ceil(this.interp.hpAt(mine.id, now) ?? mine.hp)))); // 描く時刻の HP（頭上の HP バーと同じ）
      setCss($('.me .bd i'), 'width', `${Math.min(100, (mine.bad / C.HUD_BAD_MAX) * 100)}%`); setText($('.me .bd span'), `悪行 ${mine.bad.toFixed(1)}`);
      setText($('.me .nm'), meR?.name ?? '');
      meP.classList.toggle('wanted', s.teams[myTeam]?.wanted === mine.id);
    }
    // 計測用の表示（?perf=1 のときだけ）
    setCss($('#info'), 'display', this.perf ? 'block' : 'none');
    if (this.perf) setText($('#info'), `視界の計算 平均${(this.perf.ray / this.perf.n).toFixed(2)}ms 最大${this.perf.rayMax.toFixed(1)}ms／フレーム間隔 平均${(this.perf.frame / this.perf.n).toFixed(1)}ms 最大${this.perf.frameMax.toFixed(0)}ms`);
  }
}

// 論理解像度を整数倍で表示（#wrap はノッチなどを除いた範囲）
const wrap = document.getElementById('wrap')!;
// スマホで等倍に収まらない時（Safari のアドレスバーなど）だけ、収まるように縮小する
// 倍率: 実画素で整数倍（ドットの1画素を実画素の均一な正方形に）。表示上の zoom はそれを DPR で割った値（非整数になる）。実画素で1倍も取れないタッチ端末だけ縮小
const zoom = () => { const dpr = devicePixelRatio || 1, k = Math.min((wrap.clientWidth * dpr) / C.VIEW_W, (wrap.clientHeight * dpr) / C.VIEW_H); return (TOUCH && k < 1 ? k : Math.max(1, Math.floor(k))) / dpr; };
// キャンバスの位置を実画素の境目にそろえる（Phaser の中央寄せは CSS 画素の整数なので、DPR が整数でないとドットの幅が不ぞろいになる）
// 画面全体（セーフエリアを含む）の上下・左右の中央に置く。倍率はセーフエリアの内側（#wrap）で決めるので、中央に置いても画面からははみ出さない
function alignCanvas() {
  const c = game.canvas, dpr = devicePixelRatio || 1, w = wrap.getBoundingClientRect(), cw = C.VIEW_W * game.scale.zoom, ch = C.VIEW_H * game.scale.zoom;
  c.style.marginLeft = `${Math.round((Math.max(0, innerWidth - cw) / 2) * dpr) / dpr - w.left}px`;
  c.style.marginTop = `${Math.round((Math.max(0, innerHeight - ch) / 2) * dpr) / dpr - w.top}px`;
}
const game = new Phaser.Game({
  type: Phaser.WEBGL, width: C.VIEW_W, height: C.VIEW_H, backgroundColor: '#111', pixelArt: true, scene: GameScene, parent: wrap,
  scale: { mode: Phaser.Scale.NONE, zoom: zoom(), autoCenter: Phaser.Scale.CENTER_BOTH },
});
addEventListener('resize', () => game.scale.setZoom(zoom()));
(window as any).game = game;
