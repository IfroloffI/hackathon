import { Character } from './Character.ts';
import type { NetPlayer } from '../net/connection.ts';

/** Чужой игрок: цель приходит патчами ~20 Гц, рисуем плавно (экспоненциальное сглаживание). */
export class RemotePlayer {
  view: Character;
  private role: string | null = null;
  private x: number;
  private y: number;
  private z: number;

  constructor(private state: NetPlayer) {
    this.view = new Character(state.name, state.color, { skin: state.skin });
    ({ x: this.x, y: this.y, z: this.z } = state);
  }

  /** Роль запоминаем, чтобы восстановить табличку после смены скина. */
  setRole(role: string | null) {
    this.role = role;
    this.view.setRole(role);
  }

  update(dt: number) {
    const s = this.state;
    // Сменил скин в магазине — пересобираем персонажа на том же месте сцены.
    if (s.skin && s.skin !== this.view.skinId) {
      const parent = this.view.root.parent;
      this.view.dispose();
      this.view = new Character(s.name, s.color, { skin: s.skin });
      this.view.setRole(this.role);
      parent?.add(this.view.root);
    }
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
