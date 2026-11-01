import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ClientMsg,
  EMOTES,
  type EmoteBroadcast,
  type CratePos,
  type LikeBroadcast,
  MOVE_SEND_HZ,
  ServerMsg,
  getLevel,
  isNearStation,
  type Station,
  type TeleportPayload,
} from '@chronolet/shared';
import { net, type CrewRoom, type NetPlayer } from '../net/connection.ts';
import { buildWorld, type World } from './worlds/index.ts';
import { Character } from './Character.ts';
import { LocalController } from './LocalController.ts';
import { RemotePlayer } from './RemotePlayer.ts';

/** Если сервер «поправил» нас сильнее этого — принимаем его позицию. */
const CORRECTION_THRESHOLD = 3;
/** Как часто, пока упираемся в ящик, напоминаем серверу «толкаю» (его срок — CRATE_PUSH_TTL_MS). */
const PUSH_SEND_HZ = 10;
const HAZARD_BUBBLE: Record<string, string> = { arrow: '💥', water: '💦' };

/**
 * Камера-«операторский кран»: висит на орбите вокруг игрока и живо поворачивается по ходу движения,
 * чтобы было видно, куда бежишь. Углы в радианах; скорость — «жёсткость» экспоненциального сглаживания.
 * Развороты сопровождаются лёгким креном, как у камеры на кране, качнувшейся в сторону движения.
 */
const CAM = {
  distance: 15,
  height: 3.2,
  /** Поворот, пока бежим, и остаточный поворот в сторону взгляда, когда стоим. */
  runYaw: 0.9,
  idleYaw: 0.32,
  /** Сколько смотреть вперёд по ходу (единицы мира). */
  lead: 2,
  followSpeed: 4.5,
  yawSpeed: 2.4,
  /** Крен: коэффициент от скорости поворота, предел и скорость возврата в горизонт. */
  roll: 0.03,
  rollMax: 0.12,
  rollSpeed: 4,
};

/**
 * Игровая сцена комнаты: рендер текущего уровня (корабль или эпоха), локальный игрок,
 * чужие игроки, станции взаимодействия (E). Уровень меняет только сервер — клиент следует за state.levelId.
 */
export class Game {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  /** Сглаженное состояние камеры: точка, за которой следим, угол орбиты, упреждение и крен. */
  private camFocus = new THREE.Vector3();
  private camYaw = 0;
  private camLead = 0;
  private camRoll = 0;
  private clock = new THREE.Clock();
  private world?: World;
  private worldLevelId = '';
  private remotes = new Map<string, RemotePlayer>();
  private local?: { ctrl: LocalController; view: Character; state: NetPlayer };
  private sendAcc = 0;
  private pushAcc = 0;
  private lastSent = '';
  private raf = 0;
  private unbind: (() => void)[] = [];
  private nearStation: Station | null = null;
  private promptHtml = '';
  private inputEnabled = true;
  private prompt = document.getElementById('prompt')!;

  constructor(
    private container: HTMLElement,
    private room: CrewRoom,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    // Мягкое «студийное» окружение: ткань и пластик получают объёмные блики, как в диораме под софтбоксом.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    container.append(this.renderer.domElement);
    addEventListener('resize', this.onResize);
    addEventListener('keydown', this.onKeyDown);
    this.onResize();

    const $ = net.callbacks(room);
    this.unbind.push(
      $.onAdd('players', (player, sessionId) => this.addPlayer(sessionId as string, player as NetPlayer)),
      $.onRemove('players', (_player, sessionId) => this.removePlayer(sessionId as string)),
      $.listen('levelId', (id) => this.ensureWorld(String(id))),
      $.onChange('parts', () => this.world?.setParts([...room.state.parts])),
      // puzzle приходит с первым патчем state — подписываемся на его поля, когда он появится.
      $.listen('puzzle', (pz) => {
        if (!pz) return;
        this.unbind.push(
          $.listen(pz, 'observer', () => this.updateRoleBadges()),
          $.listen(pz, 'mechanic', () => this.updateRoleBadges()),
        );
      }),
      room.onMessage(ServerMsg.Teleport, (t: TeleportPayload) => this.onTeleport(t)),
      room.onMessage(ServerMsg.Emote, (m: EmoteBroadcast) => this.viewOf(m.sessionId)?.showBubble(EMOTES[m.emote] ?? '❔')),
      room.onMessage(ServerMsg.Like, (m: LikeBroadcast) => this.viewOf(m.to)?.showBubble('❤️', 1800)),
      $.onAdd('coinsTaken', (id) => this.world?.popCoin(String(id)), false),
    );

    this.ensureWorld(room.state.levelId || 'hub');
    this.loop();
  }

  /** Открыть магазин скинов (E у терминала на борту). Подключается в main.ts. */
  onShop?: () => void;

