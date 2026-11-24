// ルール説明（public/rules.html）のスロットのスペック表を、今の設定（src/shared/config.ts の SLOT。既定のクラシック方式）から作る: npx tsx tools/render_rules_slot.ts
// rules.html の <!-- slot-spec:start --> 〜 <!-- slot-spec:end --> の間を書き換える。表が設定と合っているかはサーバー単体テスト（verify/server.ts）が見る
import { readFileSync, writeFileSync } from 'node:fs';
import { CONFIG as C, slotRate, chanceRate, sevenRate, penaltyRate } from '../src/shared/config';

const FILE = 'public/rules.html', START = '<!-- slot-spec:start -->', END = '<!-- slot-spec:end -->';
const TOKU = [0, 2.5, 5, 7.5, 9, 10]; // 表に出す徳の代表値
const pct = (x: number) => `${+(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)}%`; // 1%未満は小数2桁、ほかは1桁（末尾の0は付けない）

export function slotSpecHtml() {
  const S = C.SLOT, P = S.penalty;
  const rows = TOKU.map((t) => `<tr><td>${t}</td><td>${pct(slotRate(t))}</td><td>${pct(sevenRate(t))}</td><td>${pct(chanceRate(t))}</td><td>${pct(penaltyRate(t))}</td></tr>`).join('\n      ');
  return `${START}
    <p>スロットは${S.spin}秒に1回転（リーチの演出・チャンスアップ（${S.gap}秒）・罰の出目（${S.penHold}秒）の間は止まる）。当たりの確率は回転ごと。</p>
    <table class="stack slotspec">
      <thead><tr><th>徳</th><th>当たり</th><th>7</th><th>連チャン</th><th>罰</th></tr></thead>
      ${rows}
    </table>
    <p class="note">当たり＝1回転で当たる確率／7＝当たりのうち7（大将の絵柄）になる割合／連チャン＝チャンスアップの抽選が当たる確率（1回ごと）／罰＝1回転で罰の出目が出る確率</p>
    <ul>
      <li>当たると徳が${-S.winToku}下がる（チャンスアップでは変わらない）</li>
      <li>チャンスアップ: 当たりのあと最大${S.chance.n}回の抽選。当たるたびに強さが1段上がり、外れたら終わり（確率は当たった時の徳で決まる）</li>
      <li>当たりの絵柄: 7以外は、${pct(S.assistShare)}でアシスト、残りは組のプレイヤーで等分（アシストが出ていれば、アシストの絵柄はそのアシスト）</li>
      <li>7（大将の絵柄）: 徳${S.seven[0][0]}以上でだけ出る。全員のパワーアップが上がる</li>
      <li>罰（3種から1つ）: 全員に最大HPの${pct(P.dmg)}のダメージ／全員の足が${P.dur}秒 ×${P.slow}／全員の攻撃力が${P.dur}秒 ×${P.weak}</li>
    </ul>
    ${END}`;
}

if (process.argv[1]?.endsWith('render_rules_slot.ts')) {
  const html = readFileSync(FILE, 'utf8'), i = html.indexOf(START), j = html.indexOf(END);
  if (i < 0 || j < 0) throw new Error(`${FILE} に ${START} 〜 ${END} がない`);
  writeFileSync(FILE, html.slice(0, i) + slotSpecHtml() + html.slice(j + END.length));
  console.log(`${FILE}: スロットのスペック表を書き換えた`);
}
