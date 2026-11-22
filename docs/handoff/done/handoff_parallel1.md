# handoff_parallel1：並列開発環境（Claude Code agent view）

## 目的
~/kiritan_zunda_proto を Claude Code の agent view（`claude agents`）で複数セッション並列に開発できる状態にする。今回は環境づくりのみ。ゲームのコード変更はしない。

## 前提（Chat側の把握。推測で動かず現物を確認しろ）
- リポジトリ：GitHub kamanta0624/voivo-dorm-undoukai（Public）
- 公開版：~/kiritan_zunda_proto_live（git worktree、タグ固定）。ゲームサーバー 2567 を launchd（com.vvsports.game）で常駐、cloudflared は launchd（com.vvsports.tunnel）
- ほかに ~/kiritan_zunda_proto_reach1 が存在する（用途不明。触るな、状態だけ報告）
- agent view は編集時に `.claude/worktrees/` 下の worktree へ自動で移り、完了時にブランチを commit・push し、必要ならドラフトPRを出す。main へは push・マージしない
- 作業ブランチが公開リポジトリへ push されることは本人了承済み（2026-11-22）

## 成功基準
1. `claude --version` と、`claude agents` が agent view で開くかを報告（開かなければ `claude update` が必要と報告して止まれ）
2. `git worktree list` の結果を報告。既存 worktree は削除・移動しない。`git worktree prune` は絶対に実行するな（環境によって _live・reach1 が prunable と表示されることがあり、消すと公開版が壊れる）
3. `.gitignore` に `.claude/worktrees/` を含む
4. 新規 worktree でゲームが起動・描画できる：
   - gitignore 対象で実行に必要なファイル（書き出し済み32dotドット・Moiky立ち絵・.env 等）を洗い出し、`.worktreeinclude` に列挙
   - コピー総容量を報告。大きすぎる（目安1GB超）なら、コピーかシンボリックリンクかを判断せず質問しろ
   - 素材は worktree 内でも gitignore のまま。コミットされないことを確認
5. ポート分離：ゲームサーバーとクライアント（dev server）のポートを環境変数で上書き可能にする。既定値は変えない（2567 は src/shared/config.ts・vite.config.ts・verify/lib.ts・tools/ に出現。開発側の既定と公開版の関係を確認して報告）。2つの worktree で同時起動し、互いにも 2567（公開版）にも衝突しないことを実機確認
6. e2e も別ポートで worktree から実行できることを確認（全件でなく1件でよい）
7. リポジトリ直下の CLAUDE.md（無ければ作成）に「並列作業ルール」を追記：
   - worktree では作業開始時に `npm install`
   - ポートは環境変数で空きを使う。2567 は使わない
   - ~/kiritan_zunda_proto_live・launchd・cloudflared・tools/deploy.sh に触らない（公開反映は本人指示時のみ）
   - 引き継ぎ書に書かれた担当範囲外のファイルは編集しない
   - docs/handoff/done/ への移動はメインのチェックアウトでのみ行う
8. 最後に、docs/handoff/ 直下の未完了引き継ぎ書を読み、並列に流せる組み合わせを提示：
   - 各引き継ぎ書が触るファイルを列挙し、衝突するものは同時に流さない案にする
   - dispatch はまだしない

## 制約
- 上記以外のコード・コメントを変えるな
- 公開版への反映はしない
- 不明点は勝手に判断せず質問しろ
