夜間：39 まで済み。本人の返事が要るもの 15 件

# 夜間の報告（2026-11-28）

本人の指示「32b から進め」に従い、QUEUE の「夜間の進め方」で進めている。1本済むたびに書き足す。

## 32 teaser（保留）
- 本人の指示で撮影を止めた。試し撮りの 03-wall.mp4（1280×720・60fps・5.5秒）と元の録画は verify/evidence/teaser/ に残した
- 撮影のためにゲームのコード・サーバーへ足したものは無い（撮影スクリプトは scratchpad の写しだけ。Chrome も閉じた）

## 32b pvoice1（プレイヤーボイスの台本）
- 済んだこと：0章の場面の一覧を作り、夜間の決まり（いちばん単純な案で進める）で、候補の場面すべてについて全14キャラの台本の下書きを書いた
  - CSV：docs/voice/player_voice_draft.csv（UTF-8 BOM 付き。列：キー／キャラ／場面キー／場面／番号／セリフ／スタイル／メモ）
  - 168本（14キャラ × 12本）。コード・音声・char_lines.md は触っていない
- 0章の場面の案（本人に聞くこと。CSV はこの案で書いた）：

| 場面 | 今のゲームの出来事 | 本数（1キャラ） | 誰に聞こえるか（案） | 字幕（案） |
|---|---|---|---|---|
| 技の発動 | 技を使った時 | 2 | 本人と、画面に映っている人 | なし |
| 撃破した | 撃破のカットイン（ko） | 2 | 本人だけ | なし |
| 倒された | やられた画面（koed） | 2 | 本人だけ | なし |
| 復帰 | 反省中から戻った時 | 1 | 本人だけ | なし |
| パワーアップ | スロットのパワーアップを受けた時 | 1 | 本人だけ | なし |
| 帰還 | 帰還できた時（recalled） | 1 | 本人だけ | なし |
| 指名手配された | 自分が手配された時 | 1 | 本人だけ | なし |
| 勝ち | 決着で勝った陣営 | 1 | 本人だけ | なし |
| 負け | 決着で負けた陣営 | 1 | 本人だけ | なし |

- 書き方：出撃セリフ（docs/voice/sortie.csv）と同じく短く、キャラの一人称・語尾（めたん・イタコの「ですわ」、アルの「だぜ」、そらの「ごしゅずんさま」など）に合わせた。WhiteCUL の倒された・負けはスタイル「びえーん」、それ以外はノーマル
- 本人に要る返事：
  - 場面（9つ）と本数・聞こえる範囲・字幕の案でよいか
  - 台本の CSV のレビュー（スプレッドシートで直して置き直す）
  - ビィの「ばくはつ！」（char_lines.md）のような技の中の決まったセリフを、技の発動と別に足すか

## 33 tidy1（権利の一覧・「仮置き」の棚卸し）
- 済んだこと：docs/rights.md・docs/kari_list.md を作った（main。src・tools・verify・LICENSE・package.json・README は差分なし）
- 確かめた基準：規約は原文を読んで書いた（VOICEVOX の各キャラの規約は、VOICEVOX のキャラのページに埋め込まれた規約の URL から取って読んだ）。読めなかったもの（マップチップの booth、ニコニ・コモンズの作品ページ、琴詠ニア）は「未確認」
- 大事な所：
  - もち子さんは無償のゲームは可だが、ゲームの有償販売は禁止・それ以外の商用は事前連絡。ユーレイちゃんは非商用（商用はユーステラの確認）。No.7 は「ゲームでの利用」が商用の例
  - マップチップ（煮）はクレジットに載っていない
  - ついなちゃん（後鬼を含む）のキャラは非商用の二次創作だけ許諾で、ファンティアのプランに加入すると正式な認可。ついなちゃんの VOICEROID2 の音声は、無償のネット配布のゲームなら可、有償・営利は AHS の個人向け商用ライセンスが要る。後鬼の音声（VOICEVOX）は商用も可（クレジット必須）
  - 素材の有無：後鬼は Moiky の立ち絵が有り・32dot は一覧に無い。ついなちゃんは 32dot に有り・Moiky の立ち絵は無い
- 本人に要る返事：
  - コードのライセンス（案 A：権利を留保／B：MIT／C：非商用のソース公開。おすすめは A）と README の文案
  - kari_list.md の「確定でよさそう」の行を確定にしてよいか
  - 未確認の規約（マップチップ・ニコニ・コモンズ3件）のブラウザでの確認

