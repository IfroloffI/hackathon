import * as THREE from 'three';
import { getSkin, type HatKind, type SkinDef } from '@chronolet/shared';
import { craft } from './craft.ts';
import { buildMascotHead, buildTail, buttonEye, stitchedSmile, type MascotKit } from './mascots.ts';

export interface CharacterOptions {
  /** NPC-рассказчик: без антенны и рюкзака, в одежде эпохи. */
  npc?: { robe: number; hat?: number };
  /** Скин игрока (id из SKINS). */
  skin?: string;
}

const ROLE_ICON: Record<string, string> = { observer: '🔭', mechanic: '🔧' };
const HEAD_Y = 0.72;

/**
 * Член экипажа Колизиума — мягкая вязаная фигурка: тело-фасолина, крупная голова, варежки,
 * глаза-пуговицы, молния на животе. У хронавта — прозрачный шлем-«аквариум» с помпоном-антенной.
 * Процедурная анимация «живой игрушки»: дыхание и покачивание головы, бег с наклоном,
 * растяжение в прыжке и сплющивание при приземлении.
 * Высота ≈ PLAYER_SIZE.h (1.2), ступни в y=0.
 */
export class Character {
  readonly root = new THREE.Group();
  /** Поворачивается в сторону движения (3/4 к камере). */
  private model = new THREE.Group();
  private torso = new THREE.Group();
  private body: THREE.Mesh;
  private head = new THREE.Group();
  private armL: THREE.Group;
  private armR: THREE.Group;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private antennaTip?: THREE.Mesh;
  private label: THREE.Sprite;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private t = Math.random() * 10;
  private yaw = 0.5;
  private name: string;
  private role: string | null = null;
  private lastAnim = 'idle';
  /** 1 → только что приземлились (сплющены), затухает к 0. */
  private squash = 0;
  /** Какой скин надет — чтобы понять, когда пересобрать персонажа. */
  readonly skinId: string;

