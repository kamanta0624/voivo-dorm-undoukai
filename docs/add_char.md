# キャラ追加・技差し替えの手順

共通処理（`src/server/GameRoom.ts`・`src/client/main.ts`・`src/shared/geom.ts`・`src/shared/config.ts`）は触らない。キャラごとの値と処理は下の表に乗せる。

## 触るファイルと項目

| ファイル | 項目 | 追加 | 技の差し替え |
|---|---|---|---|
| `src/shared/chars.json` | `name`・`dir`（立ち絵フォルダ）・`select`・`ko`・`koed`（表情。null はグレー化してずり落ちる）。大将だけ `boss` | 1行 | ― |
| `src/shared/chars.ts` | `CHARS` に1項目: `role`・`walk`・`aa`（通常攻撃のモード）・`mult`・`melee`・`toku`・`skill`（`name`・`ct`・技の値） | 1項目 | `skill` を書き換え |
| `src/server/skills/<key>.ts` | 技処理（下の「呼び口」）。`export default` で `Skill` を返す | 新規 | 書き換え |
| `src/server/skills/index.ts` | `import` と `MODS` に1つ | 2行 | ― |
| `src/client/skills/<key>.ts` | 状態・場の物の描画、技のエフェクトの色。描画が要るときだけ | 必要なら新規 | 書き換え |
| `src/client/skills/index.ts` | `import` と `MODS` に1つ（描画の重なり順の位置に） | 必要なら2行 | ― |
| `tools/make_dot.py` | `CHARS`（PSDの名前の頭・脚・固有差分）と `WAIST`（腰 01/02/None）。技の見た目に追加のコマが要るときは `EYES_ONLY`（目レイヤーだけのコマ）など | 各1項目 | 必要なら1項目 |

追加したら素材を作る（ドット・立ち絵・map.json。システムの python3 には psd_tools・PIL がない）:

```
PY=~/MCP_Learning/image_gen_mcp/.venv/bin/python npm run assets
```

選択画面のキャラは chars.json の `boss` のないキャラ（`PICKABLE`）。並びは chars.json の順。

## 性能定義（chars.ts）

- HP・移動・攻撃の実数値は書かない。共通の基本値（config.ts）× `ROLES[role]` × `MELEE_BONUS`（`melee` のとき）× `mult` を `charHp`・`charSpeed`・`charAtk` が算出する
- `aa`: 通常攻撃のモードの配列。使えるモードのうち最後のものを使う。`kind`: `melee`（前方の扇形）／`shot`（弾。`shot` に弾の種類、`speed` に弾速）。`dmg`: ダメージ倍率、`cd`: 間隔、`range`: 射程、`far`: 対象がこれより遠い（対象なしを含む）ときだけ使う。省略時は近接1モード
- `walk`: `'normal'`（歩きの2コマを交互）／`'hover'`（移動中は歩きの1コマ目で固定、止まると棒立ち）
- `skill`: `name`・`ct` は共通処理が使う（技名表示・CT）。ほかの値は自分の技処理だけが使う
- 秒数・ダメージ・距離など技の値は `skill` に置く（技処理の中に数値を書かない）
- 表示用ステータスは `charStats(key)` が自動で出す（閾値は `STAT_STEPS`）

## 技処理の呼び口（server/skills の `Skill`）

| 呼び口 | いつ | 必須 |
|---|---|---|
| `use(room, p, a)` | R で発動（`a` は技の向き）。CT は共通処理が入れる。`false` を返すと入れない（2段階の技などで、技処理が後で `p.skillReadyAt` を入れる） | ○ |
| `botUse(room, p)` | Bot が今使う価値があるか | ○ |
| `afterMove(room, p, dt, px, py, locked)` | 毎tick、移動の直後 | |
| `tick(room, p, dt)` | 毎tick、ウルトの時間切れ・状態の回復の後、オートアタックの前 | |
| `ended(room, p, dt)` | 結果画面の毎tick（ダメージ・壁の破壊は起きない） | |
| `botMove(room, p, to, obs)` | Bot の見回りの移動中（true なら移動しない） | |
| `attack(room, p, a)` | 通常攻撃（Space・オートアタック）の上書き。true を返すと通常の攻撃をしない（CT は通常どおり入る） | |
| `statuses` | この技が付ける状態の key の一覧（移動倍率を掛ける順になる） | 状態を付けるとき |
| `ents` | この技が出す場の物の種類: `{ update(room, e, dt), fog }` | 場の物を出すとき |

