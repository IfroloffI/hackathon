import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_PROFILES } from '@chronolet/shared';
import { buildMessages, cleanReply, keepsNumbers, systemPrompt } from './prompt.ts';

const ship = AGENT_PROFILES.find((a) => a.id === 'ship_ai')!;
const galileo = AGENT_PROFILES.find((a) => a.id === 'galileo')!;

test('промпт: персона — стабильный префикс, задача и данные — в конце', () => {
  const m = buildMessages({ agent: galileo, situation: ['Место: Падуя'], recent: ['ошибка №2'], memory: null, task: 'Ответь игроку.' });
  assert.equal(m[0].content, systemPrompt(galileo), 'system одинаков между запросами (кэш префикса)');
  assert.match(m[0].content, /1642 года/);
  assert.match(m[1].content, /Ситуация:[\s\S]*Падуя[\s\S]*Недавно:[\s\S]*Задача: Ответь игроку\./);
});

test('чистка ответа: префиксы, кавычки, длина', () => {
  assert.equal(cleanReply('ХРОНОС: «Опять мимо.»', ship), 'Опять мимо.');
  const long = 'Первое предложение довольно длинное. '.repeat(20);
  const t = cleanReply(long, ship);
  assert.ok(t.length <= ship.maxChars && t.endsWith('.'), `обрезано по предложению: ${t.length}`);
});

test('перефраз подсказки сохраняет числа', () => {
  const hint = '360 / 7.2 = 50.0. Умножьте расстояние на это число.';
  assert.ok(keepsNumbers(hint, 'Раздели 360 на 7,2 — получится 50.0, и умножь на это расстояние.'));
  assert.ok(!keepsNumbers(hint, 'Раздели круг на угол и умножь на расстояние.'));
  assert.ok(keepsNumbers(hint, 'Подели 360 на 7,2 — выйдет 50; умножь расстояние на 50.'), '50.0 и 50 — одно число');
});
