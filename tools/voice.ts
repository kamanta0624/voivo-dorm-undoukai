// キャラボイス（出撃セリフ）の VOICEVOX プロジェクト（handoff_hud2 2章）。VOICEVOX（エンジン localhost:50021）を起動しておく
//   npm run voice:vvproj  docs/voice/sortie.csv（本人がスプレッドシートで直して置く。列: キー,キャラ,番号,セリフ,メモ）→ tools/voice_sortie.vvproj
//   文言・話者・スタイルが同じ項目は調声済みのクエリを残し、増えた・変わった項目だけクエリを作る。CSV から消えた項目は削除
//   （本人が VOICEVOX エディタで tools/voice_sortie.vvproj を開いて調声し、上書き保存）
//   話者はキャラごとの対応表（SPEAKER）。スタイルはメモ欄に VOICEVOX のスタイル名があればそれ、なければノーマル
//   npm run voice:audio   tools/voice_sortie.vvproj の各項目のクエリを合成 → 前後の無音を削る → public/voice/sortie/<key>_<番号>.mp3 ＋ 一覧 public/voice/sortie.json（キャラ key → [{ src, text }]）
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENGINE = 'http://localhost:50021';
const CSV = 'docs/voice/sortie.csv';
const VVPROJ = 'tools/voice_sortie.vvproj';
// キャラの key → VOICEVOX の話者名
const SPEAKER: Record<string, string> = {
  hanamaru: '満別花丸', whitecul: 'WhiteCUL', sayo: '小夜/SAYO', metan: '四国めたん', mochiko: 'もち子さん', aru: '猫使アル', bii: '猫使ビィ',
  ierutan: 'あいえるたん', zunko: '東北ずん子', kiritan: '東北きりたん', himari: '冥鳴ひまり', itako: '東北イタコ', yurei: 'ユーレイちゃん', sora: '九州そら',
};
const DEFAULT_STYLE = 'ノーマル';
const OUT_DIR = 'public/voice', RATE = 24000, BITRATE = '48k'; // モノラル・低サンプルレート（実況と同じ。声が主役なのでビットレートは少し上げる）
const TRIM_TH = 400, TRIM_PAD = 0.02; // 無音とみなす振幅（16bit）・削った後に残す余白(秒)
// 読みの直し（セリフの文言は変えない）。キャラkey#番号 → [直す前, 直した後]（エンジンが付けた読みのカナ。同じ文字数で置き換える）
// クエリを作る時に、直した読みをカナでエンジンに渡してアクセント句を作り直す
const READING_FIX: Record<string, [string, string]> = {
  'himari#2': ['ワアジマ', 'ハアジマ'], // はーじまーるよー: 頭の「は」が助詞の「ワ」になる
  'zunko#2': ['オヒルハ', 'オヒルワ'], // 今日のお昼はずんだもち: 助詞の「は」が「ハ」になる
  'itako#1': ['トオホクカチョ', 'トオホクケチョ'], // 東北家長女: 「家」が「カ」になる
};

const get = async (path: string) => { const r = await fetch(ENGINE + path); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); };
const toCamel = (o: any): any => Array.isArray(o) ? o.map(toCamel) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), toCamel(v)])) : o;

