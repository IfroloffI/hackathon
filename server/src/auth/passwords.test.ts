import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, passwordProblem, verifyPassword } from './passwords.ts';

test('пароли: scrypt с солью, проверка, правила', async () => {
  const h1 = await hashPassword('секрет-123');
  const h2 = await hashPassword('секрет-123');
  assert.notEqual(h1, h2, 'соль разная — хэши разные');
  assert.ok(h1.startsWith('scrypt$'));
  assert.equal(await verifyPassword('секрет-123', h1), true);
  assert.equal(await verifyPassword('секрет-124', h1), false);
  assert.equal(await verifyPassword('секрет-123', null), false, 'аккаунт без пароля не пускаем');
  assert.equal(await verifyPassword('x', 'мусор'), false);
  assert.equal(passwordProblem('12345'), 'Пароль — минимум 6 символов');
  assert.equal(passwordProblem('123456'), null);
  assert.ok(passwordProblem(undefined));
});
