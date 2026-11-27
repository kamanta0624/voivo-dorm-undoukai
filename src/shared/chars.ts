// キャラの性能定義（キャラ key → 定義）。素材・表示の対応表は chars.json（Python の素材生成も読む）
// HP・攻撃・移動・視界の実数値は各キャラの stat に書く（2026-11-22 speed1 でロール補正・近接補正を焼き込み）
import { CONFIG as C, wallRects, Rect } from './config';
import CHARS_JSON from './chars.json';
import MAP from './map.json';

// 通常攻撃のモード。kind: melee=前方の扇形（ATTACK_ARC）、shot=弾。dmg: ダメージ倍率。far: 対象がこれより遠い（対象なしを含む）ときだけ使う。fx: 近接の斬撃のエフェクトを技ごとの描画（client/skills の fx）に差し替える color
export type AaMode = { name: string; kind: 'melee' | 'shot'; range: number; cd: number; dmg: number; shot?: 'bullet' | 'cannon' | 'kunai'; speed?: number; far?: number; fx?: string };
export type CharDef = {
  role?: string; // ロール（balance・attacker・speed・defense・support。ロール固有の効果と選択画面のロール表示。なし可）
  stat: { hp: number; atk: number; speed: number; vision: number }; // 最大HP・通常攻撃の基本値・移動(px/秒)・視界半径(px)
  walk: 'normal' | 'hover'; // 歩行タイプ。normal=歩きの2コマを交互、hover=移動中は歩きの1コマ目で固定
  aa: AaMode[]; // 通常攻撃のモード（使えるもののうち最後のものを使う）
  ghost?: boolean; // 壊せる壁をすり抜けて移動する（外周の壁だけ当たる。弾・視界・他キャラは変わらない）
  toku: number; // 徳の初期値の補正（陣営の全員分を足す）
  skill: { name: string; ct: number; [k: string]: any }; // 技（R）。ct=クールタイム(秒)、ほかは技処理（server/skills・client/skills）が使う値
  desc: string; // キャラ選択のステータス窓に出す技の説明文（技名は skill.name）
  passive?: string; // 同じくパッシブの説明文（あるキャラだけ）
};

const MELEE: AaMode = { name: '近接', kind: 'melee', range: C.ATTACK_RANGE, cd: C.ATTACK_COOLDOWN_MELEE, dmg: 1 };
const def = (d: Partial<CharDef> & Pick<CharDef, 'skill' | 'desc' | 'stat'>): CharDef => ({ walk: 'normal', aa: [MELEE], toku: 0, ...d });

