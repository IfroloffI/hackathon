import { Room, matchMaker, type Client } from 'colyseus';
import {
  ClientMsg,
  EPOCHS,
  HUB_LEVEL,
  MAX_CREW,
  PATCH_RATE_MS,
  PERSIST_INTERVAL_MS,
  RECONNECT_GRACE_S,
  SHIP_AI,
  ServerMsg,
  colorForName,
  epochByLevel,
  getLevel,
  isNearStation,
  type ChatBroadcast,
  type CreateOptions,
  type CrewRoomMetadata,
  type JoinOptions,
  type Level,
  type PuzzleActionPayload,
  type PuzzleViewMessage,
  type Role,
  type SayPayload,
  type TeleportPayload,
  CrewState,
  PlayerState,
  PuzzleState,
} from '@chronolet/shared';

import { sanitizeMove } from './movement.ts';
import { eventsLog, playerState, players, rolesPlayed, sessions } from '../db/repositories.ts';
import { eventBus } from '../core/eventBus.ts';
import { createPuzzle, type ActionResult, type Puzzle } from '../puzzles/index.ts';
import { NARRATOR_LINES, SHIP_AI_EVENTS } from '../agents/lines.ts';
import { nextLine } from '../agents/memory.ts';
import { config } from '../config.ts';

interface ClientData {
  playerId: string;
  name: string;
  lastMoveAt: number;
}

type CrewClient = Client<{ userData: ClientData }>;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROLE_NAME: Record<Role, string> = { observer: 'Наблюдатель', mechanic: 'Механик' };
/** «На борту» в эпохе — в пределах этого расстояния от станции возврата. */
const BOARDING_RADIUS = 5;

function normalizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 20) : '';
  if (!name) throw new Error('Нужно имя игрока');
  return name;
}

/** Номер уровня для player_state.epoch: 0 — корабль, 1..5 — эпохи. */
const levelOrdinal = (levelId: string) => (epochByLevel(levelId)?.index ?? -1) + 1;

/**
 * Комната экипажа = игровая сессия из дизайн-дока.
 * Корабль (хаб) → эпоха → головоломка на двоих → деталь → возврат на корабль → следующая эпоха → финал.
 * Всё, что влияет на прогресс (роли, головоломки, детали, прыжки), решает только сервер.
 */
export class CrewRoom extends Room<{ state: CrewState; metadata: CrewRoomMetadata }> {
  maxClients = MAX_CREW;
  state = new CrewState();

  private level: Level = HUB_LEVEL;
  private puzzle: Puzzle | null = null;
  private dirty = new Set<string>();

