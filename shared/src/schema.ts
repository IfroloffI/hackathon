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

export const CrewState = schema(
  {
    crewName: t.string(),
    levelId: t.string(),
    epoch: t.uint8(),
    /** ключ — sessionId клиента Colyseus */
    players: t.map(PlayerState),
  },
  'CrewState',
);
export type CrewState = SchemaType<typeof CrewState>;
