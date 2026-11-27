// 試合の記録（logs/matchlog/*.jsonl）の集計 → 1枚の HTML（依存なし、ローカルで開ける）。handoff_botsim1
// 実行: npx tsx tools/matchlog_report.ts [入力フォルダ（既定 logs/matchlog）] [出力（既定 <入力>/report.html）]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import NAMES from '../src/shared/chars.json';

const DIR = process.argv[2] ?? 'logs/matchlog', OUT = process.argv[3] ?? join(DIR, 'report.html');
const all: any[] = [];
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort())
  for (const l of readFileSync(join(DIR, f), 'utf8').split('\n')) if (l.trim()) { try { all.push(JSON.parse(l)); } catch {} }

const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const q = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
// 1秒ごとの推移を試合で重ねる: 平均・10%・90%
function band(rows: number[][][], k: number) {
  const len = Math.max(0, ...rows.map((s) => s.length)), out: number[][] = [];
  for (let i = 0; i < len; i++) { const v = rows.filter((s) => s[i]).map((s) => s[i][k]); if (v.length) out.push([i, r1(mean(v)), r1(q(v, 0.1)), r1(q(v, 0.9)), v.length]); }
  return out;
}
function agg(ms: any[]) {
  const n = ms.length, win = [0, 0, 0], kinds: Record<string, number> = {};
  const ch: Record<string, any> = {};
  for (const m of ms) {
    win[m.winner === 2 ? 2 : m.winner]++; kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
    for (const c of m.chars) {
      const a = (ch[c.char] ??= { n: 0, w: 0, dmgChar: 0, dmgBoss: 0, dmgCourier: 0, dmgWall: 0, takenChar: 0, takenBoss: 0, takenPen: 0, kills: 0, deaths: 0, assists: 0 });
      a.n++; if (m.winner === c.team) a.w++;
      a.dmgChar += c.dmg.char; a.dmgBoss += c.dmg.boss; a.dmgCourier += c.dmg.courier; a.dmgWall += c.dmg.wall;
      a.takenChar += c.taken.char; a.takenBoss += c.taken.boss; a.takenPen += c.taken.penalty; a.kills += c.kills; a.deaths += c.deaths; a.assists += c.assists;
    }
  }
  const chars = Object.entries(ch).map(([k, a]: [string, any]) => ({ char: (NAMES as Record<string, any>)[k]?.name ?? k, n: a.n, win: a.w / a.n, ...Object.fromEntries(Object.entries(a).filter(([x]) => x !== 'n' && x !== 'w').map(([x, v]) => [x, r1((v as number) / a.n)])) })).sort((u, v) => v.n - u.n);
  const slots = ms.flatMap((m) => m.spins.filter((s: any) => s.out !== 'miss').map((s: any) => [s.t, s.team, s.out === 'pen' ? 'pen' : s.sym?.kind ?? '?']));
  return { n, win, kinds, chars, toku: [0, 1].map((t) => band(ms.map((m) => m.series.toku), t)), boss: [0, 1].map((t) => band(ms.map((m) => m.series.bossPct), t)), slots, mixed: new Set(ms.map((m) => m.source)).size > 1 };
}
const BOTAI = 'logs/botai/compare.json'; // botai1 の比較（npx tsx tools/botai_report.ts が作る）。あれば HTML の最後に表とグラフ
const data = { botai: existsSync(BOTAI) ? JSON.parse(readFileSync(BOTAI, 'utf8')) : null, all: agg(all), human: agg(all.filter((m) => m.source === 'human')), bot: agg(all.filter((m) => m.source === 'bot')), made: new Date().toISOString(), files: DIR };

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>試合ログの集計</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--mute:#666;--line:#ddd;--t0:#e07020;--t1:#3a9a3a;--card:#f6f6f6}
@media (prefers-color-scheme:dark){:root{--bg:#16161a;--fg:#eee;--mute:#999;--line:#333;--card:#202026}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 sans-serif;margin:0 auto;padding:16px;max-width:1100px}
h1{font-size:20px}h2{font-size:16px;margin:24px 0 8px}.mute{color:var(--mute)}
.tabs button{font:inherit;padding:6px 14px;margin-right:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;cursor:pointer}.tabs button.on{border-color:var(--fg);font-weight:bold}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:right}th:first-child,td:first-child{text-align:left}
.wrap{overflow-x:auto}.warn{background:#c8302033;padding:6px 10px;border-radius:6px}.few{color:var(--mute)}
svg{width:100%;height:auto;background:var(--card);border-radius:6px}svg text{fill:var(--mute);font-size:11px}
.lg span{display:inline-block;margin-right:12px}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
</style></head><body>
<h1>試合ログの集計</h1><p class="mute">作成 ${data.made}・入力 ${data.files}</p>
<div class="tabs"><button data-k="all">全体</button><button data-k="human">人間のみ</button><button data-k="bot">Bot のみ</button></div>
<div id="out"></div><div id="botai"></div>
<script>
const D=${JSON.stringify(data)};
const FEW=10, pct=(x)=>(x*100).toFixed(0)+'%', esc=(s)=>String(s).replace(/[&<>]/g,(c)=>'&#'+c.charCodeAt(0)+';');
const C0='var(--t0)',C1='var(--t1)';
function line(bands,ymax,ylab){
  const W=1000,H=260,L=40,B=24,len=Math.max(1,...bands.flatMap((b)=>b.map((p)=>p[0]))),x=(t)=>L+(W-L-40)*t/len,y=(v)=>H-B-(H-B-8)*v/ymax;
  let s='<svg viewBox="0 0 '+W+' '+H+'">';
  for(let v=0;v<=ymax;v+=ymax/4) s+='<line x1="'+L+'" x2="'+W+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="var(--line)"/><text x="4" y="'+(y(v)+4)+'">'+Math.round(v)+'</text>';
  for(let t=0;t<=len;t+=60) s+='<text x="'+x(t)+'" y="'+(H-6)+'">'+t+'秒</text>';
  bands.forEach((b,i)=>{ if(!b.length) return; const c=i?C1:C0;
    s+='<path d="M'+b.map((p)=>x(p[0])+','+y(p[3])).join('L')+'L'+[...b].reverse().map((p)=>x(p[0])+','+y(p[2])).join('L')+'Z" fill="'+c+'" opacity=".18"/>';
    s+='<path d="M'+b.map((p)=>x(p[0])+','+y(p[1])).join('L')+'" fill="none" stroke="'+c+'" stroke-width="2"/>'; });
  return s+'</svg><p class="mute">線＝平均、帯＝10%〜90%（'+ylab+'）</p>';
}
function scatter(pts,len){
  const W=1000,H=150,L=70,x=(t)=>L+(W-L-40)*t/len,K=['ult','assist','seven','pen'],y=(k)=>18+K.indexOf(k)*34;
  let s='<svg viewBox="0 0 '+W+' '+H+'">';
  K.forEach((k)=>s+='<text x="4" y="'+(y(k)+4)+'">'+({ult:'キャラ',assist:'アシスト',seven:'7',pen:'罰'})[k]+'</text>');
  for(let t=0;t<=len;t+=60) s+='<text x="'+x(t)+'" y="'+(H-4)+'">'+t+'秒</text>';
  for(const [t,team,k] of pts) if(K.includes(k)) s+='<circle cx="'+x(t)+'" cy="'+(y(k)+(team?6:-6))+'" r="3" fill="'+(team?C1:C0)+'" opacity=".7"/>';
  return s+'</svg>';
}
function show(k){
  document.querySelectorAll('.tabs button').forEach((b)=>b.classList.toggle('on',b.dataset.k===k));
  const a=D[k],o=document.getElementById('out');
  if(!a.n){o.innerHTML='<p>試合がない</p>';return;}
  let h='';
  if(a.mixed) h+='<p class="warn">人間の試合と Bot 戦が混ざっている。数字は参考（混ぜた数字で断定しない）</p>';
  h+='<h2>試合数・勝率</h2><p>'+a.n+'試合'+(a.n<FEW?'（少ない）':'')+'。だいだい組（陣営0） '+pct(a.win[0]/a.n)+'（'+a.win[0]+'）・みどり組（陣営1） '+pct(a.win[1]/a.n)+'（'+a.win[1]+'）・引き分け '+a.win[2]+'</p>';
  h+='<p>決着の種類: '+Object.entries(a.kinds).map(([k,v])=>({boss:'大将撃破',timeout:'時間切れ'})[k]+' '+pct(v/a.n)+'（'+v+'）').join('・')+'</p>';
  h+='<h2>キャラ別（1試合あたりの平均）</h2><div class="wrap"><table><tr><th>キャラ</th><th>出場</th><th>出場時勝率</th><th>与ダメ 対キャラ</th><th>対大将</th><th>コバコ撃破</th><th>壁(段階)</th><th>被ダメ 対キャラ</th><th>対大将</th><th>罰</th><th>キル</th><th>デス</th><th>アシスト</th></tr>';
  for(const c of a.chars) h+='<tr class="'+(c.n<FEW?'few':'')+'"><td>'+esc(c.char)+'</td><td>'+c.n+'</td><td>'+pct(c.win)+(c.n<FEW?'（少）':'')+'</td><td>'+c.dmgChar+'</td><td>'+c.dmgBoss+'</td><td>'+c.dmgCourier+'</td><td>'+c.dmgWall+'</td><td>'+c.takenChar+'</td><td>'+c.takenBoss+'</td><td>'+c.takenPen+'</td><td>'+c.kills+'</td><td>'+c.deaths+'</td><td>'+c.assists+'</td></tr>';
  h+='</table></div><p class="mute">出場が'+FEW+'未満のキャラは薄く表示（勝率を断定しない）</p>';
  const lg='<p class="lg"><span><i style="background:var(--t0)"></i>だいだい組</span><span><i style="background:var(--t1)"></i>みどり組</span></p>';
  const tmax=Math.max(1,...a.toku.flatMap((b)=>b.map((p)=>p[3])));
  h+='<h2>徳の推移</h2>'+lg+line(a.toku,Math.ceil(tmax),'徳');
  h+='<h2>大将HPの推移（%）</h2>'+lg+line(a.boss,100,'大将HP%');
  h+='<h2>スロットの当選・罰の時刻</h2>'+lg+scatter(a.slots,Math.max(300,...a.slots.map((p)=>p[0])));
  o.innerHTML=h;
}
document.querySelectorAll('.tabs button').forEach((b)=>b.onclick=()=>show(b.dataset.k));
function ci(rows){ // 勝率と 95%区間の横棒（50% に縦線）
  const W=1000,R=22,L=250,x=(v)=>L+(W-L-60)*v;let s='<svg viewBox="0 0 '+W+' '+(rows.length*R+24)+'">';
  s+='<line x1="'+x(.5)+'" x2="'+x(.5)+'" y1="0" y2="'+(rows.length*R+6)+'" stroke="var(--mute)" stroke-dasharray="3 3"/>';
  rows.forEach((r,i)=>{const y=i*R+14;s+='<text x="4" y="'+(y+4)+'">'+esc(r.l)+'（'+r.n+'）</text><line x1="'+x(r.ci[0])+'" x2="'+x(r.ci[1])+'" y1="'+y+'" y2="'+y+'" stroke="var(--t1)" stroke-width="6" opacity=".5"/><circle cx="'+x(r.rate)+'" cy="'+y+'" r="5" fill="var(--t0)"/><text x="'+(x(r.ci[1])+6)+'" y="'+(y+4)+'">'+pct(r.rate)+'</text>';});
  for(const v of [0,.25,.5,.75,1]) s+='<text x="'+x(v)+'" y="'+(rows.length*R+20)+'" text-anchor="middle">'+pct(v)+'</text>';
  return s+'</svg>';
}
if(D.botai){const B=D.botai;document.getElementById('botai').innerHTML='<h2>Bot の強さ（フィジカル）・マクロの比較（'+B.n+'試合、logs/botai）</h2><p class="mute">点＝左側の勝率、帯＝95%区間。帯が 50% の線をまたぐものは差が分からない</p>'+ci(B.rows.map((r)=>({l:r.a+' vs '+r.b,n:r.n,rate:r.rate,ci:r.ci})))+'<h2>マクロ（中どうし）の総合勝率</h2>'+ci(B.macros.map((r)=>({l:r.m,n:r.n,rate:r.rate,ci:r.ci})));}
show('all');
</script></body></html>`;
writeFileSync(OUT, html);
console.log(`${all.length}試合 → ${OUT}`);
