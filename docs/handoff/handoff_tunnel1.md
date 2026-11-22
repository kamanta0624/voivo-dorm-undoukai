# Code引き継ぎ：公開URLの固定（Cloudflare 名前付きトンネル化）
対象：~/kiritan_zunda_proto（公開側は ~/kiritan_zunda_proto_live、ゲームサーバーは launchd の com.vvsports.game・ポート2567）
前提：8e5cb2a。本人がドメインを Cloudflare で取得済み、`cloudflared tunnel login` 済み（~/.cloudflared/cert.pem があるはず。なければ止めて聞く）
公開ホスト名：vv.club-daiman.com（ドメイン club-daiman.com）

## 公開サーバーを落とさない（最優先）
- ゲームサーバー（com.vvsports.game）・dist/・公開側フォルダは触らない。deploy.sh も実行しない
- 稼働中の一時トンネル（cloudflared tunnel --url）は、新URLの動作確認が終わり本人の指示を受けるまで止めない
- 手順どおりにできない事情があれば止めて聞く

## A. 名前付きトンネル
1. `cloudflared tunnel create` でトンネルを作る（名前は vvsports 仮置き）。認証情報（~/.cloudflared/<UUID>.json）はリポジトリに入れない・中身をログや報告に書かない
2. `cloudflared tunnel route dns` で公開ホスト名をこのトンネルに向ける
3. 設定ファイル（ingress：公開ホスト名 → http://localhost:2567、それ以外は 404）。置き場所は ~/.cloudflared/config.yml か、リポジトリ内に雛形を置いて install で生成するかは既存の tools/launchd の流儀に合わせてよい
4. WebSocket（Colyseus）が通ること、`CF-Connecting-IP` が従来どおり取れることを確認

## B. 常駐化
5. cloudflared を launchd に登録する（別ラベル、例：com.vvsports.tunnel。落ちたら自動再起動、ログは公開側 logs/tunnel.log）。tools/launchd.sh に install/uninstall を足すか別スクリプトかは最小で
6. ゲームサーバーの再起動（deploy.sh の kickstart）でトンネルが切れない・URLが変わらないこと

## C. 切り替え
7. 一時トンネルと並行で新URLを確認：2つのブラウザで入室・試合開始・再接続・バージョン表示・自動リロードが動く。スマホ（モバイル回線）からも1回
8. 確認できたら止めて報告。一時トンネルの停止（どのPIDを止めるか）は手順を書いて本人の指示を待つ
9. share.sh（一時トンネル）は友人テスト用の簡易手段として残すか廃止するか、本人に聞く。勝手に消さない

## D. 文書
10. 一時URL前提の記述（README・deploy.sh のコメント等）を固定URL前提に直す。範囲外の書き換えはしない

## 成功基準
- 公開ホスト名で入室・試合ができ、Mac再起動・cloudflared の kill・ゲームサーバーの kickstart の後も同じURLで復帰する（再起動は本人の指示があるときだけ。kill と kickstart は別ポート・別ラベルの試験環境で確認してよい）
- 認証情報がリポジトリ・ログ・報告に出ていない
- 既存の deploy.sh・launchd（ゲームサーバー）の動きが従来どおり

## 禁止
範囲外の変更、不要な抽象化、公開サーバーの停止、一時トンネルの無断停止、DNS の公開ホスト名以外のレコード変更
