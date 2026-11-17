// Bot戦の実況ログの集計: 試合中の1秒超の沈黙（回数・合計）と、同じ話題カテゴリ（topicOf）が CM.topicCd 秒以内に重なった回数。実行: npx tsx verify/commentary_gaps.ts [試合数]
import { GameRoom } from '../src/server/GameRoom';
import { CONFIG as C } from '../src/shared/config';
import { topicOf } from '../src/shared/commentary';

// クライアントの再生の模擬（src/client/commentary.ts）: 受信は LAT 秒遅れ、再生開始は +0.02秒、タイマーは最低0.8秒、遅れが lagSkip 秒を超えたら待っているつなぎを捨てる
const LAT = Number(process.argv[3] ?? 0.05);
function client(says: any[]) {
  const out: [number, number][] = [], q: { at: number; len: number; fill: boolean }[] = says.map((s: any) => ({ at: s.c + LAT, len: s.end - s.c, fill: !!s.fill }));
  let now = 0, curEnd = -1, timerAt = -1; const wait: typeof q = []; let dropped = 0;
  const next = () => { const u = wait.shift(); if (!u) { timerAt = -1; return; } const st = now + 0.02; curEnd = st + u.len; out.push([st, curEnd]); timerAt = now + Math.max(0.8, curEnd - now); };
  for (const u of q) {
    while (timerAt >= 0 && timerAt <= u.at) { now = timerAt; next(); }
    now = u.at; wait.push(u);
    const lag = () => (timerAt >= 0 ? Math.max(0, curEnd - now) : 0) + wait.slice(0, -1).reduce((a, x) => a + x.len, 0); // src/client/commentary.ts の receive と同じ
    while (lag() > C.CM.lagSkip) { const i = wait.findIndex((x) => x.fill); if (i < 0) break; wait.splice(i, 1); dropped++; }
    if (timerAt < 0) next();
  }
  while (timerAt >= 0) { now = timerAt; next(); }
  return { out, dropped };
}
const N = Number(process.argv[2]) || 3, CD = (C.CM as any).topicCd ?? 5, SIL = 1;
let mx = 0, cmx = 0, over = 0, cover = 0; // 最長の沈黙、1.2秒超（1秒の規則＋tickの端数を超えるもの）の回数
let tot = { n: 0, sum: 0, dup: 0, says: 0, sec: 0, none: 0, cn: 0, csum: 0, drop: 0 };
for (let g = 0; g < N; g++) {
  const r: any = new (GameRoom as any)();
  r.setSimulationInterval = () => {}; r.lock = () => {}; r.unlock = () => {};
  Object.defineProperty(r, 'clients', { value: [] });
  r.onCreate(); r.notice = () => {};
  for (let t = 0; t < 2; t++) for (let i = 0; i < C.TEAM_SIZE; i++) r.addPlayer(`g${t}${i}`, t, true);
  r.startMatch(); r.cm.log = [];
  while (r.phase !== 'playing') r.tick(1 / C.TICK_HZ, false); // 開幕演出・カウントも流す（試合前のセリフの後に start が続く）
  const c0 = r.cm.clock;
  while (r.phase === 'playing') r.tick(1 / C.TICK_HZ, false);
  const c1 = r.cm.clock;
  const L = r.cm.log.map((x: string) => JSON.parse(x)), says = L.filter((x: any) => x.keys && x.c < c1);
  let n = 0, sum = 0, dup = 0, prev = c0;
  const dups: string[] = [], last = new Map<string, number>();
  for (const s of says) {
    if (s.c - prev > SIL) { n++; sum += s.c - prev; } mx = Math.max(mx, s.c - prev); if (s.c - prev > 1.2) over++;
    prev = Math.max(prev, s.end);
    for (const tp of new Set(s.keys.map(topicOf).filter((x: any) => x && x !== 'pre'))) {
      const at = last.get(tp as string);
      if (at !== undefined && s.c - at < CD) { dup++; dups.push(`${s.c.toFixed(1)} ${tp} ${s.keys.join('+')}`); }
      last.set(tp as string, s.c);
    }
  }
  if (c1 - prev > SIL) { n++; sum += c1 - prev; }
  const cl = client(says); let cn = 0, csum = 0, cp = c0;
  for (const [a, b] of cl.out) { if (a - cp > SIL) { cn++; csum += a - cp; } cmx = Math.max(cmx, a - cp); if (a - cp > 1.2) cover++; cp = Math.max(cp, b); }
  const none = L.filter((x: any) => x.fillNone).length;
  console.log(`試合${g + 1}: 試合中${(c1 - c0).toFixed(0)}秒 発話${says.length} 沈黙(>${SIL}秒)${n}回 合計${sum.toFixed(1)}秒 候補切れ${none}回 ／ クライアント模擬(遅延${LAT}秒): 沈黙${cn}回 合計${csum.toFixed(1)}秒 捨てたつなぎ${cl.dropped}回 ／ 同じ話題の${CD}秒以内の重複${dup}回${dups.length ? '\n  ' + dups.slice(0, 15).join('\n  ') : ''}`);
  tot = { n: tot.n + n, sum: tot.sum + sum, dup: tot.dup + dup, says: tot.says + says.length, sec: tot.sec + c1 - c0, none: tot.none + none, cn: tot.cn + cn, csum: tot.csum + csum, drop: tot.drop + cl.dropped };
}
console.log(`# 最長の沈黙: サーバー${mx.toFixed(2)}秒・クライアント模擬${cmx.toFixed(2)}秒、1.2秒超: サーバー${over}回・クライアント模擬${cover}回`);
console.log(`# 合計 ${N}試合: 試合中${tot.sec.toFixed(0)}秒 発話${tot.says} 沈黙(>${SIL}秒)${tot.n}回 合計${tot.sum.toFixed(1)}秒 候補切れ${tot.none}回 ／ クライアント模擬: 沈黙${tot.cn}回 合計${tot.csum.toFixed(1)}秒 捨てたつなぎ${tot.drop}回 ／ 重複${tot.dup}回`);
