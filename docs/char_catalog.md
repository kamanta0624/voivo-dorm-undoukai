# キャラ一覧（何がどう組み合わさっているか）

キャラの追加・修正のたびに更新する（`.claude/skills/char/SKILL.md`）。手順は `docs/add_char.md`。数値の正は `src/shared/chars.ts`。

## 置き場所
| 何 | どこ |
|---|---|
| 素材・表示の対応（名前・立ち絵） | `src/shared/chars.json` |
| 性能定義（role・stat（HP・攻撃・移動・視界）・歩行・通常攻撃・技の値） | `src/shared/chars.ts` の `CHARS` |
| 技処理（サーバー） | `src/server/skills/<key>.ts`、登録は `index.ts` の `MODS` |
| 技の描画（クライアント） | `src/client/skills/<key>.ts`、登録は `index.ts` の `MODS` |
| ドットのPSD対応 | `tools/make_dot.py` の `CHARS`・`WAIST`・`EYES_ONLY` |
| 生成素材（git管理外） | `public/assets/gen/dot/<key>/`、`public/assets/gen/tachie/<key>/` |
| 検証 | `verify/server.ts`（技ごとの検証）、`verify/golden.ts`（全キャラのBot戦のハッシュ） |

## 性能
HP・攻撃・移動・視界の実数は各キャラの `stat` に直接書く（2026-11-22 speed1 でロール・近接補正の倍率を焼き込み。role はロール固有の効果と選択画面のロール表示だけ）。選択画面の段階は `charStats`。

| key | 名前 | role | 歩行 | 通常攻撃 | 固有 | 技（CT秒） |
|---|---|---|---|---|---|---|
| `hanamaru` | 満別花丸 | balance | normal | 近接 | ― | 花丸パンチ（10） |
| `whitecul` | WhiteCUL | speed | normal | クナイ（中距離、射程150） | ― | 吹雪（7.2） |
| `sayo` | 小夜 | attacker | normal | 近接 | ― | 疾風乱舞（8） |
| `metan` | 四国めたん | defense | normal | 近接 | ― | ドリル（4.8） |
| `mochiko` | もち子 | defense | hover | 近接 | ― | ファンネル（30） |
| `aru` | 猫使アル | speed | normal | 近接 | ― | 突撃（6） |
| `bii` | 猫使ビィ | support | normal | 近接 | ― | オーバードライブ（10） |
| `ierutan` | あいえるたん | support | normal | 弾（中距離、射程150・弾の見た目 bullet） | ― | アップグレード（8） |
| `zunko` | 東北ずん子 | attacker | normal | 近接（パンチ。ダメージ×0.9・間隔1.1秒）／遠距離（弾、射程200・間隔1.2秒・弾速800。対象が60pxより遠いとき） | ― | ずんだアロー（12） |
| `kiritan` | 東北きりたん | なし | normal | 包丁（近接）／きりたん砲（弾、射程310、対象が60より遠いとき） | ― | 全弾斉射（7.2） |
| `himari` | 冥鳴ひまり | attacker | normal | 近接 | ― | 死神の鎌（15） |
| `itako` | 東北イタコ | balance | normal | 近接（キツネ。間隔½・1発½） | ― | 狐火（8） |
| `yurei` | ユーレイちゃん | support | hover | 近接（間隔×2） | 壊せる壁をすり抜ける（ghost） | ジャッジメント（10） |
| `sora` | 九州そら | attacker | hover | 近接（パンチ。ダメージ×0.85・間隔1.25秒） | ― | ソーラーキャノン（5） |

## 技の組み立て
呼び口は `use`・`botUse`（必須）以外に使っているもの。状態の括弧内は共通処理が見る効果。

