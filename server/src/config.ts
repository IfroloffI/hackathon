import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVEKIT_PORT, SERVER_PORT, UDP_BROADCAST_PORT } from '@chronolet/shared';

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
  livekit: {
    /**
     * ws(s)-URL, который получают браузеры. Если не задан — строится из
     * hostname запроса и LIVEKIT_PORT (LAN/dev: ws://<хост>:7880).
     */
    url: process.env.LIVEKIT_URL?.trim() || null,
    port: Number(process.env.LIVEKIT_PORT ?? LIVEKIT_PORT),
    /** Должны совпадать с keys в livekit/livekit.yaml. */
    apiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
    /** LiveKit отклоняет секреты короче 32 символов — держим дефолт в sync с livekit.yaml. */
    apiSecret: process.env.LIVEKIT_API_SECRET ?? 'chronolet-dev-secret-please-change-01',
    /** Время жизни токена участника. */
    ttl: process.env.LIVEKIT_TOKEN_TTL ?? '6h',
    /** Полностью отключить голос (эндпоинты вернут 503). */
    enabled: process.env.LIVEKIT_ENABLED !== '0',
  },
  /** Для разработки: один игрок может занять обе роли. На хакатоне выключено — головоломки строго на двоих. */
  soloRoles: process.env.CHRONOLET_SOLO === '1',
  /** Временные ряды (DuckDB) — отдельный файл рядом с SQLite. */
  tsdbPath: process.env.TSDB_PATH ?? path.join(root, 'data', 'chronolet.duckdb'),
  /** Сервисный токен LLM-сервиса: Bearer для /llm/*, ?token= для WS /llm/stream. */
  llmToken: process.env.LLM_SERVICE_TOKEN ?? 'dev-llm-token',
  tls: {
    /**
     * Самоподписанный dev-сертификат (scripts/cert.sh): даёт secure context
     * — микрофон и RTCPeerConnection работают не только у хоста.
     * Если файлы есть и LIVEKIT_ENABLED!==…, сервер слушает HTTPS (схема → wss).
     */
    certPath: process.env.TLS_CERT ?? path.join(root, 'livekit', 'certs', 'dev-cert.pem'),
    keyPath: process.env.TLS_KEY ?? path.join(root, 'livekit', 'certs', 'dev-key.pem'),
  },
  /** Классификатор ответов на вопросы-ворота NPC (answer-classifier/, docker compose). */
  answerClassifier: {
    enabled: process.env.ANSWER_CLASSIFIER_ENABLED !== '0',
    url: (process.env.ANSWER_CLASSIFIER_URL ?? 'http://127.0.0.1:8780').replace(/\/$/, ''),
    timeoutMs: Number(process.env.ANSWER_CLASSIFIER_TIMEOUT_MS ?? 2000),
  },
  ollama: {
    enabled: process.env.OLLAMA_ENABLED === '1',
    url: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct',
  },
};
