#!/bin/sh
# ゲームサーバーを launchd に登録・解除する（cloudflared は入れない）
#   tools/launchd.sh install [公開側フォルダ]   既定 ~/kiritan_zunda_proto_live
#   tools/launchd.sh uninstall
# 環境変数: PORT（既定 2567）・LABEL（既定 com.vvsports.game）・ADMIN_PASSWORD（管理ページ。あれば plist に入れる。plist は本人だけ読める権限）
set -eu
CMD=${1:?使い方: tools/launchd.sh install|uninstall [フォルダ]}
DIR=$(cd "${2:-${HOME}/kiritan_zunda_proto_live}" && pwd)
PORT=${PORT:-2567}
LABEL=${LABEL:-com.vvsports.game}
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
if [ "${CMD}" = uninstall ]; then launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true; rm -f "${PLIST}"; echo "解除: ${LABEL}"; exit 0; fi
NODE=$(command -v node)
ADMIN=''
[ -n "${ADMIN_PASSWORD:-}" ] && ADMIN="    <key>ADMIN_PASSWORD</key><string>${ADMIN_PASSWORD}</string>\\n"
mkdir -p "${DIR}/logs" "${HOME}/Library/LaunchAgents"
umask 077
awk -v d="${DIR}" -v n="${NODE}" -v p="${PORT}" -v l="${LABEL}" -v pa="$(dirname "${NODE}"):/usr/bin:/bin:/usr/sbin:/sbin" -v ad="${ADMIN}" \
  '{gsub("__DIR__",d);gsub("__NODE__",n);gsub("__PORT__",p);gsub("__LABEL__",l);gsub("__PATH__",pa);gsub("__ADMIN__",ad);print}' "$(dirname "$0")/launchd/game.plist" > "${PLIST}"
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST}"
echo "登録: ${LABEL}（${DIR}、ポート${PORT}）。ログ: ${DIR}/logs/server.log"