| key | 技の中身 | 呼び口 | 状態 | 場の物 | クライアント描画 |
|---|---|---|---|---|---|
| `hanamaru` | 押している間タメ、離すと拳を発射（タメのレベルで大きさ・威力・弾速）。直進する拳がキャラに1回ずつダメージ、壁を壊して貫通。芯（`core`、タメで不変）が壊せない壁に触れると消える（外側が触れるだけなら飛び続ける）。パッシブ：壁へ押し込み続けると壊す | `release`（離して発射）、`tick`・`ended`（Bot が離す）、`afterMove`（押し込み）、`botMove`（壁破壊で近道。タメなし）。`use` が false を返してCTを自前で入れる | `fistCharge`（cancel） | `fist`（対象外、視界外は送らない） | status `fistCharge`（頭上のゲージとレベルの玉、技ボタンに「タメ」）、ents `fist`（大きさはサーバーの `r`） |
| `whitecul` | 前方の長方形にダメージ＋はじき | ― | ― | ― | fx `blizzard`（長方形に雪の粒・白い筋） |
| `sayo` | 一定時間、移動が速くなり自分中心の円に周期ダメージ | `tick`、`ended` | `dance`（speed） | ― | status `dance` の目印、fx `dance`（周期ごとの斬線・命中の印） |
| `metan` | 一定時間、前方（移動・照準に追従）にドリルを出しっぱなし。触れた敵にダメージ＋はじき、同じ相手には一定間隔で再ヒット。ドリル中は通常攻撃しない | `afterMove`（ドリルの当たり） | `drill`（noAttack） | ― | status `drill`（回転するドリル・流れる縞・先端の火花） |
| `mochiko` | ファンネル6機を出す。敵を囲んで射撃。攻撃対象になり壊される | ― | ― | `funnel`（ユニット扱い、HPあり） | ents `funnel`、fx `funnel`（発動時の展開） |
| `aru` | タメ→決めた方向へ突進。壁を壊し、触れた敵に1回ずつダメージ。壊せない壁では止まらず、体は壁に沿って滑る（正面なら dur まで留まる） | `afterMove`、`ended` | `charge`（lock・still・noAttack・cancel）、`rush`（lock・noAttack・invincible・noPush・cancel） | ― | status `charge`（警告帯・白点滅）・`rush`（渦）、`frame`（煙） |
| `bii` | 一定時間加速・通常攻撃なし。一定間隔で残像（おとり）を置く。触れた敵（大将含む。中心間 敵の半径＋touch）に予約、終了時に予約があればポーズ→予約の全員へダメージ。途中で倒されたら不発。予約はビィ1人ずつ別 | `afterMove`（Bot が敵へ寄る） | `overload`（speed・noAttack・cancel）、`overloadPose`（lock・still・noAttack・cancel） | `overload`（対象外、進行と予約を持つ。予約の対象id・半径を `v` で送る。印の位置はクライアントが対象の描画位置から引く）、`biiDecoy`（ユニット扱い、HP1、視界外は送らない） | status `overload`（足元の輪）・`overloadPose`（コマ `banzai`）、ents `biiDecoy`（ビィのドットの残像。画像を `frame` で片付け）・`overload`（予約の照準）、色 `boom` |
| `ierutan` | 範囲内の味方と自分をアップグレード（通常攻撃の間隔×0.8、アシストは間隔そのまま）＋毎秒回復 | ― | `upgrade`（cd・regen）を味方に付ける | ― | status `upgrade` の目印（足元の輪・上へ流れる矢印）、fx `upgrade`（広がる二重の輪・放射線） |
| `zunko` | 発射時の照準の対象1体を追う矢（弾速900、旋回は毎秒120°まで、対象を失ったら直進、寿命0.6秒）。当たった敵をずんだ餅に（減速・技不可・与ダメ×0.5） | ― | `mochi`（speed・noSkill・atk）を敵に付ける | ―（矢は共通の弾。誘導は弾の `steer`） | status `mochi`（餅の姿、技ボタンに「餅」）、shots `arrow`（大きな矢・光の粒の尾。向きは進行方向） |
| `kiritan` | 1回目でロックオン、2回目でロックした全員へホーミング弾を3斉射（総数12発を人数で分ける）。目標が倒れた弾は直進に切り替わる。CTは発射後から | `tick`（ロック付与・斉射の進行）。`use` が false を返してCTを自前で入れる | `lockon`（cancel） | `missile`（対象外、弾道3種） | status `lockon`（照準マーク）、ents `missile` |
| `himari` | 発動で透明化。透明化中の Space で鎌（特大ダメージ。ディフェンス以外は一撃）、当てたら攻撃方向へ跳ぶ | `attack`（Spaceの上書き）、`afterMove`・`ended`（跳ぶ）、`tick` | `cloak`（hidden・fragile・noAuto）、`leap`（lock・noAttack・cancel） | ― | status `cloak`（コマ `eyes`、足元・HPを出さない）・`leap`（コマ `idle`）、色 `scythe`、追加コマ `eyes` |
| `itako` | 自分の周りを時計回りに回る火の玉（接触ダメージ、消えない）。展開中に再発動で範囲内（`range`）の最寄りの敵を標的に、9時の位置から順に離れてホーミング、命中で消える。追尾はイタコの近くでしか働かず、今のイタコから `leash` より離れた・追尾を始めてから `homeRange` 進んだ・イタコが倒れた、でも消える（逃げながら飛ばす戦法の対策）。CT は再発動か時間切れから。通常攻撃の見た目はキツネ（`aa` の `fx`） | `tick`（時間切れのCT）。`use` が false を返してCTを自前で入れる | ― | `foxfire`（対象外、回転→待機→追尾） | ents `foxfire`（ヒトダマ風。キツネの絵の仮置き）、fx `kitsune`（通常攻撃） |
| `yurei` | 螺旋を描く光弾が直進、判定は先頭だけ。ダメージは当たった敵の悪行に比例（0で1、手配中は即死）。壁で消える。パッシブ：壊せる壁をすり抜けて移動（`ghost`） | ― | ― | `enma`（対象外） | ents `enma`（先頭＋螺旋の光弾） |
| `sora` | 試合開始から自動チャージ（撤退で0、発射で0）。発射でその場に止まりビーム照射（チャージ270秒までは0.5秒、270〜294秒で5秒まで伸びる。照射秒はキーフレームの第5列。向きは少しだけ変えられる）。キャラ貫通・多段ヒット、壊せる壁を壊して外壁で止まる。チャージ10秒以上で、キャラ・壁の長方形ごと・射程の端に1照射1回の爆発。性能はチャージのキーフレームの補間（`src/shared/solar.ts` の `solarAt`）。ビームが当たっている大将は拠点移動しない（`Boss.holdUntil`） | `tick`（チャージ・照射）、`ended`（照射） | `solar`（lock・still・noAttack・cancel）、`solarCharge`（光の見た目用。チャージ秒を送る） | ― | status `solar`（光の帯）・`solarCharge`（光1つ／たくさんちらつく）、色 `solar`。本人の技ボタンにチャージのゲージと％（30秒の総ダメージ＝100%。補間は `src/shared/solar.ts` でサーバーと共通。`main.ts`） |

