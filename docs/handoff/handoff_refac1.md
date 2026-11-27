# Code引き継ぎ：refac1（GameRoom から snapshot・lagcomp・e2e フックを切り出す。挙動は変えない）

2026-11-28 Chat作成。対象：~/kiritan_zunda_proto。sec1 の後。不明点は勝手に判断せず本人に確認。範囲外のコード・コメントは変えない。

## 目的
src/server/GameRoom.ts（2277行・161KB、1クラスに全部）を責務ごとのファイルに分ける1本目。挙動は1つも変えない。

## 形
- 既存の src/server/skills/ と同じ「関数(room, …)」。継承・DI・イベントバスなどの新しい仕組みは入れない
- GameRoom の状態（フィールド）は GameRoom に置いたまま。移すのは処理
- verify・skills が GameRoom のメソッドを呼んでいる所は、差分が小さい方（薄い委譲を残す／呼び元を直す）を選ぶ

## 切り出すもの
1. src/server/snapshot.ts：sendSnapshots と、その中で使う表示用の組み立て（statusView・classicView・modernView・buffView・arrowView）、視界の判定（visibleTo・bodySeen・dying のうち送信専用のもの。戦闘でも使うものは残してよい）
2. src/server/lagcomp.ts：近接AAの巻き戻し（hist・jumps・noteJump・recordHist・lagT・rewound）
3. src/server/e2e.ts：e2e フック（messages の e2e* と、E2E_HOOKS の時だけ使う処理）。GameRoom 側は E2E_HOOKS の時だけ読み込んで足す
4. src/shared/protocol.ts にスナップショット（'s'）の型を足し、サーバー側の組み立てに付ける。クライアントの `s: any` は refac3 で置き換える（今回は触らない）

## 成功基準
- verify/golden.ts が一致。--write 禁止（変わったら止めて報告）
- 送信内容が変わっていないこと：golden がスナップショットの中身まで見ていなければ、固定シードの Bot 戦＋観戦1人で、切り出し前後の全スナップショットのハッシュが一致することを確かめる（照合の手段は Code が決める。使い捨てなら残さない）
- typecheck・test:server・e2e（全体1回）が通る。e2e は増やさない
- 報告：GameRoom.ts の行数の前後、新しいファイルと行数

## 禁止
挙動の変更、ついでの修正（バグを見つけたら直さず報告）、名前の付け替えだけの変更、verify/server.ts の分割、e2e の追加

## 最後に
コミット → GitHub へ push → タグ live-YYYYMMDD-N → tools/deploy.sh <タグ>（試合中の部屋があれば待つ）。更新情報は足さない。完了後、本ファイルを done/ へ移してコミット・push
