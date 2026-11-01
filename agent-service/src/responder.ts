import { ASK_TIMEOUT_MS, EPOCHS, REACT_TIMEOUT_MS, STREAM_DEADLINE_MS, getLevel, guideStepFor, type AgentProfile, type GameEvent, type ReplyableData } from '@chronolet/shared';
import { config } from './config.ts';
import { api } from './api.ts';
import { allSessions, ctx, forget, markAnswered, saidBy, situation, speechLines, tooSimilar, type SessionContext } from './context.ts';
import { buildMessages, cleanReply, keepsNumbers } from './prompt.ts';
import { health, streamChat } from './ollama.ts';
import { TaskQueue } from './queue.ts';

/**
 * Реакции на события: что сказать, кем, кому и как (стрим, захват, отказ, память).
 * Правила игры здесь не решаются — только слова. Источник каждой реплики попадает в лог:
 *   source=llm      — модель ответила, реплика ушла игрокам;
 *   source=fallback — Ollama недоступна/ошиблась/исказила подсказку → заготовка сервера;
 *   source=timeout  — не успели (очередь, первый токен) → заготовка сервера.
 */
const queue = new TaskQueue();
const MARGIN_MS = 300;

/** Указание ведущего (панель администратора) дописывается к персоне — меняет поведение агента в этой сессии. */
export function withBehavior(agent: AgentProfile, behavior: string | undefined): AgentProfile {
  const b = behavior?.trim();
  return b ? { ...agent, persona: `${agent.persona}\nУказание ведущего игры (важнее черт персонажа): ${b}` } : agent;
}

export interface Agents {
  get(id: string): AgentProfile | undefined;
}

export function onEvent(e: GameEvent, agents: Agents) {
  const d = e.data as Partial<ReplyableData> & { text?: string; attempts?: number; message?: string | null; part?: string | null; seconds?: number };
  const c = ctx(e.session);


  if (e.type === 'agent.ask' && d.replyable) {
    const agent = agents.get(d.agentId!);
    if (!agent) return;
    if (d.text) {
      return enqueue(e, 0, ASK_TIMEOUT_MS, {
        agent,
        task: `Игрок ${e.player?.name} спрашивает тебя: «${d.text}». Ответь ему по существу, не выходя из роли.`,
        to: e.player?.id,
        withMemory: true,
        rememberAs: `спрашивал: «${d.text.slice(0, 60)}»`,
      });
    }
    // E у NPC — продолжение голосового разговора: отвечаем всему экипажу на свежие фразы вслух.
    const speech = speechLines(c, Date.now(), 4 * 60_000, c.answeredUpTo);
    markAnswered(c);
    const said = saidBy(c, agent.id);
    return enqueue(e, 0, ASK_TIMEOUT_MS, {
      agent,
      speech,
      task: speech.length
        ? `${e.player?.name} подошёл к тебе. Ответь на то, что экипаж только что говорил вслух (расшифровка выше), как в живом разговоре.`
        : `${e.player?.name} подошёл к тебе, но экипаж пока молчал. Поприветствуй в своём характере и спроси, о чём хотят поговорить.`,
      withMemory: true,
      rememberAs: 'подходил поговорить',
      guard: (t) => !tooSimilar(t, said),
    });
  }

  if (d.replyable && (e.type === 'puzzle.failed' || e.type === 'puzzle.stage' || e.type === 'puzzle.solved')) {
    const agent = agents.get(d.agentId ?? 'ship_ai');
    if (!agent) return;
    if (e.type === 'puzzle.failed' && d.hint) {
      // Подсказку не придумываем: перефразируем текст, который сервер дал бы сам, сохраняя все числа.
      const hint = d.hint;
      return enqueue(e, 1, REACT_TIMEOUT_MS, {
        agent,
        task: `Экипаж ошибся уже ${d.attempts} раз. Перескажи своими словами эту подсказку (уровень ${hint.level} из 3), сохранив смысл и все числа, в своём характере: «${hint.text}».`,
        hintLevel: hint.level,
        guard: (t) => keepsNumbers(hint.text, t),
        mistake: d.message ?? undefined,
      });
    }
    const task =
      e.type === 'puzzle.failed'
        ? `Экипаж ошибся (попытка №${d.attempts}${d.message ? `: ${d.message}` : ''}). Отреагируй в своём характере и подбодри, не подсказывая ответ.`
        : e.type === 'puzzle.stage'
          ? `Экипаж прошёл этап головоломки${d.message ? ` (${d.message})` : ''}. Коротко отметь это и подтолкни к следующему шагу.`
          : `Головоломка решена${d.part ? `, экипаж получил деталь «${d.part}»` : ''}. Поздравь и напомни вернуться на хронолёт.`;
    return enqueue(e, e.type === 'puzzle.failed' ? 1 : 2, REACT_TIMEOUT_MS, { agent, task, mistake: e.type === 'puzzle.failed' ? (d.message ?? undefined) : undefined });
  }

  // Простой (idle) больше не повод для реплик ХРОНОСа: он говорит редко — подсказки по трассе (maybeShipHint).
}

