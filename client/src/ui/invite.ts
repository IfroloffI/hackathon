import { net } from '../net/connection.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Ссылка, по которой другие ноутбуки попадут в комнату. Если игра открыта как
 * localhost (обычно на самом хосте), подменяем адрес на LAN-IP хоста, порт оставляем
 * текущий — так ссылка верна и для dev (:5173), и для prod (:2567).
 */
export async function inviteLink(roomId: string): Promise<string> {
  const url = new URL(location.href);
  url.search = `?room=${roomId}`;
  url.hash = '';

  if (LOCAL_HOSTS.has(url.hostname)) {
    try {
      const addrs = await net.hostAddresses();
      if (addrs && addrs.length > 0) {
        url.hostname = addrs[0];
      }
    } catch {
      // сервер не ответил — оставляем ссылку с localhost,
      // другой игрок должен вручную скопировать адрес из чата
    }
  }

  return url.toString();
}

/** navigator.clipboard есть только в secure context (https/localhost), а в LAN это http://IP — нужен запасной путь. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // падаем в запасной вариант
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
