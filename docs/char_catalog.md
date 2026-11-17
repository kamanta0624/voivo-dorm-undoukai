# キャラ一覧（何がどう組み合わさっているか）

キャラの追加・修正のたびに更新する（`.claude/skills/char/SKILL.md`）。手順は `docs/add_char.md`。数値の正は `src/shared/chars.ts`。

## 置き場所
| 何 | どこ |
|---|---|
| 素材・表示の対応（名前・立ち絵） | `src/shared/chars.json` |
| 性能定義（role・歩行・通常攻撃・技の値） | `src/shared/chars.ts` の `CHARS` |
| 技処理（サーバー） | `src/server/skills/<key>.ts`、登録は `index.ts` の `MODS` |
| 技の描画（クライアント） | `src/client/skills/<key>.ts`、登録は `index.ts` の `MODS` |
| ドットのPSD対応 | `tools/make_dot.py` の `CHARS`・`WAIST`・`EYES_ONLY` |
| 生成素材（git管理外） | `public/assets/gen/dot/<key>/`、`public/assets/gen/tachie/<key>/` |
| 検証 | `verify/server.ts`（技ごとの検証）、`verify/golden.ts`（全キャラのBot戦のハッシュ） |

## 性能
HP・移動・攻撃の実数は 基本値 × role × 近接補正 × 固有倍率 で算出（`charHp`・`charSpeed`・`charAtk`）。選択画面の段階は `charStats`。

| key | 名前 | role | 歩行 | 通常攻撃 | 近接補正 | 固有 | 技（CT秒） |
|---|---|---|---|---|---|---|---|
| `hanamaru` | 満別花丸 | balance | normal | 近接 | あり | ― | 巨大拳飛ばし（10） |
| `whitecul` | WhiteCUL | speed | normal | 近接 | あり | ― | 吹雪（7.2） |
| `sayo` | 小夜 | attacker | normal | 近接 | あり | ― | 疾風乱舞（8） |
| `metan` | 四国めたん | defense | normal | 近接 | あり | ― | ドリル（4.8） |
| `mochiko` | もち子 | defense | hover | 近接 | あり | ― | ファンネル（30） |
| `aru` | 猫使アル | speed | normal | 近接 | あり | ― | 突撃（6） |
| `bii` | 猫使ビィ | support | normal | 近接 | あり | ― | 再現江湖（10） |
| `ierutan` | あいえるたん | support | normal | 近接 | あり | ― | 加速（8） |
| `zunko` | 東北ずん子 | attacker | normal | 遠距離（弾、射程200） | なし | ― | ずんだアロー（12） |
| `kiritan` | 東北きりたん | なし | normal | 包丁（近接）／きりたん砲（弾、射程310、対象が60より遠いとき） | なし | 移動×0.8 | 全弾斉射（7.2） |
| `himari` | 冥鳴ひまり | attacker | normal | 近接 | あり | ― | 死神の鎌（12） |
| `itako` | 東北イタコ | balance | normal | 近接（キツネ。間隔½・1発½） | あり | ― | 狐火（8） |
| `yurei` | ユーレイちゃん | support | hover | 近接（間隔×2） | あり | 壊せる壁をすり抜ける（ghost） | エンマビーム（10） |

## 技の組み立て
呼び口は `use`・`botUse`（必須）以外に使っているもの。状態の括弧内は共通処理が見る効果。

