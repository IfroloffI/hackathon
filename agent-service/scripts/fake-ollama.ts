/**
 * Имитация Ollama для проверки agent-service без модели (и без интернета):
 * /api/tags и потоковый /api/chat (NDJSON) с задержкой первого токена и скоростью как у 3B на CPU.
 *   FAKE_TTFT_MS=800 FAKE_TPS=8 PORT=11435 npx tsx scripts/fake-ollama.ts
 * Ответ: для подсказок — пересказ текста из «…» в задаче (числа сохраняются), иначе — короткая фраза.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 11435);
const TTFT = Number(process.env.FAKE_TTFT_MS ?? 800);
const TPS = Number(process.env.FAKE_TPS ?? 8);
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';

function reply(task: string): string {
  const quoted = /«([^»]+)»\.?\s*$/.exec(task)?.[1];
  if (/Перескажи своими словами/.test(task) && quoted) return `Слушайте внимательно, экипаж. ${quoted}`;
  if (/спрашивает/.test(task) && quoted) return `Хороший вопрос про «${quoted.slice(0, 40)}». Смотрите на цель шага и проверяйте гипотезы вместе.`;
  if (/ошиб/.test(task)) return 'Мимо, но уже теплее. Сверьте, что видит Наблюдатель, с тем, что крутит Механик.';
  if (/прошёл этап|решена/.test(task)) return 'Неплохо, экипаж. Не расслабляйтесь — дальше будет сложнее.';
  if (/без дела/.test(task)) return 'Эй, вы там уснули? История сама себя не починит.';
  return 'Я на связи. Действуем по плану.';
}

http
  .createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.end(JSON.stringify({ models: [{ name: MODEL }] }));
      return;
    }
    if (req.url === '/api/chat' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { messages } = JSON.parse(body) as { messages: { content: string }[] };
        const task = /Задача: ([\s\S]*)$/.exec(messages.at(-1)!.content)?.[1] ?? '';
        const tokens = reply(task).split(/(?<=\s)/);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        let i = 0;
        const next = () => {
          if (res.destroyed) return;
          if (i >= tokens.length) {
            res.end(JSON.stringify({ done: true }) + '\n');
            return;
          }
          res.write(JSON.stringify({ message: { content: tokens[i++] }, done: false }) + '\n');
          setTimeout(next, 1000 / TPS);
        };
        setTimeout(next, TTFT);
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  })
  .listen(PORT, () => console.log(`[fake-ollama] :${PORT} ttft=${TTFT}ms tps=${TPS}`));
