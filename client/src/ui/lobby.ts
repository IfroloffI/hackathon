import type { RoomListing } from '@chronolet/shared';
import { net, type CrewRoom } from '../net/connection.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const NAME_KEY = 'chronolet.name';

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Экран лобби: имя, создание комнаты, вход по коду, список открытых комнат. */
export function showLobby(onJoined: (room: CrewRoom) => void) {
  const lobby = $('lobby');
  const nameInput = $<HTMLInputElement>('name');
  const crewInput = $<HTMLInputElement>('crew');
  const publicInput = $<HTMLInputElement>('public');
  const codeInput = $<HTMLInputElement>('code');
  const createBtn = $<HTMLButtonElement>('create');
  const joinBtn = $<HTMLButtonElement>('join');
  const roomsList = $<HTMLUListElement>('rooms');
  const errorEl = $('error');

  lobby.hidden = false;
  nameInput.value = storage()?.getItem(NAME_KEY) ?? '';
  (nameInput.value ? codeInput : nameInput).focus();

  // Ссылка-приглашение вида /?room=ABCD
  const invite = new URLSearchParams(location.search).get('room');
  if (invite) codeInput.value = invite.toUpperCase();

  const getName = () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Сначала введи имя';
      nameInput.focus();
      return null;
    }
    storage()?.setItem(NAME_KEY, name);
    return name;
  };

  let busy = false;
  const attempt = async (fn: () => Promise<CrewRoom>) => {
    if (busy) return;
    busy = true;
    createBtn.disabled = joinBtn.disabled = true;
    errorEl.textContent = '';
    try {
      const room = await fn();
      stop();
      lobby.hidden = true;
      history.replaceState(null, '', `?room=${room.roomId}`);
      onJoined(room);
    } catch (e) {
      errorEl.textContent = humanError(e);
    } finally {
      busy = false;
      createBtn.disabled = joinBtn.disabled = false;
    }
  };

  const doCreate = () => {
    const name = getName();
    if (name) attempt(() => net.createRoom({ crewName: crewInput.value.trim() || undefined, isPublic: publicInput.checked }, name));
  };
  const doJoin = (code = codeInput.value) => {
    const name = getName();
    if (!name) return;
    if (code.trim().length !== 4) {
      errorEl.textContent = 'Код комнаты — 4 символа';
      return;
    }
    attempt(() => net.joinByCode(code, { name }));
  };

  createBtn.onclick = doCreate;
  joinBtn.onclick = () => doJoin();
  codeInput.onkeydown = (e) => {
    if (e.key === 'Enter') doJoin();
  };
  crewInput.onkeydown = (e) => {
    if (e.key === 'Enter') doCreate();
  };
  $('refresh').onclick = () => refresh();

  async function refresh() {
    try {
      renderRooms(await net.listRooms());
    } catch {
      roomsList.innerHTML = '<li class="muted">сервер недоступен</li>';
    }
  }

  function renderRooms(rooms: RoomListing[]) {
    roomsList.replaceChildren();
    if (rooms.length === 0) {
      roomsList.innerHTML = '<li class="muted">пока никого — создай свою</li>';
      return;
    }
    for (const r of rooms) {
      const li = document.createElement('li');
      li.className = 'room';
      const info = document.createElement('span');
      info.innerHTML = `<span class="code-tag"></span> <b></b> <span class="muted"></span>`;
      info.querySelector('.code-tag')!.textContent = r.roomId;
      info.querySelector('b')!.textContent = r.metadata?.crewName ?? '';
      info.querySelector('.muted')!.textContent = `${r.clients}/${r.maxClients}`;
      const btn = document.createElement('button');
      btn.textContent = 'Войти';
      btn.disabled = r.locked || r.clients >= r.maxClients;
      btn.onclick = () => doJoin(r.roomId);
      li.append(info, btn);
      roomsList.append(li);
    }
  }

  refresh();
  const timer = setInterval(refresh, 3000);
  const stop = () => clearInterval(timer);
}

function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not found|no rooms found|invalid/i.test(msg)) return 'Комната не найдена';
  if (/locked|full/i.test(msg)) return 'Комната заполнена';
  if (/fetch|network|ECONNREFUSED/i.test(msg)) return 'Нет связи с сервером';
  if (/HTTP 401|HTTP 525|AUTH/i.test(msg)) return 'Не удалось войти — попробуй ещё раз';
  if (/уже занята|occupied/i.test(msg)) return msg;
  return msg;
}
