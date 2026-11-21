// npx tsx tools/netmeasure.ts logs/matches.jsonl
import { readFileSync } from 'node:fs';
for (const raw of readFileSync(process.argv[2] ?? 'logs/matches.jsonl', 'utf8').split('\n').filter(Boolean)) {
  const match = JSON.parse(raw), net = match.net;
  if (!net) continue;
  console.log(`\n${match.start} → ${match.end} winner=${match.winner} missing=${JSON.stringify(net.missingClients)}`);
  const histogram = (name: string, h: any) => {
    const q = (f: number) => { let n = 0; const i = h.buckets.findIndex((v: number) => (n += v) >= Math.ceil(h.n * f)); return h.n ? net.limitsMs[i] ?? 'overflow' : 'n/a'; };
    console.log(`${name}: n=${h.n} mean=${h.n ? (h.sum / h.n).toFixed(3) : '-'} min=${h.min} max=${h.max} p50<=${q(.5)} p95<=${q(.95)} p99<=${q(.99)}`);
    console.log(`  buckets=${JSON.stringify(h.buckets)}`);
  };
  console.log(`bucket upper bounds (ms; queue=count): ${JSON.stringify(net.limitsMs)}, infinity`);
  histogram('tick ms', net.server.tick); histogram('tick interval ms', net.server.interval);
  for (const [id, m] of Object.entries<any>(net.server.clients)) {
    console.log(`client ${id}: catchup=${m.catchup} dropped=${m.dropped} rewind cap=${m.capped}/${m.requested.n} (${m.requested.n ? (100 * m.capped / m.requested.n).toFixed(1) : 0}%)`);
    for (const k of ['queue', 'requested', 'actual']) histogram(k, m[k]);
    const c = net.clients[id];
    if (!c) continue;
    for (const k of ['rtt', 'receive', 'offset', 'offsetChange', 'frame']) histogram(k, c[k]);
    console.log(`extrapolate=${JSON.stringify(c.extrapolate)} capped=${JSON.stringify(c.capped)} (ms = entity-ms)`);
  }
}