/** Снимок старше этого — сессия не идёт (комнату закрыли): не говорим в пустоту и забываем её. */
const STALE_MS = 15_000;
const FORGET_MS = 5 * 60_000;

/** Живые сессии с игроками; закрытые давно — забываем (иначе реплики уходят в пустоту и грузят модель). */
function liveSessions(now: number): [string, SessionContext][] {
  const live: [string, SessionContext][] = [];
  for (const [session, c] of allSessions()) {
    if (now - c.snapshotAt > FORGET_MS) forget(session);
    else if (c.snapshot && now - c.snapshotAt <= STALE_MS && c.snapshot.crew.some((m) => m.connected)) live.push([session, c]);
  }
  return live;
}

const pseudoEvent = (session: string, c: SessionContext, type: string, now: number) =>
  ({ seq: 0, ts: now, session, type, level: c.snapshot?.levelId ?? '', scenario: null, step: null, player: null, data: {} }) as unknown as GameEvent;

/**
 * Разговор голосом: на новые фразы из расшифровки (Redis) отвечает местный NPC — рассказчик эпохи,
 * на борту — ХРОНОС. Не чаще раза в COMMENT_GAP_MS и не перебивая только что прозвучавшую реплику.
 * Без новых фраз NPC молчит: реплики «ни о чём» и были тем, что «не имеет отношения к разговору».
 */
export function maybeComment(agents: Agents, now = Date.now()) {
  if (!health.ok) return;
  for (const [session, c] of liveSessions(now)) {
    if (c.speechSinceComment < Math.max(1, config.commentMinPhrases)) continue;
    if (now - c.lastCommentAt < config.commentGapMs || now - c.lastAnySpeechAt < config.commentQuietMs) continue;
    const narrator = EPOCHS.find((ep) => ep.levelId === c.snapshot?.levelId)?.narrator.id;
    const agent = agents.get(narrator ?? 'ship_ai');
    if (!agent) continue;
    c.lastCommentAt = now;
    const speech = speechLines(c, now, 4 * 60_000, c.answeredUpTo);
    markAnswered(c);
    const said = saidBy(c, agent.id);
    enqueue(pseudoEvent(session, c, 'transcript.comment', now), 3, 9000, {
      agent,
      task:
        'Экипаж только что говорил вслух (последние фразы расшифровки выше) — это разговор и с тобой. Ответь на конкретные слова, ' +
        'как в живом диалоге, в своём характере: на вопрос — ответь, на ошибку — поправь, можно пошутить. Ответ головоломки не называй.',
      // Инициативную реплику никто не ждёт с таймером — можно дольше ждать первого слова.
      firstTokenMs: 9000,
      speech,
      // Повтор прошлой реплики — переспросим или промолчим (уйдёт целиком, без потоковых кусков).
      guard: (t) => !tooSimilar(t, said),
    });
  }
}

/**
 * Подсказки по прохождению — дело ХРОНОСа, и редко: раз в SHIP_HINT_GAP_MS, только в эпохе и только если
 * экипаж продвинулся к новому участку трассы (или долго топчется на старом). Текст — из описания уровня, без LLM:
 * короткий и точный.
 */
export function maybeShipHint(now = Date.now()) {
  for (const [session, c] of liveSessions(now)) {
    const s = c.snapshot!;
    if (!EPOCHS.some((ep) => ep.levelId === s.levelId) || now - c.lastShipSpeechAt < config.shipHintGapMs) continue;
    if (now - c.lastAnySpeechAt < config.commentQuietMs) continue;
    const lead = s.crew.filter((m) => m.connected).reduce((a, b) => (b.x > a.x ? b : a));
    const step = guideStepFor(getLevel(s.levelId), lead.x);
    if (!step || (step === c.lastHint && now - c.lastHintAt < 3 * config.shipHintGapMs)) continue;
    c.lastHint = step;
    c.lastHintAt = now;
    c.lastShipSpeechAt = now;
    void api.say({ session, agentId: 'ship_ai', text: `💡 ${step}` }).catch(() => {});
    console.log(`[agent] ${session} ship_ai подсказка по трассе: «${step.slice(0, 80)}»`);
  }
}

