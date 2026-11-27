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
11. handoff_botsim1.md　済 live-20261126-8（launchd com.vvsports.botsim 登録済み。集計は npx tsx tools/matchlog_report.ts）
12. handoff_title2.md　済 live-20261126-9（char_lines.md のシート名は残した）
13. handoff_ierutan1.md　済 live-20261126-10（弾は bullet・弾速600）
14. handoff_font1.md　済 live-20261126-11（リーチ！・当選！は保留の丸の下。モダンのスロットは未対応＝使わない）
15. handoff_result1.md　済 live-20261126-12（行頭は顔＋プレイヤー名。結果画面の間に入った人は resultReq で取得）
16. handoff_pwfx2.md　済 live-20261127-1（強さの判定は素材待ちの枠に使うので残した。更新情報の該当行は削除）
17. handoff_result2.md　済 live-20261127-2（原因は高さを見ていなかったこととノッチ・ホームバーの未考慮。iPhone 実機で本人確認済み）
18. handoff_nia1.md　済 live-20261127-3（台本の正は src/shared/commentary_nia.json。調声前。収益化時は琴詠ニアの権利者へ要問い合わせ）
19. handoff_botai1.md　済（反映なし・タグなし。報告 docs/botai_report.md）
20. handoff_tune8.md　保留（実装しない。評価と案の表は docs/tune8_eval.md、計測は verify/tune8_measure.ts）
21. handoff_botai2.md　済（反映なし・タグなし。報告 docs/botai2_report.md）
22. handoff_botai3.md　済（反映なし・タグなし。報告 docs/botai3_report.md。rush に勝ち越すマクロは無し）
23. handoff_ierutan2.md
24. handoff_shot1.md
25. handoff_hitbox1.md（shot1 の後）
26. handoff_react1.md（react0 の報告を受けて。部位の境目とタップの割り当ては一覧と画像で本人に聞いてから）
27. handoff_botai4.md（そら砲。0章の報告で止めて聞く。反映なし）
28. teaser（宣伝動画の撮影。docs/handoff/teaser/ を参考に。画質優先で ffmpeg の画面録画。まず1本撮って止まる）
