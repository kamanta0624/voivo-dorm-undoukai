// ルール説明（ADV）: 背景（ゲーム画面のスクショ）＋左右に立ち絵＋下部の台詞窓（話者名・字幕）
// 送り: タップ／クリックで次へ。オート（オン・オフ）は音声が終われば次へ（音声のない行は文字数から決めた時間）。スキップで終了しタイトルへ
// 台本は src/shared/tutorial_script.json。ゲーム本体（Phaser・通信）は読み込まない
import SCRIPT from '../shared/tutorial_script.json';
import CHARS_JSON from '../shared/chars.json';
import { CHARS } from '../shared/chars';
import { CONFIG as C } from '../shared/config';

type Line = { who: string; face: string; bg: string; text: string; yomi: string; audio?: string };
const NAMES = CHARS_JSON as Record<string, any>;
const TACHIE = (key: string, slot: string) => `assets/gen/tachie/${key}/${slot}.png`;
const BG = (f: string) => `assets/tutorial/${f}`;
// {name:key}・{skill:key} をキャラ名・技名に
const fill = (t: string) => t.replace(/\{(name|skill):(\w+)\}/g, (_, k, key) => (k === 'name' ? NAMES[key]?.name : (CHARS as any)[key]?.skill?.name) ?? key);

const css = `
#adv{position:fixed;inset:0;z-index:50;background:#111 center/cover no-repeat;overflow:hidden;color:#fff;font:16px sans-serif;user-select:none;-webkit-user-select:none;touch-action:manipulation}
#adv img.tc{position:absolute;bottom:0;height:88%;max-width:48%;object-fit:contain;object-position:bottom;transition:filter .2s,opacity .2s}
#adv img.l{left:2%}
#adv img.r{right:2%}
#adv img.off{filter:brightness(.45)}
#adv .win{position:absolute;left:3%;right:3%;bottom:max(3%,env(safe-area-inset-bottom));min-height:22%;background:#000c;border:2px solid #fff8;border-radius:10px;padding:10px 16px;box-sizing:border-box}
#adv .nm{display:inline-block;margin:-26px 0 6px;padding:2px 12px;background:#e8541e;border-radius:6px;font-weight:bold}
#adv .tx{font-size:clamp(15px,2.6vw,22px);line-height:1.5}
#adv .tools{position:absolute;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));display:flex;gap:8px}
#adv .tools button{border:1px solid #fff8;background:#000a;color:#fff;border-radius:6px;padding:6px 12px;font:bold 14px sans-serif;cursor:pointer}
#adv .tools button.on{background:#e8541e}
#adv .pg{position:absolute;right:16px;bottom:8px;font-size:12px;color:#fffa}
`;

// done: 終了（最後まで・スキップ）でタイトルに戻す
export function start(done: () => void) {
  const lines = SCRIPT.lines as Line[];
  const sides: string[] = []; // 最初に出た話者が左、2人目が右
  for (const l of lines) if (!sides.includes(l.who) && sides.length < 2) sides.push(l.who);
  const style = document.createElement('style');
  style.textContent = css;
  const el = document.createElement('div');
  el.id = 'adv';
  el.innerHTML = `<img class="tc l" hidden><img class="tc r" hidden><div class="win"><div class="nm"></div><div class="tx"></div><div class="pg"></div></div><div class="tools"><button class="auto">オート</button><button class="skip">スキップ</button></div>`;
  document.head.appendChild(style);
  document.body.appendChild(el);
  const $ = (s: string) => el.querySelector<HTMLElement>(s)!;
  const img = [$('img.l') as HTMLImageElement, $('img.r') as HTMLImageElement];
  let i = -1, auto = false, timer = 0;
  try { auto = localStorage.getItem('advAuto') === '1'; } catch {}
  const audio = new Audio();
  const end = () => { clearTimeout(timer); audio.pause(); el.remove(); style.remove(); done(); };
  // 次の行へ（オートなら、音声の終わり／文字数から決めた時間で自動で次へ）
  const next = () => {
    clearTimeout(timer);
    audio.pause();
    if (++i >= lines.length) return end();
    const l = lines[i], s = sides.indexOf(l.who);
    el.style.backgroundImage = `url(${BG(l.bg)})`;
    img.forEach((im, k) => { const who = sides[k]; if (!who || !lines.slice(0, i + 1).some((x) => x.who === who)) return; im.hidden = false; im.classList.toggle('off', k !== s); }); // 一度出た話者は残し、話していない方を暗く
    img[s].src = TACHIE(l.who, l.face);
    $('.nm').textContent = NAMES[l.who]?.name ?? l.who;
    $('.tx').textContent = fill(l.text);
    $('.pg').textContent = `${i + 1}/${lines.length}`;
    if (l.audio) { audio.src = l.audio; audio.play().catch(() => {}); }
    if (auto && !l.audio) timer = window.setTimeout(next, (C.TUTORIAL.autoBase + C.TUTORIAL.autoPerChar * fill(l.text).length) * 1000);
  };
  audio.onended = () => { if (auto) next(); };
  const autoBtn = $('.auto'), showAuto = () => autoBtn.classList.toggle('on', auto);
  autoBtn.onclick = (e) => {
    e.stopPropagation();
    auto = !auto;
    try { localStorage.setItem('advAuto', auto ? '1' : '0'); } catch {}
    showAuto();
    clearTimeout(timer);
    if (auto && audio.paused) timer = window.setTimeout(next, C.TUTORIAL.autoBase * 1000);
  };
  $('.skip').onclick = (e) => { e.stopPropagation(); end(); };
  el.onclick = () => next();
  showAuto();
  next();
}
