#!/bin/sh
# ゲームサーバー・cloudflared（名前付きトンネル）を launchd に登録・解除する
#   tools/launchd.sh install [公開側フォルダ]   既定 ~/kiritan_zunda_proto_live
#   tools/launchd.sh uninstall
#   tools/launchd.sh tunnel-install [公開側フォルダ]   トンネルを登録（ログは logs/tunnel.log、設定は ~/.cloudflared/<ラベル>.yml）
#   tools/launchd.sh tunnel-uninstall
#   tools/launchd.sh botsim-install [公開側フォルダ]   誰もいない時の Bot 戦（tools/botsim.ts、ログは logs/botsim.log）。ゲームサーバー・トンネルには触らない
#   tools/launchd.sh botsim-uninstall
# トンネル用の環境変数: PORT（転送先、既定 2567）・LABEL（既定 com.vvsports.tunnel）・TUNNEL（既定 vvsports）・HOST（既定 vv.club-daiman.com）
# 環境変数: PORT（既定 2567）・LABEL（既定 com.vvsports.game）・ADMIN_PASSWORD（管理ページ。あれば plist に入れる。plist は本人だけ読める権限）
set -eu
CMD=${1:?使い方: tools/launchd.sh install|uninstall|tunnel-install|tunnel-uninstall [フォルダ]}
DIR=$(cd "${2:-${HOME}/kiritan_zunda_proto_live}" && pwd)
PORT=${PORT:-2567}
case "${CMD}" in tunnel-*) DEFLABEL=com.vvsports.tunnel ;; botsim-*) DEFLABEL=com.vvsports.botsim ;; *) DEFLABEL=com.vvsports.game ;; esac
LABEL=${LABEL:-${DEFLABEL}}
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
if [ "${CMD}" = uninstall ] || [ "${CMD}" = tunnel-uninstall ] || [ "${CMD}" = botsim-uninstall ]; then launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true; rm -f "${PLIST}"; echo "解除: ${LABEL}"; exit 0; fi
if [ "${CMD}" = tunnel-install ]; then
  TUNNEL=${TUNNEL:-vvsports}; HOST=${HOST:-vv.club-daiman.com}
  CF=$(command -v cloudflared); CONF="${HOME}/.cloudflared/${LABEL}.yml"
  UUID=$(cloudflared tunnel list --name "${TUNNEL}" -o json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[0].id)}catch{}})')
  [ -n "${UUID}" ] || { echo "トンネルがない: ${TUNNEL}（先に cloudflared tunnel create）"; exit 1; }
  mkdir -p "${DIR}/logs" "${HOME}/Library/LaunchAgents"
  umask 077
  awk -v u="${UUID}" -v c="${HOME}/.cloudflared/${UUID}.json" -v h="${HOST}" -v p="${PORT}" \
    '{gsub("__UUID__",u);gsub("__CRED__",c);gsub("__HOST__",h);gsub("__PORT__",p);print}' "$(dirname "$0")/launchd/tunnel.yml" > "${CONF}"
  awk -v d="${DIR}" -v cf="${CF}" -v cn="${CONF}" -v l="${LABEL}" \
    '{gsub("__DIR__",d);gsub("__CF__",cf);gsub("__CONF__",cn);gsub("__LABEL__",l);print}' "$(dirname "$0")/launchd/tunnel.plist" > "${PLIST}"
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  # 解除の直後は bootstrap が Input/output error になることがあるので数回やり直す
  for _ in 1 2 3 4 5; do launchctl bootstrap "${DOMAIN}" "${PLIST}" 2>/dev/null && break; sleep 1; done
  launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || { echo "登録できない: ${LABEL}"; exit 1; }
  echo "登録: ${LABEL}（${HOST} → localhost:${PORT}）。ログ: ${DIR}/logs/tunnel.log"; exit 0
fi
NODE=$(command -v node)
if [ "${CMD}" = botsim-install ]; then
  mkdir -p "${DIR}/logs" "${HOME}/Library/LaunchAgents"
  awk -v d="${DIR}" -v n="${NODE}" -v p="${PORT}" -v l="${LABEL}" -v pa="$(dirname "${NODE}"):/usr/bin:/bin:/usr/sbin:/sbin" \
    '{gsub("__DIR__",d);gsub("__NODE__",n);gsub("__PORT__",p);gsub("__LABEL__",l);gsub("__PATH__",pa);print}' "$(dirname "$0")/launchd/botsim.plist" > "${PLIST}"
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  for _ in 1 2 3 4 5; do launchctl bootstrap "${DOMAIN}" "${PLIST}" 2>/dev/null && break; sleep 1; done
  launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1 || { echo "登録できない: ${LABEL}"; exit 1; }
  echo "登録: ${LABEL}（${DIR}、/status はポート${PORT}）。ログ: ${DIR}/logs/botsim.log"; exit 0
fi
ADMIN=''
[ -n "${ADMIN_PASSWORD:-}" ] && ADMIN="    <key>ADMIN_PASSWORD</key><string>${ADMIN_PASSWORD}</string>\\n"
mkdir -p "${DIR}/logs" "${HOME}/Library/LaunchAgents"
umask 077
awk -v d="${DIR}" -v n="${NODE}" -v p="${PORT}" -v l="${LABEL}" -v pa="$(dirname "${NODE}"):/usr/bin:/bin:/usr/sbin:/sbin" -v ad="${ADMIN}" \
  '{gsub("__DIR__",d);gsub("__NODE__",n);gsub("__PORT__",p);gsub("__LABEL__",l);gsub("__PATH__",pa);gsub("__ADMIN__",ad);print}' "$(dirname "$0")/launchd/game.plist" > "${PLIST}"
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST}"
echo "登録: ${LABEL}（${DIR}、ポート${PORT}）。ログ: ${DIR}/logs/server.log"
