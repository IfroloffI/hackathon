import type {
  EnigmaMechanicView,
  EnigmaObserverView,
  EratMechanicView,
  EratObserverView,
  GalileoMechanicView,
  GalileoObserverView,
  KorolevMechanicView,
  KorolevObserverView,
  NewtonMechanicView,
  NewtonObserverView,
  PuzzleId,
  Role,
  VenusPhase,
} from '@chronolet/shared';

export type Act = (action: string, value?: unknown) => void;
type Renderer = (el: HTMLElement, view: never, act: Act) => void;

const PHASE_NAME: Record<VenusPhase, string> = {
  new: 'не видна (рядом с Солнцем)',
  crescent: 'тонкий серп',
  half: 'половина диска',
  gibbous: 'почти полный диск',
  full: 'полный диск',
};

const fmt = (n: number, d = 1) => n.toLocaleString('ru-RU', { maximumFractionDigits: d });

/** Привязка кнопок/полей по data-атрибутам: data-act, data-value (JSON), для range/number — change. */
function bind(el: HTMLElement, act: Act) {
  el.querySelectorAll<HTMLElement>('[data-act]').forEach((node) => {
    const action = node.dataset.act!;
    if (node instanceof HTMLInputElement) {
      node.addEventListener('change', () => act(action, Number(node.value)));
    } else {
      node.addEventListener('click', () => act(action, node.dataset.value ? JSON.parse(node.dataset.value) : undefined));
    }
  });
}

/** Подпись к ползунку обновляется сразу, на сервер уходит только отпускание (change). */
function liveLabel(el: HTMLElement, inputSel: string, labelSel: string, fmtFn: (v: number) => string, onInput?: (v: number) => void) {
  const input = el.querySelector<HTMLInputElement>(inputSel)!;
  const label = el.querySelector<HTMLElement>(labelSel)!;
  input.addEventListener('input', () => {
    label.textContent = fmtFn(Number(input.value));
    onInput?.(Number(input.value));
  });
}

// ───────────────────────── Эратосфен

function eratObserver(el: HTMLElement, v: EratObserverView, act: Act) {
  el.innerHTML = `
    <p>☀️ Ты в <b>Сиене</b>. Полдень: солнце прямо над колодцем, его дно освещено — <b>тени нет</b>.</p>
    <svg viewBox="0 0 220 120" class="pz-svg">
      <circle cx="110" cy="16" r="12" fill="#ffd34d"/>
      <line x1="110" y1="30" x2="110" y2="104" stroke="#ffd34d" stroke-width="3" stroke-dasharray="6 4"/>
      <rect x="85" y="80" width="50" height="30" fill="#9b8466"/><rect x="92" y="80" width="36" height="26" fill="#fff3b0"/>
      <line x1="0" y1="110" x2="220" y2="110" stroke="#c9a46c" stroke-width="3"/>
    </svg>
    <p>Расстояние до Александрии: <b>${fmt(v.distance, 0)} стадий</b>.</p>
    ${
      v.stage === 'measure'
        ? '<p class="muted">Механик в Александрии измеряет угол тени гномона. Узнай у него угол.</p>'
        : v.stage === 'compute'
          ? `<p>Механик зафиксировал угол. Посчитай окружность Земли:</p>
             <div class="pz-row"><input id="erat-ans" type="number" min="0" placeholder="стадий"/><button id="erat-send">Сообщить Эратосфену</button></div>`
          : '<p class="ok">Окружность Земли измерена!</p>'
    }`;
  el.querySelector('#erat-send')?.addEventListener('click', () => {
    const val = Number(el.querySelector<HTMLInputElement>('#erat-ans')!.value);
    if (val > 0) act('answer', val);
  });
}

