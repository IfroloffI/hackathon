import * as THREE from 'three';
import type { Level } from '@chronolet/shared';

/**
 * 2.5D-сцена: игровая дорожка + несколько слоёв фона на разной глубине
 * («картонные» декорации из дизайн-дока). Пока примитивы — потом заменим на ассеты.
 */
export function buildWorld(scene: THREE.Scene, level: Level) {
  scene.background = new THREE.Color(0x3a2c22);
  scene.fog = new THREE.Fog(0x3a2c22, 18, 45);

  const hemi = new THREE.HemisphereLight(0xfff1dc, 0x4a3426, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.6);
  sun.position.set(6, 12, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 15, bottom: -8 });
  scene.add(sun);

  const depth = level.bounds.maxZ - level.bounds.minZ + 1.2;
  for (const p of level.platforms) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(p.w, p.h, depth),
      new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.95 }),
    );
    mesh.position.set(p.x, p.y, 0);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Слои фона: стена корабля, иллюминаторы, дальние «картонные» силуэты.
  const layers: { z: number; color: number; height: number; y: number }[] = [
    { z: -4, color: 0x6b4f3a, height: 14, y: 5 },
    { z: -9, color: 0x4f3a2c, height: 18, y: 6 },
  ];
  for (const l of layers) {
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(80, l.height),
      new THREE.MeshStandardMaterial({ color: l.color, roughness: 1 }),
    );
    wall.position.set(0, l.y, l.z);
    wall.receiveShadow = true;
    scene.add(wall);
  }

  const portMat = new THREE.MeshStandardMaterial({ color: 0x9fd3e8, emissive: 0x2a5d73, emissiveIntensity: 0.8 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9a46c, roughness: 0.6 });
  for (let x = -16; x <= 16; x += 8) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.18, 12, 32), rimMat);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), portMat);
    rim.position.set(x, 5.5, -3.9);
    glass.position.set(x, 5.5, -3.95);
    scene.add(rim, glass);
  }

  // Хроно-двигатель в центре хаба — заглушка, позже гнёзда под 5 деталей.
  const engine = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.8, 3, 24),
    new THREE.MeshStandardMaterial({ color: 0x8c6f4e, metalness: 0.3, roughness: 0.5 }),
  );
  engine.position.set(0, 1.5, -2.6);
  engine.castShadow = true;
  scene.add(engine);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xffb35c, emissive: 0xff7a1a, emissiveIntensity: 1.2 }),
  );
  core.position.set(0, 3.4, -2.6);
  scene.add(core);

  return {
    update(t: number) {
      core.position.y = 3.4 + Math.sin(t * 2) * 0.1;
      core.rotation.y = t;
    },
  };
}
