# Архитектура (шаблон)

```
                       одна машина-хост (npm start, порт 2567)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  Fastify (владеет http.Server, один порт 2567)                           │
 │   ├─ /            статика client/dist                                    │
 │   ├─ /auth/*      login → JWT, logout (blacklist), me (server/src/auth)  │
 │   ├─ /room*       RoomManager: POST/DELETE, disconnect (rooms/roomManager)│
 │   ├─ /api/*       rooms, sessions, health, host      (server/src/http)    │
 │   ├─ /matchmake/* wire-контракт @colyseus/sdk (Colyseus)                 │
 │   ├─ WS Colyseus  state-синхронизация (attachToServer + фильтр)          │
 │   └─ WS /room/:id/connect  hello 1 Гц «Hello world!» (net/helloHub)      │
 │                                                                          │
 │  RoomManager ──▶ UDP-beacon (node:dgram, публичные комнаты в LAN)        │
 │                                                                          │
 │  Colyseus  ── CrewRoom (одна комната = один экипаж)                      │
 │   state: CrewState { crewName, levelId, epoch, players: Map<PlayerState>}│
 │   msgs:  move, chat.say  → (дальше grab, role.take, puzzle.action …)     │
 │      │                                                                   │
 │      ├── EventBus ──▶ AgentService ──▶ Ollama :11434 (пока выключено)    │
 │      └── repositories ──▶ SQLite data/chronolet.db (node:sqlite)         │
 └──────────────────────────────────────────────────────────────────────────┘
        ▲ http + ws
 ┌──────┴───────────────────┐
 │ Браузер: Vite + three.js │  lobby → Game(scene, LocalController, RemotePlayer) + HUD
 └──────────────────────────┘
```

## Пакеты (npm workspaces)

| Пакет | Что внутри |
|---|---|
| `shared/` | Схема состояния Colyseus (`schema.ts`), протокол сообщений, DTO HTTP/WS API (`api.ts`), константы (тикрейты, физика), уровни. Импортируется и сервером, и клиентом как TS-исходники. |
| `server/` | `index.ts` — бутстрап одного http.Server; `http/app.ts` — Fastify-роуты; `auth/tokens.ts` — JWT; `rooms/CrewRoom.ts` — жизненный цикл комнаты; `rooms/movement.ts` — проверка движения; `rooms/roomManager.ts` — REST-обёртка над комнатами; `net/` — UDP-beacon, hello-hub, LAN-адреса; `db/` — миграции и репозитории; `core/eventBus.ts`; `agents/` — заготовка под ИИ. |
| `client/` | `net/connection.ts` — Colyseus SDK; `ui/` — лобби и HUD; `game/` — сцена, физика, персонажи. |

## Решения

- **Colyseus вместо голого `ws`** (отличие от раздела 6 дизайн-дока): матчмейкинг, комнаты, дельта-синхронизация state, реконнект — из коробки.
- **Схема в `shared`**: клиент передаёт `CrewState` в `create/joinById`, поэтому state на клиенте типизирован теми же классами, что и на сервере.
- **Движение — клиент-авторитетное**, как в дизайн-доке: клиент считает физику, сервер ограничивает скорость (`PHYSICS.speedTolerance`, окно ≤ 200 мс) и границы уровня. Головоломки/предметы/роли будут только серверными (намерения → сервер → state).
- **Приватные данные ролей** (Наблюдатель/Механик) — через `StateView`/`@view()` Colyseus Schema либо `client.send` адресно, но **не** в общем state.
- **Код комнаты = `roomId`** (4 символа без похожих букв), уникален и среди живых комнат, и среди сессий в БД — поэтому позиции в `player_state` привязаны к сессии.
- **Fastify владеет единственным http.Server** (отличие от первоначального решения «Express из транспорта Colyseus»): auth, RoomManager, UDP-beacon и hello-WS — на Fastify; Colyseus-транспорт прицеплен через `attachToServer` с фильтром апгрейдов, matchmake-контракт SDK воспроизведён в Fastify-роуте. `express` остался только зависимостью транспорта.
- **Auth — имя → JWT (без паролей)**: токен обязателен для REST `/room*` и hello-WS; Colyseus-комнаты пока принимают анонимный вход (переход на `static onAuth(token)` — следующий шаг).
- **RoomManager — REST-обёртка над Colyseus**, не отдельная сущность: комнаты живут в Colyseus, менеджер хранит мастера/публичность в in-memory Map.
- **Идентичность пока по имени** (`players.name UNIQUE`); `players.password_hash` — задел под логин с паролем.
- **БД пишется не на каждый `move`**: dirty-набор и пачка раз в 5 с в одной транзакции + при выходе/dispose.

## Куда добавлять механики

1. Тип сообщения → `shared/src/protocol.ts` (`ClientMsg`/`ServerMsg`).
2. Синхронизируемые поля → `shared/src/schema.ts`.
3. Обработчик → `CrewRoom.onCreate` (`this.onMessage(...)`) или отдельная система (`server/src/puzzles/*.ts`, `objects.ts`), которой комната делегирует.
4. Значимые события → `eventBus.emit(...)` — их подхватит бортовой ИИ.
5. Клиент: подписка через `net.callbacks(room)` (`onAdd/onRemove/listen/onChange`).

## Эпохи и головоломки

- **Данные** — `shared/src/epochs.ts` (порядок эпох, рассказчики, детали) и `shared/src/level.ts` (уровни: твёрдые объекты + станции взаимодействия). Клиент рисует, сервер валидирует по одним и тем же данным.
- **Станции (E)** — `observer` / `mechanic` (роль), `narrator` (реплика), `jump` (рычаг на корабле), `return` (хронолёт в эпохе). Сервер проверяет, что игрок рядом, по своей копии позиции.
- **Головоломка** — `server/src/puzzles/*.ts`, конечный автомат `Puzzle`: `act(role, action, value)` → событие (`attempt_failed` / `stage_passed` / `solved`), `stageText()` для всех, `view(role)` только для роли.
- **Асимметрия** — в общем state лежит только `PuzzleState` (заголовок, этап, кто на ролях, попытки). Приватные данные уходят сообщением `puzzle.view` лишь держателю роли. Публичные сообщения о результате — без чужих данных (есть тесты).
- **Прогресс** — деталь выдаёт только `CrewRoom.awardPart()` после `solved`. Возврат в хаб — только когда все подключённые у хронолёта. `sessions.current_epoch/parts_json` обновляются при каждом шаге.
- **Клиент** — `client/src/game/worlds/` (оформление корабля и эпох, NPC), `client/src/ui/puzzles.ts` (экраны ролей), `client/src/ui/puzzlePanel.ts` (панель: публичная шапка + приватные виды).

Новые сообщения: C→S `interact {stationId}`, `puzzle.action {action, value, role?}`; S→C `say {speaker, text, hint?}`, `puzzle.view {puzzleId, role, view}`, `teleport {levelId, x, y, z}`. В `move` добавлен `levelId` — пакеты со старого уровня после прыжка отбрасываются.

## ИИ (следующий этап)

`server/src/agents/` — `AgentService` подписан на `EventBus`, `OllamaClient` с таймаутом 3 с (null → фолбэк-реплика). Таблицы `agent_memory` и `dialog_log` уже в схеме БД. Контент агентов — `agents/<id>/persona.md`, `knowledge.json`, `fallback.json` (раздел 5.3 дизайн-дока).
