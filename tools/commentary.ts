// 実況の音声生成（VOICEVOX プロジェクトを正とする）。VOICEVOX（エンジン localhost:50021）を起動しておく
//   npm run cm:vvproj  台本（src/shared/commentary_script.json）→ tools/commentary.vvproj。文言が同じ項目は調声済みのクエリを残し、増えた・変わった項目だけクエリを作る。台本から消えた項目は削除
//   （本人が VOICEVOX エディタで tools/commentary.vvproj を開いて調声し、上書き保存）
//   npm run cm:audio   tools/commentary.vvproj の各項目のクエリをそのまま合成 → 前後の無音を削る → 1ファイルのスプライト public/commentary/cm.mp3 ＋ 表 cm.json
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCRIPT, allTexts, nameDrift } from '../src/shared/commentary';

const ENGINE = 'http://localhost:50021';
const VVPROJ = 'tools/commentary.vvproj';
const OUT_DIR = 'public/commentary';
const RATE = 24000, BITRATE = '32k'; // モノラル・低サンプルレート・低ビットレート（MP3 は iOS Safari を含む全対象ブラウザで再生できる）
const MARK = 0.1, LEAD = 0.3, GAP = 0.05; // スプライト先頭の目印（クリック）の位置・先頭の長さ・部品の間の無音(秒)
const TRIM_TH = 400, TRIM_PAD = 0.02; // 無音とみなす振幅（16bit）・削った後に残す余白(秒)
const LIMIT = 1024 * 1024; // 目標の合計サイズ

const get = async (path: string) => { const r = await fetch(ENGINE + path); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); };
const post = async (path: string, body?: any) => {
  const r = await fetch(ENGINE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r;
};

// エンジンの AudioQuery（snake_case）⇔ エディタの保存形式（camelCase、null の項目は持たない）
const toCamel = (o: any): any => Array.isArray(o) ? o.map(toCamel) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), toCamel(v)])) : o;
const toSnake = (o: any): any => Array.isArray(o) ? o.map(toSnake) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), toSnake(v)])) : o;
// クエリの最上位は camelCase のまま（エンジンもそう受け取る）、accent_phrases 以下だけ snake_case
const engineQuery = (q: any) => { const { accentPhrases, ...rest } = q; return { ...rest, accent_phrases: toSnake(accentPhrases), pauseLength: null, outputSamplingRate: RATE, outputStereo: false }; };

function warnDrift() {
  for (const w of nameDrift()) console.warn(`警告: ${w}`);
}

async function vvproj() {
  warnDrift();
  const styleId = SCRIPT.styleId;
  const speakers = await get('/speakers');
  const sp = speakers.find((s: any) => s.styles.some((x: any) => x.id === styleId));
  if (!sp) throw new Error(`スタイルID ${styleId} の話者がエンジンにいない`);
  const engineId = (await get('/engine_manifest')).uuid;
  const old = existsSync(VVPROJ) ? JSON.parse(readFileSync(VVPROJ, 'utf8')) : null;
  const byText = new Map<string, { k: string; it: any }>(); // 文言 → 既存の項目（キーも残して git の差分を小さく）
  if (old) for (const k of old.talk.audioKeys) byText.set(old.talk.audioItems[k].text, { k, it: old.talk.audioItems[k] });
  const texts = allTexts(), keys: string[] = [], items: Record<string, any> = {};
  let made = 0;
  for (const text of texts) {
    const prev = byText.get(text);
    let it = prev?.it;
    if (!it || it.voice.styleId !== styleId) {
      const q = await (await post(`/audio_query?text=${encodeURIComponent(text)}&speaker=${styleId}`)).json();
      it = { text, voice: { engineId, speakerId: sp.speaker_uuid, styleId }, query: toCamel(q) };
      delete it.query.pauseLength;
      made++;
    }
    const k = prev && prev.it === it ? prev.k : randomUUID();
    keys.push(k); items[k] = it;
  }
  const removed = old ? old.talk.audioKeys.length - (texts.length - made) : 0;
  const track = randomUUID();
  const appVersion = old?.appVersion ?? (await get('/version'));
  const proj = old ? { ...old, talk: { audioKeys: keys, audioItems: items } } : {
    appVersion,
    talk: { audioKeys: keys, audioItems: items },
    song: { tpqn: 480, tempos: [{ position: 0, bpm: 120 }], timeSignatures: [{ measureNumber: 1, beats: 4, beatType: 4 }], tracks: { [track]: { name: '無名トラック', keyRangeAdjustment: 0, volumeRangeAdjustment: 0, notes: [], pitchEditData: [], volumeEditData: [], phonemeTimingEditData: {}, solo: false, mute: false, gain: 1, pan: 0 } }, trackOrder: [track] },
  };
  writeFileSync(VVPROJ, JSON.stringify(proj));
  console.log(`${VVPROJ}: ${texts.length}項目（新規・変更 ${made}、削除 ${removed}、調声を残した ${texts.length - made}）`);
}