  /** Короткий код комнаты вместо случайного id — его диктуют соседу по столу. */
  private async generateCode(): Promise<string> {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!sessions.get(code) && !(await matchMaker.getRoomById(code))) return code;
    }
  }

  async onCreate(options: CreateOptions) {
    this.roomId = await this.generateCode();
    const hostName = normalizeName(options.name);
    const crewName = (options.crewName?.trim() || `Экипаж ${hostName}`).slice(0, 40);

    this.state.crewName = crewName;
    this.state.levelId = this.level.id;
    this.state.epoch = 0;
    this.state.puzzle = new PuzzleState();
    this.setPatchRate(PATCH_RATE_MS);
    await this.setMetadata({ crewName, hostName, epoch: 0 });

    sessions.create(this.roomId, crewName, players.findOrCreate(hostName).id);
    eventBus.emit({ type: 'session.created', sessionId: this.roomId, crewName });

    this.onMessage(ClientMsg.Move, (client: CrewClient, msg: unknown) => this.handleMove(client, msg));
    this.onMessage(ClientMsg.Chat, (client: CrewClient, msg: unknown) => this.handleChat(client, msg));
    this.onMessage(ClientMsg.Interact, (client: CrewClient, msg: unknown) => this.handleInteract(client, msg));
    this.onMessage(ClientMsg.PuzzleAction, (client: CrewClient, msg: unknown) => this.handlePuzzleAction(client, msg));

    this.clock.setInterval(() => this.persistPositions(), PERSIST_INTERVAL_MS);
  }

  onAuth(_client: Client, options: JoinOptions) {
    const name = normalizeName(options?.name);
    for (const p of this.state.players.values()) {
      if (p.name === name && p.connected) throw new Error(`Имя «${name}» уже занято в этой комнате`);
    }
    return { name };
  }

  onJoin(client: CrewClient, _options: JoinOptions, auth: { name: string }) {
    const player = players.findOrCreate(auth.name);
    client.userData = { playerId: player.id, name: player.name, lastMoveAt: Date.now() };

    // Вернулся в ту же сессию и на тот же уровень — восстанавливаем позицию из БД.
    const saved = playerState.load(player.id, this.roomId);
    const spawn = saved && saved.epoch === levelOrdinal(this.level.id) ? saved : this.spawnPoint(this.state.players.size);

    this.state.players.set(
      client.sessionId,
      new PlayerState({
        name: player.name,
        color: colorForName(player.name),
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        vx: 0,
        vy: 0,
        anim: 'idle',
        facing: 1,
        connected: true,
      }),
    );
    this.dirty.add(client.sessionId);

    eventsLog.write(this.roomId, player.id, 'player.join', { restored: !!saved });
    eventBus.emit({ type: 'player.join', sessionId: this.roomId, playerId: player.id, name: player.name });
    this.broadcast(ServerMsg.System, { text: `${player.name} на борту` });
  }

  async onDrop(client: CrewClient) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    await this.allowReconnection(client, RECONNECT_GRACE_S);
  }

  onReconnect(client: CrewClient) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = true;
    this.sendViewsTo(client);
  }

  onLeave(client: CrewClient) {
    const data = client.userData;
    const p = this.state.players.get(client.sessionId);
    if (data && p) {
      playerState.saveMany(this.roomId, [
        { playerId: data.playerId, x: p.x, y: p.y, z: p.z, epoch: levelOrdinal(this.level.id) },
      ]);
      eventsLog.write(this.roomId, data.playerId, 'player.leave');
      eventBus.emit({ type: 'player.leave', sessionId: this.roomId, playerId: data.playerId, name: data.name });
      this.broadcast(ServerMsg.System, { text: `${data.name} покинул корабль` });
    }
    // Ушедший освобождает роли — головоломку могут продолжить другие.
    const pz = this.state.puzzle;
    if (pz.observer === client.sessionId) pz.observer = '';
    if (pz.mechanic === client.sessionId) pz.mechanic = '';
    this.state.players.delete(client.sessionId);
    this.dirty.delete(client.sessionId);
  }

  onDispose() {
    this.persistPositions();
    sessions.setProgress(this.roomId, this.state.epoch, [...this.state.parts]);
    sessions.finish(this.roomId);
    eventBus.emit({ type: 'session.disposed', sessionId: this.roomId });
  }

  // ───────────────────────── движение и чат

  private handleMove(client: CrewClient, msg: unknown) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !client.userData) return;
    // Пакеты, посчитанные ещё на прошлом уровне (в полёте во время прыжка), отбрасываем.
    if ((msg as { levelId?: unknown })?.levelId !== this.level.id) return;
    const now = Date.now();
    const move = sanitizeMove(msg, p, now - client.userData.lastMoveAt, this.level);
    client.userData.lastMoveAt = now;
    if (!move) return;

    p.x = move.x;
    p.y = move.y;
    p.z = move.z;
    p.vx = move.vx;
    p.vy = move.vy;
    p.anim = move.anim;
    p.facing = move.facing;
    this.dirty.add(client.sessionId);
  }

  private handleChat(client: CrewClient, msg: unknown) {
    const text = typeof (msg as { text?: unknown })?.text === 'string' ? (msg as { text: string }).text.trim().slice(0, 300) : '';
    if (!text || !client.userData) return;
    const { playerId, name } = client.userData;
    const payload: ChatBroadcast = { from: client.sessionId, name, text, ts: Date.now() };
    this.broadcast(ServerMsg.Chat, payload);
    eventsLog.write(this.roomId, playerId, 'chat', { text });
    eventBus.emit({ type: 'chat', sessionId: this.roomId, playerId, name, text });
  }

  // ───────────────────────── станции (клавиша E)

  private handleInteract(client: CrewClient, msg: unknown) {
    const stationId = (msg as { stationId?: unknown })?.stationId;
    const station = this.level.stations.find((s) => s.id === stationId);
    const p = this.state.players.get(client.sessionId);
    if (!station || !p || !client.userData) return;
    // Позиция — серверная, так что «нажать» станцию издалека нельзя.
    if (!isNearStation(station, p)) return;

    switch (station.kind) {
      case 'narrator': {
        const agent = station.agent ?? SHIP_AI.id;
        const lines = NARRATOR_LINES[agent];
        if (!lines) return;
        const speaker = agent === SHIP_AI.id ? SHIP_AI.name : (epochByLevel(this.level.id)?.narrator.name ?? agent);
        const text = nextLine(agent, client.userData.playerId, lines);
        client.send(ServerMsg.Say, { agentId: agent, speaker, text } satisfies SayPayload);
        return;
      }
      case 'observer':
      case 'mechanic':
        return this.toggleRole(client, station.kind);
      case 'jump':
        return this.jumpFromHub();
      case 'return':
        return this.returnToShip(station);
    }
  }

  private toggleRole(client: CrewClient, role: Role) {
    if (!this.puzzle || this.puzzle.solved) return;
    const pz = this.state.puzzle;
    const sid = client.sessionId;
    const other: Role = role === 'observer' ? 'mechanic' : 'observer';

    if (pz[role] === sid) {
      pz[role] = '';
      client.send(ServerMsg.PuzzleView, { puzzleId: this.puzzle.id, role: null, view: null } satisfies PuzzleViewMessage);
      this.broadcast(ServerMsg.System, { text: `${client.userData!.name} оставил роль «${ROLE_NAME[role]}»` });
      this.sendViewsTo(client);
      return;
    }
    if (pz[role]) {
      const holder = this.state.players.get(pz[role])?.name ?? '…';
      client.send(ServerMsg.System, { text: `Роль «${ROLE_NAME[role]}» уже занята: ${holder}` });
      return;
    }
    // Один игрок — одна роль: головоломки решаются только вдвоём (кроме режима разработки).
    if (pz[other] === sid && !config.soloRoles) pz[other] = '';
    pz[role] = sid;
    rolesPlayed.increment(client.userData!.playerId, this.roomId, role);
    this.shipSay(SHIP_AI_EVENTS.roleTaken(client.userData!.name, ROLE_NAME[role]));
    if (pz[other] !== sid) client.send(ServerMsg.PuzzleView, { puzzleId: this.puzzle.id, role: null, view: null });
    this.sendViewsTo(client);
  }

  private jumpFromHub() {
    if (this.level.id !== HUB_LEVEL.id || this.state.finished) return;
    if (this.state.epoch >= EPOCHS.length) {
      this.state.finished = true;
      this.shipSay(SHIP_AI_EVENTS.finale);
      sessions.setProgress(this.roomId, this.state.epoch, [...this.state.parts]);
      eventsLog.write(this.roomId, null, 'finale');
      return;
    }
    const epoch = EPOCHS[this.state.epoch];
    this.enterLevel(epoch.levelId);
    this.shipSay(SHIP_AI_EVENTS.epochEnter(`${epoch.title}, ${epoch.year}`));
    this.shipSay(`Поговорите с местным: ${epoch.narrator.name}. Он объяснит задачу.`);
  }

  private returnToShip(station: { x: number }) {
    if (!this.puzzle?.solved) {
      this.shipSay(SHIP_AI_EVENTS.jumpLocked);
      return;
    }
    // «Прыжок возможен, когда все игроки на борту» — все подключённые у корабля.
    const missing = [...this.state.players.values()]
      .filter((p) => p.connected && Math.abs(p.x - station.x) > BOARDING_RADIUS)
      .map((p) => p.name);
    if (missing.length) {
      this.shipSay(SHIP_AI_EVENTS.notAllAboard(missing));
      return;
    }
    const part = EPOCHS[this.state.epoch - 1]?.part;
    this.enterLevel(HUB_LEVEL.id);
    if (part) this.shipSay(SHIP_AI_EVENTS.partInstalled(part.name, this.state.parts.length));
    if (this.state.epoch >= EPOCHS.length) this.shipSay('Все детали на месте. Дёрните рычаг — летим домой.');
  }

  /** Смена уровня для всего экипажа: позиции, головоломка, роли. */
  private enterLevel(levelId: string) {
    this.persistPositions();
    this.level = getLevel(levelId);
    this.state.levelId = this.level.id;

    const epoch = epochByLevel(levelId);
    this.puzzle = epoch ? createPuzzle(epoch.puzzle.id) : null;
    const pz = this.state.puzzle;
    pz.id = this.puzzle?.id ?? '';
    pz.title = epoch?.puzzle.title ?? '';
    pz.observer = '';
    pz.mechanic = '';
    pz.attempts = 0;
    pz.solved = false;
    pz.stage = this.puzzle?.stageText() ?? '';

    let i = 0;
    for (const client of this.clients as unknown as CrewClient[]) {
      const p = this.state.players.get(client.sessionId);
      if (!p) continue;
      const spot = this.spawnPoint(i++);
      Object.assign(p, { ...spot, vx: 0, vy: 0, anim: 'idle' });
      if (client.userData) client.userData.lastMoveAt = Date.now();
      client.send(ServerMsg.Teleport, { levelId: this.level.id, ...spot } satisfies TeleportPayload);
      client.send(ServerMsg.PuzzleView, { puzzleId: pz.id as never, role: null, view: null } satisfies PuzzleViewMessage);
      this.dirty.add(client.sessionId);
    }

    void this.setMetadata({ ...this.metadata, epoch: this.state.epoch });
    sessions.setProgress(this.roomId, this.state.epoch, [...this.state.parts]);
    eventsLog.write(this.roomId, null, 'epoch.change', { levelId });
    eventBus.emit({ type: 'epoch.change', sessionId: this.roomId, levelId });
  }

  private spawnPoint(i: number) {
    const s = this.level.spawn;
    return { x: s.x + (i % MAX_CREW) * 1.1, y: s.y, z: s.z };
  }

  // ───────────────────────── головоломка

  private handlePuzzleAction(client: CrewClient, msg: unknown) {
    if (!this.puzzle || !client.userData) return;
    const { action, value, role: wanted } = (msg ?? {}) as PuzzleActionPayload;
    if (typeof action !== 'string') return;
    const pz = this.state.puzzle;
    const held = (['observer', 'mechanic'] as Role[]).filter((r) => pz[r] === client.sessionId);
    const role = wanted && held.includes(wanted) ? wanted : held[0];
    // Действовать может только тот, кто занял роль.
    if (!role) return;

    const res = this.puzzle.act(role, action, value);
    if (!res) return;
    this.afterPuzzleAction(client, res);
  }

  private afterPuzzleAction(client: CrewClient, res: ActionResult) {
    const puzzle = this.puzzle!;
    const pz = this.state.puzzle;
    pz.stage = puzzle.stageText();
    pz.attempts = puzzle.attempts;
    pz.solved = puzzle.solved;
    if (res.message) this.broadcast(ServerMsg.System, { text: res.message });

    if (res.event) {
      const { playerId } = client.userData!;
      eventsLog.write(this.roomId, playerId, `puzzle.${res.event}`, { puzzle: puzzle.id, attempts: puzzle.attempts });
      eventBus.emit({ type: 'puzzle', sessionId: this.roomId, puzzleId: puzzle.id, event: res.event, playerId, attempts: puzzle.attempts });
    }

    if (res.event === 'attempt_failed') {
      // Подсказки по нарастающей: каждые 2 неудачи — следующий уровень (намёк → направление → почти ответ).
      const level = Math.min(3, Math.floor(puzzle.attempts / 2));
      if (puzzle.attempts % 2 === 0 && level > 0) this.shipSay(puzzle.hints[level - 1], level);
      else this.shipSay(SHIP_AI_EVENTS.attemptFailed[(puzzle.attempts - 1) % SHIP_AI_EVENTS.attemptFailed.length]);
    } else if (res.event === 'stage_passed') {
      this.shipSay(SHIP_AI_EVENTS.stagePassed);
    } else if (res.event === 'solved') {
      this.awardPart();
    }
    this.sendAllViews();
  }

  /** Деталь выдаёт только игровая логика (правило 5 дизайн-дока). */
  private awardPart() {
    const epoch = epochByLevel(this.level.id);
    if (!epoch || this.state.parts.includes(epoch.part.id)) return;
    this.state.parts.push(epoch.part.id);
    this.state.epoch = this.state.parts.length;
    sessions.setProgress(this.roomId, this.state.epoch, [...this.state.parts]);
    eventsLog.write(this.roomId, null, 'part.awarded', { part: epoch.part.id });
    eventBus.emit({ type: 'part.awarded', sessionId: this.roomId, partId: epoch.part.id });
    this.shipSay(SHIP_AI_EVENTS.solved(epoch.part.name));
  }

  /** Каждой роли — только её вид. Свободные руки видят лишь публичный stage из state. */
  private sendViewsTo(client: Client) {
    if (!this.puzzle) return;
    const pz = this.state.puzzle;
    for (const role of ['observer', 'mechanic'] as Role[]) {
      if (pz[role] !== client.sessionId) continue;
      client.send(ServerMsg.PuzzleView, { puzzleId: this.puzzle.id, role, view: this.puzzle.view(role) } satisfies PuzzleViewMessage);
    }
  }

  private sendAllViews() {
    for (const client of this.clients) this.sendViewsTo(client);
  }

  private shipSay(text: string, hint?: number) {
    this.broadcast(ServerMsg.Say, { agentId: SHIP_AI.id, speaker: SHIP_AI.name, text, hint } satisfies SayPayload);
  }

  // ───────────────────────── БД

  /** Позиции пишутся в БД пачкой раз в PERSIST_INTERVAL_MS, только у тех, кто двигался. */
  private persistPositions() {
    if (this.dirty.size === 0) return;
    const rows = [];
    const epoch = levelOrdinal(this.level.id);
    for (const sessionId of this.dirty) {
      const p = this.state.players.get(sessionId);
      const c = this.clients.getById(sessionId) as CrewClient | undefined;
      const playerId = c?.userData?.playerId;
      if (p && playerId) rows.push({ playerId, x: p.x, y: p.y, z: p.z, epoch });
    }
    this.dirty.clear();
    try {
      playerState.saveMany(this.roomId, rows);
    } catch (err) {
      console.error('[CrewRoom] persist failed', err);
    }
  }
}
