夜間：35 まで済み。本人の返事が要るもの 10 件

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

## 朝の確認の手順
（夜間の作業が進んだら書き足す）
