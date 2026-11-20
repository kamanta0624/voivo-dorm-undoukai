~/kiritan_zunda_proto の現状を新規GitHubリポジトリへpush。
まずこの指示を ~/kiritan_zunda_proto/docs/handoff/handoff_github1.md として保存してから作業。

確定事項: リポジトリ名 voivo-dorm-undoukai / Public / リモート未設定

成功基準:
- GitHub上に voivo-dorm-undoukai（Public）が存在
- ローカルのコミットが全てリモートに反映、git status clean、git log -1 とリモートHEADが一致
- 秘密情報・生成物・再生成できる大容量ファイルが含まれない

手順:
1. git status / git remote -v / gh auth status で状態確認。gitリポジトリでなければ git init
2. .gitignore を確認・補完（node_modules, dist, .env*, *.log, .DS_Store, cloudflaredの認証情報や設定, nohup.out など）
3. Publicにする前の点検。問題があればpush前に報告して止まれ
   - APIキー・トークン・cloudflaredトンネル情報・個人パスのハードコード
   - 100MB超のファイル（GitHubが拒否）、50MB超は警告
   - 第三者素材（moikyの立ち絵、VOICEVOX音声）。規約上再配布できるか不明なものは一覧にして確認を取れ。除外するか同梱するかを勝手に決めるな
4. 未コミットの変更をcommit（メッセージは内容の要約）
5. gh repo create voivo-dorm-undoukai --public --source=. --remote=origin --push
6. 成功基準を確認し、リポジトリURL・除外したもの・保留したものを報告

禁止: ゲームサーバーやcloudflaredの停止・設定変更、指示範囲外のコード変更
