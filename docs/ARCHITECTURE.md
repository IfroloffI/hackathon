# Архитектура (шаблон)

```
                       одна машина-хост (npm start, порт 2567)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  Express (через Colyseus)                                                │
 │   ├─ /            статика client/dist                                     │
 │   ├─ /api/*       rooms, sessions, health            (server/src/http)    │
 │   └─ /matchmake/* create / joinById                  (Colyseus)           │
 │                                                                          │
 │  Colyseus  ── WebSocket ──  CrewRoom (одна комната = один экипаж)        │
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
| `shared/` | Схема состояния Colyseus (`schema.ts`), протокол сообщений, константы (тикрейты, физика), уровни. Импортируется и сервером, и клиентом как TS-исходники. |
| `server/` | `index.ts` — `defineServer`; `rooms/CrewRoom.ts` — жизненный цикл комнаты; `rooms/movement.ts` — проверка движения; `db/` — миграции и репозитории; `core/eventBus.ts`; `agents/` — заготовка под ИИ. |
| `client/` | `net/connection.ts` — Colyseus SDK; `ui/` — лобби и HUD; `game/` — сцена, физика, персонажи. |

## Решения

- **Colyseus вместо голого `ws`** (отличие от раздела 6 дизайн-дока): матчмейкинг, комнаты, дельта-синхронизация state, реконнект — из коробки.
- **Схема в `shared`**: клиент передаёт `CrewState` в `create/joinById`, поэтому state на клиенте типизирован теми же классами, что и на сервере.
- **Движение — клиент-авторитетное**, как в дизайн-доке: клиент считает физику, сервер ограничивает скорость (`PHYSICS.speedTolerance`, окно ≤ 200 мс) и границы уровня. Головоломки/предметы/роли будут только серверными (намерения → сервер → state).
- **Приватные данные ролей** (Наблюдатель/Механик) — через `StateView`/`@view()` Colyseus Schema либо `client.send` адресно, но **не** в общем state.
- **Код комнаты = `roomId`** (4 символа без похожих букв), уникален и среди живых комнат, и среди сессий в БД — поэтому позиции в `player_state` привязаны к сессии.
- **Идентичность пока по имени** (`players.name UNIQUE`). Логин/пароль → JWT встраивается через `onAuth` комнаты (`static onAuth(token)`), остальной код не меняется.
- **БД пишется не на каждый `move`**: dirty-набор и пачка раз в 5 с в одной транзакции + при выходе/dispose.

## Куда добавлять механики

1. Тип сообщения → `shared/src/protocol.ts` (`ClientMsg`/`ServerMsg`).
2. Синхронизируемые поля → `shared/src/schema.ts`.
3. Обработчик → `CrewRoom.onCreate` (`this.onMessage(...)`) или отдельная система (`server/src/puzzles/*.ts`, `objects.ts`), которой комната делегирует.
4. Значимые события → `eventBus.emit(...)` — их подхватит бортовой ИИ.
5. Клиент: подписка через `net.callbacks(room)` (`onAdd/onRemove/listen/onChange`).

## ИИ (следующий этап)

`server/src/agents/` — `AgentService` подписан на `EventBus`, `OllamaClient` с таймаутом 3 с (null → фолбэк-реплика). Таблицы `agent_memory` и `dialog_log` уже в схеме БД. Контент агентов — `agents/<id>/persona.md`, `knowledge.json`, `fallback.json` (раздел 5.3 дизайн-дока).
