#!/bin/sh
# 素材と map.json、ルール説明のマップ全体図を生成する。PY には psd_tools と Pillow の入った Python を指定する
set -e
cd "$(dirname "$0")/.."
PY=${PY:-python3}
$PY tools/make_dot.py public/assets/gen/dot
$PY tools/gen_map.py src/shared/map.json
$PY tools/import_tachie.py public/assets/gen/tachie
# ルール説明のマップ全体図（map.json とマップチップから。e2e と同じ Chrome を使う）
mkdir -p public/assets/rules
npx tsx tools/render_rules_map.ts public/assets/rules/map.png
