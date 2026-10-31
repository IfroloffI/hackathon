import * as THREE from 'three';

export interface CharacterOptions {
  /** NPC-рассказчик: без антенны и рюкзака, в одежде эпохи. */
  npc?: { robe: number; hat?: number };
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

  constructor(name: string, color: number, opts: CharacterOptions = {}) {
    this.name = name;
    const suitColor = opts.npc?.robe ?? color;
    const suit = this.mat(new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.7 }));
    const white = this.mat(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }));
    const dark = this.mat(new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.6 }));
    const visor = this.mat(
      new THREE.MeshStandardMaterial({ color: 0x1b2a4a, metalness: 0.9, roughness: 0.15, emissive: 0x223a6a, emissiveIntensity: 0.4 }),
    );
    const accent = this.mat(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }));

    // Ноги (пивот в бедре)
    const legGeo = this.geo(new THREE.CapsuleGeometry(0.09, 0.2, 4, 8));
    const bootGeo = this.geo(new THREE.BoxGeometry(0.17, 0.09, 0.24));
    const makeLeg = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.36, 0);
      const leg = new THREE.Mesh(legGeo, opts.npc ? suit : white);
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

    if (!opts.npc) {
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
      const glove = new THREE.Mesh(gloveGeo, opts.npc ? white : dark);
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
  }

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
