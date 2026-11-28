// マップチップの包み（mapcrypt1）: 煮の素材の規約（配布するゲームでは第三者が流用できないよう暗号化などの処理）に合わせ、元の PNG を配らず、1つのファイルにまとめて簡単な暗号化をして配る
// 公開版の URL から、そのまま使える画像が取れないようにするのが目的。鍵はクライアントに入る（割り切り）。絵の中身は変えない（戻すと元の PNG と同じバイト列）
// 作り方: npm run mapchip（tools/pack_mapchip.ts。元の素材のフォルダから public/assets/mapchip.bin を作る。どちらも git の管理外）
// 形式: 先頭 4バイト 'VVMC' ＋ 残りを鍵の列で XOR。残り＝個数(u16) ＋［名前の長さ(u8)・名前(UTF-8)・大きさ(u32)］×個数 ＋ PNG のバイト列を順に
export const CHIP_PACK = 'assets/mapchip.bin';
const MAGIC = [0x56, 0x56, 0x4d, 0x43]; // 'VVMC'
const SEED = 0x6e696d6f;

// 鍵の列（xorshift32）との XOR。同じ操作で包む・戻す
function xor(b: Uint8Array, from: number) {
  let s = SEED;
  for (let i = from; i < b.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; b[i] ^= s & 255; }
}

export function packChips(files: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder(), names = files.map(([n]) => enc.encode(n));
  const head = 4 + 2 + names.reduce((a, n) => a + 1 + n.length + 4, 0), out = new Uint8Array(head + files.reduce((a, [, d]) => a + d.length, 0)), v = new DataView(out.buffer);
  out.set(MAGIC, 0); v.setUint16(4, files.length, true);
  let p = 6;
  files.forEach(([, d], i) => { out[p++] = names[i].length; out.set(names[i], p); p += names[i].length; v.setUint32(p, d.length, true); p += 4; });
  for (const [, d] of files) { out.set(d, p); p += d.length; }
  xor(out, 4);
  return out;
}

// 戻す: 名前 → PNG のバイト列。形式が違えば空
export function unpackChips(buf: ArrayBuffer): Map<string, Uint8Array> {
  const b = new Uint8Array(buf.slice(0)), m = new Map<string, Uint8Array>();
  if (b.length < 6 || MAGIC.some((x, i) => b[i] !== x)) return m;
  xor(b, 4);
  const v = new DataView(b.buffer), n = v.getUint16(4, true), dec = new TextDecoder(), ents: [string, number][] = [];
  let p = 6;
  for (let i = 0; i < n; i++) { const l = b[p++]; ents.push([dec.decode(b.subarray(p, p + l)), v.getUint32(p + l, true)]); p += l + 4; }
  for (const [name, len] of ents) { m.set(name, b.subarray(p, p + len)); p += len; }
  return m;
}

// ブラウザ用: 包みを読んで、名前 → 画像（ImageBitmap）。/maptest・ルール説明のマップ全体図を作る台本で使う（本体は Phaser の読み込みに足す: main.ts）
export async function loadChipImages(url: string): Promise<Map<string, ImageBitmap>> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} がない（npm run mapchip）`);
  const out = new Map<string, ImageBitmap>();
  for (const [k, d] of unpackChips(await r.arrayBuffer())) out.set(k, await createImageBitmap(new Blob([d as BlobPart], { type: 'image/png' })));
  return out;
}
