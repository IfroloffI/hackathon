import * as THREE from 'three';
import { PLAYER_SIZE } from '@chronolet/shared';

/** Визуал персонажа: «тряпичный» кубик с глазами и табличкой с именем. */
export class Character {
  readonly root = new THREE.Group();
  private body: THREE.Mesh;
  private label: THREE.Sprite;
  /** Глаза на лицевой грани (к камере), сдвигаются в сторону взгляда. */
  private face = new THREE.Group();
  private t = Math.random() * 10;

  constructor(name: string, color: number) {
    const { w, h, d } = PLAYER_SIZE;
    this.body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
    );
    this.body.position.y = h / 2;
    this.body.castShadow = true;

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1b120b });
    for (const dx of [-0.13, 0.13]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeMat);
      eye.position.set(dx, 0, 0);
      this.face.add(eye);
    }
    this.face.position.set(0.12, h * 0.2, d / 2 + 0.01);
    this.body.add(this.face);

    this.label = makeLabel(name);
    this.label.position.y = h + 0.45;
    this.root.add(this.body, this.label);
  }

  setPose(x: number, y: number, z: number, facing: number, anim: string, dt: number) {
    this.root.position.set(x, y, z);
    this.face.position.x = facing < 0 ? -0.12 : 0.12;
    this.t += dt;
    // Простая процедурная анимация вместо скелетной.
    const s = anim === 'run' ? Math.abs(Math.sin(this.t * 14)) * 0.08 : anim === 'jump' ? 0.1 : 0;
    this.body.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
  }

  setDimmed(dimmed: boolean) {
    (this.body.material as THREE.MeshStandardMaterial).opacity = dimmed ? 0.35 : 1;
    (this.body.material as THREE.MeshStandardMaterial).transparent = dimmed;
  }

  dispose() {
    this.root.removeFromParent();
    this.body.geometry.dispose();
    (this.body.material as THREE.Material).dispose();
    this.label.material.map?.dispose();
    this.label.material.dispose();
  }
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(243,230,207,0.9)';
  ctx.strokeStyle = '#3b2a1a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 48, 16);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3b2a1a';
  ctx.font = 'bold 28px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33, 230);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}