export const CHARS: Record<string, CharDef> = {
  // 花丸パンチ: CT 明けから自動でチャージ（発射・撤退で0）。チャージの秒数が lv[i].t 以上でレベル i+1（最後のレベルで止まる）。発動（矢印で向きを決める）で lv[i].wind 秒溜めて（移動不可・向きは変えられる）から拳を発射。拳はレベルの size 倍の半径・dmg 倍の威力・speed 倍の弾速
  // 拳: 前方へ直進（speed px/秒、range px で消える）、半径 r の拳がキャラ（1体1回）にダメージ・壁を破壊して貫通。芯（半径 core、タメで変わらない）が壊せない壁に触れると消える。パッシブ: 壁へ push 秒押し込み続けるとその壁を壊す（reach: 前方の壁を探すタイル数、w×d: 壊す範囲(タイル)）。Bot: 壁破壊で経路が botSave(px)以上短くなるなら使う（botCheck 秒ごとに判定。壁破壊はタメなし）。敵へはその時のチャージのレベルで撃つ
  hanamaru: def({ stat: { hp: 120, atk: 24, speed: 170, vision: 300 }, desc: '時間とともに力が溜まり、溜まった分だけ大きな拳をまっすぐ飛ばす（大きいほど撃つ前の溜めが長い）。溜まるほど拳が大きく強く、遅くなる。当たった敵にダメージ、壁を削り、壊れたら突き進む', passive: '壁に押し込み続けると、その壁を壊す', role: 'balance', skill: { name: '花丸パンチ', ct: 10, speed: 360, range: 520, r: 30, core: 15, dmg: 40, reach: 3, w: 3, d: 2, push: 0.05, botSave: 320, botCheck: 0.25, lv: [{ t: 0, size: 1, dmg: 0.8, speed: 1, wind: 0 }, { t: 10, size: 1.5, dmg: 1.2, speed: 0.75, wind: 0.5 }, { t: 25, size: 2, dmg: 1.76, speed: 0.55, wind: 1 }] } }),
  // 通常攻撃はクナイ投げ（中距離。射程は吹雪の長さと同じ 200、間隔は近接の1.1倍、威力の倍率は近接と同じ。fb1124）。弾速は仮置き
  whitecul: def({ stat: { hp: 96, atk: 19.2, speed: 187, vision: 390 }, desc: '中距離でクナイを投げて戦う。技は前方に吹雪を起こし、範囲の敵にダメージを与えてはじき飛ばす', role: 'speed', aa: [{ name: 'クナイ', kind: 'shot', range: 150, cd: C.ATTACK_COOLDOWN_MELEE * 1.0, dmg: 1, shot: 'kunai', speed: 600 }], skill: { name: '吹雪', ct: 7.2, len: 200, w: 80, dmg: 20, push: 80 } }),
  sayo: def({ stat: { hp: 84, atk: 33.6, speed: 170, vision: 300 }, desc: 'しばらく足が速くなり、自分のまわりの敵を斬り続ける', role: 'attacker', skill: { name: '疾風乱舞', ct: 8, dur: 3, speed: 1.6, every: 0.3, r: 60, dmg: 12 } }),
  // ドリル: dur 秒、前方（向きは移動・照準に追従）に長さ len・幅 w のドリルを出しっぱなし。触れた敵に dmg ＋自分から離れる向きへ push はじく。同じ相手には rehit 秒おき。ドリル中は通常攻撃しない（移動は可）
  metan: def({ stat: { hp: 168, atk: 21.6, speed: 144.5, vision: 300 }, desc: 'しばらく前方にドリルを出し続ける。触れた敵にダメージを与えてはじく（その間は通常攻撃しない）', role: 'defense', skill: { name: '『天恵の』ハイド', ct: 4.8, dur: 2.4, len: 70, w: 36, dmg: 12, push: 40, rehit: 0.4 } }),
  // leash: 有効射程。攻撃した瞬間にもち子（その時点の位置）から leash px 以上離れていたファンネルは、その攻撃の直後に消える
  mochiko: def({ stat: { hp: 168, atk: 21.6, speed: 144.5, vision: 300 }, desc: 'ファンネル6機を出す。敵を囲んで撃つ（ファンネルは攻撃されると壊れる）', role: 'defense', walk: 'hover', skill: { name: 'ファンネル', ct: 21, n: 6, hp: 20, life: 15, sense: 250, dmg: 6, every: 1, range: 60, speed: 220, radius: 6, pathMax: 400, ring: 44, slotStep: Math.PI / 3, retarget: 0.5, leash: 200 } }), // pathMax: 向かう敵までの経路長の上限、ring: 敵を囲む半径、slotStep: 射撃ごとに回り込む角度、retarget: 対象と経路の見直し間隔
  // arrow: 技の矢印の表示だけの長さ(px。突撃の距離・判定は変えない)、windup: タメの秒数、speed/side: 進む速さ・進行方向に垂直な移動の速さ（移動速度に対する倍率）、dur: 最大秒数、len×w: エフェクト（＝攻撃判定）の大きさ、head: 頭の中心の自キャラからの距離、smoke: 煙が消えるまでの秒数、spin: 渦の回転(ラジアン/秒)
  // fx: 見た目。渦: 筋の本数・[色, 太さ, 不透明度]（交互）・回り込む量(ラジアン)・半径（始め〜終わり）・尾へずれる量(px)。警告: 点滅の間隔・矢印の数。タメ中の白い点滅の間隔
  aru: def({ stat: { hp: 96, atk: 19.2, speed: 187, vision: 390 }, desc: 'タメてから決めた方向へ突撃。壁を削り、触れた敵にダメージ', role: 'speed', skill: { name: '突撃', ct: 6, arrow: 190, windup: 0.8, speed: 1, side: 0.4, dur: 2, len: 160, w: 126, head: 40, dmg: 60, smoke: 0.6, spin: 9, fx: { strands: 7, lines: [[0xff8a00, 6, 0.85], [0xffe14a, 4, 0.9]], turn: Math.PI * 2.6, r0: 4, r1: 70, back: 80, warnBlinkMs: 120, arrows: 5, blinkMs: 90 } } }),
  // オーバードライブ: dur 秒、移動 speed 倍・通常攻撃しない。every 秒ごとにその場へ残像（敵の通常攻撃・自動照準の対象になるおとり。decoyLife 秒か攻撃を受けると消える。HP decoyHp）を置く
  // 触れた敵（中心間 敵の半径＋touch px 以内のプレイヤー・大将）にダメージ予約（同じ敵は1回のオーバードライブで1回）。終了時に予約が1人以上いれば pose 秒ポーズで硬直してから予約の全員へ dmg（大将へは bossDmg）。途中で倒されたら不発。Bot: 敵が botRange 内なら使い、予約していない敵へ寄る
  bii: def({ stat: { hp: 84, atk: 14.4, speed: 170, vision: 300 }, desc: 'しばらく足が速くなり、残像（おとり）を残しながら走る。触れた敵に印を付け、終わるとポーズして印の敵全員にダメージ（途中で倒されると不発）', role: 'support', skill: { name: 'オーバードライブ', ct: 10, dur: 1.5, touch: 40, speed: 1.6, every: 0.2, decoyLife: 1, decoyHp: 1, pose: 0.5, dmg: 60, bossDmg: 30, botRange: 150 } }),
  ierutan: def({ stat: { hp: 84, atk: 14.4, speed: 170, vision: 300 }, desc: '中距離で弾を撃って戦う。技はまわりの味方と自分をアップグレードし、しばらく通常攻撃の間隔を短くして回復し続ける', role: 'support', aa: [{ name: '弾', kind: 'shot', range: 150, cd: C.ATTACK_COOLDOWN_MELEE, dmg: 1, shot: 'bullet', speed: 600 }], skill: { name: 'アップグレード', ct: 8, r: 200, cd: 0.8, dur: 5, regen: 3 } }), // r: 範囲の円の半径（体の中心から。通常攻撃の射程150より少し広く。2026-11-28 ierutan3 で長方形 400×300 から戻した。仮置き）、cd: 効果中の通常攻撃の間隔の倍率（アシストには掛けない）、regen: 効果中の毎秒の回復量
  // 東北ずん子: 近接のパンチと遠距離（きりたんと同じ2モード。対象が far より遠ければ遠距離）。aarange1 でパンチは試験的に外し、遠距離だけ（far は戻すとき用に残す。近接がなければ近い対象も遠距離で撃つ）。数値は仮置き（パンチは包丁より1発が強く、DPS は花丸の通常攻撃より低い）
  // ずんだアロー: 発射時の照準の対象1体を追う矢（弾速 arrowSpeed、進行方向は毎秒 turn ラジアンまでしか曲がらない。対象が倒れた・対象にならなくなったら直進。壁・life 秒で消える）
  // 当たった敵はずんだ餅（dur 秒、移動×speed、技不可、与えるダメージ×atk。無敵の相手には効かない）。range: 対象を選ぶ射程
  // 矢印で向きを決めたときは矢印の向きへ撃ち、射程内で矢印との角度差が aimCone 以内の敵のうち角度差が一番小さい敵を追う（いなければ直進）
  zunko: def({ stat: { hp: 70, atk: 28, speed: 170, vision: 300 }, desc: 'ずんだアロー（簡）を放つ。運動会中はずんだもんを呼び出さず、気合いで放っている。矢は狙った敵を追って少しだけ曲がり、当たった敵をずんだ餅にする（足が遅くなり、技が使えず、与えるダメージが半分になる）', role: 'attacker', aa: [/* aarange1: 近接のパンチを試験的に削除（戻すときはコメントを外す） { ...MELEE, name: 'パンチ', dmg: 0.9, cd: 1.1 }, */ { name: '遠距離', kind: 'shot', range: 200, cd: 1.2, dmg: 1, shot: 'bullet', speed: 800, far: 60 }], skill: { name: 'ずんだアロー', ct: 12, range: 300, dur: 4, speed: 0.5, atk: 0.5, arrowSpeed: 900, turn: (Math.PI * 2) / 3, life: 0.6, aimCone: Math.PI / 6 } }),
  // 足が遅い。対象が 60 より遠ければきりたん砲（弾速遅め・ダメージ控えめ）、近ければ包丁。aarange1 で包丁は試験的に外し、きりたん砲だけ（far は戻すとき用に残す）
  // 全弾斉射: 1回目でロックオン（射程 range 内の敵に近い順で lockEvery 秒ごとに1体ずつ。最大 lockMax 秒）、2回目でロックした全員へホーミング弾（総数 perTarget × volleys 発をロックした人数で均等に分け、割り切れない余りはロック順に1発ずつ足す。各自の分を volleys 回に分けて volleyGap 秒おき、1発 dmg）。CT は発射（またはロックの時間切れ）から
  // 射程: 弾が今のきりたんから homeMax px 以上離れたらホーミングをやめて直進（目標が倒れたときと同じ直進）、vanish px 以上離れたら消える
  // 弾道（3種を順に）: straight=直進して追う、spread=左右へゆっくり展開（spreadT 秒、spreadSpeed）→加速（accel）して目標へ、brake=前方／後方へ偏差的に速く飛ぶ（leadT 秒、leadSpeed、leadAngle）→急制動（brakeT 秒）→目標へ。速さの上限 maxSpeed、life 秒で消える、弾の半径 r。目標が着弾前に倒れた（撤退・消滅・対象にならない状態を含む）弾は、その時点の進行方向へ orphanSpeed で直進し、life の残り・壁・敵（コバコを含む。最初に当たった敵にダメージ、コバコはKO）で消える
  // 死神の鎌: 発動で透明化（dur 秒。敵の対象にならない・オートアタックしない・被弾で即死）。透明化中は対象が範囲に入ると自動で鎌（前方 range・arc、dmg、大将へは bossDmg＝旧めたんのドリルと同じ基本値30、アシストへは dmg×assistMult）。当てたら攻撃の向きへ jump px を通常移動の jumpSpeed 倍で跳ぶ（壁で止まる）。eyes: 透明化中の目のドット（tools/make_dot.py）
  himari: def({ stat: { hp: 84, atk: 33.6, speed: 170, vision: 300 }, desc: '姿を消す。消えている間は近づいた敵を鎌で特大ダメージを与え、攻撃の向きへ跳ぶ（攻撃を受けると即やられる）', role: 'attacker', skill: { name: '死神の鎌', ct: 15, dur: 5, range: 60, arc: Math.PI / 2, dmg: 160, bossDmg: 30, assistMult: 0.5, jump: C.PLAYER_RADIUS * 2 * 5, jumpSpeed: 2 } }),
  // 東北イタコ: 通常攻撃はキツネ（狐火の見た目）。間隔は半分、1発は半分
  // 狐火: 自分中心の半径 r の円周に n 個の火の玉を出し、時計回りに spin(ラジアン/秒) で回す（dur 秒で消える）。触れた敵に dmg、同じ相手には rehit 秒おき。ballR: 火の玉の半径
  // 展開中に再発動: 射程 range 内の最寄りの敵を標的に、各火の玉は標的の方向を12時とした9時の位置で円から離れ、homeSpeed(px/秒)・旋回 turn(ラジアン/秒) で追う。命中で homeDmg を与えて消える。life 秒・壁・イタコが倒れた・今のイタコの体の中心から leash px より離れた・追尾を始めてから homeRange px 進んだ、のどれかでも消える（逃げながら飛ばす戦法の対策）。CT は再発動（または時間切れ）から
  itako: def({ stat: { hp: 120, atk: 24, speed: 170, vision: 300 }, desc: '自分のまわりに狐火を回し、触れた敵にダメージ。回っている間にもう一度使うと、狐火が近くの敵を追いかけて飛ぶ', role: 'balance', aa: [{ ...MELEE, cd: C.ATTACK_COOLDOWN_MELEE / 2, dmg: 0.5, fx: 'kitsune' }], skill: { name: '狐火', ct: 8, n: 5, r: 50, spin: 3, dur: 6, ballR: 8, dmg: 8, rehit: 0.5, range: 180, homeSpeed: 360, turn: 6, homeDmg: 15, life: 3, leash: 260, homeRange: 360 } }),
  // ユーレイちゃん: 足がなく浮遊（hover）。壊せる壁をすり抜ける（ghost）。通常攻撃の間隔は2倍
  // ジャッジメント: 光弾が螺旋を描きながら直進（speed px/秒、range px、壁で消える）。当たり判定は先頭の光弾（半径 r）だけ。プレイヤーへのダメージは悪行量に比例（悪行0で minDmg、WANTED_MIN 手前で maxDmg、指名手配中は即死 killDmg）。大将・場の物には minDmg
  // 見た目: 光弾 orbs 個、螺旋の半径 spiralR・1周の長さ spiralLen(px)
  yurei: def({ stat: { hp: 84, atk: 14.4, speed: 170, vision: 300 }, desc: '螺旋を描く光弾をまっすぐ撃つ。悪行が多い敵ほど大ダメージ、指名手配中なら一撃', passive: '壊せる壁をすり抜けて移動できる', role: 'support', walk: 'hover', ghost: true, aa: [{ ...MELEE, cd: C.ATTACK_COOLDOWN_MELEE * 2 }], skill: { name: 'ジャッジメント', ct: 10, speed: 525, range: 320, r: 8, minDmg: 1, maxDmg: 50, killDmg: 999, orbs: 4, spiralR: 6, spiralLen: 40 } }),
  // 九州そら: 浮遊（hover）。通常攻撃はパンチ（花丸よりダメージやや高く、間隔やや長い）
  // ソーラーキャノン: 自動でチャージ。試合開始・復活・発射の後は CT（ct 秒）で、その間は溜まらない（撃てない）。CT が明けてから0秒で溜まり始める（撤退で0、発射で0）。発射すると本人はその場で止まり、照射秒（keys の第5列）の間ビーム（幅 w）を照射。向きは移動入力の方へ毎秒 turn ラジアンまで変わる
  // ビームはキャラを貫通して every 秒おきに多段ヒット（1キャラ 照射秒÷every 回まで。試合終了までに照射秒が残っていない時は、その回数を残り時間に等間隔で詰める）、壊せる壁は壊して進み、外壁・射程の端で止まる。チャージ boomFrom 秒以上なら、当たったキャラ・壁（照射開始時の壁の長方形）ごと・射程の端（外壁）に1照射1回ずつ爆発（範囲の壁も壊す。爆発のダメージは1キャラ1照射1回）
  // keys: [チャージ秒, 総ダメージ（照射の間ずっと入り続けたビームの合計＋爆発1回。大将2倍の前）, 射程(px), 爆発半径(px), 照射秒]。間は線形補間、最初より前は最初、最後より後は最後。総ダメージはビーム beamShare：爆発（残り）に分ける（爆発なしは全部ビーム）
  // 最後のキーフレームの大将へは、全倍率（DAMAGE_MULT・ATTACKER_BOSS_MULT）を掛けた後の合計が bossMax になる値を別に使う。総ダメージ（大将へも）は最後のキーフレームで止めず、最後の区間（265→285秒）の伸び方 × grow で伸び続ける（sora4。射程・爆発半径・照射秒は最後の値のまま）。ビームが大将に当たっている間は大将の拠点移動が起きない
  // delay: 発射からビームが出るまでの秒数（その間は射程全体に届かない。照射秒はビームが出てから数える）。チャージ0秒で delay[0]、delayAt 秒以上で delay[1]、その間は直線。チャージが keys の最後から2番目の秒数（265）を超えた発射は遅れなし
  //   delay[1] = 0.25秒（反応時間）＋（ビームの幅 w の半分 ＋ PLAYER_RADIUS）÷ WhiteCUL の移動速度 ≒ 0.346秒（hitbox1 の前の、足元の円で決めた値）。delay[0] = 0.5秒（2026-11-27 hitbox1）
  // glow: そらの光（1つ・たくさんちらつく）が付くチャージ秒。Bot: チャージ botMin 秒以上で、ビームの線上に敵か大将がいれば撃つ
  sora: def({
    stat: { hp: 84, atk: 33.6, speed: 170, vision: 300 }, desc: '試合開始・復活・発射の5秒後から力を溜め、発射するとその場で止まって正面へビームを照射。キャラを貫き、壁は削って壊れたら進む。溜めるほど強く遠くまで届き、爆発も起きる。4分25秒を超えて溜めると照射も長くなる（倒されると溜め直し）', role: 'attacker', walk: 'hover',
    aa: [{ ...MELEE, name: 'パンチ', dmg: 0.85, cd: 1.25 }],
    skill: { name: 'ソーラーキャノン', ct: 5, turn: Math.PI / 30, w: 16, every: 0.25, beamShare: 0.6, boomFrom: 10, keys: [[5, 29, 200, 0, 0.5], [10, 45, 300, 0, 0.5], [25, 80, 450, 40, 0.5], [265, 110, 550, 60, 0.5], [285, 250, Math.ceil(Math.hypot(C.MAP_W, C.MAP_H)), 200, 5]], bossMax: 1200, grow: 1, glow: [25, 265], botMin: 10, delay: [0.5, 0.25 + (16 / 2 + C.PLAYER_RADIUS) / 187], delayAt: 20 }, // 2026-11-27 hitbox1: 100%（第3行）を30→25秒、270→265、最大を294→285（試合開始の CT 5秒と合わせ、撃たずに溜めれば試合時計の4分30秒・4分50秒）。delay[1] の 16=w、187=whitecul.stat.speed
  }),
  kiritan: def({
    stat: { hp: 100, atk: 20, speed: 136, vision: 300 }, desc: '1回目で射程内の敵をロックオン、2回目でロックした全員へホーミング弾を撃ち込む',
    aa: [/* aarange1: 近接の包丁を試験的に削除（戻すときはコメントを外す） { ...MELEE, name: '包丁', dmg: 1.2 }, */ { name: 'きりたん砲', kind: 'shot', range: 200 /* aarange1: 310→200 */, cd: C.ATTACK_COOLDOWN_RANGED, dmg: 0.85, shot: 'cannon', speed: 300, far: 60 }],
    skill: { name: '全弾斉射', ct: 7.2, range: 200 /* aim1: 310→200 */, homeMax: 200, vanish: 250, lockEvery: 0.1, lockMax: 3, perTarget: 4, volleys: 3, volleyGap: 0.3, dmg: 6, r: 4, life: 3, maxSpeed: 650, straightSpeed: 450, spreadT: 0.35, spreadSpeed: 70, accel: 1400, leadT: 0.3, leadSpeed: 520, leadAngle: 0.5, brakeT: 0.12, orphanSpeed: 450 },
  }),
};

