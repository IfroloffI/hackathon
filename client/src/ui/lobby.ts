import { colorForName, type AuthPlayer, type RoomListing } from '@chronolet/shared';
import { AuthError, auth, net, type CrewRoom } from '../net/connection.ts';
import { renderLeaderboard } from './leaderboard.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Экран лобби: вход по логину и паролю (или регистрация), затем — создание комнаты,
 * вход по коду, список открытых комнат и рейтинг. Без входа комнаты недоступны.
 */
export function showLobby(onJoined: (room: CrewRoom) => void) {
  const lobby = $('lobby');
  const authBox = $<HTMLFormElement>('auth-box');
  const accountBox = $('account-box');
  const loginName = $<HTMLInputElement>('login-name');
  const loginPass = $<HTMLInputElement>('login-pass');
  const loginBtn = $<HTMLButtonElement>('login-btn');
  const registerBtn = $<HTMLButtonElement>('register-btn');
  const crewInput = $<HTMLInputElement>('crew');
  const publicInput = $<HTMLInputElement>('public');
  const codeInput = $<HTMLInputElement>('code');
  const createBtn = $<HTMLButtonElement>('create');
  const joinBtn = $<HTMLButtonElement>('join');
  const roomsList = $<HTMLUListElement>('rooms');
  const errorEl = $('error');

  lobby.hidden = false;

  // Ссылка-приглашение вида /?room=ABCD
  const invite = new URLSearchParams(location.search).get('room');
  if (invite) codeInput.value = invite.toUpperCase();

  /** Показать форму входа или карточку аккаунта; комнаты — только после входа. */
  function renderAuth(player: AuthPlayer | null) {
    authBox.hidden = !!player;
    accountBox.hidden = !player;
    document.querySelectorAll('.needs-auth').forEach((el) => el.classList.toggle('locked', !player));
    if (player) {
      const av = $('acc-avatar');
      av.textContent = player.name.slice(0, 1).toUpperCase();
      av.style.background = `#${colorForName(player.name).toString(16).padStart(6, '0')}`;
      $('acc-name').textContent = player.name;
      (invite ? joinBtn : crewInput).focus();
    } else {
      loginPass.value = '';
      (loginName.value ? loginPass : loginName).focus();
    }
  }

  renderAuth(auth.current());
  // Сохранённый токен мог протухнуть (сменили JWT_SECRET и т. п.) — сверяемся с сервером.
  void auth.validate().then((p) => renderAuth(p));

  let authBusy = false;
  async function doAuth(mode: 'login' | 'register') {
    if (authBusy) return;
    const name = loginName.value.trim();
    const password = loginPass.value;
    if (!name || !password) {
      errorEl.textContent = 'Введите логин и пароль';
      return;
    }
    authBusy = true;
    loginBtn.disabled = registerBtn.disabled = true;
    errorEl.textContent = '';
    try {
      renderAuth(await (mode === 'login' ? auth.login(name, password) : auth.register(name, password)));
    } catch (e) {
      errorEl.textContent = e instanceof AuthError ? e.message : 'Нет связи с сервером';
    } finally {
      authBusy = false;
      loginBtn.disabled = registerBtn.disabled = false;
    }
  }
  authBox.onsubmit = (e) => {
    e.preventDefault();
    void doAuth('login');
  };
  registerBtn.onclick = () => void doAuth('register');
  $('logout-btn').onclick = async () => {
    await auth.logout();
    renderAuth(null);
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
      if (e instanceof AuthError) renderAuth(null);
      errorEl.textContent = humanError(e);
    } finally {
      busy = false;
      createBtn.disabled = joinBtn.disabled = false;
    }
  };

  const doCreate = () => attempt(() => net.createRoom({ crewName: crewInput.value.trim() || undefined, isPublic: publicInput.checked }));
  const doJoin = (code = codeInput.value) => {
    if (code.trim().length !== 4) {
      errorEl.textContent = 'Код комнаты — 4 символа';
      return;
    }
    void attempt(() => net.joinByCode(code));
  };

  createBtn.onclick = () => void doCreate();
  joinBtn.onclick = () => doJoin();
  codeInput.onkeydown = (e) => {
    if (e.key === 'Enter') doJoin();
  };
  crewInput.onkeydown = (e) => {
    if (e.key === 'Enter') void doCreate();
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
  void renderLeaderboard($('leaderboard'));
  const timer = setInterval(refresh, 3000);
  const stop = () => clearInterval(timer);
}

function humanError(e: unknown): string {
  if (e instanceof AuthError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/not found|no rooms found|invalid/i.test(msg)) return 'Комната не найдена';
  if (/locked|full/i.test(msg)) return 'Комната заполнена';
  if (/fetch|network|ECONNREFUSED/i.test(msg)) return 'Нет связи с сервером';
  if (/уже в этой комнате|уже занята|occupied/i.test(msg)) return msg;
  return msg;
}
