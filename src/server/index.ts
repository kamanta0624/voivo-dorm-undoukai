import express from 'express';
import { mkdirSync } from 'node:fs';
import { defineServer, defineRoom, matchMaker } from 'colyseus';
import { CONFIG } from '../shared/config';
import { GameRoom } from './GameRoom';
import * as OG from './outgame';

if (process.env.NET_MEASURE !== undefined) CONFIG.NET_MEASURE = process.env.NET_MEASURE !== '0';

GameRoom.logFile = 'logs/matches.jsonl'; // 試合ログ（サーバー単体テストは書かない）
GameRoom.matchlogDir = 'logs/matchlog'; // 試合の記録部の書き出し先（人間の試合。Bot 戦は tools/botsim.ts）
Object.assign(OG.files, { maint: 'logs/maintenance.txt', bans: 'logs/bans.json', build: process.env.SERVE_DIST ? 'dist/build.txt' : '' }); // メンテ中フラグ（あればメンテ中）・BAN一覧・配信中のビルド
mkdirSync('logs', { recursive: true });
OG.loadBans();
const rooms: GameRoom[] = []; // 常設の部屋（作った順）
const all = () => [...rooms, ...[...GameRoom.live].filter((r) => !rooms.includes(r))]; // 管理ページ用（e2e の部屋も）
const server = defineServer({
  rooms: { game: defineRoom(GameRoom).filterBy(['e2e']) }, // e2e のタブ（?e2e=<値>）は普段のプレイと別の部屋に入る（値ごとに別の部屋）
  express: (app) => {
    app.use(express.urlencoded({ extended: false }));
    app.get('/status', (_req, res) => { res.set('Cache-Control', 'no-store').json(OG.status(rooms)); });
    OG.admin(app, () => rooms, all);
    if (process.env.SERVE_DIST) app.use(express.static('dist')); // 公開（launchd）: ビルド済みクライアントを同じポートで配信
  },
});
// GAME_HOST: 待ち受けるアドレス。既定は公開（SERVE_DIST＝launchd）だけ 127.0.0.1（cloudflared からだけ受ける。sec1 F）、開発は全インターフェース（LAN の端末から http で直接つなぐ）
await server.listen(Number(process.env.GAME_PORT) || CONFIG.PORT, process.env.GAME_HOST ?? (process.env.SERVE_DIST ? '127.0.0.1' : undefined)); // GAME_PORT: 公開中のサーバーと別のポートで動かすとき（開発・検証）
// 常設の部屋を作る（以後、e2e 以外の部屋は作らせない）
for (let i = 0; i < CONFIG.ROOMS; i++) rooms.push(matchMaker.getLocalRoomById((await matchMaker.createRoom('game', {})).roomId) as GameRoom);
GameRoom.sealed = true;
