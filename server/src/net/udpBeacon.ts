import dgram from 'node:dgram';
import { config } from '../config.ts';
import { primaryLanAddress, subnetBroadcastAddresses } from './lan.ts';
import type { ManagedRoomInfo } from '@chronolet/shared';
import type { RoomBeacon } from '@chronolet/shared';

/**
 * UDP-бродкаст публичных комнат в LAN. Консюмера в браузере быть не может —
 * пакет слушает любой локальный тул (см. scripts/udp-listen.ts).
 *
 * Обход macOS-особенностей:
 * 1. BSD не заворачивает исходящий broadcast в loopback: отправитель не
 *    слышит свой же маяк → копия уходит на 127.0.0.1.
 * 2. 255.255.255.255 уходит по маршруту по умолчанию, а не во все подсети.
 *    Когда мак сам раздаёт сеть (Internet Sharing, bridge100), клиенты
 *    раздачи глобальный бродкаст не увидят → маяк уходит отдельным пакетом
 *    на directed broadcast КАЖДОЙ подсети.
 * 3. В каждом пакете host — адрес именно того интерфейса, чью подсеть мы
 *    адресуем: клиент из этой подсети сможет по нему зайти (при раздаче
 *    это 192.168.2.1, а не апстрим-адрес мака).
 */

/** Одна цель бродкаста: адрес-получатель и host, который кладём в beacon. */
export interface BeaconTarget {
  /** Куда шлём пакет (directed broadcast подсети / 255.255.255.255 / 127.0.0.1). */
  target: string;
  /** LAN-IP для поля host — адрес интерфейса этой подсети. */
  host: string;
}

/**
 * Чистая сборка целей (экспортирована для теста): глобальный адрес и
 * loopback получают первичный LAN-IP, каждая подсеть — адрес своего
 * интерфейса (перекрывает глобальный при совпадении, чтобы host был точным).
 */
export function buildBeaconTargets(
  primary: string,
  subnets: Array<{ address: string; broadcast: string }>,
  globalBroadcast: string,
): BeaconTarget[] {
  const byTarget = new Map<string, string>([
    [globalBroadcast, primary],
    ['127.0.0.1', primary],
  ]);
  for (const { address, broadcast } of subnets) {
    byTarget.set(broadcast, address);
  }
  return [...byTarget].map(([target, host]) => ({ target, host }));
}

function beaconTargets(): BeaconTarget[] {
  return buildBeaconTargets(primaryLanAddress(), subnetBroadcastAddresses(), config.udp.broadcastAddress);
}

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
        const targets = beaconTargets();
        const ts = Date.now();
        for (const room of rooms) {
          for (const { target, host } of targets) {
            const beacon: RoomBeacon = { app: 'chronolet', roomId: room.roomId, crewName: room.crewName, host, port: config.port, ts };
            socket?.send(JSON.stringify(beacon), config.udp.port, target);
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
