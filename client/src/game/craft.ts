import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * «Рукодельный» стиль мира (направление A: картон + фетр + вязка, края скруглены).
 * Процедурные текстуры нейтрально-серые — цвет даёт material.color, поэтому одна текстура
 * обслуживает любые палитры. Материалы кэшируются и помечены userData.shared: disposeTree их не трогает.
 */

export type CraftKind =
  /** Гофрокартон — основа платформ, стены, ящики. */
  | 'card'
  /** Фетр — «покрывало» платформ, листва, облака, мягкие детали. */
  | 'felt'
  /** Вязка — персонажи, канаты, обмотка труб. */
  | 'knit'
  /** Дерево — доски, стволы, древки. */
  | 'wood'
  /** Металл — пружины, заклёпки, корпуса машин. */
  | 'metal'
  /** Гладкая крашеная деталь (пуговицы, носы, кнопки). */
  | 'plain';

let seed = 7;
/** Детерминированный псевдослучайный генератор — одинаковый мир у всех игроков. */
export const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void, repeat = 1, color = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function speckle(c: CanvasRenderingContext2D, s: number, n: number, alpha: number, size = 1.5) {
  for (let i = 0; i < n; i++) {
    const v = 200 + rnd() * 55;
    c.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    c.fillRect(rnd() * s, rnd() * s, size, size);
  }
}

let textures: Record<'card' | 'felt' | 'knit' | 'wood', THREE.CanvasTexture> | null = null;
function tex() {
  if (textures) return textures;
  textures = {
    card: canvasTex(512, (c, s) => {
      c.fillStyle = '#e9e2d6';
      c.fillRect(0, 0, s, s);
      // Рёбра гофры.
      for (let x = 0; x < s; x += 10) {
        c.fillStyle = 'rgba(120,90,60,0.10)';
        c.fillRect(x, 0, 4, s);
      }
      speckle(c, s, 9000, 0.25);
      for (let i = 0; i < 400; i++) {
        c.fillStyle = 'rgba(90,60,30,0.12)';
        c.fillRect(rnd() * s, rnd() * s, 2, 2);
      }
    }, 2),
    felt: canvasTex(256, (c, s) => {
      c.fillStyle = '#d6d6d6';
      c.fillRect(0, 0, s, s);
      // Ворсинки в случайных направлениях.
      for (let i = 0; i < 5000; i++) {
        const v = 150 + rnd() * 105;
        c.strokeStyle = `rgba(${v},${v},${v},0.5)`;
        const x = rnd() * s;
        const y = rnd() * s;
        const a = rnd() * 6.28;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4);
        c.stroke();
      }
    }, 3),
    knit: canvasTex(256, (c, s) => {
      c.fillStyle = '#d8d8d8';
      c.fillRect(0, 0, s, s);
      // Петли «ёлочкой».
      for (let y = 0; y < s; y += 14) {
        for (let x = 0; x < s; x += 16) {
          for (const sx of [-1, 1]) {
            c.fillStyle = 'rgba(255,255,255,0.95)';
            c.beginPath();
            c.ellipse(x + 8 + sx * 3.5, y + 7, 3.6, 7.5, sx * 0.55, 0, Math.PI * 2);
            c.fill();
          }
        }
      }
      speckle(c, s, 2500, 0.3);
    }, 4),
    wood: canvasTex(256, (c, s) => {
      c.fillStyle = '#e8e0d4';
      c.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 3) {
        c.strokeStyle = `rgba(110,70,40,${0.06 + rnd() * 0.12})`;
        c.beginPath();
        c.moveTo(0, y);
        for (let x = 0; x < s; x += 16) c.lineTo(x, y + Math.sin(x * 0.05 + y) * 2);
        c.stroke();
      }
      for (let y = 0; y < s; y += 64) {
        c.fillStyle = 'rgba(60,35,15,0.35)';
        c.fillRect(0, y, s, 2);
      }
    }),
  };
  return textures;
}

const cache = new Map<string, THREE.Material>();

/** Общий (кэшированный) материал стиля. Не диспозить вручную. */
export function craft(kind: CraftKind, color: number, extra: THREE.MeshPhysicalMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = `${kind}:${color}:${JSON.stringify(extra)}`;
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;
  const t = tex();
  let m: THREE.MeshStandardMaterial;
  if (kind === 'felt' || kind === 'knit') {
    const map = t[kind];
    m = new THREE.MeshPhysicalMaterial({
      color,
      map,
      bumpMap: map,
      bumpScale: kind === 'knit' ? 2.2 : 0.8,
      roughness: 0.92,
      // Мягкий ворсистый отблеск по краю — «ткань», а не пластик.
      sheen: 0.7,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35),
      ...extra,
    });
  } else if (kind === 'metal') {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55, ...extra });
  } else if (kind === 'plain') {
    m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.6, ...extra });
  } else {
    const map = t[kind];
    m = new THREE.MeshStandardMaterial({ color, map, bumpMap: map, bumpScale: 0.8, roughness: 0.9, ...extra });
  }
  m.userData.shared = true;
  cache.set(key, m);
  return m;
}

/** Светящийся (эмиссивный) общий материал: окна, лампочки, ядро двигателя. */
export function glowing(color: number, intensity = 1.5): THREE.MeshStandardMaterial {
  return craft('plain', color, { emissive: color, emissiveIntensity: intensity, clearcoat: 0 });
}

