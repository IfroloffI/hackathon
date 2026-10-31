import * as THREE from 'three';
import { VK_BLUE } from '@chronolet/shared';

/**
 * Сфера VK Coin: прозрачный глянцевый пузырь (как «сферы очков» в рукодельных платформерах),
 * внутри — фирменный значок: синий скруглённый квадрат VK с белой надписью «VK».
 */
let badgeTexture: THREE.CanvasTexture | null = null;
let glowTexture: THREE.CanvasTexture | null = null;

/** Мягкое синее свечение — спрайт вместо источника света. */
function glowMap(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,119,255,0.9)');
  g.addColorStop(0.45, 'rgba(0,119,255,0.35)');
  g.addColorStop(1, 'rgba(0,119,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

function badge(): THREE.CanvasTexture {
  if (badgeTexture) return badgeTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0077FF';
  ctx.beginPath();
  ctx.roundRect(8, 8, 112, 112, 34);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 58px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VK', 64, 68);
  badgeTexture = new THREE.CanvasTexture(c);
  badgeTexture.colorSpace = THREE.SRGBColorSpace;
  return badgeTexture;
}

export interface CoinView {
  root: THREE.Group;
  update(t: number): void;
  /** Анимация подбора; вызывает done, когда сфера исчезла. */
  pop(done: () => void): void;
}

export function vkCoin(x: number, y: number, z: number, phase: number): CoinView {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 28, 20),
    new THREE.MeshPhysicalMaterial({
      color: 0x9fd0ff,
      transparent: true,
      opacity: 0.32,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 1,
      emissive: VK_BLUE,
      emissiveIntensity: 0.25,
      depthWrite: false,
    }),
  );
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  shine.position.set(-0.17, 0.2, 0.3);
  // Значок с двух сторон, чтобы при вращении надпись не читалась зеркально.
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshBasicMaterial({ map: badge(), transparent: true }));
  const back = front.clone();
  back.rotation.y = Math.PI;
  const icon = new THREE.Group();
  icon.add(front, back);
  // Ореол — спрайт, а не PointLight: если менять число источников света в сцене, three.js
  // перекомпилирует шейдеры ВСЕХ материалов — именно это давало фриз ~0,5 с при подборе сферы.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowMap(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  halo.scale.setScalar(1.6);
  root.add(halo, bubble, shine, icon);

  let popping: { t0: number; done: () => void } | null = null;
  let now = 0;
  return {
    root,
    update(t) {
      now = t;
      if (popping) {
        const k = Math.min(1, (t - popping.t0) / 0.35);
        root.scale.setScalar(1 + k * 0.8);
        (bubble.material as THREE.MeshPhysicalMaterial).opacity = 0.32 * (1 - k);
        icon.position.y = k * 0.8;
        if (k >= 1) {
          popping.done();
          popping = null;
        }
        return;
      }
      root.position.y = y + Math.sin(t * 2 + phase) * 0.12;
      icon.rotation.y = t * 1.8 + phase;
    },
    pop(done) {
      popping = { t0: now, done };
    },
  };
}
