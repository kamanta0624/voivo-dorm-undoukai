// 試合結果画面（handoff_result1）: 決着後の「リザルト」ボタンで開く全画面のオーバーレイ。DOM＋SVG だけで描く
// 上半分＝両チームの徳・大将HP%の推移とスロットの当たり（揃った図柄のアイコン）、下半分＝選んだチームの時間帯別の大将ダメージ／徳
// データは記録部の summary()（src/server/matchlog.ts）。サーバーは決着後に 'result' で1回送る
import { CONFIG as C } from '../shared/config';
import { BOSS_CHAR } from '../shared/chars';
import { uf, ufCss } from './uifont';

const DOT = (k: string) => `assets/gen/dot/${k}/idle.png`;
type Opt = { myTeam: number | null; title: string; colors: string[]; names: string[]; players: Record<string, string> }; // players: プレイヤーid → 表示名（記録部は名前を持たないので、部屋の名簿から渡す）
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const css = document.createElement('style');
css.textContent = ufCss(`
#result{position:fixed;inset:0;z-index:11;display:none;overflow-y:auto;overscroll-behavior:contain;background:#08080c;color:#fff;font:max(10px,calc(var(--rz) * 7px))/1.4 sans-serif;padding:max(6px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(6px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));box-sizing:border-box;touch-action:pan-y}
#result .in{max-width:1200px;margin:0 auto}
#result .hd{display:flex;align-items:center;gap:.8em;white-space:nowrap}
#result .hd b{font:900 max(10px,calc(var(--rz) * 14px)) sans-serif}
#result .hd .sc{min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:bold;font-size:max(10px,calc(var(--rz) * 8px))}
#result .hd .x{min-height:32px;padding:0 1.2em;font:bold max(10px,calc(var(--rz) * 8px)) sans-serif;color:#fff;background:#335;border:2px solid #fff;border-radius:6px;cursor:pointer}
#result svg{display:block}
#result svg text{fill:#ccc;font-family:sans-serif}
#result .tabs{display:flex;gap:6px;flex:none}
#result .tabs button{min-height:32px;padding:0 1em;font:bold max(10px,calc(var(--rz) * 7px)) sans-serif;color:#ccc;background:#222;border:1px solid #666;border-radius:6px;cursor:pointer}
#result .tabs button.on{color:#fff;border-color:#fff;background:#445}
#result .hd .gap{flex:1}
@media (orientation:portrait){html.touch #result{display:none!important}} /* 縦持ちでは出さない（ゲームと同じ「横にしてください」。横に戻せば開いていたまま出る） */
#result .tb{display:grid;align-items:center;row-gap:2px}
#result .tb div{text-align:right;padding-right:6px;white-space:nowrap;font-variant-numeric:tabular-nums}
#result .tb .h{color:#aaa;font-size:max(10px,calc(var(--rz) * 6px))}
#result .tb .nm{text-align:left;display:flex;align-items:center;gap:4px;padding:0;min-width:0}
#result .tb .pn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
#result .tb .tot{font-weight:bold}
#result .tb .row{display:contents}
#result .face{width:calc(var(--rz) * 18px);height:calc(var(--rz) * 18px);background:#000a no-repeat calc(var(--rz) * -7px) calc(var(--rz) * -3px)/calc(var(--rz) * 32px) calc(var(--rz) * 42px);image-rendering:pixelated;border:1px solid var(--c);border-radius:2px;flex:none}
`);
document.head.append(css);
const el = document.createElement('div');
el.id = 'result';
document.body.append(el);

let data: any = null, opt: Opt | null = null, team = 0, metric: 'boss' | 'toku' = 'boss';
export const resultOpen = () => el.style.display === 'block';
export function closeResult() { el.style.display = 'none'; }
export function openResult(d: any, o: Opt) {
  data = d; opt = o; team = o.myTeam ?? 0; metric = 'boss';
  el.style.display = 'block';
  render();
}
addEventListener('resize', () => { if (resultOpen()) render(); });

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
// 文字の大きさ: 論理 640×360 を画面に合わせた倍率（縦持ちは幅 400 を基準）。物理の下限 10px（CSS は max(10px, …)、SVG は fsz）
function rz() { return Math.min(2, innerHeight > innerWidth ? innerWidth / 400 : Math.min(innerWidth / 640, innerHeight / 360)); } // 大きい画面では 2 倍で止める（文字が大きすぎて見出しが詰まらないように）
const fsz = (n: number) => Math.max(10, uf(n) * rz()); // SVG の文字(px)。下限 10px

