import { ASK_TIMEOUT_MS, EPOCHS, REACT_TIMEOUT_MS, STREAM_DEADLINE_MS, type AgentProfile, type GameEvent, type ReplyableData } from '@chronolet/shared';
import { config } from './config.ts';
import { api } from './api.ts';
import { allSessions, ctx, saidBy, situation, speechLines, type SessionContext } from './context.ts';
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

export interface Agents {
  get(id: string): AgentProfile | undefined;
}

export function onEvent(e: GameEvent, agents: Agents) {
  const d = e.data as Partial<ReplyableData> & { text?: string; attempts?: number; message?: string | null; part?: string | null; seconds?: number };
  const c = ctx(e.session);

  if (e.type === 'agent.ask' && d.replyable) {
    const agent = agents.get(d.agentId!);
    if (!agent) return;
    const task = d.text
      ? `Игрок ${e.player?.name} спрашивает тебя: «${d.text}». Ответь ему по существу, не выходя из роли.`
      : `Игрок ${e.player?.name} подошёл поговорить. Коротко скажи, что экипажу нужно сделать сейчас, исходя из цели шага.`;
    return enqueue(e, 0, ASK_TIMEOUT_MS, { agent, task, to: e.player?.id, withMemory: true, rememberAs: d.text ? `спрашивал: «${d.text.slice(0, 60)}»` : 'подходил поговорить' });
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

  if (e.type === 'idle') {
    // Инициативная реплика: заготовки на простой нет, поэтому двойного голоса быть не может.
    const agent = agents.get('ship_ai');
    const now = Date.now();
    if (!agent || now - c.lastProactiveAt < config.proactiveGapMs || now - c.lastShipSpeechAt < config.proactiveGapMs) return;
    c.lastProactiveAt = now;
    return enqueue(e, 3, 8000, { agent, task: `${e.player?.name} стоит без дела уже ${d.seconds} секунд. Подколи его одной фразой и напомни цель.` });
  }
}

/**
 * Инициативный комментарий к разговору экипажа: раз в COMMENT_GAP_MS, если вслух сказали хоть что-то
 * новое (расшифровки из Redis) и NPC не говорили только что. В эпохе обычно говорит её рассказчик,
 * иногда — ХРОНОС; на борту — ХРОНОС. Реплика уходит всем: субтитр + строка в чате.
 */
export function maybeComment(agents: Agents, now = Date.now()) {
  if (!health.ok) return;
  for (const [session, c] of allSessions()) {
    if (!c.snapshot || c.speechSinceComment < config.commentMinPhrases) continue;
    if (now - c.lastCommentAt < config.commentGapMs || now - c.lastAnySpeechAt < config.commentQuietMs) continue;
    const agent = commentator(c, agents);
    if (!agent) continue;
    c.lastCommentAt = now;
    c.speechSinceComment = 0;
    c.comments++;
    const e = {
      seq: 0,
      ts: now,
      session,
      type: 'transcript.comment',
      level: c.snapshot.levelId,
      scenario: null,
      step: null,
      player: null,
      data: {},
    } as unknown as GameEvent;
    enqueue(e, 3, 15000, {
      agent,
      task:
        'Ты слышишь, о чём экипаж только что говорил вслух (расшифровка выше), и видишь, что он делает. ' +
        'Встрянь одной-двумя фразами в своём характере: отреагируй на конкретные слова игроков — ' +
        'подскажи, куда смотреть по цели шага, поправь заблуждение или просто пошути. Ответ головоломки не называй.',
    });
  }
}

/** Кто комментирует: рассказчик эпохи (2 раза из 3) или ХРОНОС; на борту — ХРОНОС. */
function commentator(c: SessionContext, agents: Agents): AgentProfile | undefined {
  const narrator = EPOCHS.find((ep) => ep.levelId === c.snapshot?.levelId)?.narrator.id;
  const id = narrator && c.comments % 3 !== 2 ? narrator : 'ship_ai';
  return agents.get(id) ?? agents.get('ship_ai');
}

interface SpeakPlan {
  agent: AgentProfile;
  task: string;
  to?: string;
  hintLevel?: 1 | 2 | 3;
  guard?: (text: string) => boolean;
  withMemory?: boolean;
  rememberAs?: string;
  mistake?: string;
}

function enqueue(e: GameEvent, priority: number, windowMs: number, plan: SpeakPlan) {
  const replyable = !!(e.data as Partial<ReplyableData>).replyable;
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
    agent: plan.agent,
    situation: situation(c.snapshot),
    recent: c.recent,
    memory,
    speech: speechLines(c),
    said: saidBy(c, plan.agent.id),
    task: plan.task,
  });

  const ac = new AbortController();
  let reason: 'first-token' | 'deadline' | null = null;
  const firstTokenTimer = setTimeout(() => ((reason = 'first-token'), ac.abort()), config.firstTokenMs);
  const deadline = setTimeout(() => ((reason = 'deadline'), ac.abort()), STREAM_DEADLINE_MS - 1500);
  let lastFlush = 0;
  let flushed = '';
  let sending: Promise<unknown> = Promise.resolve();

  try {
    const res = await streamChat(messages, {
      signal: ac.signal,
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
      if (replyable) await send('', true); // отказ → заготовка сразу
      return log(e, plan, 'fallback', { ms: Date.now() - t0, ttft: res.ttftMs, tokens: res.tokens, note: text ? `гард: «${text.slice(0, 60)}»` : 'пустой ответ' });
    }
    const ack = await send(text, true);
    if (ack.status === 409) return log(e, plan, 'timeout', { ms: Date.now() - t0, note: 'опоздали к финалу' });
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
    `[agent] #${e.seq} ${e.type} ${plan.agent.id}${plan.hintLevel ? ` hint=${plan.hintLevel}` : ''}`,
    `source=${source}`,
    info.ttft != null ? `ttft=${info.ttft}ms` : '',
    info.ms != null ? `total=${info.ms}ms` : '',
    info.tokens ? `tok=${info.tokens}` : '',
    info.note ? `(${info.note})` : '',
    info.text ? `«${info.text}»` : '',
  ];
  console.log(parts.filter(Boolean).join(' '));
}
