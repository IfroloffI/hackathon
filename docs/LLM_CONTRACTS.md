# Контракт «игровой сервер ↔ realtime-LLM» · `chronolet.llm/1`

Документ для того, кто пишет LLM-сервис (рассказчики эпох и бортовой ИИ ХРОНОС).
Типы — в [`shared/src/llm.ts`](../shared/src/llm.ts) и [`shared/src/events.ts`](../shared/src/events.ts).
Рабочий образец клиента — [`server/scripts/llm-mock.ts`](../server/scripts/llm-mock.ts), проверка контракта — `npm run llm-contract -w server`.

## 1. Модель

```
                         ┌──────────── WS /llm/stream ─────────────┐
 игроки ─▶ CrewRoom ─▶ шина событий ─▶ DuckDB (events, telemetry)  │
                         │                                          ▼
                         └─▶ LLM-хаб ─────── события + снимки ─▶ LLM-сервис
                                   ◀── REST /llm/say|hint|memory ──┘
```

- **LLM подписывается на поток и сама решает, когда говорить.** Сервер не вызывает LLM.
- **Игра никогда не ждёт LLM.** На вопрос игрока сервер даёт LLM `ASK_TIMEOUT_MS = 3000` мс, потом сам отвечает заготовкой.
- **LLM отвечает за слова, не за правила.** Детали, роли, проверку решений и монеты решает только сервер. Через контракт нельзя изменить состояние игры — только сказать реплику, дать подсказку, записать память.
- Один хост, без интернета: LLM-сервис ходит на `http://<host>:2567`.

## 2. Авторизация

Сервисный токен из `LLM_SERVICE_TOKEN` (по умолчанию `dev-llm-token` — **смените на хакатоне**).

| Канал | Как передать |
|---|---|
| REST `/llm/*` | `Authorization: Bearer <token>` |
| WS `/llm/stream` | `?token=<token>` (или тот же заголовок) |

Неверный токен → `401`.

## 3. Поток `WS /llm/stream`

`ws://<host>:2567/llm/stream?token=…[&session=ABCD][&since=<seq>]`

- `session` — только одна сессия (код комнаты); без него — все.
- `since` — реплей пропущенных событий с `seq > since`, затем живой поток. Без пропусков и дублей: живые события на время реплея буферизуются.

Сообщения сервер → LLM (`LlmStreamMessage`):

| `type` | Когда | Содержимое |
|---|---|---|
| `hello` | при подключении | `protocol`, `serverTs`, `sessions[]`, `lastSeq` |
| `event` | каждое игровое событие | `event: GameEvent`, `replay?: true` для реплея |
| `snapshot` | раз в 2 с на сессию + сразу при смене уровня/шага сценария | `snapshot: SessionSnapshot` |
| `heartbeat` | раз в 10 с | `serverTs` |

**Переподключение:** запомните последний `event.seq` и подключитесь с `?since=<seq>`.

### 3.1. Событие `GameEvent`

```ts
{ seq, ts, session, type, level, scenario, step, player: { id, name } | null, data }
```

`scenario`/`step` — контекст на момент события: не нужно отдельно спрашивать, где экипаж.

| `type` | `data` | Зачем LLM |
|---|---|---|
| `session.start` / `session.end` | `crewName, host` / `parts, finished` | приветствие / итог экспедиции |
| `player.join` / `player.leave` | `restored, xp, skin` / — | поздороваться, подколоть ушедшего |
| `level.enter` | `levelId, epoch` | рассказчик эпохи представляется |
| `scenario.step` | `completed, next, elapsedSeconds, parSeconds, underPar` | похвалить темп / поторопить |
| `scenario.bonus` | `id, title, xp, coins` | отметить достижение экипажа |
| `role.take` / `role.leave` | `role` | объяснить роль игроку |
| `puzzle.action` | `puzzle, role, action, value` | видеть, что пробуют (данные ролей приватны для игроков, но не для LLM) |
| `puzzle.failed` | `puzzle, attempts, message` | **повод для подсказки** |
| `puzzle.stage` / `puzzle.solved` | `puzzle, stages` / `attempts, hints` | похвала, переход к следующему |
| `part.awarded` | `part, name` | — |
| `hint` | `level, text, source: script/llm` | не повторять уже данные подсказки |
| `agent.ask` | `agentId, text` | **игрок спросил агента — ответьте в течение 3 с** (`text` пустой = подошёл поговорить) |
| `agent.say` | `agentId, text, source, to` | история реплик |
| `chat` | `text` | контекст разговора экипажа |
| `coin.pickup`, `fall`, `idle`, `like`, `emote`, `xp`, `achievement`, `shop.buy` | см. `server/src/rooms/CrewRoom.ts` | повод для ехидных комментариев ХРОНОСа |
| `finale` | `parts` | финальная речь |

