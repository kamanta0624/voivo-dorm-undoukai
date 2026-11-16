// 実況: サーバー・クライアント・音声生成スクリプトで共通の、台本の読み方（docs/commentary_spec.md）
import SCRIPT from './commentary_script.json';
import CHATTER from './commentary_chatter.json'; // 雑談（docs/commentary_chatter.md から npm run cm:vvproj が書き出す）
import MAP from './map.json';
import CHARS_JSON from './chars.json';
import { CHARS, BOSS_CHAR } from './chars';
import { CONFIG as C } from './config';

export { SCRIPT, CHATTER };
// 組の色 → チームの対応（陣営0＝あんこもん側＝だいだい組、陣営1＝ずんだもん側＝みどり組）
export const TEAM_GUMI = ['daidai', 'midori'];
const ROOM_TEAM: Record<string, number> = { L: 0, R: 1 }; // map.json の部屋 id の接尾辞 → 陣営

// セリフ1つ: k=イベントキー、p=パターンの添字、a=部品の引数（キャラ・組・技・場所・数のID。座標は送らない）
export type Args = { A?: string; B?: string; C?: string; 組?: number[]; 大将?: number; 助っ人?: string; 技?: string; 場所?: string; n?: number; m?: number };
export type Say = { k: string; p: number; a: Args };
// 発話（前置き＋続くセリフ、本文＋一言は1つの発話）。pr: 優先度（セリフの切れ目で、待っている中から高いものを選ぶ。割り込みはしない）、fill: つなぎ（再生が遅れたら飛ばしてよい）
export type Utter = { pr: number; s: Say[]; fill?: boolean };

// 優先度: 決着・試合後 ＞ 全員反省中 ＞ 6章の全体 ＞ フォーカス中の撃破・まとめ ＞ 前置き・接敵・合流・連続・盤面 ＞ 個別プレー・追跡 ＞ 進行 ＞ つなぎ（盤面コメント・雑談）
export const priority = (k: string): number => {
  if (/^(end_|rev_|mvp_|close)/.test(k)) return 8;
  if (k === 'alldown') return 7;
  if (/^(boss\d|boss_|slot_|pen_|reverse)/.test(k)) return 6;
  if (/^(kill_|add_|sum)/.test(k)) return 5;
  if (/^(pre_start|pre_move|engage_|join|multi|board_)/.test(k)) return 4;
  if (/^(play_|chase_)/.test(k)) return 3;
  if (/^(start|sit_|left)/.test(k)) return 2;
  return 1; // つなぎ・試合前
};
// 待たされても捨てないセリフ（決着・全員反省中・大将HP・撃破系（単発・連続・まとめ）・試合後）。ほかは発生から CM.drop 秒で捨てる
export const keep = (k: string) => /^(end_|rev_|mvp_|close|alldown|boss\d|kill_|add_|multi|sum)/.test(k);

// 読みの指定 {字幕|読み}: 字幕は左、音声は右
const READ = /\{([^|{}]*)\|([^{}]*)\}/g;
export const reading = (t: string) => t.replace(READ, '$2');
export const subtitle = (t: string) => t.replace(READ, '$1');
// 名前類の部品の直後の助詞は、名前の部品にくっつけて1つの部品にする（継ぎ目で助詞だけが浮かないように）
export const PARTICLES = ['の', 'が', 'を', 'に', 'と', 'は', 'も'];

// パターンの文字列 → 部品（[A] など）と定型文の並び
export const tokens = (pat: string) => pat.split(/(\[[^\]]+\])/).filter((x) => x !== '');
// イベントキー → パターンの一覧（雑談は chat:<キャラ>。1本ずつ丸ごと1つの部品）
export const patterns = (k: string): string[] => {
  if (k.startsWith('chat:')) return (CHATTER as Record<string, string[]>)[k.slice(5)] ?? [];
  return (SCRIPT.lines as Record<string, string[]>)[k] ?? [];
};

