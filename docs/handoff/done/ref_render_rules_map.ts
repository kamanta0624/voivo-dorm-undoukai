import { createCanvas, loadImage } from '@napi-rs/canvas';
import { writeFileSync } from 'fs';
import MAP from './src/shared/map.json';
import { ROOMS } from './src/client/mapchip/chips';
import { paintMap, CHIP_FILES } from './src/client/mapchip/paint';

const T = MAP.tileSize;
const names = Object.keys(CHIP_FILES) as (keyof typeof CHIP_FILES)[];
const imgs = await Promise.all(names.map((k) => loadImage('public/assets/mapchip/' + CHIP_FILES[k])));
const pics = Object.fromEntries(names.map((k, i) => [k, imgs[i]])) as any;
const c = createCanvas(MAP.width * T, MAP.height * T);
paintMap(c.getContext('2d') as any, pics, MAP.tiles);
writeFileSync('map_full.png', c.toBuffer('image/png'));
// 部屋の中心（タイル→px）と名前
writeFileSync('rooms.json', JSON.stringify(MAP.rooms.filter((q) => ROOMS[q.id] && ROOMS[q.id].name !== '廊下').map((q) => ({ id: q.id, name: ROOMS[q.id].name, cx: ((q.rect[0] + q.rect[2] + 1) / 2) * T, cy: ((q.rect[1] + q.rect[3] + 1) / 2) * T }))));
console.log(c.width, c.height);
