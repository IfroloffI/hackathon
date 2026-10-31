# Хронолёт

Кооперативная 2.5D-игра в браузере. Дизайн — [docs/chronolet-design.md](docs/chronolet-design.md), архитектура — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), подробная спецификация сделанного — [docs/SPEC.md](docs/SPEC.md).

**Один хост:** всё (сайт, WebSocket, БД, позже LLM) крутится на одной машине. Остальные ноутбуки в LAN только открывают браузер.

## Требования

- Node.js ≥ 22.13 (в `package.json` закреплён через Volta; без Volta — `nvm use 22`).
- Больше ничего: SQLite встроен в Node (`node:sqlite`), нативных сборок нет.

## Запуск

```bash
npm install

# Разработка: сервер :2567 (tsx watch) + Vite :5173 с HMR
npm run dev
# → http://localhost:5173, с других ноутбуков http://<ip-хоста>:5173

# «Боевой» режим на хакатоне: один процесс, один порт
npm run build && npm start
# → http://<ip-хоста>:2567
```

Проверка мультиплеера без браузера (сервер должен быть запущен):

```bash
npm run smoke -w server
```

## Что уже есть

- Лобби: имя, создание комнаты (4-символьный код), вход по коду или из списка открытых комнат, ссылка-приглашение `/?room=CODE`.
- Кнопка «Скопировать приглашение» в игре: ссылка всегда с LAN-IP хоста (даже если хост открыл игру как localhost) — её можно сразу кидать в чат.
- Комната-экипаж на Colyseus: до 6 игроков, синхронизация движения (клиент шлёт 20 Гц, сервер проверяет скорость/границы и рассылает патчи 20 Гц), интерполяция чужих игроков, чат, переподключение (20 с).
- SQLite: игроки, сессии, позиции (пачкой раз в 5 с и при выходе; при перезаходе в ту же комнату игрок появляется там же), журнал событий. Таблицы под память агентов уже созданы.
- three.js: 2.5D-хаб корабля, физика платформера (бег, прыжки, глубина W/S).

## HTTP API (Fastify, один порт 2567)

HTTP-слой переписан на **Fastify**: один `node:http`-сервер обслуживает и REST, и оба WebSocket-канала (Colyseus + hello). Express из пользовательского кода удалён — пакет остался только как зависимость `@colyseus/ws-transport` (статический импорт внутри транспорта).

### Auth

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/auth/login` | `{ name }` | `201 { token, player: { id, name } }` — JWT HS256 |
| POST | `/auth/logout` | — (Bearer) | `{ ok: true }` — токен уходит в in-memory blacklist |
| GET | `/auth/me` | — (Bearer) | `{ player: { id, name } }` |

Токен передавать как `Authorization: Bearer <token>`. Паролей нет: имя → токен. Без `JWT_SECRET` секрет генерируется на запуск (токены живут до перезапуска); с заданным `JWT_SECRET` его же использует `@colyseus/auth` на matchmake-роутах.

### RoomManager (роли: мастер = создатель, гости)

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/room` | `{ crewName?, isPublic? }` (Bearer) | `201 { roomId, crewName, hostPlayerId, hostName, isPublic, clients, maxClients, createdAt }` |
| GET | `/room/:id` | — (Bearer, только мастер) | `ManagedRoomInfo` |
| DELETE | `/room/:id` | — (Bearer, только мастер) | `204` — грейсфул-удаление комнаты |
| POST | `/room/:id/disconnect` | — (Bearer) | `{ closed: <n> }` — закрыть WS-каналы игрока в комнате |

Публичная комната (`isPublic: true`) бродкастится по LAN: UDP-пакет `{ app: 'chronolet', roomId, crewName, host, port, ts }` на `255.255.255.255:41234` каждые 1.5 с. Посмотреть бродкасты:

```bash
npm run udp-listen -w server
```

### WebSocket

| Канал | Назначение |
|---|---|
| `ws://…/<processId>/<roomId>?sessionId=…` | Colyseus state-синхронизация (как раньше, через SDK) |
| `ws://…/room/{id}/connect?token=<jwt>` | hello-канал: сервер раз в секунду шлёт всем `{"type":"hello","text":"Hello world!","ts":…}` |

### Matchmake

`POST /matchmake/:method/:roomName` (`create`, `join`, `joinOrCreate`, `joinById`, `reconnect`) — wire-контракт `@colyseus/sdk` сохранён, черновик клиента работает без правок.

## Переменные окружения (server)

| Переменная | По умолчанию | |
|---|---|---|
| `PORT` | `2567` | порт единственного хоста |
| `HOST` | `0.0.0.0` | слушать на всех интерфейсах (LAN) |
| `DB_PATH` | `data/chronolet.db` | файл SQLite |
| `JWT_SECRET` | — | секрет JWT; не задан — случайный на запуск |
| `JWT_TTL` | `7d` | время жизни токена (формат `jose`) |
| `UDP_BROADCAST_ADDR` | `255.255.255.255` | адрес UDP-бродкаста (`127.0.0.1` для локальной проверки) |
| `UDP_PORT` | `41234` | порт UDP-бродкаста |
| `UDP_INTERVAL_MS` | `1500` | период beacon'а |
| `OLLAMA_ENABLED` | — | `1`, чтобы включить LLM (пока заглушка) |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `qwen2.5:7b-instruct` | |
| `DEBUG_EVENTS` | — | `1` — логировать события шины |

Отладочные эндпоинты: `GET /api/host` (LAN-адреса хоста), `GET /api/rooms` (+ `isPublic`), `GET /api/managed-rooms` (Bearer), `GET /api/sessions`, `GET /api/sessions/:code` (позиции игроков из БД).
