# Code引き継ぎ：title2（ゲームタイトルを「ブイブイブレイカーズ」へ差し替え）

2026-11-26 Chat作成。対象：~/kiritan_zunda_proto。不明点は勝手に判断せず本人に確認。範囲外のコード・コメントは変えない。

## 仕様（本人）
- タイトルは「ブイブイブレイカーズ」。英字は VV BREAKERS、略称はブブブ（VV の中身は決めない）
- 旧タイトル「VOICE SQUAD」「ボイスク」はマニュアル含め全部差し替える

## 差し替え先（Chat が 2026-11-26 に grep した結果。漏れが無いか自分でも grep する）
- index.html の `<title>`
- src/client/title.ts・src/client/main.ts の `TITLE`
- public/rules.html（`<title>`・h1・フッター）
- public/manifest.webmanifest の name・short_name（どちらも「ブイブイブレイカーズ」）
- README.md の見出し
- docs/ 配下の本文（docs/char_lines.md など）。ただし docs/char_lines.md 11行目のスプレッドシート名「VOICE SQUAD 出撃セリフ」は本人の実在のシート名なので変えない（本人に報告だけ）
- 画像・ロゴ・OGP・アイコンに旧タイトルの文字が入っている物があれば、差し替えずに一覧で報告して止める

## 変えない
- public/patchnotes.md の過去の記載（「タイトルが VOICE SQUAD になりました」の行は履歴として残す）
- docs/handoff/done/、verify/、dist/、.claude/worktrees/
- 実況台本の「ボイボ寮より」（場所の名前で、タイトルではない）

## 成功基準
- 上の「変えない」以外で `grep -rniE "voice.?squad|ボイスク"` が0件
- タイトル画面・ルール説明・ブラウザのタブ・ホーム画面に追加した時の名前が「ブイブイブレイカーズ」（852×393 DPR3 と 1920×1080 のタイトル画面スクショ）
- タイトルが長くなってタイトル画面の文字がはみ出す・折り返す場合は、直し方の案を出して止める
- typecheck・test:server・e2e（全体1回）が通る。e2e は増やさない

## 禁止
範囲外の変更、不要な抽象化、e2e の追加、公開サーバーの停止

## 最後に（本人の確認後）
コミット → GitHub へ push → タグ live-YYYYMMDD-N → tools/deploy.sh <タグ>（試合中の部屋があれば待つ。cloudflared は触らない）。更新情報に「ゲームのタイトルが『ブイブイブレイカーズ』になりました」を足す。完了後、本ファイルを docs/handoff/done/ へ移してコミット・push
