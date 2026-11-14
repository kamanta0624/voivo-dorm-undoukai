import express from 'express';
import { defineServer, defineRoom } from 'colyseus';
import { CONFIG } from '../shared/config';
import { GameRoom } from './GameRoom';

GameRoom.logFile = 'logs/matches.jsonl'; // 試合ログ（サーバー単体テストは書かない）
const server = defineServer({
  rooms: { game: defineRoom(GameRoom).filterBy(['e2e']) }, // e2e のタブ（?e2e=<値>）は普段のプレイと別の部屋に入る（値ごとに別の部屋）
  ...(process.env.SERVE_DIST ? { express: (app) => { app.use(express.static('dist')); } } : {}), // npm run share: ビルド済みクライアントを同じポートで配信
});
server.listen(CONFIG.PORT);
