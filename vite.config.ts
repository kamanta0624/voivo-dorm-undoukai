// HTTPS=1 npm run dev: LAN内のスマホから HTTPS で確認する（証明書は certs/、手順は docs/mobile_device_test.md）
// HTTPS のページからはゲームサーバーへ /colyseus を中継する（ws:// はブラウザに止められるため）
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// 画面の隅に出すビルドの識別子: gitの短縮ハッシュ＋ビルド日時（gitが無ければ nogit）
let hash = 'nogit';
try { hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
const d = new Date(), z = (n: number) => String(n).padStart(2, '0');
const BUILD = `${hash} ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;

// GAME_PORT・CLIENT_PORT: 公開中のサーバー（npm run share）と別のポートで開発・検証するとき。未指定なら 2567・5173
const GAME_PORT = Number(process.env.GAME_PORT) || 2567;

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD), __GAME_PORT__: GAME_PORT },
  server: {
    https: process.env.HTTPS ? { key: readFileSync('certs/key.pem'), cert: readFileSync('certs/cert.pem') } : undefined,
    ...(process.env.CLIENT_PORT ? { port: Number(process.env.CLIENT_PORT), strictPort: true } : {}),
    proxy: { '/colyseus': { target: `http://localhost:${GAME_PORT}`, ws: true, rewrite: (p) => p.replace(/^\/colyseus/, '') } },
  },
});