// WAV（16bit PCM）→ サンプル列
function pcm(wav: Buffer) {
  let i = 12;
  while (i < wav.length) { const id = wav.toString('ascii', i, i + 4), n = wav.readUInt32LE(i + 4); if (id === 'data') return new Int16Array(wav.buffer.slice(wav.byteOffset + i + 8, wav.byteOffset + i + 8 + n)); i += 8 + n; }
  throw new Error('WAV に data がない');
}
// 前後の無音を削る
function trim(s: Int16Array) {
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]) < TRIM_TH) a++;
  while (b > a && Math.abs(s[b]) < TRIM_TH) b--;
  const pad = Math.round(TRIM_PAD * RATE);
  return s.slice(Math.max(0, a - pad), Math.min(s.length, b + pad + 1));
}

async function audio() {
  warnDrift();
  if (!existsSync(VVPROJ)) throw new Error(`${VVPROJ} がない。先に npm run cm:vvproj`);
  const proj = JSON.parse(readFileSync(VVPROJ, 'utf8')), want = new Set(allTexts());
  const cache = join(tmpdir(), 'kiritan_cm_cache');
  mkdirSync(cache, { recursive: true });
  const parts: Int16Array[] = [], table: Record<string, [number, number]> = {};
  const lead = new Int16Array(Math.round(LEAD * RATE));
  lead[Math.round(MARK * RATE)] = 32000; // デコードのずれを測る目印
  parts.push(lead);
  let pos = lead.length, got = new Set<string>();
  for (const k of proj.talk.audioKeys) {
    const it = proj.talk.audioItems[k];
    if (!want.has(it.text) || got.has(it.text)) continue;
    if (!it.query) throw new Error(`「${it.text}」にクエリがない`);
    const q = engineQuery(it.query), key = createHash('sha1').update(JSON.stringify([it.voice.styleId, q])).digest('hex'), file = join(cache, `${key}.wav`);
    if (!existsSync(file)) writeFileSync(file, Buffer.from(await (await post(`/synthesis?speaker=${it.voice.styleId}`, q)).arrayBuffer()));
    const s = trim(pcm(readFileSync(file)));
    table[it.text] = [+(pos / RATE).toFixed(4), +(s.length / RATE).toFixed(4)];
    parts.push(s, new Int16Array(Math.round(GAP * RATE)));
    pos += s.length + Math.round(GAP * RATE);
    got.add(it.text);
  }
  const missing = [...want].filter((t) => !got.has(t));
  if (missing.length) console.warn(`警告: vvproj にない部品 ${missing.length}件（npm run cm:vvproj を先に）: ${missing.slice(0, 10).join(' / ')}`);
  const raw = join(cache, 'sprite.raw');
  const all = new Int16Array(pos);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  writeFileSync(raw, Buffer.from(all.buffer));
  mkdirSync(OUT_DIR, { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', raw, '-codec:a', 'libmp3lame', '-b:a', BITRATE, `${OUT_DIR}/cm.mp3`]);
  writeFileSync(`${OUT_DIR}/cm.json`, JSON.stringify({ mark: MARK, clips: table }));
  const size = statSync(`${OUT_DIR}/cm.mp3`).size + statSync(`${OUT_DIR}/cm.json`).size;
  console.log(`${OUT_DIR}/cm.mp3 + cm.json: ${got.size}部品、${(pos / RATE).toFixed(1)}秒、合計 ${(size / 1024).toFixed(0)}KB${size > LIMIT ? '（目標1MBを超えた）' : ''}`);
}

const cmd = process.argv[2];
(cmd === 'vvproj' ? vvproj() : cmd === 'audio' ? audio() : Promise.reject(new Error('使い方: tsx tools/commentary.ts vvproj|audio'))).catch((e) => { console.error(e.message ?? e); process.exit(1); });
