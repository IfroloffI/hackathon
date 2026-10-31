import * as THREE from 'three';
import { getSkin, type HatKind, type SkinDef } from '@chronolet/shared';
import { buildMascotHead, buildTail } from './mascots.ts';

export interface CharacterOptions {
  /** NPC-рассказчик: без антенны и рюкзака, в одежде эпохи. */
  npc?: { robe: number; hat?: number };
  /** Скин игрока (id из SKINS). */
  skin?: string;
}

const ROLE_ICON: Record<string, string> = { observer: '🔭', mechanic: '🔧' };

/**
 * Член экипажа хронолёта: скафандр цвета игрока, шлем с визором, рюкзак, антенна-огонёк.
 * Процедурная анимация: бег (махи руками/ногами), прыжок, дыхание в покое.
 * Высота ≈ PLAYER_SIZE.h (1.2), ступни в y=0.
 */
export class Character {
  readonly root = new THREE.Group();
  /** Поворачивается в сторону движения (3/4 к камере). */
  private model = new THREE.Group();
  private torso = new THREE.Group();
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
  /** Какой скин надет — чтобы понять, когда пересобрать персонажа. */
  readonly skinId: string;

  constructor(name: string, color: number, opts: CharacterOptions = {}) {
    this.name = name;
    const skin: SkinDef = getSkin(opts.skin ?? 'default');
    this.skinId = skin.id;
    const mascot = !opts.npc && skin.head !== 'helmet';
    const suitColor = opts.npc?.robe ?? skin.body ?? color;
    const trimColor = skin.accent ?? color;
    const suit = this.mat(
      new THREE.MeshStandardMaterial({ color: suitColor, roughness: skin.metal ? 0.25 : 0.7, metalness: skin.metal ? 0.85 : 0 }),
    );
    const white = this.mat(new THREE.MeshStandardMaterial({ color: opts.npc ? 0xf2f2f2 : skin.detail, roughness: 0.4 }));
    const dark = this.mat(new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.6 }));
    const visor = this.mat(
      new THREE.MeshStandardMaterial({ color: skin.eye, metalness: 0.9, roughness: 0.15, emissive: skin.eye, emissiveIntensity: 0.35 }),
    );
    const accent = this.mat(new THREE.MeshStandardMaterial({ color: trimColor, emissive: trimColor, emissiveIntensity: 0.9 }));

    // Ноги (пивот в бедре)
    const legGeo = this.geo(new THREE.CapsuleGeometry(0.09, 0.2, 4, 8));
    const bootGeo = this.geo(new THREE.BoxGeometry(0.17, 0.09, 0.24));
    const makeLeg = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.36, 0);
      const leg = new THREE.Mesh(legGeo, opts.npc || mascot ? suit : white);
      leg.position.y = -0.17;
      const boot = new THREE.Mesh(bootGeo, dark);
      boot.position.set(0, -0.32, 0.03);
      g.add(leg, boot);
      return g;
    };
    this.legL = makeLeg(-0.12);
    this.legR = makeLeg(0.12);

    // Туловище
    this.torso.position.y = 0.36;
    const body = new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(0.26, 0.24, 6, 12)), suit);
    body.position.y = 0.25;
    const belt = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.255, 0.03, 6, 20)), opts.npc ? dark : accent);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.1;
    this.torso.add(body, belt);

    if (mascot) {
      // Маскот: светлый живот вместо рюкзака, хвост сзади.
      const belly = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.2, 16, 12)), white);
      belly.scale.set(1, 1.1, 0.5);
      belly.position.set(0, 0.24, 0.16);
      this.torso.add(belly);
      if (skin.tail) {
        const tail = buildTail(skin.tail, suitColor, this.kit);
        tail.position.set(0, 0.05, -0.26);
        this.torso.add(tail);
      }
    } else if (!opts.npc) {
      const pack = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.34, 0.36, 0.16)), white);
      pack.position.set(0, 0.3, -0.27);
      const light = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.2, 0.04, 0.02)), accent);
      light.position.set(0, 0.36, -0.36);
      const patch = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.07, 16)), accent);
      patch.position.set(0.12, 0.34, 0.255);
      this.torso.add(pack, light, patch);
    }

    // Руки (пивот в плече)
    const armGeo = this.geo(new THREE.CapsuleGeometry(0.07, 0.22, 4, 8));
    const gloveGeo = this.geo(new THREE.SphereGeometry(0.08, 10, 8));
    const makeArm = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.42, 0);
      const arm = new THREE.Mesh(armGeo, suit);
      arm.position.y = -0.15;
      const glove = new THREE.Mesh(gloveGeo, opts.npc || mascot ? white : dark);
      glove.position.y = -0.3;
      g.add(arm, glove);
      return g;
    };
    this.armL = makeArm(-0.33);
    this.armR = makeArm(0.33);
    this.torso.add(this.armL, this.armR);

    // Голова: шлем + визор, у NPC — лицо и шляпа
    const head = new THREE.Group();
    head.position.y = 0.66;
    if (opts.npc) {
      const face = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.22, 16, 12)), this.mat(new THREE.MeshStandardMaterial({ color: 0xe8c4a0 })));
      const eyeGeo = this.geo(new THREE.SphereGeometry(0.03, 8, 6));
      for (const dx of [-0.08, 0.08]) {
        const eye = new THREE.Mesh(eyeGeo, dark);
        eye.position.set(dx, 0.03, 0.2);
        face.add(eye);
      }
      const beard = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.14, 0.22, 10)), white);
      beard.rotation.x = Math.PI;
      beard.position.set(0, -0.16, 0.1);
      head.add(face, beard);
      if (opts.npc.hat !== undefined) {
        const hat = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.16, 0.22, 0.18, 14)), this.mat(new THREE.MeshStandardMaterial({ color: opts.npc.hat })));
        hat.position.y = 0.22;
        head.add(hat);
      }
    } else if (mascot) {
      head.add(buildMascotHead(skin.head, skin, suitColor, trimColor, this.kit));
      this.addHat(head, skin.hat, accent);
    } else {
      const helmet = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.28, 20, 16)), white);
      const glass = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.24, 20, 12, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.42)), visor);
      glass.position.z = 0.06;
      const ring = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.2, 0.035, 6, 20)), dark);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.22;
      const stalk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6)), dark);
      stalk.position.set(0.15, 0.3, -0.05);
      this.antennaTip = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.045, 10, 8)), accent);
      this.antennaTip.position.set(0.15, 0.43, -0.05);
      head.add(helmet, glass, ring, stalk, this.antennaTip);
      this.addHat(head, skin.hat, accent);
    }
    this.torso.add(head);

    this.model.add(this.legL, this.legR, this.torso);
    this.model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });

    this.label = makeLabel(name);
    this.label.position.y = 1.55;
    this.root.add(this.model, this.label);
  }

  private bubble?: THREE.Sprite;
  private bubbleLeft = 0;

  /** Стикер-облачко над головой (эмоция, лайк) на ms миллисекунд. */
  showBubble(text: string, ms = 2500) {
    if (!this.bubble) {
      this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      this.bubble.renderOrder = 11;
      this.bubble.position.y = 2.05;
      this.root.add(this.bubble);
    }
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 112, 96, 28);
    ctx.moveTo(52, 102);
    ctx.lineTo(64, 122);
    ctx.lineTo(76, 102);
    ctx.fill();
    ctx.font = '64px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
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

    let swing = 0;
    let armLift = 0;
    let bob = Math.sin(t * 2.2) * 0.012; // дыхание
    if (anim === 'run') {
      swing = Math.sin(t * 13) * 0.75;
      bob = Math.abs(Math.sin(t * 13)) * 0.05;
    } else if (anim === 'jump') {
      armLift = -2.4;
      swing = 0.35;
    } else if (anim === 'fall') {
      armLift = -1.6;
      swing = -0.25;
    }
    this.legL.rotation.x = swing;
    this.legR.rotation.x = anim === 'jump' ? -0.5 : -swing;
    this.armL.rotation.x = armLift ? armLift : -swing * 0.8;
    this.armR.rotation.x = armLift ? armLift : swing * 0.8;
    this.armL.rotation.z = armLift ? -0.3 : 0.08;
    this.armR.rotation.z = armLift ? 0.3 : -0.08;
    this.torso.position.y = 0.36 + bob;
    if (this.antennaTip) this.antennaTip.scale.setScalar(1 + Math.sin(t * 5) * 0.15);
    if (this.bubble?.visible) {
      this.bubbleLeft -= dt;
      const pop = Math.min(1, (2.5 - this.bubbleLeft) * 6);
      this.bubble.scale.setScalar(0.75 * Math.max(0.2, pop) * (this.bubbleLeft < 0.3 ? this.bubbleLeft / 0.3 : 1));
      this.bubble.position.y = 2.05 + Math.sin(t * 3) * 0.04;
      if (this.bubbleLeft <= 0) this.bubble.visible = false;
    }
  }

  setDimmed(dimmed: boolean) {
    for (const m of this.materials) {
      m.transparent = dimmed;
      m.opacity = dimmed ? 0.35 : 1;
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
    const gold = this.mat(new THREE.MeshStandardMaterial({ color: 0xffc94d, metalness: 0.9, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.4 }));
    const add = (m: THREE.Mesh, x: number, y: number, z = 0) => {
      m.position.set(x, y, z);
      m.castShadow = true;
      head.add(m);
      return m;
    };
    switch (hat) {
      case 'crown': {
        add(new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 16, 1, true)), gold), 0, 0.3);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          add(new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.04, 0.12, 6)), gold), Math.cos(a) * 0.16, 0.4, Math.sin(a) * 0.16);
        }
        break;
      }
      case 'wizard': {
        const cone = add(new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.2, 0.5, 16)), this.mat(new THREE.MeshStandardMaterial({ color: 0x2a1a6a }))), 0, 0.5);
        cone.rotation.z = -0.15;
        add(new THREE.Mesh(this.geo(new THREE.OctahedronGeometry(0.06)), accent), 0.06, 0.62, 0.1);
        break;
      }
      case 'cap': {
        add(new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), accent), 0, 0.22);
        add(new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.22, 0.03, 0.18)), accent), 0, 0.23, 0.2);
        break;
      }
      case 'halo': {
        const ring = add(new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.2, 0.025, 8, 28)), accent), 0, 0.48);
        ring.rotation.x = Math.PI / 2;
        break;
      }
      case 'antlers': {
        const wood = this.mat(new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));
        for (const sx of [-1, 1]) {
          const main = add(new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.02, 0.03, 0.32, 6)), wood), sx * 0.14, 0.38);
          main.rotation.z = -sx * 0.5;
          const tine = add(new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.015, 0.02, 0.16, 6)), wood), sx * 0.2, 0.44);
          tine.rotation.z = sx * 0.6;
        }
        break;
      }
    }
  }

  /** Доступ билдеров маскотов к учёту материалов/геометрий (для dispose). */
  private kit = {
    mat: (m: THREE.Material) => this.mat(m),
    geo: <T extends THREE.BufferGeometry>(g: T) => this.geo(g),
  };

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }
}

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(14,20,34,0.78)';
  ctx.strokeStyle = 'rgba(127,216,255,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(4, 8, 312, 48, 24);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e8f6ff';
  ctx.font = 'bold 28px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 33, 296);
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
