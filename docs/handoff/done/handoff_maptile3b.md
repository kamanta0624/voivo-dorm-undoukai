# handoff_maptile3b：maptile3 の再開と仕上げ

前提：handoff_maptile3.md の作業を別のエージェント（Codex）が途中まで進めて止まった。経緯の記録はない。最初からやり直さず、今の差分から仕上げる。コミットしない

## 0. 片付け（最初に）
- kiritan_zunda_proto の開発サーバー・e2e・Chrome で、残っているものを止める（例：1日以上前から動いている concurrently/tsx watch/vite の系列、途中の verify/e2e.ts）
- 公開版（~/kiritan_zunda_proto_live、launchd 管理のゲームサーバー）と cloudflared には触らない。どれが公開版か判別できなければ止めずに聞く

## 1. e2e の範囲外の書き換えを戻す
- verify/e2e.ts の差分のうち、透過壁の検証（seeThroughCheck とその呼び出し）だけを残し、ほかは HEAD に戻す。戻すもの：コバコ撃破の手順の変更、基準4（遅延下の描画）の判定の書き直し、その他 maptile3 と関係のない変更
- verify/server.ts の差分も同じ基準で確認し、透過壁と関係のない変更は戻す

## 2. 現状の確認
- 1〜3章（src/maptest/・verify/evidence/maptile3_20261122_final/）と4章（map.json・config.ts・GameRoom.ts・commentary.ts・main.ts）の差分を、handoff_maptile3.md の仕様と照らして確かめる。足りない所だけ足す
- 型チェック・サーバー単体テスト・golden・e2e を流す

## 3. 既存の e2e が落ちた場合
- テストを書き換えて通すな。原因を調べて報告する
- 間に別の作業のコミット（speed1：速度変更、itako2 など）が入っている。maptile3 の差分を一時的に外して（stash など）同じ項目が落ちるかを確かめ、原因が maptile3 か別の作業かを切り分ける。切り分けの後は差分を元に戻す

## 報告
handoff_maptile3.md の「報告」の項目に加えて：
- 戻した e2e・server の変更の一覧
- 既存の e2e の結果。落ちたものは、原因が maptile3 か別の作業かの切り分け結果
- 止めたプロセスの一覧
