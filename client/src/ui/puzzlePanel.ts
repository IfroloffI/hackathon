import { ClientMsg, ServerMsg, type PuzzleId, type PuzzleViewMessage, type Role } from '@chronolet/shared';
import { net, type CrewRoom } from '../net/connection.ts';
import { RENDERERS } from './puzzles.ts';

const ROLE_LABEL: Record<Role, string> = { observer: '🔭 Наблюдатель', mechanic: '🔧 Механик' };

/**
 * Панель головоломки эпохи. Шапка — публичное состояние из state.puzzle (видят все),
 * тело — приватные виды своей роли из сообщений puzzle.view (видит только держатель роли).
 */
export function mountPuzzlePanel(room: CrewRoom): () => void {
  const panel = document.getElementById('puzzle')!;
  const head = document.getElementById('puzzle-head')!;
  const body = document.getElementById('puzzle-body')!;
  const views = new Map<Role, unknown>();
  let viewsFor = '';

  const nameOf = (sid: string) => (sid ? (room.state.players.get(sid)?.name ?? '…') : null);

  function renderHead() {
    const pz = room.state.puzzle;
    panel.hidden = !pz?.id;
    if (!pz?.id) return;
    const roleLine = (r: Role) => {
      const n = nameOf(pz[r]);
      return `<span class="${n ? '' : 'muted'}">${ROLE_LABEL[r]}: ${n ? `<b>${escape(n)}</b>` : 'свободно'}</span>`;
    };
    head.innerHTML = `
      <h3>${escape(pz.title)}${pz.solved ? ' ✅' : ''}</h3>
      <p>${escape(pz.stage)}</p>
      <p class="pz-roles">${roleLine('observer')} ${roleLine('mechanic')} <span class="muted">попыток: ${pz.attempts}</span></p>`;
  }

  function renderBody() {
    const pz = room.state.puzzle;
    if (!pz?.id) return;
    if (viewsFor !== pz.id) views.clear();
    const mine = (['observer', 'mechanic'] as Role[]).filter((r) => pz[r] === room.sessionId && views.has(r));
    body.replaceChildren();
    if (mine.length === 0) {
      body.innerHTML = pz.solved
        ? '<p class="ok">Деталь получена! Все — к Колизиуму (зелёный круг слева) и E.</p>'
        : '<p class="muted">Подойди к светящемуся кругу роли (голубой — Наблюдатель, оранжевый — Механик) и нажми <kbd>E</kbd>. Свободные руки — помогайте словом или делом.</p>';
      return;
    }
    for (const role of mine) {
      const box = document.createElement('div');
      box.className = 'pz-view';
      if (mine.length > 1) box.insertAdjacentHTML('beforeend', `<h4>${ROLE_LABEL[role]}</h4>`);
      const inner = document.createElement('div');
      box.append(inner);
      body.append(box);
      RENDERERS[pz.id as PuzzleId][role](inner, views.get(role) as never, (action, value) =>
        room.send(ClientMsg.PuzzleAction, { action, value, role }),
      );
    }
  }

  const $ = net.callbacks(room);
  // Подписки могут сработать сразу (state уже есть) и дописать в unbind — поэтому массив создаём заранее.
  const unbind: (() => void)[] = [];
  unbind.push(
    // puzzle приходит с первым патчем state — подписываемся на его изменения, когда он появится.
    $.listen('puzzle', (pz) => {
      if (!pz) return;
      unbind.push(
        $.onChange(pz, () => {
          renderHead();
          renderBody();
        }),
      );
      renderHead();
      renderBody();
    }),
    $.onChange('players', renderHead),
    room.onMessage(ServerMsg.PuzzleView, (m: PuzzleViewMessage) => {
      if (viewsFor !== m.puzzleId) {
        views.clear();
        viewsFor = m.puzzleId;
      }
      if (m.role) views.set(m.role, m.view);
      else views.clear();
      renderBody();
    }),
  );
  renderHead();
  renderBody();

  return () => {
    unbind.forEach((u) => u());
    panel.hidden = true;
  };
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
