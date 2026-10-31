import { PHYSICS, PLAYER_SIZE, type Anim, type Level, type MovePayload } from '@chronolet/shared';

const MAX_FALL_SPEED = 20;

/**
 * Ввод + простая AABB-физика платформера. Клиент считает своё движение сам,
 * сервер только проверяет правдоподобие (server/src/rooms/movement.ts).
 */
export class LocalController {
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;
  anim: Anim = 'idle';
  private grounded = false;
  private keys = new Set<string>();
  private jumpQueued = false;
  enabled = true;

  constructor(
    private level: Level,
    spawn: { x: number; y: number; z: number },
  ) {
    ({ x: this.x, y: this.y, z: this.z } = spawn);
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
  }

  dispose() {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
  }

  teleport(p: { x: number; y: number; z: number }) {
    ({ x: this.x, y: this.y, z: this.z } = p);
    this.vx = this.vy = 0;
  }

  update(dt: number) {
    const k = this.enabled ? this.keys : new Set<string>();
    const dir = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const depth = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);

    this.vx = dir * PHYSICS.runSpeed;
    if (dir) this.facing = dir > 0 ? 1 : -1;

    if (this.jumpQueued && this.grounded) this.vy = PHYSICS.jumpSpeed;
    this.jumpQueued = false;
    this.vy = Math.max(this.vy - PHYSICS.gravity * dt, -MAX_FALL_SPEED);

    const { bounds } = this.level;
    const halfW = PLAYER_SIZE.w / 2;
    this.x = Math.min(bounds.maxX, Math.max(bounds.minX, this.x + this.vx * dt));
    this.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, this.z + depth * PHYSICS.depthSpeed * dt));

    // Вертикаль: приземление только сверху на платформу (one-way platforms).
    const prevY = this.y;
    this.y += this.vy * dt;
    this.grounded = false;
    if (this.vy <= 0) {
      for (const p of this.level.platforms) {
        const top = p.y + p.h / 2;
        const overlapX = this.x + halfW > p.x - p.w / 2 && this.x - halfW < p.x + p.w / 2;
        if (overlapX && prevY >= top - 0.001 && this.y <= top) {
          this.y = top;
          this.vy = 0;
          this.grounded = true;
          break;
        }
      }
    }

    if (this.y < bounds.minY) this.teleport(this.level.spawn);

    this.anim = !this.grounded ? (this.vy > 0 ? 'jump' : 'fall') : this.vx !== 0 ? 'run' : 'idle';
  }

  snapshot(): MovePayload {
    return { x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, anim: this.anim, facing: this.facing };
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) this.jumpQueued = true;
    }
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
}
