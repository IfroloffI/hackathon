import { schema, t, type SchemaType } from '@colyseus/schema';
/** Схема состояния комнаты — общая: сервер кодирует, клиент декодирует с теми же типами. */

/** Синхронизируемое состояние игрока. Только то, что нужно всем для рендера. */
export const PlayerState = schema(
  {
    name: t.string(),
    color: t.number(),
    x: t.number(),
    y: t.number(),
    z: t.number(),
    vx: t.number(),
    vy: t.number(),
    anim: t.string(),
    facing: t.int8(),
    connected: t.boolean(),
    /** Кошелёк VK Coin и скины — публичны: видно, кто в чём и сколько насобирал. */
    coins: t.uint32(),
    skin: t.string(),
    owned: t.array('string'),
    /** Геймификация: опыт (уровень считается из него), лайки, значки. */
    xp: t.uint32(),
    likes: t.uint32(),
    achievements: t.array('string'),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

/** Публичная часть головоломки — видна всем. Приватные данные ролей идут отдельным сообщением puzzle.view. */
export const PuzzleState = schema(
  {
    id: t.string(),
    title: t.string(),
    /** Человекочитаемый статус этапа для всех («Ночь 2 из 3»). */
    stage: t.string(),
    /** sessionId игроков на ролях, '' — роль свободна. */
    observer: t.string(),
    mechanic: t.string(),
    attempts: t.uint16(),
    hintsGiven: t.uint8(),
    solved: t.boolean(),
  },
  'PuzzleState',
);
export type PuzzleState = SchemaType<typeof PuzzleState>;

/** Текущий шаг сценария эпохи — цель для HUD. */
export const ScenarioState = schema(
  {
    id: t.string(),
    title: t.string(),
    stepId: t.string(),
    stepTitle: t.string(),
    goal: t.string(),
    stepIndex: t.uint8(),
    steps: t.uint8(),
    /** Серверное время начала шага (ms) и контрольное время (с, 0 — нет). */
    stepStartedAt: t.number(),
    parSeconds: t.uint16(),
  },
  'ScenarioState',
);
export type ScenarioState = SchemaType<typeof ScenarioState>;

/** Толкаемый ящик полосы препятствий: позицию считает только сервер (shared/src/mechanics.ts). */
export const CrateState = schema(
  {
    x: t.number(),
    y: t.number(),
  },
  'CrateState',
);
export type CrateState = SchemaType<typeof CrateState>;

export const CrewState = schema(
  {
    crewName: t.string(),
    /** Где сейчас экипаж: 'hub' или levelId эпохи. */
    levelId: t.string(),
    /** Индекс эпохи, которую экипаж проходит (= число установленных деталей). */
    epoch: t.uint8(),
    /** id полученных деталей двигателя по порядку. */
    parts: t.array('string'),
    puzzle: PuzzleState,
    scenario: ScenarioState,
    /** Двигатель починен, экипаж вернулся домой. */
    finished: t.boolean(),
    /** id собранных за сессию сфер VK Coin (на всех уровнях). */
    coinsTaken: t.array('string'),
    /** ключ — sessionId клиента Colyseus */
    players: t.map(PlayerState),
    /** Ящики текущего уровня, ключ — id ящика из Level.crates. */
    crates: t.map(CrateState),
    /** levelId эпох, где ворота у входа уже открыты (экипаж ответил NPC). */
    gatesOpen: t.array('string'),
  },
  'CrewState',
);
export type CrewState = SchemaType<typeof CrewState>;
