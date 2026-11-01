import { AdminMsg, AdminServerMsg, type ClientStatsPayload, type PingPayload } from '@chronolet/shared';
import type { CrewRoom } from './connection.ts';

const REPORT_MS = 1000;

/**
 * Метрики этого клиента для панели администратора: FPS (свой счётчик кадров rAF,
 * не зависит от игрового цикла), худший кадр, RTT до сервера (ping/pong по WS комнаты)
 * и память вкладки. Отчёт уходит раз в секунду у всех игроков, а не только у админа.
 */
export function startClientMetrics(room: CrewRoom): { dispose: () => void; ping: () => number; fps: () => number } {
  let frames = 0;
  let frameMax = 0;
  let prev = performance.now();
  let windowStart = prev;
  let fps = 0;
  let ping = 0;
  let raf = 0;

  const onFrame = (now: number) => {
    raf = requestAnimationFrame(onFrame);
    frames++;
    frameMax = Math.max(frameMax, now - prev);
    prev = now;
  };
  raf = requestAnimationFrame(onFrame);

  const offPong = room.onMessage(AdminServerMsg.Pong, (m: PingPayload) => {
    if (typeof m?.t === 'number') ping = Math.max(0, performance.now() - m.t);
  });

  const timer = window.setInterval(() => {
    const now = performance.now();
    fps = (frames * 1000) / Math.max(1, now - windowStart);
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const stats: ClientStatsPayload = {
      fps: Math.round(fps * 10) / 10,
      ping: Math.round(ping),
      frameMaxMs: Math.round(frameMax * 10) / 10,
      ...(mem ? { memMb: Math.round(mem.usedJSHeapSize / 2 ** 20) } : {}),
      hidden: document.hidden,
      viewport: `${innerWidth}×${innerHeight}`,
    };
    frames = 0;
    frameMax = 0;
    windowStart = now;
    try {
      room.send(AdminMsg.ClientStats, stats);
      // Следующий замер пинга: ответ придёт до следующего отчёта.
      room.send(AdminMsg.Ping, { t: performance.now() } satisfies PingPayload);
    } catch {
      /* соединение переподключается — пропускаем секунду */
    }
  }, REPORT_MS);

  return {
    dispose: () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      offPong();
    },
    ping: () => ping,
    fps: () => fps,
  };
}
