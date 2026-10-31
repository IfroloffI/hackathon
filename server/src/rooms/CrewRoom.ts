import { Room, matchMaker, type Client } from 'colyseus';
import {
  ClientMsg,
  HUB_LEVEL,
  MAX_CREW,
  PATCH_RATE_MS,
  PERSIST_INTERVAL_MS,
  RECONNECT_GRACE_S,
  ServerMsg,
  colorForName,
  type ChatBroadcast,
  type CreateOptions,
  type CrewRoomMetadata,
  type JoinOptions,
  CrewState,
  PlayerState,
} from '@chronolet/shared';

import { sanitizeMove } from './movement.ts';
import { eventsLog, playerState, players, sessions } from '../db/repositories.ts';
import { eventBus } from '../core/eventBus.ts';

interface ClientData {
  playerId: string;
  name: string;
  lastMoveAt: number;
}

type CrewClient = Client<{ userData: ClientData }>;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 20) : '';
  if (!name) throw new Error('Нужно имя игрока');
  return name;
}

/**
 * Комната экипажа = игровая сессия из дизайн-дока.
 * Сейчас: вход/выход, синхронизация движения, чат, сохранение позиций в SQLite.
 * Дальше сюда подключаются системы: PuzzleEngine, ObjectSystem, смена эпох.
 */
export class CrewRoom extends Room<{ state: CrewState; metadata: CrewRoomMetadata }> {
  maxClients = MAX_CREW;
  state = new CrewState();

  private level = HUB_LEVEL;
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
    this.setPatchRate(PATCH_RATE_MS);
    await this.setMetadata({ crewName, hostName, epoch: 0 });

    sessions.create(this.roomId, crewName, players.findOrCreate(hostName).id);
    eventBus.emit({ type: 'session.created', sessionId: this.roomId, crewName });

    this.onMessage(ClientMsg.Move, (client: CrewClient, msg: unknown) => this.handleMove(client, msg));
    this.onMessage(ClientMsg.Chat, (client: CrewClient, msg: unknown) => this.handleChat(client, msg));

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

    // Вернулся в ту же сессию — восстанавливаем позицию из БД.
    const saved = playerState.load(player.id, this.roomId);
    const spawn = saved ?? this.level.spawn;

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
  }

  onLeave(client: CrewClient) {
    const data = client.userData;
    const p = this.state.players.get(client.sessionId);
    if (data && p) {
      playerState.saveMany(this.roomId, [{ playerId: data.playerId, x: p.x, y: p.y, z: p.z, epoch: this.state.epoch }]);
      eventsLog.write(this.roomId, data.playerId, 'player.leave');
      eventBus.emit({ type: 'player.leave', sessionId: this.roomId, playerId: data.playerId, name: data.name });
      this.broadcast(ServerMsg.System, { text: `${data.name} покинул корабль` });
    }
    this.state.players.delete(client.sessionId);
    this.dirty.delete(client.sessionId);
  }

  onDispose() {
    this.persistPositions();
    sessions.finish(this.roomId);
    eventBus.emit({ type: 'session.disposed', sessionId: this.roomId });
  }

  private handleMove(client: CrewClient, msg: unknown) {
    const p = this.state.players.get(client.sessionId);
    if (!p || !client.userData) return;
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

  /** Позиции пишутся в БД пачкой раз в PERSIST_INTERVAL_MS, только у тех, кто двигался. */
  private persistPositions() {
    if (this.dirty.size === 0) return;
    const rows = [];
    for (const sessionId of this.dirty) {
      const p = this.state.players.get(sessionId);
      const c = this.clients.getById(sessionId) as CrewClient | undefined;
      const playerId = c?.userData?.playerId;
      if (p && playerId) rows.push({ playerId, x: p.x, y: p.y, z: p.z, epoch: this.state.epoch });
    }
    this.dirty.clear();
    try {
      playerState.saveMany(this.roomId, rows);
    } catch (err) {
      console.error('[CrewRoom] persist failed', err);
    }
  }
}
