import { COIN_NAME, ClientMsg, SKINS, ServerMsg, type HeadKind, type ShopResult } from '@chronolet/shared';

const HEAD_ICON: Record<HeadKind, string> = { helmet: '🧑‍🚀', dog: '🐶', cat: '🐱', eyes: '👀', spark: '✨', bear: '🐻', robot: '🤖', heart: '❤️' };
import { net, type CrewRoom } from '../net/connection.ts';

/**
 * Магазин скинов на борту (E у синего терминала). Баланс и покупки — на сервере;
 * панель лишь показывает каталог и шлёт shop.buy / shop.equip.
 */
export function mountShop(room: CrewRoom, opts: { isNearShop: () => boolean }) {
  const panel = document.getElementById('shop')!;
  const list = document.getElementById('shop-list')!;
  const balance = document.getElementById('shop-balance')!;
  const status = document.getElementById('shop-status')!;
  let open = false;

  const me = () => room.state.players.get(room.sessionId);

  function render() {
    const p = me();
    if (!open || !p) return;
    balance.textContent = String(p.coins);
    list.replaceChildren();
    for (const s of SKINS) {
      const owned = s.id === 'default' || p.owned.includes(s.id);
      const worn = (p.skin || 'default') === s.id;
      const li = document.createElement('li');
      li.className = worn ? 'worn' : '';
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = `#${(s.body ?? p.color).toString(16).padStart(6, '0')}`;
      sw.style.borderColor = `#${(s.accent ?? p.color).toString(16).padStart(6, '0')}`;
      sw.textContent = HEAD_ICON[s.head];
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.name;
      const desc = Object.assign(document.createElement('span'), { className: 'desc', textContent: s.description });
      const btn = document.createElement('button');
      if (worn) {
        btn.textContent = 'Надет';
        btn.disabled = true;
      } else if (owned) {
        btn.textContent = 'Надеть';
        btn.className = 'ghost';
        btn.onclick = () => room.send(ClientMsg.ShopEquip, { skinId: s.id });
      } else {
        btn.innerHTML = `<span class="vk-coin">VK</span> ${s.price}`;
        btn.disabled = p.coins < s.price;
        btn.onclick = () => room.send(ClientMsg.ShopBuy, { skinId: s.id });
      }
      li.append(sw, name, desc);
      if (s.approx) li.append(Object.assign(document.createElement('span'), { className: 'approx', textContent: 'черновой облик' }));
      li.append(btn);
      list.append(li);
    }
  }

  const show = () => {
    open = true;
    status.textContent = '';
    panel.hidden = false;
    render();
  };
  const hide = () => {
    open = false;
    panel.hidden = true;
  };

  const onKey = (e: KeyboardEvent) => {
    if (open && e.key === 'Escape') hide();
  };
  addEventListener('keydown', onKey);
  document.getElementById('shop-close')!.onclick = hide;
  // Отошёл от терминала — панель закрывается.
  const timer = setInterval(() => open && !opts.isNearShop() && hide(), 300);

  const $ = net.callbacks(room);
  const unbind: (() => void)[] = [];
  const p = me();
  if (p) unbind.push($.onChange(p, render));
  unbind.push(
    room.onMessage(ServerMsg.Shop, (r: ShopResult) => {
      status.textContent = r.text;
      status.className = r.ok ? 'ok' : 'bad';
    }),
  );

  return {
    toggle: () => (open ? hide() : show()),
    dispose() {
      hide();
      clearInterval(timer);
      removeEventListener('keydown', onKey);
      unbind.forEach((u) => u());
    },
  };
}

export { COIN_NAME };