## 34 sec1（受信の検証・例外・e2e 部屋の封鎖・入力の予算）
- 済んだこと（night-1128 の d752404）：
  - A：GameRoom.messages の中身を src/server/messages.ts へ移した（中身は変えていない）。型と検証は src/shared/protocol.ts。型違い・オブジェクトでない・有限でない数は捨てる（切断しない）。input の dx・dy は -1〜1 も見る。未知の名前も捨てる（Colyseus の既定は切断）。クライアントの送信も同じ型で書いた（送る中身は同じ）
  - B：onUncaughtException を入れた。Colyseus 0.18 では、これを定義するとメッセージ・タイマー・tick・入退室を try/catch で包む（定義しないとタイマーの例外でサーバーが落ちる）。例外は `[error] room=… where=… message=…` の1行とスタックで server.log に出る
  - C：Colyseus の maxMessagesPerSecond は超えると切断するので使わず、自前で捨てる形にした。CONFIG.NET_MSG_MAX_PER_SEC 120（仮置き）。部屋の経過時間で数える
  - D：E2E_HOOKS なしでは options.e2e の部屋を作れない
  - E：入力の予算（下の「自分で決めた点」）
- 確かめた基準と結果：
  - 異常系（test:server に追加、verify/sec1.ts は本物のサーバーにつなぐ）：null・文字列・Infinity・NaN・巨大な seq・各メッセージの undefined と型違い・未知の名前・連打のどれでも、切断されず tick が進み座標が有限。tick で1回例外を出しても次の tick が動く → 通った
  - 連打（毎tick 2個を10秒）：通常の 1.095倍 → 通った
  - 詰まり：0.2秒・1秒とも、変更前と同じ tick で追いつく → 通った。verify/net.ts も通り、予測とサーバーの差は main と同じ値。netmeasure も通った
  - E2E_HOOKS なしのサーバーで joinOrCreate('game', { e2e: 'x' }) が拒否される → 通った
  - golden 一致・typecheck・e2e 全体1回（404 は既存の5件）→ 通った
  - verify/netfix.ts の「stopped-out」は main（0b82b36）でも落ちる、元からの失敗（test:server は && でつないでいるので、ここで止まる。後ろの input・commentary・slot_modern は1本ずつ流して通った）
- 自分で決めた点：
  - 予算の上限を引き継ぎ書の仮 4 でなく 20（待ちの上限 NET_QUEUE_MAX と同じ）にした。4 だと、待機画面の間に貯まった待ち（20個）が開始後に縮まらず、試合中ずっと入力が約0.8秒遅れた（e2e で左右の往復の位置がずれ、net.ts の予測の差も増えた）。20 でも、毎tick の処理は最大2個のままで、連打しても平均で通常より速くならない（得をするのは止まっていた分まで）
  - 予算の足し方を「tick ごとに +1」でなく「経過時間 ÷ 50ms」にした（tick がちょうど 50ms なら同じ。サーバーの tick が遅れた時に正常な入力があふれないように）
- 置いた所と理由：
  - F（127.0.0.1 で待ち受け）はやっていない。開発版を http で LAN の IP から開くと、クライアントが `ws://<LAN の IP>:<GAME_PORT>` に直接つなぐ（title.ts）。引き継ぎ書の「LAN から直接つなぐ使い方が1つでもあれば止めて聞く」に当たる。cloudflared（localhost:2567）・vite の proxy・e2e・スマホ実機の手順（https で vite の proxy 経由）は localhost 経由だった
  - tools/loadtest.ts は E2E_HOOKS なしで e2e の部屋を作るので、今のままだと動かない（D の「止めて聞く」）。触っていない
- 本人に要る返事：
  - 開発版で1試合して、操作の体感を見る（引き継ぎ書の「反映の前」）
  - F：http で LAN から開く使い方をやめて 127.0.0.1 にしてよいか（スマホは今の https の手順だけにする）
  - loadtest.ts：子のサーバーに E2E_HOOKS=1 を付けるか（Bot の編成が e2e の固定の編成に変わる）、e2e 以外の目印で部屋を分けるか
  - 予算の上限 20・受信の上限 120 でよいか