使用中の状態 key：`fistCharge` `dance` `drill` `charge` `rush` `overload` `overloadPose` `accel` `mochi` `lockon` `cloak` `leap` `solar` `solarCharge`
使用中の場の物の種類：`fist` `funnel` `overload` `biiDecoy` `missile` `foxfire` `enma`
（どちらも全キャラで重ねない）

## 技の型と手本
| 作りたいもの | 手本 |
|---|---|
| 即時の範囲攻撃（長方形）、はじき | `whitecul` |
| 前方に判定を出しっぱなし（持続する接触判定・同じ相手への再ヒット間隔）、向きの追従 | `metan` |
| 自分に付く持続状態＋周期的な効果 | `sayo` |
| 味方へのバフ | `ierutan` |
| 弾を撃ち、命中時に敵へ状態を付ける | `zunko` |
| タメ→突進、無敵、壁破壊 | `aru` |
| おとりの召喚物（自動照準の対象、触れると消える）、敵ごとの予約→時間差のダメージ、ent の描画用の値（`v`）、ドットの画像を ent で描く | `bii` |
| 攻撃対象になる召喚物（HPあり、経路で追う） | `mochiko` |
| 直進する貫通物、パッシブ、Botの移動中判定 | `hanamaru` |
| 2段階発動、CTの自前管理、ロックオン、追尾する弾 | `kiritan` |
| 押している間タメて離して撃つ（`release`） | `hanamaru` |
| 時間で溜まる技、持続ビーム（多段ヒット・貫通・壁破壊）、爆発の1回制限、キーフレームの補間 | `sora` |
| 透明化、通常攻撃の上書き、被弾即死、追加コマの表示 | `himari` |
| 技の fx を技ごとに描く（fx の color を技固有にして描き分け） | `sayo`（斬線・命中の印）、`whitecul`（雪） |
| 状態の描画を形で作る（コード描画のアニメーション） | `metan`（ドリル） |
| 弾の見た目の差し替え・尾の粒 | `zunko` |
| 歩行タイプの追加 | `mochiko`（hover） |
| 通常攻撃を2モード持つ | `kiritan` |
| 自分の周りを回る接触判定の物、2段階で撃ち出す追尾 | `itako` |
| 通常攻撃の見た目の差し替え（`aa` の `fx`） | `itako` |
| 壁のすり抜け（移動の壁を外周だけにする `ghost`） | `yurei` |
| 当たった相手の値（悪行など）でダメージが変わる弾 | `yurei` |
| 足なしのドット（脚を空レイヤー） | `yurei` |

