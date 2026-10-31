import { ClientMsg, EPOCHS, ServerMsg, epochByLevel, type ChatBroadcast, type SayPayload } from '@chronolet/shared';
import { net, type CrewRoom, type NetPlayer } from '../net/connection.ts';
import { VoiceChat, type VoiceSnapshot } from '../net/voice.ts';
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
  let speakers = new Set<string>();

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
      const speaking = p.connected && speakers.has(p.name.toLowerCase());
      if (speaking) li.classList.add('speaking');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = `#${p.color.toString(16).padStart(6, '0')}`;
      li.append(dot, `${p.name}${id === room.sessionId ? ' (ты)' : ''}`);
      if (speaking) li.append(Object.assign(document.createElement('span'), { className: 'wave', textContent: '▮▮▮' }));
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

  // ── голосовой чат (LiveKit): кнопка, статус, микрофон и «кто говорит» ──
  const voice = new VoiceChat(room.roomId, () => room.state.players.get(room.sessionId)?.name ?? '');
  const voiceStatus = $('voice-status');
  const voiceToggle = $<HTMLButtonElement>('voice-toggle');
  const voiceMute = $<HTMLButtonElement>('voice-mute');
  const voiceUnblock = $<HTMLButtonElement>('voice-unblock');
  let livekitOff = false;

  const voiceLabel = (s: VoiceSnapshot): string => {
    switch (s.state) {
      case 'off': return 'голос: выкл';
      case 'connecting': return 'голос: подключение…';
      case 'reconnecting': return 'голос: переподключение…';
      case 'error': return `голос: ${s.error ?? 'ошибка'}`;
      case 'live': return `голос: в эфире · ${s.participants}${s.muted ? ' (микрофон выкл)' : ''}`;
    }
  };

  const unbindVoice = voice.onChange((s) => {
    voiceStatus.textContent = voiceLabel(s);
    voiceStatus.className = s.state === 'live' ? 'ok' : s.state === 'error' || s.state === 'reconnecting' ? 'bad' : 'muted';
    voiceToggle.textContent = s.state === 'off' || s.state === 'error' ? '🎤 Включить голос' : '⏹ Отключить голос';
    voiceToggle.disabled = s.state === 'connecting' || (livekitOff && s.state === 'off');
    voiceToggle.classList.toggle('on', s.state === 'live');
    voiceMute.hidden = s.state !== 'live';
    voiceMute.textContent = s.muted ? '🔇 Микрофон выкл' : '🎙 Микрофон вкл';
    voiceMute.classList.toggle('on', !s.muted);
    voiceUnblock.hidden = !s.audioBlocked;
    speakers = new Set(s.speakers.map((n) => n.toLowerCase()));
    renderCrew();
  });

  voiceToggle.onclick = () => {
    if (voice.enabled) void voice.disable();
    else void voice.enable();
  };
  voiceMute.onclick = () => void voice.toggleMute();
  voiceUnblock.onclick = () => void voice.resumeAudio();

  void net.livekitStatus().then((s) => {
    if (s.enabled || voice.enabled) return;
    livekitOff = true;
    voiceStatus.textContent = 'голос: выключен на сервере';
    voiceStatus.className = 'bad';
    voiceToggle.disabled = true;
  }).catch(() => undefined);

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
    unbindVoice();
    voice.destroy();
    removeEventListener('keydown', onGlobalKey);
    clearTimeout(toastTimer);
    clearTimeout(subTimer);
    toast.hidden = true;
    $('subtitle').hidden = true;
    $('finale').hidden = true;
    hud.hidden = true;
  };
}
