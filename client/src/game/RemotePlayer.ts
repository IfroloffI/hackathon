import { Character } from './Character.ts';
import type { NetPlayer } from '../net/connection.ts';

/** Чужой игрок: цель приходит патчами ~20 Гц, рисуем плавно (экспоненциальное сглаживание). */
export class RemotePlayer {
  readonly view: Character;
  private x: number;
  private y: number;
  private z: number;

  constructor(private state: NetPlayer) {
    this.view = new Character(state.name, state.color);
    ({ x: this.x, y: this.y, z: this.z } = state);
  }

  update(dt: number) {
    const s = this.state;
    // Далеко (респаун/реконнект) — телепорт, иначе догоняем.
    if (Math.hypot(s.x - this.x, s.y - this.y) > 4) {
      ({ x: this.x, y: this.y, z: this.z } = s);
    } else {
      const k = 1 - Math.exp(-dt * 15);
      this.x += (s.x - this.x) * k;
      this.y += (s.y - this.y) * k;
      this.z += (s.z - this.z) * k;
    }
    this.view.setDimmed(!s.connected);
    this.view.setPose(this.x, this.y, this.z, s.facing, s.anim, dt);
  }

  dispose() {
    this.view.dispose();
  }
}
