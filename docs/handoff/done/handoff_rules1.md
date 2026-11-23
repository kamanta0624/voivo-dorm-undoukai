# Code引き継ぎ：タイトルの「ルール説明」でルール説明HTMLを出す
対象：~/kiritan_zunda_proto

## 公開サーバーを落とさない
公開側（~/kiritan_zunda_proto_live）は触らない。反映は本人の指示でまとめて1回（tools/deploy.sh <タグ>）。この引き継ぎでは反映しない

## 置いてあるもの（Chatが配置済み）
- `public/rules.html`：ルール説明ページ（1ファイル完結。CSS・JSは中に入っている）。左下に常に「← タイトルへ戻る」ボタン（`/`）、目次の先頭にも同じリンク。画像は次を参照する
  - `/assets/gen/dot/<key>/idle.png`・`/assets/gen/tachie/{ankomon,zundamon}/select.png`（既存の生成素材）
  - `/assets/rules/map.png`（マップ全体の画像。下記）
- `public/assets/rules/map.png`：現行の map.json を `src/client/mapchip/paint.ts` の `paintMap` で描いた全体図（3104×2016 を下端の空白だけ切って 3104×1480）。マップチップを含むので管理外にする
- `docs/handoff/ref_render_rules_map.ts`：上の画像を作ったスクリプト（参考。Chat の作業環境で @napi-rs/canvas＋tsx で実行した。import のパスは作業環境のもの）

## やること
1. タイトルの「ルール説明」ボタン（`src/client/title.ts` 113行目付近）を、ADV（tutorial.ts）ではなく `/rules.html` へ同じタブで移動するように変える。戻るボタンは rules.html に入れてある（左下固定と目次の先頭）。tutorial.ts は消さずに残す（ADVは将来使う）
2. `public/assets/rules/` を .gitignore に追加（理由のコメントつき。マップチップ・ドット・立ち絵と同じ扱い）
3. `tools/deploy.sh` が `public/assets/tutorial/` などを公開側へ写しているのと同じ形で、`public/assets/rules/` も写す
4. マップ画像を再生成する手段：ref のスクリプトを tools/ に置ける形にして `npm run assets`（tools/build_assets.sh）から生成する。新しい依存（@napi-rs/canvas 等）が要るなら入れる前に本人に確認。要らずにできるならそれでよい。手で置いた map.png と同じ絵になること
5. `vite build` の dist に rules.html が入ること（public/ 配下なのでそのまま入るはず。確認だけ）

## 成功基準
- 開発サーバーでタイトル→「ルール説明」→ rules.html が表示され、マップ・立ち絵・ドットがすべて出る。左下の「← タイトルへ戻る」でタイトルに戻れる（PC・スマホとも押せる位置にあること）。PC・スマホ幅のスクショ
- `git status` に public/assets/rules/ が出ない
- `npm run assets` で map.png が再生成される（4の結論次第。依存追加を保留したならその旨を報告）
- typecheck・test:server が通る。e2e は増やさない（既存 e2e がルール説明ボタンの ADV を前提にしていれば、その項目だけ rules.html への遷移に合わせて直す）

## 不明なら止めて聞く
- 新しい依存の追加
- rules.html の文言・内容の変更（直さない。誤りに気づいたら報告だけ）

## 禁止
範囲外の変更、素材の加工、公開サーバーの停止・反映、cloudflared の変更
