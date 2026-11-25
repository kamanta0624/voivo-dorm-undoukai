// キャラボイス（出撃セリフ）の VOICEVOX プロジェクト（handoff_hud2 2章）。VOICEVOX（エンジン localhost:50021）を起動しておく
//   npm run voice:vvproj  docs/voice/sortie.csv（本人がスプレッドシートで直して置く。列: キー,キャラ,番号,セリフ,メモ）→ tools/voice_sortie.vvproj
//   文言・話者・スタイルが同じ項目は調声済みのクエリを残し、増えた・変わった項目だけクエリを作る。CSV から消えた項目は削除
//   （本人が VOICEVOX エディタで tools/voice_sortie.vvproj を開いて調声し、上書き保存）
//   話者はキャラごとの対応表（SPEAKER）。スタイルはメモ欄に VOICEVOX のスタイル名があればそれ、なければノーマル
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const ENGINE = 'http://localhost:50021';
const CSV = 'docs/voice/sortie.csv';
const VVPROJ = 'tools/voice_sortie.vvproj';
// キャラの key → VOICEVOX の話者名
const SPEAKER: Record<string, string> = {
  hanamaru: '満別花丸', whitecul: 'WhiteCUL', sayo: '小夜/SAYO', metan: '四国めたん', mochiko: 'もち子さん', aru: '猫使アル', bii: '猫使ビィ',
  ierutan: 'あいえるたん', zunko: '東北ずん子', kiritan: '東北きりたん', himari: '冥鳴ひまり', itako: '東北イタコ', yurei: 'ユーレイちゃん', sora: '九州そら',
};
const DEFAULT_STYLE = 'ノーマル';

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
    const p = prev.get(`${st.id}\n${r.text}`);
    let it = p?.it, k = p?.k;
    if (!it) {
      const q = await (await fetch(`${ENGINE}/audio_query?text=${encodeURIComponent(r.text)}&speaker=${st.id}`, { method: 'POST' })).json();
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

const cmd = process.argv[2];
(cmd === 'vvproj' ? vvproj() : Promise.reject(new Error('使い方: tsx tools/voice.ts vvproj'))).catch((e) => { console.error(e.message ?? e); process.exit(1); });