## 素材
立ち絵は Moiky氏（`<MOIKY_DIR>/<dir>/<表情>.png`）、ドットは 32dot PSD（`tools/make_dot.py`）。加工禁止。

| key | 立ち絵dir | select / ko / koed | PSDの名前の頭 | 腰 | 追加コマ |
|---|---|---|---|---|---|
| `hanamaru` | 満別花丸 | 通常 / 怒り / 降参 | 満別花丸 | 02 | ― |
| `whitecul` | WhiteCUL2 | 通常 / クナイ / 大弱り | WhiteCUL | 01 | ― |
| `sayo` | 小夜 | 普通 / 得意げ / 落ち込み | 小夜 | 02 | ― |
| `metan` | 四国めたん | 通常 / 企み / 茫然 | 四国めたん | 02 | ― |
| `mochiko` | もち子 | 通常 / ガッツポーズ / 恐怖 | もち子 | 02 | ― |
| `aru` | 猫使アル | 直立 / 悪だくみ / 恐怖 | 猫使アル（固有差分あり） | 02 | ― |
| `bii` | 猫使ビィ | 直立 / 攻撃 / なき | 猫使ビィ（固有差分あり） | 02 | ― |
| `ierutan` | あいえるたん | 通常 / いかり / なき | あいえるたん | 02 | ― |
| `zunko` | 東北ずん子 | 制服 / 制服 / なし | 東北ずん子 | 02 | ― |
| `kiritan` | きりたん | 通常 / 煽り / なし | 東北きりたん | 01 | ― |
| `himari` | 冥鳴ひまりv2 | 直立 / 怒り / ショック | 冥鳴ひまり | 02 | `eyes`（目レイヤー `*eye_R04` だけ） |
| `itako` | 東北イタコ | 通常 / 狐サイン / なし | 東北イタコ | 02 | ― |
| `yurei` | ユーレイちゃん | 通常 / 脅かす / 困り | ユーレイちゃん（脚なし `*dummy`） | 01 | ― |
| `sora` | SORA | 普通 / ドヤ顔 / 泣き | 九州そら（脚 `socks01`） | 02 | ― |

koed「なし」は選択画面の絵をグレー化してずり落とす。

