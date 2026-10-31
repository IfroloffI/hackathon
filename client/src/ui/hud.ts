import { ClientMsg, EPOCHS, ServerMsg, epochByLevel, type ChatBroadcast, type SayPayload } from '@chronolet/shared';
import { net, type CrewRoom, type NetPlayer } from '../net/connection.ts';
import { copyText, inviteLink } from './invite.ts';
import { mountPuzzlePanel } from './puzzlePanel.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** HUD внутри комнаты: код, статус сети, где экипаж, детали двигателя, реплики персонажей, экипаж, чат, головоломка. */
export function showHud(room: CrewRoom, opts: { onLeave: () => void; onTyping: (typing: boolean) => void }) {
  const hud = $('hud');
  const crewList = $<HTMLUListElement>('crew-list');
  const chatLog = $<HTMLUListElement>('chat-log');
  const chatInput = $<HTMLInputElement>('chat-input');
  const status = $('net-status');

  hud.hidden = false;
  $('room-code').textContent = room.roomId;
  chatLog.replaceChildren();

  const $cb = net.callbacks(room);
  // Подписки могут сработать сразу (state уже есть) и дописать в unbind — поэтому массив создаём заранее.
  const unbind: (() => void)[] = [];
  unbind.push(
    $cb.listen('crewName', (v) => ($('crew-name').textContent = String(v ?? ''))),
    $cb.onAdd('players', (p) => {
      renderCrew();
      unbind.push($cb.onChange(p as NetPlayer, renderCrew));
    }),
    $cb.onRemove('players', renderCrew),
    room.onMessage(ServerMsg.Chat, (m: ChatBroadcast) => addLine(`${m.name}: ${m.text}`)),
    room.onMessage(ServerMsg.System, (m: { text: string }) => addLine(m.text, true)),
    room.onMessage(ServerMsg.Say, (m: SayPayload) => say(m)),
    $cb.listen('levelId', () => renderLocation()),
    $cb.listen('finished', (v) => ($('finale').hidden = !v)),
    $cb.onAdd('parts', () => renderParts()),
    mountPuzzlePanel(room),
  );
  renderParts();
  renderLocation();

  function renderLocation() {
    const e = epochByLevel(room.state.levelId);
    $('location').textContent = e ? `Эпоха ${e.index + 1}/5 · ${e.title}, ${e.year}` : 'Борт хронолёта';
  }

  function renderParts() {
    const parts = $('parts');
    parts.replaceChildren();
    for (const e of EPOCHS) {
      const li = document.createElement('li');
      const has = room.state.parts.includes(e.part.id);
      li.className = has ? 'have' : '';
      li.title = `${e.part.name} — ${e.title}`;
      li.textContent = has ? e.part.name : '?';
      parts.append(li);
    }
  }

  /** Реплики персонажей: субтитр сверху + строка в чате. Подсказки ХРОНОСа помечены уровнем. */
  let subTimer = 0;
  function say(m: SayPayload) {
    const sub = $('subtitle');
    const prefix = m.hint ? `💡 Подсказка ${m.hint}/3 — ` : '';
    sub.innerHTML = '';
    sub.append(Object.assign(document.createElement('b'), { textContent: `${m.speaker}: ` }), `${prefix}${m.text}`);
    sub.className = `panel ${m.agentId === 'ship_ai' ? 'ai' : 'npc'}`;
    sub.hidden = false;
    clearTimeout(subTimer);
    subTimer = window.setTimeout(() => (sub.hidden = true), 6000 + m.text.length * 40);
    const li = document.createElement('li');
    li.className = m.agentId === 'ship_ai' ? 'say ai' : 'say';
    li.textContent = `${m.speaker}: ${prefix}${m.text}`;
    chatLog.append(li);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  room.onDrop(() => setStatus(false));
  room.onReconnect(() => setStatus(true));
  room.onLeave(() => setStatus(false));

  function setStatus(ok: boolean) {
    status.textContent = ok ? 'online' : 'переподключение…';
    status.className = ok ? 'ok' : 'bad';
  }

  function renderCrew() {
    crewList.replaceChildren();
    room.state.players.forEach((p, id) => {
      const li = document.createElement('li');
      if (!p.connected) li.className = 'off';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = `#${p.color.toString(16).padStart(6, '0')}`;
      li.append(dot, `${p.name}${id === room.sessionId ? ' (ты)' : ''}`);
      crewList.append(li);
    });
  }

  function addLine(text: string, system = false) {
    const li = document.createElement('li');
    li.textContent = text;
    if (system) li.className = 'sys';
    chatLog.append(li);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  const onGlobalKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && document.activeElement !== chatInput) {
      e.preventDefault();
      chatInput.focus();
    }
  };
  addEventListener('keydown', onGlobalKey);
  chatInput.onfocus = () => opts.onTyping(true);
  chatInput.onblur = () => opts.onTyping(false);
  chatInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) room.send(ClientMsg.Chat, { text });
      chatInput.value = '';
      chatInput.blur();
    } else if (e.key === 'Escape') {
      chatInput.blur();
    }
  };

  $('leave').onclick = () => opts.onLeave();

  const toast = $('toast');
  let toastTimer = 0;
  $('invite').onclick = async () => {
    const link = await inviteLink(room.roomId);
    const copied = await copyText(link);
    toast.replaceChildren(copied ? 'Скопировано: ' : 'Скопируй вручную: ', Object.assign(document.createElement('code'), { textContent: link }));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.hidden = true), copied ? 4000 : 12000);
  };

  return () => {
    unbind.forEach((u) => u());
    removeEventListener('keydown', onGlobalKey);
    clearTimeout(toastTimer);
    clearTimeout(subTimer);
    toast.hidden = true;
    $('subtitle').hidden = true;
    $('finale').hidden = true;
    hud.hidden = true;
  };
}
