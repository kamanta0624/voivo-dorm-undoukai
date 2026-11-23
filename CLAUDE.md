# 並列作業ルール（Claude Code agent view・.claude/worktrees/ の worktree）

- worktree では作業開始時に `npm install`（node_modules は写らない。素材は .worktreeinclude で写る）
- ポートは環境変数で空きを使う。2567 は使わない（公開版）。例: `E2E_HOOKS=1 GAME_PORT=2601 CLIENT_PORT=5201 npm run dev`、e2e は同じ `GAME_PORT`・`CLIENT_PORT` を付けて実行
- main にコミットしたものは原則 GitHub に push し、公開版にも反映する（タグ live-YYYYMMDD-N を付けて tools/deploy.sh <タグ>。試合中なら待つ、FORCE=1 は /status が判断できないときだけ、失敗したら戻し手順を本人に報告して止める）。CI/CD はない
- push・反映はメインのチェックアウトでのみ行う。worktree からは行わず、~/kiritan_zunda_proto_live・launchd・cloudflared に直接触らない（ゲームサーバーの再起動は deploy.sh の launchd 経由だけ）
- 引き継ぎ書に書かれた担当範囲外のファイルは編集しない
- docs/handoff/done/ への移動はメインのチェックアウトでのみ行う
- セッションと worktree の削除は `claude stop <id>` → worktree のロックを持つ pid の終了を確認（最大30秒待つ）→ `claude rm <id>`。kill・強制削除はしない
- `npm run assets` は `PY=~/MCP_Learning/image_gen_mcp/.venv/bin/python` が必要（psd_tools 入りの Python）
- マップチップは `mkdir -p public/assets/mapchip && cp ~/MCP_Learning/nimonooki_マップチップ素材基本セット01_/BaseChip_nimono.png ~/MCP_Learning/nimonooki_マップチップ素材基本セット01_/オートタイル/Auto_{A02,B03,B04,C08}.png public/assets/mapchip/`（加工しない・コミットしない）
