# キャラ追加・技差し替えの手順

共通処理（`src/server/GameRoom.ts`・`src/client/main.ts`・`src/shared/geom.ts`・`src/shared/config.ts`）は触らない。キャラごとの値と処理は下の表に乗せる。

## 触るファイルと項目

| ファイル | 項目 | 追加 | 技の差し替え |
|---|---|---|---|
| `src/shared/chars.json` | `name`・`dir`（立ち絵フォルダ）・`select`・`ko`・`koed`（表情。null はグレー化してずり落ちる）。大将だけ `boss` | 1行 | ― |
| `src/shared/chars.ts` | `CHARS` に1項目: `role`・`stat`（`hp`・`atk`・`speed`・`vision`）・`walk`・`aa`（通常攻撃のモード）・`toku`・`skill`（`name`・`ct`・技の値） | 1項目 | `skill` を書き換え |
| `src/server/skills/<key>.ts` | 技処理（下の「呼び口」）。`export default` で `Skill` を返す | 新規 | 書き換え |
| `src/server/skills/index.ts` | `import` と `MODS` に1つ | 2行 | ― |
| `src/client/skills/<key>.ts` | 状態・場の物の描画、技のエフェクトの色。描画が要るときだけ | 必要なら新規 | 書き換え |
| `src/client/skills/index.ts` | `import` と `MODS` に1つ（描画の重なり順の位置に） | 必要なら2行 | ― |
| `tools/make_dot.py` | `CHARS`（PSDの名前の頭・脚・固有差分）と `WAIST`（腰 01/02/None）。技の見た目に追加のコマが要るときは `EYES_ONLY`（目レイヤーだけのコマ）など | 各1項目 | 必要なら1項目 |

足のないキャラは make_dot.py の `CHARS` の脚を `None` にする（脚は空レイヤー `*dummy`。例: ユーレイちゃん）。

追加したら素材を作る（ドット・立ち絵・map.json。システムの python3 には psd_tools・PIL がない）:

```
PY=~/MCP_Learning/image_gen_mcp/.venv/bin/python npm run assets
```

選択画面のキャラは chars.json の `boss` のないキャラ（`PICKABLE`）。並びは chars.json の順。

## 性能定義（chars.ts）

- HP・攻撃（通常攻撃の基本値）・移動(px/秒)・視界(px)は `stat` に実数で書く（`charHp`・`charAtk`・`charSpeed`・`visionRadius` はこれを返すだけ）。ロールの倍率・近接補正は 2026-11-22 speed1 で廃止。`role` はロール固有の効果（balance の孤立時軽減・defense の軽減・attacker の大将×2）と選択画面のロール表示に使う
- `aa`: 通常攻撃のモードの配列。使えるモードのうち最後のものを使う。`kind`: `melee`（前方の扇形）／`shot`（弾。`shot` に弾の種類、`speed` に弾速）。`dmg`: ダメージ倍率、`cd`: 間隔、`range`: 射程、`far`: 対象がこれより遠い（対象なしを含む）ときだけ使う。省略時は近接1モード
- `walk`: `'normal'`（歩きの2コマを交互）／`'hover'`（移動中は歩きの1コマ目で固定、止まると棒立ち）
- `aa` の `fx`: 近接の通常攻撃の斬撃を、client/skills の `fx.<fx>` の描画に差し替える（判定は変わらない。例: イタコのキツネ `kitsune`）
- `ghost: true`: 壊せる壁をすり抜けて移動する（移動の壁が外周だけになる）。共通処理は `moveWalls(char, walls)` で移動の壁を引く（サーバーの移動・押し出し・Bot の経路探索、クライアントの移動予測）。弾・視界・他キャラは変わらない
- `skill`: `name`・`ct` は共通処理が使う（技名表示・CT）。ほかの値は自分の技処理だけが使う
- 秒数・ダメージ・距離など技の値は `skill` に置く（技処理の中に数値を書かない）
- 表示用ステータスは `charStats(key)` が自動で出す（閾値は `STAT_STEPS`）

## 技処理の呼び口（server/skills の `Skill`）

