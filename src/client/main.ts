/// <reference types="vite/client" />
import Phaser from 'phaser';
import { Client, Room, CloseCode } from '@colyseus/sdk';
import { CONFIG as C, visionRadius, wallRects, roomLayout } from '../shared/config';
import { canPlace, cage, lineOfSight, inDashShape } from '../shared/geom';
import { Predictor, Interp } from '../shared/netcode';
import MAP from '../shared/map.json';
import { Controls } from './input';
import CHARS_JSON from '../shared/chars.json';

type Char = { name: string; select: string; ko: string; koed: string | null; boss?: number };
const CHARS = Object.fromEntries(Object.entries(CHARS_JSON).filter(([k]) => k !== '_')) as Record<string, Char>;
const PICKABLE = Object.keys(CHARS).filter((k) => CHARS[k].boss === undefined);
const BOSS_CHAR = [0, 1].map((t) => Object.keys(CHARS).find((k) => CHARS[k].boss === t)!);
const DOT_FRAMES = ['idle', 'walk1', 'walk2', 'half', 'close', 'banzai'];
const COURIER_CHAR = 'kobako'; // ブイブイ・コバコのドット
const DOT_KEYS = [...Object.keys(CHARS), COURIER_CHAR, ...Object.keys(C.ASSIST.units)];
const charName = (k: string) => CHARS[k]?.name ?? C.ASSIST.units[k]?.name ?? k; // アシストは chars.json にいない
const DOT = (key: string, frame = 'idle') => `assets/gen/dot/${key}/${frame}.png`;
const MOVE_PHASES = ['countdown', 'playing', 'ended']; // 自キャラが動ける場面（カウント中と終了後は部屋の中だけ）
const css16 = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const TACHIE = (key: string, slot: string) => `assets/gen/tachie/${key}/${slot}.png`;

const TEAM_COLOR = [0xff8c28, 0x3cc850]; // あんこもん軍(オレンジ), ずんだもん軍(緑)
const NEUTRAL_COLOR = 0xcccccc; // 中立（コバコ）
const teamColor = (t: number) => TEAM_COLOR[t] ?? NEUTRAL_COLOR;
const TEAM_NAME = ['あんこもん軍', 'ずんだもん軍'];
const ITEM_COLOR: Record<string, number> = { heal: 0x66ff99, box_ult: 0xff66ff, box_assist: 0x66ccff, assist: 0x66ccff };
const ITEM_LABEL: Record<string, string> = { heal: '回復', box_ult: 'ウルト箱', box_assist: 'アシスト箱' };
const PAYOUT_LABEL: Record<string, string> = { ult: 'ウルト', assist: 'アシスト召喚' };
const PENALTY_LABEL: Record<string, string> = { dmg: `全員にダメージ（最大HPの${C.SLOT.penalty.dmg * 100}%）`, slow: `全員の移動速度低下（×${C.SLOT.penalty.slow}、${C.SLOT.penalty.dur}秒）`, weak: `全員の攻撃力低下（×${C.SLOT.penalty.weak}、${C.SLOT.penalty.dur}秒）` };
const T = MAP.tileSize;
const MINI = 0.6; // ミニマップ: 1タイルあたりのpx
const tiles = [...MAP.tiles]; // 試合中のタイル（壁破壊で変わる）
const isWall = (x: number, y: number) => tiles[Math.floor(y / T)]?.[Math.floor(x / T)] === '#';
const SKILL_FX_COLOR: Record<string, number> = { ring: 0xff7fbf, wall: 0xffa040, rect: 0x9fe8ff, dash: 0xff4040, arc: 0xc080ff, barrier: 0x60a0ff, accel: 0xffe060, funnel: 0xff9ad5, heal: 0x66ff99, ult: 0xff66ff, assist: 0x66ccff, fly: 0x9fdcff, trap: 0xc8a0ff, beam: 0xff9ad5, pen_dmg: 0xff2020, pen_slow: 0x4080ff, pen_weak: 0xa040ff };
const ULT_COLOR: Record<string, number> = { melee: 0xff5050, ranged: 0xffd040, area: 0xb070ff }; // 変身先ごとのエフェクトの色

type Unit = { s: Phaser.GameObjects.Sprite; char: string; tx: number; ty: number; blinkAt: number; hp?: number; cd?: number; flashUntil: number };
type SkillFx = { kind: string; t0: number; [k: string]: any };