interface SpeakPlan {
  agent: AgentProfile;
  task: string;
  /** Дополнительные строки «Ситуации» (прогресс по трассе). */
  extra?: string[];
  /** Потолок длины ответа в токенах (по умолчанию — MAX_TOKENS). */
  maxTokens?: number;
  /** Сколько ждать первого токена (по умолчанию — FIRST_TOKEN_MS). */
  firstTokenMs?: number;
  /** Свои строки расшифровки (комментарий — только неотвеченные); по умолчанию — все свежие. */
  speech?: string[];
  /** Уже переспрашивали после повтора — второй раз не пробуем. */
  retried?: boolean;
  to?: string;
  hintLevel?: 1 | 2 | 3;
  guard?: (text: string) => boolean;
  withMemory?: boolean;
  rememberAs?: string;
  mistake?: string;
}

function enqueue(e: GameEvent, priority: number, windowMs: number, plan: SpeakPlan) {
  const replyable = !!(e.data as Partial<ReplyableData>).replyable;
  // Администратор комнаты заглушил агента — модель не тратим (сервер всё равно не пропустит реплику).
  if (ctx(e.session).snapshot?.agents?.[plan.agent.id]?.muted) {
    if (replyable) void release(e, plan);
    return log(e, plan, 'fallback', { note: 'агент заглушён администратором' });
  }
  if (!health.ok) {
    // Ollama лежит — сразу отказываемся (пустой финал), чтобы сервер не ждал свой таймер.
    if (replyable) void release(e, plan);
    return log(e, plan, 'fallback', { note: `Ollama недоступна: ${health.lastError.replace('[logged] ', '')}` });
  }
  queue.push({
    priority,
    // Отвечаемое событие надо «захватить» до серверного таймера; инициативное — просто не устаревать.
    startBy: e.ts + windowMs - (replyable ? MARGIN_MS : 0),
    label: `#${e.seq} ${e.type}`,
    run: () => speak(e, plan, replyable),
    expired: () => log(e, plan, 'timeout', { note: `очередь (${queue.size})` }),
  });
}

/** Отказ от отвечаемого события: пустой финал с replyTo — сервер сразу говорит заготовку. */
async function release(e: GameEvent, plan: SpeakPlan) {
  const base = { session: e.session, replyTo: e.seq, streamId: `rel-${e.seq}`, text: '', final: true };
  await (plan.hintLevel ? api.hint({ ...base, level: plan.hintLevel }) : api.say({ ...base, agentId: plan.agent.id })).catch(() => {});
}

