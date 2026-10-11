import * as THREE from "three";
import { px, rng } from "./textures";

export interface Skin {
  name: string;
  tone: string;
  hair: string;
  eyes: string;
  shirt: string;
  accent: string;
  pants: string;
  shoes: string;
  hood?: string;
  helmet?: string;
  glowEyes?: boolean;
}

/** Six original blocky heroes. */
export const SKINS: Skin[] = [
  { name: "Ember", tone: "#e0a77a", hair: "#a3361c", eyes: "#3a2a1a", shirt: "#d4621f", accent: "#7a2e10", pants: "#3b3b52", shoes: "#2a2020" },
  { name: "Moss", tone: "#c98f62", hair: "#4a3020", eyes: "#2d5a1e", shirt: "#3f7d2a", accent: "#7a5a34", pants: "#5a4a2e", shoes: "#3a2a1a", hood: "#2e5d1f" },
  { name: "Frost", tone: "#f0c9a8", hair: "#e8f2ff", eyes: "#3a7fd0", shirt: "#7fb7e8", accent: "#ffffff", pants: "#34507a", shoes: "#d8e4f0" },
  { name: "Gilded", tone: "#d39a6a", hair: "#2a1a10", eyes: "#2a1a10", shirt: "#e8b730", accent: "#a87a10", pants: "#8a8a8a", shoes: "#4a4a4a", helmet: "#f0c840" },
  { name: "Shade", tone: "#8a7a9a", hair: "#1a1024", eyes: "#c040ff", shirt: "#3a2450", accent: "#7a40b0", pants: "#1e1630", shoes: "#0e0a18", hood: "#2a1a3c", glowEyes: true },
  { name: "Rose", tone: "#f2b896", hair: "#6a3a1e", eyes: "#4a2a5a", shirt: "#e87aa8", accent: "#ffffff", pants: "#6a3a7a", shoes: "#3a1a3a" },
];

/** Cosmetics are packed into the onchain skin byte: base + 6·hat + 30·cape (max 209). */
export const HATS = ["No hat", "Crown", "Horns", "Halo", "Wizard Hat"];
export const CAPES: { name: string; color: string | null }[] = [
  { name: "No cape", color: null },
  { name: "Crimson cape", color: "#b02a2a" },
  { name: "Royal cape", color: "#2a4ab0" },
  { name: "Forest cape", color: "#2a7a3a" },
  { name: "Golden cape", color: "#d8a820" },
  { name: "Void cape", color: "#5a2a90" },
  { name: "Shadow cape", color: "#1a1a22" },
];
export const packLook = (base: number, hat: number, cape: number) => (base % 6) + 6 * (hat % HATS.length) + 30 * (cape % CAPES.length);
export const unpackLook = (skin: number) => ({ base: skin % 6, hat: Math.floor(skin / 6) % HATS.length, cape: Math.floor(skin / 30) % CAPES.length });

type Face = "px" | "nx" | "py" | "ny" | "pz" | "nz";
const FACES: Face[] = ["px", "nx", "py", "ny", "pz", "nz"];
type Part = "head" | "body" | "armR" | "armL" | "legR" | "legL";

const faceSize = (part: Part, face: Face): [number, number] => {
  const dims: Record<string, [number, number, number]> = {
    head: [8, 8, 8],
    body: [8, 12, 4],
    armR: [4, 12, 4],
    armL: [4, 12, 4],
    legR: [4, 12, 4],
    legL: [4, 12, 4],
  };
  const [w, h, d] = dims[part];
  if (face === "px" || face === "nx") return [d, h];
  if (face === "py" || face === "ny") return [w, d];
  return [w, h];
};

const vary = (hex: string, r: () => number, amt = 0.05) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, (r() - 0.5) * amt * 2);
  return `#${c.getHexString()}`;
};

