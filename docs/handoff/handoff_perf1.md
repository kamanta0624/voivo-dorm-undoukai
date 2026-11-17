# Code引き継ぎ：クライアントの軽量化（perf1）
対象：~/kiritan_zunda_proto の `src/client/main.ts` のみ
目的：視界の計算と HUD の DOM 更新を軽くする。見た目・挙動は一切変えない

## 公開中のサーバーを落とさない（最優先）
- 2567・5173 のプロセス・cloudflared に触らない。`npm run share` を実行しない。dist/ を書き換えない
- スクショ・計測は `GAME_PORT=2568 CLIENT_PORT=5174` で別起動。止めるのは自分が起動したPIDだけ（tsx watch の子が残るので PID で kill）

## 現状（着手前に読む）
- 視界：`visPoly`（main.ts:832付近）。目（味方・撃破演出中の味方・味方大将）ごとに毎フレーム 360本のレイ、4px刻みで `isWall`、壁の厚みを2px刻み、`Phaser.Math.Vector2` を毎回360個生成
- 計測：`?perf=1` で `window.perf`（n・ray・rayMax）と #info に「視界の計算 平均…ms」が出る
- HUD：毎フレーム無条件に書いている箇所あり（`#info` の textContent、`.timer`、大将HPバーの style、技アイコンの textContent・style、ラベルの style など）。一部（徳・名簿・照準）は差分比較済み

## 1. 着手前：基準を取る
- 変更前のコードで以下を記録（同条件で後から再計測できる手順として残す）
  - 視界の計算平均：`?perf=1`、Bot戦の playing 中の一定区間（例：30秒）
  - HUD の DOM 変更回数：HUD 本体（タイマー・名簿・技・HPバー・#info など。`.timer` の親要素）以下に MutationObserver（subtree・childList・attributes・characterData）を掛け、同じ区間の記録数
  - スクショ：同じ場面（固定の位置・時刻）を数枚（視界の縁・壁際・壊れた壁・HUD 全体が写るもの）
- `npx tsx verify/golden.ts` の変更前の出力を記録（比較は変更前の出力と変更後の出力で行う）

## 2. 視界の計算
- `visPoly` の出力（全頂点の座標）が変更前と完全一致すること。近似禁止
- レイ本数（360）・刻み（4px／2px）・半径・更新頻度は変えない

## 3. HUD の DOM 更新
- 値が前回と同じなら DOM に書かない（textContent・innerHTML・style・classList すべて）
- 表示される文字・色・幅・タイミングは変えない

## 成功基準
1. 視界の計算平均（`window.perf.ray / n`）が基準の 1/3 以下
2. HUD 本体（タイマー・名簿・技・HPバー・#info など）の DOM 変更回数が基準の 1/5 以下
3. 前後スクショの差なし（画素比較。差が出たら場所と理由を報告）
4. `visPoly` の新旧比較：ランダムな位置・半径（壁際・壁の中・壊れた壁を含む）で全頂点一致（使い捨てスクリプトで可、結果を報告）
5. `npx tsx verify/golden.ts` が変更前の出力と一致
6. `npm run typecheck`、`npm run test:server` が通る（net.ts の遅延計測はフレーク。直さず再実行して回数を報告）
7. 計測値（前・後）と計測手順を報告

## 禁止
- `src/client/main.ts` 以外の変更（計測用の使い捨てスクリプトは scratch に置き、コミットしない）
- 視界の精度を落とす変更：レイ本数の削減、刻みの粗化、数フレームおきの更新などの間引き
- 見た目・挙動の変更、範囲外のリファクタ・コメント変更

## 使い回し（確認済み）
- 入力（目の座標・半径・壁の状態）が完全に同じときに前回のポリゴンを使い回すのは可（結果同一のため間引きに当たらない）。壁は壊れるので、壁の状態の変化で必ず作り直す

## golden.txt の不一致
- golden.txt が最新コミットの出力と一致しない件は perf1 では直さない（golden.txt を --write で取り直さない）。不一致の事実だけ報告

## 不明なら止めて聞く
- 1/3 に届かず、精度を落とす以外の手が尽きた時
- main.ts 以外（shared の `isWall` やマップ構造など）に手を入れないと達成できない時
