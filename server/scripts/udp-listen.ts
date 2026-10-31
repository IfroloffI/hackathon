import dgram from 'node:dgram';
import { UDP_BROADCAST_PORT } from '@chronolet/shared';
import type { RoomBeacon } from '@chronolet/shared';

/**
 * Ручной консюмер UDP-бродкаста для проверки beacon'а:
 *   npm run udp-listen -w server
 * Слушает широковещательные пакеты и печатает найденные публичные комнаты.
 */

const port = Number(process.env.UDP_PORT ?? UDP_BROADCAST_PORT);

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

socket.on('error', (err) => {
  console.error(`[udp-listen] ${err.message}`);
  process.exit(1);
});

socket.on('message', (buf, rinfo) => {
  try {
    const beacon = JSON.parse(buf.toString()) as RoomBeacon;
    if (beacon.app !== 'chronolet') { return; }
    console.log(`[udp-listen] ${beacon.roomId} «${beacon.crewName}» → ${beacon.host}:${beacon.port} (от ${rinfo.address})`);
  } catch {
    // чужие пакеты в сети игнорируем
  }
});

socket.bind(port, () => {
  socket.setBroadcast(true);
  console.log(`[udp-listen] слушаю UDP-бродкасты на 0.0.0.0:${port}…`);
});
