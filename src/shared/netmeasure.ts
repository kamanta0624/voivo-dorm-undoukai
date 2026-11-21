// 単位は ms。固定バケット（各上限以下、最後は上限なし）でメモリを制限する。
export const LIMITS = [-1000, -100, -10, -1, 0, 1, 2, 5, 10, 16.7, 25, 50, 75, 100, 150, 200, 250, 300, 350, 400, 500, 1000];
export class Histogram {
  n = 0; sum = 0; min = 0; max = 0;
  buckets = Array<number>(LIMITS.length + 1).fill(0);
  add(value: number) {
    if (!Number.isFinite(value)) return;
    if (!this.n) this.min = this.max = value;
    this.n++; this.sum += value; this.min = Math.min(this.min, value); this.max = Math.max(this.max, value);
    const i = LIMITS.findIndex((limit) => value <= limit);
    this.buckets[i < 0 ? LIMITS.length : i]++;
  }
}
export class ClientMeasure {
  rtt = new Histogram(); receive = new Histogram(); offset = new Histogram(); offsetChange = new Histogram(); frame = new Histogram();
  extrapolate = { count: 0, ms: 0 }; capped = { count: 0, ms: 0 };
  private lastReceive: number | null = null;
  private lastOffset: number | null = null;
  private previous = new Map<string, number>();
  private current = new Map<string, number>();
  private dt = 0;
  snapshot(now: number, offset: number) {
    if (this.lastReceive !== null) this.receive.add(now - this.lastReceive);
    this.offset.add(offset * 1000);
    if (this.lastOffset !== null) this.offsetChange.add((offset - this.lastOffset) * 1000);
    this.lastReceive = now; this.lastOffset = offset;
  }
  beginFrame(dt: number | null) { if (dt !== null) this.frame.add(dt); this.dt = dt ?? 0; this.previous = this.current; this.current = new Map(); }
  // 1対象1フレーム1回。時間は対象ごとの表示時間の合計（entity-ms）。
  interpolation(id: string, mode: number) {
    if (this.current.has(id)) return;
    this.current.set(id, mode);
    const prev = this.previous.get(id) ?? 0;
    if (mode >= 1) { if (prev < 1) this.extrapolate.count++; this.extrapolate.ms += this.dt; }
    if (mode === 2) { if (prev !== 2) this.capped.count++; this.capped.ms += this.dt; }
  }
  report() {
    return { rtt: this.rtt, receive: this.receive, offset: this.offset, offsetChange: this.offsetChange, frame: this.frame, extrapolate: this.extrapolate, capped: this.capped };
  }
}
export class ServerClientMeasure {
  queue = new Histogram(); requested = new Histogram(); actual = new Histogram();
  catchup = 0; dropped = 0; capped = 0;
}
export class ServerMeasure {
  tick = new Histogram(); interval = new Histogram();
  clients: Record<string, ServerClientMeasure> = Object.create(null);
  client(id: string) { return this.clients[id] ??= new ServerClientMeasure(); }
}
// クライアントの申告値だけを受け取る。任意のキーや無制限の配列をログに残さない。
export function clientReport(value: any): ReturnType<ClientMeasure['report']> | null {
  if (!value || typeof value !== 'object') return null;
  const out = new ClientMeasure().report();
  for (const key of ['rtt', 'receive', 'offset', 'offsetChange', 'frame'] as const) {
    const h = value[key];
    if (!h || !['n', 'sum', 'min', 'max'].every((k) => Number.isFinite(h[k])) || h.n < 0 || !Number.isInteger(h.n) || !Array.isArray(h.buckets) || h.buckets.length !== LIMITS.length + 1 || !h.buckets.every((n: any) => Number.isSafeInteger(n) && n >= 0) || h.buckets.reduce((a: number, b: number) => a + b, 0) !== h.n) return null;
    Object.assign(out[key], { n: h.n, sum: h.sum, min: h.min, max: h.max, buckets: [...h.buckets] });
  }
  for (const key of ['extrapolate', 'capped'] as const) {
    const c = value[key];
    if (!c || !Number.isSafeInteger(c.count) || c.count < 0 || !Number.isFinite(c.ms) || c.ms < 0) return null;
    out[key] = { count: c.count, ms: c.ms };
  }
  return out;
}