使える道具（`room` の）: `hitThing`・`inCircle`・`inRectAhead`・`inArc`・`enemyThings`・`reach`・`nearFoe`・`push`・`breakWalls`・`shoot`・`addFx`・`addToku`・`aimOf`・`moveIntent`・`speedOf`・`stat`・`effect`・`targetable`・`pickTarget(p, 射程)`・`attack`・`skill`・`removeEnt`・`bodies`・`obstacles`・`cageOf` ほか。

- 敵を狙う技（ロックオン・追尾・狙う先の選択）は `room.targetable(t)` で絞る（敵の対象にならない状態を除く）。範囲攻撃は絞らない
- 結果画面でも技は使える（`ended` がない技は状態が残り続けるので、動く技は `ended` でも同じ処理を呼ぶ。ダメージ・壁の破壊は `room.phase === 'ended'` で止める）

## 状態（status）

- 状態の key・場の物の種類は全キャラで重ねない（既存の技を複製したときは付け替える。重なると移動倍率が二重に掛かる）
- 付ける: `q.st.<key> = { until: room.now + 秒, <効果>: 値 }`。他人にも自分にも同じ形で付ける。値は自分の技の定義から渡す
- 効果（共通処理が見る）: `speed`（移動倍率）・`regen`（毎秒回復）・`noSkill`（技不可）・`lock`（移動不可）・`noAttack`（攻撃不可）・`invincible`（無敵。敵の状態も付かない）・`noPush`（はじき無効）・`cancel`（KO・試合終了で消える）・`hidden`（敵の対象にならない: オートアタック・Bot・追尾・ロックオン・大将の反撃）・`fragile`（被弾で即死）・`noAuto`（オートアタックしない。Space は `attack` 呼び口へ）
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

## 新しい状態の効果・呼び口が要るとき

共通処理に呼び出し1行＋型に1項目だけ足す。

- 状態の効果: `GameRoom.ts` の `Status` 型に1項目、その効果を見る共通処理に `this.effect(p, '<効果>')` を1行
- 呼び口: `server/skills/index.ts` の `Skill` 型に1項目、`GameRoom.ts` の呼ぶ場所に `SKILLS[p.char]?.<呼び口>?.(this, p, ...)` を1行
- 描画の呼び口: `client/skills/index.ts` の型に1項目、`main.ts` の呼ぶ場所に1行

## 確認

- `npm run typecheck`、`npm run test:server`（技を足したら verify/server.ts に検証を足す）
- 既存キャラの挙動を変えていないか: `npx tsx verify/golden.ts`（仕様を変えたときは `--write` で取り直す）
- `E2E_HOOKS=1 npm run dev` で起動し、選択・技の発動を見る。e2e は `npx tsx verify/e2e.ts`
- `npm run share` で公開中は 2567・5173 を使わない。`GAME_PORT=2568 CLIENT_PORT=5174 E2E_HOOKS=1 npm run dev` で別ポートに起動し、e2e・スクショも `GAME_PORT=2568 CLIENT_PORT=5174 npx tsx verify/e2e.ts`（verify/lib.ts が同じ変数に従う）。止めるのは自分が起動したプロセスだけ
- 技の判定を変えるとき: 変更前に、そのキャラを含まない編成の golden を取っておき、変更後も一致することを確かめてから verify/golden.txt を取り直す