## 35 refac1（snapshot・lagcomp・e2e フックの切り出し）
- 済んだこと（night-1128 の c58e8f8）：
  - src/server/snapshot.ts（92行）：sendSnapshots・statusView・classicView・modernView・buffView・arrowView
  - src/server/lagcomp.ts（58行）：noteJump・recordHist・lagT・rewound（hist・jumps は GameRoom に置いたまま）
  - src/server/e2e.ts（95行）：e2e* のメッセージ。messages.ts が E2E_HOOKS の時だけ足す
  - src/shared/protocol.ts にスナップショットの型 Snapshot を足し、組み立てに付けた（クライアントは触っていない）
  - GameRoom.ts は 2193行 → 2076行（sec1 で 2277行 → 2193行）
- 確かめた基準と結果：
  - 送信の中身：固定シードの Bot 戦4試合で、観戦者（全体・陣営0の視点）と各陣営の本人の4つに送った全スナップショット（48016回）のハッシュが切り出しの前後で一致した（照合のスクリプトは使い捨て。コミットしていない）
  - golden 一致・typecheck・test:server（netfix の既存の失敗を除く）・e2e 全体1回 → 通った
- 自分で決めた点：
  - visibleTo・bodySeen・dying は戦闘でも使うので GameRoom に残した
  - verify・skills が呼んでいる sendSnapshots・statusView・classicView・arrowView・noteJump・recordHist・lagT・rewound は、GameRoom に1行の委譲を残した（呼び元を直すより差分が小さい）
  - 型を付けるため GameRoom の Slot・CHold を export にした
  - e2e.ts は静的に読み込み、E2E_HOOKS の時だけ足す。読み込み自体を E2E_HOOKS の時だけにすると、GameRoom・skills との循環の import で止まる恐れがある
- 見つけたもの（直していない）：sendSnapshots の myTeam は使われていない
- 本人に要る返事：なし

## 36 refac2（slot・bot・lobby の切り出し）
- 済んだこと（night-1128 の 0d4a0e6）：
  - src/server/slot.ts（225行）：classicHold〜penaltyModern・mslot（引き継ぎ書の一覧どおり）
  - src/server/bot.ts（191行）：updateBots・botSkillUseful・nearFoe・botStuck・botThink・assistThink・enemyAssist・botFight・botGoto・escorts
  - src/server/lobby.ts（189行）：updateLobby・decideStart・checkBack・promoteSpectators・joinPlayer・spectators・updateAbandon・startPractice・practiceFoe・practiceMode・practicePower・practiceBack と、onAuth・onJoin・onDrop・onReconnect・onLeave の中身（呼び口は GameRoom に1行で残した）
  - docs/add_char.md・.claude/skills/char/SKILL.md の「共通処理」の一覧に切り出したファイルを足した。docs/botai_report.md の botThink の場所を直した（CLAUDE.md には該当なし）
  - GameRoom.ts は 2076行 → 1566行
- 残った責務：試合の進行（setup・tick・開始・決着・ログ）、移動・当たり・ダメージ・撃破、大将・コバコ・壁、徳・資材・回復アイテム・荷物・ウルト、弾、キャラ技（R）の呼び出し、アシストの技（updateAssists）、マクロ soracannon、巻き戻しの記録の置き場（hist・jumps）と委譲
- 確かめた基準と結果：golden 一致・refac1 と同じ送信のハッシュの照合も一致・typecheck・test:server（netfix の既存の失敗を除く）→ 通った。e2e は3回まわして3回目に全部通った。1回目は花丸パンチの向き、2回目はアルの突撃の右向きが落ちた。どちらも 11/24〜25 の e2e でも落ちたことがある、敵 Bot に邪魔されうる確認（サーバーの挙動は golden と送信のハッシュで一致）
- 自分で決めた点：
  - verify・skills・tools から呼ばれているものだけ GameRoom に1行の委譲を残し、GameRoom の中の呼び出しは直接の呼び出しに書き換えた
  - 型と道具を使うため GameRoom の pick・SlotTarget を export にした
  - onCreate は中身を残した（部屋の作成と tick の開始で、待機の処理でないため）。soracannon（scSora・scUpdate・scThink）は引き継ぎ書の一覧に無いので GameRoom に残した
- 本人に要る返事：なし

## 37 refac3（main.ts から net・hud を切り出し、update() を段に分ける）
- 済んだこと（night-1128。段ごとにコミット）：
  - 1段目 d5cc2e5：src/client/net.ts（118行）。接続後の再接続・切断の扱いと全 onMessage（connect）、計測の ping・入力の送信と予測（sendInputs）。's' の受信に protocol.ts の Snapshot の型
  - 2段目 4acc96e：src/client/hud.ts（188行）。rosterHud・buffHud・tokuHud・modernHud・killLog・banner・notify・popup・cutin・staging・practiceHud
  - 3段目 6831c71：update() を upInput・upWalls・upSelf・upUnits・upCamera・upFx・upShots・upGround・upVision・upHud に分けた（処理の順番は同じ）
  - main.ts は 2124行 → 1914行、update() は 481行 → 25行
