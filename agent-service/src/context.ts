import { EPOCHS, type GameEvent, type SessionSnapshot } from '@chronolet/shared';

/** Что сервис помнит о сессии между событиями: последний снимок и короткая лента недавнего. */
export interface SessionContext {
  snapshot: SessionSnapshot | null;
  recent: string[];
  /** Когда ХРОНОС говорил последний раз (любой источник) — для частоты инициативных реплик. */
  lastShipSpeechAt: number;
  lastProactiveAt: number;
}

const RECENT = 8;
const sessions = new Map<string, SessionContext>();

export function ctx(session: string): SessionContext {
  let c = sessions.get(session);
  if (!c) sessions.set(session, (c = { snapshot: null, recent: [], lastShipSpeechAt: 0, lastProactiveAt: 0 }));
  return c;
}

export function forget(session: string) {
  sessions.delete(session);
}

/** Событие → одна строка «ленты» для промпта (только то, что помогает говорить по делу). */
export function describe(e: GameEvent): string | null {
  const who = e.player?.name ?? 'экипаж';
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case 'chat':
      return `${who} в чате: «${String(d.text).slice(0, 120)}»`;
    case 'agent.ask':
      return d.text ? `${who} спросил агента: «${String(d.text).slice(0, 120)}»` : `${who} подошёл поговорить`;
    case 'agent.say':
      return `${String(d.agentId) === 'ship_ai' ? 'ХРОНОС' : 'рассказчик'} сказал: «${String(d.text).slice(0, 140)}»`;
    case 'hint':
      return `подсказка ${d.level}: «${String(d.text).slice(0, 140)}»`;
    case 'puzzle.failed':
      return `ошибка №${d.attempts}${d.message ? `: ${d.message}` : ''} (${who})`;
    case 'puzzle.stage':
      return `этап пройден${d.message ? `: ${d.message}` : ''}`;
    case 'puzzle.solved':
      return `головоломка решена${d.part ? `, деталь «${d.part}»` : ''}`;
    case 'role.take':
      return `${who} стал ${d.role === 'observer' ? 'Наблюдателем' : 'Механиком'}`;
    case 'scenario.step':
      return d.next ? `новый шаг сценария: ${d.next}` : null;
    case 'fall':
      return `${who} упал в яму`;
    case 'level.enter':
      return `экипаж прибыл: ${d.levelId}`;
    default:
      return null;
  }
}

export function remember(e: GameEvent) {
  const c = ctx(e.session);
  if (e.type === 'agent.say' && (e.data as { agentId?: string }).agentId === 'ship_ai') c.lastShipSpeechAt = e.ts;
  if (e.type === 'session.end') return forget(e.session);
  const line = describe(e);
  if (!line) return;
  c.recent.push(line);
  if (c.recent.length > RECENT) c.recent.splice(0, c.recent.length - RECENT);
}

/** Сжатое описание «сейчас» из снимка — то, на что модель опирается вместо выдумок. */
export function situation(s: SessionSnapshot | null, now = Date.now()): string[] {
  if (!s) return ['Состояние сессии пока неизвестно.'];
  const lines: string[] = [];
  const epoch = EPOCHS.find((e) => e.levelId === s.levelId);
  lines.push(epoch ? `Место: ${epoch.title}, ${epoch.year}. Деталей двигателя: ${s.parts.length} из 5.` : `Место: борт хронолёта. Деталей двигателя: ${s.parts.length} из 5.`);
  if (s.scenario) {
    const sec = Math.round((now - s.scenario.stepStartedAt) / 1000);
    lines.push(`Шаг «${s.scenario.stepTitle}», цель: ${s.scenario.goal}. Идёт ${sec} с${s.scenario.parSeconds ? ` (контроль ${s.scenario.parSeconds} с)` : ''}.`);
  }
  if (s.puzzle) lines.push(`Головоломка «${s.puzzle.title}»: ${s.puzzle.stage}. Ошибок: ${s.puzzle.attempts}, подсказок: ${s.puzzle.hintsGiven}.`);
  const crew = s.crew
    .filter((m) => m.connected)
    .map((m) => `${m.name}${m.role ? ` (${m.role === 'observer' ? 'Наблюдатель' : 'Механик'})` : ''}${m.idleSeconds >= 20 ? `, стоит ${m.idleSeconds} с` : ''}`);
  if (crew.length) lines.push(`Экипаж: ${crew.join('; ')}.`);
  return lines;
}
