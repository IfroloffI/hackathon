import dgram from 'node:dgram';
import { config } from '../config.ts';
import { primaryLanAddress, subnetBroadcastAddress } from './lan.ts';
import type { ManagedRoomInfo } from '@chronolet/shared';
import type { RoomBeacon } from '@chronolet/shared';

/**
 * UDP-бродкаст публичных комнат в LAN. Консюмера в браузере быть не может —
 * пакет слушает любой локальный тул (см. scripts/udp-listen.ts).
 *
 * macOS (BSD) не заворачивает исходящий broadcast в loopback: отправитель
 * не слышит свой же маяк. Поэтому пакет уходит в три цели сразу:
 * широковещательный адрес, directed broadcast подсети и 127.0.0.1 —
 * локальные слушатели гарантированно получают копию.
 */

let socket: dgram.Socket | null = null;
let timer: NodeJS.Timeout | null = null;
let loggedError = false;

function beaconTargets(): string[] {
  const targets = new Set<string>([config.udp.broadcastAddress, '127.0.0.1']);
  const subnet = subnetBroadcastAddress();
  if (subnet !== null) { targets.add(subnet); }
  return [...targets];
}

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
        const targets = beaconTargets();
        for (const room of rooms) {
          const beacon: RoomBeacon = { app: 'chronolet', roomId: room.roomId, crewName: room.crewName, ...beaconBase };
          const payload = JSON.stringify(beacon);
          for (const target of targets) {
            socket?.send(payload, config.udp.port, target);
          }
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
