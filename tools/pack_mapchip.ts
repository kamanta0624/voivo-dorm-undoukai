// マップチップの包みを作る（mapcrypt1）: npm run mapchip
// 元の素材のフォルダ（MAPCHIP_SRC。既定 ~/MCP_Learning/nimonooki_マップチップ素材基本セット01_）から、本体が使う PNG（src/client/mapchip/paint.ts の CHIP_FILES）を読み、public/assets/mapchip.bin を作る
// 元の PNG は public に置かない（vite build が dist へ写し、公開版から取れてしまうため）。包み・元の素材とも git の管理外。素材は加工しない（包みを戻すと同じバイト列）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CHIP_FILES } from '../src/client/mapchip/paint';
import { CHIP_PACK, packChips, unpackChips } from '../src/client/mapchip/pack';

const SRC = process.env.MAPCHIP_SRC ?? join(homedir(), 'MCP_Learning', 'nimonooki_マップチップ素材基本セット01_');
const find = (f: string) => [join(SRC, f), join(SRC, 'オートタイル', f)].find((p) => existsSync(p));
const files: [string, Uint8Array][] = Object.values(CHIP_FILES).map((f) => { const p = find(f); if (!p) throw new Error(`素材がない: ${f}（MAPCHIP_SRC=${SRC}）`); return [f, new Uint8Array(readFileSync(p))]; });
const out = packChips(files), dst = join('public', CHIP_PACK);
const back = unpackChips(out.buffer.slice(0) as ArrayBuffer); // 戻して元と同じバイト列か確かめる
for (const [f, d] of files) if (Buffer.compare(Buffer.from(back.get(f) ?? []), Buffer.from(d))) throw new Error(`戻した結果が元と違う: ${f}`);
mkdirSync(join('public', 'assets'), { recursive: true });
writeFileSync(dst, out);
console.log(`${dst}（${out.length}B、${files.length}枚: ${files.map(([f]) => f).join('・')}）`);
if (existsSync(join('public', 'assets', 'mapchip'))) console.log('注意: public/assets/mapchip/（元の PNG）が残っている。公開版から取れるので消す');