- 確かめた基準と結果：
  - スクショの前後比較：再生の仕掛けを作った（使い捨て。コミットしていない）。本物のサーバーにつないだ1回目の記録で、届いたフレームと操作を「何コマ目か」と一緒に保存する。比べる時はサーバーにつながず、同じコマに同じフレームを渡し、時計（Playwright の clock）と乱数を固定してコマ送りする。記録は2本：(1) e2e の部屋で待機→選択→開幕→戦闘→スロット当選4回→他キャラのパワーアップ→被撃破のカットイン→復帰→時間切れ→結果、(2) タイトル→練習→自分のパワーアップ→相手を撃破（キルログ）。PC（1920×1080）とスマホ（852×393・DPR3）で、30コマごとと名前付きの場面を撮った（1回 143枚＋45枚）
  - 結果：記録(1)は PC・スマホとも、3つの段のどの後も WebGL の描画数・転送量が基準と全コマで一致した。スクショの差は2〜7枚で、どれも光る枠・浮く数字（DOM の CSS アニメーション。実時間で動くので同じコードでも再生ごとに揺れる）か数ピクセル。記録(2)は、タイトルからゲームへ移る所で描画数が1回分ぶれ、それが後まで残る（同じコードで2回再生しても起きる）。見た目は同じだった
  - ?perf=1 の代わりに WebGL の描画数・転送量を数えた：増えていない（記録(1)で一致）
  - typecheck・test:server（netfix の既存の失敗を除く）・e2e 全体1回 → 通った
- 自分で決めた点：
  - net.ts・hud.ts が使う main.ts の道具（GameScene・$・setCss・TEAM_NAME など）を export にした。net.ts からも呼ぶ notify・killLog・cutin・banner は GameScene に1行の委譲を残した
  - Snapshot の型で fx は any[]（技ごとに中身が違う）。HIT_FX_KIND の me の型を string | null にした（型だけ）
  - 段の分け方は引き継ぎ書の8つに、カメラと地面を足して10にした
- 本人に要る返事：開発版で1試合（PC）と iPhone 実機で1試合（引き継ぎ書の「反映の前」）

## 38 sync1（出来事の時刻合わせ・巻き戻し時刻の検証。残り秒の終了時刻化は保留）
- 済んだこと（night-1128 の e110236）：
  - 1：ko・kill・assist・assistUp・bossHit に at（スナップショットの t と同じ elapsed）を載せた。クライアントは貯めておき、補間の時刻が at に来てから出す（fx と同じやり方）
  - 2：サーバーが毎秒、人間のクライアントへ 'rp' を送り、返事 'rq' までの往復の時間を測る（直近5回）。巻き戻しは「その最大＋NET_INTERP_DELAY（0.2秒）＋NET_REWIND_SLACK（0.1秒、仮置き）」まで、上限は今の 0.35秒のまま。返事をしないクライアントは往復 0 とみなす
- 確かめた基準と結果：
  - 撃破の ko・kill の at が、倒れた絵が載る最初のスナップショットの t と同じ（test:server に追加）→ 通った。クライアントはその t を補間で描く時に出すので、ずれは 0
  - 巻き戻し（netmeasure に追加。片道 10・50・100±50・100±100・200ms のシミュレーション）：常に最大を申告するクライアントでも「測った往復＋0.2＋0.1」を超えない（10ms では 0.35→0.32 秒に抑えた）。正常なクライアントの巻き戻しの平均は、変更前との差が 5ms 以内 → 通った
  - golden 一致・typecheck・test:server（netfix の既存の失敗を除く）・e2e 全体1回 → 通った
- 置いた所と理由：
  - koed（自分がやられた）・recalled（自分の帰還）は変えていない。自キャラは予測で「今」を描き、やられ顔の表示もスナップショットが届いた瞬間に出るので、遅らせると絵より後になる（引き継ぎ書の「迷うものは変えずに報告」）
  - 3（残り秒を終了時刻で送る）はやっていない。cd・skillCd・respawnIn・ult.left・warns の left・buffs は now（試合の時計）で数えている。now は、決着演出のスロー（FINALE.slowRate 倍）と e2e の早送り（k 倍）でスナップショットの時計 elapsed と進み方が変わり、待機・結果の間は止まる。引き継ぎ書の「合わない所があれば止めて報告」に当たる。この分の成功基準（遅延100ms＋揺らぎ50msでクールタイム・復活の表示が逆戻りも飛びもしない）は未確認