function render() {
  if (!data || !opt) return;
  const d = data, o = opt, z = rz();
  el.style.setProperty('--rz', String(z));
  const cs = getComputedStyle(el), px = (k: string) => parseFloat(cs.getPropertyValue(k)) || 0; // 表示領域（ノッチ・ホームバーの分の余白を除く）
  const W = Math.min(1200, el.clientWidth - px('padding-left') - px('padding-right')), innerH = el.clientHeight - px('padding-top') - px('padding-bottom'), L = Math.max(120, 64 * z), R = Math.max(46, 44 * z), P = W - L - R, sec = Math.max(1, d.sec);
  const x = (t: number) => L + (P * Math.min(t, sec)) / sec, tx = fsz(6);
  const step = C.RESULT.bucketSec, nb = Math.ceil(sec / step), edges = Array.from({ length: nb + 1 }, (_, i) => Math.min(sec, i * step));
  const pts = (s: number[][], k: number, y: (v: number) => number) => s.map((v, i) => `${x(i === s.length - 1 ? sec : i).toFixed(1)},${y(v[k]).toFixed(1)}`).join(' ');
  // 推移グラフ（上段＝徳、下段＝大将HP%）。h: 1段の高さ（画面の高さに収まるように render が決める）
  const graph = (h: number) => {
  const panel = (top: number, label: string, s: number[][], max: number, last: (v: number) => string) => {
    const y = (v: number) => top + h * (1 - v / max);
    let g = `<text x="4" y="${top + tx}" font-size="${tx}">${label}</text>`;
    g += `<rect x="${L}" y="${top}" width="${P}" height="${h}" fill="#ffffff08" stroke="#666"/>`;
    for (let t = 60; t < sec; t += 60) g += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${top + h}" stroke="#555" stroke-dasharray="2 3"/>`;
    for (const v of [0, max / 2, max]) g += `<text x="${L - 4}" y="${y(v) + tx / 3}" font-size="${tx}" text-anchor="end">${v}</text>`;
    const lv = [0, 1].map((t) => s[s.length - 1][t]), ly = lv.map((v) => Math.min(top + h, Math.max(top + tx, y(v) + tx / 3))); // 終端の値のラベル（枠の中。近い時は1行ぶん離す）
    const lo = lv[0] <= lv[1] ? 0 : 1; // 値の小さい方を下に
    if (Math.abs(ly[0] - ly[1]) < tx) { ly[1 - lo] = ly[lo] - tx; if (ly[1 - lo] < top + tx) { ly[1 - lo] = top + tx; ly[lo] = top + 2 * tx; } }
    [0, 1].forEach((t) => {
      g += `<polyline points="${pts(s, t, y)}" fill="none" stroke="${o.colors[t]}" stroke-width="2"/>`;
      g += `<text x="${x(sec) + 4}" y="${ly[t]}" font-size="${tx}" font-weight="bold" fill="${o.colors[t]}">${last(lv[t])}</text>`;
    });
    return { g, y };
  };
  const top1 = 4, top2 = top1 + h + tx * 1.5, axis = top2 + h + tx + 6;
  const p1 = panel(top1, '徳', d.series.toku, C.TOKU_MAX, (v) => v.toFixed(1)), p2 = panel(top2, '大将HP%', d.series.bossPct, 100, (v) => `${Math.round(v)}%`);
  let svg = p1.g + p2.g;
  const lastMin = Math.floor(sec / 60) * 60, endFar = sec % 60 && x(sec) - x(lastMin) > tx * 3.2; // 終了の時刻は、直前の分の目盛りと重ならない時だけ出す（重なるなら分の目盛りの方を消す）
  for (let t = 0; t <= sec; t += 60) if (!(sec % 60 && !endFar && t === lastMin && t > 0)) svg += `<text x="${x(t)}" y="${axis}" font-size="${tx}" text-anchor="middle">${fmt(t)}</text>`;
  if (sec % 60) svg += `<text x="${x(sec)}" y="${axis}" font-size="${tx}" text-anchor="middle">${fmt(sec)}</text>`;
  // スロットの当たり: 当たった時刻・そのチームの徳の線の上に、揃った図柄のアイコン（枠は組の色）。近いものは上へずらして全部見せる
  const ic = Math.max(14, 13 * z), placed: { x: number; y: number }[] = [];
  for (const s of d.spins.filter((s: any) => s.out === 'win' && s.sym)) {
    const k = s.sym.kind === 'seven' ? BOSS_CHAR[s.team] : s.sym.char, v = d.series.toku[Math.min(d.series.toku.length - 1, Math.floor(s.t))][s.team];
    let cx = x(s.t), cy = p1.y(v) - ic / 2 - 2;
    while (placed.some((q) => Math.abs(q.x - cx) < ic && Math.abs(q.y - cy) < ic)) cy -= ic + 1;
    placed.push({ x: cx, y: cy });
    const id = `c${placed.length}`;
    svg += `<clipPath id="${id}"><rect x="${cx - ic / 2}" y="${cy - ic / 2}" width="${ic}" height="${ic}"/></clipPath>`;
    svg += `<rect x="${cx - ic / 2}" y="${cy - ic / 2}" width="${ic}" height="${ic}" fill="#000"/><image class="slot" data-t="${s.t}" data-team="${s.team}" data-kind="${s.sym.kind}" data-char="${k}" href="${DOT(k)}" x="${cx - ic / 2 - (9 * ic) / 15}" y="${cy - ic / 2 - (4 * ic) / 15}" width="${(32 * ic) / 15}" height="${(42 * ic) / 15}" clip-path="url(#${id})" style="image-rendering:pixelated"/>`;
    svg += `<rect x="${cx - ic / 2}" y="${cy - ic / 2}" width="${ic}" height="${ic}" fill="none" stroke="${o.colors[s.team]}" stroke-width="2"/>`;
  }
  const minY = Math.min(top1, ...placed.map((q) => q.y - ic / 2)) - 2, H = axis + 4 - minY;
  return { H, html: `<svg width="${W}" height="${H}" viewBox="0 ${minY} ${W} ${H}">${svg}</svg>` };
  };
  // 下半分: 時間帯別の個人の数字（列は上のグラフの時間軸とそろえる）
  const sum = (a: number[], i: number) => { let n = 0; for (let t = edges[i]; t < edges[i + 1]; t++) n += a[t] ?? 0; return n; };
  const rows = d.chars.filter((c: any) => c.team === team).map((c: any) => ({ face: c.char, name: o.players[c.id] ?? '', v: edges.slice(0, -1).map((_, i) => (metric === 'boss' ? sum(c.series.bossDmg, i) : sum(c.series.tokuGain, i) - sum(c.series.tokuLoss, i))) }));
  rows.push({ face: '', name: '', v: metric === 'boss' ? edges.slice(0, -1).map((_, i) => sum(d.series.assistBossDmg[team], i)) : null });
  const num = (n: number) => (metric === 'boss' ? (Math.round(n) ? String(Math.round(n)) : '−') : Math.round(n * 10) / 10 ? `${n > 0 ? '+' : '−'}${Math.abs(Math.round(n * 10) / 10)}` : '−');
  const cols = `${L}px ${edges.slice(0, -1).map((_, i) => `${(P * (edges[i + 1] - edges[i])) / sec}px`).join(' ')} ${R}px`;
  let tb = `<div class="tb" style="grid-template-columns:${cols}"><div class="h"></div>${edges.slice(0, -1).map((e, i) => `<div class="h">${fmt(e)}〜</div>`).join('')}<div class="h">合計</div>`;
  for (const r of rows) {
    const nm = r.face ? `<span class="face" style="background-image:url(${DOT(r.face)});--c:${o.colors[team]}"></span><span class="pn">${esc(r.name)}</span>` : 'アシスト';
    tb += `<div class="row"><div class="nm">${nm}</div>${r.v ? r.v.map((n: number) => `<div>${num(n)}</div>`).join('') + `<div class="tot">${num(r.v.reduce((a: number, b: number) => a + b, 0))}</div>` : edges.slice(0, -1).map(() => '<div>−</div>').join('') + '<div class="tot">−</div>'}</div>`;
  }
  tb += '</div>';
  const tn = o.myTeam === null ? ['左の組', '右の組'] : o.myTeam === 0 ? ['味方チーム', '相手チーム'] : ['相手チーム', '味方チーム'];
  const order = o.myTeam === 1 ? [1, 0] : [0, 1];
  const t0 = d.teams[0], t1 = d.teams[1];
  // 見出しの行にタブも並べる（高さを使わない）。グラフは、見出しと表を置いた残りの高さに収める（1段 30〜150px）
  el.innerHTML = `<div class="in"><div class="hd"><b>${o.title}</b><span class="sc"><span style="color:${o.colors[0]}">${o.names[0]} ${Math.round(t0.bossPct)}%</span> − <span style="color:${o.colors[1]}">${Math.round(t1.bossPct)}% ${o.names[1]}</span></span><span class="gap"></span>`
    + `<span class="tabs">${order.map((t) => `<button data-team="${t}" class="${t === team ? 'on' : ''}">${tn[t]}</button>`).join('')}</span><span class="tabs"><button data-m="boss" class="${metric === 'boss' ? 'on' : ''}">大将ダメージ</button><button data-m="toku" class="${metric === 'toku' ? 'on' : ''}">徳</button></span><button class="x">閉じる</button></div>`
    + `<div class="gr"></div>${tb}</div>`;
  const gr = el.querySelector<HTMLElement>('.gr')!, rest = innerH - el.querySelector<HTMLElement>('.in')!.offsetHeight - 8; // グラフに使える高さ（端数の分 8px 残す）
  const g0 = graph(100), h = Math.max(30, Math.min(150, (rest - (g0.H - 200)) / 2));
  gr.innerHTML = graph(h).html;
  el.querySelector<HTMLElement>('.x')!.onclick = closeResult;
  el.querySelectorAll<HTMLElement>('.tabs button').forEach((b) => (b.onclick = () => { if (b.dataset.team) team = Number(b.dataset.team); if (b.dataset.m) metric = b.dataset.m as any; render(); }));
}