## 選べないキャラ（chars.ts の対象外）
- 大将：ankomon（あんこもん軍）、zundamon（ずんだもん軍）。chars.json に `boss` つきで登録。挙動は GameRoom.ts の大将処理、数値は config.ts の `BOSS_*`
- ブイブイ・コバコ：kobako。ドットだけ（make_dot.py）。数値は config.ts の `COURIER`。巡回は中央3部屋（smoking ⇔ hall ⇔ entrance）の往復（`COURIER_ROUTE`）、着くたびに高性能の徳を置く（`COURIER_DROP`）
- アシスト：kurono（玄野武宏）、shirakami（白上虎太郎）、aoyama（青山龍星）、ritsu（波音リツ。PSD `波音リツ`、脚 `shoes01`・腰02。HP×2・移動×0.5、自分中心の吹雪、はじかれない `heavy`）。ドットだけ。数値と挙動は config.ts の `ASSIST` と GameRoom.ts（重い相手へのめたんのドリルは server/skills/metan.ts）

## 更新履歴
- 2026-11-15：初版。雛形化（9794717）と、ひまり追加・きりたん全弾斉射・ビィ再現江湖・もち子ホバー・バリケード廃止（db81202）時点
- 2026-11-15：技エフェクト強化（fx1）。めたんの技をドリル出しっぱなしに作り直し。小夜の斬撃、WhiteCUL・あいえるたん・ずん子・もち子の描画を強化（metan・sayo・whitecul・ierutan・zunko・mochiko）
- 2026-11-17：キャラ追加2（chars2）。東北イタコ（狐火・キツネの通常攻撃）、ユーレイちゃん（エンマビーム・壁すり抜け）を追加（itako・yurei）
- 2026-11-19：技変更・キャラ追加3（chars3）。花丸パンチ（タメ）、オーバーロード（残像のおとり・予約）、ジャッジメント（改名・弾速×1.25）、九州そら（ソーラーキャノン）を追加、アシストに波音リツ、ひまりの鎌160、きりたんの弾数分割・目標を失った弾の直進（hanamaru・bii・yurei・sora・himari・kiritan）
- 2026-11-21：tune1。ずん子に近接のパンチ、遠距離の間隔・弾速、ずんだアローの誘導（弾の steer）、ずんだ餅の与ダメ×0.5（状態の atk）。ビィの予約に爆発までのカウントダウン（zunko・bii）
- 2026-11-22：極端な高速を抑える（speed1）。ロール・近接補正の倍率を廃止して各キャラの `stat` に焼き込み（HP・攻撃・視界は不変、スピード役の移動×1.3→×1.1・近接補正の移動×1.1 廃止）、白上の加速・パワーアップ近接の移動 1.3→1.1、あいえるたんの技を「アップグレード」（移動上昇→通常攻撃の間隔×0.8）に（全キャラ・ierutan）
- 2026-11-22：狐火の追尾を短くする（itako2）。標的を選ぶ範囲 260→180、追尾中の火の玉は今のイタコから260px（leash）より離れた・追尾を始めてから360px（homeRange）進んだ・イタコが倒れた、で消える（itako）
- 2026-11-23：壊せない壁の近くでも撃てる（wallskill1）。花丸パンチは芯（半径15、`core`）が壊せない壁に触れたときだけ消える。アルの突撃は壊せない壁で止まらず、体は壁に沿って滑り dur まで続く。壊せない壁の判定は GameRoom.ts の `unbreakable`（hanamaru・aru）
- 2026-11-23：そらのチャージを技ボタンのゲージと％で見せる（sora3）。本人の画面だけ。30秒の総ダメージ＝100%（0〜5秒は比例、以降は総ダメージ比で100%超えあり）。補間 `solarAt` を `src/shared/solar.ts` へ移しサーバーと共通（sora）
- 2026-11-26：あいえるたんの通常攻撃を中距離の弾に（ierutan1）。射程150（WhiteCUL と同じ）、間隔・威力は近接のまま、弾は既存の bullet（弾速600）。一覧の WhiteCUL の通常攻撃をクナイ（中距離、射程150）に直す（ierutan・whitecul）
