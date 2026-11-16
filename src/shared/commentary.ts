// 実況: サーバー・クライアント・音声生成スクリプトで共通の、台本の読み方（docs/commentary_spec.md）
import SCRIPT from './commentary_script.json';
import CHARS_JSON from './chars.json';
import { CHARS, BOSS_CHAR } from './chars';
import { CONFIG as C } from './config';

export { SCRIPT };
// 組の色 → チームの対応（陣営0＝あんこもん側＝だいだい組、陣営1＝ずんだもん側＝みどり組）
export const TEAM_GUMI = ['daidai', 'midori'];
const ROOM_TEAM: Record<string, number> = { L: 0, R: 1 }; // map.json の部屋 id の接尾辞 → 陣営

// セリフ1つ: k=イベントキー、p=パターンの添字、a=部品の引数（キャラ・組・技・場所・数のID。座標は送らない）
export type Args = { A?: string; B?: string; C?: string; 組?: number[]; 大将?: number; 助っ人?: string; 技?: string; 場所?: string; n?: number; m?: number };
export type Say = { k: string; p: number; a: Args };
// 発話（前置き＋続くセリフ、本文＋一言は1つの発話）。pr: 優先度（大きいほど優先、高いものは低いものを打ち切って割り込む）
export type Utter = { pr: number; s: Say[] };

// 優先度: 決着 ＞ 全員反省中 ＞ 6章の全体 ＞ フォーカス中の撃破・まとめ ＞ 前置き・接敵・合流・連続・盤面 ＞ 個別プレー・追跡 ＞ 進行 ＞ 平時の話題・小ネタ
export const priority = (k: string): number => {
  if (k.startsWith('end_')) return 8;
  if (k === 'alldown') return 7;
  if (/^(boss\d|boss_|slot_|pen_|reverse)/.test(k)) return 6;
  if (/^(kill_|add_|sum)/.test(k)) return 5;
  if (/^(pre_start|pre_move|engage_|join|multi|board_)/.test(k)) return 4;
  if (/^(play_|chase_)/.test(k)) return 3;
  if (/^(start|sit_|left)/.test(k)) return 2;
  return 1; // 平時・小ネタ・試合前（試合前は試合開始で打ち切る）
};

// パターンの文字列 → 部品（[A] など）と定型文の並び
export const tokens = (pat: string) => pat.split(/(\[[^\]]+\])/).filter((x) => x !== '');
// イベントキー → パターンの一覧（小ネタは trivia:<キャラ>）
export const patterns = (k: string): string[] => {
  if (k.startsWith('trivia:')) return (SCRIPT.trivia as Record<string, string[]>)[k.slice(7)] ?? [];
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
// 場所: 陣営側の部屋は「[組]側の[部屋]」
const place = (id: string): Clip[] => {
  const m = id.match(/^(.*)_([LR])$/), base = m ? m[1] : id, text = P.place[base];
  if (!text) return [];
  return m ? [gumi(ROOM_TEAM[m[2]]), { text: P.side, sub: P.side }, { text, sub: text }] : [{ text, sub: text }];
};

// セリフ → クリップの並び（読み上げ順）。字幕の名前類は実行時の定義（chars.json・chars.ts・config）を参照する
export function clips(s: Say): Clip[] {
  const pat = patterns(s.k)[s.p];
  if (pat === undefined) return [];
  const out: Clip[] = [];
  let team = 0;
  for (const t of tokens(pat)) {
    if (t === '[A]' || t === '[B]' || t === '[C]') out.push(...who((s.a as any)[t[1]] ?? ''));
    else if (t === '[組]') out.push(gumi(s.a.組?.[team++] ?? 0));
    else if (t === '[大将]') { const k = BOSS_CHAR[s.a.大将 ?? 0]; out.push({ text: P.boss[k]?.yomi ?? k, sub: (CHARS_JSON as any)[k]?.name ?? k }); }
    else if (t === '[助っ人]') out.push(...who(s.a.助っ人 ?? ''));
    else if (t === '[技]') { const k = s.a.技 ?? ''; out.push({ text: P.skill[k]?.yomi ?? '', sub: CHARS[k]?.skill.name ?? '' }); }
    else if (t === '[場所]') out.push(...place(s.a.場所 ?? ''));
    else if (t === '[n]' || t === '[m]') { const v = num((t === '[n]' ? s.a.n : s.a.m) ?? 0); out.push({ text: v, sub: v }); }
    else out.push({ text: t, sub: t });
  }
  return out;
}

// 台本の全クリップの文言（音声生成用。同じ文言は1つ）
export function allTexts(): string[] {
  const set = new Set<string>();
  const add = (t: string) => { if (t) set.add(t); };
  for (const k of [...Object.keys(SCRIPT.lines), ...Object.keys(SCRIPT.trivia).map((c) => `trivia:${c}`)]) {
    for (const pat of patterns(k)) for (const t of tokens(pat)) if (!/^\[.+\]$/.test(t)) add(t);
  }
  for (const v of Object.values(P.char) as any[]) add(v.yomi);
  for (const v of Object.values(P.assist) as any[]) add(v.yomi);
  for (const v of Object.values(P.boss) as any[]) add(v.yomi);
  for (const v of Object.values(P.skill) as any[]) add(v.yomi);
  for (const v of Object.values(P.team) as string[]) add(v);
  for (const v of Object.values(P.place) as string[]) add(v);
  add(P.side);
  for (let n = 0; n <= 20; n++) add(String(n));
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
