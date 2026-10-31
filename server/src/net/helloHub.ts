import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { matchMaker } from 'colyseus';
import { verifyToken } from '../auth/tokens.ts';
import { forgetRoom } from '../rooms/roomManager.ts';
import type { HelloEvent } from '@chronolet/shared';

/**
 * Отдельный от Colyseus WS-канал комнаты: GET /room/{id}/connect?token=<jwt>.
 * Сервер раз в секунду шлёт всем подключённым `HelloEvent` — «Hello world!».
 *
 * Слушатель апгрейдов регистрируется РАНЬШЕ транспорта Colyseus и владеет
 * только своим путём; остальные апгрейды пропускает нетронутыми.
 */

const HELLO_INTERVAL_MS = 1000;
const HELLO_TEXT = 'Hello world!';

const HELLO_PATH = /^\/room\/([a-zA-Z0-9_\-]{4})\/connect$/;

interface HelloClient {
  socket: WebSocket;
  roomId: string;
  playerId: string;
}

const clients = new Set<HelloClient>();

export function isHelloPath(url: string | undefined): boolean {
  return HELLO_PATH.test((url ?? '').split('?')[0] ?? '');
}

export function attachHelloHub(server: Server): void {
  server.on('upgrade', (req, socket, head) => {
    if (!isHelloPath(req.url)) { return; }
    void handleUpgrade(req, socket, head);
  });

  setInterval(broadcastHello, HELLO_INTERVAL_MS).unref();
}

async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const url = new URL(`ws://server${req.url ?? '/'}`);
  const roomId = HELLO_PATH.exec(url.pathname)?.[1];

  const reject = (status: number, message: string) => {
    socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  };

  const room = roomId !== undefined ? await matchMaker.getRoomById(roomId) : undefined;
  if (room === undefined) {
    if (roomId !== undefined) { forgetRoom(roomId); }
    return reject(404, 'Room Not Found');
  }

  const token = url.searchParams.get('token');
  const player = token !== null ? await verifyToken(token) : null;
  if (player === null) {
    return reject(401, 'Unauthorized');
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const client: HelloClient = { socket: ws, roomId: room.roomId, playerId: player.id };
    clients.add(client);
    ws.on('close', () => clients.delete(client));
    ws.on('error', () => ws.close());
    sendHello(ws);
  });
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

function broadcastHello(): void {
  for (const { socket } of clients) {
    if (socket.readyState === WebSocket.OPEN) { sendHello(socket); }
  }
}

function sendHello(socket: WebSocket): void {
  const event: HelloEvent = { type: 'hello', text: HELLO_TEXT, ts: Date.now() };
  socket.send(JSON.stringify(event));
}

/** POST /room/{id}/disconnect: закрыть все WS-каналы этого игрока в этой комнате. */
export function disconnectPlayer(roomId: string, playerId: string): number {
  let closed = 0;
  for (const client of clients) {
    if (client.roomId === roomId && client.playerId === playerId) {
      client.socket.close(1000, 'disconnected by request');
      closed++;
    }
  }
  return closed;
}

/** DELETE /room/{id}: закрыть WS-каналы всех участников комнаты. */
export function closeRoomChannels(roomId: string): void {
  for (const client of clients) {
    if (client.roomId === roomId) {
      client.socket.close(1000, 'room deleted');
    }
  }
}
