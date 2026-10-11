import * as THREE from "three";
import { TEX, THEMES, themeTextures } from "./textures";
import { Character, makeSword } from "./character";
import { MAP_H, MAP_W, charAt, lineOfSight, mapId as currentMapId, setMap } from "../lib/map";
import { DAY_R2, VISION_R2 } from "../lib/config";

const mat = (map: THREE.Texture, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ map, ...extra });

/** Builds instanced block meshes for the static map, in the given arena theme. */
function buildTerrain(theme: number) {
  const scene = new THREE.Group();
  const t = themeTextures(theme);
  const glow = THEMES[theme].liquidGlow;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const grass = [t.side, t.side, t.top, t.dirt, t.side, t.side].map((x) => mat(x));
  const cobble = mat(t.wall);
  const log = [t.logSide, t.logSide, t.logTop, t.logTop, t.logSide, t.logSide].map((x) => mat(x));
  const leaves = mat(t.leaves, { alphaTest: 0.5, side: THREE.DoubleSide });
  const water = glow
    ? new THREE.MeshBasicMaterial({ map: t.liquid })
    : new THREE.MeshLambertMaterial({ map: t.liquid, transparent: true, opacity: 0.85 });
  const dirt = mat(t.dirt);

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
        // Edge trees are short bushes so they frame the arena without hiding the players.
        const edge = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
        if (edge) cells.leaves.push(new THREE.Vector3(x, 0.55, y));
        else {
          cells.log.push(new THREE.Vector3(x, 0.5, y), new THREE.Vector3(x, 1.5, y));
          cells.leaves.push(new THREE.Vector3(x, 2.5, y));
        }
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
  const grassMat = new THREE.MeshLambertMaterial({ map: t.plant, alphaTest: 0.4, side: THREE.DoubleSide });
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
  // Lava glows: a few warm lights over the pools.
  if (glow) {
    const pools = new Map<string, THREE.Vector3>();
    for (const w of cells.water) pools.set(`${Math.floor(w.x / 6)},${Math.floor(w.z / 6)}`, w);
    for (const w of [...pools.values()].slice(0, 6)) {
      const l = new THREE.PointLight(0xff6a20, 6, 5, 1.5);
      l.position.set(w.x, 0.6, w.z);
      scene.add(l);
    }
  }
  return scene;
}

