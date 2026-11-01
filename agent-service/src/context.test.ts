import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GameEvent } from '@chronolet/shared';
import { ctx, hearPhrase, markAnswered, remember, saidBy, speechLines, tooSimilar } from './context.ts';

const say = (session: string, agentId: string, text: string, seq: number) =>
  ({ seq, ts: Date.now(), session, type: 'agent.say', level: 'padua', scenario: null, step: null, player: null, data: { agentId, text } }) as unknown as GameEvent;

test('свои реплики агента копятся (последние 5) — модель видит, что уже говорила', () => {
  for (let i = 1; i <= 7; i++) remember(say('S1', 'galileo', `реплика ${i}`, i));
  assert.deepEqual(saidBy(ctx('S1'), 'galileo'), ['реплика 3', 'реплика 4', 'реплика 5', 'реплика 6', 'реплика 7']);
  assert.deepEqual(saidBy(ctx('S1'), 'ship_ai'), []);
});

test('расшифровки: дубликаты не копятся, история не считается поводом, живые фразы — считаются', () => {
  const now = Date.now();
  hearPhrase('S2', { name: 'Аня', text: 'привет', at: now - 1000 }, true);
  hearPhrase('S2', { name: 'Аня', text: 'привет', at: now - 1000 }, true);
  assert.equal(ctx('S2').speechSinceComment, 0);
  hearPhrase('S2', { name: 'Боря', text: 'куда идти?', at: now });
  assert.equal(ctx('S2').speechSinceComment, 1);
  assert.deepEqual(speechLines(ctx('S2'), now), ['Аня: «привет»', 'Боря: «куда идти?»']);
  hearPhrase('S2', { name: 'Вова', text: 'старое', at: now - 10 * 60_000 });
  assert.equal(speechLines(ctx('S2'), now).length, 2, 'старше 4 минут — не в промпт');
});

test('повтор прошлой реплики распознаётся, новая мысль — нет', () => {
  const said = ['Кстати, рычаг прыжка тут ни к чему, а паркур-отсек — это забавно.'];
  assert.ok(tooSimilar('Кстати, рычаг прыжка ни к чему, а паркур-отсек действительно забавный.', said));
  assert.ok(!tooSimilar('Аня, толкай ящик к скале — с него залезешь наверх.', said));
});

test('отвеченные фразы второй раз не подаются как новые', () => {
  const now = Date.now();
  hearPhrase('S3', { name: 'Аня', text: 'зачем рычаг?', at: now - 2000 });
  const c = ctx('S3');
  markAnswered(c);
  assert.equal(c.speechSinceComment, 0);
  assert.deepEqual(speechLines(c, now, 4 * 60_000, c.answeredUpTo), []);
  hearPhrase('S3', { name: 'Боря', text: 'а где ящик?', at: now });
  assert.deepEqual(speechLines(c, now, 4 * 60_000, c.answeredUpTo), ['Боря: «а где ящик?»']);
});

test('общее имя и пара слов — не повтор', () => {
  const said = ['admiok теперь Механик. Посмотрим, что из этого выйдет.'];
  assert.ok(!tooSimilar('admiok, Механик, толкни ящик к скале — по нему залезешь наверх.', said));
});
