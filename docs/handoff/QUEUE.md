# 引き継ぎ書キュー（Chat が更新する。2026-11-25）

上から1本ずつ実行する。例外は下の「並行レーン」だけ。

## 進め方
1. 先頭の未完了の引き継ぎ書を読み、そのとおりに実行する
2. 引き継ぎ書の「止めて聞く」「本人の確認後」に当たったら、その場で止めて本人に質問・報告する。本人が答えるまで次へ進まない
3. 本人の確認が取れたら、引き継ぎ書の末尾の手順（コミット → push → タグ → deploy.sh）まで行う
4. 完了したら引き継ぎ書を done/ へ git mv し、下の一覧の行に「済」とタグ名を書いてコミット
5. 次の行へ進む。「Chat待ち」の行に来たら止めて本人に知らせる

## 一覧
1. handoff_e2efix1.md　済（テストと e2e フックのみ。反映なし・タグなし）
2. handoff_tune7.md（1・2・4章は並行レーンの worktree で実施中。e2efix1 の後はそのブランチを main へ取り込み、3章を行ってから反映）
3. handoff_spectate1.md
4. handoff_hud2.md（2章は docs/voice/sortie.csv が置かれるまで待つ。ほかの章は進めてよい。CSV がなければ2章を残したまま本人に知らせて次へ）
5. handoff_screen1.md
6. handoff_pwfx1.md（Chat待ち：screen1 と立ち絵の左右が食い違っているため Chat が書き直す。着手しない）

## 並行レーン（e2efix1 の実行中に別セッション・別 worktree で進める。2026-11-25 21時半）
- handoff_tune7.md の 1・2・4章だけ。CLAUDE.md の並列作業ルールに従い、空きポートを使う
- 触ってよいのは tune7 の範囲（config.ts の SLOT 演出 reach、slot_modern_fx.ts、slot_page、main.ts の練習パネルのタッチ周り、ルール説明・更新情報）。e2efix1 が触っている src/server/GameRoom.ts・verify/ は触らない
- 3章（連戦の計測）は e2e の負荷で数値が狂うため、e2efix1 が main に入るまで着手しない
- e2e 全体は回さない。typecheck・test:server・Bot戦のスクショまで
- main へのマージ・push・タグ・deploy は e2efix1 の反映が終わってからメインのチェックアウトで行う。それまでは本人確認まで進めて止める
