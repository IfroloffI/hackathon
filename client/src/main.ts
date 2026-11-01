import './style.css';
import { showLobby } from './ui/lobby.ts';
import { showHud } from './ui/hud.ts';
import { Game } from './game/Game.ts';
import { mountShop } from './ui/shop.ts';
import { mountAdminPanel } from './ui/admin.ts';
import { startClientMetrics } from './net/metrics.ts';
import type { CrewRoom } from './net/connection.ts';

const container = document.getElementById('game')!;

function enterRoom(room: CrewRoom) {
  const game = new Game(container, room);
  const shop = mountShop(room, { isNearShop: () => game.isNear('shop') });
  game.onShop = () => shop.toggle();
  const metrics = startClientMetrics(room);
  const admin = mountAdminPanel(room, { onTyping: (typing) => game.setInputEnabled(!typing) });
  let left = false;
  const exit = () => {
    if (left) return;
    left = true;
    hideHud();
    shop.dispose();
    admin.dispose();
    metrics.dispose();
    game.dispose();
    history.replaceState(null, '', location.pathname);
    showLobby(enterRoom);
  };
  const hideHud = showHud(room, {
    onLeave: () => {
      room.leave();
      exit();
    },
    onTyping: (typing) => game.setInputEnabled(!typing),
  });
  // Сервер закрыл комнату или реконнект не удался.
  room.onLeave(() => exit());
}

showLobby(enterRoom);
