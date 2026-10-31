import { getSkin, levelFromXp } from '@chronolet/shared';
import { SERVER_URL } from '../net/connection.ts';

interface Row {
  name: string;
  xp: number;
  likes: number;
  skin: string;
  achievements: number;
}

/** Рейтинг хронавтов по XP (GET /api/leaderboard) — в лобби и в игре. */
export async function renderLeaderboard(list: HTMLElement) {
  try {
    const rows = (await (await fetch(`${SERVER_URL}/api/leaderboard`)).json()) as Row[];
    list.replaceChildren();
    if (!rows.length) {
      list.innerHTML = '<li class="muted">пока пусто — сыграйте первыми</li>';
      return;
    }
    rows.slice(0, 10).forEach((r, i) => {
      const li = document.createElement('li');
      const place = Object.assign(document.createElement('span'), { className: 'place', textContent: i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1) });
      const who = Object.assign(document.createElement('span'), { className: 'who', textContent: r.name });
      who.title = `скин: ${getSkin(r.skin).name} · ❤ ${r.likes} · 🏅 ${r.achievements}`;
      const lv = Object.assign(document.createElement('span'), { className: 'muted', textContent: `ур. ${levelFromXp(r.xp).level}` });
      const xp = Object.assign(document.createElement('span'), { className: 'xp-num', textContent: `${r.xp} XP` });
      li.append(place, who, lv, xp);
      list.append(li);
    });
  } catch {
    list.innerHTML = '<li class="muted">рейтинг недоступен</li>';
  }
}
