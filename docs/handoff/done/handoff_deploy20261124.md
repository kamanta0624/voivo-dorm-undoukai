# Code引き継ぎ：deploy20261124（rules.html 修正のコミット・push・公開反映）

2026-11-24 Chat作成。本人の指示による公開反映（CLAUDE.md の「公開反映は本人指示時のみ」の指示に当たる）。

## やること
1. 未コミットの `public/rules.html`（215行、きりたんの説明「近くは包丁、遠くはきりたん砲」→「通常攻撃はきりたん砲」）をコミット
2. main を push（origin/main より先行している分すべて）
3. main の最新コミットに `live-20261124-1` のタグを付ける（同名があれば -2 以降）。タグも push
4. `tools/deploy.sh live-20261124-1` を実行
   - 試合中の部屋があって中止されたら、待ってから再実行。FORCE=1 は /status が判断できないときだけ
   - ゲームサーバーの再起動は deploy.sh の launchd 経由だけ。cloudflared には触らない
   - 失敗したら、表示される戻し手順を本人に報告して止める（自分で戻さない）
5. 本ファイルを docs/handoff/done/ へ git mv してコミット・push

## 成功基準
- deploy.sh が「反映した: live-20261124-1 …メンテ解除」で終わる
- https://vv.club-daiman.com で、更新情報に 2026-11-24 の分が出て、きりたん・ずん子の足元の円が 200px、近接攻撃が出ない
- origin/main と main が一致