| key | 技の中身 | 呼び口 | 状態 | 場の物 | クライアント描画 |
|---|---|---|---|---|---|
| `hanamaru` | 直進する拳がキャラに1回ずつダメージ、壁を壊して貫通。パッシブ：壁へ押し込み続けると壊す | `afterMove`（押し込み）、`botMove`（壁破壊で近道） | ― | `fist`（対象外、視界外は送らない） | ents `fist` |
| `whitecul` | 前方の長方形にダメージ＋はじき | ― | ― | ― | fx `blizzard`（長方形に雪の粒・白い筋） |
| `sayo` | 一定時間、移動が速くなり自分中心の円に周期ダメージ | `tick`、`ended` | `dance`（speed） | ― | status `dance` の目印、fx `dance`（周期ごとの斬線・命中の印） |
| `metan` | 一定時間、前方（移動・照準に追従）にドリルを出しっぱなし。触れた敵にダメージ＋はじき、同じ相手には一定間隔で再ヒット。ドリル中は通常攻撃しない | `afterMove`（ドリルの当たり） | `drill`（noAttack） | ― | status `drill`（回転するドリル・流れる縞・先端の火花） |
| `mochiko` | ファンネル6機を出す。敵を囲んで射撃。攻撃対象になり壊される | ― | ― | `funnel`（ユニット扱い、HPあり） | ents `funnel`、fx `funnel`（発動時の展開） |
| `aru` | タメ→決めた方向へ突進。壁を壊し、触れた敵に1回ずつダメージ | `afterMove`、`ended` | `charge`（lock・noAttack・cancel）、`rush`（lock・noAttack・invincible・noPush・cancel） | ― | status `charge`（警告帯・白点滅）・`rush`（渦）、`frame`（煙） |
| `bii` | 敵へ残像を残して高速移動。当たったら少し進んで爆発、壁も壊す。空振りは爆発なし | `afterMove`、`ended` | `phantom`（lock・noAttack・cancel） | ― | status `phantom`（残像）、色 `boom` |
| `ierutan` | 範囲内の味方と自分を加速＋毎秒回復 | ― | `accel`（speed・regen）を味方に付ける | ― | status `accel` の目印（足元の輪・上へ流れる矢印）、fx `accel`（広がる二重の輪・放射線） |
| `zunko` | 矢を撃ち、当たった敵をずんだ餅に（減速・技不可） | ― | `mochi`（speed・noSkill）を敵に付ける | ―（矢は共通の弾） | status `mochi`（餅の姿、技ボタンに「餅」）、shots `arrow`（大きな矢・光の粒の尾） |
| `kiritan` | 1回目でロックオン、2回目でロックした全員へホーミング弾を3斉射。CTは発射後から | `tick`（ロック付与・斉射の進行）。`use` が false を返してCTを自前で入れる | `lockon`（cancel） | `missile`（対象外、弾道3種） | status `lockon`（照準マーク）、ents `missile` |
| `himari` | 発動で透明化。透明化中の Space で鎌（即死級）、当てたら攻撃方向へ跳ぶ | `attack`（Spaceの上書き）、`afterMove`・`ended`（跳ぶ）、`tick` | `cloak`（hidden・fragile・noAuto）、`leap`（lock・noAttack・cancel） | ― | status `cloak`（コマ `eyes`、足元・HPを出さない）・`leap`（コマ `idle`）、色 `scythe`、追加コマ `eyes` |
| `itako` | 自分の周りを時計回りに回る火の玉（接触ダメージ、消えない）。展開中に再発動で最寄りの敵を標的に、9時の位置から順に離れてホーミング、命中で消える。CT は再発動か時間切れから。通常攻撃の見た目はキツネ（`aa` の `fx`） | `tick`（時間切れのCT）。`use` が false を返してCTを自前で入れる | ― | `foxfire`（対象外、回転→待機→追尾） | ents `foxfire`（ヒトダマ風。キツネの絵の仮置き）、fx `kitsune`（通常攻撃） |
| `yurei` | 螺旋を描く光弾が直進、判定は先頭だけ。ダメージは当たった敵の悪行に比例（0で1、手配中は即死）。壁で消える。パッシブ：壊せる壁をすり抜けて移動（`ghost`） | ― | ― | `enma`（対象外） | ents `enma`（先頭＋螺旋の光弾） |

使用中の状態 key：`dance` `drill` `charge` `rush` `phantom` `accel` `mochi` `lockon` `cloak` `leap`
使用中の場の物の種類：`fist` `funnel` `missile` `foxfire` `enma`
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
| 高速移動→着弾点で爆発、壁破壊、残像の描画 | `bii` |
| 攻撃対象になる召喚物（HPあり、経路で追う） | `mochiko` |
| 直進する貫通物、パッシブ、Botの移動中判定 | `hanamaru` |
| 2段階発動、CTの自前管理、ロックオン、追尾する弾 | `kiritan` |
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

koed「なし」は選択画面の絵をグレー化してずり落とす。

## 選べないキャラ（chars.ts の対象外）
- 大将：ankomon（あんこもん軍）、zundamon（ずんだもん軍）。chars.json に `boss` つきで登録。挙動は GameRoom.ts の大将処理、数値は config.ts の `BOSS_*`
- ブイブイ・コバコ：kobako。ドットだけ（make_dot.py）。数値は config.ts の `COURIER`。巡回は中央3部屋（smoking ⇔ hall ⇔ entrance）の往復（`COURIER_ROUTE`）、着くたびに高性能の徳を置く（`COURIER_DROP`）
- アシスト：kurono（玄野武宏）、shirakami（白上虎太郎）、aoyama（青山龍星）。ドットだけ。数値と挙動は config.ts の `ASSIST` と GameRoom.ts

## 更新履歴
- 2026-11-15：初版。雛形化（9794717）と、ひまり追加・きりたん全弾斉射・ビィ再現江湖・もち子ホバー・バリケード廃止（db81202）時点
- 2026-11-15：技エフェクト強化（fx1）。めたんの技をドリル出しっぱなしに作り直し。小夜の斬撃、WhiteCUL・あいえるたん・ずん子・もち子の描画を強化（metan・sayo・whitecul・ierutan・zunko・mochiko）
- 2026-11-17：キャラ追加2（chars2）。東北イタコ（狐火・キツネの通常攻撃）、ユーレイちゃん（エンマビーム・壁すり抜け）を追加（itako・yurei）
