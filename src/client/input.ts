import type { C2S } from '../shared/protocol';
// 入力の抽象化: キーボードとタッチを同じ入力コマンド（サーバーへ送るメッセージ）にする
import { CONFIG as C } from '../shared/config';

export type Send = <K extends keyof C2S>(type: K, msg?: C2S[K]) => void; // 送る中身は shared/protocol.ts の型（sec1）
export type Keys = { up: boolean; down: boolean; left: boolean; right: boolean };

export class Controls {
  aimMode = 0; // C.AIM_MODES の添字
  private stick: { x: number; y: number } | null = null; // 仮想スティックの中心からのずれ(px)。触れていなければ null

  constructor(private send: Send) {}

  // 移動の向き。キーボードを優先し、押していなければスティック（遊びの外なら向きだけ。速さは常に最大）
  move(k: Keys): { dx: number; dy: number } {
    const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0), dy = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    if (dx || dy || !this.stick) return { dx, dy };
    const l = Math.hypot(this.stick.x, this.stick.y);
    return l < C.TOUCH.dead ? { dx: 0, dy: 0 } : { dx: this.stick.x / l, dy: this.stick.y / l };
  }
  setStick(x: number, y: number) { this.stick = { x, y }; }
  releaseStick() { this.stick = null; }

  skill() { this.send('skill'); }
  // 技の矢印（押す→矢印→離して発動）。src: 押している入力（R・技ボタン・右クリック。どれかを押している間は続く）、re: タメ中の向きの変更（動かすたびに送る）
  // a: 動かした矢印の向き（null＝動かしていない＝自動照準）
  aim: { srcs: Set<string>; a: number | null; re: boolean } | null = null;
  aimDown(src: string, re: boolean) {
    if (!this.aim) this.aim = { srcs: new Set(), a: null, re };
    this.aim.srcs.add(src);
  }
  aimTo(a: number) {
    if (!this.aim || this.aim.a === a) return;
    this.aim.a = a;
    if (this.aim.re) this.send('skillAim', { a });
  }
  // 全部の入力を離したら発動（タメ中なら向きの確定）。向きを動かしていなければ a なし
  aimUp(src: string) {
    if (!this.aim?.srcs.delete(src) || this.aim.srcs.size) return;
    const a = this.aim.a;
    this.aim = null;
    this.send('skillUp', a === null ? {} : { a });
  }
  qDown() { this.send('qdown'); } // 短押しで設置、長押しでリコール（判定はサーバー）
  qUp() { this.send('qup'); }
  // 照準モードを順に切り替え
  cycleAim() {
    this.aimMode = (this.aimMode + 1) % C.AIM_MODES.length;
    this.sendAim();
  }
  sendAim() { this.send('aim', { mode: C.AIM_MODES[this.aimMode] }); }
}
