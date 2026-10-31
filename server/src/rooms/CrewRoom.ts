import { Room, ServerError, matchMaker, type AuthContext, type Client } from 'colyseus';
import {
  AGENT_PROFILES,
  ASK_TIMEOUT_MS,
  ClientMsg,
  COIN_NAME,
  EMOTES,
  EPOCHS,
  HUB_LEVEL,
  MAX_CREW,
  PATCH_RATE_MS,
  PERSIST_INTERVAL_MS,
  RECONNECT_GRACE_S,
  SHIP_AI,
  SKINS,
  ServerMsg,
  XP,
  achievement,
  colorForName,
  epochByLevel,
  getLevel,
  getSkin,
  isNearStation,
  levelFromXp,
  touchesCoin,
  type AchievementBroadcast,
  type ChatBroadcast,
  type CoinPickup,
  type CreateOptions,
  type CrewRoomMetadata,
  type EmoteBroadcast,
  type GameEventType,
  type JoinOptions,
  type Level,
  type LikeBroadcast,
  type LlmAck,
  type LlmHintRequest,
  type LlmSayRequest,
  type PuzzleActionPayload,
  type PuzzleViewMessage,
  type Role,
  type SayPayload,
  type SessionSnapshot,
  type ShopPayload,
  type ShopResult,
  type TeleportPayload,
  type XpGain,
  CrewState,
  PlayerState,
  PuzzleState,
  ScenarioState,
} from '@chronolet/shared';

import { sanitizeMove } from './movement.ts';
import { ScenarioRuntime, type ScenarioFacts, type StepChange } from './scenario.ts';
import { Progression, type Member } from './progression.ts';
import { playerState, players, profiles, sessions, type PlayerStats } from '../db/repositories.ts';
import { eventBus } from '../core/eventBus.ts';
import { timeseries } from '../timeseries/store.ts';
import { llmHub } from '../llm/hub.ts';
import { createPuzzle, type ActionResult, type Puzzle } from '../puzzles/index.ts';
import { NARRATOR_LINES, SHIP_AI_EVENTS } from '../agents/lines.ts';
import { nextLine } from '../agents/memory.ts';
import { config } from '../config.ts';
import { verifyToken } from '../auth/tokens.ts';

interface ClientData {
  playerId: string;
  name: string;
  lastMoveAt: number;
  /** Последнее реальное перемещение — для idle-событий и снимков LLM. */
  lastActiveAt: number;
  idleReported: boolean;
  stats: PlayerStats;
  /** Последняя записанная точка телеметрии — пишем только изменения. */
  lastSample: string;
  fallsHere: number;
}

type CrewClient = Client<{ userData: ClientData }>;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROLE_NAME: Record<Role, string> = { observer: 'Наблюдатель', mechanic: 'Механик' };
/** «На борту» в эпохе — в пределах этого расстояния от станции возврата. */
const BOARDING_RADIUS = 5;
const TELEMETRY_MS = 200;
const IDLE_AFTER_MS = 30_000;
const LIKE_COOLDOWN_MS = 15_000;
const EMOTE_COOLDOWN_MS = 800;

function normalizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 20) : '';
  if (!name) throw new Error('Нужно имя игрока');
  return name;
}

/** Номер уровня для player_state.epoch: 0 — корабль, 1..5 — эпохи. */
const levelOrdinal = (levelId: string) => (epochByLevel(levelId)?.index ?? -1) + 1;

/**
 * Комната экипажа = игровая сессия.
 * Корабль → эпоха (сценарий: брифинг → роли → этапы головоломки → эвакуация) → деталь → … → финал.
 * Всё значимое уходит в шину событий: временной ряд DuckDB, поток для LLM, прогрессия.
 * Правила (роли, головоломки, детали, монеты, магазин) решает только сервер.
 */
export class CrewRoom extends Room<{ state: CrewState; metadata: CrewRoomMetadata }> {
  maxClients = MAX_CREW;
  state = new CrewState();

