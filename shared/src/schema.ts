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
    solved: t.boolean(),
  },
  'PuzzleState',
);
export type PuzzleState = SchemaType<typeof PuzzleState>;

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
    /** Двигатель починен, экипаж вернулся домой. */
    finished: t.boolean(),
    /** ключ — sessionId клиента Colyseus */
    players: t.map(PlayerState),
  },
  'CrewState',
);
export type CrewState = SchemaType<typeof CrewState>;
