# 並列作業ルール（Claude Code agent view・.claude/worktrees/ の worktree）

- worktree では作業開始時に `npm install`（node_modules は写らない。素材は .worktreeinclude で写る）
- ポートは環境変数で空きを使う。2567 は使わない（公開版）。例: `E2E_HOOKS=1 GAME_PORT=2601 CLIENT_PORT=5201 npm run dev`、e2e は同じ `GAME_PORT`・`CLIENT_PORT` を付けて実行
- main にコミットしたものは原則 GitHub に push し、公開版にも反映する（タグ live-YYYYMMDD-N を付けて tools/deploy.sh <タグ>。試合中なら待つ、FORCE=1 は /status が判断できないときだけ、失敗したら戻し手順を本人に報告して止める）。CI/CD はない
- push・反映はメインのチェックアウトでのみ行う。worktree からは行わず、~/kiritan_zunda_proto_live・launchd・cloudflared に直接触らない（ゲームサーバーの再起動は deploy.sh の launchd 経由だけ）
- 引き継ぎ書に書かれた担当範囲外のファイルは編集しない
- docs/handoff/done/ への移動はメインのチェックアウトでのみ行う
- セッションと worktree の削除は `claude stop <id>` → worktree のロックを持つ pid の終了を確認（最大30秒待つ）→ `claude rm <id>`。kill・強制削除はしない
- `npm run assets` は `PY=~/MCP_Learning/image_gen_mcp/.venv/bin/python` が必要（psd_tools 入りの Python）
- マップチップは `npm run mapchip`（元素材 ~/MCP_Learning/nimonooki_マップチップ素材基本セット01_ から包み public/assets/mapchip.bin を作る。加工しない・コミットしない）。元の PNG を public に置かない（公開版から取れてしまう。煮の規約の流用防止: mapcrypt1）
- 描画・演出・UI を作る・直す時は docs/render_policy.md に従う
- tools/deploy.sh は反映の前に負荷の関門（verify/perfgate.ts、約1分半。基準は verify/perf_budget.json）を流し、不合格なら反映しない。関門を飛ばす PERFGATE_SKIP=1 は、本人が明示した時だけ使う。perf_budget.json の例外・N を足す・緩めるのも本人の了承がある時だけ（厳しくする方向は自由）
- 関門が不合格の時：1. 反映を止める 2. 出力から、書いている要素と関数を特定する 3. docs/render_policy.md の決まりどおりに直す（見た目・仕様は変えない）4. 流し直し、合格したら反映へ 5. 3回直しても合格しない・見た目や仕様を変えないと合格しない時は、止めて本人に報告（計測の表・原因・案）。直した内容は render_policy の「過去の事故」に1件ずつ足す