// CSV の行（見出しの次から）。セリフにカンマは入らない前提（入っていたら止める）
function rows() {
  const lines = readFileSync(CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  return lines.slice(1).map((l, i) => {
    const c = l.split(',');
    if (c.length !== 5) throw new Error(`${CSV} ${i + 2}行目: 列が5つでない（${c.length}）: ${l}`);
    const [key, name, no, text, memo] = c.map((x) => x.trim());
    return { key, name, no, text, memo };
  });
}

// アクセント句（camelCase・snake_case どちらでも）のモーラのカナを続けた文字列
const moraText = (aps: any[]) => aps.map((ap) => ap.moras.map((m: any) => m.text).join('')).join('');
// 読みの直し: エンジンが付けたアクセント句を AquesTalk 風のカナ（アクセント位置 '、句の区切り /、間 、）にし、カナを置き換えて作り直す
async function fixReading(aps: any[], [from, to]: [string, string], styleId: number, label: string) {
  const flat = moraText(aps), at = flat.indexOf(from);
  if (at < 0 || from.length !== to.length) throw new Error(`${label}: 読み「${flat}」に「${from}」がない（または置き換えの文字数が違う）`);
  const fixed = flat.slice(0, at) + to + flat.slice(at + from.length);
  let i = 0, kana = '';
  aps.forEach((ap, n) => {
    ap.moras.forEach((m: any, j: number) => { kana += fixed.slice(i, i + m.text.length); i += m.text.length; if (j + 1 === ap.accent) kana += "'"; }); // モーラは「キョ」のように2文字のこともある
    if (n < aps.length - 1) kana += ap.pause_mora ? '、' : '/';
  });
  const r = await fetch(`${ENGINE}/accent_phrases?text=${encodeURIComponent(kana)}&speaker=${styleId}&is_kana=true`, { method: 'POST' });
  if (!r.ok) throw new Error(`${label}: カナ「${kana}」をエンジンが受け付けない: ${r.status} ${await r.text()}`);
  return r.json();
}

async function vvproj() {
  const speakers = await get('/speakers'), engineId = (await get('/engine_manifest')).uuid;
  const old = existsSync(VVPROJ) ? JSON.parse(readFileSync(VVPROJ, 'utf8')) : null;
  const sig = (it: any) => `${it.voice.styleId}\n${it.text}`;
  const prev = new Map<string, { k: string; it: any }>();
  if (old) for (const k of old.talk.audioKeys) prev.set(sig(old.talk.audioItems[k]), { k, it: old.talk.audioItems[k] });
  const keys: string[] = [], items: Record<string, any> = {}, table: string[] = [];
  let made = 0;
  for (const r of rows()) {
    const spName = SPEAKER[r.key];
    if (!spName) throw new Error(`話者の対応表にないキャラ: ${r.key}（${r.name}）`);
    const sp = speakers.find((s: any) => s.name === spName);
    if (!sp) throw new Error(`エンジンに話者がいない: ${spName}`);
    const styleName = r.memo || DEFAULT_STYLE, st = sp.styles.find((x: any) => x.name === styleName);
    if (!st) throw new Error(`${spName} にスタイル「${styleName}」がない（${r.key} ${r.no}）`);
    const fix = READING_FIX[`${r.key}#${r.no}`], p = prev.get(`${st.id}\n${r.text}`);
    let it = p?.it, k = p?.k;
    if (it && fix && moraText(it.query.accentPhrases).includes(fix[0])) it = undefined; // 読みの直しがまだ入っていない項目は作り直す
    if (!it) {
      const q = await (await fetch(`${ENGINE}/audio_query?text=${encodeURIComponent(r.text)}&speaker=${st.id}`, { method: 'POST' })).json();
      if (fix) q.accent_phrases = await fixReading(q.accent_phrases, fix, st.id, `${r.key}#${r.no}`);
      it = { text: r.text, voice: { engineId, speakerId: sp.speaker_uuid, styleId: st.id }, query: toCamel(q) };
      delete it.query.pauseLength;
      k = randomUUID(); made++;
    }
    keys.push(k!); items[k!] = it;
    table.push(`${r.key}#${r.no} ${spName}（${styleName}）: ${r.text}`);
  }
  const removed = old ? old.talk.audioKeys.filter((k: string) => !items[k]).length : 0;
  const track = randomUUID();
  const proj = old ? { ...old, talk: { audioKeys: keys, audioItems: items } } : {
    appVersion: await get('/version'),
    talk: { audioKeys: keys, audioItems: items },
    song: { tpqn: 480, tempos: [{ position: 0, bpm: 120 }], timeSignatures: [{ measureNumber: 1, beats: 4, beatType: 4 }], tracks: { [track]: { name: '無名トラック', keyRangeAdjustment: 0, volumeRangeAdjustment: 0, notes: [], pitchEditData: [], volumeEditData: [], phonemeTimingEditData: {}, solo: false, mute: false, gain: 1, pan: 0 } }, trackOrder: [track] },
  };
  writeFileSync(VVPROJ, JSON.stringify(proj));
  console.log(table.join('\n'));
  console.log(`${VVPROJ}: ${keys.length}項目（新規・変更 ${made}、削除 ${removed}、調声を残した ${keys.length - made}）`);
}

const toSnake = (o: any): any => Array.isArray(o) ? o.map(toSnake) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), toSnake(v)])) : o;
// WAV（16bit PCM）→ サンプル列
function pcm(wav: Buffer) {
  let i = 12;
  while (i < wav.length) { const id = wav.toString('ascii', i, i + 4), n = wav.readUInt32LE(i + 4); if (id === 'data') return new Int16Array(wav.buffer.slice(wav.byteOffset + i + 8, wav.byteOffset + i + 8 + n)); i += 8 + n; }
  throw new Error('WAV に data がない');
}
function trim(s: Int16Array) {
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]) < TRIM_TH) a++;
  while (b > a && Math.abs(s[b]) < TRIM_TH) b--;
  const pad = Math.round(TRIM_PAD * RATE);
  return s.slice(Math.max(0, a - pad), Math.min(s.length, b + pad + 1));
}

