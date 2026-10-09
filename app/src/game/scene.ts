import * as THREE from "three";
import { TEX } from "./textures";
import { Character, makeSword } from "./character";
import { MAP_H, MAP_W, charAt, lineOfSight } from "../lib/map";
import { VISION_R2 } from "../lib/config";

const mat = (map: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ map, ...extra });

/** Builds instanced block meshes for the static map. */
function buildTerrain(scene: THREE.Scene) {
  const box = new THREE.BoxGeometry(1, 1, 1);
  const grass = [TEX.grassSide(), TEX.grassSide(), TEX.grassTop(), TEX.dirt(), TEX.grassSide(), TEX.grassSide()].map((t) => mat(t));
  const cobble = mat(TEX.cobble());
  const log = [TEX.logSide(), TEX.logSide(), TEX.logTop(), TEX.logTop(), TEX.logSide(), TEX.logSide()].map((t) => mat(t));
  const leaves = mat(TEX.leaves(), { alphaTest: 0.5, side: THREE.DoubleSide });
  const water = new THREE.MeshLambertMaterial({ map: TEX.water(), transparent: true, opacity: 0.82 });
  const dirt = mat(TEX.dirt());

  const cells = { grass: [] as THREE.Vector3[], cobble: [] as THREE.Vector3[], log: [] as THREE.Vector3[], leaves: [] as THREE.Vector3[], water: [] as THREE.Vector3[], dirt: [] as THREE.Vector3[] };
  const tall: THREE.Vector3[] = [];
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const c = charAt(x, y);
      if (c === "~") {
        cells.water.push(new THREE.Vector3(x, -0.62, y));
        cells.dirt.push(new THREE.Vector3(x, -1.5, y));
      } else cells.grass.push(new THREE.Vector3(x, -0.5, y));
      if (c === "#") {
        cells.cobble.push(new THREE.Vector3(x, 0.5, y), new THREE.Vector3(x, 1.5, y));
      } else if (c === "T") {
        cells.log.push(new THREE.Vector3(x, 0.5, y), new THREE.Vector3(x, 1.5, y));
        cells.leaves.push(new THREE.Vector3(x, 2.5, y));
      } else if (c === '"') tall.push(new THREE.Vector3(x, 0, y));
    }

  const instanced = (list: THREE.Vector3[], material: THREE.Material | THREE.Material[], scale = 1, shadows = true) => {
    const mesh = new THREE.InstancedMesh(box, material, list.length);
    const m = new THREE.Matrix4();
    list.forEach((p, i) => mesh.setMatrixAt(i, m.compose(p, new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale))));
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  instanced(cells.grass, grass, 1, false);
  instanced(cells.dirt, dirt, 1, false);
  instanced(cells.water, water, 1, false);
  instanced(cells.cobble, cobble);
  instanced(cells.log, log);
  instanced(cells.leaves, leaves, 1.1);

  // Tall grass: two crossed quads per tile.
  const quad = new THREE.PlaneGeometry(1, 1);
  const grassMat = new THREE.MeshLambertMaterial({ map: TEX.tallGrass(), alphaTest: 0.4, side: THREE.DoubleSide });
  const tallMesh = new THREE.InstancedMesh(quad, grassMat, tall.length * 4);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const p of tall)
    for (const [ox, oz] of [
      [-0.2, -0.2],
      [0.2, 0.2],
    ])
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        tallMesh.setMatrixAt(
          i++,
          m.compose(
            new THREE.Vector3(p.x + ox, 0.45, p.z + oz),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)),
            new THREE.Vector3(0.9, 0.9, 0.9),
          ),
        );
      }
  scene.add(tallMesh);
}

function buildSky(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x05070f);
  scene.fog = new THREE.Fog(0x05070f, 14, 34);
  const starGeo = new THREE.BufferGeometry();
  const pts: number[] = [];
  for (let i = 0; i < 700; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.random() * Math.PI * 0.45;
    const r = 60;
    pts.push(12 + r * Math.cos(th) * Math.sin(ph), 10 + r * Math.cos(ph), 12 + r * Math.sin(th) * Math.sin(ph));
  }
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, fog: false }));
  scene.add(stars);
  // Square moon, of course.
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ color: 0xeef2ff, fog: false }));
  moon.position.set(-14, 34, -30);
  moon.lookAt(12, 0, 12);
  scene.add(moon);
}

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