function eratMechanic(el: HTMLElement, v: EratMechanicView, act: Act) {
  // Углы на рисунке увеличены втрое — 7,2° на экране почти не видно. Пропорция для совмещения та же.
  const draw = (arc: number) => {
    const top = { x: 70, y: 30 };
    const k = 3;
    const ray = ((v.shadow * k) * Math.PI) / 180;
    const a = ((arc * k) * Math.PI) / 180;
    const L = 120;
    // Луч идёт через верх гномона в кончик тени на земле (высота гномона 100).
    const tipX = top.x + Math.tan(ray) * 100;
    return `
      <line x1="0" y1="130" x2="240" y2="130" stroke="#c9a46c" stroke-width="3"/>
      <rect x="66" y="30" width="8" height="100" fill="#e8d8b0" stroke="#7a5a2a"/>
      <line x1="${top.x - Math.sin(ray) * 40}" y1="${top.y - Math.cos(ray) * 40}" x2="${tipX}" y2="130" stroke="#ffd34d" stroke-width="2"/>
      <line x1="74" y1="128" x2="${tipX + 4}" y2="128" stroke="#3b2a1a" stroke-width="6" opacity=".55"/>
      <line x1="${top.x}" y1="${top.y}" x2="${top.x + Math.sin(a) * L}" y2="${top.y + Math.cos(a) * L}" stroke="#d26a3a" stroke-width="2.5" stroke-dasharray="5 3"/>
      <text x="150" y="24" font-size="11" fill="#7a5a2a">☀ луч</text><text x="150" y="40" font-size="11" fill="#d26a3a">— — дуга</text>`;
  };
  el.innerHTML = `
    <p>🏛 Ты в <b>Александрии</b> у гномона. Совмести дугу (пунктир) с солнечным лучом, который даёт тень.</p>
    <svg viewBox="0 0 240 140" class="pz-svg" id="erat-svg">${draw(v.arc)}</svg>
    ${
      v.locked
        ? `<p class="ok">Угол зафиксирован: <b>${fmt(v.shadow)}°</b>. Сообщи его Наблюдателю.</p>`
        : `<div class="pz-row"><input type="range" min="0" max="20" step="0.1" value="${v.arc}" data-act="arc" id="erat-arc"/><b id="erat-arc-l">${fmt(v.arc)}°</b></div>
           <button data-act="lock">Зафиксировать угол</button>`
    }`;
  bind(el, act);
  if (!v.locked) {
    liveLabel(el, '#erat-arc', '#erat-arc-l', (x) => `${fmt(x)}°`, (x) => (el.querySelector('#erat-svg')!.innerHTML = draw(x)));
  }
}

// ───────────────────────── Галилей

function venusSvg(lit: number, r = 46) {
  const cx = 70;
  const cy = 60;
  const rx = Math.abs(1 - 2 * lit) * r;
  const sweep = lit < 0.5 ? 0 : 1;
  return `
    <svg viewBox="0 0 220 120" class="pz-svg">
      <circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="#050814" stroke="#3a3f55" stroke-width="4"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1a1f30"/>
      <path d="M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} A ${rx} ${r} 0 0 ${sweep} ${cx} ${cy - r} Z" fill="#fff6c8"/>
      <circle cx="175" cy="60" r="10" fill="#e3c9a0"/>
      ${[-34, -22, 20, 31].map((dx) => `<circle cx="${175 + dx}" cy="60" r="2" fill="#fff"/>`).join('')}
      <text x="150" y="98" font-size="10" fill="#8aa">Юпитер и спутники</text>
    </svg>`;
}

function galileoObserver(el: HTMLElement, v: GalileoObserverView) {
  el.innerHTML = v.solved
    ? '<p class="ok">Все три ночи совпали с моделью. Венера вращается вокруг Солнца!</p>'
    : `<p>🔭 Ночь <b>${v.night + 1} из ${v.nights}</b>. Ты смотришь в телескоп на Венеру.</p>
       ${venusSvg(v.lit)}
       <p>В окуляре: <b>${PHASE_NAME[v.phase]}</b>. Опиши Механику, что видишь, — он должен получить то же на модели.</p>`;
}