### 3.2. Снимок `SessionSnapshot`

Состояние «сейчас»: уровень, эпоха, детали, текущий шаг сценария (`goal`, `stepStartedAt`, `parSeconds`), головоломка (`stage`, `attempts`, `hintsGiven`), экипаж (роль, позиция, `idleSeconds`, `falls`, `xp`, `level`, `coins`, `skin`). Удобен для сборки промпта без истории.

## 4. REST: LLM → сервер

| Метод | Путь | Тело / параметры | Ответ |
|---|---|---|---|
| POST | `/llm/say` | `LlmSayRequest` | `LlmAck` |
| POST | `/llm/hint` | `LlmHintRequest` | `LlmAck` |
| POST | `/llm/memory` | `LlmMemoryRequest` | `{ ok }` |
| GET | `/llm/memory/:agentId/:playerId` | — | `LlmMemory` |
| GET | `/llm/content` | — | агенты (`persona`, `knowsUntil`, `maxChars`), сценарии, список типов событий |
| GET | `/llm/sessions` | — | `{ sessions: SessionSnapshot[] }` |
| GET | `/llm/sessions/:id/snapshot` | — | `SessionSnapshot` |
| GET | `/llm/sessions/:id/events` | `since`, `types=a,b`, `limit` (≤5000) | `{ events, lastSeq }` |
| GET | `/llm/sessions/:id/series` | `metric`, `bucket` (`500ms`/`10s`/`1m`), `from`, `to` (ms) | `{ metric, bucketMs, points }` |

### 4.1. Реплика `/llm/say`

```json
{ "session": "ABCD", "agentId": "galileo", "text": "…", "to": "<playerId>", "replyTo": 1452 }
```

- `to` — только этому игроку; без него — всему экипажу.
- `replyTo` — `seq` события `agent.ask`: ответ отменяет заготовку. Без него заготовка прозвучит через 3 с.
- **Стриминг:** несколько вызовов с одним `streamId`. В каждом — **накопленный** текст, в последнем `final: true`. У игрока строка «печатается»; в историю пишется только финальный текст.
- Длиннее `maxChars` агента — обрежется. Неизвестный `agentId` или игрок не в сессии → `400`.

### 4.2. Подсказка `/llm/hint`

`{ "session", "level": 1|2|3, "text", "to"? }` — реплика ХРОНОСа с пометкой «💡 Подсказка N/3». Считается в `hintsGiven`, а бонус эпохи «Без подсказок» теряется — давайте подсказки по делу. Сервер и сам даёт заготовленные подсказки каждые 2 неудачи; их видно в событиях `hint` (`source: "script"`).

### 4.3. Память `/llm/memory`

Таблица `agent_memory` (SQLite): `toldCards[]`, `mistakes[]`, `summary` на пару «агент × игрок». Заготовки сервера тоже пишут туда `toldCards` вида `script:<n>` — по ним видно, что игрок уже слышал.

## 5. Временные ряды (DuckDB)

Все события и телеметрия позиций (~5 Гц) лежат в `data/chronolet.duckdb`. Агрегаты по окнам `time_bucket` — через `/series`:

| `metric` | `key` | `values` | Пример вопроса |
|---|---|---|---|
| `events` | тип события | `count` | «сколько раз за минуту ошибались» |
| `struggle` | `crew` | `fails, hints, falls, stages` | «экипаж застрял?» — много `fails` без `stages` |
| `activity` | id игрока | `distance, samples` | «кто стоит без дела» |
| `positions` | id игрока | `x, y, z` (последняя в окне) | «кто где на уровне» |

## 6. Агенты

`GET /llm/content` → `agents`: `ship_ai` (везде), `eratosthenes`, `galileo`, `newton`, `turing`, `korolev` (у каждого свой `levelId`).
`knowsUntil` — год, после которого персонаж ничего не знает: на анахронизмы он реагирует удивлением.
Игроки обращаются к агенту клавишей E у рассказчика или в чате: `@Галилей почему Венера меняет фазы?` → событие `agent.ask` с `text`.

## 7. Поведение по умолчанию (если LLM нет или она молчит)

- Нет подключения к `/llm/stream` → заготовленные реплики сразу (`server/src/agents/lines.ts`).
- Подключена, но не ответила за 3 с на `agent.ask` → заготовка.
- Сценарные реплики ХРОНОСа (вход в эпоху, роли, детали) звучат всегда, LLM может их дополнять.

## 8. Как проверить свою реализацию

```bash
npm run dev                              # сервер с LLM_SERVICE_TOKEN=dev-llm-token
npm run llm-mock -w server               # образец LLM-сервиса: логирует поток, отвечает на вопросы
npm run llm-contract -w server           # автопроверка контракта (поток, реплей, стрим, подсказки, ряды, память, фолбэк)
```
