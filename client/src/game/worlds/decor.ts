import * as THREE from 'three';
import { badgeTexture } from '../craft.ts';

export interface Decor {
  update?(t: number): void;
  setParts?(parts: string[]): void;
}

/** Надпись-нашивка в мире (название места, станции): фетровый шеврон цвета color со строчкой по краю. */
export function signSprite(text: string, x: number, y: number, z: number, width = 3, color = '#7a4b12'): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(text, color), transparent: true, depthWrite: false }));
  s.position.set(x, y, z);
  s.scale.set(width * 1.25, (width * 1.25) / 4, 1);
  return s;
}
