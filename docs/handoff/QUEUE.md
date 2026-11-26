# 引き継ぎ書キュー（Chat が更新する。2026-11-26）

上から1本ずつ実行する。並行させない。

## 進め方
1. 先頭の未完了の引き継ぎ書を読み、そのとおりに実行する
2. 引き継ぎ書の「止めて聞く」「本人の確認後」に当たったら、その場で止めて本人に質問・報告する。本人が答えるまで次へ進まない
3. 本人の確認が取れたら、引き継ぎ書の末尾の手順（コミット → push → タグ → deploy.sh）まで行う
4. 完了したら引き継ぎ書を done/ へ git mv し、下の一覧の行に「済」とタグ名を書いてコミット
5. 次の行へ進む。「Chat待ち」の行に来たら止めて本人に知らせる

## 一覧
1. handoff_e2efix1.md　済（テストと e2e フックのみ。反映なし・タグなし）
2. handoff_tune7.md　済 live-20261125-8（2・3章は調査報告のみ）
3. handoff_spectate1.md　済 live-20261125-9
4. handoff_hud2.md　済 live-20261125-10（2章は live-20261126-5。出撃セリフの調声は後回し）
5. handoff_screen1.md　済 live-20261125-11
6. handoff_perf5.md　済 live-20261125-12（スロット演出のマスクは今のまま。案A は WebKit で効かず）
7. handoff_pwfx1.md　済 live-20261126-2（PC の画面内の演出は案のみ）
8. handoff_lobby2.md　済 live-20261126-6（NG ワード判定は無い）
9. handoff_react0.md　済（調査報告のみ。コード変更なし・タグなし。react1 は Chat 待ち）
10. handoff_news1.md　済 live-20261126-7（更新情報の画面にも要約の行を出す）
11. handoff_botsim1.md（記録部を常時ON。人間の試合も Bot 戦も同じログ。リザルト画面の元データを兼ねる）
12. handoff_font1.md（戦闘画面の文字を +20%。result1 の前：新しい画面が同じ文字の基準を使えるように）
13. handoff_result1.md（botsim1 の後。試合結果画面）
14. handoff_title2.md
15. handoff_pwfx2.md
16. handoff_nia1.md（台本は docs/handoff/nia_lines.json）
17. handoff_botai1.md（botsim1 の後）
18. handoff_react1.md（react0 の報告を受けて。部位の境目とタップの割り当ては一覧と画像で本人に聞いてから）