- 本人に要る返事：
  - 3 の時計：終了時刻を elapsed で送り、スローと早送りの間だけ残り秒のまま送る形でよいか（または now の時計を送ってクライアントで換算するか）
  - 許容 NET_REWIND_SLACK 0.1秒でよいか
  - 開発版でテストプレイ（引き継ぎ書の「反映の前」）

## 39 sync2 0章（スナップショットの量の計測。ここで止めている）
- 済んだこと（night-1128 の 291c962）：通信の計測（ServerMeasure）に、送ったスナップショットの大きさ（クライアントごと、10tick に1回だけ測る）を足した。項目ごとの内訳を出す tools/snapbytes.ts を作った。送る中身は変えていない
- 計測（tools/snapbytes.ts。固定シードの4vs4、人間の枠1人の操作は Bot に任せ、観戦1人。Colyseus と同じ msgpack の詰め方で測った。2つのシードでほぼ同じ）：
  - 人間の枠：平均 3.2〜3.3 KB・最大 5.0〜5.3 KB／回、毎秒 63〜65 KB（毎秒20回）
  - 観戦：平均 4.1〜4.3 KB・最大 5.4〜5.6 KB／回、毎秒 79〜84 KB
  - 項目の割合：players 50〜52%・materials 12〜14%・roster 12〜13%・teams 6%・items 3%・残りはそれぞれ 2% 未満
  - players の中：項目がほぼ均等に3〜5%ずつ（項目の名前の文字も毎回送っている分が大きい）。char・assist・cdMax なども毎回それぞれ3〜4%
- 効果の目安（人間の枠）：変わった時だけ送る候補（roster・bossRooms・broken・materials・items と、players の char・team・bot・assist・tier・maxHp・cdMax）を抜くと約42%減。敵向けの候補（skillCd・cd・aim・tgt・spd・ack・bad）を抜いても約2%減（人間の枠に届く players のうち敵の分は20〜24%）
- 読み取り：1章（静的・動的に分ける）は効果が大きい。2章（敵向けに絞る）は量の効果は小さく、目的は改造クライアント対策（敵のクールタイムが見えない）になる
- 確かめた基準：golden 一致・typecheck・test:server（netfix の既存の失敗を除く）・e2e 全体1回 → 通った
- 本人に要る返事：1章・2章へ進むか

## 朝の確認の手順
- 開発版（night-1128）の起動：
  - `cd ~/kiritan_zunda_proto/.claude/worktrees/night-1128 && GAME_PORT=2601 CLIENT_PORT=5201 npm run dev` → PC で http://localhost:5201/
  - iPhone は docs/mobile_device_test.md の手順で worktree に certs/ を作ってから `HTTPS=1 GAME_PORT=2601 CLIENT_PORT=5201 npm run dev`（今は certs/ が無い）
- PC で見ること：
  - 1試合して、操作の体感（sec1 の入力の予算）を見る
  - 撃破のカットイン・キルログが撃破の絵と同じ時に出るか（sync1）
  - 表示の崩れが無いか（refac3）
  - 結果画面 → 待機 → 次の試合も1回
- iPhone で見ること：1試合して、表示の崩れ・操作（refac3）
- 境目のコミット（night-1128、main の 0b82b36 から積んだ順）：
  - 34 sec1 d752404
  - 35 refac1 c58e8f8
  - 36 refac2 0d4a0e6
  - 37 refac3 d5cc2e5（1段目）・4acc96e（2段目）・6831c71（3段目）
  - 38 sync1 e110236
  - 39 sync2 0章 291c962
- 全体：
  - タグ・反映はしていない。公開サーバー・live・launchd・cloudflared には触っていない。golden の --write もしていない
  - verify/netfix.ts の「stopped-out」は main でも落ちる元からの失敗で、test:server がそこで止まる（後ろの3本は1本ずつ流して通した）
  - worktree に、コミットしていない使い捨ての検証（verify/_snaphash.ts＝送信のハッシュの照合、verify/_replay.ts＝クライアントの記録・再生の比較）を置いてある
