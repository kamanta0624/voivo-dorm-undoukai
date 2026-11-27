// 九州そら: ソーラーキャノンのキーフレームの補間（サーバーの威力・クライアントの技ボタンの％で共通）
import { CONFIG as C } from './config';
import { CHARS } from './chars';

const S = CHARS.sora.skill, K = S.keys as number[][];
const BOSS_LAST = S.bossMax / (C.DAMAGE_MULT * C.ATTACKER_BOSS_MULT); // 最大チャージの大将への総ダメージ（倍率を掛ける前）。全倍率の後で bossMax になる

// チャージ秒 → キーフレームの線形補間。col: 1=総ダメージ 2=射程 3=爆発半径 4=照射秒。boss: 大将への総ダメージ（最後のキーフレームだけ BOSS_LAST）
export function solarAt(charge: number, col: number, boss = false) {
  const v = (i: number) => (boss && col === 1 && i === K.length - 1 ? BOSS_LAST : K[i][col]);
  if (charge <= K[0][0]) return v(0);
  for (let i = 1; i < K.length; i++) if (charge <= K[i][0]) return v(i - 1) + ((v(i) - v(i - 1)) * (charge - K[i - 1][0])) / (K[i][0] - K[i - 1][0]);
  return v(K.length - 1);
}

// 技ボタンの％（整数に丸める前）: keys の3行目（25秒）の総ダメージを100%。5秒以降は総ダメージ÷その総ダメージ、0〜5秒は0%から5秒の％まで秒数に比例
export function solarPct(charge: number) {
  const pct = (c: number) => (solarAt(c, 1) / solarAt(K[2][0], 1)) * 100;
  return charge < 5 ? (Math.max(0, charge) / 5) * pct(5) : pct(charge);
}

// 発射からビームが出るまでの秒数: チャージ0秒で delay[0]、delayAt 秒以上で delay[1]、その間は直線。keys の最後から2番目の秒数を超えた発射は0
export function solarDelay(charge: number) {
  if (charge > K[K.length - 2][0]) return 0;
  const [d0, d1] = S.delay as number[];
  return charge >= S.delayAt ? d1 : d0 + ((d1 - d0) * Math.max(0, charge)) / S.delayAt;
}
