# Code引き継ぎ：キャラ雛形化（情報と処理の整理）v3
対象：~/kiritan_zunda_proto（c680d72 時点の実装をChat側で通読して改訂）
前提：handoff_tuning2.md 実装済み
目的：キャラ追加・技変更を「素材対応1行＋性能定義1項目＋技処理（サーバー・クライアント各1ファイル）」で済ませる。共通処理（GameRoom.ts・main.ts・geom.ts）は触らない
順番：本書 → handoff_chars1.md → handoff_select_ui.md
最優先：挙動を変えない。迷ったら整理より現行挙動を優先し、止めて聞く

## 0. 着手前に基準を取る（整理前のコードで）
1. `npm run typecheck`、`npm run test:server`、verify/e2e.ts の結果を保存
2. verify/golden.ts を新規作成：Math.random を固定シードの擬似乱数に差し替え、Botだけの4vs4を通信なしで回す。プレイアブル10キャラ全員が出る編成で2試合（陣営を入れ替え）、試合内120秒。毎秒、全プレイヤーの位置・HP・生死・技CT、両大将HP、両陣営の徳、壊れた壁の数を1行に出し、全行のハッシュを記録。整理前の値を verify/golden.txt に保存
3. 10キャラそれぞれの技発動中のスクショ（verify/evidence/before/）
4. Bot戦3試合の時間・決着内訳

## 1. 現状の散在箇所
### 定義
| 場所 | 内容 |
|---|---|
| shared/chars.json | 名前・立ち絵dir・表情・role・boss。tools/import_tachie.py（Python）も読む |
| tools/make_dot.py | CHARS・WAIST（PSDレイヤー対応）。大将・コバコ・アシストも含む |
| config.ts | SKILLS、RANGED、KIRITAN、MELEE_EXCLUDE、BREAKERS、TOKU_CHAR、TRAP_RADIUS、ARU_FX、BOT_WALLBREAK_SAVE／CHECK、roleOf／visionRadius |
| main.ts | SKILL_FX_COLOR、PICKABLE／BOSS_CHAR の算出（GameRoom.ts にも同じ算出） |

### サーバー（GameRoom.ts。キャラ key・S.xxx・K 参照が約55行）
| 種類 | 箇所 |
|---|---|
| ステータス算出 | maxHp、speedOf、atkRange、atkCooldown、attack（きりたんの包丁／砲の切替、RANGED）、hitThing（attacker・BREAKERS）、damagePlayer（role） |
| 技の発動 | skill() の switch（10キャラ） |
| 毎tick | updatePlayers 内：アル突撃のタメ→突撃（dashStep）、小夜の乱舞、あいえるたん加速の回復、花丸の押し込み（hanamaruPush）。updateEnded にも同じものの見た目だけ版 |
| 技の状態（Player の専用フィールド12個） | danceUntil、danceNext、mochiUntil、accelUntil、flyUntil、chargeAt、chargeA、dashUntil、dashHit、dashBroke、pushTile／pushAt、wallCheckAt |
| 状態を読む共通処理 | 移動不可（locked）、攻撃不可、無敵（damagePlayer）、はじき無効（push）、ずんだアロー無効、技不可（mochi）、速度倍率4種 |
| 場の物 | fists／funnels／traps の配列・型・update関数、Thing の 'f'・'trap'、enemyThings、unstick、bodies、push、矢（arrow）の命中効果 |
| Bot | botSkillUseful の switch、botWallBreak（花丸専用）、BREAKERS のバリケード優先 |
| 通信 | スナップショットの mochi／accel／dance／fly／charge／dash、funnels／traps／fists |

### クライアント・共有
- main.ts：技名・CT表示、射程円と斬撃判定（C.RANGED）、状態の目印（mochi／accel／dance／fly／charge点滅）、アル突撃の警告・渦・煙、ファンネル・拳・罠・弾の描画、設置プレビューのファンネル半径
- geom.ts：inDashShape が CONFIG.SKILLS.aru を直読み

### 検証コード
- verify/server.ts：C.SKILLS／KIRITAN／RANGED／MELEE_EXCLUDE／BREAKERS／TOKU_CHAR の参照16行、Player の技フィールド直読み（skillReadyAt 19、dashUntil 7、chargeA 4 ほか）、r.updateTraps／updateFists／updateFunnels／botSkillUseful の直呼び
- verify/e2e.ts：chars.json の name、スナップショットの mochi／charge／dash／fists
- → verify は参照先の書き換えが必要（成功基準15）

