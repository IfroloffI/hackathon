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
import { lanAddresses } from './net/lan.ts';
import { attachLlmHub, isLlmPath } from './llm/hub.ts';
import { timeseries } from './timeseries/store.ts';
import './db/db.ts';

/**
 * Один HTTP-сервер (Fastify) на порту 2567 владеет всем: REST-роутами,
 * matchmake-контрактом @colyseus/sdk, статикой и двумя WS-каналами —
 * Colyseus (state-синхронизация) и /room/{id}/connect (hello).
 * Express из пользовательского кода удалён; пакет остался зависимостью
 * @colyseus/ws-transport (статический импорт внутри самого транспорта).
 */

// Временные ряды (DuckDB) открываем до комнат: первое же событие пишется в ряд.
try {
  await timeseries.open(config.tsdbPath);
} catch (err) {
  const msg = String((err as Error)?.message ?? err);
  if (/lock/i.test(msg)) {
    const pid = /PID (\d+)/.exec(msg)?.[1];
    console.error(`\n[chronolet] Файл временных рядов ${config.tsdbPath} занят другим процессом${pid ? ` (PID ${pid})` : ''}.`);
    console.error('Скорее всего, сервер уже запущен (npm run dev или npm start в другом терминале) — остановите его и запустите снова.\n');
    process.exit(1);
  }
  throw err;
}

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
attachLlmHub(httpServer);
transport.attachToServer(httpServer, { filter: (req) => !isHelloPath(req.url) && !isLlmPath(req.url) });

new AgentService().start();

await matchMaker.accept();

startUdpBeacon(async () => {
  // берём список на каждый тик: RoomManager сам чистит записи о мёртвых комнатах
  return (await listRooms()).filter((room) => room.isPublic);
});

const app = await buildApp(httpServer);
await app.listen({ port: config.port, host: config.host });

// host 0.0.0.0 — «слушать все интерфейсы», по нему не заходят. Печатаем реальные адреса.
const urls = config.host === '0.0.0.0' ? ['localhost', ...lanAddresses()] : [config.host];
console.log(`[chronolet] сервер запущен (слушает ${config.host}:${config.port}), db=${config.dbPath}`);
for (const h of urls) console.log(`  → http://${h}:${config.port}`);
console.log(`[chronolet] временные ряды: ${config.tsdbPath}; LLM-поток: ws://<host>:${config.port}/llm/stream?token=…`);

// Остановка — дописать хвост рядов в DuckDB.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    void timeseries.close().finally(() => process.exit(0));
  });
}
