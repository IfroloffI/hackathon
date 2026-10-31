import * as THREE from 'three';
import { VK_BLUE } from '@chronolet/shared';
import { craft, stitchRing } from '../craft.ts';

/**
 * VK Coin: фетровая «пуговица-значок» с белой надписью VK и кольцом стежков —
 * как пришитая награда в рукодельном мире. Покачивается и поворачивается, мягко светится ореолом.
 */
let faceTexture: THREE.CanvasTexture | null = null;
let glowTexture: THREE.CanvasTexture | null = null;

/** Мягкое синее свечение — спрайт вместо источника света. */
function glowMap(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(120,180,255,0.7)');
  g.addColorStop(0.45, 'rgba(0,119,255,0.25)');
  g.addColorStop(1, 'rgba(0,119,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}

function face(): THREE.CanvasTexture {
  if (faceTexture) return faceTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 118px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VK', 128, 136);
  faceTexture = new THREE.CanvasTexture(c);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  return faceTexture;
}

export interface CoinView {
  root: THREE.Group;
  update(t: number): void;
  /** Анимация подбора; вызывает done, когда монета исчезла. */
  pop(done: () => void): void;
}

const bodyGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 40);
bodyGeo.rotateX(Math.PI / 2);
bodyGeo.userData.shared = true;
const faceGeo = new THREE.CircleGeometry(0.3, 32);
faceGeo.userData.shared = true;

export function vkCoin(x: number, y: number, z: number, phase: number): CoinView {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  const coin = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, craft('felt', VK_BLUE, { emissive: VK_BLUE, emissiveIntensity: 0.15 }));
  body.castShadow = true;
  coin.add(body);
  const faceMat = new THREE.MeshStandardMaterial({ map: face(), transparent: true, emissive: 0xffffff, emissiveMap: face(), emissiveIntensity: 0.4 });
  // Надпись с двух сторон, чтобы при повороте не читалась зеркально.
  for (const side of [1, -1]) {
    const f = new THREE.Mesh(faceGeo, faceMat);
    f.position.z = side * 0.065;
    if (side < 0) f.rotation.y = Math.PI;
    coin.add(f);
    const st = stitchRing(0.27, 20);
    st.rotation.x = Math.PI / 2;
    st.position.z = side * 0.065;
    coin.add(st);
  }
  // Ореол — спрайт, а не PointLight: если менять число источников света в сцене, three.js
  // перекомпилирует шейдеры ВСЕХ материалов — именно это давало фриз ~0,5 с при подборе сферы.
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowMap(), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  halo.scale.setScalar(1.4);
  root.add(halo, coin);

  let popping: { t0: number; done: () => void } | null = null;
  let now = 0;
  return {
    root,
    update(t) {
      now = t;
      if (popping) {
        const k = Math.min(1, (t - popping.t0) / 0.35);
        // «Отпрыгивает» вверх, раскручиваясь, и сжимается.
        coin.position.y = k * 0.9;
        coin.rotation.y += 0.5;
        root.scale.setScalar(1 - k * 0.8);
        halo.material.opacity = 1 - k;
        if (k >= 1) {
          popping.done();
          popping = null;
        }
        return;
      }
      root.position.y = y + Math.sin(t * 2 + phase) * 0.1;
      coin.rotation.y = Math.sin(t * 1.6 + phase) * 0.7;
    },
    pop(done) {
      popping = { t0: now, done };
    },
  };
}
