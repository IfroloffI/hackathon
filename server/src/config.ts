import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_PORT } from '@chronolet/shared';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const config = {
  port: Number(process.env.PORT ?? SERVER_PORT),
  /** 0.0.0.0 — чтобы ноутбуки в LAN видели хост. */
  host: process.env.HOST ?? '0.0.0.0',
  isProd: process.env.NODE_ENV === 'production',
  dbPath: process.env.DB_PATH ?? path.join(root, 'data', 'chronolet.db'),
  clientDist: path.join(root, 'client', 'dist'),
  /** Для разработки: один игрок может занять обе роли. На хакатоне выключено — головоломки строго на двоих. */
  soloRoles: process.env.CHRONOLET_SOLO === '1',
  ollama: {
    enabled: process.env.OLLAMA_ENABLED === '1',
    url: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct',
  },
};
