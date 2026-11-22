# 並列作業ルール（Claude Code agent view・.claude/worktrees/ の worktree）

- worktree では作業開始時に `npm install`（node_modules は写らない。素材は .worktreeinclude で写る）
- ポートは環境変数で空きを使う。2567 は使わない（公開版）。例: `E2E_HOOKS=1 GAME_PORT=2601 CLIENT_PORT=5201 npm run dev`、e2e は同じ `GAME_PORT`・`CLIENT_PORT` を付けて実行
- ~/kiritan_zunda_proto_live・launchd・cloudflared・tools/deploy.sh に触らない（公開反映は本人指示時のみ）
- 引き継ぎ書に書かれた担当範囲外のファイルは編集しない
- docs/handoff/done/ への移動はメインのチェックアウトでのみ行う
- `npm run assets` は `PY=~/MCP_Learning/image_gen_mcp/.venv/bin/python` が必要（psd_tools 入りの Python）