async function speak(e: GameEvent, plan: SpeakPlan, replyable: boolean) {
  const t0 = Date.now();
  if (!health.ok) {
    if (replyable) await release(e, plan);
    return log(e, plan, 'fallback', { note: `Ollama недоступна: ${health.lastError.replace('[logged] ', '')}` });
  }

  const streamId = `${e.session}-${e.seq}-${Math.random().toString(36).slice(2, 6)}`;
  const base = { session: e.session, to: plan.to, streamId, ...(replyable ? { replyTo: e.seq } : {}) };
  const send = (text: string, final: boolean) =>
    plan.hintLevel ? api.hint({ ...base, level: plan.hintLevel, text, final }) : api.say({ ...base, agentId: plan.agent.id, text, final });

  if (replyable) {
    // Захват: «печатает…» у игрока, серверный таймер заготовки снят — теперь отвечаем мы (или отказываемся).
    const claim = await send('', false).catch(() => ({ status: 0, body: { ok: false } }));
    if (claim.status === 409) return log(e, plan, 'timeout', { note: 'опоздали: заготовка уже прозвучала' });
    if (claim.status !== 200) return log(e, plan, 'fallback', { note: `захват не удался: HTTP ${claim.status}` });
  }

  const memory = plan.withMemory && plan.to ? await api.getMemory(plan.agent.id, plan.to) : null;
  const c = ctx(e.session);
  const messages = buildMessages({
    agent: withBehavior(plan.agent, c.snapshot?.agents?.[plan.agent.id]?.behavior),
    situation: [...situation(c.snapshot), ...(plan.extra ?? [])],
    recent: c.recent,
    memory,
    speech: plan.speech ?? speechLines(c),
    said: saidBy(c, plan.agent.id),
    task: plan.task,
  });

  const ac = new AbortController();
  let reason: 'first-token' | 'deadline' | null = null;
  const firstTokenTimer = setTimeout(() => ((reason = 'first-token'), ac.abort()), plan.firstTokenMs ?? config.firstTokenMs);
  const deadline = setTimeout(() => ((reason = 'deadline'), ac.abort()), STREAM_DEADLINE_MS - 1500);
  let lastFlush = 0;
  let flushed = '';
  let sending: Promise<unknown> = Promise.resolve();

  try {
    const res = await streamChat(messages, {
      signal: ac.signal,
      maxTokens: plan.maxTokens,
      onToken: (raw) => {
        clearTimeout(firstTokenTimer);
        const now = Date.now();
        // Гард подсказки проверяется только на финале — промежуточные куски не показываем, если он есть.
        if (plan.guard || now - lastFlush < config.flushMs) return;
        const text = cleanReply(raw, plan.agent);
        if (!text || text === flushed) return;
        lastFlush = now;
        flushed = text;
        sending = sending.then(() => send(text, false)).catch(() => {});
      },
    });
    clearTimeout(deadline);
    await sending;
    health.markOk();
    const text = cleanReply(res.text, plan.agent);
    if (!text || (plan.guard && !plan.guard(text))) {
      // Инициативная реплика вышла повтором — одна попытка с явным «эта тема уже была».
      if (!replyable && text && !plan.retried) {
        log(e, plan, 'fallback', { ms: Date.now() - t0, ttft: res.ttftMs, tokens: res.tokens, note: `повтор, переспрашиваю: «${text.slice(0, 60)}»` });
        return speak(e, { ...plan, retried: true, task: `${plan.task} Ты только что чуть не сказал: «${text.slice(0, 120)}» — это уже звучало. Скажи о другом.` }, false);
      }
      if (replyable) await send('', true); // отказ → заготовка сразу
      return log(e, plan, 'fallback', { ms: Date.now() - t0, ttft: res.ttftMs, tokens: res.tokens, note: text ? `гард: «${text.slice(0, 60)}»` : 'пустой ответ' });
    }
    const ack = await send(text, true);
    if (ack.status === 409) return log(e, plan, 'timeout', { ms: Date.now() - t0, note: 'опоздали к финалу' });
    if (ack.status !== 200) return log(e, plan, 'fallback', { ms: Date.now() - t0, note: `сервер не принял: HTTP ${ack.status}` });
    log(e, plan, 'llm', { ms: Date.now() - t0, ttft: res.ttftMs, tokens: res.tokens, text });
    await rememberAfter(e, plan, text);
  } catch (err) {
    clearTimeout(firstTokenTimer);
    clearTimeout(deadline);
    await sending;
    if (!reason) health.markFail(err);
    // Захватили, но не справились — отказ: сервер сразу говорит заготовку (или закрывает накопленным текстом).
    if (replyable) await send('', true).catch(() => {});
    log(e, plan, reason ? 'timeout' : 'fallback', { ms: Date.now() - t0, note: reason ?? String((err as Error)?.message ?? err) });
  } finally {
    clearTimeout(firstTokenTimer);
    clearTimeout(deadline);
  }
}

/** Память агента об игроке: о чём говорили и на чём спотыкался (agent_memory через /llm/memory). */
async function rememberAfter(e: GameEvent, plan: SpeakPlan, said: string) {
  const playerId = e.player?.id;
  if (!playerId) return;
  if (plan.rememberAs) {
    const mem = await api.getMemory(plan.agent.id, playerId);
    const summary = [mem?.summary, `${plan.rememberAs}; ответил: «${said.slice(0, 60)}»`].filter(Boolean).join(' | ').slice(-300);
    await api.memory({ agentId: plan.agent.id, playerId, summary }).catch(() => {});
  }
  if (plan.mistake) {
    const mem = await api.getMemory(plan.agent.id, playerId);
    await api.memory({ agentId: plan.agent.id, playerId, mistakes: [...(mem?.mistakes ?? []), plan.mistake].slice(-5) }).catch(() => {});
  }
}

function log(e: GameEvent, plan: SpeakPlan, source: 'llm' | 'fallback' | 'timeout', info: { ms?: number; ttft?: number | null; tokens?: number; text?: string; note?: string }) {
  const parts = [
    `[agent] ${e.session} #${e.seq} ${e.type} ${plan.agent.id}${plan.hintLevel ? ` hint=${plan.hintLevel}` : ''}`,
    `source=${source}`,
    info.ttft != null ? `ttft=${info.ttft}ms` : '',
    info.ms != null ? `total=${info.ms}ms` : '',
    info.tokens ? `tok=${info.tokens}` : '',
    info.note ? `(${info.note})` : '',
    info.text ? `«${info.text}»` : '',
  ];
  console.log(parts.filter(Boolean).join(' '));
}