## 2. 設計の骨子（プレーンなオブジェクト＋関数表。継承なし）
### ファイル
- shared/chars.json：素材・表示の対応表のまま（name・dir・select・ko・koed・boss）。Python と共有するため JSON を維持。role は性能定義へ移す
- shared/chars.ts（新規）：キャラ key → 性能定義。roleOf・visionRadius・PICKABLE・BOSS_CHAR・ステータス算出・表示用ステータスもここ
- server/skills/<key>.ts＋index.ts：キャラ key → 技処理
- client/skills/<key>.ts＋index.ts：キャラ key → 描画
- 依存の向き：config.ts ← chars.ts ← skills。config.ts は chars を import しない

### 性能定義の項目
- role（なし可。きりたんは現行どおり role なし）
- walk：歩行タイプ。現状 'normal' のみ。クライアントは1か所で参照
- aa：通常攻撃のモードの配列。各モード＝表示名（例：包丁／きりたん砲。既定「近接」）・種別（近接／弾）・射程・間隔・ダメージ倍率・弾の種類と速さ・使う条件（対象までの距離）。きりたん＝包丁と砲の2モード、ずん子＝弾1モード、ほか＝近接の既定値
- mult：キャラ固有の倍率（きりたんの移動0.8）
- melee：近接補正（MELEE_BONUS）の対象か。breaker：壊し屋か。toku：徳初期補正（既定0）
- skill：技名・CT・技パラメータ（旧 SKILLS の中身。花丸のBot壁破壊の閾値、アルのFX定数、罠の半径も各キャラへ）
- HP・移動・攻撃の実数値は定義に書かない。共通基本値×ROLES×MELEE_BONUS×mult を chars.ts の関数で算出（ロール調整が全キャラに効く現行の性質を保つ）

### 状態（status）の共通機構
- Player の技専用フィールドを廃し、共通の状態表にする：状態 key → 期限＋効果（移動倍率・毎秒回復・技不可・移動不可・攻撃不可・無敵・はじき無効 など現行にある効果だけ）
- 他人に付く状態（ずんだ餅・加速）も自分に付く状態（乱舞・飛行・突撃のタメ／突撃中）も同じ表。効果の値は付与する側の技パラメータから渡す
- 共通処理は効果フラグだけを見る。キャラ key も状態 key も見ない
- スナップショットは有効な状態 key の一覧（＋描画に要る値）を送る。クライアントは状態 key → 描画関数の表で目印を描く
- 状態に付随する技固有のデータ（突撃の方向・当てた相手など）は技処理側の持ち物として Player 配下の1か所にまとめる

### 場の物（ent）の共通機構
- fists／funnels／traps を1つの配列にまとめる：種類 key、陣営、持ち主、位置、半径、HP（任意）、攻撃対象になるか、ユニット扱い（自動照準の優先・はじき可）か構造物扱い（壊し屋倍率）か
- 種類 key → 更新関数（サーバー）／描画関数（クライアント）の表。enemyThings・unstick・bodies・視界フィルタ・スナップショットは配列を一律に扱う
- 弾（bullet／cannon／arrow）は通常攻撃の共通機構として残す。命中時の追加効果（矢→ずんだ餅）は発射側が渡す
- バリケード・コバコ・大将・アシストは対象外（キャラ技ではない）

### 技処理の呼び口（現行に存在する処理ぶんだけ。使わない呼び口は作らない）
- 発動／毎tick（移動直後と、その後の2点が現行にある。処理順を保てる最小の点数にする）／結果画面での毎tick／Botの使用判定／Botの移動中判定（花丸の壁破壊）
- 技処理は GameRoom の既存の道具（hitThing、inCircle、inRectAhead、push、breakWalls、shoot、addFx ほか）を引数の room 経由で使う

## 3. 成功基準
### A. 定義
1. キャラ別の値は chars.json（素材・表示）と chars.ts（性能）だけにある。config.ts の SKILLS・RANGED・KIRITAN・MELEE_EXCLUDE・BREAKERS・TOKU_CHAR・TRAP_RADIUS・ARU_FX・BOT_WALLBREAK_* は削除
2. 全キャラ共通の定数（ROLES、MELEE_BONUS、ATTACK_*、BOT_SKILL_SENSE 等）は config.ts に残す
3. PICKABLE・BOSS_CHAR・roleOf・visionRadius の算出は chars.ts の1か所。サーバー・クライアントの重複を削除
4. tools/import_tachie.py は無変更で動く。tools/make_dot.py は変更しない

