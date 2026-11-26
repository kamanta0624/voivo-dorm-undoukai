/// <reference types="vite/client" />
// タイトル画面（入口）: ゲームタイトル・自分の名前（自動）・部屋一覧（数秒ごとに自動更新）・ルール説明・更新情報・クレジット・バージョン
// 入室できたらゲーム本体（main.ts）を読み込む。ゲーム本体・ルール説明はここでは読み込まない（軽く）
// 再読み込みしたタブ（再接続の合言葉あり）と e2e のタブ（?e2e=<値>）はタイトルを出さずに入る（従来どおり）
import { Client, Room } from '@colyseus/sdk';
import { CONFIG as C } from '../shared/config';
import NAMES from '../shared/player_names.json';

declare const __BUILD__: string;
declare const __GAME_PORT__: number;
const TITLE = 'VOICE SQUAD';
const STATE_LABEL: Record<string, string> = { waiting: '待機中', full: '満員', playing: '対戦中' };

// ビルドの識別子を画面の隅に常に出す（main.ts も使う）
const ver = document.createElement('div');
ver.id = 'ver';
ver.textContent = __BUILD__;
ver.style.cssText = 'position:fixed;left:2px;bottom:1px;z-index:9999;font:10px monospace;color:#fff8;pointer-events:none';
document.body.appendChild(ver);

const ss = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch {} }, del: (k: string) => { try { sessionStorage.removeItem(k); } catch {} } };
// 名前: タイトルで本人が入力して変えられる（端末に保存。lobby2）。保存がない・空欄の時はタブ（セッション）ごとの自動の名前。ブラウザ保存ID: BAN の判定用（端末に保存）
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
const autoName = ss.get('pname') ?? pick(NAMES.a) + pick(NAMES.b);
ss.set('pname', autoName);
let name = autoName;
try { name = localStorage.getItem('myName') || autoName; } catch {}
let bid = '';
try { bid = localStorage.getItem('bid') ?? ''; if (!bid) { bid = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('bid', bid); } } catch {}

// 本番ビルドはページと同じ場所。開発時はゲームサーバーのポートへ（HTTPS は Vite の中継）
const client = new Client(import.meta.env.PROD ? location.origin : location.protocol === 'https:' ? `${location.origin}/colyseus` : `ws://${location.hostname}:${__GAME_PORT__}`);
const e2e = new URLSearchParams(location.search).get('e2e'), tokenKey = e2e ? 'rtE2e' : 'rt';

// 入室できた部屋をゲーム本体に渡す。再接続用の合言葉は入室直後に保存する（ゲーム本体の読み込み中に再読み込みされても同じ席に戻れる。e2e・再接続も同じ）
async function enter(room: Room, rejoin: boolean) {
  ss.set(tokenKey, room.reconnectionToken);
  Object.assign(window as any, { __room: room, __rejoin: rejoin, __client: client });
  document.getElementById('title')?.remove();
  await import('./main');
}

const css = document.createElement('style');
css.textContent = `
#title{position:fixed;inset:0;overflow:auto;background:radial-gradient(ellipse at 70% 30%,#3a2f5a,#111 70%);color:#fff;font:15px sans-serif;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));box-sizing:border-box}
#title .in{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
#title h1{margin:4px 0 0;font:900 clamp(28px,7vw,44px) sans-serif;color:#ffe066;-webkit-text-stroke:1px #000;text-shadow:0 0 6px #000;text-align:center}
#title .me{text-align:center;color:#ddd}
#title .me input{width:12em;max-width:70%;box-sizing:border-box;margin-left:4px;padding:6px 8px;border:1px solid #fff8;border-radius:6px;background:#0008;color:#fff;font:bold 17px sans-serif;text-align:center}
#title .notice{background:#a33;border-radius:6px;padding:8px 12px;font-weight:bold}
#title .msg{min-height:1.2em;color:#ffb0b0;text-align:center;font-weight:bold}
#title .rooms{display:flex;flex-direction:column;gap:8px}
#title .room{display:flex;justify-content:space-between;align-items:center;border:0;border-radius:8px;padding:12px 16px;font:bold 17px sans-serif;color:#fff;background:linear-gradient(#ff9a3c,#e8541e);cursor:pointer}
#title .room.practice{background:linear-gradient(#5ab0ff,#2a5ad8)}
#title .room:disabled{background:#444;color:#aaa;cursor:default}
#title .row{display:flex;gap:8px}
#title .row button,#title .pop button{flex:1;border:1px solid #fff8;background:#000a;color:#fff;border-radius:6px;padding:8px;font:bold 14px sans-serif;cursor:pointer}
#title .news{background:#0008;border-radius:6px;padding:8px 12px;font-size:13px;line-height:1.5}
#title .news h3{margin:0 0 4px;font-size:14px;color:#ffe066}
#title .news ul{margin:0;padding-left:1.2em}
#title .news p{margin:0}
#title .pop{position:fixed;inset:0;background:#000c;display:none;flex-direction:column;padding:16px;box-sizing:border-box}
#title .pop .body{flex:1;overflow:auto;background:#222;border-radius:6px;padding:8px 16px;line-height:1.6;font-size:14px}
#title .pop .body h2{color:#ffe066;font-size:17px;margin:12px 0 4px}
#title .pop .body h3{color:#ffe066;font-size:15px;margin:12px 0 4px}
#title .pop .body p{margin:4px 0}
#title .pop button{flex:none;margin-top:8px}
`;
document.head.appendChild(css);