  /** Рядом ли игрок со станцией данного вида — магазин закрывается, если отойти. */
  isNear(kind: Station['kind']): boolean {
    return this.nearStation?.kind === kind;
  }

  /** Отключить управление (например, пока печатаешь в чат). */
  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (this.local) this.local.ctrl.enabled = enabled;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    removeEventListener('keydown', this.onKeyDown);
    this.unbind.forEach((u) => u());
    this.remotes.forEach((r) => r.dispose());
    this.local?.ctrl.dispose();
    this.local?.view.dispose();
    this.world?.dispose();
    this.scene.environment?.dispose();
    this.prompt.hidden = true;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private ensureWorld(levelId: string) {
    if (!levelId || levelId === this.worldLevelId) return;
    this.world?.dispose();
    this.worldLevelId = levelId;
    this.world = buildWorld(this.scene, getLevel(levelId));
    this.world.setParts([...this.room.state.parts]);
    this.world.hideCoins(this.room.state.coinsTaken ?? []);
    // Пакет телепорта мог прийти раньше патча state — уровень контроллера синхронизируем и здесь.
    if (this.local && this.local.ctrl.level.id !== levelId) {
      this.local.ctrl.setLevel(getLevel(levelId), this.local.state);
    }
    this.snapCamera();
  }

  private onTeleport(t: TeleportPayload) {
    this.ensureWorld(t.levelId);
    this.local?.ctrl.setLevel(getLevel(t.levelId), t);
    this.lastSent = '';
    this.snapCamera();
  }

  private addPlayer(sessionId: string, state: NetPlayer) {
    if (sessionId === this.room.sessionId) {
      if (this.local) return; // повторный onAdd после реконнекта
      const view = new Character(state.name, state.color, { skin: state.skin });
      this.scene.add(view.root);
      const ctrl = new LocalController(getLevel(this.room.state.levelId || 'hub'), state);
      ctrl.enabled = this.inputEnabled;
      this.local = { ctrl, view, state };
      this.updateRoleBadges();
      this.snapCamera();
      return;
    }
    const remote = new RemotePlayer(state);
    this.remotes.set(sessionId, remote);
    this.scene.add(remote.view.root);
    this.updateRoleBadges();
  }

  private removePlayer(sessionId: string) {
    this.remotes.get(sessionId)?.dispose();
    this.remotes.delete(sessionId);
  }

  private viewOf(sessionId: string): Character | undefined {
    return sessionId === this.room.sessionId ? this.local?.view : this.remotes.get(sessionId)?.view;
  }

  /** Купил/надел скин — пересобираем своего персонажа. */
  private rebuildLocalView() {
    if (!this.local) return;
    const { state } = this.local;
    this.local.view.dispose();
    this.local.view = new Character(state.name, state.color, { skin: state.skin });
    this.scene.add(this.local.view.root);
    this.updateRoleBadges();
  }

  private updateRoleBadges() {
    const pz = this.room.state.puzzle;
    const roleOf = (sid: string) => (pz?.observer === sid ? 'observer' : pz?.mechanic === sid ? 'mechanic' : null);
    this.local?.view.setRole(roleOf(this.room.sessionId));
    this.remotes.forEach((r, sid) => r.setRole(roleOf(sid)));
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    const crates = this.cratePositions();
    this.world?.setCrates(crates);
    if (this.local) {
      const { ctrl, view, state } = this.local;
      ctrl.crates = crates;
      ctrl.update(dt);
      const hazard = ctrl.takeHazard();
      if (hazard) view.showBubble(HAZARD_BUBBLE[hazard], 1200);
      this.sendPush(dt);
      if (ctrl.level.id === this.worldLevelId) this.world?.setProgress(ctrl.x);
      if (Math.hypot(state.x - ctrl.x, state.y - ctrl.y) > CORRECTION_THRESHOLD) ctrl.teleport(state);
      if (state.skin && state.skin !== view.skinId) this.rebuildLocalView();
      this.local.view.setPose(ctrl.x, ctrl.y, ctrl.z, ctrl.facing, ctrl.anim, dt);
      this.sendMove(dt);
      this.followCamera(ctrl, dt);
      this.updatePrompt(ctrl);
    }
    this.remotes.forEach((r) => r.update(dt));
    this.world?.update(t, dt, this.camFocus.x, this.camYaw);
    this.renderer.render(this.scene, this.camera);
  };

  /** Ближайшая станция в радиусе — показываем подсказку «E — …» (текст зависит от роли, поэтому сверяем каждый кадр). */
  private updatePrompt(ctrl: LocalController) {
    const near = ctrl.level.stations.find((s) => isNearStation(s, ctrl)) ?? null;
    this.nearStation = near;
    const html = near ? `<kbd>E</kbd> ${escapeHtml(this.promptText(near))}` : '';
    if (html !== this.promptHtml) {
      this.promptHtml = html;
      this.prompt.hidden = !near;
      this.prompt.innerHTML = html;
    }
  }

