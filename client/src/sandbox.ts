/**
 * Песочница головоломок (только dev: http://localhost:5173/sandbox.html).
 * Настоящие серверные головоломки крутятся прямо в браузере, оба экрана ролей — рядом:
 * удобно править интерфейс без беготни по уровню. В prod-сборку не входит.
 */
import './style.css';
import type { PuzzleId, Role } from '@chronolet/shared';
import { RENDERERS } from './ui/puzzles.ts';
import { createPuzzle } from '../../server/src/puzzles/index.ts';

const ids: PuzzleId[] = ['eratosthenes', 'galileo', 'newton', 'enigma', 'korolev'];
const root = document.getElementById('sb-root')!;
root.innerHTML = `<style>
  body.sandbox { overflow: auto; background: #0a0d14; padding: 16px; }
  .sb-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 400px)); gap: 12px; margin-bottom: 28px; }
  .sb-head { color: #e1e3e6; display: flex; gap: 12px; align-items: baseline; margin: 8px 0; }
  .sb-head small { color: #76787a; }
  .sb-panel { padding: 12px 14px; }
</style>`;

for (const id of ids) {
  const puzzle = createPuzzle(id);
  const head = document.createElement('div');
  head.className = 'sb-head';
  const grid = document.createElement('div');
  grid.className = 'sb-grid';
  const panels = (['observer', 'mechanic'] as Role[]).map((role) => {
    const el = document.createElement('section');
    el.className = 'vk-dark-card sb-panel';
    el.dataset.role = role;
    grid.append(el);
    return { role, el };
  });
  const render = () => {
    head.innerHTML = `<h3>${id}</h3><small>${puzzle.stageText()} · попыток ${puzzle.attempts}${puzzle.solved ? ' · ✅' : ''}</small>`;
    for (const { role, el } of panels) {
      el.innerHTML = `<h4 style="margin:0 0 6px;color:#71aaeb">${role === 'observer' ? '🔭 Наблюдатель' : '🔧 Механик'}</h4><div></div>`;
      RENDERERS[id][role](el.lastElementChild as HTMLElement, puzzle.view(role) as never, (action, value) => {
        const res = puzzle.act(role, action, value);
        if (res?.message) console.info(`[${id}]`, res.event ?? '', res.message);
        render();
      });
    }
  };
  render();
  // Облака Галилея и прочее «само по себе» — перерисовка раз в секунду.
  setInterval(() => puzzle.nextChangeAt() && render(), 1000);
  root.append(head, grid);
}
