# Code引き継ぎ：refac3（main.ts から net・hud を切り出し、update() を段に分ける。見た目・挙動は変えない）

2026-11-28 Chat作成。対象：~/kiritan_zunda_proto。refac2 の後。不明点は勝手に判断せず本人に確認。範囲外のコード・コメントは変えない。

## 目的
src/client/main.ts（2095行・183KB、GameScene 1クラス、update() が約480行）を分ける。サーバー側と違い golden が効かないので、確認を厚くする。

## 形
- 「関数(scene, …)」。新しい仕組みは入れない。GameScene の状態は GameScene に置いたまま
- docs/render_policy.md に従う（描画の作り直し・DOM の書き換えの頻度を増やさない）

## 切り出すもの（この順に3段。段ごとにコミット）
1. src/client/net.ts：接続後の onMessage 群（'s'・ko・koed・kill・slot ほか）、入力の送信（NET_STEP ごとの送信と予測）、pred・interp・計測（measure）のつなぎ。`s: any` を src/shared/protocol.ts の型に置き換える
2. src/client/hud.ts：DOM の HUD（rosterHud・buffHud・tokuHud・modernHud・killLog・banner・notify・popup・cutin・staging など）
3. update()：入力／壁の反映／自キャラ／ユニットの描画／弾／fx／視界／HUD の段ごとの関数に分ける（処理の順番は変えない）

## 成功基準
- typecheck・test:server・e2e（全体1回）が通る。e2e は増やさない
- スクショの前後比較：スマホ（852×393 DPR3）と PC（1920×1080）で、タイトル・選択画面・戦闘（通常時・パワーアップ中・スロット当選）・撃破カットイン・被撃破・結果画面。固定の場面で前後が一致（差が出たら画像を付けて報告）
- ?perf=1 の計測（drawcall・WebGL の転送量）が前後で増えていない
- 報告：main.ts の行数の前後、update() の行数の前後

## 止めて聞く
反映の前：本人が開発版で1試合（PC）と iPhone 実機で1試合。

## 禁止
見た目・挙動の変更、ついでの修正（見つけたら直さず報告）、e2e の追加

## 最後に（本人の確認後）
コミット → GitHub へ push → タグ live-YYYYMMDD-N → tools/deploy.sh <タグ>（試合中の部屋があれば待つ）。更新情報は足さない。完了後、本ファイルを done/ へ移してコミット・push
