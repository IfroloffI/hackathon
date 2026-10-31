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
- **Игра никогда не ждёт LLM.** На отвечаемое событие сервер даёт LLM `ASK_TIMEOUT_MS = 3000` мс (вопрос) / `REACT_TIMEOUT_MS = 2500` мс (головоломка), потом сам говорит заготовку.
- **Один голос.** На отвечаемые события (`data.replyable: true`) сервер не говорит сразу, а ждёт LLM; ответ после заготовки отклоняется (`409 late`). На остальные события сервер говорит заготовками сам — LLM на них молчит.
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

## 3.3. Отвечаемые события и согласование голоса

Отвечаемые: `agent.ask`, `puzzle.failed`, `puzzle.stage`, `puzzle.solved` — только пока LLM подключена к потоку. В `data` у них (`ReplyableData`):

| Поле | Что это |
|---|---|
| `replyable: true` | ответ с `replyTo = event.seq` ждут |
| `agentId` | кто должен говорить (`ship_ai` или рассказчик) |
| `fallback` | заготовка, которая прозвучит без ответа (`null` у `agent.ask` — выбирается по памяти) |
| `hint` | у `puzzle.failed`: `{ level, text }` — подсказка, которую сервер дал бы сейчас. **Её надо перефразировать через `/llm/hint`, не придумывать свою.** Все тексты подсказок партии — в `snapshot.puzzle.hints`, следующий уровень — `nextHintLevel` |

Жизненный цикл ответа:

```
событие ──REACT/ASK_TIMEOUT──▶ заготовка (ответ после неё → 409 late)
   │
   └─ кусок с replyTo («захват», можно пустой — «печатает…»)
         ├─ final=true с текстом          → реплика LLM, заготовки не будет
         ├─ final=true с ПУСТЫМ текстом   → «отказ»: заготовка звучит сразу
         └─ нет финала STREAM_DEADLINE_MS (15 с) → сервер закрывает накопленным текстом (или заготовкой)
```

Подсказка засчитывается в `hintsGiven` один раз — тем путём, которым прозвучала (заготовка или `/llm/hint`).

## 4. REST: LLM → сервер

| Метод | Путь | Тело / параметры | Ответ |
|---|---|---|---|
| POST | `/llm/say` | `LlmSayRequest` | `LlmAck`; `409` — опоздал (заготовка уже прозвучала) |
| POST | `/llm/hint` | `LlmHintRequest` (+ `replyTo`, `streamId`, `final`) | `LlmAck`; `409` — опоздал |
| POST | `/llm/memory` | `LlmMemoryRequest` | `{ ok }` |
| GET | `/llm/memory/:agentId/:playerId` | — | `LlmMemory` |
| GET | `/llm/content` | — | агенты (`persona`, `knowsUntil`, `maxChars`), сценарии, типы событий, головоломки (что видит/делает каждая роль) |
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

## 8. Реализация: `agent-service/` + Ollama

`docker compose up -d` поднимает Ollama с `qwen2.5:3b` и `agent-service` (TypeScript, Node 22). Сервис:
слушает поток (с догоном по `since`), отвечает на отвечаемые события и простой (`idle`), собирает промпт
из `persona` + снимка (`puzzle.stage`, `attempts`, `scenario.goal`, `crew.idleSeconds`) + ленты недавних событий
+ памяти игрока, стримит ответ Ollama кусками, перефразирует подсказки партии (числа обязаны сохраниться — иначе отказ),
пишет память. Лог каждой реплики: `source=llm|fallback|timeout`, `ttft`, `total`. Подробнее — `agent-service/README.md`.

## 9. Как проверить

```bash
npm run dev                                   # сервер с LLM_SERVICE_TOKEN=dev-llm-token
npm run llm-contract -w server                # с встроенным образцом + ручные проверки (захват, отказ, late, срок, подсказки)
docker compose up -d                          # настоящий сервис
LLM_EXTERNAL=1 npm run llm-contract -w server # тот же контракт против настоящего сервиса
```
