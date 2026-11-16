// 実況の再生と字幕（クライアント）。サーバーの 'cm'（発話）を受け取り、音声スプライトの部品を連結再生して字幕を出すだけ
// キュー・割り込み・破棄はここ。同時1本。オン・オフは端末に保存（localStorage cmOff）
import { CONFIG as C } from '../shared/config';
import { Utter, clips } from '../shared/commentary';

const URL_AUDIO = 'commentary/cm.mp3', URL_TABLE = 'commentary/cm.json'; // npm run cm:audio が作る
const GAP = 0.04; // 部品のつなぎの間(秒)

export class Commentary {
  on = true;
  private ctx: AudioContext | null = null;
  private buf: AudioBuffer | null = null;
  private table: Record<string, [number, number]> = {}; // 文言 → [開始秒, 長さ秒]
  private shift = 0; // デコードでずれた秒数（スプライト先頭の目印で測る）
  private queue: { u: Utter; at: number }[] = [];
  private cur: { pr: number; srcs: AudioBufferSourceNode[]; timer: number } | null = null;
  private sub: HTMLElement;

  constructor(parent: HTMLElement) {
    try { this.on = localStorage.getItem('cmOff') !== '1'; } catch {}
    this.sub = document.createElement('div');
    this.sub.className = 'cmsub';
    parent.appendChild(this.sub);
    // 自動再生制限: 最初のタップ／クリック／キーで音声を有効化
    const unlock = () => { this.ctx?.resume(); };
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
  }

  // 読み込み（ゲームの起動を待たせない。失敗したら実況なしで続行）
  async load() {
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const [table, data] = await Promise.all([fetch(URL_TABLE).then((r) => r.json()), fetch(URL_AUDIO).then((r) => r.arrayBuffer())]);
      const buf = await new Promise<AudioBuffer>((ok, ng) => this.ctx!.decodeAudioData(data, ok, ng)); // 古い Safari はコールバック形式
      // 目印（先頭 table.mark 秒の位置のクリック）の実際の位置から、デコードのずれを測る
      const ch = buf.getChannelData(0), end = Math.min(ch.length, Math.round((table.mark + 0.2) * buf.sampleRate));
      let peak = 0, at = 0;
      for (let i = 0; i < end; i++) if (Math.abs(ch[i]) > peak) { peak = Math.abs(ch[i]); at = i; }
      this.shift = at / buf.sampleRate - table.mark;
      this.table = table.clips;
      this.buf = buf;
    } catch (e) { console.warn('実況の音声を読み込めなかった（実況なしで続行）', e); }
  }

  setOn(on: boolean) {
    this.on = on;
    try { localStorage.setItem('cmOff', on ? '0' : '1'); } catch {}
    if (!on) { this.stop(); this.queue = []; }
  }

  // 発話を受け取る: 再生中より優先度が高ければ打ち切って割り込む。そうでなければ待ち行列（優先度順）
  receive(u: Utter) {
    if (!this.on || !this.buf) return;
    const item = { u, at: performance.now() };
    if (this.cur && u.pr > this.cur.pr) { this.stop(); this.queue.unshift(item); }
    else { this.queue.push(item); this.queue.sort((a, b) => b.u.pr - a.u.pr || a.at - b.at); }
    if (!this.cur) this.next();
  }

  private stop() {
    if (!this.cur) return;
    for (const s of this.cur.srcs) { try { s.stop(); } catch {} }
    clearTimeout(this.cur.timer);
    this.cur = null;
    this.sub.style.display = 'none';
  }

  // 次の発話: 発生から CM.maxWait 秒以上待たされたものは捨てる
  private next() {
    const now = performance.now();
    this.queue = this.queue.filter((q) => now - q.at < C.CM.maxWait * 1000);
    const item = this.queue.shift();
    if (!item || !this.ctx || !this.buf) return;
    const list = item.u.s.flatMap((s) => clips(s));
    let t = this.ctx.currentTime + 0.02;
    const srcs: AudioBufferSourceNode[] = [];
    for (const c of list) {
      const e = this.table[c.text];
      if (!e) continue; // 音声化されていない部品は飛ばす（字幕は出す）
      const src = this.ctx.createBufferSource();
      src.buffer = this.buf;
      src.connect(this.ctx.destination);
      src.start(t, Math.max(0, e[0] + this.shift), e[1]);
      srcs.push(src);
      t += e[1] + GAP;
    }
    this.sub.textContent = item.u.s.map((s) => clips(s).map((c) => c.sub).join('')).join('');
    this.sub.style.display = 'block';
    const ms = Math.max(800, (t - this.ctx.currentTime) * 1000);
    this.cur = { pr: item.u.pr, srcs, timer: window.setTimeout(() => { this.cur = null; this.sub.style.display = 'none'; this.next(); }, ms) };
  }
}
