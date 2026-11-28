#!/bin/sh
# 公開側フォルダ（git worktree）を指定タグへ反映する: tools/deploy.sh <タグ>   例: tools/deploy.sh live-20261120-1
# 試合中の部屋があれば中止 → メンテ中 → 公開側を指定タグへ → 依存が変わっていれば npm ci → ビルド → launchd でゲームサーバーだけ再起動 → メンテ解除
# cloudflared（launchd の com.vvsports.tunnel）は触らない。失敗したら直前のタグへ戻す手順を表示して止まる（メンテ中のまま）
# 環境変数（試験用に別フォルダ・別ポートで動かすとき）: LIVE_DIR=公開側フォルダ PORT=ポート LABEL=launchd のラベル（ゲームサーバーは launchd で再起動する。未登録なら何もせず止まる）
# FORCE=1: /status で試合中か判断できない（サーバーが止まっている・旧版）ときも進める
# 負荷の関門（handoff_perfgate1）: 反映の前に、タグの中身を一時の作業ツリーに出して verify/perfgate.ts（開発側の基準）で測る。不合格なら反映しない（メンテにもしない）
#   同じコミット・同じ基準で合格済みなら測り直さない（開発側の logs/perfgate_pass.txt）。PERFGATE_SKIP=1 で飛ばす（本人が明示した時だけ。CLAUDE.md）。PERFGATE_PORT: 測る時のポート（既定 2641）
set -u
# launchd の plist と同じ Node を使う（呼び出し元のシェルの PATH に依存しない）
PATH="${HOME}/.nvm/versions/node/v24.22.1/bin:${PATH}"; export PATH
TAG=${1:?使い方: tools/deploy.sh <タグ>}
DEV=$(cd "$(dirname "$0")/.." && pwd)
LIVE=${LIVE_DIR:-${HOME}/kiritan_zunda_proto_live}
PORT=${PORT:-2567}
LABEL=${LABEL:-com.vvsports.game}
MAINT="${LIVE}/logs/maintenance.txt"
cd "${LIVE}" || { echo "公開側フォルダがない: ${LIVE}（先に git worktree add で作る）"; exit 1; }
PREV=$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)
die() {
  echo "失敗: $1"
  echo "メンテ中のまま止めた（入室できない）。戻すとき: LIVE_DIR=${LIVE} PORT=${PORT} LABEL=${LABEL} FORCE=1 ${DEV}/tools/deploy.sh ${PREV}"
  echo "メンテだけ解除するとき: rm ${MAINT}"
  exit 1
}
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null || { echo "タグがない: ${TAG}"; exit 1; }
# マップチップの元の PNG を公開しない（mapcrypt1。素材は開発側の public/assets/ を写すので、開発側に残っていれば止める）
[ ! -e "${DEV}/public/assets/mapchip" ] || { echo "中止: ${DEV}/public/assets/mapchip/（マップチップの元の PNG）がある。公開版から取れてしまうので消し、npm run mapchip で包み（public/assets/mapchip.bin）を作る"; exit 1; }