| 呼び口 | いつ | 必須 |
|---|---|---|
| `use(room, p, a)` | R で発動（`a` は技の向き）。CT は共通処理が入れる。`false` を返すと入れない（2段階の技などで、技処理が後で `p.skillReadyAt` を入れる） | ○ |
| `release(room, p)` | R・技ボタンを離した（押している間タメる技。クライアントは離すと `skillUp` を送る。例: 花丸パンチ） | |
| `botUse(room, p)` | Bot が今使う価値があるか | ○ |
| `afterMove(room, p, dt, px, py, locked)` | 毎tick、移動の直後 | |
| `tick(room, p, dt)` | 毎tick、ウルトの時間切れ・状態の回復の後、オートアタックの前 | |
| `ended(room, p, dt)` | 結果画面の毎tick（ダメージ・壁の破壊は起きない） | |
| `botMove(room, p, to, obs)` | Bot の見回りの移動中（true なら移動しない） | |
| `attack(room, p, a)` | 通常攻撃（Space・オートアタック）の上書き。true を返すと通常の攻撃をしない（CT は通常どおり入る） | |
| `statuses` | この技が付ける状態の key の一覧（移動倍率を掛ける順になる） | 状態を付けるとき |
| `ents` | この技が出す場の物の種類: `{ update(room, e, dt), fog }` | 場の物を出すとき |

使える道具（`room` の）: `hitThing`・`inCircle`・`inRectAhead`・`inArc`・`enemyThings`・`reach`・`nearFoe`・`push`・`breakWalls`・`shoot`・`addFx`・`addToku`・`aimOf`・`moveIntent`・`speedOf`・`stat`・`effect`・`targetable`・`pickTarget(p, 射程)`・`attack`・`skill`・`removeEnt`・`bodies`・`obstacles`・`cageOf` ほか。

相手との当たりは体の箱（hitbox1）で測る。`t.x, t.y, t.r`（足元の円）で直接測らず、点や円との距離は `room.bodyDist(t, x, y)`（≦ 半径なら当たり）、扇・長方形など円以外の形は `room.bodyCircles(t)` の円のどれかと重なるかで判定する。狙う向きは `room.aimAt(p, t)`（撃つ側の体の中心→相手の体の箱の中心）。`room.shoot` の弾は撃つ側の体の中心の高さを飛び（`up`）、壁は真下の床で当たる。場の物の飛び道具が壁を見る時は床の位置で見る（イタコの狐火の `ground` が手本）

- 敵を狙う技（ロックオン・追尾・狙う先の選択）は `room.targetable(t)` で絞る（敵の対象にならない状態を除く）。範囲攻撃は絞らない
- 結果画面でも技は使える（`ended` がない技は状態が残り続けるので、動く技は `ended` でも同じ処理を呼ぶ。ダメージ・壁の破壊は `room.phase === 'ended'` で止める）

## 状態（status）

- 状態の key・場の物の種類は全キャラで重ねない（既存の技を複製したときは付け替える。重なると移動倍率が二重に掛かる）
- 付ける: `q.st.<key> = { until: room.now + 秒, <効果>: 値 }`。他人にも自分にも同じ形で付ける。値は自分の技の定義から渡す
- 効果（共通処理が見る）: `speed`（移動倍率）・`cd`（通常攻撃の間隔の倍率。アシストには掛けない）・`regen`（毎秒回復）・`noSkill`（技不可）・`lock`（移動不可）・`noAttack`（攻撃不可）・`invincible`（無敵。敵の状態も付かない）・`noPush`（はじき無効）・`cancel`（KO・試合終了で消える）・`hidden`（敵の対象にならない: オートアタック・Bot・追尾・ロックオン・大将の反撃）・`fragile`（被弾で即死）・`noAuto`（オートアタックしない。Space は `attack` 呼び口へ）
- 期限のない状態（`until: Infinity`）は技処理が `delete p.st.<key>` で消す
- `view: () => 値` を付けると、その値がスナップショットで送られる（なければ `true`）。クライアントは `p.st.<key>` で受け取る
- 技固有のデータ（向き・当てた相手など）は `p.sk` に置く
- 技の fx（`room.addFx`）を技ごとに描くときは、fx に技固有の `color`（例: `dance`・`blizzard`）を付け、client/skills の `fx.<color>` に `{ ms?, draw(g, f, time, k, s) }` を書く（共通の形の描画の代わりになる。k は 0→1 の経過）。color を付けるだけなら判定・数値は変わらない
- 弾の見た目は client/skills の `shots.<弾の種類>` に `(g, sh, time)` を書く（共通の弾の描画の代わり）
- 描画: client/skills の `status.<key>` に `mark`（ユニットの描画中。足元の目印・スプライトの表示・点滅）・`fx`（技のエフェクトの層）・`hud`（技ボタンの文字）・`frame`（その間スプライトをこのコマに差し替える。歩き・瞬きもしない）・`bare`（足元の陣営色・HP・目印を出さず、敵のミニマップにも出さない）
- 追加のコマは client/skills の `frames` に書く（`assets/gen/dot/<key>/<コマ>.png` を読み込む）
- 状態はスナップショットの今の値、スプライトは補間で `NET_INTERP_DELAY` 秒遅れて動く。動きに合わせる描画（残像など）は、状態を見てからその分長く続ける（client/skills/bii.ts）