type JsonChar = { name: string; boss?: number };
const JSON_CHARS = Object.fromEntries(Object.entries(CHARS_JSON).filter(([k]) => k !== '_')) as Record<string, JsonChar>;
export const PICKABLE = Object.keys(JSON_CHARS).filter((k) => JSON_CHARS[k].boss === undefined); // 大将以外
// e2e（E2E_HOOKS）の試合の Bot の編成（順に割り当てる）。ひまり・ビィ・そらは入れない（検証が揺らぐため。検証はサーバー単体と人間の操作で行う）
export const E2E_BOTS = ['hanamaru', 'whitecul', 'sayo', 'metan', 'mochiko', 'aru', 'ierutan', 'zunko', 'kiritan'];
export const BOSS_CHAR = [0, 1].map((t) => Object.keys(JSON_CHARS).find((k) => JSON_CHARS[k].boss === t)!); // 陣営 → 大将のキャラ

// キャラのロール。char なし（大将）や role なしは null
export const roleOf = (char?: string) => { const r = CHARS[char ?? '']?.role; return r ? { name: r } : null; };
// キャラの視界半径。char なし（大将）・定義のないキャラ（アシスト）は基本値
export const visionRadius = (char?: string) => (CHARS[char ?? '']?.stat.vision ?? C.VISION_RADIUS) * C.VISION_SCALE; // 視界の率（VISION_SCALE）を掛けた半径
// 撃破後の視界半径（サーバー・クライアント共通）。ko: 撃破からの秒数（null＝生存）。大爆発までは visionRadius、その後 RESPAWN_BASE までに (1−t)^2 で0へ縮む。アシストは大爆発で0
export const eyeRadius = (char: string, ko: number | null, assist = false) => {
  const r = visionRadius(char), K = C.KO_FX, end = K.shake + K.boom;
  if (ko === null || ko < end) return r;
  const t = (ko - end) / (C.RESPAWN_BASE - end);
  return assist || t >= 1 ? 0 : r * (1 - t) ** 2;
};
export const walkOf = (char: string) => CHARS[char]?.walk ?? 'normal';