function buildSky(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x05070f);
  scene.fog = new THREE.Fog(0x05070f, 16, 40);
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
  return { stars, moon };
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
  private terrain: THREE.Group | null = null;
  private ambient = new THREE.AmbientLight(0x6070a0, 0.32);
  private moonLight = new THREE.DirectionalLight(0x9fb0ff, 0.4);
  theme = 0;
  private sky: { stars: THREE.Points; moon: THREE.Mesh } | null = null;
  /** Daylight arenas: bright sky, longer sight, lighter fog of war. */
  day = false;
  /** Vision radius² used for the cosmetic fog (bigger under a Flare). */
  viewR2 = VISION_R2;
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
  /** "lobby" frames the line-up of joined players up close. */
  cameraMode: "game" | "lobby" | "overview" | "hero" = "game";
  /** Title-screen framing: the hero stands here. */
  heroAt = new THREE.Vector2(11.5, 12);
  private props = new THREE.Group();
  private embers: { mesh: THREE.Mesh; vy: number; life: number }[] = [];
  private fireLight: THREE.PointLight | null = null;
  /** When true (spectators, end screen), no fog is drawn. */
  fullReveal = false;
  private orbit = 0;
  /** Tiles this player has ever had in view: drawn as remembered (dimmer) rather than unknown. */
  private explored = new Uint8Array(MAP_W * MAP_H);
  private freezeUntil = 0;
  private floaters: { sprite: THREE.Sprite; vy: number; life: number }[] = [];
  private heardArcs: THREE.Mesh[] = [];
  private guide: THREE.Mesh;
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private raycaster = new THREE.Raycaster();
  onFrame: (dt: number, t: number) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.sky = buildSky(this.scene);
    this.scene.add(this.ambient);
    const moonLight = this.moonLight;
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

    // Hearing compass: eight arcs around the player, lit for octants where someone unseen is close.
    const arcMat = new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.0, depthWrite: false, fog: false, side: THREE.DoubleSide });
    for (let k = 0; k < 8; k++) {
      // Octant 0 is north (-z). Ring angles run counter-clockwise from +x in the XY plane before rotation.
      const center = Math.PI / 2 - (k * Math.PI) / 4;
      const arc = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.45, 12, 1, center - Math.PI / 9, (Math.PI * 2) / 9), arcMat.clone());
      arc.rotation.x = -Math.PI / 2;
      arc.renderOrder = 6;
      this.heardArcs.push(arc);
      this.scene.add(arc);
    }
    // Guide arrow toward the safe zone.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.55);
    shape.lineTo(0.35, 0.05);
    shape.lineTo(0.12, 0.05);
    shape.lineTo(0.12, -0.45);
    shape.lineTo(-0.12, -0.45);
    shape.lineTo(-0.12, 0.05);
    shape.lineTo(-0.35, 0.05);
    shape.closePath();
    this.guide = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.9, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    );
    this.guide.rotation.x = -Math.PI / 2;
    this.guide.visible = false;
    this.guide.renderOrder = 7;
    this.scene.add(this.guide);

    this.setMap(currentMapId);
    this.resize();
    window.addEventListener("resize", this.resize);
    this.renderer.setAnimationLoop(this.frame);
  }

  /** Swap the arena: rebuild blocks, recolour sky, fog and light. */
  setMap(id: number) {
    setMap(id);
    if (this.terrain && this.theme === id) return;
    this.theme = id;
    this.terrain?.removeFromParent();
    this.terrain = buildTerrain(id);
    this.scene.add(this.terrain);
    this.applyLighting();
    this.explored.fill(0);
  }

  setDaylight(on: boolean) {
    this.day = on;
    this.viewR2 = on ? DAY_R2 : VISION_R2;
    this.applyLighting();
  }

  private applyLighting() {
    const th = THEMES[this.theme];
    const fog = this.scene.fog as THREE.Fog;
    if (this.sky) this.sky.stars.visible = this.sky.moon.visible = !this.day;
    if (this.day) {
      // Each theme keeps its mood by day: blue skies, pale frost, smoky red.
      const sky = [0x8cc8ff, 0xcfe6f7, 0xc0705a][this.theme] ?? 0x8cc8ff;
      (this.scene.background as THREE.Color).setHex(sky);
      fog.color.setHex(sky);
      fog.near = 22;
      fog.far = 60;
      this.ambient.color.setHex(0xffffff);
      this.ambient.intensity = 0.95;
      this.moonLight.color.setHex(0xfff2d8);
      this.moonLight.intensity = 1.35;
    } else {
      (this.scene.background as THREE.Color).setHex(th.sky);
      fog.color.setHex(th.fog);
      fog.near = 16;
      fog.far = 40;
      this.ambient.color.setHex(th.ambient[0]);
      this.ambient.intensity = th.ambient[1];
      this.moonLight.color.setHex(th.moon[0]);
      this.moonLight.intensity = th.moon[1];
    }
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
        const k = ty * MAP_W + tx;
        let a = this.day ? (this.explored[k] ? 95 : 150) : this.explored[k] ? 175 : 232;
        if (this.fullReveal) a = 0;
        else if (alive && d2 <= this.viewR2 && lineOfSight(x, y, tx, ty)) {
          a = Math.min(80, d2 * 3);
          this.explored[k] = 1;
        } else if (alive && d2 <= this.viewR2 + 6) a = Math.min(a, this.day ? 110 : 190);
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
    if (!on) this.torch.intensity = 0;
    else if (this.torch.intensity === 0) this.torch.intensity = 28;
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
      // Colour hints the loot: cyan weapons, gold apples, white arrows, purple powers.
      const tint = c.kind === 2 ? 0xffd040 : c.kind === 3 ? 0xffffff : c.kind >= 7 ? 0xb070ff : 0x40fff0;
      const glow = new THREE.PointLight(tint, 3, 2.5);
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

  resetMemory() {
    this.explored.fill(0);
  }

  /** Freeze animation for a few frames so a hit lands (hit-stop). */
  hitStop(ms = 70) {
    this.freezeUntil = performance.now() + ms;
  }

  /** Floating combat text ("-4", "+8 ❤"). */
  floatText(x: number, y: number, text: string, color = "#ff5050", size = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 44px Silkscreen, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#000";
    ctx.strokeText(text, 96, 34);
    ctx.fillStyle = color;
    ctx.fillText(text, 96, 34);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(1.2 * size, 0.4 * size, 1);
    sprite.position.set(x + (Math.random() - 0.5) * 0.3, 1.9, y);
    sprite.renderOrder = 12;
    this.scene.add(sprite);
    this.floaters.push({ sprite, vy: 1.4, life: 1 });
  }

  /** Little puff at the feet when stepping. */
  dust(x: number, y: number) {
    this.burst(x, 0.08, y, 0x8a7a5a, 4);
  }

  /** Light the hearing arcs for the octants in `mask` around (x, y). */
  setHeard(x: number, y: number, mask: number) {
    this.heardArcs.forEach((arc, k) => {
      arc.position.set(x, 0.06, y);
      arc.userData.on = (mask >> k) & 1;
    });
  }

  /** Point a ground arrow from (x, y) toward (tx, ty); null hides it. */
  setGuide(x: number, y: number, target: { x: number; y: number } | null) {
    this.guide.visible = !!target;
    if (!target) return;
    const ang = Math.atan2(target.x - x, -(target.y - y));
    this.guide.position.set(x + Math.sin(ang) * 1.6, 0.07, y - Math.cos(ang) * 1.6);
    this.guide.rotation.set(-Math.PI / 2, 0, -ang);
  }

  /** Screen point → map tile (null if off the ground). */
  pickTile(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return null;
    const x = Math.round(hit.x);
    const y = Math.round(hit.z);
    return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H ? { x, y } : null;
  }

  /** Campfire with flickering light and rising embers (title screen + warm-up yard). */
  campfire(x: number, y: number) {
    const g = new THREE.Group();
    const logMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
    for (const r of [0, Math.PI / 2]) {
      const log = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.14), logMat);
      log.rotation.y = r;
      log.position.y = 0.06;
      g.add(log);
    }
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.22), new THREE.MeshBasicMaterial({ color: 0xffa030 }));
    flame.position.y = 0.26;
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.12), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
    core.position.y = 0.22;
    g.add(flame, core);
    this.fireLight = new THREE.PointLight(0xff9a40, 14, 7, 1.4);
    this.fireLight.position.y = 0.8;
    g.add(this.fireLight);
    g.position.set(x, 0, y);
    g.userData.flame = flame;
    this.props.add(g);
    if (!this.props.parent) this.scene.add(this.props);
    return g;
  }

  /** Shadowy figures with glowing eyes at the edge of the light: someone's out there. */
  lurker(x: number, y: number, facing: number) {
    const c = new Character(4);
    c.place(x, y, facing);
    c.setGhost(true);
    this.props.add(c.root);
    if (!this.props.parent) this.scene.add(this.props);
    return c;
  }

  clearProps() {
    this.props.clear();
    this.fireLight = null;
    for (const e of this.embers) e.mesh.removeFromParent();
    this.embers = [];
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
    const raw = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    // During hit-stop the world holds still for a beat; the camera and HUD keep running.
    const dt = performance.now() < this.freezeUntil ? 0 : raw;
    this.onFrame(raw, t);
    for (const c of this.characters.values()) c.update(dt, t);
    this.torch.intensity = this.torch.intensity > 0 ? 28 + Math.sin(t * 11) * 1.5 + Math.sin(t * 23) * 1 : 0;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= raw * 0.9;
      f.sprite.position.y += f.vy * raw;
      f.vy *= 0.94;
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, f.life * 2);
      if (f.life <= 0) {
        f.sprite.removeFromParent();
        this.floaters.splice(i, 1);
      }
    }
    for (const arc of this.heardArcs) {
      const m = arc.material as THREE.MeshBasicMaterial;
      const target = arc.userData.on ? 0.45 + Math.sin(t * 6) * 0.25 : 0;
      m.opacity += (target - m.opacity) * Math.min(1, raw * 8);
    }
    if (this.guide.visible) (this.guide.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(t * 8) * 0.3;
    if (this.fireLight) {
      this.fireLight.intensity = 12 + Math.sin(t * 13) * 2 + Math.sin(t * 29) * 1.5;
      const fire = this.fireLight.parent!;
      (fire.userData.flame as THREE.Mesh).scale.y = 1 + Math.sin(t * 17) * 0.15;
      if (Math.random() < raw * 10) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xffb040 : 0xff6020 }));
        mesh.position.set(fire.position.x + (Math.random() - 0.5) * 0.3, 0.3, fire.position.z + (Math.random() - 0.5) * 0.3);
        this.scene.add(mesh);
        this.embers.push({ mesh, vy: 0.6 + Math.random() * 0.6, life: 1.4 });
      }
    }
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const e = this.embers[i];
      e.life -= raw;
      e.mesh.position.y += e.vy * raw;
      e.mesh.position.x += Math.sin(t * 3 + i) * 0.003;
      if (e.life <= 0) {
        e.mesh.removeFromParent();
        this.embers.splice(i, 1);
      }
    }
    for (const c of this.props.children) if (c.userData.character) (c.userData.character as Character).update(dt, t);

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

    if (this.follow && this.cameraMode === "lobby") {
      this.camTarget.lerp(new THREE.Vector3(this.follow.x, 0, this.follow.y), 1 - Math.exp(-dt * 4));
      const sway = Math.sin(t * 0.25) * 1.2;
      this.camera.position.set(this.camTarget.x + sway, 7.5, this.camTarget.z + 6);
      // Aim below the line-up so it sits in the upper half, clear of the lobby panel.
      this.camera.lookAt(this.camTarget.x, 0.2, this.camTarget.z + 1.8);
    } else if (this.follow) {
      this.camTarget.lerp(new THREE.Vector3(this.follow.x, 0, this.follow.y), 1 - Math.exp(-dt * 8));
      const portrait = this.camera.aspect < 1;
      // Steep enough that two-block walls and trees never hide the player behind them.
      this.camera.position.set(this.camTarget.x, portrait ? 15 : 12, this.camTarget.z + (portrait ? 6.5 : 6.2));
      this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z + 0.3);
    } else if (this.cameraMode === "hero") {
      // Low, close, slowly breathing shot of the hero by the fire.
      const h = this.heroAt;
      const portrait = this.camera.aspect < 1;
      const sway = Math.sin(t * 0.18) * 0.6;
      // High enough to clear a 2-block wall two tiles in front (Ember Keep's centre is walled in).
      this.camera.position.set(h.x + 0.4 + sway, portrait ? 7 : 5, h.y + (portrait ? 6.6 : 4.6));
      // In portrait the UI fills the bottom half, so aim low to lift the hero into the top half.
      if (portrait) this.camera.lookAt(h.x, -2.2, h.y + 2.4);
      else this.camera.lookAt(h.x + 0.2, 0.6, h.y);
    } else if (this.cameraMode === "overview") {
      // Whole arena from above, slowly drifting: for the post-match reveal.
      this.orbit += dt * 0.05;
      const portrait = this.camera.aspect < 1;
      this.camera.position.set(11.5 + Math.sin(this.orbit) * 2, portrait ? 34 : 22, 11.5 + (portrait ? 14 : 13));
      this.camera.lookAt(11.5, 0, 12);
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
