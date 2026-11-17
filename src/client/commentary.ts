// 実況の再生と字幕（クライアント）。サーバーの 'cm'（言い始めた発話）を受け取り、音声スプライトの部品を連結再生して字幕を出すだけ
// 何をいつ言うかはサーバーのタイムラインが決める。ここは届いた順に再生する（重ねない・割り込まない）。遅れが CM.lagSkip 秒を超えたら、待っているつなぎを飛ばす。同時1本。オン・オフは端末に保存（localStorage cmOff）
import { CONFIG as C } from '../shared/config';
import { Utter, clips } from '../shared/commentary';

const URL_AUDIO = 'commentary/cm.mp3', URL_TABLE = 'commentary/cm.json'; // npm run cm:audio が作る
const XFADE = 0.005; // 部品の継ぎ目のクロスフェード(秒)。間は空けない

export class Commentary {
  on = true;
  private ctx: AudioContext | null = null;
  private buf: AudioBuffer | null = null;
  private table: Record<string, [number, number]> = {}; // 文言 → [開始秒, 長さ秒]
  private shift = 0; // デコードでずれた秒数（スプライト先頭の目印で測る）
  private queue: Utter[] = [];
  private cur: { end: number; srcs: AudioBufferSourceNode[]; timer: number } | null = null;
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
    if (!on) this.clear();
  }

  // 止めて待ち行列を空にする（オフ・連戦で待機画面に戻ったとき）
  clear() { this.stop(); this.queue = []; }

  // 発話を受け取る: 再生中なら言い切ってから順に。遅れ（届いた発話が言い始めるまでの待ち＝再生中の残り＋先に待っている分）が lagSkip 秒を超えたら、待っているつなぎを飛ばす
  // （届いた発話自身の長さは遅れに数えない。数えると、前の発話の言い終わりと少し重なっただけで長めのつなぎが捨てられ、サーバーが喋っている扱いの間ずっと無音になっていた）
  receive(u: Utter) {
    if (!this.on || !this.buf || !this.ctx) return;
    this.queue.push(u);
    const lag = () => (this.cur ? Math.max(0, this.cur.end - this.ctx!.currentTime) : 0) + this.queue.slice(0, -1).reduce((a, x) => a + this.length(x), 0);
    while (lag() > C.CM.lagSkip) { const i = this.queue.findIndex((x) => x.fill); if (i < 0) break; this.queue.splice(i, 1); }
    if (!this.cur) this.next();
  }
  private length(u: Utter) { return u.s.flatMap((s) => clips(s)).reduce((a, c) => a + (this.table[c.text]?.[1] ?? 0), 0); }

  private stop() {
    if (!this.cur) return;
    for (const s of this.cur.srcs) { try { s.stop(); } catch {} }
    clearTimeout(this.cur.timer);
    this.cur = null;
    this.sub.style.display = 'none';
  }

  // 次の発話: 部品を間を空けずに並べ、継ぎ目だけ XFADE 秒重ねてフェードする
  private next() {
    const u = this.queue.shift();
    if (!u || !this.ctx || !this.buf) return;
    const list = u.s.flatMap((s) => clips(s));
    let t = this.ctx.currentTime + 0.02;
    const srcs: AudioBufferSourceNode[] = [];
    for (const c of list) {
      const e = this.table[c.text];
      if (!e) continue; // 音声化されていない部品は飛ばす（字幕は出す）
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = this.buf;
      src.connect(g).connect(this.ctx.destination);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + XFADE);
      g.gain.setValueAtTime(1, t + e[1] - XFADE); g.gain.linearRampToValueAtTime(0, t + e[1]);
      src.start(t, Math.max(0, e[0] + this.shift), e[1]);
      srcs.push(src);
      t += e[1] - XFADE;
    }
    this.sub.textContent = u.s.map((s) => clips(s).map((c) => c.sub).join('')).join('');
    this.sub.style.display = 'block';
    const ms = Math.max(800, (t - this.ctx.currentTime) * 1000);
    this.cur = { end: t, srcs, timer: window.setTimeout(() => { this.cur = null; this.sub.style.display = 'none'; this.next(); }, ms) };
  }
}