export class ArenaScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  private torch = new THREE.PointLight(0xffb060, 30, 9, 1.6);
  private fogTex: THREE.DataTexture;
  private fogData = new Uint8Array(MAP_W * MAP_H * 4);
  private fogPlane: THREE.Mesh;
  private fogTop: THREE.Mesh;
  private border: THREE.Mesh[] = [];
  private borderTex = TEX.border().clone();
  private zoneShown = 12;
  zoneTarget = 12;
  private chests = new Map<string, THREE.Group>();
  private particles: Particle[] = [];
  private arrows: { mesh: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t: number }[] = [];
  private camTarget = new THREE.Vector3(12, 0, 12);
  private clock = new THREE.Clock();
  readonly characters = new Map<number, Character>();
  /** When set, the camera follows this tile position. */
  follow: THREE.Vector2 | null = null;
  /** When true (spectators, end screen), no fog is drawn. */
  fullReveal = false;
  private orbit = 0;
  onFrame: (dt: number, t: number) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    buildSky(this.scene);
    buildTerrain(this.scene);

    this.scene.add(new THREE.AmbientLight(0x6070a0, 0.32));
    const moonLight = new THREE.DirectionalLight(0x9fb0ff, 0.4);
    moonLight.position.set(-8, 20, -6);
    moonLight.target.position.set(12, 0, 12);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(1024, 1024);
    Object.assign(moonLight.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
    this.scene.add(moonLight, moonLight.target);
    this.torch.position.set(12, 1.6, 12);
    this.scene.add(this.torch);

    // Fog of war: a soft alpha texture over the ground and over the wall tops.
    this.fogTex = new THREE.DataTexture(this.fogData, MAP_W, MAP_H, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    const fogMat = new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false, fog: false });
    this.fogPlane = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), fogMat);
    this.fogPlane.rotation.x = -Math.PI / 2;
    this.fogPlane.position.set(MAP_W / 2 - 0.5, 0.04, MAP_H / 2 - 0.5);
    this.fogPlane.renderOrder = 5;
    this.fogTop = this.fogPlane.clone();
    this.fogTop.position.y = 2.06;
    this.scene.add(this.fogPlane, this.fogTop);

    // World border: four shimmering walls.
    this.borderTex.wrapS = this.borderTex.wrapT = THREE.RepeatWrapping;
    const borderMat = new THREE.MeshBasicMaterial({ map: this.borderTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.85, fog: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 4; i++) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 4), borderMat);
      this.border.push(wall);
      this.scene.add(wall);
    }
    this.layoutBorder(12);

    this.resize();
    window.addEventListener("resize", this.resize);
    this.renderer.setAnimationLoop(this.frame);
  }

  private resize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 70 : 50;
    this.camera.updateProjectionMatrix();
  };

  private layoutBorder(z: number) {
    const lo = 11.5 - z;
    const hi = 11.5 + z;
    const len = hi - lo;
    const mid = (lo + hi) / 2;
    const [n, s, e, w] = this.border;
    n.position.set(mid, 1.5, lo);
    s.position.set(mid, 1.5, hi);
    e.position.set(hi, 1.5, mid);
    w.position.set(lo, 1.5, mid);
    e.rotation.y = w.rotation.y = Math.PI / 2;
    for (const b of this.border) {
      b.scale.x = len;
      b.visible = z < 12;
    }
    this.borderTex.repeat.set(len, 4);
  }

  /** Recompute the cosmetic fog from my own position — the same rule the program uses. */
  setViewer(x: number, y: number, alive: boolean) {
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) {
        const dx = tx - x;
        const dy = ty - y;
        const d2 = dx * dx + dy * dy;
        let a = 228;
        if (this.fullReveal) a = 0;
        else if (alive && d2 <= VISION_R2 && lineOfSight(x, y, tx, ty)) a = Math.min(80, d2 * 3);
        else if (alive && d2 <= VISION_R2 + 6) a = 190;
        // Texture row 0 is v = 0, which the -90° X rotation puts at the south edge (y = 23).
        const j = ((MAP_H - 1 - ty) * MAP_W + tx) * 4;
        this.fogData[j] = 2;
        this.fogData[j + 1] = 3;
        this.fogData[j + 2] = 10;
        this.fogData[j + 3] = a;
      }
    this.fogTex.needsUpdate = true;
    this.fogTop.visible = !this.fullReveal;
  }

  clearFog() {
    this.fullReveal = true;
    this.fogData.fill(0);
    this.fogTex.needsUpdate = true;
  }

  setTorch(x: number, y: number, on: boolean) {
    this.torch.position.set(x, 1.6, y);
    this.torch.intensity = on ? 30 : 0;
  }

  // ───────────── chests ─────────────

  setChests(list: { x: number; y: number; kind: number }[]) {
    const keep = new Set(list.map((c) => `${c.x},${c.y}`));
    for (const [k, g] of this.chests)
      if (!keep.has(k)) {
        this.burst(g.position.x, 0.5, g.position.z, 0xffe080, 10);
        g.removeFromParent();
        this.chests.delete(k);
      }
    for (const c of list) {
      const k = `${c.x},${c.y}`;
      if (this.chests.has(k)) continue;
      const g = new THREE.Group();
      const side = mat(TEX.chestSide());
      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.8), [side, side, side, side, mat(TEX.chestFront()), side]);
      chest.position.y = 0.35;
      chest.castShadow = true;
      g.add(chest);
      // Faint glow so loot reads at night.
      const glow = new THREE.PointLight(c.kind === 1 ? 0x40fff0 : c.kind === 2 ? 0xffd040 : 0xffffff, 3, 2.5);
      glow.position.y = 1;
      g.add(glow);
      g.position.set(c.x, 0, c.y);
      this.scene.add(g);
      this.chests.set(k, g);
    }
  }

  // ───────────── effects ─────────────

  burst(x: number, y: number, z: number, color: number, n = 12) {
    const geo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const m = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.particles.push({ mesh, vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3), life: 0.7 + Math.random() * 0.4 });
    }
  }

  arrow(x0: number, y0: number, x1: number, y1: number) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshLambertMaterial({ color: 0x8a6a3a }));
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.1), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    tip.position.z = 0.32;
    g.add(shaft, tip);
    const from = new THREE.Vector3(x0, 0.7, y0);
    const to = new THREE.Vector3(x1, 0.7, y1);
    g.position.copy(from);
    g.lookAt(to);
    this.scene.add(g);
    this.arrows.push({ mesh: g, from, to, t: 0 });
  }

  /** A sword hovering over the arena for the menu screens. */
  showcaseSword() {
    const s = makeSword(true);
    s.scale.setScalar(6);
    s.position.set(12, 3.5, 12);
    this.scene.add(s);
    return s;
  }

  private frame = () => {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    this.onFrame(dt, t);
    for (const c of this.characters.values()) c.update(dt, t);

    this.zoneShown += (this.zoneTarget - this.zoneShown) * (1 - Math.exp(-dt * 2));
    this.layoutBorder(this.zoneShown);
    this.borderTex.offset.y = (t * 0.4) % 1;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vel.y -= 9 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.life <= 0) {
        p.mesh.removeFromParent();
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.t += dt * 3.5;
      a.mesh.position.lerpVectors(a.from, a.to, Math.min(1, a.t));
      if (a.t >= 1.6) {
        a.mesh.removeFromParent();
        this.arrows.splice(i, 1);
      }
    }
    for (const g of this.chests.values()) g.children[0].position.y = 0.35 + Math.sin(t * 2 + g.position.x) * 0.03;

    if (this.follow) {
      this.camTarget.lerp(new THREE.Vector3(this.follow.x, 0, this.follow.y), 1 - Math.exp(-dt * 8));
      const portrait = this.camera.aspect < 1;
      this.camera.position.set(this.camTarget.x, portrait ? 13 : 10, this.camTarget.z + (portrait ? 7 : 7.5));
      this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z + 0.3);
    } else {
      this.orbit += dt * 0.06;
      const r = this.camera.aspect < 1 ? 26 : 19;
      this.camera.position.set(11.5 + Math.cos(this.orbit) * r, 15, 11.5 + Math.sin(this.orbit) * r);
      this.camera.lookAt(11.5, 0, 11.5);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
