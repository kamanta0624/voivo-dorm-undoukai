// アウトゲーム（サーバー）: メンテ中フラグ・BAN・/status・管理ページ /admin・プレイヤー名
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import type { GameRoom } from './GameRoom';
import { CONFIG as C } from '../shared/config';
import NAMES from '../shared/player_names.json';

// ファイルの置き場所（src/server/index.ts で設定。空なら使わない＝サーバー単体テスト）
export const files = { maint: '', bans: '', build: '' };

// メンテ中: ファイル files.maint があればメンテ中。中身はタイトルに出す告知文（空なら既定の文）
export const MAINT_TEXT = 'ただいまメンテナンス中です。しばらくしてから来てください';
export const maint = { on: false }; // サーバー単体テスト用（ファイルなしで切り替える）
export const maintenance = () => maint.on || (!!files.maint && existsSync(files.maint));
export const maintText = () => { try { return readFileSync(files.maint, 'utf8').trim() || MAINT_TEXT; } catch { return MAINT_TEXT; } };
export function setMaintenance(on: boolean, text = '') {
  maint.on = false;
  if (!files.maint) { maint.on = on; return; }
  if (on) writeFileSync(files.maint, text); else rmSync(files.maint, { force: true });
}

// BAN: IP（CF-Connecting-IP、なければ接続元）かブラウザ保存ID（bid）のどちらかが一致したら拒否。files.bans に保存（再起動後も有効）
export type Ban = { ip: string; bid: string; name: string; at: string };
export let bans: Ban[] = [];
export function loadBans() { try { bans = JSON.parse(readFileSync(files.bans, 'utf8')); } catch { bans = []; } }
const saveBans = () => { if (files.bans) writeFileSync(files.bans, JSON.stringify(bans, null, 1)); };
export const banned = (ip: string, bid: string) => bans.some((b) => (!!b.ip && b.ip === ip) || (!!b.bid && b.bid === bid));
export function addBan(b: Ban) { bans.push(b); saveBans(); }
export function removeBan(i: number) { bans.splice(i, 1); saveBans(); }

// プレイヤー名: 部品 a＋b（src/shared/player_names.json）。部品の組み合わせでない名前はサーバーが付け直す（本人は変更できない）
const pickOf = (a: string[]) => a[Math.floor(Math.random() * a.length)];
export const randomName = () => pickOf(NAMES.a) + pickOf(NAMES.b);
// 本人が入力した名前（lobby2）: 前後の空白と制御文字を除き、1〜NAME_MAX 文字なら使う。それ以外は null（サーバーが自動の名前を付ける）。NG ワードの判定はない
export const cleanName = (n: unknown) => { if (typeof n !== 'string') return null; const t = n.replace(/[\u0000-\u001f\u007f]/g, '').trim(); return t && [...t].length <= C.NAME_MAX ? t : null; };
export const validName = (n: unknown) => typeof n === 'string' && NAMES.a.some((a) => n.startsWith(a) && NAMES.b.includes(n.slice(a.length)));
// 同じ部屋で重複したら末尾に番号（2から）
export function uniqueName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(base + i)) i++;
  return base + i;
}

// サーバーで配信しているクライアントのビルド（dist/build.txt。vite.config.ts が書く）。開発時は null（比べない）
export const serverBuild = () => { try { return files.build ? readFileSync(files.build, 'utf8').trim() : null; } catch { return null; } };

// /status: 常設の部屋ごとの状態・人数、メンテ中か（タイトルの部屋一覧と tools/deploy.sh が使う）
// state: waiting=待機中（入れる）/ full=満員 / playing=対戦中（試合の開始〜結果画面）
export function status(rooms: GameRoom[]) {
  return {
    build: serverBuild(), maintenance: maintenance(), notice: maintenance() ? maintText() : '',
    rooms: rooms.map((r, i) => {
      const humans = r.humanCount();
      return { id: r.roomId, no: i + 1, state: r.phase !== 'waiting' ? 'playing' : humans >= C.ROOM_FULL ? 'full' : 'waiting', humans, max: C.ROOM_FULL, spec: r.spectators(), specMax: C.SPECTATOR_MAX };
    }),
  };
}

// 管理ページ /admin（パスワードは環境変数 ADMIN_PASSWORD。未設定なら無効）。手動更新。キック・BAN・解除・メンテ切替
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export function admin(app: any, rooms: () => GameRoom[], all: () => GameRoom[]) {
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return;
  app.use('/admin', (req: any, res: any, next: any) => { // Basic 認証（ユーザー名は何でもよい）
    const [, b64] = String(req.headers.authorization ?? '').split(' ');
    const pw = b64 ? Buffer.from(b64, 'base64').toString().replace(/^[^:]*:/, '') : '';
    if (pw === pass) return next();
    res.set('WWW-Authenticate', 'Basic realm="admin"').status(401).send('認証が必要');
  });
  app.post('/admin/:op', (req: any, res: any) => {
    const b = req.body ?? {}, room = all().find((r) => r.roomId === b.room);
    if (req.params.op === 'kick' || req.params.op === 'ban') room?.kick(String(b.id), req.params.op === 'ban');
    if (req.params.op === 'unban') removeBan(Number(b.i));
    if (req.params.op === 'maint') setMaintenance(b.on === '1', String(b.text ?? ''));
    res.redirect(303, '/admin');
  });
  app.get('/admin', (_req: any, res: any) => {
    const form = (op: string, fields: Record<string, unknown>, label: string) => `<form method="post" action="/admin/${op}">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('')}<button>${label}</button></form>`;
    const pub = rooms();
    const roomHtml = all().map((r) => {
      const rows = [...r.players.values()].filter((p) => !p.assist).map((p) => `<tr><td>${esc(p.name ?? '')}</td><td>${esc(p.char)}</td><td>${p.bot ? 'Bot' : '人'}</td><td>${esc(p.ip ?? '')}</td><td>${p.bot ? '' : form('kick', { room: r.roomId, id: p.id }, 'キック') + form('ban', { room: r.roomId, id: p.id }, 'BAN')}</td></tr>`).join('');
      const no = pub.indexOf(r);
      return `<h3>${no >= 0 ? `部屋${no + 1}` : 'e2e の部屋'}（${esc(r.roomId)}）フェーズ: ${esc(r.phase)}</h3><table><tr><th>名前</th><th>キャラ</th><th>人/Bot</th><th>IP</th><th></th></tr>${rows}</table>`;
    }).join('');
    const banHtml = bans.map((b, i) => `<tr><td>${esc(b.name)}</td><td>${esc(b.ip)}</td><td>${esc(b.bid)}</td><td>${esc(b.at)}</td><td>${form('unban', { i }, '解除')}</td></tr>`).join('');
    const m = maintenance();
    res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>管理</title>
<style>body{font:14px sans-serif;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:2px 6px}form{display:inline;margin:0 2px}</style>
<h2>管理 <a href="/admin">更新</a></h2>
<p>メンテ: <b>${m ? 'メンテ中' : '通常'}</b> ${m ? form('maint', { on: '0' }, 'メンテ解除') : `<form method="post" action="/admin/maint"><input type="hidden" name="on" value="1"><input name="text" placeholder="${esc(MAINT_TEXT)}" size="40"><button>メンテ開始</button></form>`}</p>
${roomHtml}<h3>BAN一覧</h3><table><tr><th>名前</th><th>IP</th><th>ブラウザID</th><th>日時</th><th></th></tr>${banHtml}</table>`);
  });
}
