import type { AgentProfile, LlmMemory } from '@chronolet/shared';
import type { ChatMessage } from './ollama.ts';

/**
 * Системный промпт агента — стабильный префикс (кэшируется Ollama). Реплик здесь нет:
 * только персона из /llm/content и правила речи.
 */
export function systemPrompt(agent: AgentProfile): string {
  const era = agent.knowsUntil !== null
    ? `Ты ничего не знаешь о событиях после ${agent.knowsUntil < 0 ? `${-agent.knowsUntil} года до н. э.` : `${agent.knowsUntil} года`}; на анахронизмы реагируй удивлением.`
    : '';
  return [
    `Ты — ${agent.name}, персонаж кооперативной игры «Хронолёт» о путешествиях по истории науки.`,
    agent.persona,
    era,
    'Говори по-русски, от первого лица, 1–2 коротких предложения, без списков, кавычек, эмодзи и пометок вроде «Имя:».',
    'Опирайся только на данные о ситуации ниже. Не придумывай ход игры, числа и правила.',
    'Никогда не называй готовый ответ головоломки и не обещай выдать деталь: детали выдаёт только сама игра.',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface PromptInput {
  agent: AgentProfile;
  situation: string[];
  recent: string[];
  memory?: LlmMemory | null;
  /** Что именно сделать (инструкция, не готовая реплика). */
  task: string;
}

export function buildMessages(p: PromptInput): ChatMessage[] {
  const parts = ['Ситуация:', ...p.situation.map((l) => `- ${l}`)];
  if (p.recent.length) parts.push('Недавно:', ...p.recent.slice(-6).map((l) => `- ${l}`));
  if (p.memory && (p.memory.summary || p.memory.mistakes.length)) {
    parts.push('Что ты помнишь об этом игроке:');
    if (p.memory.summary) parts.push(`- ${p.memory.summary}`);
    if (p.memory.mistakes.length) parts.push(`- его ошибки: ${p.memory.mistakes.slice(-3).join('; ')}`);
  }
  parts.push('', `Задача: ${p.task}`);
  return [
    { role: 'system', content: systemPrompt(p.agent) },
    { role: 'user', content: parts.join('\n') },
  ];
}

/** Убрать то, что 3B-модели любят добавлять: «ХРОНОС:», кавычки, переносы; обрезать по предложению. */
export function cleanReply(raw: string, agent: AgentProfile): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(new RegExp(`^(${escapeRe(agent.name)}|ХРОНОС|Ответ)\\s*[:—-]\\s*`, 'i'), '');
  t = t.replace(/^[«"“']+|[»"”']+$/g, '').trim();
  if (t.length > agent.maxChars) {
    const cut = t.slice(0, agent.maxChars);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    t = end > agent.maxChars * 0.4 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
  }
  return t;
}

/** Перефраз подсказки обязан сохранить все числа исходника — иначе лучше сказать заготовку. */
export function keepsNumbers(original: string, paraphrase: string): boolean {
  // Сравниваем значения: «50.0» = «50», «7,2» = «7.2», «4 750» = «4750».
  const nums = (s: string) => (s.replace(/(\d)\s(?=\d{3}\b)/g, '$1').match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));
  const have = nums(paraphrase);
  return nums(original).every((n) => have.some((h) => Math.abs(h - n) < 1e-9));
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
