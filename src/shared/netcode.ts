// 通信まわりの計算（サーバーとクライアントで共通）。ブラウザなしでテストできるよう Phaser に依存しない
import { CONFIG as C, Rect } from './config';
import type { ClientMeasure } from './netmeasure';
import { moveBody, pushOut } from './geom';

// 入力1つぶん（NET_STEP 秒）の移動。サーバーとクライアントで同じ計算をする
export function stepPlayer(x: number, y: number, dx: number, dy: number, speed: number, obstacles: Rect[]) {
  const len = Math.hypot(dx, dy), d = speed * C.NET_STEP;
  const n = len ? moveBody(x, y, (dx / len) * d, (dy / len) * d, C.PLAYER_RADIUS, obstacles) : { x, y };
  return pushOut(n.x, n.y, C.PLAYER_RADIUS, obstacles);
}

type Hist = { seq: number; dx: number; dy: number; move: boolean; x: number; y: number };

// 自キャラの予測。入力に番号を付けて先に動かし、サーバーが処理済みの番号の位置と照合する
export class Predictor {
  seq = 0;
  x = 0; y = 0; // 最新の予測位置
  px = 0; py = 0; // 1つ前の予測位置（描画の補間用）
  ox = 0; oy = 0; // 補正で生じた見た目のずれ（少しずつ0に戻す）
  alpha = 0; // 直近の描画で使った補間の割合（補正の前後で描画位置を連続させるため）
  init = false;
  hist: Hist[] = [];

  reset(x: number, y: number) {
    Object.assign(this, { x, y, px: x, py: y, ox: 0, oy: 0, init: true, hist: [] });
  }

  // 入力を1つ進める。戻り値をサーバーへ送る
  step(dx: number, dy: number, speed: number, obstacles: Rect[], move: boolean) {
    const seq = ++this.seq;
    this.px = this.x; this.py = this.y;
    if (move) ({ x: this.x, y: this.y } = stepPlayer(this.x, this.y, dx, dy, speed, obstacles));
    this.hist.push({ seq, dx, dy, move, x: this.x, y: this.y });
    if (this.hist.length > C.NET_HIST_MAX) this.hist.shift();
    return { seq, dx, dy };
  }

  // サーバーの位置（ack 番まで処理済み）と照合。ずれていればサーバーの位置から未処理の入力をやり直す
  reconcile(sx: number, sy: number, ack: number, speed: number, obstacles: Rect[]) {
    if (!this.init) return this.reset(sx, sy);
    const h = this.hist.find((e) => e.seq === ack);
    this.hist = this.hist.filter((e) => e.seq > ack);
    if (h && Math.hypot(h.x - sx, h.y - sy) < C.NET_EPS) return;
    const lerp = (ax: number, bx: number) => ax + (bx - ax) * this.alpha;
    const rx = lerp(this.px, this.x), ry = lerp(this.py, this.y); // 補正前に描いていた位置（見た目のずれを除く）
    let x = sx, y = sy, px = sx, py = sy;
    for (const e of this.hist) {
      px = x; py = y;
      if (e.move) ({ x, y } = stepPlayer(x, y, e.dx, e.dy, speed, obstacles));
      e.x = x; e.y = y;
    }
    this.x = x; this.y = y;
    this.px = this.hist.length ? px : x; this.py = this.hist.length ? py : y;
    // 補正の前後で描く位置が変わらないよう、差を見た目のずれに足してゆっくり戻す。大きなずれ（はじき・突撃・復活）はそのまま反映
    const ex = rx - lerp(this.px, this.x), ey = ry - lerp(this.py, this.y);
    if (Math.hypot(ex, ey) < C.NET_SNAP) { this.ox += ex; this.oy += ey; } else { this.ox = 0; this.oy = 0; }
  }

  // 描画位置。alpha: 次の入力までの経過割合(0〜1)
  render(alpha: number, dtMs: number) {
    this.alpha = alpha;
    const k = Math.exp(-dtMs / C.NET_SMOOTH_MS);
    const d = Math.hypot(this.ox, this.oy), step = Math.min(d * (1 - k), (C.NET_CORR_SPEED * dtMs) / 1000); // 1フレームで戻す量に上限
    if (d > 0) { this.ox -= (this.ox / d) * step; this.oy -= (this.oy / d) * step; }
    return { x: this.px + (this.x - this.px) * alpha + this.ox, y: this.py + (this.y - this.py) * alpha + this.oy };
  }
}

// 他キャラの描画: サーバー時刻付きのスナップショットを溜め、少し過去の時刻の位置を補間する
export class Interp {
  measure: ClientMeasure | null = null;
  buf: { t: number; pos: Map<string, { x: number; y: number }> }[] = [];
  offset: number | null = null; // 受信時刻 - サーバー時刻 の最小値（遅延の揺らぎを除く）

  push(t: number, recvMs: number, items: { id: string; x: number; y: number }[]) {
    if (this.buf.length && t <= this.buf[this.buf.length - 1].t) return;
    this.buf.push({ t, pos: new Map(items.map((i) => [i.id, { x: i.x, y: i.y }])) });
    while (this.buf.length > 2 && this.buf[1].t < t - 2) this.buf.shift();
    const o = recvMs / 1000 - t;
    this.offset = this.offset === null ? o : Math.min(this.offset + C.NET_OFFSET_DRIFT, o);
  }

  // 描画するサーバー時刻
  renderTime(nowMs: number) {
    return nowMs / 1000 - (this.offset ?? 0) - C.NET_INTERP_DELAY;
  }

  at(id: string, nowMs: number): { x: number; y: number } | null {
    const T = this.renderTime(nowMs);
    type S = { t: number; p: { x: number; y: number } };
    let a: S | null = null, b: S | null = null;
    for (const s of this.buf) {
      const p = s.pos.get(id);
      if (!p) continue;
      if (s.t <= T) a = { t: s.t, p };
      else { b = { t: s.t, p }; break; }
    }
    if (a && b) {
      this.measure?.interpolation(id, 0);
      if (Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) > C.NET_SNAP) return a.p; // 復活などの大きな移動は補間せず、その時刻で切り替える
      const k = (T - a.t) / (b.t - a.t);
      return { x: a.p.x + (b.p.x - a.p.x) * k, y: a.p.y + (b.p.y - a.p.y) * k };
    }
    if (a && !b) {
      // 次の位置がまだ届いていない: 直前の2点の速度で少しだけ先を推測（止まってから飛ぶのを防ぐ）
      let a0: S | null = null;
      for (const s of this.buf) { const p = s.pos.get(id); if (p && s.t < a.t) a0 = { t: s.t, p }; }
      if (a0 && Math.hypot(a.p.x - a0.p.x, a.p.y - a0.p.y) < C.NET_SNAP) {
        this.measure?.interpolation(id, T <= a.t ? 0 : T - a.t >= C.NET_EXTRAPOLATE ? 2 : 1);
        const k = Math.min(T - a.t, C.NET_EXTRAPOLATE) / (a.t - a0.t);
        return { x: a.p.x + (a.p.x - a0.p.x) * k, y: a.p.y + (a.p.y - a0.p.y) * k };
      }
    }
    this.measure?.interpolation(id, 0);
    return (a ?? b)?.p ?? null;
  }
}