  private promptText(s: Station): string {
    const pz = this.room.state.puzzle;
    if ((s.kind === 'observer' || s.kind === 'mechanic') && pz?.[s.kind] === this.room.sessionId) {
      return `${s.label} — оставить роль`;
    }
    return s.label;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.code !== 'KeyE' || e.repeat || !this.nearStation || !this.inputEnabled) return;
    // Магазин — локальная панель; покупки уходят на сервер оттуда.
    if (this.nearStation.kind === 'shop') return this.onShop?.();
    this.room.send(ClientMsg.Interact, { stationId: this.nearStation.id });
  };

  /** Ящики текущего уровня из state (позиции считает сервер). */
  private cratePositions(): CratePos[] {
    const list: CratePos[] = [];
    this.room.state.crates?.forEach((c, id) => list.push({ id: String(id), x: c.x, y: c.y }));
    return list;
  }

  /** Пока упираемся в ящик — шлём «толкаю» ~10 Гц; сервер сам проверит, что мы рядом. */
  private sendPush(dt: number) {
    const push = this.local?.ctrl.pushing;
    this.pushAcc += dt;
    if (!push || this.pushAcc < 1 / PUSH_SEND_HZ) return;
    this.pushAcc = 0;
    this.room.send(ClientMsg.Push, push);
  }

  /** Шлём позицию с частотой MOVE_SEND_HZ и только если она изменилась. */
  private sendMove(dt: number) {
    const fall = this.local?.ctrl.takeFall();
    if (fall) {
      this.room.send(ClientMsg.Move, fall);
      this.lastSent = '';
    }
    this.sendAcc += dt;
    if (this.sendAcc < 1 / MOVE_SEND_HZ || !this.local) return;
    this.sendAcc = 0;
    const snap = this.local.ctrl.snapshot();
    const key = `${snap.levelId}|${snap.x.toFixed(3)}|${snap.y.toFixed(3)}|${snap.z.toFixed(3)}|${snap.anim}|${snap.facing}`;
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.room.send(ClientMsg.Move, snap);
  }

  /** Живой поворот в сторону движения: угол, точка обзора и крен догоняют свои цели со своей скоростью. */
  private followCamera(ctrl: LocalController, dt: number) {
    const running = ctrl.vx !== 0;
    const targetYaw = ctrl.facing * (running ? CAM.runYaw : CAM.idleYaw);
    const targetLead = running ? ctrl.facing * CAM.lead : 0;
    const k = 1 - Math.exp(-dt * CAM.followSpeed);
    const ky = 1 - Math.exp(-dt * CAM.yawSpeed);
    const prevYaw = this.camYaw;
    this.camYaw += (targetYaw - this.camYaw) * ky;
    this.camLead += (targetLead - this.camLead) * ky;
    // Крен от скорости поворота: чем резче машём камерой, тем сильнее она наклоняется.
    const yawVel = (this.camYaw - prevYaw) / Math.max(dt, 1e-3);
    const targetRoll = THREE.MathUtils.clamp(yawVel * CAM.roll, -CAM.rollMax, CAM.rollMax);
    this.camRoll += (targetRoll - this.camRoll) * (1 - Math.exp(-dt * CAM.rollSpeed));
    this.camFocus.x += (ctrl.x + this.camLead - this.camFocus.x) * k;
    this.camFocus.y += (ctrl.y - this.camFocus.y) * k;
    // За глубиной камера идёт лишь на 3/4, чтобы ветки остались на экране.
    this.camFocus.z += (ctrl.z * 0.75 - this.camFocus.z) * k;
    this.placeCamera();
  }

  /** Камера на орбите радиуса CAM.distance вокруг camFocus; положительный yaw — смотрим вправо (+x). */
  private placeCamera() {
    const { x, y, z } = this.camFocus;
    this.camera.position.set(x - Math.sin(this.camYaw) * CAM.distance, y + CAM.height, z + Math.cos(this.camYaw) * CAM.distance);
    this.camera.lookAt(x, y + CAM.height - 1.6, z);
    this.camera.rotateZ(-this.camRoll);
  }

  private snapCamera() {
    if (!this.local) return;
    const { ctrl } = this.local;
    this.camYaw = ctrl.facing * CAM.idleYaw;
    this.camLead = 0;
    this.camRoll = 0;
    this.camFocus.set(ctrl.x, ctrl.y, ctrl.z * 0.75);
    this.placeCamera();
  }

  private onResize = () => {
    const w = this.container.clientWidth || innerWidth;
    const h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