  constructor(name: string, color: number, opts: CharacterOptions = {}) {
    this.name = name;
    const skin: SkinDef = getSkin(opts.skin ?? 'default');
    this.skinId = skin.id;
    const kit = this.kit;
    const mascot = !opts.npc && skin.head !== 'helmet';
    const suitColor = opts.npc?.robe ?? skin.body ?? color;
    const trimColor = skin.accent ?? color;
    const suit = kit.knit(suitColor);
    const detail = kit.felt(opts.npc ? 0xf2efe6 : skin.detail);
    const accent = kit.felt(trimColor);

    // Ножки-подушечки (пивот в бедре).
    const legGeo = this.geo(new THREE.CapsuleGeometry(0.085, 0.08, 6, 12));
    const footGeo = this.geo(new THREE.SphereGeometry(0.11, 18, 12));
    const makeLeg = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.27, 0);
      const leg = new THREE.Mesh(legGeo, suit);
      leg.position.y = -0.1;
      const foot = new THREE.Mesh(footGeo, opts.npc ? kit.felt(0x4a3a2a) : detail);
      foot.scale.set(1, 0.55, 1.35);
      foot.position.set(0, -0.21, 0.03);
      g.add(leg, foot);
      return g;
    };
    this.legL = makeLeg(-0.12);
    this.legR = makeLeg(0.12);

    // Тело-фасолина (lathe): пивот внизу — удобно сплющивать при приземлении.
    this.torso.position.y = 0.2;
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const k = i / 16;
      prof.push(new THREE.Vector2(Math.sin(k * Math.PI) * (0.26 + 0.05 * Math.sin(k * Math.PI * 0.9)) + 0.001, k * 0.62));
    }
    this.body = new THREE.Mesh(this.geo(new THREE.LatheGeometry(prof, 32)), suit);
    this.torso.add(this.body);
    const belly = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.19, 24, 16)), detail);
    belly.scale.set(1, 1.05, 0.5);
    belly.position.set(0, 0.3, 0.17);
    this.torso.add(belly);

    if (!opts.npc) {
      // Молния-застёжка с «собачкой».
      const zip = kit.plain(0xd0d4da, { metalness: 0.6 });
      const teeth = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.024, 0.26, 0.02)), zip);
      teeth.position.set(0, 0.32, 0.265);
      const pull = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.028, 0.01, 6, 12)), zip);
      pull.position.set(0, 0.46, 0.27);
      this.torso.add(teeth, pull);
    }

    if (mascot) {
      if (skin.tail) {
        const tail = buildTail(skin.tail, suitColor, kit);
        tail.position.set(0, 0.12, -0.24);
        this.torso.add(tail);
      }
    } else if (!opts.npc) {
      // Вязаный рюкзак с полоской-огоньком цвета игрока.
      const pack = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.17, 18, 14)), kit.knit(skin.detail));
      pack.scale.set(1.1, 1.2, 0.6);
      pack.position.set(0, 0.36, -0.24);
      const light = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.025, 0.14, 4, 8)), kit.plain(trimColor, { emissive: trimColor, emissiveIntensity: 0.9 }));
      light.rotation.z = Math.PI / 2;
      light.position.set(0, 0.4, -0.35);
      const patch = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.06, 20)), accent);
      patch.position.set(0.15, 0.42, 0.235);
      patch.rotation.y = 0.5;
      this.torso.add(pack, light, patch);
    }

    // Ручки-варежки (пивот в плече).
    const armGeo = this.geo(new THREE.CapsuleGeometry(0.068, 0.16, 6, 12));
    const mittGeo = this.geo(new THREE.SphereGeometry(0.09, 18, 12));
    const makeArm = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.44, 0);
      const arm = new THREE.Mesh(armGeo, suit);
      arm.position.y = -0.12;
      const mitt = new THREE.Mesh(mittGeo, opts.npc ? kit.felt(0xe8c4a0) : detail);
      mitt.position.y = -0.26;
      g.add(arm, mitt);
      return g;
    };
    this.armL = makeArm(-0.3);
    this.armR = makeArm(0.3);
    this.torso.add(this.armL, this.armR);

    // Голова: крупная, мягкая — пропорции плюшевой игрушки.
    const head = this.head;
    head.position.y = HEAD_Y;
    if (opts.npc) {
      const face = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.3, 28, 20)), kit.knit(0xe8c4a0));
      face.scale.set(1, 0.95, 0.94);
      head.add(face);
      buttonEye(kit, head, -0.1, 0.06, 0.27, 0.05, 0x1b1b1b);
      buttonEye(kit, head, 0.1, 0.06, 0.27, 0.05, 0x1b1b1b);
      const noseM = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.05, 12, 10)), kit.knit(0xdba882));
      noseM.position.set(0, -0.01, 0.3);
      const beard = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.2, 24, 16)), kit.felt(0xf2efe6));
      beard.scale.set(1, 1.1, 0.7);
      beard.position.set(0, -0.2, 0.13);
      head.add(noseM, beard);
      if (opts.npc.hat !== undefined) {
        const hatMat = kit.felt(opts.npc.hat);
        const crown = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.22, 0.27, 0.24, 28)), hatMat);
        crown.position.y = 0.3;
        const brim = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 28)), hatMat);
        brim.position.y = 0.19;
        head.add(crown, brim);
      }
    } else if (mascot) {
      head.add(buildMascotHead(skin.head, skin, suitColor, trimColor, kit));
      this.addHat(head, skin.hat, accent);
    } else {
      // Хронавт: вязаное лицо, глаза-пуговицы, улыбка; поверх — прозрачный шлем-«аквариум».
      const face = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.28, 28, 20)), kit.knit(0xf2d2b8));
      face.scale.set(1, 0.95, 0.92);
      head.add(face);
      buttonEye(kit, head, -0.1, 0.03, 0.25, 0.055, skin.eye);
      buttonEye(kit, head, 0.1, 0.03, 0.25, 0.055, skin.eye);
      stitchedSmile(kit, head, -0.09, 0.26, 0.09);
      const glass = new THREE.Mesh(
        this.geo(new THREE.SphereGeometry(0.38, 32, 24)),
        this.mat(new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.05, clearcoat: 1, depthWrite: false })),
      );
      glass.renderOrder = 2;
      const collar = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.27, 0.075, 14, 32)), kit.knit(skin.detail));
      collar.rotation.x = Math.PI / 2;
      collar.position.y = -0.3;
      const stalk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6)), kit.plain(0x9aa0a8));
      stalk.position.set(0.16, 0.44, -0.04);
      this.antennaTip = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.06, 14, 12)), accent);
      this.antennaTip.position.set(0.16, 0.58, -0.04);
      head.add(glass, collar, stalk, this.antennaTip);
      this.addHat(head, skin.hat, accent);
    }
    this.torso.add(head);

    this.model.add(this.legL, this.legR, this.torso);
    this.model.traverse((o) => {
      // Прозрачный шлем тени не отбрасывает.
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = !(m.material as THREE.Material).transparent;
    });

    this.label = makeLabel(name);
    this.label.position.y = 1.62;
    this.root.add(this.model, this.label);
  }

  private bubble?: THREE.Sprite;
  private bubbleLeft = 0;

  /** Стикер-облачко над головой (эмоция, лайк) на ms миллисекунд. */
  showBubble(text: string, ms = 2500) {
    if (!this.bubble) {
      this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      this.bubble.renderOrder = 11;
      this.bubble.position.y = 2.1;
      this.root.add(this.bubble);
    }
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,250,240,0.97)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 112, 96, 32);
    ctx.moveTo(52, 102);
    ctx.lineTo(64, 122);
    ctx.lineTo(76, 102);
    ctx.fill();
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(160,130,100,0.6)';
    ctx.beginPath();
    ctx.roundRect(16, 16, 96, 80, 26);
    ctx.stroke();
    ctx.font = '60px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 58);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.bubble.material.map?.dispose();
    this.bubble.material.map = tex;
    this.bubble.material.needsUpdate = true;
    this.bubble.visible = true;
    this.bubbleLeft = ms / 1000;
  }

  setRole(role: string | null) {
    if (role === this.role) return;
    this.role = role;
    this.label.material.map?.dispose();
    this.label.material.map = makeLabelTexture(role ? `${ROLE_ICON[role] ?? ''} ${this.name}` : this.name);
    this.label.material.needsUpdate = true;
  }

  setPose(x: number, y: number, z: number, facing: number, anim: string, dt: number) {
    this.root.position.set(x, y, z);
    this.t += dt;
    const t = this.t;

    // Поворот 3/4 в сторону движения, плавно.
    const targetYaw = facing < 0 ? -0.55 : 0.55;
    this.yaw += (targetYaw - this.yaw) * (1 - Math.exp(-dt * 12));
    this.model.rotation.y = this.yaw;

    // Приземление (из прыжка/падения на землю) — сплющиться и отпружинить.
    const airborne = (a: string) => a === 'jump' || a === 'fall';
    if (airborne(this.lastAnim) && !airborne(anim)) this.squash = 1;
    this.lastAnim = anim;
    this.squash = Math.max(0, this.squash - dt * 5);

    let swing = 0;
    let armLift = 0;
    let lean = 0;
    let bob = Math.sin(t * 2.2) * 0.01; // дыхание
    let stretch = 1 + Math.sin(t * 2.2) * 0.015;
    if (anim === 'run') {
      swing = Math.sin(t * 13) * 0.8;
      bob = Math.abs(Math.sin(t * 13)) * 0.05;
      lean = 0.16;
    } else if (anim === 'jump') {
      armLift = -2.5;
      swing = 0.35;
      stretch = 1.1;
    } else if (anim === 'fall') {
      armLift = -1.7;
      swing = -0.25;
      stretch = 1.04;
    }
    // Пружинка после приземления: сначала сплющены, потом чуть вытягиваемся.
    const sq = this.squash;
    if (sq > 0) stretch *= 1 - Math.sin(sq * Math.PI) * 0.22;
    const widen = 1 / Math.sqrt(stretch);

    this.legL.rotation.x = swing;
    this.legR.rotation.x = anim === 'jump' ? -0.5 : -swing;
    this.armL.rotation.x = armLift ? armLift : -swing * 0.8;
    this.armR.rotation.x = armLift ? armLift : swing * 0.8;
    this.armL.rotation.z = armLift ? -0.35 : 0.15 + Math.sin(t * 2.2) * 0.04;
    this.armR.rotation.z = armLift ? 0.35 : -0.15 - Math.sin(t * 2.2) * 0.04;
    this.torso.position.y = 0.2 + bob;
    this.torso.rotation.x += (lean - this.torso.rotation.x) * (1 - Math.exp(-dt * 10));
    this.torso.scale.set(widen, stretch, widen);
    // Голова — с ленивым покачиванием (как набитая ватой).
    this.head.rotation.z = Math.sin(t * 1.6) * 0.06 + (anim === 'run' ? Math.sin(t * 13) * 0.05 : 0);
    this.head.rotation.x = -lean * 0.6;
    if (this.antennaTip) this.antennaTip.position.x = 0.16 + Math.sin(t * 4) * 0.02;
    if (this.bubble?.visible) {
      this.bubbleLeft -= dt;
      const pop = Math.min(1, (2.5 - this.bubbleLeft) * 6);
      this.bubble.scale.setScalar(0.75 * Math.max(0.2, pop) * (this.bubbleLeft < 0.3 ? this.bubbleLeft / 0.3 : 1));
      this.bubble.position.y = 2.1 + Math.sin(t * 3) * 0.04;
      if (this.bubbleLeft <= 0) this.bubble.visible = false;
    }
  }

  setDimmed(dimmed: boolean) {
    for (const m of this.materials) {
      m.transparent = dimmed || m.userData.alwaysTransparent === true;
      m.opacity = dimmed ? 0.35 : (m.userData.baseOpacity ?? 1);
    }
  }

  dispose() {
    this.root.removeFromParent();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.bubble?.material.map?.dispose();
    this.bubble?.material.dispose();
  }

  private addHat(head: THREE.Group, hat: HatKind, accent: THREE.Material) {
    const kit = this.kit;
    const gold = kit.felt(0xffc94d);
    const add = (m: THREE.Mesh, x: number, y: number, z = 0) => {
      m.position.set(x, y, z);
      m.castShadow = true;
      head.add(m);
      return m;
    };
    switch (hat) {
      case 'crown': {
        add(new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 20, 1, true)), gold), 0, 0.34);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          add(new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.045, 10, 8)), gold), Math.cos(a) * 0.17, 0.44, Math.sin(a) * 0.17);
        }
        break;
      }
      case 'wizard': {
        const cone = add(new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.22, 0.5, 20)), kit.felt(0x2a1a6a)), 0, 0.52);
        cone.rotation.z = -0.15;
        add(new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.05, 10, 8)), accent), 0.08, 0.76);
        break;
      }
      case 'cap': {
        add(new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.31, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4)), accent), 0, 0.06);
        const visor = add(new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.18, 0.18, 0.035, 20, 1, false, 0, Math.PI)), accent), 0, 0.13, 0.22);
        visor.rotation.y = -Math.PI / 2;
        break;
      }
      case 'halo': {
        const ring = add(new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.22, 0.035, 10, 32)), kit.plain(0xffe680, { emissive: 0xffd34d, emissiveIntensity: 0.8 })), 0, 0.52);
        ring.rotation.x = Math.PI / 2;
        break;
      }
      case 'antlers': {
        const wood = kit.felt(0x8b5a2b);
        for (const sx of [-1, 1]) {
          const main = add(new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.03, 0.28, 4, 8)), wood), sx * 0.16, 0.42);
          main.rotation.z = -sx * 0.5;
          const tine = add(new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.025, 0.12, 4, 8)), wood), sx * 0.23, 0.47);
          tine.rotation.z = sx * 0.6;
        }
        break;
      }
    }
  }

  /** Своя копия материала стиля — чтобы затемнять отключившихся, не задевая остальных. */
  private own(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const m = base.clone();
    m.userData = {};
    return this.mat(m);
  }

  /** Доступ билдеров маскотов к материалам стиля и учёту ресурсов (для dispose). */
  private kit: MascotKit = {
    mat: (m) => this.mat(m),
    geo: (g) => this.geo(g),
    knit: (c) => this.own(craft('knit', c)),
    felt: (c) => this.own(craft('felt', c)),
    plain: (c, extra = {}) => this.own(craft('plain', c, extra)),
  };

  private mat<T extends THREE.Material>(m: T): T {
    if (m.transparent) {
      m.userData.alwaysTransparent = true;
      m.userData.baseOpacity = m.opacity;
    }
    this.materials.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }
}

/** Бирка с именем: кремовая ткань со строчкой по краю. */
function makeLabelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,248,232,0.94)';
  ctx.beginPath();
  ctx.roundRect(4, 8, 312, 48, 24);
  ctx.fill();
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(150,115,80,0.7)';
  ctx.beginPath();
  ctx.roundRect(11, 14, 298, 36, 18);
  ctx.stroke();
  ctx.fillStyle = '#4a3422';
  ctx.font = 'bold 27px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 33, 280);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLabel(text: string): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeLabelTexture(text), depthTest: false }));
  sprite.scale.set(1.9, 0.38, 1);
  sprite.renderOrder = 10;
  return sprite;
}