// ステータスの算出（サーバーの maxHp・speedOf・attack もこれを使う）
export const charHp = (char: string) => CHARS[char].stat.hp;
export const charSpeed = (char: string) => CHARS[char].stat.speed;
export const charAtk = (char: string) => CHARS[char].stat.atk;
// 移動の当たり判定に使う壁。ghost のキャラは外周の壁（壊せない壁）だけ。walls: 今の壁（壁破壊で変わる）
const OUTER_WALLS = wallRects(MAP.tiles.map((row, y) => [...row].map((c, x) => (c === '#' && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (MAP.tiles[y + dy]?.[x + dx] ?? ' ') === ' ')) ? '#' : '.')).join('')));
export const moveWalls = (char: string | undefined, walls: Rect[]) => (CHARS[char ?? '']?.ghost ? OUTER_WALLS : walls);
const aaOf = (char: string) => CHARS[char]?.aa ?? [MELEE];
// 通常攻撃の射程（モードのうち一番長いもの）
export const aaRange = (char: string) => Math.max(...aaOf(char).map((m) => m.range));
// 使う通常攻撃のモード。d: 対象までの距離（対象なしは null）
export const aaMode = (char: string, d: number | null) => {
  const ok = aaOf(char).filter((m) => m.far === undefined || d === null || d > m.far);
  return ok[ok.length - 1] ?? aaOf(char)[0];
};

// 表示用ステータス（各1〜5段階）。閾値: この値以上で 2,3,4,5 段階。技CTは短いほど高段階
export const STAT_STEPS = {
  hp: [80, 100, 120, 140],
  speed: [150, 180, 200, 220],
  ct: [-15, -9, -7.5, -6], // -CT（秒）
  atk: [12, 17, 22, 27], // 秒間ダメージ
  range: [60, 150, 210, 250],
};
const step = (v: number, th: number[]) => 1 + th.filter((t) => v >= t).length;
export const charStats = (char: string) => {
  const d = CHARS[char];
  return {
    hp: step(charHp(char), STAT_STEPS.hp),
    speed: step(charSpeed(char), STAT_STEPS.speed),
    ct: step(-d.skill.ct, STAT_STEPS.ct),
    aa: d.aa.map((m) => ({ name: m.name, kind: m.kind, atk: step((charAtk(char) * m.dmg) / m.cd, STAT_STEPS.atk), range: step(m.range, STAT_STEPS.range) })),
  };
};
