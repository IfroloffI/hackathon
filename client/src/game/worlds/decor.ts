import * as THREE from 'three';

export interface Decor {
  update?(t: number): void;
  setParts?(parts: string[]): void;
}

/** Надпись-табличка в мире (название места, станции). */
export function signSprite(text: string, x: number, y: number, z: number, width = 3, color = '#fff3d6'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 56px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 50, 500);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.position.set(x, y, z);
  s.scale.set(width, (width * 96) / 512, 1);
  return s;
}