## 場の物（ent）

- 出す: `room.ents.push({ id: room.nextId++, kind, team, owner, x, y, r, body, hp?, ...種類ごとの値 })`
- `body`: `'unit'`（ユニット扱い: 自動照準の優先・はじき可・壁から押し出す）／`null`（攻撃対象にならない。弾・ホーミング弾など）
- 更新は `ents.<kind>.update`（種類ごと、index の順）。`fog: true` なら敵の視界の外では送らない
- 狙った敵を追う物は id（`thingId`）で持ち、毎tick `enemyThings` から引き直す（倒れた・対象にならない状態になったら外れる。client/skills/kiritan.ts のホーミング弾）
- 描画: client/skills の `ents.<kind>` に `{ layer: 'ground' | 'fx', draw(g, e, time, 陣営色) }`
- スナップショットで送るのは id・kind・team・x・y・r・body・hp・a と `v`（描画用の値。技処理が `e.v` に入れる。例: ビィの予約の位置）。大きさは `r` を描画に使う（花丸パンチのタメのレベル）
- ドットの画像を ent で描くときは `draw` の中で `g.scene.add.image` を作って id で持ち、client/skills の `frame` で見えなくなったものを消す（client/skills/bii.ts の残像）

## 技が共通処理に影響するとき（chars3 で足したもの）
- 大将の拠点移動を止める: `Boss.holdUntil` に時刻を入れると、その時刻まで拠点移動（予告・無敵）を始めない（そらのビーム）
- はじかれない相手: `room.heavy(t)`（アシストの `heavy`）。`room.push` は効かない。はじく技で逆にはじかれる動きは技処理で書く（めたんのドリル）
- アシストごとの倍率: config の `ASSIST.units.<key>` の `hpMult`・`speedMult`。アシストの技は GameRoom.ts の `updateAssists`（予告に `push`・`color` を付けられる）

## 新しい状態の効果・呼び口が要るとき

共通処理に呼び出し1行＋型に1項目だけ足す。

- 状態の効果: `GameRoom.ts` の `Status` 型に1項目、その効果を見る共通処理に `this.effect(p, '<効果>')` を1行
- 呼び口: `server/skills/index.ts` の `Skill` 型に1項目、`GameRoom.ts` の呼ぶ場所に `SKILLS[p.char]?.<呼び口>?.(this, p, ...)` を1行
- 描画の呼び口: `client/skills/index.ts` の型に1項目、`main.ts` の呼ぶ場所に1行

## 確認

- `npm run typecheck`、`npm run test:server`（技を足したら verify/server.ts に検証を足す）
- 既存キャラの挙動を変えていないか: `npx tsx verify/golden.ts`（仕様を変えたときは `--write` で取り直す）
- `E2E_HOOKS=1 npm run dev` で起動し、選択・技の発動を見る。e2e は `npx tsx verify/e2e.ts`
- 新キャラは verify/golden.ts の `MATCHES` に、そのキャラを含む試合を1つ足してから `--write` する（既存の試合のハッシュが変わらないことを先に確かめる）
- 実況: 台本（src/shared/commentary_script.json）の `parts.char`・`parts.skill` に名前と読みを足し、`npm run cm:vvproj`（VOICEVOX エンジンを起動しておく）。音声（cm:audio）は調声の後。音声のない部品は字幕だけ出る
- 公開中（launchd の com.vvsports.game、https://vv.club-daiman.com）は 2567・5173 を使わない。`GAME_PORT=2568 CLIENT_PORT=5174 E2E_HOOKS=1 npm run dev` で別ポートに起動し、e2e・スクショも `GAME_PORT=2568 CLIENT_PORT=5174 npx tsx verify/e2e.ts`（verify/lib.ts が同じ変数に従う）。止めるのは自分が起動したプロセスだけ
- 技の判定を変えるとき: 変更前に、そのキャラを含まない編成の golden を取っておき、変更後も一致することを確かめてから verify/golden.txt を取り直す
- アシストを足すと召喚の抽選（`ASSIST.units` からランダム）が変わり、アシストが出る試合の golden は変わる。足したアシストを抽選から外すと一致することで確かめる
- 時刻の比較: テストは `now += 0.05` を重ねるので、「n 秒たったら」の判定は `>= t - 1e-9` にする（誤差で1tick遅れる）
- 検証の行に `//` のコメントを書くと、同じ行のあとの文が消える（1行に複数の文を書いているので、コメントは行末に）
