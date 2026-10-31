import http from 'node:http';
import { defineRoom, defineServer, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { CREW_ROOM } from '@chronolet/shared';
import { config } from './config.ts';
import { CrewRoom } from './rooms/CrewRoom.ts';
import { buildApp } from './http/app.ts';
import { attachHelloHub, isHelloPath } from './net/helloHub.ts';
import { startUdpBeacon } from './net/udpBeacon.ts';
import { listRooms } from './rooms/roomManager.ts';
import { AgentService } from './agents/agentService.ts';
import './db/db.ts';

/**
 * Один HTTP-сервер (Fastify) на порту 2567 владеет всем: REST-роутами,
 * matchmake-контрактом @colyseus/sdk, статикой и двумя WS-каналами —
 * Colyseus (state-синхронизация) и /room/{id}/connect (hello).
 * Express из пользовательского кода удалён; пакет остался зависимостью
 * @colyseus/ws-transport (статический импорт внутри самого транспорта).
 */

const httpServer = http.createServer();

const transport = new WebSocketTransport({
  noServer: true,
  pingInterval: 3000,
  pingMaxRetries: 2,
});

const gameServer = defineServer({
  rooms: { [CREW_ROOM]: defineRoom(CrewRoom) },
  transport,
  greet: false,
});

attachHelloHub(httpServer);
transport.attachToServer(httpServer, { filter: (req) => !isHelloPath(req.url) });

new AgentService().start();

await matchMaker.accept();

startUdpBeacon(async () => {
  // берём список на каждый тик: RoomManager сам чистит записи о мёртвых комнатах
  return (await listRooms()).filter((room) => room.isPublic);
});

const app = await buildApp(httpServer);
await app.listen({ port: config.port, host: config.host });

console.log(`[chronolet] http+ws on http://${config.host}:${config.port}  db=${config.dbPath}`);
