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

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  server: {
    https: process.env.HTTPS ? { key: readFileSync('certs/key.pem'), cert: readFileSync('certs/cert.pem') } : undefined,
    proxy: { '/colyseus': { target: 'http://localhost:2567', ws: true, rewrite: (p) => p.replace(/^\/colyseus/, '') } },
  },
});
