import { PHYSICS, moveAndCollide, resolvePenetration, respawnPoint, type Anim, type Level, type MovePayload } from '@chronolet/shared';

const MAX_FALL_SPEED = 20;

/**
 * Ввод + AABB-физика платформера (общая, из shared). Клиент считает своё движение сам,
 * сервер только проверяет правдоподобие (server/src/rooms/movement.ts).
 */
export class LocalController {
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  facing: 1 | -1 = 1;
  anim: Anim = 'idle';
  private grounded = false;
  /** Где упал в яму — Game сообщит серверу, чтобы тот тоже вернул на чекпоинт, а не резал «телепорт». */
  private fell: { x: number; z: number } | null = null;
  private keys = new Set<string>();
  private jumpQueued = false;
  enabled = true;

  constructor(
    public level: Level,
    spawn: { x: number; y: number; z: number },
  ) {
    ({ x: this.x, y: this.y, z: this.z } = spawn);
    resolvePenetration(this, level);
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
    this.vx = this.vy = this.vz = 0;
    resolvePenetration(this, this.level);
  }

  update(dt: number) {
    const k = this.enabled ? this.keys : new Set<string>();
    const dir = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const depth = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);

    this.vx = dir * PHYSICS.runSpeed;
    this.vz = depth * PHYSICS.depthSpeed;
    if (dir) this.facing = dir > 0 ? 1 : -1;

    if (this.jumpQueued && this.grounded) this.vy = PHYSICS.jumpSpeed;
    this.jumpQueued = false;
    this.vy = Math.max(this.vy - PHYSICS.gravity * dt, -MAX_FALL_SPEED);

    // Объекты твёрдые со всех сторон и по глубине: shared/src/physics.ts.
    this.grounded = moveAndCollide(this, dt, this.level).grounded;

    // Упал в яму — к ближайшему чекпоинту слева (сервер считает так же).
    if (this.y < this.level.bounds.minY) {
      this.fell = { x: this.x, z: this.z };
      this.teleport(respawnPoint(this.level, this.x));
    }

    this.anim = !this.grounded ? (this.vy > 0 ? 'jump' : 'fall') : this.vx !== 0 ? 'run' : 'idle';
  }

  /** Смена уровня по команде сервера. */
  setLevel(level: Level, p: { x: number; y: number; z: number }) {
    this.level = level;
    this.teleport(p);
  }

  /** Пакет «упал ниже дна» (один раз после падения): сервер по нему делает тот же респаун. */
  takeFall(): MovePayload | null {
    if (!this.fell) return null;
    const { x, z } = this.fell;
    this.fell = null;
    return { levelId: this.level.id, x, y: this.level.bounds.minY - 1, z, vx: 0, vy: 0, anim: 'fall', facing: this.facing };
  }

  snapshot(): MovePayload {
    return { levelId: this.level.id, x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, anim: this.anim, facing: this.facing };
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
