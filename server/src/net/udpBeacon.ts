import dgram from 'node:dgram';
import { config } from '../config.ts';
import { primaryLanAddress } from './lan.ts';
import type { ManagedRoomInfo } from '@chronolet/shared';
import type { RoomBeacon } from '@chronolet/shared';

/**
 * UDP-бродкаст публичных комнат в LAN. Консюмера в браузере быть не может —
 * пакет слушает любой локальный тул (см. scripts/udp-listen.ts).
 */

let socket: dgram.Socket | null = null;
let timer: NodeJS.Timeout | null = null;
let loggedError = false;

export function startUdpBeacon(getPublicRooms: () => Promise<ManagedRoomInfo[]>): void {
  if (timer !== null) { return; }

  socket = dgram.createSocket('udp4');
  socket.on('error', (err) => {
    if (!loggedError) {
      loggedError = true;
      console.warn('[udp] бродкаст недоступен:', err.message);
    }
  });
  socket.bind(() => socket?.setBroadcast(true));

  timer = setInterval(() => {
    void getPublicRooms()
      .then((rooms) => {
        const beaconBase = { host: primaryLanAddress(), port: config.port, ts: Date.now() };
        for (const room of rooms) {
          const beacon: RoomBeacon = { app: 'chronolet', roomId: room.roomId, crewName: room.crewName, ...beaconBase };
          socket?.send(JSON.stringify(beacon), config.udp.port, config.udp.broadcastAddress);
        }
      })
      .catch(() => {
        // список комнат недоступен — beacon пропускает тик
      });
  }, config.udp.intervalMs);
}

export function stopUdpBeacon(): void {
  if (timer !== null) { clearInterval(timer); timer = null; }
  socket?.close();
  socket = null;
}