// 立ち絵の層（DOM）。ドットとは別に高解像度で表示する
// ビルドの識別子（gitの短縮ハッシュ＋ビルド日時、vite.config.ts で埋め込む）を画面の隅に常に出す
declare const __BUILD__: string;
const ver = document.createElement('div');
ver.id = 'ver';
ver.textContent = __BUILD__;
ver.style.cssText = 'position:fixed;left:2px;bottom:1px;z-index:9999;font:10px monospace;color:#fff8;pointer-events:none';
document.body.appendChild(ver);
const fx = document.createElement('div');
fx.id = 'fx';
fx.style.cssText = 'position:fixed;pointer-events:none;overflow:hidden';
document.body.appendChild(fx);
const css = document.createElement('style');
css.textContent = `
#fx .cut{position:absolute;left:0;right:0;bottom:0;height:62%;background:linear-gradient(transparent,#000a 30%,#000a 85%,transparent);animation:cutfade var(--d) linear forwards}
#fx .cut img{position:absolute;bottom:0;height:100%}
#fx .cut .me{left:8%;animation:hop var(--d) linear forwards}
#fx .cut .foe{left:52%;animation:push var(--d) ease-out forwards}
@keyframes cutfade{0%{opacity:0}8%{opacity:1}85%{opacity:1}100%{opacity:0}}
@keyframes hop{0%{transform:translateX(-40%)}10%{transform:translateX(0)}18%{transform:translateX(10%)}26%{transform:translateX(0)}34%{transform:translateX(10%)}42%{transform:translateX(0)}50%{transform:translateX(10%)}58%,100%{transform:translateX(0)}}
@keyframes push{0%,45%{transform:translateX(0);filter:none}65%,100%{transform:translateX(30%);filter:grayscale(1) brightness(.8)}}
#fx .down{position:absolute;left:2%;bottom:22%;height:62%;display:none;overflow:hidden}
#fx .down img{height:100%;transform-origin:50% 100%}
#fx .down img.fall{animation:fall var(--d) ease-in forwards}
@keyframes fall{0%{transform:none}100%{transform:rotate(-14deg) translateY(28%)}}
#fx .down div{position:absolute;left:0;right:0;bottom:12%;text-align:center;color:#fff;font:bold 3vh sans-serif;text-shadow:0 0 4px #000,0 0 4px #000}
#fx .timer{position:absolute;top:1.6%;left:50%;transform:translateX(-50%);background:#000a;color:#fff;font:bold calc(var(--z) * 13px) sans-serif;padding:0 .5em;border-radius:3px}
#fx .bar{position:absolute;top:2.6%;width:31%;height:2.4%;background:#000b;outline:1px solid #000}
#fx .bar.b0{left:1.2%}
#fx .bar.b1{right:1.2%}
#fx .bar i{position:absolute;top:0;bottom:0}
#fx .b0 i{left:0;background:#ff8c28}
#fx .b1 i{right:0;background:#3cc850}
#fx #info{position:absolute;left:.6%;bottom:1%;color:#fff;background:#0009;font:calc(var(--z) * 6.5px)/1.35 sans-serif;padding:.3em .5em;white-space:pre}
#fx .notes{position:absolute;top:30%;left:50%;transform:translateX(-50%);text-align:center}
#fx .notes div{background:#000b;color:#ffe066;font:bold calc(var(--z) * 8px) sans-serif;padding:.2em .8em;margin-bottom:.3em;border-radius:3px;white-space:nowrap}
#fx .pop{position:absolute;transform:translate(-50%,-100%);font:bold calc(var(--z) * 8px) sans-serif;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000;white-space:nowrap;animation:popup var(--d) ease-out forwards}
#fx .pop.dmg{color:#ff5050}
#fx .pop.plus{color:#ffe066;font-size:calc(var(--z) * 10px)}
#fx .pop.plus.hi{color:#ff7ad9;font-size:calc(var(--z) * 13px)}
#fx .pop.warn{color:#fff59a;font-size:calc(var(--z) * 7px)}
@keyframes popup{0%{opacity:1;margin-top:0}100%{opacity:0;margin-top:calc(var(--z) * -14px)}}
html.touch,html.touch body{overscroll-behavior:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
html.touch #lobby{top:env(safe-area-inset-top)!important;right:env(safe-area-inset-right)!important;bottom:env(safe-area-inset-bottom)!important;left:env(safe-area-inset-left)!important;transform:none!important;box-sizing:border-box;overflow:hidden;background:#111!important;padding:6px 10px 14px!important;font-size:12px!important}
html.touch #lobby h3{font-size:13px;height:18px;line-height:18px;margin:0!important}
html.touch #lobby .cards{height:calc(100% - 112px);gap:4px;margin:4px 0}
html.touch #lobby .card{flex:1 1 0;min-width:0;width:auto;display:flex;flex-direction:column;font-size:10px;white-space:nowrap;overflow:hidden}
html.touch #lobby .card img{flex:1 1 0;min-height:0;height:auto}
html.touch #roster{display:flex;gap:16px;line-height:1.3;margin-right:96px}
html.touch #roster>br{display:none}
html.touch #roster .tm{flex:1;min-width:0;white-space:nowrap;overflow:hidden}
html.touch #roster button{font-size:11px}
html.touch #start{position:absolute;right:10px;bottom:14px;margin:0!important;font-size:16px!important;padding:6px 16px!important}
html.touch #ver{left:calc(env(safe-area-inset-left) + 2px)!important;bottom:calc(env(safe-area-inset-bottom) + 1px)!important}
#lobby .pwa{position:absolute;right:10px;top:6px;height:18px;display:flex;align-items:center;gap:6px;background:#ffe066;color:#000;font:bold 11px sans-serif;padding:0 2px 0 8px;border-radius:3px}
#lobby .pwa button{border:0;background:none;font:bold 14px/1 sans-serif;padding:0 6px;color:#000}
#rotate{display:none;position:fixed;inset:0;z-index:10;background:#111;color:#fff;font:bold 20px sans-serif;align-items:center;justify-content:center}
@media (orientation:portrait){html.touch #rotate{display:flex}}
#fx .tb{display:none;position:absolute;pointer-events:auto;touch-action:none;width:calc(var(--z) * 36px);height:calc(var(--z) * 36px);border-radius:50%;border:2px solid #fff;background:#335c;color:#fff;font:bold calc(var(--z) * 7px)/1.1 sans-serif;padding:0}
html.touch #fx .tb{display:block}
html.touch #fx .tb:active{background:#88a}
html.touch #fx .atk{right:calc(var(--z) * 54px);bottom:calc(var(--z) * 84px);width:calc(var(--z) * 42px);height:calc(var(--z) * 42px);font-size:calc(var(--z) * 8px)}
html.touch #fx .rc{right:calc(var(--z) * 8px);bottom:calc(var(--z) * 132px)}
html.touch #fx .aimb{right:calc(var(--z) * 50px);bottom:calc(var(--z) * 132px)}
html.touch #fx .skill span:last-child{display:none}
html.touch #fx .skill{width:calc(var(--z) * 42px);height:calc(var(--z) * 42px);font-size:max(9px,calc(var(--z) * 7px));line-height:1.15;text-shadow:0 1px 2px #000;left:auto;right:calc(var(--z) * 8px);bottom:calc(var(--z) * 84px);transform:none;pointer-events:auto;touch-action:none}
html.touch #fx .tb{font-size:max(12px,calc(var(--z) * 9px));background:#1a2a5a;text-shadow:0 1px 2px #000}
html.touch #fx .atk{font-size:max(14px,calc(var(--z) * 10px))}
#fx .lbl{position:absolute;transform:translate(-50%,-50%);font:bold calc(var(--z) * 5.5px) sans-serif;white-space:nowrap;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000}
#fx .lbl.home{font-size:calc(var(--z) * 9px);opacity:.9}
#fx .skill{position:absolute;left:50%;bottom:1.5%;transform:translateX(-50%);width:calc(var(--z) * 40px);height:calc(var(--z) * 40px);border:2px solid #fff;border-radius:6px;background:#335;color:#fff;font:bold calc(var(--z) * 6px)/1.2 sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;overflow:hidden}
#fx .skill i{position:absolute;inset:0;background:conic-gradient(#000b var(--p), transparent 0)}
#fx .skill b,#fx .skill span{position:relative}
#fx .skill b{font-size:calc(var(--z) * 11px)}
html.touch #fx .skill b{font-size:max(13px,calc(var(--z) * 11px))}
#fx .roster{position:absolute;top:5.8%;display:flex;flex-direction:column;gap:calc(var(--z) * 1px)}
#fx .roster.r0{left:1.2%}
#fx .roster.r1{right:1.2%;flex-direction:row;gap:calc(var(--z) * 2px)}
#fx .ic{width:calc(var(--z) * 18px);height:calc(var(--z) * 18px);background:#000a no-repeat calc(var(--z) * -7px) calc(var(--z) * -3px)/calc(var(--z) * 32px) calc(var(--z) * 42px);image-rendering:pixelated;border:1px solid var(--c);border-radius:2px;flex:none}
#fx .ic.dead{filter:grayscale(1) brightness(.35)}
#fx .ally{display:flex;align-items:center;gap:calc(var(--z) * 3px);background:#0007;padding:1px 3px;color:#fff;font:bold calc(var(--z) * 5.5px) sans-serif}
#fx .ally .nm{width:calc(var(--z) * 42px);overflow:hidden;white-space:nowrap}
#fx .ally .hp{width:calc(var(--z) * 40px);height:calc(var(--z) * 3px);background:#000b;position:relative}
#fx .ally .hp i{position:absolute;left:0;top:0;bottom:0;background:var(--c)}
#fx .ally .rs{width:calc(var(--z) * 40px);color:#ffe066}
#fx .kills{position:absolute;top:22%;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:1px}
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
#fx .banner{position:absolute;left:0;right:0;top:34%;text-align:center;display:none}
#fx .banner b{display:inline-block;font:900 calc(var(--z) * 40px) sans-serif;color:var(--c);-webkit-text-stroke:calc(var(--z) * 1.5px) #000;text-shadow:0 0 10px #000;animation:pop .3s ease-out}
#fx .banner small{display:block;font:bold calc(var(--z) * 10px) sans-serif;color:#fff;text-shadow:0 0 4px #000,0 0 4px #000}
#fx .back{position:absolute;left:50%;top:58%;transform:translateX(-50%);display:none;font:bold calc(var(--z) * 9px) sans-serif;padding:.3em 1.4em;border-radius:4px;border:2px solid #fff;background:#335;color:#fff;cursor:pointer;pointer-events:auto}
#fx .back:disabled{background:#555;cursor:default}
#fx .ally .tag{color:#66ccff;font-size:calc(var(--z) * 4.5px);margin-left:2px}
#fx .tk{position:absolute;top:6.4%;left:50%;transform:translateX(-50%);display:flex;gap:calc(var(--z) * 8px)}
#fx .tk .side{display:flex;flex-direction:column;align-items:center;gap:calc(var(--z) * 1.5px)}
#fx .tk .tg{position:relative;width:calc(var(--z) * 54px);height:calc(var(--z) * 5px);background:#000b;outline:1px solid var(--c)}
#fx .tk .tg i{position:absolute;left:0;top:0;bottom:0;background:var(--c)}
#fx .tk .tv{color:#fff;font:bold calc(var(--z) * 5.5px) sans-serif;text-shadow:0 0 2px #000,0 0 2px #000}
#fx .tk .sl{position:relative;display:flex;gap:1px;background:#1b1b28;border:2px solid var(--c);padding:1px;border-radius:3px}
#fx .tk .sl .ic{width:calc(var(--z) * 15px);height:calc(var(--z) * 15px);border-color:#555}
#fx .tk .sl.reach{animation:reach .25s steps(2) infinite}
#fx .tk .sl.win{border-color:#ffd700;box-shadow:0 0 calc(var(--z) * 6px) #ffd700}
#fx .tk .sl b{position:absolute;left:50%;top:100%;transform:translateX(-50%);white-space:nowrap;font:900 calc(var(--z) * 7px) sans-serif;color:#ffd700;text-shadow:0 0 3px #000,0 0 3px #000}
@keyframes reach{0%{border-color:#ff3030;box-shadow:0 0 calc(var(--z) * 5px) #ff3030}100%{border-color:#ffd700;box-shadow:none}}
#fx .scut{position:absolute;left:0;right:0;top:40%;padding:.4em 0;text-align:center;background:linear-gradient(90deg,transparent,var(--c) 30%,var(--c) 70%,transparent);animation:cutfade var(--d) linear forwards}
#fx .scut b{display:block;font:900 calc(var(--z) * 22px) sans-serif;color:#ffd700;-webkit-text-stroke:calc(var(--z) * 1px) #000;text-shadow:0 0 8px #000;animation:pop .3s ease-out}
#fx .scut span{display:block;font:bold calc(var(--z) * 9px) sans-serif;color:#fff;text-shadow:0 0 4px #000,0 0 4px #000}
#fx .tk .sl .ic.pen{background:#3a0d0d;color:#ff4040;font:900 calc(var(--z) * 13px)/calc(var(--z) * 15px) sans-serif;text-align:center}
#fx .tk .sl.pen{border-color:#a00000;box-shadow:0 0 calc(var(--z) * 6px) #ff2020}
#fx .tk .sl b.pb{color:#ff4040}
#fx .tk .rf{margin-left:.5em;color:#9fe8ff}
#fx .lbl.introlbl{font:900 calc(var(--z) * 12px) sans-serif;color:#ffe066;-webkit-text-stroke:calc(var(--z) * .6px) #000}
#fx .lbl.wanted{color:#ff4040;font-size:calc(var(--z) * 7px)}
@keyframes fadein{0%{opacity:0}100%{opacity:1}}
@keyframes slidein{0%{transform:translateX(-40%);opacity:0}100%{transform:none;opacity:1}}
@keyframes logoin{0%{transform:translateX(30%) skewX(-8deg);opacity:0}100%{transform:skewX(-8deg);opacity:1}}
@keyframes pop{0%{transform:scale(1.8);opacity:0}100%{transform:scale(1);opacity:1}}
#lobby .cards{display:flex;gap:6px;margin:8px 0}
#lobby .card{width:96px;cursor:pointer;border:2px solid transparent;text-align:center;font-size:12px;border-radius:4px}
#lobby .card img{width:100%;height:150px;object-fit:cover;object-position:top}
#lobby .card.mine{border-color:#ffd700}
`;
document.head.appendChild(css);
const down = document.createElement('div');
down.className = 'down';
down.innerHTML = '<img><div></div>';
fx.appendChild(down);
// HUD（DOM。文字をドットと一緒に縮小しない）
const hudEl = document.createElement('div');
hudEl.innerHTML = '<div class="bar b0"><i></i></div><div class="timer"></div><div class="bar b1"><i></i></div><div class="tk"><div class="side s0"></div><div class="side s1"></div></div><div class="roster r0"></div><div class="roster r1"></div><div class="kills"></div><div id="info"></div><div class="notes"></div><div class="skill"><i></i><span class="sn"></span><b></b><span>R</span></div><div class="banner"></div><div class="intro"></div><button class="back"></button>';
fx.appendChild(hudEl);
const $ = (q: string) => hudEl.querySelector<HTMLElement>(q)!;
// スマホ（指で操作する端末）: タッチUIを出し、ブラウザのスクロール・拡大・長押しメニュー・選択を止める
const TOUCH = matchMedia('(pointer: coarse)').matches;
const AIM_SHORT: Record<string, string> = { nearest: '近い', lowhp: 'HP', boss: '大将', manual: '手動' };
if (TOUCH) {
  document.documentElement.classList.add('touch');
  hudEl.insertAdjacentHTML('beforeend', '<button class="tb atk">攻撃</button><button class="tb rc">設置<br>帰還</button><button class="tb aimb"></button>');
  for (const t of ['gesturestart', 'dblclick', 'contextmenu']) document.addEventListener(t, (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false }); // キャラ選択も画面内に収めるのでスクロールさせない
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
  interp = new Interp(); // 他キャラ・大将の補間
  acc = 0; // 次の入力までの経過時間(ms)
  lobbyKey = '';
  slashes: { x: number; y: number; face: number; t0: number }[] = [];
  pops: { el: HTMLElement; x: number; y: number; until: number }[] = [];
  labels = new Map<string, HTMLElement>();
  smoke: { x: number; y: number; t0: number }[] = []; // アルの突撃の煙の粒
  slotHtml = ['', ''];
  lastSeenBoss: { x: number; y: number } | null = null; // 敵の大将を最後に見た位置
  ctl = new Controls((t, m) => this.room?.send(t, m)); // キーボード・タッチの入力 → サーバーへ送るコマンド
  stickId: number | null = null; // 仮想スティックを動かしている指（Touch.identifier）
  stickAt = { x: 0, y: 0 }; // 仮想スティックの中心（触れた位置、画面のpx）
  hiddenAt = 0; // バックグラウンドに入った時刻(ms)
  perf = new URLSearchParams(location.search).has('perf') ? { n: 0, ray: 0, rayMax: 0, frame: 0, frameMax: 0 } : null; // ?perf=1: 視界の計算・描画の時間を計る
  skillFx: SkillFx[] = [];
  fxQueue: any[] = []; // 受信した技のエフェクト（スナップショットごとに届く）
  layer!: Phaser.Tilemaps.TilemapLayer;
  miniTex!: Phaser.Textures.CanvasTexture;
  walls = C.WALLS; // 自キャラの移動予測に使う壁（壁破壊で変わる）
  brokenN = 0;
  homes: { x: number; y: number; w: number; h: number }[][] = [[], []]; // この試合の自宅（大将の部屋）
  homesKey = '';
  prevPhase = ''; // 演出の切り替え検知用（直前のスナップショットの phase と残り時間）
  prevTimeLeft = Infinity;
  timed: { key: string; text: string; sub: string; color: string; until: number } | null = null; // 時間で消える大きな表示（GAME START・形勢・残り秒数）
  bannerKey = '';
  introKey = '';
  rosterHtml = ['', ''];
  lastPhase = ''; // 連戦（リザルト → 待機画面）の検知用
  backSent = false; // リザルトで「戻る」を押したか
  introCam = false; // 開始演出でカメラを寄せているか
  introCut = ''; // 新開幕: 今映しているカット
  introBanner: [string, string] | null = null; // 新開幕: 画面中央の文字
  miniImg!: Phaser.GameObjects.Image;
  tileKinds: number[][] = []; // タイルの種類（0=外 1=床 2=壁）

  preload() {
    for (const k of DOT_KEYS) for (const f of DOT_FRAMES) this.load.image(`${k}_${f}`, `assets/gen/dot/${k}/${f}.png`);
  }

  create() {
    for (const k of DOT_KEYS) {
      this.anims.create({ key: `${k}_walk`, frames: ['walk1', 'walk2'].map((f) => ({ key: `${k}_${f}` })), frameRate: 1000 / C.WALK_FRAME_MS, repeat: -1 }); // 歩きは walk1 ⇔ walk2 の交互
      this.anims.create({ key: `${k}_blink`, frames: ['half', 'close', 'half', 'idle'].map((f) => ({ key: `${k}_${f}` })), frameRate: 14 });
    }

    // タイル: 0=外 1=床 2=壁 3,4=自宅の床（陣営色）
    const tex = this.textures.createCanvas('tiles', T * 5, T)!;
    ['#1a1a1a', '#b9b2a2', '#4a423a', '#d9a878', '#9fca86'].forEach((c, i) => { tex.context.fillStyle = c; tex.context.fillRect(i * T, 0, T, T); });
    tex.refresh();
    // 自宅（その試合の大将の部屋）の床の色は、最初のスナップショットで塗る（applyHomes）
    const data = (this.tileKinds = MAP.tiles.map((row) => [...row].map((c) => (c === '#' ? 2 : c === '.' ? 1 : 0))));
    const map = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
    this.layer = map.createLayer(0, map.addTilesetImage('tiles', 'tiles', T, T, 0, 0)!, 0, 0)!;

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
    this.miniImg = this.add.image(C.VIEW_W - 4, C.VIEW_H - 4, 'mini').setOrigin(1).setScrollFactor(0).setDepth(100).setAlpha(0.85);

    this.cameras.main.setBounds(0, 0, C.MAP_W, C.MAP_H).setRoundPixels(true).centerOn(C.MAP_W / 2, C.MAP_H / 2);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE,Q,R,TAB') as any;
    this.keys.SPACE.on('down', () => this.ctl.attack());
    this.keys.Q.on('down', () => this.ctl.qDown()); // 短押しで設置、長押しでリコール（判定はサーバー）
    this.keys.Q.on('up', () => this.ctl.qUp());
    this.keys.R.on('down', () => this.ctl.skill());
    this.keys.TAB.on('down', () => this.ctl.cycleAim()); // Tab: 照準モードを順に切り替え
    if (TOUCH) this.touchControls();

    // 待機画面（キャラ選択）
    const lobby = document.createElement('div');
    lobby.id = 'lobby';
    lobby.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#000d;color:#fff;padding:16px 24px;font:14px sans-serif;display:none';
    lobby.innerHTML = '<h3 style="margin:0 0 4px">キャラ選択</h3><div class="cards"></div><div id="roster"></div><button id="start" style="margin-top:12px;font-size:18px;padding:6px 24px">開始</button>';
    document.body.appendChild(lobby);
    lobby.querySelector('.cards')!.innerHTML = PICKABLE.map((k) => `<div class="card" data-k="${k}"><img src="${TACHIE(k, 'select')}"><div>${CHARS[k].name}</div></div>`).join('');
    lobby.querySelectorAll<HTMLElement>('.card').forEach((el) => (el.onclick = () => this.room?.send('pick', { char: el.dataset.k })));
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
    document.getElementById('start')!.onclick = () => this.room?.send('start');
    document.getElementById('roster')!.onclick = (e) => { const t = (e.target as HTMLElement).dataset.t; if (t) this.room?.send('team', { team: Number(t) }); };
    $('.back').onclick = () => { this.backSent = true; this.room?.send('back'); };

    // 本番ビルド（npm run share）はページと同じ場所（https→wss、http→ws）。開発時は従来どおり（HTTPS は Vite の中継 vite.config.ts を通す）
    const client = new Client(import.meta.env.PROD ? location.origin : location.protocol === 'https:' ? `${location.origin}/colyseus` : `ws://${location.hostname}:${C.PORT}`);
    const e2e = new URLSearchParams(location.search).has('e2e'), tokenKey = e2e ? 'rtE2e' : 'rt'; // ?e2e=1 はテスト専用の部屋
    // 再読み込みしたタブは、待ってもらっている試合に戻る（RECONNECT_SEC 秒以内）。戻れなければ新しく入る
    const saved = sessionStorage.getItem(tokenKey);
    (saved ? client.reconnect(saved).catch(() => client.joinOrCreate('game', e2e ? { e2e: true } : {})) : client.joinOrCreate('game', e2e ? { e2e: true } : {})).then((room) => {
      this.room = room;
      (window as any).room = room; // 検証用
      sessionStorage.setItem(tokenKey, room.reconnectionToken);
      if (saved) this.ctl.sendAim();
      // 通信の再接続（自動）。戻ったら照準モードを送り直す。再接続できなければ入り直す
      room.onReconnect(() => { sessionStorage.setItem(tokenKey, room.reconnectionToken); this.ctl.sendAim(); });
      room.onLeave((code: number) => { if (code === CloseCode.CONSENTED) sessionStorage.removeItem(tokenKey); else location.reload(); }); // 切れたら再読み込み（保存した合言葉で戻る）
      addEventListener('pagehide', () => { if (this.snap?.phase === 'waiting') room.leave(); }); // 待機画面でタブを閉じたら待たせずに抜ける（試合中は再読み込みで戻れるよう再接続を待つ）
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) { this.hiddenAt = performance.now(); return; }
        if (room.connection.isOpen && performance.now() - this.hiddenAt >= C.RESUME_RECONNECT_SEC * 1000) room.connection.close(CloseCode.MAY_TRY_RECONNECT); // 止まっていた接続を張り直す
      });
      room.onMessage('s', (s: any) => {
        this.snap = s;
        this.snapAt = performance.now();
        this.interp.push(s.t, this.snapAt, [...s.players, ...s.bosses.map((b: any) => ({ ...b, id: 'boss' + b.team })), ...s.couriers.map((c: any) => ({ ...c, id: 'c' + c.id }))]); // 自キャラもアルの突撃のタメ中・突撃中は補間で描く
        const m = s.players.find((p: any) => p.id === s.me);
        if (m) {
          if (!m.alive || !MOVE_PHASES.includes(s.phase) || m.charge || m.dash) this.pred.reset(m.x, m.y);
          else this.pred.reconcile(m.x, m.y, m.ack, m.spd, this.obstacles(s, m));
        }
        this.fxQueue.push(...(s.fx ?? []));
        (window as any).snap = s;
      });
      room.onMessage('notice', (m: any) => this.notify(m.text));
      room.onMessage('kill', (k: any) => this.killLog(k.kc ?? BOSS_CHAR[k.kt], k.kt, k.vc, k.vt));
      room.onMessage('assist', (m: any) => this.notify(`${TEAM_NAME[m.team]}のアシスト: ${charName(m.char)}（${C.POWER_TIERS[m.tier]}）`)); // 召喚の通知（両陣営）
      room.onMessage('slot', (m: any) => this.slotCutin(m.team, m.chain, m.kind, m.tier));
      room.onMessage('assistUp', (m: any) => this.notify(`${TEAM_NAME[m.team]}のアシスト強化: ${charName(m.char)}（${C.POWER_TIERS[m.tier]}）`)); // 両陣営
      room.onMessage('penalty', (m: any) => this.notify(`${TEAM_NAME[m.team]}に罰: ${PENALTY_LABEL[m.kind]}`)); // 両陣営
      room.onMessage('ko', (k: any) => {
        const mine = this.snap?.players.find((p: any) => p.id === this.snap.me);
        if (mine) this.cutin(mine.char, k.victimChar);
      });
    });
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

  // 連戦: 待機画面に戻ったら、壊れた壁・自宅の色・キルログなどを最初の状態に戻す
  resetMatch() {
    MAP.tiles.forEach((row, y) => (tiles[y] = row));
    this.tileKinds.forEach((row, y) => row.forEach((v, x) => this.layer.putTileAt(v, x, y)));
    this.paintMini();
    Object.assign(this, { walls: C.WALLS, brokenN: 0, homesKey: '', lastSeenBoss: null, timed: null, prevTimeLeft: Infinity, backSent: false });
    $('.kills').innerHTML = '';
  }

  // この試合の大将の部屋を陣営色に塗る（画面のタイルとミニマップ）
  applyHomes(names: string[]) {
    this.homes = roomLayout(names).homes;
    for (const r of MAP.rooms) {
      if (!r.team || !names.includes(r.id.replace(/_[LR]$/, ''))) continue;
      const v = r.team === 'kiritan' ? 3 : 4;
      for (let y = r.rect[1] + 1; y < r.rect[3]; y++) for (let x = r.rect[0] + 1; x < r.rect[2]; x++) {
        if (tiles[y][x] !== '.') continue;
        this.layer.putTileAt(v, x, y);
        this.miniTex.context.fillStyle = ['', '', '', '#c08050', '#70a060'][v];
        this.miniTex.context.fillRect(x * MINI, y * MINI, MINI + 0.2, MINI + 0.2);
      }
    }
    this.miniTex.refresh();
  }

  mine() {
    return this.snap?.players.find((p: any) => p.id === this.snap.me);
  }

  // スマホの操作: ボタン以外の画面全体（ゲーム画面の外の黒い余白も含む）が仮想スティック（触れた位置に出て、離すまで指に追従）、
  // 右下は 攻撃・技・設置/帰還（長押し）・照準 のボタン。余白にも出せるよう、スティックは画面全体の DOM に描く
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
      const t = [...e.changedTouches].find((t) => !(t.target as HTMLElement).closest?.('button, #fx .skill, #lobby')); // ボタンとキャラ選択の上は除く
      if (!t) return;
      this.stickId = t.identifier; this.stickAt = { x: t.clientX, y: t.clientY }; draw(0, 0);
    });
    document.addEventListener('touchmove', (e) => { const t = find(e); if (t) draw(t.clientX - this.stickAt.x, t.clientY - this.stickAt.y); });
    const up = (e: TouchEvent) => { if (find(e)) { this.stickId = null; this.ctl.releaseStick(); stick.style.display = 'none'; } };
    document.addEventListener('touchend', up);
    document.addEventListener('touchcancel', up);
    const btn = (q: string, down: () => void, release?: () => void) => {
      const el = $(q);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); down(); });
      if (release) for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, release);
    };
    btn('.atk', () => this.ctl.attack());
    btn('.skill', () => this.ctl.skill());
    btn('.rc', () => this.ctl.qDown(), () => this.ctl.qUp());
    btn('.aimb', () => this.ctl.cycleAim());
  }

  // 自キャラの移動予測に使う障害物（カウント中と終了後は部屋の外へ出られない）
  obstacles(s: any, m: any) {
    return [...this.walls, ...s.barricades, ...(m?.cage ? cage(m.cage) : [])];
  }

  // スロットの当たり・連チャンのカットイン（両陣営）: 当てた陣営と連チャン数、払い出し
  slotCutin(team: number, chain: number, kind: string, tier: number) {
    fx.querySelector('.scut')?.remove();
    const el = document.createElement('div');
    el.className = 'scut';
    el.style.setProperty('--d', `${C.SLOT_CUTIN_MS}ms`);
    el.style.setProperty('--c', css16(TEAM_COLOR[team]) + 'cc');
    el.innerHTML = `<b>${chain === 1 ? '大当たり！' : `${chain}連チャン！`}</b><span>${TEAM_NAME[team]}　${PAYOUT_LABEL[kind]}（${C.POWER_TIERS[tier]}）</span>`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), C.SLOT_CUTIN_MS);
  }

  // 徳のゲージとスロット（左＝自陣、右＝敵陣）。リールは回転中は自陣のキャラのアイコンが回り、決まった時刻に左から止まる
  tokuHud(s: any, myTeam: number, sinceSnap: number) {
    [myTeam, 1 - myTeam].forEach((t, k) => {
      const tm = s.teams[t], sl = tm.slot, chars = s.roster.filter((r: any) => r.team === t).map((r: any) => r.char);
      const idle = s.phase !== 'playing'; // GAME START までは止めたまま
      const p = sl.payout || idle ? 1 : Math.min(1, (C.SLOT.spin - Math.max(0, sl.left - sinceSnap)) / C.SLOT.spin);
      const tick = Math.floor(performance.now() / C.SLOT_REEL_MS);
      const shown = sl.reels.map((r: number, i: number) => (p >= C.SLOT.stops[i] ? r : (tick + i * 2) % Math.max(1, chars.length)));
      const reach = !idle && !sl.payout && p >= C.SLOT.stops[1] && p < 1 && sl.reels[0] === sl.reels[1];
      const win = !idle && (sl.payout || (p >= 1 && sl.win));
      const pen = !idle && p >= 1 && sl.pen;
      const reel = (r: number) => (r < 0 ? '<span class="ic pen">×</span>' : this.icon(chars[r] ?? chars[0], t)); // 罰の絵柄は ×
      const rf = tm.reflect ? `<span class="rf">反省中×${tm.reflect} +${(C.REFLECT_TOKU * tm.reflect * tm.reflect).toFixed(2)}/秒</span>` : '';
      const html = `<div class="tg" style="--c:${css16(TEAM_COLOR[t])}"><i style="width:${(tm.toku / C.TOKU_MAX) * 100}%"></i></div><div class="tv">徳 ${tm.toku.toFixed(1)}${rf}</div>`
        + `<div class="sl${reach ? ' reach' : ''}${win ? ' win' : ''}${pen ? ' pen' : ''}" style="--c:${css16(TEAM_COLOR[t])}">${shown.map(reel).join('')}${reach ? '<b>リーチ！</b>' : win ? `<b>大当たり${sl.chain > 1 ? ` ${sl.chain}連` : ''}</b>` : pen ? '<b class="pb">罰</b>' : ''}</div>`;
      if (html !== this.slotHtml[k]) { this.slotHtml[k] = html; $(`.tk .s${k}`).innerHTML = html; }
    });
  }

  // キャラの顔アイコン（陣営色の縁）
  icon(char: string, team: number, dead = false) {
    return `<span class="ic${dead ? ' dead' : ''}" style="background-image:url(${DOT(char)});--c:${css16(teamColor(team))}"></span>`;
  }

  // キルログ: 倒した側 → 倒された側。KILL_LOG_MAX 件を超えたら古い順に消える
  killLog(kc: string, kt: number, vc: string, vt: number) {
    const el = document.createElement('div');
    el.innerHTML = `${this.icon(kc, kt)}<span style="color:${css16(TEAM_COLOR[kt])}">▶</span>${this.icon(vc, vt)}`;
    const box = $('.kills');
    box.appendChild(el);
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
    this.introBanner = cut === 'mess' ? ['mess', '徳を積め！'] : cut === 'allies' ? ['allies', 'なかよくしろ！'] : cut === 'ready' ? ['ready', '準備してね'] : null;
  }

  // 画面上部の一覧: 左に味方（アイコン・名前・HP、撤退中は復活までの秒数）、右に敵（アイコンだけ、撤退中は暗く）
  rosterHud(s: any, myTeam: number, sinceSnap: number) {
    const allies = s.roster.filter((r: any) => r.team === myTeam).map((r: any) => {
      const p = s.players.find((q: any) => q.id === r.id), alive = p ? p.alive : r.alive;
      const st = alive ? `<span class="hp"><i style="width:${p ? Math.min(100, (p.hp / p.maxHp) * 100) : 100}%"></i></span>` : `<span class="rs">反省中 あと${Math.max(0, Math.ceil((p?.respawnIn ?? 0) - sinceSnap))}秒</span>`;
      return `<div class="ally" style="--c:${css16(TEAM_COLOR[myTeam])}">${this.icon(r.char, myTeam, !alive)}<span class="nm">${CHARS[r.char].name}</span>${st}</div>`;
    }).join('') + s.players.filter((p: any) => p.assist && p.team === myTeam).map((p: any) => // アシスト（撃破されたら消える）
      `<div class="ally as" style="--c:${css16(TEAM_COLOR[myTeam])}">${this.icon(p.char, myTeam)}<span class="nm">${charName(p.char)}<b class="tag">ASSIST</b></span><span class="hp"><i style="width:${Math.min(100, (p.hp / p.maxHp) * 100)}%"></i></span></div>`).join('');
    const foes = s.roster.filter((r: any) => r.team !== myTeam).map((r: any) => this.icon(r.char, 1 - myTeam, !r.alive)).join('');
    [allies, foes].forEach((h, k) => { if (h !== this.rosterHtml[k]) { this.rosterHtml[k] = h; $(`.r${k}`).innerHTML = h; } });
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

  // KOした時のカットイン（プレイは止めない）
  cutin(me: string, foe: string) {
    fx.querySelector('.cut')?.remove(); // 同時KOは最後の1体だけ出す
    const el = document.createElement('div');
    el.className = 'cut';
    el.style.setProperty('--d', `${C.CUTIN_MS}ms`);
    el.innerHTML = `<img class="me" src="${TACHIE(me, 'ko')}"><img class="foe" src="${TACHIE(foe, 'select')}">`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), C.CUTIN_MS);
  }

  // ワールド座標に付く一時表示（ダメージ数値・+1・注意）
  popup(text: string, x: number, y: number, cls: string) {
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.textContent = text;
    el.style.setProperty('--d', `${C.POPUP_MS}ms`);
    fx.appendChild(el);
    this.pops.push({ el, x, y, until: performance.now() + C.POPUP_MS });
  }

  notify(text: string) {
    const el = document.createElement('div');
    el.textContent = text;
    $('.notes').appendChild(el);
    setTimeout(() => el.remove(), C.NOTIFY_MS);
  }

  // ワールド座標 → fx 内の座標(px)
  toScreen(x: number, y: number) {
    const cam = this.cameras.main, v = cam.worldView, z = this.game.scale.zoom * cam.zoom;
    return { left: `${(x - v.x) * z}px`, top: `${(y - v.y) * z}px` };
  }

  // ワールド座標に付く常時表示のラベル（毎フレーム呼んだものだけ残す）
  label(key: string, text: string, x: number, y: number, cls: string, seen: Set<string>) {
    seen.add(key);
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = `lbl ${cls}`;
      fx.appendChild(el);
      this.labels.set(key, el);
    }
    if (el.textContent !== text) el.textContent = text;
    Object.assign(el.style, this.toScreen(x, y));
  }

  lobbyUpdate(s: any) {
    const lobby = document.getElementById('lobby')!;
    lobby.style.display = s.phase === 'waiting' ? 'block' : 'none';
    if (TOUCH) ver.style.visibility = s.phase === 'waiting' ? '' : 'hidden'; // スマホは試合中のHUDと重なるので、ビルド番号はキャラ選択の時だけ出す
    if (s.phase !== 'waiting') return;
    const key = JSON.stringify([s.roster, s.me]);
    if (key === this.lobbyKey) return;
    this.lobbyKey = key;
    const myChar = s.roster.find((r: any) => r.id === s.me)?.char;
    lobby.querySelectorAll<HTMLElement>('.card').forEach((el) => el.classList.toggle('mine', el.dataset.k === myChar));
    document.getElementById('roster')!.innerHTML = [0, 1].map((t) => {
      const list = s.roster.filter((r: any) => r.team === t);
      const rows = list.map((r: any) => `${r.bot ? 'Bot' : '人間'}${r.id === s.me ? '（あなた）' : ''} ${CHARS[r.char]?.name ?? ''}`);
      while (rows.length < C.TEAM_SIZE) rows.push('（空き: 開始時にBot）');
      const me = s.roster.find((r: any) => r.id === s.me), join = me && me.team !== t && list.length < C.TEAM_SIZE ? ` <button data-t="${t}">この陣営に入る</button>` : '';
      return `<div class="tm"><b>${TEAM_NAME[t]}</b>${join}<br>${rows.join('<br>')}</div>`;
    }).join('<br>') + (s.me ? '' : '<br>観戦中');
  }

  // 1点からの視界ポリゴン（壁タイルで遮る）
  visPoly(ex: number, ey: number, R: number) {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
      let d = 0;
      while (d < R && !isWall(ex + cx * d, ey + cy * d)) d += 4;
      for (let w = 0; w < T && d < R && isWall(ex + cx * d, ey + cy * d); w += 2) d += 2; // 壁の厚みまで見せる
      pts.push(new Phaser.Math.Vector2(ex + cx * d, ey + cy * d));
    }
    return pts;
  }

  // 罠: 床に置かれたトゲ（陣営色の縁取り）
  drawTrap(g: Phaser.GameObjects.Graphics, x: number, y: number, team: number, alpha: number, r = C.TRAP_RADIUS * 0.8) {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, d = i % 2 ? r * 0.45 : r;
      pts.push(new Phaser.Math.Vector2(x + Math.cos(a) * d, y + Math.sin(a) * d));
    }
    g.fillStyle(0x8c8c96, alpha).fillPoints(pts, true).lineStyle(1.5, TEAM_COLOR[team], alpha).strokePoints(pts, true);
  }

  // バリケード: 茶色の木箱（陣営色の縁取り）
  drawCrate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, team: number, alpha: number) {
    g.fillStyle(0x8b5a2b, alpha).fillRect(x, y, w, h);
    g.lineStyle(2, 0x5c3a1a, alpha).strokeRect(x + 3, y + 3, w - 6, h - 6).lineBetween(x + 3, y + 3, x + w - 3, y + h - 3).lineBetween(x + w - 3, y + 3, x + 3, y + h - 3);
    g.lineStyle(2, TEAM_COLOR[team], alpha).strokeRect(x, y, w, h);
  }

  // 花丸の巨大拳: 半透明の大きな拳（チームカラー）。後ろに流れる線と光
  drawFist(g: Phaser.GameObjects.Graphics, x: number, y: number, a: number, team: number, time: number) {
    const R = C.SKILLS.hanamaru.r, c = teamColor(team), ux = Math.cos(a), uy = Math.sin(a);
    const at = (u: number, v: number) => new Phaser.Math.Vector2(x + ux * u - uy * v, y + uy * u + ux * v);
    for (let i = 0; i < 5; i++) { const v = (i - 2) * R * 0.35, l = R * (1.6 + ((time / 40 + i * 37) % 10) / 10); const p0 = at(-R * 0.6, v), p1 = at(-R * 0.6 - l, v); g.lineStyle(3, c, 0.35).lineBetween(p0.x, p0.y, p1.x, p1.y); } // 流れる線
    g.fillStyle(c, 0.18).fillCircle(x, y, R * 1.35); // 光
    const palm = [at(-R * 0.7, -R * 0.75), at(R * 0.35, -R * 0.8), at(R * 0.35, R * 0.8), at(-R * 0.7, R * 0.75)];
    g.fillStyle(c, 0.55).fillPoints(palm, true).lineStyle(2, 0xffffff, 0.6).strokePoints(palm, true);
    for (let i = 0; i < 4; i++) { const k = at(R * 0.5, (i - 1.5) * R * 0.42); g.fillStyle(c, 0.65).fillCircle(k.x, k.y, R * 0.24).lineStyle(1.5, 0xffffff, 0.6).strokeCircle(k.x, k.y, R * 0.24); } // 指の関節
    const th = [at(-R * 0.1, -R * 0.8), at(R * 0.35, -R * 0.95), at(R * 0.2, -R * 0.55)]; // 親指
    g.fillStyle(c, 0.65).fillTriangle(th[0].x, th[0].y, th[1].x, th[1].y, th[2].x, th[2].y);
  }

  // 資材: 黄色の箱。高ポイント（裏側）はピンクの大きい箱で、明滅する光をまとう
  drawMaterial(g: Phaser.GameObjects.Graphics, x: number, y: number, s = 10, hi = false) {
    if (hi) { const k = 0.5 + 0.5 * Math.sin(performance.now() / 150); g.fillStyle(0xffffff, 0.2 + 0.3 * k).fillCircle(x, y, 12 + 4 * k); s = 14; }
    g.fillStyle(hi ? 0xff7ad9 : 0xffd700).fillRect(x - s / 2, y - s / 2, s, s).lineStyle(1, hi ? 0x8a1d6d : 0x8a6d00).strokeRect(x - s / 2, y - s / 2, s, s).lineBetween(x - s / 2, y, x + s / 2, y);
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
    const r = fx.style, b = this.game.canvas.getBoundingClientRect();
    r.left = `${b.left}px`; r.top = `${b.top}px`; r.width = `${b.width}px`; r.height = `${b.height}px`;
    r.setProperty('--z', String(this.game.scale.zoom));
    const s = this.snap;
    if (!s) return;
    const dt = dtMs / 1000;
    const now = performance.now();
    const k = this.keys;
    const { dx, dy } = this.ctl.move({ up: k.W.isDown, down: k.S.isDown, left: k.A.isDown, right: k.D.isDown });
    if (dx || dy) this.face = Math.atan2(dy, dx);
    // 入力は NET_STEP ごとに番号を付けて送り、同時に自キャラを予測で動かす
    const me0 = s.players.find((p: any) => p.id === s.me);
    this.acc = Math.min(this.acc + dtMs, 250);
    while (this.acc >= C.NET_STEP * 1000) {
      this.acc -= C.NET_STEP * 1000;
      const move = !!me0 && me0.alive && MOVE_PHASES.includes(s.phase) && !me0.stunned && !me0.charge && !me0.dash; // 突撃のタメ中・突撃中は予測で動かさない
      this.room.send('input', this.pred.step(dx, dy, me0?.spd ?? 0, this.obstacles(s, me0), move));
    }
    if (this.lastPhase === 'ended' && s.phase === 'waiting') this.resetMatch();
    this.lastPhase = s.phase;
    this.lobbyUpdate(s);

    if (s.bossRooms && s.bossRooms.join() !== this.homesKey) { this.homesKey = s.bossRooms.join(); this.applyHomes(s.bossRooms); }
    // 壁破壊の反映（タイル・ミニマップ・移動予測の壁）
    if (s.broken.length > this.brokenN) {
      for (const [x, y] of s.broken.slice(this.brokenN)) {
        tiles[y] = tiles[y].slice(0, x) + '.' + tiles[y].slice(x + 1);
        this.layer.putTileAt(1, x, y);
        this.miniTex.context.fillStyle = '#8a8478';
        this.miniTex.context.fillRect(x * MINI, y * MINI, MINI + 0.2, MINI + 0.2);
      }
      this.miniTex.refresh();
      this.walls = wallRects(tiles);
      this.brokenN = s.broken.length;
    }

    // 自キャラの移動予測
    const mine = s.players.find((p: any) => p.id === s.me);
    if (mine) {
      if (!mine.alive) this.face = mine.face;
      const rp = mine.charge || mine.dash ? (this.interp.at(mine.id, now) ?? mine) : this.pred.render(this.acc / (C.NET_STEP * 1000), dtMs);
      Object.assign(this.me, { x: rp.x, y: rp.y, init: true });
    }
    const myTeam = mine?.team ?? 0;
    const sinceSnap = (now - this.snapAt) / 1000;
    const labelSeen = new Set<string>();
    // 対象のid（p:/boss:/f:/bar:/trap:）→ 位置
    const thingPos = (id: string | null): { x: number; y: number } | null => {
      if (!id) return null;
      const k = id.slice(0, id.indexOf(':')), v = id.slice(id.indexOf(':') + 1);
      if (k === 'p') { const q = s.players.find((q: any) => q.id === v); return q ? (q.id === s.me ? this.me : q) : null; }
      if (k === 'boss') return s.bosses.find((b: any) => String(b.team) === v) ?? null;
      if (k === 'c') return s.couriers.find((c: any) => String(c.id) === v) ?? null;
      if (k === 'f') return s.funnels.find((f: any) => String(f.id) === v) ?? null;
      if (k === 'bar') { const b = s.barricades.find((b: any) => String(b.id) === v); return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null; }
      return s.traps.find((t: any) => String(t.id) === v) ?? null;
    };

    // ユニット描画（受信したものだけ）
    const seen = new Set<string>();
    const feet = this.feet.clear();
    const draw = (id: string, char: string, team: number, x: number, y: number, face: number, hp: number, maxHp: number, alpha: number, scale: number, p?: any) => {
      seen.add(id);
      let e = this.units.get(id);
      if (!e || e.char !== char) {
        e?.s.destroy();
        e = { s: this.add.sprite(x, y, `${char}_idle`).setOrigin(0.5, 0.85).setScale(scale), char, tx: x, ty: y, blinkAt: time + 1000 + Math.random() * 4000, flashUntil: 0 };
        this.units.set(id, e);
      }
      const isMe = id === s.me;
      const cx = x, cy = y; // 他キャラは補間済みの位置
      const moving = isMe ? MOVE_PHASES.includes(s.phase) && alpha === 1 && (dx || dy) : Math.hypot(cx - e.tx, cy - e.ty) > 0.3;
      e.tx = cx; e.ty = cy;
      const sp = e.s;
      if (s.phase === 'intro' && p && C.INTRO_MODE === 'old') sp.stop().setTexture(`${char}_banzai`); // 旧開幕は万歳
      else if (moving) sp.play(`${char}_walk`, true);
      else if (sp.texture.key === `${char}_banzai`) sp.setTexture(`${char}_idle`);
      else if (sp.anims.isPlaying && sp.anims.currentAnim?.key === `${char}_walk`) sp.stop().setTexture(`${char}_idle`);
      else if (time >= e.blinkAt) { sp.play(`${char}_blink`); e.blinkAt = time + 2000 + Math.random() * 4000; } // ときどき瞬き
      const f = isMe ? this.face : face;
      sp.setPosition(Math.round(cx), Math.round(cy)).setFlipX(Math.cos(f) > 0.01).setAlpha(alpha).setDepth(10 + cy / 10000);
      // 足元の陣営色と頭上のHP
      const h = sp.displayHeight * 0.85;
      feet.fillStyle(teamColor(team), isMe ? 0.9 : 0.5).fillEllipse(cx, cy, 18 * scale, 7 * scale);
      if (alpha === 1) feet.fillStyle(0x000000, 0.6).fillRect(cx - 10, cy - h - 5, 20, 3).fillStyle(teamColor(team)).fillRect(cx - 10, cy - h - 5, 20 * Math.max(0, Math.min(1, hp / maxHp)), 3);
      // 被弾: 白く点滅してダメージ数値
      if (e.hp !== undefined && hp < e.hp) {
        e.flashUntil = time + C.HIT_FLASH_MS;
        this.popup(String(Math.round(e.hp - hp)), cx, cy - h - 6, 'dmg');
      }
      e.hp = hp;
      if (time < e.flashUntil || (p?.charge && Math.floor(time / C.ARU_FX.blinkMs) % 2)) sp.setTintFill(0xffffff); // 被弾・突撃のタメ中は白く点滅
      else sp.clearTint();
      if (!p) return;
      // 攻撃: 硬直時間が増えたら斬撃エフェクト
      if (e.cd !== undefined && p.cd > e.cd + 0.05 && !C.RANGED[p.char]) {
        const tp = thingPos(p.tgt); // オートアタックは対象の方向
        this.slashes.push({ x: cx, y: cy - 8, face: tp ? Math.atan2(tp.y - cy, tp.x - cx) : f, t0: time });
      }
      e.cd = p.cd;
      // 指名手配: 頭上に手配マーク
      if (p.alive && s.teams[p.team]?.wanted === p.id) this.label(`wanted${id}`, '★手配★', cx, cy - h - 30, 'wanted', labelSeen);
      if (p.boost) feet.lineStyle(2, SKILL_FX_COLOR.heal, 0.9).strokeEllipse(cx, cy, 30, 12); // 白上虎太郎の移動速度上昇
      if (p.slow) feet.lineStyle(2, SKILL_FX_COLOR.pen_slow, 0.9).strokeEllipse(cx, cy + 2, 24, 8); // 罰: 移動速度低下（足元の青い輪）
      if (p.weak) { feet.fillStyle(SKILL_FX_COLOR.pen_weak, 0.9).fillTriangle(cx + 9, cy - h + 2, cx + 15, cy - h + 2, cx + 12, cy - h + 8); feet.fillRect(cx + 11, cy - h - 4, 2, 6); } // 罰: 攻撃力低下（下向きの矢印）
      // ずんだ餅（緑の餅に変化）と、技の効果の目印
      sp.setVisible(!p.mochi);
      if (p.mochi) feet.fillStyle(0x4f9f2f).fillEllipse(cx, cy - 5, 24, 17).fillStyle(0x8fdf5f).fillEllipse(cx, cy - 6, 20, 13).fillStyle(0xd8f5b0).fillEllipse(cx - 4, cy - 9, 7, 4);
      if (p.barrier) feet.lineStyle(2, SKILL_FX_COLOR.barrier, 0.9).strokeCircle(cx, cy - 14, 17);
      if (p.accel) feet.lineStyle(2, SKILL_FX_COLOR.accel, 0.9).strokeEllipse(cx, cy, 28, 11);
      if (p.dance) feet.lineStyle(1, SKILL_FX_COLOR.ring, 0.5).strokeCircle(cx, cy, C.SKILLS.sayo.r);
      if (p.fly) feet.fillStyle(SKILL_FX_COLOR.fly, 0.35).fillEllipse(cx, cy + 4, 26, 8).lineStyle(1, SKILL_FX_COLOR.fly).strokeEllipse(cx, cy - 6, 30, 12); // きりたん砲飛行
      // ウルト中: 見た目は変えず、変身先の色の光をまとう
      if (p.ult && p.ult.left !== null) {
        const pulse = 0.5 + 0.3 * Math.sin(time / 120);
        feet.lineStyle(3, ULT_COLOR[p.ult.form], pulse).strokeCircle(cx, cy - h / 2, 20).lineStyle(1, 0xffffff, pulse).strokeCircle(cx, cy - h / 2, 23);
        this.label(`ult${id}`, `ULT ${C.POWER_TIERS[p.ult.tier]}`, cx, cy - h - 22, '', labelSeen);
      }
      // アシスト: 半透明の縁取りと頭上の「ASSIST」
      if (p.assist) {
        sp.setAlpha(0.8);
        feet.lineStyle(2, ITEM_COLOR.assist, 0.6).strokeRoundedRect(cx - 14, cy - h - 2, 28, h + 6, 5);
        this.label(`assist${id}`, `ASSIST ${C.POWER_TIERS[p.tier]}`, cx, cy - h - 14, '', labelSeen);
      }
    };
    for (const p of s.players) {
      const pos = p.id === s.me ? this.me : (this.interp.at(p.id, now) ?? p);
      draw(p.id, p.char, p.team, pos.x, pos.y, p.face, p.hp, p.maxHp, p.alive ? 1 : 0.3, p.assist ? C.DOT_SCALE * C.ASSIST.scale : C.DOT_SCALE, p); // アシストは大将と同じ大きさ
    }
    for (const b of s.bosses) { const q = this.interp.at('boss' + b.team, now) ?? b; draw('boss' + b.team, BOSS_CHAR[b.team], b.team, q.x, q.y, b.team === 0 ? 0 : Math.PI, b.hp, C.BOSS_HP, 1, C.DOT_SCALE * 2); }
    // ブイブイ・コバコ（中立）: 進む向きを見て、頭上に荷物の中身のアイコン
    for (const c of s.couriers) {
      const id = 'c' + c.id, q = this.interp.at(id, now) ?? c, u = this.units.get(id);
      const f = u && Math.abs(q.x - u.tx) > 0.1 ? (q.x > u.tx ? 0 : Math.PI) : u?.s.flipX ? 0 : Math.PI;
      draw(id, COURIER_CHAR, -1, q.x, q.y, f, 1, 1, 1, C.DOT_SCALE);
      this.drawItem(feet, { kind: `box_${c.box}`, x: q.x, y: q.y - 54 });
    }
    for (const [id, e] of this.units) {
      if (!seen.has(id)) { e.s.destroy(); this.units.delete(id); }
    }
    // カメラ: 開始演出は味方の横並びに寄せる。撤退中は WASD で視点だけ動かす（壁に関係なく）。それ以外は自キャラに追従
    const camera = this.cameras.main, meUnit = this.units.get(s.me);
    const freeCam = !!mine && !mine.alive && s.phase === 'playing';
    if (C.INTRO_MODE === 'old') this.introCamOld(s, myTeam, camera);
    else this.introCamNew(s, myTeam, sinceSnap, camera, labelSeen);
    if (freeCam) {
      camera.stopFollow();
      camera.scrollX += dx * C.FREE_CAM_SPEED * dt; camera.scrollY += dy * C.FREE_CAM_SPEED * dt;
    } else if (meUnit && !this.introCam && (camera as any)._follow !== meUnit.s) camera.startFollow(meUnit.s, true, C.CAM_LERP, C.CAM_LERP);
    // 画面に固定の表示（フォグ・ミニマップ）はカメラの拡大で崩れるので、開始演出の間は隠す
    this.miniImg.setVisible(!this.introCam); this.ui.setVisible(!this.introCam);

    // 自キャラ: 射程の円と、硬直中のクールタイムバー
    if (mine?.alive) {
      feet.lineStyle(1, 0xffffff, C.RANGE_ALPHA).strokeCircle(this.me.x, this.me.y, C.RANGED[mine.char] ?? C.ATTACK_RANGE);
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

    // 斬撃エフェクト（向いている方向の扇形）
    const fxG = this.fxG.clear();
    this.slashes = this.slashes.filter((sl) => time - sl.t0 < C.SLASH_MS);
    for (const sl of this.slashes) {
      const t = (time - sl.t0) / C.SLASH_MS;
      fxG.fillStyle(0xffffff, 0.6 * (1 - t)).slice(sl.x, sl.y, C.ATTACK_RANGE, sl.face - C.ATTACK_ARC / 2, sl.face + C.ATTACK_ARC / 2).fillPath();
    }
    // 技の範囲エフェクト
    for (const f of this.fxQueue) {
      if (f.kind === 'toku') this.popup(`${f.hi ? '★' : ''}${f.text} ${f.d > 0 ? '+' : '−'}${Math.abs(f.d).toFixed(2).replace(/0$/, '')}`, f.x, f.y - 34, f.d > 0 ? (f.hi ? 'plus hi' : 'plus') : 'dmg'); // 徳の増減を頭上に（高ポイントの資材は★付きのピンク）
      else this.skillFx.push({ ...f, t0: time });
    }
    this.fxQueue = [];
    this.skillFx = this.skillFx.filter((f) => time - f.t0 < C.SKILL_FX_MS);
    for (const f of this.skillFx) {
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
    // アシストの範囲攻撃・大将の広範囲攻撃の予告: 赤い円が満ちていく
    for (const w of s.warns) {
      const k = Math.max(0, Math.min(1, 1 - (w.left - sinceSnap) / (w.boss ? C.BOSS_BLAST.warn : 1)));
      fxG.fillStyle(0xff2020, 0.18).fillCircle(w.x, w.y, w.r).fillStyle(0xff2020, 0.35).fillCircle(w.x, w.y, w.r * k).lineStyle(2, 0xff2020, 0.9).strokeCircle(w.x, w.y, w.r);
    }
    // アルの突撃: タメ中は予測進路の警告（敵からも視界内なら見える）、突撃中は渦と煙
    const AR = C.SKILLS.aru, AF = C.ARU_FX;
    this.smoke = this.smoke.filter((m) => time - m.t0 < AR.smoke * 1000);
    for (const p of s.players) {
      if (!p.alive || (!p.charge && !p.dash)) continue;
      const pos = p.id === s.me ? this.me : (this.interp.at(p.id, now) ?? p);
      const a = (p.charge ?? p.dash).a, ux = Math.cos(a), uy = Math.sin(a), h = AR.w / 2;
      const at = (u: number, v: number) => new Phaser.Math.Vector2(pos.x + ux * u - uy * v, pos.y + uy * u + ux * v);
      if (p.charge) {
        const band = [at(0, -h), at(p.charge.len, -h), at(p.charge.len, h), at(0, h)];
        fxG.fillStyle(0xff2020, 0.18 + 0.14 * (Math.floor(time / AF.warnBlinkMs) % 2)).fillPoints(band, true).lineStyle(2, 0x8b0000, 0.95).strokePoints(band, true);
        for (let i = 0; i < AF.arrows; i++) { const u = (p.charge.len * (i + 0.5)) / AF.arrows, tri = [at(u + 10, 0), at(u - 6, -9), at(u - 6, 9)]; fxG.fillStyle(0xffffff, 0.9).fillTriangle(tri[0].x, tri[0].y, tri[1].x, tri[1].y, tri[2].x, tri[2].y); }
        continue;
      }
      // 渦: 頭の中心付近から尾へ、半径が広がりながら回り込む7本の筋。雫の形の外は描かない
      const spin = (time / 1000) * AR.spin;
      for (let i = 0; i < AF.strands; i++) {
        const [col, wd, al] = AF.lines[i % 2];
        fxG.lineStyle(wd, col, al);
        let prev: Phaser.Math.Vector2 | null = null;
        for (let k = 0; k <= 40; k++) {
          const t = k / 40, th = spin + (i * Math.PI * 2) / AF.strands + t * AF.turn, rr = AF.r0 + t * (AF.r1 - AF.r0), back = t * AF.back;
          const q = at(AR.head - back + Math.cos(th) * rr, Math.sin(th) * rr);
          const inside = inDashShape(q.x, q.y, pos.x, pos.y, a);
          if (inside && prev) fxG.lineBetween(prev.x, prev.y, q.x, q.y);
          prev = inside ? q : null;
        }
      }
      this.smoke.push({ x: pos.x - ux * 12 + (Math.random() - 0.5) * 10, y: pos.y - uy * 12 + 2 + (Math.random() - 0.5) * 6, t0: time });
    }
    for (const m of this.smoke) { const k = (time - m.t0) / (AR.smoke * 1000); fxG.fillStyle(0x9a9a9a, 0.5 * (1 - k)).fillCircle(m.x, m.y, 3 + k * 9); }
    // ファンネルと弾・矢
    for (const f of s.funnels) {
      const r = C.SKILLS.mochiko.radius;
      fxG.fillStyle(TEAM_COLOR[f.team]).fillTriangle(f.x, f.y - r - 2, f.x - r, f.y + r, f.x + r, f.y + r).lineStyle(1, 0xffffff).strokeTriangle(f.x, f.y - r - 2, f.x - r, f.y + r, f.x + r, f.y + r);
    }
    for (const f of s.fists ?? []) this.drawFist(fxG, f.x, f.y, f.a, f.team, time);
    for (const sh of s.shots) {
      const l = Math.hypot(sh.vx, sh.vy) || 1;
      if (sh.kind === 'cannon') fxG.fillStyle(0xc87a3a).fillCircle(sh.x, sh.y, 5).lineStyle(1, 0x5a3010).strokeCircle(sh.x, sh.y, 5); // きりたん砲
      else if (sh.kind === 'arrow') fxG.lineStyle(3, 0x4fbf2f).lineBetween(sh.x - (sh.vx / l) * 14, sh.y - (sh.vy / l) * 14, sh.x, sh.y).fillStyle(0xd8f5b0).fillCircle(sh.x, sh.y, 3);
      else fxG.fillStyle(0x8fdf5f).fillCircle(sh.x, sh.y, C.BULLET_RADIUS).lineStyle(1, 0x2f6f1f).strokeCircle(sh.x, sh.y, C.BULLET_RADIUS);
    }

    const g = this.g.clear();
    // 自陣の大将の候補部屋の縁取り
    if (mine) for (const h of this.homes[myTeam]) g.lineStyle(3, TEAM_COLOR[myTeam], 0.9).strokeRect(h.x + 2, h.y + 2, h.w - 4, h.h - 4);
    for (const m of s.materials) this.drawMaterial(g, m.x, m.y, 10, m.hi);
    for (const it of s.items) {
      this.drawItem(g, it);
      this.label(`item${it.id}`, ITEM_LABEL[it.kind], it.x, it.y - 15, '', labelSeen);
    }
    for (const t of s.traps) {
      // bii の罠: 向きの扇形（射程）をうっすら、耐久バー
      const B = C.SKILLS.bii;
      g.fillStyle(SKILL_FX_COLOR.trap, 0.08).slice(t.x, t.y, B.range, t.a - B.arc / 2, t.a + B.arc / 2).fillPath();
      this.drawTrap(g, t.x, t.y, t.team, 1);
      g.fillStyle(0x000000, 0.6).fillRect(t.x - 10, t.y - 18, 20, 3).fillStyle(0xffffff).fillRect(t.x - 10, t.y - 18, 20 * Math.max(0, t.hp / B.hp), 3);
    }
    for (const b of s.barricades) {
      this.drawCrate(g, b.x, b.y, b.w, b.h, b.team, 1);
      g.fillStyle(0x000000, 0.6).fillRect(b.x, b.y - 6, b.w, 3).fillStyle(0xffffff).fillRect(b.x, b.y - 6, b.w * Math.max(0, b.hp / C.BARRICADE_HP), 3);
    }
    // Q の設置プレビュー: 壁破壊の穴の上なら半透明の木箱。キャラと重なる位置は赤く表示
    if (mine?.alive) {
      const px = this.me.x + Math.cos(this.face) * C.PLACE_DIST, py = this.me.y + Math.sin(this.face) * C.PLACE_DIST;
      if (s.broken.some(([bx, by]: number[]) => bx === Math.floor(px / T) && by === Math.floor(py / T))) {
        this.drawCrate(g, px - C.BARRICADE_SIZE / 2, py - C.BARRICADE_SIZE / 2, C.BARRICADE_SIZE, C.BARRICADE_SIZE, myTeam, 0.45);
        const bodies = [
          ...s.players.filter((p: any) => p.alive).map((p: any) => ({ ...(p.id === s.me ? this.me : p), r: C.PLAYER_RADIUS })),
          ...s.bosses.map((b: any) => ({ x: b.x, y: b.y, r: C.BOSS_RADIUS })),
          ...s.funnels.map((f: any) => ({ x: f.x, y: f.y, r: C.SKILLS.mochiko.radius })),
        ];
        if (!canPlace('barricade', px, py, bodies)) g.fillStyle(0xff2020, 0.5).fillRect(px - C.BARRICADE_SIZE / 2, py - C.BARRICADE_SIZE / 2, C.BARRICADE_SIZE, C.BARRICADE_SIZE);
      }
    }

    // 視界（観戦者はフォグなし）
    const vg = this.visG.clear().fillStyle(0xffffff);
    this.fog.setVisible(!!mine && !this.introCam);
    if (mine) {
      const eyes = s.players.filter((p: any) => p.team === myTeam && p.alive).map((p: any) => (p.id === s.me ? { ...this.me, char: p.char } : p));
      const boss = s.bosses.find((b: any) => b.team === myTeam);
      if (boss) eyes.push(boss);
      const t0 = performance.now();
      for (const e of eyes) vg.fillPoints(this.visPoly(e.x, e.y, visionRadius(e.char)), true);
      if (this.perf) { const q = this.perf, ray = performance.now() - t0; q.n++; q.ray += ray; q.rayMax = Math.max(q.rayMax, ray); q.frame += dtMs; q.frameMax = Math.max(q.frameMax, dtMs); (window as any).perf = q; }
    }

    // HUD: タイマー、大将HPバー
    const sec = Math.ceil(s.timeLeft);
    $('.timer').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    [myTeam, 1 - myTeam].forEach((t, i) => { const el = $(`.b${i} i`); el.style.width = `${s.teams[t].bossHpRatio * 100}%`; el.style.background = css16(TEAM_COLOR[t]); }); // 左＝自陣、右＝敵陣
    // リザルトの「戻る」: 押した人数／全人数（Botは押した扱い）
    const back = $('.back') as HTMLButtonElement;
    back.style.display = s.phase === 'ended' && mine ? 'block' : 'none';
    if (s.back) { const t = this.backSent ? `待機中 ${s.back.n}/${s.back.total}` : `戻る（${s.back.n}/${s.back.total}）`; if (back.textContent !== t) back.textContent = t; back.disabled = this.backSent; }
    this.rosterHud(s, myTeam, sinceSnap);
    if (s.phase !== 'waiting') this.tokuHud(s, myTeam, sinceSnap);
    $('.tk').style.display = s.phase === 'waiting' ? 'none' : 'flex';
    if (C.INTRO_MODE === 'old') this.introOld(s, myTeam, sinceSnap);
    this.staging(s, mine, myTeam, sinceSnap);
    // 技のアイコンとクールタイム
    const sk = mine && C.SKILLS[mine.char], skEl = $('.skill');
    skEl.style.display = sk ? 'flex' : 'none';
    if (sk) {
      const cd = Math.max(0, mine.skillCd - sinceSnap);
      $('.skill .sn').textContent = sk.name;
      $('.skill b').textContent = mine.mochi ? '餅' : cd > 0 ? String(Math.ceil(cd)) : 'OK';
      $('.skill i').style.setProperty('--p', `${(cd / sk.ct) * 360}deg`);
      skEl.style.borderColor = cd > 0 || mine.mochi ? '#888' : '#ffe066';
    }
    if (TOUCH) { const t = `照準<br>${AIM_SHORT[mine?.aim ?? C.AIM_MODES[this.ctl.aimMode]]}`; if ($('.aimb').innerHTML !== t) $('.aimb').innerHTML = t; }
    // ミニマップ
    const ui = this.ui.clear();
    const mx = C.VIEW_W - 4 - MAP.width * MINI, my = C.VIEW_H - 4 - MAP.height * MINI, ms = MINI / T;
    for (const p of s.players) if (p.alive) ui.fillStyle(p.id === s.me ? 0xffffff : TEAM_COLOR[p.team]).fillRect(mx + (p.id === s.me ? this.me.x : p.x) * ms - 1, my + (p.id === s.me ? this.me.y : p.y) * ms - 1, 3, 3);
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
    const eyes = [...s.players.filter((p: any) => p.team === myTeam && p.alive), ...s.bosses.filter((b: any) => b.team === myTeam)];
    const seeObs = [...this.walls, ...s.barricades];
    for (const m of s.materials) {
      if (mine && !eyes.some((e: any) => Math.hypot(e.x - m.x, e.y - m.y) <= visionRadius(e.char) && lineOfSight(e.x, e.y, m.x, m.y, seeObs))) continue;
      if (m.hi) ui.fillStyle(0xff7ad9).fillRect(mx + m.x * ms - 2, my + m.y * ms - 2, 4, 4); // 高ポイントはピンクで大きく
      else ui.fillStyle(0xffd700).fillRect(mx + m.x * ms - 1, my + m.y * ms - 1, 2.5, 2.5);
    }
    const cam = this.cameras.main.worldView;
    ui.lineStyle(1, 0xffffff, 0.6).strokeRect(mx + cam.x * ms, my + cam.y * ms, cam.width * ms, cam.height * ms);
    // ワールドに付く一時表示とラベルの位置
    this.pops = this.pops.filter((p) => (now < p.until ? (Object.assign(p.el.style, this.toScreen(p.x, p.y)), true) : (p.el.remove(), false)));
    for (const [key, el] of this.labels) if (!labelSeen.has(key)) { el.remove(); this.labels.delete(key); }

    // KOされた時: やられ顔と復活までの残り時間
    if (mine && !mine.alive && s.phase === 'playing') {
      const img = down.querySelector('img')!, koed = CHARS[mine.char].koed;
      const src = TACHIE(mine.char, koed ? 'koed' : 'select');
      if (!img.src.endsWith(src)) img.src = src;
      img.style.filter = koed ? '' : 'grayscale(1)';
      img.classList.toggle('fall', !koed); // やられ顔がないキャラは傾けながらずり落とす
      down.style.setProperty('--d', `${C.CUTIN_MS}ms`);
      down.querySelector('div')!.textContent = `反省中 あと${Math.max(0, mine.respawnIn - (performance.now() - this.snapAt) / 1000).toFixed(1)}秒`; // 受信後の経過分を毎フレーム引く
      down.style.display = 'block';
    } else down.style.display = 'none';

    const result = s.winner === 2 ? '引き分け' : s.winner >= 0 ? `${TEAM_NAME[s.winner]}の勝ち` : '';
    $('#info').textContent = [
      `あなた: ${mine ? TEAM_NAME[myTeam] : '観戦中'}  状態: ${s.phase}  残り ${Math.ceil(s.timeLeft)}秒 ${result}`,
      `自キャラ座標: ${mine ? `${Math.round(mine.x)}, ${Math.round(mine.y)}` : '-'}`,
      ...s.teams.map((t: any, i: number) => `${TEAM_NAME[i]}: 徳${t.toku.toFixed(1)} 大将耐久${Math.round(t.bossHpRatio * 100)}%`),
      `悪行 ${(mine?.bad ?? 0).toFixed(2)}${mine?.ult ? `  ウルト: ${C.ULT_FORMS[mine.ult.form].name}（${C.POWER_TIERS[mine.ult.tier]}）${mine.ult.left === null ? ' 復活後に開始' : ` 残り${Math.ceil(mine.ult.left)}秒`}` : ''}`,
      ...(this.perf ? [`視界の計算 平均${(this.perf.ray / this.perf.n).toFixed(2)}ms 最大${this.perf.rayMax.toFixed(1)}ms／フレーム間隔 平均${(this.perf.frame / this.perf.n).toFixed(1)}ms 最大${this.perf.frameMax.toFixed(0)}ms`] : []),
      `照準: ${C.AIM_LABEL[mine?.aim ?? C.AIM_MODES[this.ctl.aimMode]]}${TOUCH ? '' : '（Tabで切替）'}  技: ${sk ? `${sk.name}${TOUCH ? '' : '（R）'}` : 'なし'}`,
      ...(TOUCH ? [] : ['WASD移動 / オート攻撃・SPACE手動攻撃 / Q設置（長押しで帰還） / R技 / Tab照準']), // タッチ端末にはPCのキー操作を出さない
    ].join('\n');
  }
}

// 論理解像度を整数倍で表示（#wrap はノッチなどを除いた範囲）
const wrap = document.getElementById('wrap')!;
// スマホで等倍に収まらない時（Safari のアドレスバーなど）だけ、収まるように縮小する
const zoom = () => { const z = Math.min(wrap.clientWidth / C.VIEW_W, wrap.clientHeight / C.VIEW_H); return TOUCH && z < 1 ? z : Math.max(1, Math.floor(z)); };
const game = new Phaser.Game({
  type: Phaser.WEBGL, width: C.VIEW_W, height: C.VIEW_H, backgroundColor: '#111', pixelArt: true, scene: GameScene, parent: wrap,
  scale: { mode: Phaser.Scale.NONE, zoom: zoom(), autoCenter: Phaser.Scale.CENTER_BOTH },
});
addEventListener('resize', () => game.scale.setZoom(zoom()));
(window as any).game = game;
