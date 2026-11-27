# Code引き継ぎ：refac2（GameRoom から slot・bot・lobby を切り出す。挙動は変えない）

2026-11-28 Chat作成。対象：~/kiritan_zunda_proto。refac1 の後。形・成功基準・禁止は handoff_refac1.md（done/ にある）と同じ。

## 切り出すもの
1. src/server/slot.ts：スロット（classicHold・slotPlayers・slotTarget・slotSyms・startSpin・penalty・updateReflect・reflecting・updateSlots・payout と、モダンの updateModern・modernEv・levelUp・payModern・penaltyModern・mslot）
2. src/server/bot.ts：Bot とアシストの思考（updateBots・botSkillUseful・nearFoe・botStuck・botThink・assistThink・enemyAssist・botFight・botGoto・escorts）
3. src/server/lobby.ts：待機・入退室・練習・観戦（updateLobby・decideStart・checkBack・promoteSpectators・joinPlayer・spectators・updateAbandon・practice*）。Colyseus の呼び口（onCreate・onAuth・onJoin・onDrop・onReconnect・onLeave）は GameRoom に残し、中身を委譲

GameRoom に残るのは試合の進行と戦闘（移動・当たり・ダメージ・大将・コバコ・壁・徳）。

## 併せて
- docs/add_char.md・CLAUDE.md・docs 内の、動かした処理のファイル名の記述を直す（内容は変えない）

## 成功基準
- verify/golden.ts が一致。--write 禁止
- typecheck・test:server・e2e（全体1回）が通る
- 報告：GameRoom.ts の行数の前後、残った責務の一覧

## 最後に
コミット → GitHub へ push → タグ live-YYYYMMDD-N → tools/deploy.sh <タグ>（試合中の部屋があれば待つ）。更新情報は足さない。完了後、本ファイルを done/ へ移してコミット・push
