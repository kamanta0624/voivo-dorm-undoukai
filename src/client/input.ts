// 入力の抽象化: キーボードとタッチを同じ入力コマンド（サーバーへ送るメッセージ）にする
import { CONFIG as C } from '../shared/config';

export type Send = (type: string, msg?: any) => void;
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
  qDown() { this.send('qdown'); } // 短押しで設置、長押しでリコール（判定はサーバー）
  qUp() { this.send('qup'); }
  // 照準モードを順に切り替え
  cycleAim() {
    this.aimMode = (this.aimMode + 1) % C.AIM_MODES.length;
    this.sendAim();
  }
  sendAim() { this.send('aim', { mode: C.AIM_MODES[this.aimMode] }); }
}