/** Скруглённый «мягкий» брусок — замена BoxGeometry во всём мире. */
export function soft(w: number, h: number, d: number, r = 0.14, segments = 3): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, segments, Math.max(0.005, Math.min(r, w / 2 - 0.005, h / 2 - 0.005, d / 2 - 0.005)));
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

const stitchGeo = new THREE.CapsuleGeometry(0.025, 0.12, 2, 6);
stitchGeo.rotateZ(Math.PI / 2);
stitchGeo.userData.shared = true;

/** Пунктир белых стежков вдоль оси x длиной len — фирменный шов стиля (один InstancedMesh). */
export function stitchLine(len: number, color = 0xfff4dc, step = 0.28): THREE.InstancedMesh {
  const n = Math.max(1, Math.floor(len / step));
  const im = new THREE.InstancedMesh(stitchGeo, craft('plain', color, { roughness: 0.8, clearcoat: 0 }), n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) im.setMatrixAt(i, m.makeTranslation(-len / 2 + step / 2 + i * step, 0, 0));
  return im;
}

/** Кольцо стежков радиуса r в плоскости XZ. */
export function stitchRing(r: number, count = 24, color = 0xfff4dc): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(stitchGeo, craft('plain', color, { roughness: 0.8, clearcoat: 0 }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    q.setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, 0));
    m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(0.8, 1, 1));
    im.setMatrixAt(i, m);
  }
  return im;
}

/**
 * Платформа в стиле: картонная основа + фетровое «покрывало» со скруглёнными краями + шов по фронту.
 * Габарит (w×h×d) точно совпадает с коллизией; покрывало выступает на пару сантиметров.
 */
export function craftSlab(w: number, h: number, d: number, base: number, top: number): THREE.Group {
  const g = new THREE.Group();
  const capH = Math.min(0.24, h * 0.5);
  g.add(mesh(soft(w, h - capH * 0.5, d, 0.12), craft('card', base), 0, -capH * 0.25));
  g.add(mesh(soft(w + 0.08, capH, d + 0.08, Math.min(0.12, capH / 2 - 0.01), 4), craft('felt', top), 0, h / 2 - capH / 2));
  if (w > 0.8) {
    const st = stitchLine(w - 0.3);
    st.position.set(0, h / 2 - capH * 0.55, d / 2 + 0.05);
    g.add(st);
  }
  return g;
}

/** Нашивка-табличка: фетровый шеврон со строчкой по краю. Цвет фона — color, текст светлый/тёмный по контрасту. */
export function badgeTexture(text: string, color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 256;
  const c = cv.getContext('2d')!;
  c.font = 'bold 132px Trebuchet MS, sans-serif';
  const w = Math.min(1000, c.measureText(text).width + 150);
  const x0 = (1024 - w) / 2;
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath();
  c.roundRect(x0 + 6, 22, w - 6, 222, 110);
  c.fill();
  c.fillStyle = color;
  c.beginPath();
  c.roundRect(x0, 12, w - 6, 222, 110);
  c.fill();
  c.setLineDash([26, 18]);
  c.lineWidth = 8;
  c.strokeStyle = 'rgba(255,248,230,.9)';
  c.beginPath();
  c.roundRect(x0 + 30, 40, w - 66, 166, 84);
  c.stroke();
  c.fillStyle = luminance(color) > 0.6 ? '#3a2a1a' : '#fff4dc';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 512, 128, w - 120);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function luminance(hex: string) {
  const c = new THREE.Color(hex);
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

/** Вертикальный градиент неба (низ → верх) с лёгким «бумажным» зерном. */
export function skyTexture(bottom: string, top: string): THREE.CanvasTexture {
  return canvasTex(512, (c, s) => {
    const g = c.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, top);
    g.addColorStop(0.75, bottom);
    g.addColorStop(1, bottom);
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    speckle(c, s, 6000, 0.05, 2);
  });
}

/** Полосатая лента (опасность, разметка). */
export function stripeTexture(a: string, b: string): THREE.CanvasTexture {
  return canvasTex(256, (c, s) => {
    c.fillStyle = a;
    c.fillRect(0, 0, s, s);
    c.fillStyle = b;
    for (let i = -s; i < s * 2; i += 64) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i + 32, 0);
      c.lineTo(i + 32 + s, s);
      c.lineTo(i + s, s);
      c.fill();
    }
  });
}

/** Силуэт-«кулиса» фона: фетровая/картонная вырезка с мягкой фаской. */
export function cutout(shape: THREE.Shape, color: number, z: number, depth = 0.4, kind: CraftKind = 'felt'): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, curveSegments: 24, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  const m = mesh(geo, craft(kind, color), 0, 0, z);
  m.castShadow = z > -12;
  return m;
}

/** Гряда холмов по всей ширине уровня. */
export function hillsShape(y0: number, amp: number, freq: number, phase: number, half = 70): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-half, -8);
  for (let x = -half; x <= half; x += 2) s.lineTo(x, y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.3 + phase * 2) * amp * 0.4);
  s.lineTo(half, -8);
  return s;
}

export function polyShape(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(...pts[0]);
  pts.slice(1).forEach((p) => s.lineTo(...p));
  return s;
}

export function circleShape(r: number, cx = 0, cy = 0): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r, 0, Math.PI * 2, false);
  return s;
}

export function roundRectShape(x: number, y: number, w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
