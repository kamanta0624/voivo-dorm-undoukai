#!/bin/sh
# npm run share: 友人テスト用。クライアントを本番ビルド → サーバー（ビルド済みクライアントの配信＋ゲーム、同じポート）→ Cloudflare 一時トンネルでURLを発行
PORT=$(npx tsx -e "import { CONFIG } from './src/shared/config'; console.log(CONFIG.PORT)")
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared が見つからない。先に入れる: brew install cloudflared"
  exit 1
fi
npx vite build || exit 1
LOG=$(mktemp)
trap 'kill $SERVER $TUNNEL 2>/dev/null; rm -f "$LOG"' EXIT INT TERM
SERVE_DIST=1 npx tsx src/server/index.ts &
SERVER=$!
cloudflared tunnel --url "http://localhost:$PORT" >"$LOG" 2>&1 &
TUNNEL=$!
URL=''
for _ in $(seq 60); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1)
  [ -n "$URL" ] && break
  kill -0 $TUNNEL 2>/dev/null || break
  sleep 1
done
if [ -z "$URL" ]; then cat "$LOG"; echo "トンネルのURLを取得できなかった"; exit 1; fi
echo ""
echo "===================================================="
echo "  友人に渡すURL: $URL"
echo "  （止めるときは Ctrl+C）"
echo "===================================================="
wait $SERVER