function galileoMechanic(el: HTMLElement, v: GalileoMechanicView, act: Act) {
  const S = 70;
  const c = (p: [number, number]) => [120 + p[0] * S, 95 - p[1] * S];
  const draw = (pos: { sun: [number, number]; earth: [number, number]; venus: [number, number] }) => {
    const [sx, sy] = c(pos.sun);
    const [ex, ey] = c(pos.earth);
    const [vx, vy] = c(pos.venus);
    const orbits =
      v.scheme === 'helio'
        ? `<circle cx="${sx}" cy="${sy}" r="${S}" fill="none" stroke="#4d96ff" stroke-dasharray="3 3"/>
           <circle cx="${sx}" cy="${sy}" r="${0.72 * S}" fill="none" stroke="#ddd" stroke-dasharray="3 3"/>`
        : `<circle cx="${ex}" cy="${ey}" r="${S}" fill="none" stroke="#ffd34d" stroke-dasharray="3 3"/>
           <circle cx="${120 + 0.6 * S}" cy="95" r="${0.25 * S}" fill="none" stroke="#ddd" stroke-dasharray="3 3"/>`;
    return `${orbits}
      <line x1="${ex}" y1="${ey}" x2="${vx}" y2="${vy}" stroke="#8aa" stroke-dasharray="2 3"/>
      <circle cx="${sx}" cy="${sy}" r="11" fill="#ffd34d"/><circle cx="${ex}" cy="${ey}" r="7" fill="#4d96ff"/>
      <circle cx="${vx}" cy="${vy}" r="5" fill="#fff6c8" stroke="#555"/>`;
  };
  el.innerHTML = v.solved
    ? '<p class="ok">Модель подтверждена наблюдениями!</p>'
    : `<p>⚙️ Мастерская. Ночь <b>${v.night + 1} из ${v.nights}</b>. Ты не видишь неба — настрой модель по описанию Наблюдателя.</p>
       <div class="pz-row">
         <button class="${v.scheme === 'geo' ? 'on' : 'ghost'}" data-scheme="geo">Земля в центре</button>
         <button class="${v.scheme === 'helio' ? 'on' : 'ghost'}" data-scheme="helio">Солнце в центре</button>
       </div>
       <svg viewBox="0 0 240 190" class="pz-svg pz-dark">${draw(v)}</svg>
       <div class="pz-row">Венера: <input type="range" min="0" max="359" step="1" value="${v.angle}" data-act="angle" id="gal-a"/><b id="gal-a-l">${v.angle}°</b></div>
       <button data-act="observe">Наблюдать ночь ${v.night + 1}</button>`;
  el.querySelectorAll<HTMLElement>('[data-scheme]').forEach((b) => b.addEventListener('click', () => act('scheme', b.dataset.scheme)));
  bind(el, act);
  if (!v.solved) liveLabel(el, '#gal-a', '#gal-a-l', (x) => `${x}°`);
}

// ───────────────────────── Ньютон

