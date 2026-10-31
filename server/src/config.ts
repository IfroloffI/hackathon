import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_PORT, UDP_BROADCAST_PORT } from '@chronolet/shared';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const config = {
  port: Number(process.env.PORT ?? SERVER_PORT),
  /** 0.0.0.0 — чтобы ноутбуки в LAN видели хост. */
  host: process.env.HOST ?? '0.0.0.0',
  isProd: process.env.NODE_ENV === 'production',
  dbPath: process.env.DB_PATH ?? path.join(root, 'data', 'chronolet.db'),
  clientDist: path.join(root, 'client', 'dist'),
  auth: {
    /**
     * Секрет HS256 для JWT. Если не задан — генерируется случайный на каждый
     * запуск (токены живут до перезапуска). При заданном секрете его же
     * подхватывает @colyseus/auth для проверки Bearer на matchmake.
     */
    secret: process.env.JWT_SECRET,
    /** TTL выданного токена (формат `jose` — см. SignJWT.setExpirationTime). */
    ttl: process.env.JWT_TTL ?? '7d',
  },
  udp: {
    broadcastAddress: process.env.UDP_BROADCAST_ADDR ?? '255.255.255.255',
    port: Number(process.env.UDP_PORT ?? UDP_BROADCAST_PORT),
    intervalMs: Number(process.env.UDP_INTERVAL_MS ?? 1500),
  },
  /** Для разработки: один игрок может занять обе роли. На хакатоне выключено — головоломки строго на двоих. */
  soloRoles: process.env.CHRONOLET_SOLO === '1',
  ollama: {
    enabled: process.env.OLLAMA_ENABLED === '1',
    url: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct',
  },
};
