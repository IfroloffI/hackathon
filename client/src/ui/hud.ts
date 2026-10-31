import {
  ACHIEVEMENTS,
  ClientMsg,
  EMOTES,
  EPOCHS,
  ServerMsg,
  achievement,
  epochByLevel,
  levelFromXp,
  type AchievementBroadcast,
  type ChatBroadcast,
  type CoinPickup,
  type LikeBroadcast,
  type SayPayload,
  type XpGain,
} from '@chronolet/shared';
import { net, type CrewRoom, type NetPlayer } from '../net/connection.ts';
import { copyText, inviteLink } from './invite.ts';
import { mountPuzzlePanel } from './puzzlePanel.ts';
import { renderLeaderboard } from './leaderboard.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const isTyping = () => {
  const t = document.activeElement as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
};

/**
 * HUD в стиле VK (тёмная тема поверх 3D): шапка с уровнем и XP, цель сценария с таймером,
 * экипаж с лайками, стикеры, снекбары ачивок и опыта, чат с репликами агентов (в т. ч. потоковыми от LLM).
 */
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
  // Объявлено до подписок: они срабатывают сразу и уже читают это состояние.
  let lastCoins = -1;
  let lastLevel = 0;
  let subTimer = 0;
  const likeLock = new Map<string, number>();
  /** Потоковые реплики LLM: streamId → строка чата, которую дописываем. */
  const streams = new Map<string, HTMLLIElement>();
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
    room.onMessage(ServerMsg.System, (m: { text: string }) => addLine(m.text, 'sys')),
    room.onMessage(ServerMsg.Say, (m: SayPayload) => say(m)),
    room.onMessage(ServerMsg.Coin, (m: CoinPickup) => {
      if (m.sessionId !== room.sessionId) addLine(`${m.name} подобрал VK Coin`, 'coin');
    }),
    room.onMessage(ServerMsg.Like, (m: LikeBroadcast) => addLine(`${m.fromName} ❤ ${m.toName}`, 'like')),
    room.onMessage(ServerMsg.Achievement, (m: AchievementBroadcast) => {
      const a = achievement(m.id);
      if (!a) return;
      const mine = m.sessionId === room.sessionId;
      snack(`<span class="icon">${a.icon}</span><div><b>${mine ? 'Новый значок' : escape(m.name)}: ${escape(a.title)}</b><small>${escape(a.description)}${a.coins ? ` · +${a.coins} VK Coin` : ''}</small></div>`, mine ? 5000 : 3000);
      addLine(`${a.icon} ${m.name} получает «${a.title}»`, 'ach');
    }),
    room.onMessage(ServerMsg.Xp, (m: XpGain) => snack(`+${m.amount} XP · ${escape(m.reason)}`, 1800, 'xp')),
    $cb.listen('levelId', () => renderLocation()),
    $cb.listen('finished', (v) => ($('finale').hidden = !v)),
    $cb.onAdd('parts', () => renderParts()),
    $cb.listen('scenario', (s) => {
      if (s) unbind.push($cb.onChange(s, renderObjective));
      renderObjective();
    }),
    mountPuzzlePanel(room),
  );
  renderParts();
  renderLocation();
  renderMe();
  renderEmotes();
  const objTimer = window.setInterval(renderObjectiveTimer, 1000);

  function me() {
    return room.state.players.get(room.sessionId);
  }

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

  function renderMe() {
    const p = me();
    if (!p) return;
    const av = $('me-avatar');
    av.textContent = p.name.slice(0, 1).toUpperCase();
    av.style.background = hex(p.color);
    $('me-name').textContent = p.name;
    const lv = levelFromXp(p.xp);
    $('xp-level').textContent = `ур. ${lv.level}`;
    $('xp-bar').style.width = `${Math.round(((p.xp - lv.from) / (lv.to - lv.from)) * 100)}%`;
    $('me-avatar').title = `${p.xp} XP · до уровня ${lv.level + 1}: ${lv.to - p.xp}`;
    if (lastLevel && lv.level > lastLevel) snack(`<span class="icon">⭐</span><div><b>Новый уровень: ${lv.level}!</b><small>${p.xp} XP</small></div>`, 4000);
    lastLevel = lv.level;
    renderWallet(p.coins);
  }

  function renderWallet(n: number) {
    if (n === lastCoins) return;
    const wallet = $('wallet');
    $('coin-count').textContent = String(n);
    if (lastCoins >= 0 && n > lastCoins) {
      wallet.classList.remove('bump');
      void wallet.offsetWidth; // перезапуск CSS-анимации
      wallet.classList.add('bump');
    }
    lastCoins = n;
  }

  function renderObjective() {
    const s = room.state.scenario;
    const card = $('objective');
    if (!s || !s.goal) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    $('obj-title').textContent = s.steps ? `${s.title} · шаг ${Math.min(s.stepIndex + 1, s.steps)}/${s.steps}` : 'Цель';
    $('obj-goal').textContent = s.goal;
    $('obj-progress').style.width = s.steps ? `${Math.round((s.stepIndex / s.steps) * 100)}%` : '0%';
    renderObjectiveTimer();
  }

  /** Таймер шага против контрольного времени (уложился — бонус XP). */
  function renderObjectiveTimer() {
    const s = room.state.scenario;
    const el = $('obj-timer');
    if (!s || !s.stepId || !s.stepStartedAt) {
      el.textContent = '';
      return;
    }
    const sec = Math.max(0, Math.floor((Date.now() - s.stepStartedAt) / 1000));
    const mm = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
    el.textContent = s.parSeconds ? `⏱ ${mm(sec)} / ${mm(s.parSeconds)}` : `⏱ ${mm(sec)}`;
    el.classList.toggle('late', !!s.parSeconds && sec > s.parSeconds);
  }

  function renderCrew() {
    renderMe();
    crewList.replaceChildren();
    const pz = room.state.puzzle;
    room.state.players.forEach((p, id) => {
      const li = document.createElement('li');
      if (!p.connected) li.className = 'off';
      const av = Object.assign(document.createElement('span'), { className: 'avatar', textContent: p.name.slice(0, 1).toUpperCase() });
      av.style.background = hex(p.color);
      const who = document.createElement('span');
      who.className = 'who';
      const role = pz?.observer === id ? ' 🔭' : pz?.mechanic === id ? ' 🔧' : '';
      who.append(Object.assign(document.createElement('b'), { textContent: `${p.name}${id === room.sessionId ? ' (ты)' : ''}${role}` }));
      who.append(Object.assign(document.createElement('small'), { textContent: `ур. ${levelFromXp(p.xp).level} · ❤ ${p.likes} · 🏅 ${p.achievements.length}` }));
      li.append(av, who);
      if (id !== room.sessionId) {
        const btn = Object.assign(document.createElement('button'), { className: 'like', textContent: '❤', title: `Лайкнуть ${p.name}` });
        btn.disabled = (likeLock.get(id) ?? 0) > Date.now();
        btn.onclick = () => {
          room.send(ClientMsg.Like, { target: id });
          likeLock.set(id, Date.now() + 15_000);
          btn.disabled = true;
          setTimeout(renderCrew, 15_100);
        };
        li.append(btn);
      }
      crewList.append(li);
    });
  }

  function renderEmotes() {
    const bar = $('emotes');
    bar.replaceChildren();
    EMOTES.forEach((e, i) => {
      const b = document.createElement('button');
      b.innerHTML = `${e}<small>${i + 1}</small>`;
      b.onclick = () => room.send(ClientMsg.Emote, { emote: i });
      bar.append(b);
    });
  }

  function addLine(text: string, cls = '') {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    chatLog.append(li);
    chatLog.scrollTop = chatLog.scrollHeight;
    return li;
  }

  /** Реплики персонажей: субтитр + строка в чате; потоковые (LLM) дописываются по streamId. */
  function say(m: SayPayload) {
    const prefix = m.hint ? `💡 Подсказка ${m.hint}/3 — ` : '';
    const line = `${m.speaker}: ${prefix}${m.text}`;
    const cls = m.agentId === 'ship_ai' ? 'say ai' : 'say';
    if (m.streamId) {
      let li = streams.get(m.streamId);
      if (!li) streams.set(m.streamId, (li = addLine(line, cls)));
      li.textContent = line;
      if (!m.partial) streams.delete(m.streamId);
    } else {
      addLine(line, cls);
    }
    const sub = $('subtitle');
    sub.replaceChildren(Object.assign(document.createElement('b'), { textContent: `${m.speaker}${m.source === 'llm' ? ' ✦' : ''}: ` }));
    const body = Object.assign(document.createElement('span'), { textContent: `${prefix}${m.text}` });
    if (m.partial) body.className = 'typing';
    sub.append(body);
    sub.className = `vk-dark-card ${m.agentId === 'ship_ai' ? 'ai' : 'npc'}`;
    sub.hidden = false;
    clearTimeout(subTimer);
    if (!m.partial) subTimer = window.setTimeout(() => (sub.hidden = true), 6000 + m.text.length * 40);
  }

  function snack(html: string, ms: number, cls = '') {
    const el = document.createElement('div');
    el.className = `snack ${cls}`;
    el.innerHTML = html;
    $('toasts').append(el);
    setTimeout(() => el.remove(), ms);
  }

  // ── рейтинг и значки
  const rating = $('rating');
  const openRating = async () => {
    rating.hidden = false;
    await renderLeaderboard($('rating-list'));
    const mine: string[] = me() ? [...me()!.achievements] : [];
    $('my-badges').replaceChildren(
      ...ACHIEVEMENTS.map((a) =>
        Object.assign(document.createElement('li'), {
          className: mine.includes(a.id) ? '' : 'locked',
          textContent: `${a.icon} ${a.title}`,
          title: a.description,
        }),
      ),
    );
  };
  $('rating-btn').onclick = () => (rating.hidden ? void openRating() : (rating.hidden = true));
  $('rating-close').onclick = () => (rating.hidden = true);

  const onGlobalKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') rating.hidden = true;
    if (e.key === 'Enter' && document.activeElement !== chatInput) {
      e.preventDefault();
      chatInput.focus();
      return;
    }
    // 1–6 — стикеры над головой.
    if (!isTyping() && !e.repeat && /^Digit[1-6]$/.test(e.code)) room.send(ClientMsg.Emote, { emote: Number(e.code.slice(5)) - 1 });
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

  room.onDrop(() => setStatus(false));
  room.onReconnect(() => setStatus(true));
  room.onLeave(() => setStatus(false));
  function setStatus(ok: boolean) {
    status.textContent = ok ? '● online' : '● переподключение…';
    status.className = ok ? 'ok' : 'bad';
  }

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
    clearInterval(objTimer);
    toast.hidden = true;
    rating.hidden = true;
    $('subtitle').hidden = true;
    $('finale').hidden = true;
    $('toasts').replaceChildren();
    hud.hidden = true;
  };
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
