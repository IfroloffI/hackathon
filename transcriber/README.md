# transcriber — расшифровка голосового чата

```
браузеры ──микрофон──▶ LiveKit (на хосте: :7880 wss для браузеров, 127.0.0.1:17880 внутри)
                            │ 1) automatic dispatch — агент в каждой новой комнате
                            │ 2) страховка раз в 15 с — досылка в комнаты, где агента нет
                            ▼
                 transcriber (LiveKit Agent, невидимый участник, ничего не публикует)
                   Silero VAD: фраза = речь до паузы ≥ 0.6 с; сплошная речь — кусками
                   ~15 с (режем в микропаузе между словами, крайний срок 20 с)
                            │ WAV 16 кГц
                            ▼
                 whisper (faster-whisper small, CPU int8) ──текст──▶ Redis (вся история)
```

Три контейнера в корневом `docker-compose.yml`: `whisper`, `redis`, `transcriber`.
LiveKit и игровой сервер — на хосте, как и раньше.

## Запуск на MacBook (хост хакатона)

Один раз, с интернетом:

```bash
brew install livekit                       # сборок LiveKit под mac в GitHub-релизах нет
bash scripts/cert.sh                       # HTTPS: без него микрофон работает только у хоста
docker compose build transcriber whisper   # образы arm64
docker compose up -d transcriber           # первый старт качает модель (~0.5 ГБ) в volume
```

Каждый раз:

```bash
npm run livekit                            # LiveKit + TLS-прокси
npm run build && npm start                 # игра
docker compose up -d transcriber           # поднимет whisper и redis по depends_on
docker compose logs -f transcriber         # фразы появляются в логе по мере расшифровки
```

Сеть на маке: агент в обычной docker-сети ходит к whisper/redis по именам сервисов, а к LiveKit —
через `host.docker.internal:17880` (Docker Desktop пробрасывает его на loopback мака); медиа идёт
на LAN-IP мака (UDP 50000–50100, TCP 7881). Docker Desktop → Settings → Resources → Memory:
стеку расшифровки хватает 2 ГБ (whisper small ~0.7 ГБ, агент ~0.5 ГБ), с Ollama в Docker — от 6 ГБ.

Если агент в Docker не достучался до LiveKit (в логе `transcriber` ошибки подключения) — запустить
его нативно, whisper и redis остаются в Docker:

```bash
cd transcriber/agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python agent.py start            # по умолчанию: LiveKit 127.0.0.1:17880, whisper :8770, redis :6380
```

## Запуск на Linux

То же, но с override-файлом (host network: на Linux LiveKit на 127.0.0.1 из docker-моста не виден,
а VPN-туннели ломают трафик хост → мост):

```bash
docker compose -f docker-compose.yml -f docker-compose.linux.yml up -d transcriber
```

## Где лежат расшифровки (Redis, без TTL, AOF на диск в volume `redis-data`)

| Ключ | Тип | Что |
|---|---|---|
| `transcripts:room:<roomId>` | LIST | JSON-записи комнаты в порядке окончания фраз |
| `transcripts:rooms` | ZSET | `roomId` → время последней фразы (мс) |
| `transcripts:live` | PUB/SUB | каждая новая запись — для realtime-потребителей |

`roomId` — id игровой комнаты Colyseus (LiveKit-комната `chronolet-<roomId>`).
С хоста Redis доступен на `127.0.0.1:6380` (на `6379` у хоста бывает свой Redis).

```json
{
  "id": "16589b6dc42d4031b4c8e5f6d2da29dc",
  "roomId": "AbC123", "livekitRoom": "chronolet-AbC123",
  "participantId": "<id игрока>", "participantName": "Тестер",
  "text": "Механик, поверни первый ротор на три деления влево.",
  "language": "ru",
  "startedAt": 1793526197948, "endedAt": 1793526205276, "durationMs": 7328
}
```

```bash
docker compose exec redis redis-cli ZRANGE transcripts:rooms 0 -1 WITHSCORES      # комнаты
docker compose exec redis redis-cli --raw LRANGE transcripts:room:<roomId> 0 -1   # история
docker compose exec redis redis-cli SUBSCRIBE transcripts:live                    # поток
```

(на Linux с override — добавить `-p 6380`)

## Модель

Замер на Linux-ноутбуке разработчика (8 ядер x86, без GPU, 4 потока, beam 5), фраза ~8 с:

| Модель | RAM | Время на фразу | Качество (ru) |
|---|---|---|---|
| **small** (по умолчанию) | ~0.7 ГБ | ~2.5 с | хорошее, мелкие ошибки в окончаниях |
| medium | ~2.5 ГБ | ~7.4 с | отличное |
| large-v3-turbo | ~2 ГБ | ~9–12 с | отличное, с пунктуацией |

На маке с 24 ГБ памяти хватит любой из них — упираемся в CPU: Docker на маке не использует GPU/Metal.
Модель должна расшифровывать быстрее, чем люди говорят, иначе очередь растёт. Проверить на маке:

```bash
WHISPER_MODEL=medium docker compose up -d whisper     # подождать healthy
time curl -s -F file=@фраза.wav http://127.0.0.1:8770/v1/audio/transcriptions
```

Если на фразу ~8 с уходит заметно меньше 4 с — можно оставить `medium`. Ручки: `WHISPER_MODEL`,
`WHISPER_CPU_THREADS` (по умолчанию 4), `WHISPER_BEAM_SIZE` (1 — в ~2 раза быстрее), `WHISPER_LANGUAGE`.
API whisper совместим с OpenAI: `POST /v1/audio/transcriptions` (multipart `file`).

## Настройки агента

| Переменная | По умолчанию | Что |
|---|---|---|
| `MAX_PHRASE_SEC` | 15 | после скольких секунд сплошной речи резать на порцию |
| `MIN_SPEECH_SEC` | 0.4 | фразы короче выбрасываются (кашель, щелчки) |
| `SWEEP_SEC` | 15 | как часто проверять комнаты без агента |
| `WHISPER_LANGUAGE` | ru | язык (пусто — автоопределение) |
