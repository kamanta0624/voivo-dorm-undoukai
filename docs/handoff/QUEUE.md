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
23. handoff_ierutan2.md　済
24. handoff_shot1.md　済
25. handoff_hitbox1.md（shot1 の後）　済（そらのチャージの作り直しを含む）
26. handoff_react1.md（react0 の報告を受けて。部位の境目とタップの割り当ては一覧と画像で本人に聞いてから。あいえるたんの koed は ierutan2 で「恐怖」に替わった）　済
27. handoff_ierutan3.md　済（範囲を半径200の円に戻した）
28. react1b（引き継ぎ書なし。本人の指示: WhiteCUL の食事・ペット・もち公、もち子のじろう系、そらの b は同じ衣装なので使う。バリスタは使わない。WhiteCUL の下半身のタップを「ペット」に戻し、「食事」「もち公」も使う。もち子の顔のタップを「じろう系」、そらの喜ぶを「b」。更新情報は足さない。反映まで）　済
29. handoff_tachie2.md（選択画面を主に書き換える）→ 0章への本人の回答と箱の作業は handoff_tachie2b.md（木箱の案の画像で止める）　済（tachie2b も）
30. sora4（引き継ぎ書なし。本人の指示: そらの威力を285秒で止めず試合終了まで伸ばし続ける。265→285秒の伸び方を延ばす・値は CONFIG。詰める作りはそのまま。技ボタンの％も伸びる。確認は4分50・55・58秒でどれも1200以上・遅いほど多い。botai4・キャラ一覧も直す。反映まで）
31. handoff_botai4.md（そら砲。0章の報告で止めて聞く。反映なし）
32. teaser（宣伝動画の撮影。docs/handoff/teaser/ を参考に。画質優先で ffmpeg の画面録画。まず1本撮って止まる）
33. handoff_tidy1.md（権利の一覧・「仮置き」の棚卸し。調査だけ・コード変更なし。2枚を出して止める。ついなちゃん・後鬼の規約と素材の有無も）
34. handoff_sec1.md（受信の検証・例外で落ちない・e2e 部屋の封鎖・入力の予算制・127.0.0.1 待ち受け。反映前に本人が1試合）
35. handoff_refac1.md（GameRoom から snapshot・lagcomp・e2e フック。挙動は変えない・golden 一致）
36. handoff_refac2.md（GameRoom から slot・bot・lobby。挙動は変えない・golden 一致）
37. handoff_refac3.md（main.ts から net・hud、update() の段分け。反映前に本人が PC と iPhone で1試合ずつ）
38. handoff_sync1.md（出来事の時刻合わせ・巻き戻し時刻の検証・残り秒を終了時刻で。反映前に本人がテストプレイ）
39. handoff_sync2.md（スナップショットの量の計測で止める → 分割・敵向けの項目の絞り込み）
40. ついなちゃん・後鬼の追加（Chat待ち。仕様は本人。tidy1 の規約・素材の確認を見てから）

33〜39 の決まり：refac（35〜37）は挙動を変えない・golden.ts --write 禁止。refac の途中に GameRoom.ts・main.ts を触る別の修正を混ぜない（本人の修正の指示は、1本が済んだ切れ目に入れる）。見た目の良し悪しは Code・Chat で判断せず、画像を出して本人が判断する。