// Markdown のごく一部（# 見出し・- 箇条書き・段落）を HTML に
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function md(text: string) {
  let html = '', ul = false;
  for (const line of text.split('\n')) {
    const li = line.match(/^\s*- (.*)/);
    if (!li && ul) { html += '</ul>'; ul = false; }
    if (li) { if (!ul) { html += '<ul>'; ul = true; } html += `<li>${esc(li[1])}</li>`; }
    else if (line.startsWith('### ')) html += `<h3>${esc(line.slice(4))}</h3>`;
    else if (line.startsWith('## ')) html += `<h3>${esc(line.slice(3))}</h3>`;
    else if (line.startsWith('# ')) html += `<h2>${esc(line.slice(2))}</h2>`;
    else if (line.startsWith('> ')) html += `<p>${esc(line.slice(2))}</p>`; // 更新情報の要約の行
    else if (line.trim() && !line.startsWith('<!--')) html += `<p>${esc(line)}</p>`;
  }
  return html + (ul ? '</ul>' : '');
}
const fetchText = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).catch(() => '');

// サーバーのビルドが違えば1回だけ再読み込み。それでも違えば「更新してください」
function buildCheck(build: string | null, msg: (t: string) => void) {
  if (!build || build === __BUILD__) return true;
  if (ss.get('reloadFor') !== build) { ss.set('reloadFor', build); location.reload(); return false; }
  msg('新しい版が出ています。ページを更新してください');
  return false;
}