function paintFace(ctx: CanvasRenderingContext2D, s: Skin, part: Part, face: Face, w: number, h: number) {
  const r = rng(part.length * 31 + face.charCodeAt(1) * 7 + s.name.length);
  const fill = (col: string, x = 0, y = 0, ww = w, hh = h) => {
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + ww; xx++) px(ctx, xx, yy, vary(col, r));
  };
  if (part === "head") {
    const cap = s.helmet ?? s.hood ?? s.hair;
    fill(s.tone);
    if (face === "py") return fill(cap);
    if (face === "ny") return fill(s.tone);
    if (face === "nz") return fill(cap, 0, 0, w, s.hood || s.helmet ? 8 : 7);
    if (face === "px" || face === "nx") {
      fill(cap, 0, 0, w, s.helmet ? 4 : 3);
      if (s.hood) fill(s.hood, face === "px" ? 0 : w - 3, 0, 3, h);
      if (s.helmet) fill(s.helmet, face === "px" ? 0 : w - 2, 0, 2, 7);
      return;
    }
    // Front face.
    fill(cap, 0, 0, w, s.helmet ? 3 : 2);
    if (s.hood) {
      fill(s.hood, 0, 0, 1, h);
      fill(s.hood, w - 1, 0, 1, h);
    }
    if (s.helmet) {
      fill(s.helmet, 0, 0, 1, 6);
      fill(s.helmet, w - 1, 0, 1, 6);
      px(ctx, 3, 2, s.helmet, 2, 3);
    }
    const eye = s.glowEyes ? s.eyes : "#ffffff";
    px(ctx, 1, 4, eye, 2, 1);
    px(ctx, 5, 4, eye, 2, 1);
    if (!s.glowEyes) {
      px(ctx, 2, 4, s.eyes);
      px(ctx, 5, 4, s.eyes);
    }
    px(ctx, 3, 6, vary(s.tone, r, 0.12), 2, 1);
    px(ctx, 3, 5, vary(s.tone, r, 0.18), 2, 1);
    return;
  }
  if (part === "body") {
    fill(s.shirt);
    if (face === "py" || face === "ny") return;
    px(ctx, 0, 9, s.accent, w, 1);
    if (face === "pz") {
      px(ctx, 3, 0, s.accent, 2, 2);
      if (s.hood) fill(s.hood, 1, 0, 6, 1);
      if (s.helmet) {
        fill(s.helmet, 0, 0, w, 4);
        px(ctx, 3, 5, s.accent, 2, 3);
      }
    }
    return;
  }
  if (part === "armR" || part === "armL") {
    fill(s.tone);
    if (face === "ny") return;
    if (face === "py") return fill(s.shirt);
    fill(s.shirt, 0, 0, w, 5);
    if (s.helmet) fill(s.helmet, 0, 0, w, 3);
    return;
  }
  // Legs.
  fill(s.pants);
  if (face === "ny") return fill(s.shoes);
  if (face === "py") return;
  fill(s.shoes, 0, h - 2, w, 2);
}

const skinMaterials = new Map<string, THREE.MeshLambertMaterial[]>();
const materialsFor = (skinIdx: number, part: Part) => {
  const key = `${skinIdx}-${part}`;
  const hit = skinMaterials.get(key);
  if (hit) return hit;
  const s = SKINS[skinIdx % SKINS.length];
  const mats = FACES.map((face) => {
    const [w, h] = faceSize(part, face);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    paintFace(ctx, s, part, face, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color(0x000000) });
  });
  skinMaterials.set(key, mats);
  return mats;
};

const U = 1 / 30;

const nameTag = (name: string, color: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 34px 'Silkscreen', monospace";
  const w = Math.min(250, ctx.measureText(name).width + 24);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(128 - w / 2, 8, w, 48);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.2, 0.3, 1);
  sprite.renderOrder = 10;
  return sprite;
};

const voxelItem = (rows: string[], palette: Record<string, string>, scale = U * 0.9) => {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(scale, scale, scale * 1.2);
  const mats = new Map<string, THREE.MeshLambertMaterial>();
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === " " || !palette[ch]) return;
      let m = mats.get(ch);
      if (!m) {
        m = new THREE.MeshLambertMaterial({ color: palette[ch] });
        mats.set(ch, m);
      }
      const cube = new THREE.Mesh(geo, m);
      cube.position.set((x - row.length / 2) * scale, (rows.length - y) * scale, 0);
      group.add(cube);
    }),
  );
  return group;
};

const SWORD_ROWS = ["        BE", "       BEB", "      BEB ", "     BEB  ", "    BEB   ", "HH BEB    ", " HHEB     ", "  HH      ", " H HH     ", "H         "];
export const makeSword = (diamond: boolean) =>
  voxelItem(SWORD_ROWS, diamond ? { B: "#2fc6c0", E: "#9ef5f0", H: "#5a3a16" } : { B: "#9c7a48", E: "#c9a46a", H: "#4a3520" });
const AXE_ROWS = ["   SSS", "  SSSS", "  SSSH", "   SH ", "    H ", "   H  ", "  H   ", " H    ", "H     "];
const HAMMER_ROWS = [" GGGG", " GDDG", " GGGG", "   H ", "  H  ", "  H  ", " H   ", " H   ", "H    "];
const SPEAR_ROWS = ["       W", "      WS", "     SW ", "    H   ", "   H    ", "  H     ", " H      ", "H       "];
export const makeAxe = () => voxelItem(AXE_ROWS, { S: "#c9d4dc", H: "#6b4d2c" });
export const makeHammer = () => voxelItem(HAMMER_ROWS, { G: "#8a8f99", D: "#5a5f69", H: "#6b4d2c" });
export const makeSpear = () => voxelItem(SPEAR_ROWS, { W: "#ffffff", S: "#dfe7ef", H: "#8a6a3a" });
export const makeBow = () =>
  voxelItem(["   WW", "  W S", " W  S", "W   S", "W   S", " W  S", "  W S", "   WW"], { W: "#7a5a34", S: "#e0e0e0" });

