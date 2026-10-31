import * as THREE from 'three';
import { ClientMsg, HUB_LEVEL, MOVE_SEND_HZ } from '@chronolet/shared';
import { net, type CrewRoom, type NetPlayer } from '../net/connection.ts';
import { buildWorld } from './world.ts';
import { Character } from './Character.ts';
import { LocalController } from './LocalController.ts';
import { RemotePlayer } from './RemotePlayer.ts';

/** Если сервер «поправил» нас сильнее этого — принимаем его позицию. */
const CORRECTION_THRESHOLD = 3;

/**
 * Игровая сцена одной комнаты: рендер, локальный игрок, чужие игроки из state.
 * Эпохи/головоломки позже станут отдельными модулями в src/epochs/.
 */
export class Game {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  private clock = new THREE.Clock();
  private world = buildWorld(this.scene, HUB_LEVEL);
  private remotes = new Map<string, RemotePlayer>();
  private local?: { ctrl: LocalController; view: Character; state: NetPlayer };
  private sendAcc = 0;
  private lastSent = '';
  private raf = 0;
  private unbind: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    private room: CrewRoom,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.append(this.renderer.domElement);
    addEventListener('resize', this.onResize);
    this.onResize();

    const $ = net.callbacks(room);
    this.unbind.push(
      $.onAdd('players', (player, sessionId) => this.addPlayer(sessionId as string, player as NetPlayer)),
      $.onRemove('players', (_player, sessionId) => this.removePlayer(sessionId as string)),
    );

    this.loop();
  }

  /** Отключить управление (например, пока печатаешь в чат). */
  setInputEnabled(enabled: boolean) {
    if (this.local) this.local.ctrl.enabled = enabled;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    this.unbind.forEach((u) => u());
    this.remotes.forEach((r) => r.dispose());
    this.local?.ctrl.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private addPlayer(sessionId: string, state: NetPlayer) {
    if (sessionId === this.room.sessionId) {
      if (this.local) return; // повторный onAdd после реконнекта
      const view = new Character(state.name, state.color);
      this.scene.add(view.root);
      this.local = { ctrl: new LocalController(HUB_LEVEL, state), view, state };
      return;
    }
    const remote = new RemotePlayer(state);
    this.remotes.set(sessionId, remote);
    this.scene.add(remote.view.root);
  }

  private removePlayer(sessionId: string) {
    this.remotes.get(sessionId)?.dispose();
    this.remotes.delete(sessionId);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    if (this.local) {
      const { ctrl, view, state } = this.local;
      ctrl.update(dt);
      if (Math.hypot(state.x - ctrl.x, state.y - ctrl.y) > CORRECTION_THRESHOLD) ctrl.teleport(state);
      view.setPose(ctrl.x, ctrl.y, ctrl.z, ctrl.facing, ctrl.anim, dt);
      this.sendMove(dt);
      this.followCamera(ctrl.x, ctrl.y, dt);
    }
    this.remotes.forEach((r) => r.update(dt));
    this.world.update(t);
    this.renderer.render(this.scene, this.camera);
  };

  /** Шлём позицию с частотой MOVE_SEND_HZ и только если она изменилась. */
  private sendMove(dt: number) {
    this.sendAcc += dt;
    if (this.sendAcc < 1 / MOVE_SEND_HZ || !this.local) return;
    this.sendAcc = 0;
    const snap = this.local.ctrl.snapshot();
    const key = `${snap.x.toFixed(3)}|${snap.y.toFixed(3)}|${snap.z.toFixed(3)}|${snap.anim}|${snap.facing}`;
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.room.send(ClientMsg.Move, snap);
  }

  private followCamera(x: number, y: number, dt: number) {
    const k = 1 - Math.exp(-dt * 4);
    this.camera.position.x += (x - this.camera.position.x) * k;
    this.camera.position.y += (y + 3 - this.camera.position.y) * k;
    this.camera.position.z = 16;
    this.camera.lookAt(this.camera.position.x, this.camera.position.y - 1.5, 0);
  }

  private onResize = () => {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