const P = SCRIPT.parts as any;
const num = (n: number) => String(Math.max(0, Math.min(20, Math.round(n))));
// クリップ（読み上げる文言。同じ文言は1つにまとめる）と字幕の組
export type Clip = { text: string; sub: string };
// キャラか助っ人（どちらも [A][B][C] に入りうる）
const who = (key: string): Clip[] => {
  if (P.char[key]) return [{ text: P.char[key].yomi, sub: (CHARS_JSON as any)[key]?.name ?? key }];
  if (P.assist[key]) return [{ text: P.assist[key].yomi, sub: C.ASSIST.units[key]?.name ?? key }];
  return [];
};
const gumi = (team: number): Clip => { const t = P.team[TEAM_GUMI[team]]; return { text: t, sub: t }; };
// 場所: 陣営側の部屋は「[組]側の[部屋]」（1つの部品）
const place = (id: string): Clip[] => {
  const m = id.match(/^(.*)_([LR])$/), base = m ? m[1] : id, text = P.place[base];
  if (!text) return [];
  if (!m) return [{ text, sub: text }];
  const g = gumi(ROOM_TEAM[m[2]]);
  return [{ text: g.text + P.side + text, sub: g.sub + P.side + text }];
};
const NAME = /^\[(A|B|C|組|大将|助っ人|技|場所|n|m)\]$/;
// 名前類の部品が取りうるすべての値（音声生成用）
function nameValues(t: string): string[] {
  const y = (o: any) => Object.values(o).map((v: any) => v.yomi);
  if (t === '[A]' || t === '[B]' || t === '[C]') return [...y(P.char), ...y(P.assist)];
  if (t === '[助っ人]') return y(P.assist);
  if (t === '[大将]') return y(P.boss);
  if (t === '[技]') return y(P.skill);
  if (t === '[組]') return Object.values(P.team) as string[];
  if (t === '[場所]') return [...new Set(MAP.rooms.map((r) => r.id))].flatMap((id) => place(id).map((c) => c.text));
  return [...Array(21).keys()].map(String);
}
// パターン → 部品の並び（名前類は token、定型文は読み・字幕）。名前類の直後の助詞は名前の部品へ移す（particle）
export function segments(pat: string): ({ name: string; particle: string } | { text: string; sub: string })[] {
  const ts = tokens(pat), out: ({ name: string; particle: string } | { text: string; sub: string })[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (!NAME.test(t)) { if (t) out.push({ text: reading(t), sub: subtitle(t) }); continue; }
    const nx = ts[i + 1], pa = nx && !NAME.test(nx) && PARTICLES.includes(nx[0]) ? nx[0] : '';
    out.push({ name: t, particle: pa });
    if (pa) ts[i + 1] = nx.slice(1);
  }
  return out;
}

// セリフ → クリップの並び（読み上げ順）。字幕の名前類は実行時の定義（chars.json・chars.ts・config）を参照する。雑談は1本で1つのクリップ
export function clips(s: Say): Clip[] {
  const pat = patterns(s.k)[s.p];
  if (pat === undefined) return [];
  if (s.k.startsWith('chat:')) return [{ text: reading(pat), sub: subtitle(pat) }];
  const out: Clip[] = [];
  let team = 0;
  for (const g of segments(pat)) {
    if (!('name' in g)) { out.push(g); continue; }
    const t = g.name, c: Clip[] = [];
    if (t === '[A]' || t === '[B]' || t === '[C]') c.push(...who((s.a as any)[t[1]] ?? ''));
    else if (t === '[組]') c.push(gumi(s.a.組?.[team++] ?? 0));
    else if (t === '[大将]') { const k = BOSS_CHAR[s.a.大将 ?? 0]; c.push({ text: P.boss[k]?.yomi ?? k, sub: (CHARS_JSON as any)[k]?.name ?? k }); }
    else if (t === '[助っ人]') c.push(...who(s.a.助っ人 ?? ''));
    else if (t === '[技]') { const k = s.a.技 ?? ''; c.push({ text: P.skill[k]?.yomi ?? '', sub: CHARS[k]?.skill.name ?? '' }); }
    else if (t === '[場所]') c.push(...place(s.a.場所 ?? ''));
    else { const v = num((t === '[n]' ? s.a.n : s.a.m) ?? 0); c.push({ text: v, sub: v }); }
    if (!c.length) { if (g.particle) out.push({ text: g.particle, sub: g.particle }); continue; }
    out.push(...c.map((x, i) => (i === c.length - 1 ? { text: x.text + g.particle, sub: x.sub + g.particle } : x)));
  }
  return out;
}

// 台本の全クリップの文言（音声生成用。同じ文言は1つ）。名前類は、台本に出てくる「名前＋助詞」の組み合わせもすべて
export function allTexts(): string[] {
  const set = new Set<string>();
  const add = (t: string) => { if (t) set.add(t); };
  for (const k of Object.keys(SCRIPT.lines)) for (const pat of patterns(k)) for (const g of segments(pat)) {
    if ('name' in g) for (const v of nameValues(g.name)) add(v + g.particle);
    else add(g.text);
  }
  for (const c of Object.keys(CHATTER)) for (const pat of patterns(`chat:${c}`)) add(reading(pat));
  return [...set];
}

// 読みを作った時点の名前と今の定義の食い違い（音声生成スクリプトが警告する）
export function nameDrift(): string[] {
  const out: string[] = [];
  const cmp = (what: string, key: string, then: string, now: string | undefined) => { if (then !== now) out.push(`${what} ${key}: 台本「${then}」→ 今「${now}」（読みの更新が要るかも）`); };
  for (const [k, v] of Object.entries(P.char) as [string, any][]) cmp('キャラ名', k, v.name, (CHARS_JSON as any)[k]?.name);
  for (const [k, v] of Object.entries(P.boss) as [string, any][]) cmp('大将名', k, v.name, (CHARS_JSON as any)[k]?.name);
  for (const [k, v] of Object.entries(P.assist) as [string, any][]) cmp('助っ人名', k, v.name, C.ASSIST.units[k]?.name);
  for (const [k, v] of Object.entries(P.skill) as [string, any][]) cmp('技名', k, v.name, CHARS[k]?.skill.name);
  return out;
}
