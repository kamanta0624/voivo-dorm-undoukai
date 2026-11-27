# Code引き継ぎ：sec1（受信の検証・例外で落ちない・e2e部屋の封鎖・入力の予算制）

2026-11-28 Chat作成。対象：~/kiritan_zunda_proto。不明点は勝手に判断せず本人に確認。範囲外のコード・コメントは変えない。行番号は 1db4dbd 時点（ずれていたら中身で探す）。

## 背景（Chat がコードを読んで見つけた穴。リポジトリは公開なので改造クライアントは作りやすい）
1. 受信の検証がない：GameRoom.ts の messages（190行〜）は m をそのまま使う。input に null → tick 内（updatePlayers の m.dx）で例外。dx=Infinity → stepPlayer で Infinity/Infinity=NaN → 座標が NaN（見えない・当たらない）になる恐れ。aim・pick・team なども m が undefined だと例外
2. onUncaughtException が未定義。tick・ハンドラ内の例外で部屋が止まる・プロセスが落ちる恐れ（Colyseus 0.18 の実際の扱いは Code が確認）
3. 本番で誰でも e2e 部屋を作れる：index.ts の filterBy(['e2e'])。e2e フックは E2E_HOOKS なしで無効だが、onCreate（396行）は options.e2e があれば環境変数に関係なく部屋を作る。数の上限なし・メンテ中や満員の判定も対象外
4. 入力の連打で常時2倍速：updatePlayers（986行）は入力待ちが NET_CATCHUP(3) を超えると1tickに2個処理する。毎秒40個送り続ければずっと2個処理される
5. ゲームサーバーが全インターフェースで待ち受け（index.ts の server.listen）。LAN から直接つなぐと cf-connecting-ip を偽装でき、IP の BAN をすり抜ける

## やること
### A. 受信の検証（src/server/messages.ts へ切り出し）
- GameRoom.messages の中身を src/server/messages.ts へ移す（形は skills と同じ「関数(room, client, m)」）。検証以外の挙動は変えない
- クライアント→サーバーの各メッセージの型を src/shared/protocol.ts に置き、ハンドラの手前で検証する。型が違う・オブジェクトでない・数値が有限でないものは捨てる（切断はしない）
- input：seq・dx・dy は有限数、rt は有限数か無し。それ以外は捨てる
- クライアント（main.ts・input.ts・title.ts）の送信側も同じ型を使う（送る内容は変えない）

### B. 例外で部屋・プロセスが落ちない
- Colyseus 0.18 の onUncaughtException の仕様を確認して入れる。例外は logs/server.log に種類・部屋・メッセージ名が分かる形で残す
- tick の途中で例外が出ても、次の tick が動く

### C. メッセージ数の上限
- クライアントごとの毎秒の受信数に上限（Colyseus 0.18 に機能があればそれ、なければ自前の最小実装）。値は CONFIG。正常なクライアント（入力 毎秒20＋技＋計測の ping）が絶対に引っかからない余裕を取る。超えた分は捨てる

### D. e2e 部屋の封鎖
- E2E_HOOKS がない時、options.e2e 付きの部屋の作成を拒否する
- e2e・verify が全部 E2E_HOOKS=1 で動いているか確認。そうでないテストがあれば止めて聞く

### E. 入力の予算制
- プレイヤーごとに予算を持つ：tick ごとに +1、上限は CONFIG（仮 4）、入力を1つ処理すると -1。予算が無ければ処理せず待ちに残す（待ちの上限 NET_QUEUE_MAX はそのまま）。1tick の処理は最大2個のまま
- 通信の詰まりの後の追いつきは、貯まった予算の分だけ

### F. 待ち受けを 127.0.0.1 に
- cloudflared の転送先（~/.cloudflared の設定・tools/launchd.sh）、開発（vite の proxy）、スマホ実機の確認手順（docs/mobile_device_test.md）、e2e、botsim を現物で確認し、どれも localhost 経由なら 127.0.0.1 で待ち受ける（環境変数で変えられるように）。LAN から直接つなぐ使い方が1つでもあれば、変えずに止めて聞く

## 成功基準
- 異常系のテストを足す（verify に1本、test:server に追加）：input に null・文字列・{dx:Infinity}・{dx:NaN}・巨大な seq、ほかの各メッセージに undefined・型違い、未知のメッセージ名。どれを送っても、その後 tick が進み、全プレイヤーの座標が有限
- 連打のテスト：毎tick 2個の入力を10秒送り続けた時の移動距離が、通常の 1.1 倍以内
- 通信の詰まりのテスト：0.2秒ぶん入力が止まってからまとめて届いた時、変更前と同じ時間内に追いつく（verify/net.ts・netfix.ts が通る。netmeasure の catchup・dropped が悪化しない）
- E2E_HOOKS なしのサーバーで joinOrCreate('game', { e2e: 'x' }) が拒否される
- verify/golden.ts が一致（Bot だけなので変わらないはず。変わったら --write せず止めて報告）
- typecheck・test:server・e2e（全体1回）が通る。e2e は増やさない

## 範囲外（やらない）
観戦の遅延、管理ページの固め、練習部屋の IP 制限、名前の NG ワード、敵向けの送信項目の絞り込み（sync2）、巻き戻し時刻の検証（sync1）、GameRoom のほかの切り出し（refac1〜）

## 止めて聞く
- 反映の前：入力の予算制は操作の体感に効く。開発版で本人が1試合する
- D・F の確認で想定と違う使い方が見つかった時

## 最後に（本人の確認後）
コミット → GitHub へ push → タグ live-YYYYMMDD-N → tools/deploy.sh <タグ>（試合中の部屋があれば待つ。cloudflared は触らない）。更新情報は足さない。完了後、本ファイルを done/ へ移してコミット・push