### B. 処理
5. GameRoom.ts・main.ts・geom.ts・config.ts にキャラ key・技固有の状態 key・場の物の種類 key の直書きがない（grep で 0。残す場合は理由つきで報告）
6. Player 型・addPlayer の初期化・スナップショットの組み立てに、特定キャラの技専用の項目がない
7. 掛け算の順序と1tick内の処理順は現行と同じ（浮動小数の差、資材拾いと突撃の前後などを変えない）

### C. 表示用ステータス（shared/chars.ts）
8. キャラ key → 表示用ステータスを返す関数。元の値はサーバーと同じ算出関数から取る
   - キャラ単位（各1〜5段階）：HP＝最大HP、速度＝移動速度、技CT＝短いほど高段階
   - 通常攻撃のモード単位（モードごとに各1〜5段階、表示名つき）：攻撃＝そのモードの秒間ダメージ、射程＝そのモードの射程
   - 2モード持ち（きりたん：包丁／きりたん砲）は攻撃・射程が2組返る。選択画面で2本並べて表示する（handoff_select_ui.md）
9. 閾値は定数。現行10キャラ（モード別の値を含む）で各項目が3段階以上に分かれる値にし、10キャラの表を報告

### D. 手順書
10. docs/add_char.md：キャラ追加・技差し替えで触るファイルと項目の一覧（chars.json、chars.ts、server/skills、client/skills、各 index、tools/make_dot.py の CHARS・WAIST、`npm run assets`）。新しい状態の効果・呼び口が要るときの足し方（共通処理に呼び出し1行＋型に1項目）も書く

### 検証
11. verify/golden.ts のハッシュが整理前（golden.txt）と一致。不一致は原因を特定し、意図しない差は直す。直せない差は止めて聞く
12. `npm run typecheck` が通る
13. verify/server.ts・net.ts・input.ts・e2e.ts が通る
14. 10キャラの技スクショを整理前後で並べ、見た目が同じ
15. verify の変更は参照先の書き換えだけ（C.SKILLS.x → 新定義、技フィールド・update関数の新しい呼び口）。期待値と検証内容は変えない。書き換えた行数を報告
16. Bot戦3試合が最後まで動く。時間・決着内訳を整理前と並べて報告
17. docs/add_char.md の手順だけでダミーキャラ（既存キャラの複製＋名前変更。素材生成も手順どおり）を追加して起動・選択・技発動できる。確認後、ダミーと生成した素材フォルダを削除
18. 新旧の行数（GameRoom.ts・main.ts・config.ts・新規ファイル）を報告

## 4. 直さず報告だけする既知の不一致（挙動を変えないため）
- クライアントの射程円が C.RANGED だけを見ており、きりたん（砲260）とウルト変身中の射程が反映されない
- 斬撃エフェクトの判定も C.RANGED だけで、きりたんの砲でも斬撃が出る
- ほかに見つけた不一致も同じ扱い

## 5. chars1 で必要になる拡張点（本書では実装しない。塞がない構造にするだけ）
- 2段階発動とCT開始の制御（きりたん全弾斉射）。現行は発動と同時に共通処理がCTを入れる
- 通常攻撃入力の上書き（ひまりの鎌）、対象にならない・被弾時の処理という新しい状態効果（ひまり透明化）
- 歩行アニメの抑止（ひまりのジャンプ）、歩行タイプ追加（もち子ホバー）
- ホーミング弾（場の物として追加できること）
- バリケードと罠は chars1 で廃止される。本書では現行どおり動かす（breaker・構造物扱いも現行どおり残す）

## 不明なら止めて聞く
- 状態・場の物の共通機構に乗らない、キャラ間で絡み合った処理がある場合
- golden のハッシュが合わず原因が特定できない場合
- 作業量が想定を大きく超え、分割したほうがよい場合（分割案：状態 → 技の表引き → 場の物 → クライアント）

## 禁止
範囲外の変更、クラス継承階層、使われない呼び口・項目の先回り実装、素材の加工、tools/make_dot.py の変更、既知の不一致の修正
