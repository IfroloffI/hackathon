import {
  AGENT_BEHAVIOR_MAX,
  AGENT_PROFILES,
  AdminMsg,
  AdminServerMsg,
  DEFAULT_ADMIN_SETTINGS,
  EPOCHS,
  epochByLevel,
  type AdminCommand,
  type AdminResult,
  type AdminSettings,
  type AdminStatsPayload,
  type ClientMetricsRow,
} from '@chronolet/shared';
import { net, type CrewRoom } from '../net/connection.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const fpsClass = (fps: number) => (fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'bad');
const pingClass = (ms: number) => (ms <= 80 ? 'good' : ms <= 150 ? 'warn' : 'bad');
const dur = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
const levelName = (id: string) => epochByLevel(id)?.title ?? 'Борт';

/**
 * Панель администратора комнаты (только у хоста): метрики всех клиентов (FPS, ping и др.),
 * активность NPC, поведение агентов-персонажей, правка вселенной.
 * Сервер сам проверяет, что команды шлёт хост, — кнопка лишь скрыта у остальных.
 */
export function mountAdminPanel(room: CrewRoom, opts: { onTyping: (typing: boolean) => void }) {
  const panel = $('admin');
  const btn = $<HTMLButtonElement>('admin-btn');
  const status = $('admin-status');
  let open = false;
  let settings: AdminSettings = structuredClone(DEFAULT_ADMIN_SETTINGS);

  const isAdmin = () => {
    const me = room.state.players.get(room.sessionId);
    return !!me && !!room.state.host && me.name === room.state.host;
  };

  const $cb = net.callbacks(room);
  const unbind: (() => void)[] = [];
  const syncButton = () => {
    btn.hidden = !isAdmin();
    if (btn.hidden && open) close();
  };
  unbind.push(
    $cb.listen('host', syncButton),
    $cb.onAdd('players', syncButton),
    room.onMessage(AdminServerMsg.Stats, (s: AdminStatsPayload) => renderStats(s)),
    room.onMessage(AdminServerMsg.Settings, (s: AdminSettings) => {
      settings = s;
      renderSettings();
    }),
    room.onMessage(AdminServerMsg.Result, (r: AdminResult) => flash(r.text, r.ok)),
  );
  syncButton();
  // Пока печатаешь в полях панели — персонаж не бегает.
  const onFocusIn = (e: FocusEvent) => opts.onTyping(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement);
  const onFocusOut = () => opts.onTyping(false);
  panel.addEventListener('focusin', onFocusIn);
  panel.addEventListener('focusout', onFocusOut);

  // ── вкладки
  const tabs = panel.querySelectorAll<HTMLButtonElement>('.admin-tabs button');
  const showTab = (name: string) => {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    panel.querySelectorAll<HTMLElement>('.admin-tab').forEach((s) => (s.hidden = s.dataset.tab !== name));
  };
  tabs.forEach((t) => (t.onclick = () => showTab(t.dataset.tab!)));
  showTab('metrics');

  function openPanel() {
    if (!isAdmin()) return;
    open = true;
    panel.hidden = false;
    room.send(AdminMsg.Subscribe, { on: true });
    renderUniverse();
  }
  function close() {
    open = false;
    panel.hidden = true;
    try {
      room.send(AdminMsg.Subscribe, { on: false });
    } catch {
      /* комната уже закрыта */
    }
  }
  btn.onclick = () => (open ? close() : openPanel());
  $('admin-close').onclick = close;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) close();
  };
  addEventListener('keydown', onKey);

  let flashTimer = 0;
  function flash(text: string, ok = true) {
    status.textContent = text;
    status.className = ok ? 'ok' : 'err';
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (status.textContent = ''), 4000);
  }

  // ── метрики
  function renderStats(s: AdminStatsPayload) {
    if (!open) return;
    const tile = (label: string, value: string, cls = '') => el('div', { className: `admin-tile ${cls}` }, el('small', { textContent: label }), el('b', { textContent: value }));
    $('admin-summary').replaceChildren(
      tile('Игроков', String(s.summary.count)),
      tile('Средний FPS', s.summary.fpsAvg.toFixed(0), fpsClass(s.summary.fpsAvg)),
      tile('Мин. FPS', s.summary.fpsMin.toFixed(0), fpsClass(s.summary.fpsMin)),
      tile('Средний ping', `${s.summary.pingAvg} мс`, pingClass(s.summary.pingAvg)),
      tile('Макс. ping', `${s.summary.pingMax} мс`, pingClass(s.summary.pingMax)),
    );

    const body = $('admin-clients');
    body.replaceChildren(...s.clients.map(row));
    if (!s.clients.length) body.append(el('tr', {}, el('td', { colSpan: 8, className: 'muted', textContent: 'Нет подключённых клиентов' })));

    const sv = s.server;
    $('admin-server').textContent =
      `Сервер: аптайм ${dur(sv.uptimeSec)} · комната ${dur(sv.roomAgeSec)} · heap ${sv.heapMb} МБ · RSS ${sv.rssMb} МБ · ` +
      `лаг event loop ${sv.loopLagMs} мс · ${levelName(sv.levelId)}, эпоха ${sv.epoch}/${EPOCHS.length}`;
  }

  function row(c: ClientMetricsRow) {
    const stale = !c.connected || c.staleSec < 0 || c.staleSec > 3;
    const state = !c.connected ? 'отключён' : c.staleSec < 0 ? 'нет данных' : c.staleSec > 3 ? `молчит ${c.staleSec} с` : c.hidden ? 'вкладка в фоне' : 'в игре';
    const tr = el(
      'tr',
      { className: stale ? 'stale' : '' },
      el('td', {}, el('b', { textContent: c.name }), c.isAdmin ? el('span', { className: 'vk-badge', textContent: 'админ' }) : '', c.sessionId === room.sessionId ? ' (ты)' : ''),
      el('td', { className: c.hidden ? '' : fpsClass(c.fps) }, el('b', { textContent: c.fps.toFixed(0) }), el('small', { textContent: ` ср. ${c.fpsAvg.toFixed(0)}` })),
      el('td', { className: pingClass(c.ping) }, el('b', { textContent: `${c.ping}` }), el('small', { textContent: ` ${c.pingMin}–${c.pingMax}` })),
      el('td', { className: c.frameMaxMs > 100 ? 'bad' : c.frameMaxMs > 50 ? 'warn' : '', textContent: `${c.frameMaxMs.toFixed(0)} мс` }),
      el('td', { textContent: c.memMb !== undefined ? `${c.memMb} МБ` : '—' }),
      el('td', { textContent: c.msgsPerSec.toFixed(1) }),
      el('td', { textContent: dur(c.onlineSec), title: c.viewport }),
      el('td', { className: 'muted', textContent: state }),
    );
    return tr;
  }

  // ── NPC и агенты
  const mainSlider = $<HTMLInputElement>('admin-npc-main');
  const secSlider = $<HTMLInputElement>('admin-npc-secondary');
  const sendSliders = () =>
    room.send(AdminMsg.Settings, { mainNpcActivity: Number(mainSlider.value), secondaryNpcActivity: Number(secSlider.value) } satisfies Partial<AdminSettings>);
  for (const s of [mainSlider, secSlider]) {
    s.oninput = () => ($(`${s.id}-val`).textContent = s.value);
    s.onchange = sendSliders;
  }

  const agentList = $('admin-agents');
  agentList.replaceChildren(
    ...AGENT_PROFILES.map((a) => {
      const epoch = EPOCHS.find((e) => e.levelId === a.levelId);
      const muted = el('input', { type: 'checkbox' });
      muted.dataset.agent = a.id;
      muted.dataset.field = 'muted';
      const behavior = el('textarea', {
        className: 'vk-input dark',
        rows: 2,
        maxLength: AGENT_BEHAVIOR_MAX,
        placeholder: 'Указание ведущего: например, «отвечай загадками» или «будь добрее к новичкам»',
      });
      behavior.dataset.agent = a.id;
      behavior.dataset.field = 'behavior';
      const save = el('button', { className: 'vk-btn vk-btn-secondary', textContent: 'Применить' });
      const apply = () =>
        room.send(AdminMsg.Settings, { agents: { [a.id]: { muted: muted.checked, behavior: behavior.value } } } satisfies Partial<AdminSettings>);
      save.onclick = apply;
      muted.onchange = apply;
      return el(
        'li',
        {},
        el('div', { className: 'agent-head' }, el('b', { textContent: a.name }), el('small', { className: 'muted', textContent: epoch ? ` · ${epoch.title}` : ' · бортовой ИИ' }), el('span', { className: 'grow' }), el('label', {}, muted, ' молчит')),
        el('small', { className: 'muted persona', textContent: a.persona }),
        behavior,
        save,
      );
    }),
  );

  function renderSettings() {
    mainSlider.value = String(settings.mainNpcActivity);
    secSlider.value = String(settings.secondaryNpcActivity);
    $('admin-npc-main-val').textContent = mainSlider.value;
    $('admin-npc-secondary-val').textContent = secSlider.value;
    agentList.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-agent]').forEach((f) => {
      const o = settings.agents[f.dataset.agent!];
      if (f.dataset.field === 'muted') (f as HTMLInputElement).checked = !!o?.muted;
      else if (document.activeElement !== f) f.value = o?.behavior ?? '';
    });
  }

  // ── вселенная
  const cmd = (c: AdminCommand) => room.send(AdminMsg.Command, c);
  const gotoSel = $<HTMLSelectElement>('admin-goto');
  gotoSel.replaceChildren(el('option', { value: 'hub', textContent: 'Борт Колизиума' }), ...EPOCHS.map((e, i) => el('option', { value: String(i), textContent: `${i + 1}. ${e.title}, ${e.year}` })));
  function renderUniverse() {
    $<HTMLInputElement>('admin-crew-name').value = room.state.crewName;
    const e = epochByLevel(room.state.levelId);
    gotoSel.value = e ? String(e.index) : 'hub';
  }
  $('admin-goto-btn').onclick = () => cmd({ type: 'goto', level: gotoSel.value === 'hub' ? 'hub' : Number(gotoSel.value) });
  $('admin-rename-btn').onclick = () => cmd({ type: 'rename', crewName: $<HTMLInputElement>('admin-crew-name').value });
  $('admin-announce-btn').onclick = () => {
    const input = $<HTMLInputElement>('admin-announce');
    cmd({ type: 'announce', text: input.value });
    input.value = '';
  };
  $('admin-crates-btn').onclick = () => cmd({ type: 'resetCrates' });
  $('admin-gate-btn').onclick = () => cmd({ type: 'openGate' });
  $('admin-coins-btn').onclick = () => cmd({ type: 'giveCoins', amount: Number($<HTMLInputElement>('admin-coins').value) });

  return {
    dispose() {
      if (open) close();
      unbind.forEach((u) => u());
      removeEventListener('keydown', onKey);
      panel.removeEventListener('focusin', onFocusIn);
      panel.removeEventListener('focusout', onFocusOut);
      clearTimeout(flashTimer);
      btn.hidden = true;
      panel.hidden = true;
    },
  };
}