function showTitle() {
  const el = document.createElement('div');
  el.id = 'title';
  el.innerHTML = `<div class="in"><h1>${TITLE}</h1><div class="me"><label>あなたの名前:<input class="nm" type="text" enterkeyhint="done" autocomplete="off"></label></div><div class="notice" hidden></div><div class="msg"></div><div class="rooms"></div>
<div class="row"><button class="rules">ルール説明</button><button class="notes">更新情報</button><button class="credits">クレジット</button></div><div class="news" hidden></div></div>
<div class="pop"><div class="body"></div><button>閉じる</button></div>`;
  document.body.appendChild(el);
  const $ = (s: string) => el.querySelector<HTMLElement>(s)!;
  // 名前の入力: 決めた時（フォーカスが外れた・Enter）に端末へ保存。空欄なら自動の名前に戻す。長さは NAME_MAX 文字まで
  const nm = el.querySelector<HTMLInputElement>('.me .nm')!;
  nm.maxLength = C.NAME_MAX; nm.value = name;
  const commit = () => {
    const t = nm.value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    name = t || autoName; nm.value = name;
    try { if (t) localStorage.setItem('myName', t); else localStorage.removeItem('myName'); } catch {}
  };
  nm.addEventListener('change', commit);
  nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') nm.blur(); });
  const msg = (t: string) => { $('.msg').textContent = t; };
  const left = ss.get('leaveMsg'); // キック・BAN されて戻ってきた
  if (left) { msg(left); ss.del('leaveMsg'); }
  const pop = $('.pop'), open = (html: string) => { $('.pop .body').innerHTML = html; pop.style.display = 'flex'; };
  $('.pop button').onclick = () => (pop.style.display = 'none');
  // 更新情報: 最新1件をタイトルに、全部は開いて読む（public/patchnotes.md、## で1件）。開いた画面では最新1件だけ展開し、過去の分は日付で畳む
  fetchText('patchnotes.md').then((t) => {
    const items = t.split(/^(?=## )/m).filter((x) => x.startsWith('## '));
    const sum = items[0]?.match(/^## (.*)\n> (.*)/); // 要約の行（見出しの直後の「> 」）があれば、タイトルには日付と要約だけ
    if (items[0]) { $('.news').innerHTML = sum ? `<h3>${esc(sum[1].trim())}</h3><p>${esc(sum[2])}</p>` : md(items[0]); $('.news').hidden = false; }
    const fold = (x: string) => { const [h, ...b] = x.split('\n'); return `<details><summary>${esc(h.slice(3).trim())}</summary>${md(b.join('\n'))}</details>`; };
    $('.notes').onclick = () => open(items.map((x, i) => (i ? fold(x) : md(x))).join(''));
  });
  $('.credits').onclick = () => fetchText('credits.md').then((t) => open(md(t)));
  $('.rules').onclick = () => location.assign('/rules.html'); // ルール説明のページ（public/rules.html。戻るボタンはページの中）。ADV（tutorial.ts）は将来使うので残す

  // 部屋一覧: STATUS_POLL_SEC 秒ごとに自動更新。待機中かつ空きありの部屋と、観戦席の空いている対戦中の部屋を押せる。メンテ中は全部押せない
  let busy = false;
  const render = (s: any) => {
    const n = $('.notice');
    n.hidden = !s.maintenance;
    n.textContent = s.notice;
    // 部屋の一覧の最後に「練習」（同じ形のボタン、色だけ別。fb1124）
    // 対戦中の部屋は「観戦」で入れる（観戦席が満員なら押せない）
    $('.rooms').innerHTML = s.rooms.map((r: any) => `<button class="room" data-id="${esc(r.id)}" ${s.maintenance || r.state === 'full' || (r.state === 'playing' && r.spec >= r.specMax) ? 'disabled' : ''}><span>部屋${r.no}</span><span>${r.state === 'playing' ? `対戦中・観戦 ${r.spec}/${r.specMax}` : `${STATE_LABEL[r.state]}（${r.humans}/${r.max}）`}</span></button>`).join('')
      + '<button class="room practice"><span>練習</span><span>自分1 vs 相手1</span></button>';
    el.querySelectorAll<HTMLButtonElement>('.room[data-id]').forEach((b) => (b.onclick = () => join(() => client.joinById(b.dataset.id!, { name, bid }))));
    $('.room.practice').onclick = () => join(() => client.create('game', { practice: true, name, bid })); // 練習（handoff_practice1）: 押すたびに本人専用の部屋を作って入る
  };
  const poll = async () => {
    try {
      const s = await (await fetch('status', { cache: 'no-store' })).json();
      if (!buildCheck(s.build, msg)) return s;
      if (!busy) render(s);
      return s;
    } catch { if (!busy) $('.rooms').innerHTML = '<div class="msg">サーバーにつながりません</div>'; return null; }
  };
  const timer = setInterval(poll, C.STATUS_POLL_SEC * 1000);
  poll();
  // 入室: 直前にビルドを比べてから。open: 部屋に入る（常設の部屋は joinById、練習は本人専用の部屋を作る）
  const join = async (open: () => Promise<Room>) => {
    if (busy) return;
    busy = true;
    msg('');
    const s = await poll();
    if (s && s.build && s.build !== __BUILD__) { busy = false; return; }
    try {
      const room = await open();
      clearInterval(timer);
      await enter(room, false);
    } catch (e: any) { msg(e?.message || '入室できませんでした'); busy = false; poll(); }
  };
}

const saved = ss.get(tokenKey);
if (e2e) (saved ? client.reconnect(saved).then((r) => enter(r, true)).catch(() => client.joinOrCreate('game', { e2e }).then((r) => enter(r, false))) : client.joinOrCreate('game', { e2e }).then((r) => enter(r, false))); // テスト専用の部屋（値ごとに別の部屋）
else if (saved) client.reconnect(saved).then((r) => enter(r, true)).catch(() => { ss.del(tokenKey); showTitle(); }); // 待ってもらっている試合に戻る。戻れなければタイトル
else showTitle();