  private level: Level = HUB_LEVEL;
  private puzzle: Puzzle | null = null;
  private scenario = new ScenarioRuntime(HUB_LEVEL.id);
  private dirty = new Set<string>();
  private progression = new Progression({
    save: (m) => this.saveMember(m),
    xp: (m, amount, reason) => {
      this.clients.getById(m.sessionId)?.send(ServerMsg.Xp, { amount, reason } satisfies XpGain);
      this.emit('xp', m.sessionId, { amount, reason, total: m.state.xp, level: levelFromXp(m.state.xp).level });
    },
    unlocked: (m, id) => {
      this.broadcast(ServerMsg.Achievement, { sessionId: m.sessionId, name: m.name, id } satisfies AchievementBroadcast);
      this.emit('achievement', m.sessionId, { id, title: achievement(id)?.title });
    },
  });
  /** Вопросы к агентам, ждущие ответа LLM (seq события agent.ask → таймер фолбэка). */
  private pendingAsks = new Map<number, { timer: ReturnType<typeof setTimeout> }>();
  private likeCooldown = new Map<string, number>();
  private emoteCooldown = new Map<string, number>();
  private viewTimer?: ReturnType<typeof setTimeout>;

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
    this.state.scenario = new ScenarioState();
    this.setPatchRate(PATCH_RATE_MS);
    await this.setMetadata({ crewName, hostName, epoch: 0 });

    sessions.create(this.roomId, crewName, players.findOrCreate(hostName).id);
    this.emit('session.start', null, { crewName, host: hostName });
    this.syncScenario();

    this.onMessage(ClientMsg.Move, (client: CrewClient, msg: unknown) => this.handleMove(client, msg));
    this.onMessage(ClientMsg.Chat, (client: CrewClient, msg: unknown) => this.handleChat(client, msg));
    this.onMessage(ClientMsg.Interact, (client: CrewClient, msg: unknown) => this.handleInteract(client, msg));
    this.onMessage(ClientMsg.PuzzleAction, (client: CrewClient, msg: unknown) => this.handlePuzzleAction(client, msg));
    this.onMessage(ClientMsg.ShopBuy, (client: CrewClient, msg: unknown) => this.handleShop(client, msg, 'buy'));
    this.onMessage(ClientMsg.ShopEquip, (client: CrewClient, msg: unknown) => this.handleShop(client, msg, 'equip'));
    this.onMessage(ClientMsg.Like, (client: CrewClient, msg: unknown) => this.handleLike(client, msg));
    this.onMessage(ClientMsg.Emote, (client: CrewClient, msg: unknown) => this.handleEmote(client, msg));
    this.onMessage(ClientMsg.Ask, (client: CrewClient, msg: unknown) => this.handleAsk(client, msg));

    this.clock.setInterval(() => this.persistPositions(), PERSIST_INTERVAL_MS);
    this.clock.setInterval(() => this.sampleTelemetry(), TELEMETRY_MS);
    this.clock.setInterval(() => this.checkIdle(), 5000);