export class Character {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head: THREE.Mesh;
  private armR: THREE.Group;
  private armL: THREE.Group;
  private legR: THREE.Group;
  private legL: THREE.Group;
  private weapons: THREE.Group[] = [];
  private bow: THREE.Group;
  private tag: THREE.Sprite | null = null;
  private walkPhase = 0;
  private swingT = 1;
  private bowT = 1;
  private hurtT = 1;
  private deadT = -1;
  private mats: THREE.MeshLambertMaterial[] = [];
  /** Smoothed world position (tiles). */
  pos = new THREE.Vector2();
  target = new THREE.Vector2();
  facing = 2;
  private yaw = 0;

  constructor(readonly skin: number, name?: string, tagColor = "#ffffff") {
    const box = (w: number, h: number, d: number, part: Part) => {
      // Per-character clones (textures stay shared) so a hurt flash only tints this one.
      const m = materialsFor(skin, part).map((x) => x.clone());
      this.mats.push(...m);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * U, h * U, d * U), m);
      mesh.castShadow = true;
      return mesh;
    };
    const limb = (part: Part, x: number, y: number) => {
      const g = new THREE.Group();
      const mesh = box(4, 12, 4, part);
      mesh.position.y = -6 * U;
      g.add(mesh);
      g.position.set(x * U, y * U, 0);
      return g;
    };
    this.legR = limb("legR", -2, 12);
    this.legL = limb("legL", 2, 12);
    const torso = box(8, 12, 4, "body");
    torso.position.y = 18 * U;
    this.armR = limb("armR", -6, 24);
    this.armL = limb("armL", 6, 24);
    this.head = box(8, 8, 8, "head");
    this.head.position.y = 28 * U;
    this.body.add(this.legR, this.legL, torso, this.armR, this.armL, this.head);

    // Index = weapon id: 1 wooden sword, 2 diamond sword, 3 axe, 4 hammer, 5 spear.
    this.weapons = [new THREE.Group(), makeSword(false), makeSword(true), makeAxe(), makeHammer(), makeSpear()];
    for (const w of this.weapons) {
      w.position.set(0, -12 * U, 3 * U);
      w.rotation.set(-Math.PI / 2, Math.PI / 2, 0);
      w.visible = false;
      this.armR.add(w);
    }
    this.weapons[1].visible = true;
    this.addCosmetics(unpackLook(skin));
    this.bow = makeBow();
    this.bow.position.set(0, -12 * U, 2 * U);
    this.bow.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    this.bow.visible = false;
    this.armL.add(this.bow);

    this.root.userData.character = this;
    this.root.add(this.body);
    // Characters read better a touch larger than one block wide.
    this.body.scale.setScalar(1.3);
    if (name) {
      this.tag = nameTag(name, tagColor);
      this.tag.position.y = 1.65;
      this.root.add(this.tag);
    }
  }

  /** A soft coloured ring on the ground: yellow for you, red for enemies. */
  setRing(color: number) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.46, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, fog: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    this.root.add(ring);
  }

  setTagScale(k: number) {
    this.tag?.scale.set(1.2 * k, 0.3 * k, 1);
    if (this.tag) this.tag.position.y = 1.65 + 0.3 * (k - 1);
  }

  setWeapon(weapon: number) {
    const w = weapon >= 1 && weapon < this.weapons.length ? weapon : 1;
    this.weapons.forEach((g, i) => (g.visible = i === w));
  }

  /** Fade for the Cloak power (only you ever see yourself cloaked). */
  setGhost(on: boolean) {
    for (const m of this.mats) {
      m.transparent = on;
      m.opacity = on ? 0.35 : 1;
    }
  }

  private addCosmetics({ hat, cape }: { hat: number; cape: number }) {
    const box = (w: number, h: number, d: number, color: string, emissive = 0) => {
      const m = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(emissive) });
      this.mats.push(m);
      return new THREE.Mesh(new THREE.BoxGeometry(w * U, h * U, d * U), m);
    };
    const top = 32 * U;
    if (hat === 1) {
      // Crown: a gold band with four points.
      const band = box(9, 2, 9, "#f0c840");
      band.position.y = top + U;
      this.body.add(band);
      for (const [x, z] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) {
        const p = box(2, 2, 2, "#ffd84a");
        p.position.set(x * U, top + 3 * U, z * U);
        this.body.add(p);
      }
      const gem = box(1.6, 1.6, 0.6, "#e0304a", 0x400010);
      gem.position.set(0, top + U, 4.6 * U);
      this.body.add(gem);
    } else if (hat === 2) {
      for (const side of [-1, 1]) {
        const a = box(2, 3, 2, "#e8e0d0");
        a.position.set(side * 4.5 * U, top + 0.5 * U, 0);
        const b = box(2, 2, 2, "#c8c0b0");
        b.position.set(side * 5.5 * U, top + 3 * U, 0);
        this.body.add(a, b);
      }
    } else if (hat === 3) {
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(4.5 * U, 0.7 * U, 6, 16),
        new THREE.MeshBasicMaterial({ color: 0xfff2a0 }),
      );
      halo.rotation.x = Math.PI / 2;
      halo.position.y = top + 3.5 * U;
      this.body.add(halo);
    } else if (hat === 4) {
      const brim = box(12, 1, 12, "#3a2a7a");
      brim.position.y = top + 0.5 * U;
      const cone1 = box(7, 4, 7, "#4a3a9a");
      cone1.position.y = top + 3 * U;
      const cone2 = box(4, 4, 4, "#5a4aaa");
      cone2.position.set(U, top + 7 * U, -U);
      const star = box(1.5, 1.5, 0.5, "#ffe060", 0x403000);
      star.position.set(0, top + 3 * U, 3.6 * U);
      this.body.add(brim, cone1, cone2, star);
    }
    const capeColor = CAPES[cape]?.color;
    if (capeColor) {
      const c = box(8, 14, 1, capeColor);
      c.position.set(0, 18 * U, -2.6 * U);
      c.rotation.x = 0.12;
      this.body.add(c);
    }
  }

  swing() {
    this.swingT = 0;
  }

  shoot() {
    this.bowT = 0;
  }

  hurt() {
    this.hurtT = 0;
  }

  die() {
    if (this.deadT < 0) this.deadT = 0;
  }

  get dead() {
    return this.deadT >= 0;
  }

  /** Snap immediately (used on spawn). */
  place(x: number, y: number, facing: number) {
    this.pos.set(x, y);
    this.target.set(x, y);
    this.facing = facing;
    this.yaw = Character.yawFor(facing);
    this.sync();
  }

  static yawFor(facing: number) {
    return [Math.PI, Math.PI / 2, 0, -Math.PI / 2][facing % 4];
  }

  private sync() {
    this.root.position.set(this.pos.x, 0, this.pos.y);
    this.body.rotation.y = this.yaw;
  }

  update(dt: number, t: number) {
    const before = this.pos.clone();
    this.pos.lerp(this.target, 1 - Math.exp(-dt * 16));
    if (this.pos.distanceTo(this.target) < 0.01) this.pos.copy(this.target);
    const moving = before.distanceTo(this.pos) > 0.002;
    // Shortest-path yaw interpolation.
    const want = Character.yawFor(this.facing);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-dt * 18));
    this.sync();

    this.walkPhase = moving ? this.walkPhase + dt * 14 : this.walkPhase * 0.85;
    const swingAmp = moving ? 0.7 : 0;
    const w = Math.sin(this.walkPhase) * swingAmp;
    this.legR.rotation.x = w;
    this.legL.rotation.x = -w;
    this.armL.rotation.x = -w * 0.8;
    this.armR.rotation.x = w * 0.8;
    // Idle breathing.
    this.armR.rotation.z = Math.sin(t * 2) * 0.03;
    this.armL.rotation.z = -Math.sin(t * 2) * 0.03;

    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt * 4.5);
      const k = Math.sin(this.swingT * Math.PI);
      this.armR.rotation.x = -1.9 * k;
      this.armR.rotation.y = 0.5 * k;
    } else this.armR.rotation.y = 0;
    this.bow.visible = this.bowT < 1;
    if (this.bowT < 1) {
      this.bowT = Math.min(1, this.bowT + dt * 2.2);
      this.armL.rotation.x = -Math.PI / 2;
      this.armR.rotation.x = -Math.PI / 2 + 0.3;
    }
    const red = this.hurtT < 1 ? 0.6 * (1 - this.hurtT) : 0;
    if (this.hurtT < 1) this.hurtT = Math.min(1, this.hurtT + dt * 3);
    for (const m of this.mats) m.emissive.setRGB(red, 0, 0);

    if (this.deadT >= 0 && this.deadT < 1) {
      this.deadT = Math.min(1, this.deadT + dt * 2);
      this.body.rotation.z = (Math.PI / 2) * this.deadT;
      this.body.position.y = 0.1 * this.deadT;
      for (const m of this.mats) m.emissive.setRGB(0.7, 0, 0);
    }
    this.head.rotation.y = Math.sin(t * 0.7 + this.skin) * 0.08;
  }

  dispose() {
    this.root.removeFromParent();
  }
}
