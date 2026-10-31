import { ClientMsg, ServerMsg, type ChatBroadcast } from '@chronolet/shared';
import { net, type CrewRoom, type NetPlayer } from '../net/connection.ts';
import { copyText, inviteLink } from './invite.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** HUD внутри комнаты: код, статус сети, список экипажа, чат. */
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
  const unbind: (() => void)[] = [
    $cb.listen('crewName', (v) => ($('crew-name').textContent = String(v ?? ''))),
    $cb.onAdd('players', (p) => {
      renderCrew();
      unbind.push($cb.onChange(p as NetPlayer, renderCrew));
    }),
    $cb.onRemove('players', renderCrew),
    room.onMessage(ServerMsg.Chat, (m: ChatBroadcast) => addLine(`${m.name}: ${m.text}`)),
    room.onMessage(ServerMsg.System, (m: { text: string }) => addLine(m.text, true)),
  ];

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
    toast.hidden = true;
    hud.hidden = true;
  };
}