    llmHub.register(this.roomId, {
      snapshot: () => this.snapshot(),
      say: (req) => this.llmSay(req),
      hint: (req) => this.llmHint(req),
    });
  }

  /**
   * Вход в комнату — только с JWT, выданным после логина и пароля (SDK передаёт его сам).
   * Имя берётся из токена, а не из параметров клиента: выдать себя за другого нельзя.
   */
  async onAuth(_client: Client, _options: JoinOptions, context: AuthContext) {
    const player = context?.token ? await verifyToken(context.token) : null;
    if (!player) throw new ServerError(401, 'Нужно войти: логин и пароль');
    for (const p of this.state.players.values()) {
      if (p.name === player.name && p.connected) throw new ServerError(409, `«${player.name}» уже в этой комнате`);
    }
    return { name: player.name };
  }

  onJoin(client: CrewClient, _options: JoinOptions, auth: { name: string }) {
    const player = players.findOrCreate(auth.name);
    const profile = profiles.load(player.id);
    const now = Date.now();
    client.userData = {
      playerId: player.id,
      name: player.name,
      lastMoveAt: now,
      lastActiveAt: now,
      idleReported: false,
      stats: profile.stats,
      lastSample: '',
      fallsHere: 0,
    };

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
        coins: profile.coins,
        skin: profile.skin,
        owned: profile.owned,
        xp: profile.xp,
        likes: profile.likes,
        achievements: profile.achievements,
      }),
    );
    this.dirty.add(client.sessionId);

    this.emit('player.join', client.sessionId, { restored: !!saved, xp: profile.xp, skin: profile.skin });
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
      this.emit('player.leave', client.sessionId, {});
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
    clearTimeout(this.viewTimer);
    for (const a of this.pendingAsks.values()) clearTimeout(a.timer);
    sessions.setProgress(this.roomId, this.state.epoch, [...this.state.parts]);
    sessions.finish(this.roomId);
    this.emit('session.end', null, { parts: [...this.state.parts], finished: this.state.finished });
    llmHub.unregister(this.roomId);
    void timeseries.flush();
  }

  // ───────────────────────── события

  /** Единая точка записи события: временной ряд + LLM-поток + подписчики шины. */
  private emit(type: GameEventType, sessionId: string | null, data: Record<string, unknown>) {
    const c = sessionId ? (this.clients.getById(sessionId) as CrewClient | undefined) : undefined;
    return eventBus.emit({
      session: this.roomId,
      type,
      level: this.level.id,
      scenario: this.scenario.def?.id ?? null,
      step: this.scenario.step?.id ?? null,
      player: c?.userData ? { id: c.userData.playerId, name: c.userData.name } : null,
      data,
    });
  }

  private member(client: CrewClient): Member | null {
    const p = this.state.players.get(client.sessionId);
    if (!p || !client.userData) return null;
    return { sessionId: client.sessionId, playerId: client.userData.playerId, name: client.userData.name, state: p, stats: client.userData.stats };
  }

  private members(): Member[] {
    return (this.clients as unknown as CrewClient[]).map((c) => this.member(c)).filter((m): m is Member => !!m && m.state.connected);
  }

  private saveMember(m: Member) {
    const p = m.state;
    profiles.save(m.playerId, {
      coins: p.coins,
      skin: p.skin,
      owned: [...p.owned],
      xp: p.xp,
      likes: p.likes,
      achievements: [...p.achievements],
      stats: m.stats,
    });
  }

  // ───────────────────────── движение, телеметрия, чат

  private handleMove(client: CrewClient, msg: unknown) {
    const p = this.state.players.get(client.sessionId);
    const data = client.userData;
    if (!p || !data) return;
    // Пакеты, посчитанные ещё на прошлом уровне (в полёте во время прыжка), отбрасываем.
    if ((msg as { levelId?: unknown })?.levelId !== this.level.id) return;
    const rawY = (msg as { y?: unknown }).y;
    const fell = typeof rawY === 'number' && rawY < this.level.bounds.minY;
    const fellAt = p.x;
    const now = Date.now();
    const move = sanitizeMove(msg, p, now - data.lastMoveAt, this.level);
    data.lastMoveAt = now;
    if (!move) return;

    if (Math.abs(move.x - p.x) + Math.abs(move.y - p.y) + Math.abs(move.z - p.z) > 0.01) {
      data.lastActiveAt = now;
      data.idleReported = false;
    }
    p.x = move.x;
    p.y = move.y;
    p.z = move.z;
    p.vx = move.vx;
    p.vy = move.vy;
    p.anim = move.anim;
    p.facing = move.facing;
    this.dirty.add(client.sessionId);

    if (fell) {
      data.fallsHere++;
      this.scenario.falls++;
      this.emit('fall', client.sessionId, { x: fellAt, respawn: { x: move.x, y: move.y } });
      const m = this.member(client);
      if (m) this.progression.fall(m);
    }
    this.collectCoins(client, p);
  }

  /** Телеметрия ~5 Гц во временной ряд — только у тех, кто сдвинулся. */
  private sampleTelemetry() {
    const now = Date.now();
    for (const c of this.clients as unknown as CrewClient[]) {
      const p = this.state.players.get(c.sessionId);
      const d = c.userData;
      if (!p || !d) continue;
      const key = `${p.x.toFixed(2)}|${p.y.toFixed(2)}|${p.z.toFixed(2)}|${p.anim}`;
      if (key === d.lastSample) continue;
      d.lastSample = key;
      timeseries.appendTelemetry({ ts: now, session: this.roomId, playerId: d.playerId, level: this.level.id, x: p.x, y: p.y, z: p.z, anim: p.anim });
    }
  }

  /** Кто давно стоит — событие idle (повод для ХРОНОСа/LLM подколоть). */
  private checkIdle() {
    const now = Date.now();
    for (const c of this.clients as unknown as CrewClient[]) {
      const d = c.userData;
      if (!d || d.idleReported || now - d.lastActiveAt < IDLE_AFTER_MS) continue;
      d.idleReported = true;
      this.emit('idle', c.sessionId, { seconds: Math.round((now - d.lastActiveAt) / 1000) });
    }
  }

  private handleChat(client: CrewClient, msg: unknown) {
    const text = typeof (msg as { text?: unknown })?.text === 'string' ? (msg as { text: string }).text.trim().slice(0, 300) : '';
    if (!text || !client.userData) return;
    const { name } = client.userData;
    this.broadcast(ServerMsg.Chat, { from: client.sessionId, name, text, ts: Date.now() } satisfies ChatBroadcast);
    this.emit('chat', client.sessionId, { text });
    // «@Галилей почему…» — вопрос агенту.
    const m = /^@(\S+)\s*(.*)$/s.exec(text);
    if (m) {
      const who = m[1].toLowerCase().replace(/[,:]$/, '');
      const agent = AGENT_PROFILES.find((a) => a.name.toLowerCase() === who || a.id === who);
      if (agent) this.ask(client, agent.id, m[2]);
    }
  }

  // ───────────────────────── VK Coin, магазин, лайки, эмоции

  /** Сферы VK Coin подбираются по серверной позиции: кто первый коснулся — тому и монета. */
  private collectCoins(client: CrewClient, p: PlayerState) {
    for (const coin of this.level.coins) {
      if (this.state.coinsTaken.includes(coin.id) || !touchesCoin(p, coin)) continue;
      this.state.coinsTaken.push(coin.id);
      p.coins += 1;
      this.emit('coin.pickup', client.sessionId, { coin: coin.id, balance: p.coins });
      this.broadcast(ServerMsg.Coin, { coinId: coin.id, sessionId: client.sessionId, name: p.name } satisfies CoinPickup);
      const m = this.member(client);
      if (m) this.progression.coin(m);
    }
  }

  /** Магазин скинов: только на борту и у терминала; цена и баланс — на сервере. */
  private handleShop(client: CrewClient, msg: unknown, op: 'buy' | 'equip') {
    const p = this.state.players.get(client.sessionId);
    const skinId = (msg as Partial<ShopPayload> | null)?.skinId;
    const m = this.member(client);
    if (!p || !m || typeof skinId !== 'string') return;
    const reply = (ok: boolean, text: string) => client.send(ServerMsg.Shop, { ok, text } satisfies ShopResult);
    const shop = this.level.stations.find((s) => s.kind === 'shop');
    if (!shop || !isNearStation(shop, p)) return reply(false, 'Магазин — у терминала на борту хронолёта');
    const skin = SKINS.find((s) => s.id === skinId);
    if (!skin) return reply(false, 'Такого скина нет');

    if (op === 'buy') {
      if (p.owned.includes(skin.id)) return reply(false, `«${skin.name}» уже куплен`);
      if (p.coins < skin.price) return reply(false, `Не хватает ${skin.price - p.coins} ${COIN_NAME}`);
      p.coins -= skin.price;
      p.owned.push(skin.id);
      this.emit('shop.buy', client.sessionId, { skin: skin.id, price: skin.price });
      this.progression.bought(m);
    } else if (!p.owned.includes(skin.id) && skin.id !== 'default') {
      return reply(false, `Сначала купи «${skin.name}»`);
    }
    p.skin = getSkin(skin.id).id;
    this.saveMember(m);
    reply(true, op === 'buy' ? `Куплено и надето: «${skin.name}»` : `Надето: «${skin.name}»`);
  }

  private handleLike(client: CrewClient, msg: unknown) {
    const target = (msg as { target?: unknown })?.target;
    if (typeof target !== 'string' || target === client.sessionId) return;
    const toClient = this.clients.getById(target) as CrewClient | undefined;
    const from = this.member(client);
    const to = toClient ? this.member(toClient) : null;
    if (!from || !to) return;
    const key = `${client.sessionId}>${target}`;
    if ((this.likeCooldown.get(key) ?? 0) > Date.now()) return;
    this.likeCooldown.set(key, Date.now() + LIKE_COOLDOWN_MS);
    this.progression.like(from, to);
    this.emit('like', client.sessionId, { to: to.playerId, toName: to.name });
    this.broadcast(ServerMsg.Like, { from: client.sessionId, to: target, fromName: from.name, toName: to.name } satisfies LikeBroadcast);
  }

  private handleEmote(client: CrewClient, msg: unknown) {
    const emote = (msg as { emote?: unknown })?.emote;
    if (typeof emote !== 'number' || !Number.isInteger(emote) || emote < 0 || emote >= EMOTES.length) return;
    if ((this.emoteCooldown.get(client.sessionId) ?? 0) > Date.now()) return;
    this.emoteCooldown.set(client.sessionId, Date.now() + EMOTE_COOLDOWN_MS);
    this.broadcast(ServerMsg.Emote, { sessionId: client.sessionId, emote } satisfies EmoteBroadcast);
    this.emit('emote', client.sessionId, { emote: EMOTES[emote] });
  }

  // ───────────────────────── агенты: заготовки + LLM

  private handleAsk(client: CrewClient, msg: unknown) {
    const { agentId, text } = (msg ?? {}) as { agentId?: unknown; text?: unknown };
    if (typeof agentId !== 'string' || !AGENT_PROFILES.some((a) => a.id === agentId)) return;
    this.ask(client, agentId, typeof text === 'string' ? text.slice(0, 300) : '');
  }

  /**
   * Игрок обратился к агенту. Если LLM-сервис слушает сессию — даём ему ASK_TIMEOUT_MS ответить
   * через /llm/say (replyTo = seq), иначе (или по таймауту) звучит заготовка. Игра не ждёт LLM дольше.
   */
  private ask(client: CrewClient, agentId: string, text: string) {
    if (!client.userData) return;
    const fallback = () => {
      const lines = NARRATOR_LINES[agentId];
      if (lines) this.sayTo(client, agentId, nextLine(agentId, client.userData!.playerId, lines), 'script');
    };
    const e = this.emit('agent.ask', client.sessionId, { agentId, text });
    if (!llmHub.listening(this.roomId)) return fallback();
    const timer = setTimeout(() => {
      this.pendingAsks.delete(e.seq);
      fallback();
    }, ASK_TIMEOUT_MS);
    this.pendingAsks.set(e.seq, { timer });
  }

  private speakerOf(agentId: string) {
    return AGENT_PROFILES.find((a) => a.id === agentId)?.name ?? agentId;
  }

  private sayTo(client: CrewClient | null, agentId: string, text: string, source: 'script' | 'llm', extra: Partial<SayPayload> = {}) {
    const payload: SayPayload = { agentId, speaker: this.speakerOf(agentId), text, source, ...extra };
    if (client) client.send(ServerMsg.Say, payload);
    else this.broadcast(ServerMsg.Say, payload);
    if (extra.partial) return null;
    return this.emit('agent.say', client?.sessionId ?? null, { agentId, text, source, to: client?.userData?.playerId ?? null });
  }

  private shipSay(text: string, hint?: number) {
    if (hint) {
      this.scenario.hints++;
      this.state.puzzle.hintsGiven = this.scenario.hints;
      this.emit('hint', null, { level: hint, text, source: 'script' });
    }
    this.sayTo(null, SHIP_AI.id, text, 'script', hint ? { hint } : {});
  }

  /** POST /llm/say — реплика (или кусок потоковой реплики) от LLM. */
  private llmSay(req: LlmSayRequest): LlmAck {
    const agent = AGENT_PROFILES.find((a) => a.id === req?.agentId);
    if (!agent) return { ok: false, error: 'unknown agentId' };
    if (typeof req.text !== 'string' || (!req.text.trim() && !req.streamId)) return { ok: false, error: 'text required' };
    const text = req.text.slice(0, agent.maxChars);
    const target = req.to ? this.clientByPlayerId(req.to) : null;
    if (req.to && !target) return { ok: false, error: 'player not in session' };
    if (typeof req.replyTo === 'number') {
      const pending = this.pendingAsks.get(req.replyTo);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingAsks.delete(req.replyTo);
      }
    }
    const partial = !!req.streamId && !req.final;
    const e = this.sayTo(target, agent.id, text, 'llm', req.streamId ? { streamId: req.streamId, partial } : {});
    return { ok: true, seq: e?.seq };
  }

  /** POST /llm/hint — подсказка ХРОНОСа от LLM (считается в «без подсказок»). */
  private llmHint(req: LlmHintRequest): LlmAck {
    if (![1, 2, 3].includes(req?.level) || typeof req.text !== 'string' || !req.text.trim()) return { ok: false, error: 'level 1..3 and text required' };
    const target = req.to ? this.clientByPlayerId(req.to) : null;
    if (req.to && !target) return { ok: false, error: 'player not in session' };
    this.scenario.hints++;
    this.state.puzzle.hintsGiven = this.scenario.hints;
    const e = this.emit('hint', target?.sessionId ?? null, { level: req.level, text: req.text, source: 'llm' });
    const payload: SayPayload = { agentId: SHIP_AI.id, speaker: SHIP_AI.name, text: req.text.slice(0, 240), hint: req.level, source: 'llm' };
    if (target) target.send(ServerMsg.Say, payload);
    else this.broadcast(ServerMsg.Say, payload);
    return { ok: true, seq: e.seq };
  }

  private clientByPlayerId(playerId: string): CrewClient | null {
    return (this.clients as unknown as CrewClient[]).find((c) => c.userData?.playerId === playerId) ?? null;
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
        this.ask(client, agent, '');
        this.advance(this.scenario.talkedTo(agent, this.facts()));
        return;
      }
      case 'observer':
      case 'mechanic':
        return this.toggleRole(client, station.kind);
      case 'jump':
        return this.jumpFromHub();
      case 'return':
        return this.returnToShip(station);
      case 'shop':
        return; // панель магазина открывает клиент; покупки — отдельными сообщениями
    }
  }

  private toggleRole(client: CrewClient, role: Role) {
    if (!this.puzzle || this.puzzle.solved) return;
    if (!this.scenario.rolesOpen) {
      const narrator = epochByLevel(this.level.id)?.narrator.name ?? 'рассказчика';
      client.send(ServerMsg.System, { text: `Роли откроются после брифинга — сначала выслушайте: ${narrator}` });
      return;
    }
    const pz = this.state.puzzle;
    const sid = client.sessionId;
    const other: Role = role === 'observer' ? 'mechanic' : 'observer';

    if (pz[role] === sid) {
      pz[role] = '';
      client.send(ServerMsg.PuzzleView, { puzzleId: this.puzzle.id, role: null, view: null } satisfies PuzzleViewMessage);
      this.broadcast(ServerMsg.System, { text: `${client.userData!.name} оставил роль «${ROLE_NAME[role]}»` });
      this.emit('role.leave', sid, { role });
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
    this.emit('role.take', sid, { role });
    const m = this.member(client);
    if (m) this.progression.role(m, role);
    this.shipSay(SHIP_AI_EVENTS.roleTaken(client.userData!.name, ROLE_NAME[role]));
    if (pz[other] !== sid) client.send(ServerMsg.PuzzleView, { puzzleId: this.puzzle.id, role: null, view: null });
    this.sendViewsTo(client);
    this.advance(this.scenario.update(this.facts()));
  }

  private jumpFromHub() {
    if (this.level.id !== HUB_LEVEL.id || this.state.finished) return;
    if (this.state.epoch >= EPOCHS.length) {
      this.state.finished = true;
      this.shipSay(SHIP_AI_EVENTS.finale);
      sessions.setProgress(this.roomId, this.state.epoch, [...this.state.parts]);
      this.emit('finale', null, { parts: [...this.state.parts] });
      for (const m of this.members()) this.progression.unlock(m, 'home');
      this.syncScenario();
      return;
    }
    const epoch = EPOCHS[this.state.epoch];
    this.enterLevel(epoch.levelId);
    this.shipSay(SHIP_AI_EVENTS.epochEnter(`${epoch.title}, ${epoch.year}`));
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
    // Эвакуация завершает сценарий: шаг «aboard» и бонусы эпохи — до смены уровня.
    this.advance(this.scenario.update({ ...this.facts(), aboard: true }));
    const allCoins = this.level.coins.every((c) => this.state.coinsTaken.includes(c.id));
    for (const b of this.scenario.bonuses({ allCoins, attempts: this.puzzle.attempts })) {
      this.emit('scenario.bonus', null, { id: b.id, title: b.title, xp: b.xp, coins: b.coins });
      this.broadcast(ServerMsg.System, { text: `Бонус эпохи: «${b.title}» — +${b.xp} XP, +${b.coins} ${COIN_NAME} каждому` });
      for (const m of this.members()) {
        m.state.coins += b.coins;
        this.progression.grant(m, b.xp, `бонус «${b.title}»`);
      }
    }
    const part = EPOCHS[this.state.epoch - 1]?.part;
    this.enterLevel(HUB_LEVEL.id);
    if (part) this.shipSay(SHIP_AI_EVENTS.partInstalled(part.name, this.state.parts.length));
    if (this.state.epoch >= EPOCHS.length) this.shipSay('Все детали на месте. Дёрните рычаг — летим домой.');
  }

  /** Смена уровня для всего экипажа: позиции, головоломка, роли, сценарий. */
  private enterLevel(levelId: string) {
    this.persistPositions();
    this.level = getLevel(levelId);
    this.state.levelId = this.level.id;
    clearTimeout(this.viewTimer);

    const epoch = epochByLevel(levelId);
    this.puzzle = epoch ? createPuzzle(epoch.puzzle.id) : null;
    this.scenario = new ScenarioRuntime(levelId);
    const pz = this.state.puzzle;
    pz.id = this.puzzle?.id ?? '';
    pz.title = epoch?.puzzle.title ?? '';
    pz.observer = '';
    pz.mechanic = '';
    pz.attempts = 0;
    pz.hintsGiven = 0;
    pz.solved = false;
    pz.stage = this.puzzle?.stageText() ?? '';

    let i = 0;
    for (const client of this.clients as unknown as CrewClient[]) {
      const p = this.state.players.get(client.sessionId);
      if (!p) continue;
      const spot = this.spawnPoint(i++);
      Object.assign(p, { ...spot, vx: 0, vy: 0, anim: 'idle' });
      if (client.userData) {
        client.userData.lastMoveAt = Date.now();
        client.userData.fallsHere = 0;
      }
      client.send(ServerMsg.Teleport, { levelId: this.level.id, ...spot } satisfies TeleportPayload);
      client.send(ServerMsg.PuzzleView, { puzzleId: pz.id as never, role: null, view: null } satisfies PuzzleViewMessage);
      this.dirty.add(client.sessionId);
    }

    void this.setMetadata({ ...this.metadata, epoch: this.state.epoch });
    sessions.setProgress(this.roomId, this.state.epoch, [...this.state.parts]);
    this.emit('level.enter', null, { levelId, epoch: this.state.epoch });
    this.syncScenario();
    const cue = this.scenario.step?.cue;
    if (cue) this.shipSay(cue);
    llmHub.pushSnapshot(this.roomId);
  }

  private spawnPoint(i: number) {
    const s = this.level.spawn;
    return { x: s.x + (i % MAX_CREW) * 1.1, y: s.y, z: s.z };
  }

  // ───────────────────────── сценарий

  private facts(): ScenarioFacts {
    const pz = this.state.puzzle;
    return {
      rolesFilled: !!pz.observer && !!pz.mechanic,
      stagesPassed: this.puzzle?.stagesPassed ?? 0,
      solved: !!this.puzzle?.solved,
      aboard: false,
    };
  }

  /** Переходы шагов → события, бонус за контрольное время, реплика нового шага, HUD. */
  private advance(changes: StepChange[]) {
    if (!changes.length) return;
    for (const ch of changes) {
      this.emit('scenario.step', null, {
        completed: ch.from.id,
        next: ch.to?.id ?? null,
        elapsedSeconds: Math.round(ch.elapsedSeconds),
        parSeconds: ch.from.parSeconds ?? null,
        underPar: ch.underPar,
      });
      if (ch.underPar) {
        this.broadcast(ServerMsg.System, { text: `«${ch.from.title}» быстрее контрольного времени — +${XP.parBonus} XP` });
        for (const m of this.members()) {
          this.progression.unlock(m, 'speedrun');
          this.progression.grant(m, XP.parBonus, `темп: «${ch.from.title}»`);
        }
      }
      if (ch.to?.cue) this.shipSay(ch.to.cue);
    }
    this.syncScenario();
    llmHub.pushSnapshot(this.roomId);
  }

  private syncScenario() {
    const s = this.state.scenario;
    const def = this.scenario.def;
    const step = this.scenario.step;
    s.id = def?.id ?? '';
    s.title = def?.title ?? '';
    s.stepId = step?.id ?? '';
    s.stepTitle = step?.title ?? '';
    s.goal = step?.goal ?? (this.level.id === HUB_LEVEL.id ? this.hubGoal() : '');
    s.stepIndex = this.scenario.stepIndex;
    s.steps = def?.steps.length ?? 0;
    s.stepStartedAt = this.scenario.stepStartedAt;
    s.parSeconds = step?.parSeconds ?? 0;
  }

  private hubGoal(): string {
    if (this.state.finished) return 'Двигатель починен. Курс — домой!';
    if (this.state.epoch >= EPOCHS.length) return 'Все детали на месте — дёрните рычаг прыжка';
    return `Дёрните рычаг прыжка: следующая эпоха — ${EPOCHS[this.state.epoch].title}`;
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
    this.emit('puzzle.action', client.sessionId, { puzzle: this.puzzle.id, role, action, value: value ?? null });
    this.afterPuzzleAction(client, res);
  }

  private afterPuzzleAction(client: CrewClient, res: ActionResult) {
    const puzzle = this.puzzle!;
    const pz = this.state.puzzle;
    pz.stage = puzzle.stageText();
    pz.attempts = puzzle.attempts;
    pz.solved = puzzle.solved;
    if (res.message) this.broadcast(ServerMsg.System, { text: res.message });

    const holders = this.members().filter((m) => m.sessionId === pz.observer || m.sessionId === pz.mechanic);
    if (res.event === 'attempt_failed') {
      this.emit('puzzle.failed', client.sessionId, { puzzle: puzzle.id, attempts: puzzle.attempts, message: res.message ?? null });
      // Подсказки по нарастающей: каждые 2 неудачи — следующий уровень (намёк → направление → почти ответ).
      const level = Math.min(3, Math.floor(puzzle.attempts / 2));
      if (puzzle.attempts % 2 === 0 && level > 0) this.shipSay(puzzle.hints[level - 1], level);
      else this.shipSay(SHIP_AI_EVENTS.attemptFailed[(puzzle.attempts - 1) % SHIP_AI_EVENTS.attemptFailed.length]);
    } else if (res.event === 'stage_passed') {
      this.emit('puzzle.stage', client.sessionId, { puzzle: puzzle.id, stages: puzzle.stagesPassed, message: res.message ?? null });
      for (const m of holders) this.progression.grant(m, XP.stagePassed, 'этап головоломки');
      this.shipSay(SHIP_AI_EVENTS.stagePassed);
    } else if (res.event === 'solved') {
      this.emit('puzzle.solved', client.sessionId, { puzzle: puzzle.id, attempts: puzzle.attempts, hints: this.scenario.hints });
      for (const m of this.members()) this.progression.grant(m, XP.solved, 'головоломка решена');
      if (puzzle.attempts === 0) for (const m of holders) this.progression.unlock(m, 'flawless');
      this.awardPart();
    }
    this.advance(this.scenario.update(this.facts()));
    this.sendAllViews();
    this.scheduleViewRefresh();
  }

  /** Вид может измениться сам (облака рассеялись) — перешлём виды в нужный момент. */
  private scheduleViewRefresh() {
    clearTimeout(this.viewTimer);
    const at = this.puzzle?.nextChangeAt();
    if (!at) return;
    this.viewTimer = setTimeout(() => {
      if (!this.puzzle) return;
      this.state.puzzle.stage = this.puzzle.stageText();
      this.sendAllViews();
      this.scheduleViewRefresh();
    }, Math.max(0, at - Date.now()) + 20);
  }

  /** Деталь выдаёт только игровая логика (правило 5 дизайн-дока). */
  private awardPart() {
    const epoch = epochByLevel(this.level.id);
    if (!epoch || this.state.parts.includes(epoch.part.id)) return;
    this.state.parts.push(epoch.part.id);
    this.state.epoch = this.state.parts.length;
    sessions.setProgress(this.roomId, this.state.epoch, [...this.state.parts]);
    this.emit('part.awarded', null, { part: epoch.part.id, name: epoch.part.name });
    for (const m of this.members()) this.progression.unlock(m, 'first_part');
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

  // ───────────────────────── снимок для LLM

  private snapshot(): SessionSnapshot {
    const now = Date.now();
    const pz = this.state.puzzle;
    const step = this.scenario.step;
    return {
      session: this.roomId,
      crewName: this.state.crewName,
      ts: now,
      levelId: this.level.id,
      epoch: this.state.epoch,
      parts: [...this.state.parts],
      finished: this.state.finished,
      scenario:
        this.scenario.def && step
          ? {
              id: this.scenario.def.id,
              stepId: step.id,
              stepTitle: step.title,
              goal: step.goal,
              stepStartedAt: this.scenario.stepStartedAt,
              parSeconds: step.parSeconds ?? null,
            }
          : null,
      puzzle: this.puzzle
        ? { id: this.puzzle.id, title: pz.title, stage: pz.stage, attempts: pz.attempts, solved: pz.solved, hintsGiven: this.scenario.hints }
        : null,
      crew: (this.clients as unknown as CrewClient[]).flatMap((c) => {
        const p = this.state.players.get(c.sessionId);
        const d = c.userData;
        if (!p || !d) return [];
        return [
          {
            id: d.playerId,
            name: d.name,
            connected: p.connected,
            role: pz.observer === c.sessionId ? ('observer' as const) : pz.mechanic === c.sessionId ? ('mechanic' as const) : null,
            x: Math.round(p.x * 100) / 100,
            y: Math.round(p.y * 100) / 100,
            idleSeconds: Math.round((now - d.lastActiveAt) / 1000),
            coins: p.coins,
            xp: p.xp,
            level: levelFromXp(p.xp).level,
            skin: p.skin,
            falls: d.fallsHere,
          },
        ];
      }),
      lastSeq: timeseries.lastSeq,
    };
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