function newtonObserver(el: HTMLElement, v: NewtonObserverView) {
  const sx = 280 / 70;
  const sy = 3;
  const last = v.shots.at(-1);
  el.innerHTML = `
    <p>🎯 Ты у поля мишеней. Мишень на <b>${fmt(v.target)} м</b> от пушки (допуск ±${v.tolerance} м).</p>
    <svg viewBox="0 0 300 130" class="pz-svg">
      <line x1="10" y1="118" x2="295" y2="118" stroke="#5d8743" stroke-width="3"/>
      <rect x="${10 + (v.target - v.tolerance) * sx}" y="104" width="${2 * v.tolerance * sx}" height="14" fill="#c0392b" opacity=".35"/>
      <line x1="${10 + v.target * sx}" y1="96" x2="${10 + v.target * sx}" y2="118" stroke="#c0392b" stroke-width="3"/>
      <rect x="4" y="110" width="12" height="8" fill="#333"/>
      ${v.shots
        .map(
          (s, i) =>
            `<polyline fill="none" stroke="${i === v.shots.length - 1 ? '#d26a3a' : '#bbb'}" stroke-width="2" points="${s.points
              .map(([x, y]) => `${10 + x * sx},${118 - y * sy}`)
              .join(' ')}"/>`,
        )
        .join('')}
    </svg>
    ${
      v.solved
        ? '<p class="ok">Попадание!</p>'
        : last
          ? `<p>Последнее ядро упало на <b>${fmt(last.landing)} м</b> — ${last.landing > v.target ? '<b>перелёт</b>' : '<b>недолёт</b>'} на ${fmt(Math.abs(last.landing - v.target))} м. Скажи Механику!</p>`
          : '<p class="muted">Жди первого выстрела и подсказывай Механику: дальше или ближе.</p>'
    }`;
}

function newtonMechanic(el: HTMLElement, v: NewtonMechanicView, act: Act) {
  const barrel = (a: number) => {
    const r = (a * Math.PI) / 180;
    return `<line x1="40" y1="90" x2="${40 + Math.cos(r) * 50}" y2="${90 - Math.sin(r) * 50}" stroke="#333" stroke-width="10" stroke-linecap="round"/>
            <circle cx="40" cy="96" r="14" fill="none" stroke="#5a3a1a" stroke-width="4"/>`;
  };
  el.innerHTML = `
    <p>💣 Ты у пушки на холме. Полёта ядра <b>не видно</b> — Наблюдатель скажет, куда оно упало.</p>
    <svg viewBox="0 0 200 110" class="pz-svg" id="nw-svg">${barrel(v.angle)}</svg>
    <div class="pz-row">Скорость: <input type="range" min="${v.speedRange[0]}" max="${v.speedRange[1]}" step="0.1" value="${v.speed}" data-act="speed" id="nw-s"/><b id="nw-s-l">${fmt(v.speed)} м/с</b></div>
    <div class="pz-row">Угол: <input type="range" min="${v.angleRange[0]}" max="${v.angleRange[1]}" step="1" value="${v.angle}" data-act="angle" id="nw-a"/><b id="nw-a-l">${v.angle}°</b></div>
    ${v.solved ? '<p class="ok">Попадание!</p>' : `<button data-act="fire">Огонь!</button> <span class="muted">выстрелов: ${v.shotsFired}</span>`}`;
  bind(el, act);
  liveLabel(el, '#nw-s', '#nw-s-l', (x) => `${fmt(x)} м/с`);
  liveLabel(el, '#nw-a', '#nw-a-l', (x) => `${x}°`, (x) => (el.querySelector('#nw-svg')!.innerHTML = barrel(x)));
}

// ───────────────────────── Тьюринг

let cribOffset = 0;

function enigmaObserver(el: HTMLElement, v: EnigmaObserverView, act: Act) {
  const max = v.cipher.length - v.crib.length;
  cribOffset = Math.min(cribOffset, max);
  const pos = v.cribPos ?? cribOffset;
  const cells = (row: string, cls: (i: number) => string) =>
    [...row].map((ch, i) => `<span class="${cls(i)}">${ch}</span>`).join('');
  const cribRow = ' '.repeat(pos) + v.crib + ' '.repeat(Math.max(0, v.cipher.length - pos - v.crib.length));
  const clash = (i: number) => i >= pos && i < pos + v.crib.length && v.cipher[i] === v.crib[i - pos];

  let body: string;
  if (v.stage === 'crib') {
    const clashes = [...v.cipher].filter((_, i) => clash(i)).length;
    body = `
      <p>📻 Перехват. Утренняя сводка всегда содержит <b>${v.crib}</b>. Буква в Энигме никогда не шифруется сама в себя — красные совпадения означают «здесь не может быть».</p>
      <div class="pz-mono"><div>${cells(v.cipher, (i) => (clash(i) ? 'bad' : ''))}</div><div>${cells(cribRow, (i) => (clash(i) ? 'bad' : i >= pos && i < pos + v.crib.length ? 'crib' : ''))}</div></div>
      <div class="pz-row"><button class="ghost" id="en-l">◀</button><span>позиция <b>${pos + 1}</b> · совпадений: <b class="${clashes ? 'bad' : 'ok'}">${clashes}</b></span><button class="ghost" id="en-r">▶</button></div>
      <button id="en-here">${v.crib} здесь!</button>`;
  } else {
    const pairs = [...v.crib]
      .map((ch, t) => {
        const i = pos + t;
        return `<tr><td>${i + 1}</td><td>ротор ${(i % 3) + 1}</td><td><b>${ch}</b> → <b>${v.cipher[i]}</b></td></tr>`;
      })
      .join('');
    body = `
      <div class="pz-mono"><div>${cells(v.cipher, (i) => (i >= pos && i < pos + v.crib.length ? 'crib' : ''))}</div><div>${cells(cribRow, () => 'crib')}</div></div>
      ${
        v.stage === 'solved'
          ? `<p class="ok">Расшифровано: <b>${v.plaintext}</b></p>`
          : `<p>Позиция найдена! Продиктуй Механику пары «открытая буква → шифр»:</p><table class="pz-table">${pairs}</table>`
      }`;
  }
  el.innerHTML = body;
  el.querySelector('#en-l')?.addEventListener('click', () => {
    cribOffset = Math.max(0, cribOffset - 1);
    enigmaObserver(el, v, act);
  });
  el.querySelector('#en-r')?.addEventListener('click', () => {
    cribOffset = Math.min(max, cribOffset + 1);
    enigmaObserver(el, v, act);
  });
  el.querySelector('#en-here')?.addEventListener('click', () => act('crib', cribOffset));
}

function enigmaMechanic(el: HTMLElement, v: EnigmaMechanicView, act: Act) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  el.innerHTML = `
    <p>⚙️ «Бомба». Ротор 1 шифрует позиции 1, 4, 7…, ротор 2 — 2, 5, 8…, ротор 3 — 3, 6, 9…</p>
    ${v.rotors
      .map(
        (r, i) => `
      <div class="pz-rotor">
        <div class="pz-row"><b>Ротор ${i + 1}</b>
          <button class="ghost" data-rotor="${i}" data-d="-1">−</button><span class="pz-big">${r}</span><button class="ghost" data-rotor="${i}" data-d="1">+</button></div>
        <div class="pz-mono small"><div>${abc}</div><div class="crib">${v.tables[i]}</div></div>
      </div>`,
      )
      .join('')}
    ${
      v.stage === 'crib'
        ? '<p class="muted">Сначала Наблюдатель ищет позицию WETTERBERICHT в перехвате.</p>'
        : v.stage === 'rotors'
          ? '<button data-act="check">Проверить расшифровку</button>'
          : '<p class="ok">Сообщение прочитано!</p>'
    }`;
  el.querySelectorAll<HTMLElement>('[data-rotor]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.rotor);
      const next = ((v.rotors[i] - 1 + Number(b.dataset.d) + 25) % 25) + 1;
      act('rotor', { index: i, value: next });
    }),
  );
  bind(el, act);
}

// ───────────────────────── Королёв

function korolevObserver(el: HTMLElement, v: KorolevObserverView) {
  const last = v.launches.at(-1);
  const bar = (val: number) => Math.min(100, (val / (v.required * 1.2)) * 100);
  el.innerHTML = `
    <p>📡 Бункер. Нужна первая космическая: <b>${v.required} км/с</b>.</p>
    <p class="pz-formula">Δv = v<sub>e</sub> · ln(m<sub>0</sub> / m<sub>1</sub>)</p>
    <p>Двигатели: A — v<sub>e</sub> ${v.engines.A.ve} км/с, B — ${v.engines.B.ve} км/с.<br/>
       Ракета сейчас: масса <b>${fmt(v.mass)} т</b> (стол держит ${v.massLimit} т), топливо <b>${fmt(v.fuel)} т</b>.</p>
    ${
      last
        ? `<div class="pz-telemetry">
             <div class="pz-bar"><span style="width:${bar(last.total)}%" class="${last.ok ? 'ok' : 'bad'}"></span><i style="left:${bar(v.required)}%"></i></div>
             <p>Последний пуск: ${last.stages.map((s, i) => `ступень ${i + 1}: <b>${fmt(s.dv, 2)}</b>`).join(', ') || '—'} → <b>${fmt(last.total, 2)} км/с</b></p>
             <p class="${last.ok ? 'ok' : 'bad'}">${last.reason}</p>
           </div>`
        : '<p class="muted">Телеметрия появится после тестового пуска.</p>'
    }
    ${v.launches.length > 1 ? `<p class="muted">Предыдущие: ${v.launches.slice(0, -1).map((l) => `${fmt(l.total, 2)}`).join(' · ')} км/с</p>` : ''}`;
}

function korolevMechanic(el: HTMLElement, v: KorolevMechanicView, act: Act) {
  const over = v.mass > v.massLimit;
  const rocket = () => {
    let y = 150;
    let out = '';
    v.stages.forEach((s, i) => {
      if (!s.tanks) return;
      const h = 8 + s.tanks * 6;
      y -= h;
      out += `<rect x="${70 - (3 - i) * 4}" y="${y}" width="${20 + (3 - i) * 8}" height="${h}" fill="${['#dfe6ee', '#c8d3df', '#b0bfcf'][i]}" stroke="#555"/>
              <text x="125" y="${y + h / 2 + 4}" font-size="10" fill="#555">${i + 1}: ${s.tanks}×бак + ${s.engine}</text>`;
    });
    return `${out}<polygon points="70,${y} 80,${y - 16} 90,${y}" fill="#c0392b"/>`;
  };
  el.innerHTML = `
    <p>🔩 Монтажный цех. Бак: ${v.parts.tank.fuel} т топлива + ${v.parts.tank.dry} т корпус. Двигатель A: ${v.parts.engines.A.mass} т, B: ${v.parts.engines.B.mass} т. Корабль: ${v.parts.payload} т.</p>
    <svg viewBox="0 0 220 160" class="pz-svg">${rocket()}</svg>
    ${v.stages
      .map(
        (s, i) => `
      <div class="pz-row">Ступень ${i + 1}${i === 0 ? ' (нижняя)' : ''}:
        <button class="ghost" data-st="${i}" data-t="-1">−</button><b>${s.tanks}</b> бак.<button class="ghost" data-st="${i}" data-t="1">+</button>
        <button class="${s.engine === 'A' ? 'on' : 'ghost'}" data-st="${i}" data-e="A">A</button><button class="${s.engine === 'B' ? 'on' : 'ghost'}" data-st="${i}" data-e="B">B</button>
      </div>`,
      )
      .join('')}
    <p>Стартовая масса: <b class="${over ? 'bad' : ''}">${fmt(v.mass)} т</b> / ${v.massLimit} т</p>
    ${v.solved ? '<p class="ok">Орбита!</p>' : `<button data-act="launch">Тестовый пуск</button> <span class="muted">пусков: ${v.launches}</span>`}`;
  el.querySelectorAll<HTMLElement>('[data-st]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.st);
      const s = v.stages[i];
      const tanks = b.dataset.t ? Math.min(v.maxTanks, Math.max(0, s.tanks + Number(b.dataset.t))) : s.tanks;
      act('stage', { index: i, tanks, engine: b.dataset.e ?? s.engine });
    }),
  );
  bind(el, act);
}

export const RENDERERS: Record<PuzzleId, Record<Role, Renderer>> = {
  eratosthenes: { observer: eratObserver as Renderer, mechanic: eratMechanic as Renderer },
  galileo: { observer: galileoObserver as Renderer, mechanic: galileoMechanic as Renderer },
  newton: { observer: newtonObserver as Renderer, mechanic: newtonMechanic as Renderer },
  enigma: { observer: enigmaObserver as Renderer, mechanic: enigmaMechanic as Renderer },
  korolev: { observer: korolevObserver as Renderer, mechanic: korolevMechanic as Renderer },
};
