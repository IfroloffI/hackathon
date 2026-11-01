/** Настройки agent-сервиса (переменные окружения; значения по умолчанию — для запуска на хосте). */
export const config = {
  serverUrl: process.env.SERVER_URL ?? 'http://127.0.0.1:2567',
  token: process.env.LLM_SERVICE_TOKEN ?? 'dev-llm-token',
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL ?? 'qwen2.5:3b',
  /** Нет первого токена за это время — «отказ»: сервер сразу скажет заготовку. */
  firstTokenMs: Number(process.env.FIRST_TOKEN_MS ?? 4000),
  /** Потолок длины ответа в токенах: 1–2 предложения. */
  maxTokens: Number(process.env.MAX_TOKENS ?? 70),
  /** Как часто слать накопленный текст потоковой реплики, мс. */
  flushMs: Number(process.env.STREAM_FLUSH_MS ?? 250),
  /** Не чаще одной «инициативной» реплики ХРОНОСа (idle) на сессию, мс — дизайн-док: 8–10 с. */
  proactiveGapMs: Number(process.env.PROACTIVE_GAP_MS ?? 10000),
  /** Redis с расшифровками голоса (transcriber): поток transcripts:live и история transcripts:room:<id>. */
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6380/0',
  /** Как часто NPC сам говорит: отвечает на сказанное вслух или комментирует прогресс, мс. */
  commentGapMs: Number(process.env.COMMENT_GAP_MS ?? 10000),
  /** Сколько новых фраз нужно для реплики (0 — говорить и без новых фраз, о прогрессе). */
  commentMinPhrases: Number(process.env.COMMENT_MIN_PHRASES ?? 0),
  /** Не перебивать: после любой реплики NPC (например, подсказки по E) подождать, мс. */
  commentQuietMs: Number(process.env.COMMENT_QUIET_MS ?? 7000),
};