# 0. 負荷の関門（公開側にはまだ何も触らない）
if [ "${PERFGATE_SKIP:-}" = 1 ]; then echo "関門を飛ばした（PERFGATE_SKIP=1）"
else
  SHA=$(git -C "${DEV}" rev-parse "${TAG}^{commit}")
  RULES=$(cat "${DEV}/verify/perfgate.ts" "${DEV}/verify/perfgate_probe.js" "${DEV}/verify/perf_budget.json" | shasum | cut -c1-12)
  PASS="${DEV}/logs/perfgate_pass.txt"
  if grep -q "^${SHA} ${RULES}" "${PASS}" 2>/dev/null; then echo "関門: 合格済み（${SHA} 基準 ${RULES}）"
  else
    echo "関門: ${TAG}（${SHA}）を測る（約1分半）"
    PG=$(mktemp -d "${TMPDIR:-/tmp}/perfgate.XXXXXX")
    git -C "${DEV}" worktree add -q --detach "${PG}/w" "${SHA}" || { rm -rf "${PG}"; echo "中止: 関門の作業ツリーを作れない"; exit 1; }
    ln -s "${DEV}/node_modules" "${PG}/w/node_modules" && rsync -a "${DEV}/public/assets/" "${PG}/w/public/assets/"
    (cd "${DEV}" && npx tsx verify/perfgate.ts --dir "${PG}/w" --port "${PERFGATE_PORT:-2641}" --out "${DEV}/logs/perfgate-${SHA}.json"); RC=$?
    git -C "${DEV}" worktree remove --force "${PG}/w"; rm -rf "${PG}"
    [ "${RC}" = 0 ] || { echo "中止: 関門（perfgate）が不合格。反映していない（公開版はそのまま）。上の不合格の項目と、書いている要素・関数を直してから、もう一度"; exit 1; }
    mkdir -p "${DEV}/logs" && echo "${SHA} ${RULES} $(date '+%F %T')" >> "${PASS}"
    echo "関門: 合格（${PASS} に記録）"
  fi
fi
launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || { echo "launchd に未登録: ${LABEL}（先に tools/launchd.sh install）"; exit 1; }

# 1. 試合中の部屋があれば中止（/status の state が playing）
ST=$(curl -s -m 5 "http://localhost:${PORT}/status")
BUSY=$(printf '%s' "${ST}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.rooms.filter(r=>r.state==="playing").length)}catch{console.log("?")}})')
if [ "${BUSY}" = "?" ] && [ "${FORCE:-}" != 1 ]; then echo "中止: /status で試合中か判断できない（ポート${PORT}）。サーバーが止まっている・旧版なら FORCE=1 で進める"; exit 1; fi
if [ "${BUSY}" != "?" ] && [ "${BUSY}" != 0 ]; then echo "中止: 試合中の部屋が${BUSY}つある"; exit 1; fi

# 2. メンテ中にする（新しい入室を止める。進行中の試合はそのまま）
mkdir -p logs && : > "${MAINT}" || die "メンテ中にできない"
echo "メンテ中にした（${PREV} → ${TAG}）"

# 3. 公開側を指定タグへ。依存が変わっていれば npm ci
LOCK0=$(git rev-parse HEAD:package-lock.json 2>/dev/null)
git checkout -q --detach "${TAG}" || die "git checkout ${TAG}"
if [ "${LOCK0}" != "$(git rev-parse HEAD:package-lock.json)" ] || [ ! -d node_modules ]; then npm ci || die "npm ci"; fi
# 素材（git の管理外）は開発側から写す
rsync -a --delete "${DEV}/public/assets/" public/assets/ || die "素材のコピー"

# 4. ビルド（動いているサーバーの dist/ は差し替えの直前まで触らない）
rm -rf dist.new && npx vite build --outDir dist.new --emptyOutDir >/dev/null || die "ビルド"

# 5. dist を差し替えて launchd でゲームサーバーだけ再起動（同じポート）
rm -rf dist.old; { [ ! -d dist ] || mv dist dist.old; } && mv dist.new dist || die "dist の差し替え"
launchctl kickstart -k "gui/$(id -u)/${LABEL}" || die "launchd の再起動"

# 6. 新しいビルドで動いたらメンテ解除
WANT=$(cat dist/build.txt)
for _ in $(seq 60); do [ "$(curl -s -m 2 "http://localhost:${PORT}/status" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).build)}catch{}})')" = "${WANT}" ] && break; sleep 1; done
[ "$(curl -s -m 2 "http://localhost:${PORT}/status" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).build)}catch{}})')" = "${WANT}" ] || die "新しいサーバーが応答しない（logs/server.log を見る）"
rm -f "${MAINT}"
echo "反映した: ${TAG}（${WANT}）ポート${PORT}、PID $(lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN | head -1)。メンテ解除"