async function audio() {
  if (!existsSync(VVPROJ)) throw new Error(`${VVPROJ} がない。先に npm run voice:vvproj`);
  const proj = JSON.parse(readFileSync(VVPROJ, 'utf8')), speakers = await get('/speakers');
  const byKey = new Map<string, any>(proj.talk.audioKeys.map((k: string) => { const it = proj.talk.audioItems[k]; return [`${it.voice.styleId}\n${it.text}`, it]; }));
  const tmp = join(tmpdir(), 'kiritan_voice'), dir = `${OUT_DIR}/sortie`, table: Record<string, { src: string; text: string }[]> = {};
  mkdirSync(tmp, { recursive: true }); mkdirSync(dir, { recursive: true });
  let size = 0, sec = 0;
  for (const r of rows()) {
    const sp = speakers.find((s: any) => s.name === SPEAKER[r.key]), st = sp?.styles.find((x: any) => x.name === (r.memo || DEFAULT_STYLE));
    const it = st && byKey.get(`${st.id}\n${r.text}`);
    if (!it?.query) throw new Error(`${r.key}#${r.no}「${r.text}」が vvproj にない（npm run voice:vvproj を先に）`);
    const { accentPhrases, ...rest } = it.query;
    const wav = Buffer.from(await (await fetch(`${ENGINE}/synthesis?speaker=${it.voice.styleId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...rest, accent_phrases: toSnake(accentPhrases), outputSamplingRate: RATE, outputStereo: false }) })).arrayBuffer());
    const s = trim(pcm(wav)), raw = join(tmp, `${r.key}_${r.no}.raw`), file = `${dir}/${r.key}_${r.no}.mp3`;
    writeFileSync(raw, Buffer.from(s.buffer, s.byteOffset, s.byteLength));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', raw, '-codec:a', 'libmp3lame', '-b:a', BITRATE, file]);
    (table[r.key] ??= []).push({ src: `voice/sortie/${r.key}_${r.no}.mp3`, text: r.text });
    size += statSync(file).size; sec += s.length / RATE;
  }
  writeFileSync(`${OUT_DIR}/sortie.json`, JSON.stringify(table));
  console.log(`${dir}: ${Object.values(table).flat().length}本、合計 ${sec.toFixed(1)}秒・${(size / 1024).toFixed(0)}KB ＋ ${OUT_DIR}/sortie.json`);
}

const cmd = process.argv[2];
(cmd === 'vvproj' ? vvproj() : cmd === 'audio' ? audio() : Promise.reject(new Error('使い方: tsx tools/voice.ts vvproj|audio'))).catch((e) => { console.error(e.message ?? e); process.exit(1); });
