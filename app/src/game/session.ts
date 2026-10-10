import * as THREE from "three";
import { BN } from "../lib/anchor";
import {
  ACTION,
  CAUSE,
  MAX_HP,
  NONE,
  STATUS,
  ZONE,
  explorerAddress,
  explorerTx,
} from "../lib/config";
import { DX, DY, MAP_W, ROWS, firstStepToward, inZone, tileAt, walkable } from "../lib/map";
import {
  arenaPda,
  decodeName,
  type ArenaState,
  type NightfallClient,
  type VisionState,
  type WorldState,
  visionPda,
  worldPda,
} from "../lib/nightfall";
import { Character, SKINS } from "./character";
import type { ArenaScene } from "./scene";
import { ICONS } from "./textures";
import { sfx } from "./sfx";
import type { Bot } from "./bot";

const MOVE_EVERY_MS = 125;
const SWORD_EVERY_MS = 230;
const BOW_EVERY_MS = 520;
const CHEST_NAMES = ["", "Diamond Sword", "Golden Apple", "Quiver of Arrows"];
const OCTANT_NAMES = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const STREAKS = ["", "", "DOUBLE KILL", "TRIPLE KILL", "RAMPAGE", "UNSTOPPABLE"];
const key = (k: string) => `<kbd>${k}</kbd>`;

/** One-time contextual tips: each shows at most twice per browser, only when it's relevant. */
const coachSeen = (id: string) => Number(localStorage.getItem(`nightfall-coach-${id}`) ?? "0");
const coachMark = (id: string) => localStorage.setItem(`nightfall-coach-${id}`, String(coachSeen(id) + 1));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const h = <T extends HTMLElement = HTMLElement>(root: HTMLElement, sel: string) => root.querySelector(sel) as T;

export interface SessionOptions {
  scene: ArenaScene;
  me: NightfallClient;
  arenaId: BN;
  /** -1 = spectator */
  slot: number;
  ui: HTMLElement;
  bots: Bot[];
  onExit: () => void;
  onPlayAgain?: () => void;
  toast: (msg: string, err?: boolean) => void;
}

export class MatchSession {
  private arena: ArenaState | null = null;
  private vision: VisionState | null = null;
  private stops: (() => void)[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private hud!: HTMLElement;
  private me: Character | null = null;
  private pred = new THREE.Vector2();
  private facing = 2;
  private lastMoveAt = 0;
  private lastSwordAt = 0;
  private lastBowAt = 0;
  private lastSentAt = 0;
  private held: number[] = [];
  private seenShots = new Set<number>();
  private lastFeedSeq = -1;
  private lastTick = -1;
  private lastTickChange = Date.now();
  private ghosts = new Map<number, { sprite: THREE.Sprite; born: number }>();
  private enemyHp = new Map<number, number>();
  private dyingUntil = new Map<number, number>();
  private placed = false;
  private ended = false;
  private deadShown = false;
  private revealed = false;
  private latency: number[] = [];
  private shake = 0;
  private pathTarget: { x: number; y: number } | null = null;
  private stepsTaken = 0;
  private coachId: string | null = null;
  private coachTimer: ReturnType<typeof setTimeout> | undefined;
  private myKillTimes: number[] = [];
  private lastHeartbeat = 0;
  private lastHeardSfx = 0;
  private lastBeep = -1;
  private aliveAtDeath = 0;
  private minimap!: HTMLCanvasElement;
  private lastSeenAt = new Map<number, { x: number; y: number; t: number }>();

  constructor(private o: SessionOptions) {}

  get spectator() {
    return this.o.slot < 0;
  }

  async start() {
    const { scene, me, arenaId, slot } = this.o;
    (window as unknown as { __nightfall: MatchSession }).__nightfall = this;
    scene.fullReveal = false;
    scene.follow = null;
    scene.resetMemory();
    sfx.ambience(true);
    this.buildHud();
    scene.setViewer(-100, -100, false);

    const conn = await me.teeConn();
    const arenaInfo = await conn.getAccountInfo(arenaPda(arenaId));
    if (arenaInfo) this.onArena(me.decodeArena(arenaInfo.data));
    this.stops.push(await me.watch(arenaPda(arenaId), (d) => this.onArena(me.decodeArena(d)), 700));
    if (slot >= 0) this.stops.push(await me.watch(visionPda(arenaId, slot), (d) => this.onVision(me.decodeVision(d)), 250));

    this.bindInput();
    scene.onFrame = (dt) => this.frame(dt);
    // Backup heartbeat: if the scheduled crank ever stalls, players advance the border themselves.
    this.timers.push(
      setInterval(() => {
        const a = this.arena;
        if (!a || a.status !== STATUS.live || this.spectator || !this.alive) return;
        if (Date.now() - this.lastTickChange > 2500) void me.tick(arenaId, a.playerCount).catch(() => {});
      }, 2500),
    );
    this.timers.push(setInterval(() => this.renderZoneTimer(), 250));
    this.timers.push(setInterval(() => this.drawMinimap(), 200));
    scene.renderer.domElement.addEventListener("pointerdown", this.onPointer);
  }

  /** Click / tap the ground to walk there; click an enemy to walk up and hit them. */
  private onPointer = (e: PointerEvent) => {
    sfx.unlock();
    if (!this.canAct()) return;
    const t = this.o.scene.pickTile(e.clientX, e.clientY);
    if (!t) return;
    this.pathTarget = t;
    this.held = [];
    this.o.scene.burst(t.x, 0.1, t.y, 0xffe040, 5);
  };

  private get alive() {
    return !!this.vision?.me[6];
  }

  dispose() {
    this.stops.forEach((s) => s());
    this.timers.forEach((t) => clearInterval(t));
    this.o.bots.forEach((b) => b.dispose());
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.o.scene.renderer.domElement.removeEventListener("pointerdown", this.onPointer);
    this.o.scene.setHeard(0, 0, 0);
    this.o.scene.setGuide(0, 0, null);
    sfx.ambience(false);
    clearTimeout(this.coachTimer);
    for (const c of this.o.scene.characters.values()) c.dispose();
    this.o.scene.characters.clear();
    for (const g of this.ghosts.values()) g.sprite.removeFromParent();
    this.o.scene.onFrame = () => {};
    this.o.scene.follow = null;
    this.hud.remove();
  }

  // ───────────── state updates ─────────────

  private name(slot: number) {
    if (!this.arena || slot === NONE) return "the border";
    return decodeName(this.arena.names[slot]) || `Player ${slot + 1}`;
  }

  private skinColor(slot: number) {
    return SKINS[(this.arena?.skins[slot] ?? 0) % SKINS.length].shirt;
  }

  private onArena(a: ArenaState) {
    const first = !this.arena;
    this.arena = a;
    if (a.tick !== this.lastTick) {
      this.lastTick = a.tick;
      this.lastTickChange = Date.now();
    }
    if (this.o.scene.zoneTarget !== a.zone && !first) {
      this.chat(`<span style="color:#9fd0ff">The world border is closing in…</span>`);
      sfx.border();
    }
    this.o.scene.zoneTarget = a.zone;

    // Kill feed.
    if (this.lastFeedSeq < 0) this.lastFeedSeq = Math.max(0, a.feedSeq - 5);
    while (this.lastFeedSeq < a.feedSeq) {
      const [killer, victim, cause] = a.feed[this.lastFeedSeq % 5];
      this.lastFeedSeq++;
      const v = `<b style="color:${this.skinColor(victim)}">${esc(this.name(victim))}</b>`;
      const k = `<b style="color:${this.skinColor(killer)}">${esc(this.name(killer))}</b>`;
      const line =
        cause === CAUSE.border
          ? `${v} went outside the world border`
          : cause === CAUSE.bow
            ? `${v} was shot by ${k}`
            : `${v} was slain by ${k}`;
      this.feed(line);
      if (victim === this.o.slot) {
        sfx.death();
        this.aliveAtDeath = Array.from({ length: a.playerCount }, (_, i) => (a.alive >> i) & 1).reduce((s, b) => s + b, 0) + 1;
      } else if (killer === this.o.slot) {
        const now = Date.now();
        this.myKillTimes = [...this.myKillTimes.filter((t) => now - t < 10_000), now];
        const n = this.myKillTimes.length;
        sfx.streak(n);
        this.banner(n >= 2 ? STREAKS[Math.min(n, STREAKS.length - 1)] : "ELIMINATED", esc(this.name(victim)), 1800);
        this.o.scene.hitStop(140);
      }
    }
    const alive = Array.from({ length: a.playerCount }, (_, i) => (a.alive >> i) & 1).reduce((s, b) => s + b, 0);
    h(this.hud, "[data-alive]").innerHTML =
      a.status === STATUS.live ? `<b>${alive}</b> alive` : a.status >= STATUS.ended ? "match over" : "waiting for spawn…";
    h(this.hud, "[data-kills]").innerHTML = this.o.slot >= 0 ? `<b>${a.kills[this.o.slot]}</b> kills` : "spectating";

    if (a.status >= STATUS.ended && !this.ended) {
      this.ended = true;
      setTimeout(() => this.showEnd(), 900);
    }
    if (this.spectator && a.status === STATUS.live && first) this.banner("SPECTATING", "The night hides every player — even from you.", 4000);
  }

  private onVision(v: VisionState) {
    if (this.vision && v.version <= this.vision.version && v.status === this.vision.status) return;
    const prev = this.vision;
    this.vision = v;
    if (v.status !== STATUS.live && v.status !== STATUS.ended) return;
    const { scene } = this.o;
    const [x, y, hp, facing, weapon, arrows, alive] = v.me;

    if (!this.placed && alive) {
      this.placed = true;
      this.pred.set(x, y);
      this.facing = facing;
      this.me = new Character(this.arena?.skins[this.o.slot] ?? 0, this.name(this.o.slot), "#ffff80");
      this.me.setRing(0xffe040);
      this.me.place(x, y, facing);
      scene.scene.add(this.me.root);
      scene.characters.set(this.o.slot, this.me);
      scene.follow = this.pred;
      this.banner("NIGHTFALL", "Last one standing wins. Stay inside the border.", 2600);
      setTimeout(() => this.coach("move", `Move with ${key("W")}${key("A")}${key("S")}${key("D")} or the arrow keys. Or <b>click the ground</b> to walk there.`, 0), 2700);
      this.chat("Spawn point rolled by <b>MagicBlock VRF</b> — sealed in the TEE.");
    }
    if (!this.me) return;

    // Reconcile my own prediction once in-flight moves have had time to land.
    if (Date.now() - this.lastSentAt > 380 || Math.abs(this.pred.x - x) + Math.abs(this.pred.y - y) > 2) {
      this.pred.set(x, y);
      if (Date.now() - this.lastSentAt > 380) this.facing = facing;
    }
    this.me.setWeapon(weapon);

    if (prev && prev.me[6]) {
      if (v.hitSeq !== prev.hitSeq && hp < prev.me[2]) {
        this.me.hurt();
        sfx.hurt();
        this.shake = 0.35;
        scene.hitStop(60);
        scene.floatText(x, y, `-${prev.me[2] - hp}`, "#ff5050");
        if (hp <= 6 && hp > 0) this.coach("lowhp", `❤ Low health! A <b>Golden Apple</b> chest heals +8. Or run.`, 6000);
        scene.burst(x, 0.8, y, 0xc02020, 10);
        const vig = h(this.hud, ".vignette");
        vig.style.opacity = "1";
        setTimeout(() => (vig.style.opacity = "0"), 350);
        if (v.hitDir !== NONE) {
          const arrow = h(this.hud, ".hit-arrow");
          // Screen-space: up = north (camera looks north).
          arrow.style.transform = `rotate(${[0, 90, 180, 270][v.hitDir]}deg)`;
          arrow.style.opacity = "1";
          setTimeout(() => (arrow.style.opacity = "0"), 700);
        }
      }
      if (weapon === 2 && prev.me[4] !== 2) this.loot(1);
      else if (hp > prev.me[2]) {
        this.loot(2);
        scene.floatText(x, y, `+${hp - prev.me[2]}`, "#60ff70");
      } else if (arrows > prev.me[5]) {
        this.loot(3);
        scene.floatText(x, y, `+${arrows - prev.me[5]} ➶`, "#ffffff");
      }
    }
    if (!alive && !this.deadShown) {
      this.deadShown = true;
      this.me.die();
      scene.burst(x, 0.6, y, 0xffffff, 18);
      setTimeout(() => this.showDead(), 1200);
    }

    // Enemies inside my torchlight.
    const now = performance.now();
    const visible = new Set<number>();
    for (let i = 0; i < v.seenCount; i++) {
      const [slot, ex, ey, ehp, efacing, eweapon] = v.seen[i];
      visible.add(slot);
      let c = scene.characters.get(slot);
      if (!c) {
        c = new Character(this.arena?.skins[slot] ?? 0, this.name(slot), "#ff8080");
        c.setRing(0xff3030);
        c.place(ex, ey, efacing);
        scene.scene.add(c.root);
        scene.characters.set(slot, c);
        const lastSeen = this.lastSeenAt.get(slot);
        if (!lastSeen || performance.now() - lastSeen.t > 5000) {
          this.chat(`<span style="color:#ff9090">⚠ ${esc(this.name(slot))} spotted!</span>`);
          sfx.spotted();
          this.coach("fight", `⚔ Enemy! Walk up next to them and press ${key("SPACE")}. Far away in a straight line? ${key("SPACE")} shoots your bow.`, 7000);
        }
      }
      c.target.set(ex, ey);
      c.facing = efacing;
      c.setWeapon(eweapon);
      const before = this.enemyHp.get(slot);
      if (before !== undefined && ehp < before) {
        c.hurt();
        sfx.hit();
        scene.burst(ex, 0.8, ey, 0xc02020, 8);
        scene.floatText(ex, ey, `-${before - ehp}`, "#ffe040", 1.2);
        scene.hitStop(70);
      }
      this.lastSeenAt.set(slot, { x: ex, y: ey, t: performance.now() });
      this.enemyHp.set(slot, ehp);
      this.ghosts.get(slot)?.sprite.removeFromParent();
      this.ghosts.delete(slot);
    }
    for (const [slot, c] of scene.characters) {
      if (slot === this.o.slot || visible.has(slot)) continue;
      const diedNow = this.arena && !((this.arena.alive >> slot) & 1);
      if (diedNow && !this.dyingUntil.has(slot)) {
        c.die();
        scene.burst(c.pos.x, 0.6, c.pos.y, 0xffffff, 16);
        this.dyingUntil.set(slot, now + 1500);
        continue;
      }
      if (this.dyingUntil.has(slot) && now < this.dyingUntil.get(slot)!) continue;
      // Lost in the dark: leave a fading "last seen" marker.
      if (!diedNow) this.addGhost(slot, c.target.x, c.target.y);
      c.dispose();
      scene.characters.delete(slot);
      this.enemyHp.delete(slot);
    }

    scene.setChests(v.chests.slice(0, v.chestCount).map(([cx, cy, kind]) => ({ x: cx, y: cy, kind })));
    if (v.chestCount > 0 && alive) this.coach("chest", `✨ A glowing chest! Walk into it to loot it.`, 6000);
    if (v.heard && alive) {
      const ks = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => (v.heard >> k) & 1);
      this.coach("hear", `👂 Red arcs are <b>footsteps you can't see</b>. Someone is to the ${OCTANT_NAMES[ks[0]]}.`, 6500);
    }
    for (const s of v.shots) {
      const [shooter, x0, y0, x1, y1, seq] = s;
      if (!seq || this.seenShots.has(seq)) continue;
      this.seenShots.add(seq);
      if (shooter !== this.o.slot) {
        scene.arrow(x0, y0, x1, y1);
        sfx.bow();
      }
    }
    this.renderStats();
  }

  private loot(kind: number) {
    sfx.chest();
    this.chat(`You opened a chest: <b style="color:#ffd84a">${CHEST_NAMES[kind]}</b>`);
  }

  private addGhost(slot: number, x: number, y: number) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 48px Silkscreen, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ff6060";
    ctx.fillText("?", 32, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(0.7, 0.7, 1);
    sprite.position.set(x, 0.9, y);
    this.o.scene.scene.add(sprite);
    this.ghosts.get(slot)?.sprite.removeFromParent();
    this.ghosts.set(slot, { sprite, born: performance.now() });
  }

  // ───────────── input ─────────────

  private keyDir = (k: string) => ({ w: 0, arrowup: 0, d: 1, arrowright: 1, s: 2, arrowdown: 2, a: 3, arrowleft: 3 })[k.toLowerCase()] ?? -1;

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    sfx.unlock();
    const d = this.keyDir(e.key);
    if (d >= 0) {
      e.preventDefault();
      // A tap moves right away; holding keeps walking from the frame loop.
      this.pathTarget = null;
      if (!this.held.includes(d)) {
        this.held.unshift(d);
        if (!e.repeat) this.tryMove(d, true);
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (e.key === " " || k === "j" || e.key === "Enter") {
      e.preventDefault();
      this.smartAttack();
    } else if (k === "f" || k === "k") this.attack(ACTION.bow);
    else if (k === "x") this.toggleXray();
    else if (k === "h" || e.key === "?") this.toggleHelp();
    else if (e.key === "Escape") {
      this.hud.querySelector(".help")?.remove();
      this.hud.querySelector(".xray")?.remove();
    }
    else if (e.key.toLowerCase() === "m") h(this.hud, "[data-mute]").textContent = sfx.toggle() ? "🔇" : "🔊";
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const d = this.keyDir(e.key);
    if (d >= 0) this.held = this.held.filter((x) => x !== d);
  };

  private bindInput() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    this.hud.querySelectorAll<HTMLButtonElement>("[data-pad]").forEach((b) => {
      const d = Number(b.dataset.pad);
      const down = (e: Event) => {
        e.preventDefault();
        sfx.unlock();
        if (!this.held.includes(d)) {
          this.held.unshift(d);
          this.tryMove(d, true);
        }
      };
      const up = (e: Event) => {
        e.preventDefault();
        this.held = this.held.filter((x) => x !== d);
      };
      b.addEventListener("pointerdown", down);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointerleave", up);
      b.addEventListener("pointercancel", up);
    });
    this.hud.querySelector("[data-act-sword]")?.addEventListener("pointerdown", () => this.smartAttack());
    this.hud.querySelector("[data-act-bow]")?.addEventListener("pointerdown", () => this.attack(ACTION.bow));
    this.hud.querySelector("[data-slot='0']")?.addEventListener("click", () => this.smartAttack());
    this.hud.querySelector("[data-slot='1']")?.addEventListener("click", () => this.attack(ACTION.bow));
  }

  private canAct() {
    return !!this.me && this.alive && this.arena?.status === STATUS.live && !this.ended;
  }

  private send(action: number, dir: number) {
    const a = this.arena!;
    this.lastSentAt = Date.now();
    const t = performance.now();
    void this.o.me
      .act(this.o.arenaId, a.playerCount, action, dir)
      .then(() => {
        this.latency.push(performance.now() - t);
        if (this.latency.length > 30) this.latency.shift();
      })
      .catch((e) => console.warn("act failed", e));
  }

  private enemyAt(x: number, y: number) {
    const v = this.vision;
    if (!v) return false;
    return v.seen.slice(0, v.seenCount).some((s) => s[1] === x && s[2] === y);
  }

  private tryMove(d: number, tap = false) {
    if (!this.canAct()) return;
    const now = Date.now();
    if (now - this.lastMoveAt < (tap ? 60 : MOVE_EVERY_MS)) return;
    this.lastMoveAt = now;
    this.facing = d;
    const nx = this.pred.x + DX[d];
    const ny = this.pred.y + DY[d];
    if (walkable(nx, ny) && !this.enemyAt(nx, ny)) {
      this.pred.set(nx, ny);
      sfx.step();
      this.o.scene.dust(nx, ny);
      if (++this.stepsTaken === 5 && this.coachId === "move") this.coachDone();
    }
    this.send(ACTION.move, d);
  }

  /** SPACE: hit whoever is next to you, else shoot whoever is lined up, else swing ahead. */
  private smartAttack() {
    const v = this.vision;
    if (!v || !this.canAct()) return;
    const enemies = v.seen.slice(0, v.seenCount);
    const { x, y } = this.pred;
    for (let d = 0; d < 4; d++)
      if (enemies.some((e) => e[1] === x + DX[d] && e[2] === y + DY[d])) {
        this.facing = d;
        return this.attack(ACTION.sword);
      }
    if (v.me[5] > 0)
      for (const e of enemies) {
        if (e[1] !== x && e[2] !== y) continue;
        const d = e[1] === x ? (e[2] < y ? 0 : 2) : e[1] > x ? 1 : 3;
        if (this.clearShot(x, y, d, e[1], e[2])) {
          this.facing = d;
          return this.attack(ACTION.bow);
        }
      }
    this.attack(ACTION.sword);
  }

  private clearShot(x: number, y: number, d: number, tx: number, ty: number) {
    for (let i = 0; i < 7; i++) {
      x += DX[d];
      y += DY[d];
      if (tileAt(x, y) === 1) return false;
      if (x === tx && y === ty) return true;
    }
    return false;
  }

  private attack(kind: number) {
    if (!this.canAct()) return;
    const now = Date.now();
    if (kind === ACTION.sword) {
      if (now - this.lastSwordAt < SWORD_EVERY_MS) return;
      this.lastSwordAt = now;
      this.me!.swing();
      sfx.swing();
      this.flashSlot(0, SWORD_EVERY_MS);
    } else {
      const arrows = this.vision?.me[5] ?? 0;
      if (arrows <= 0) {
        this.chat("<span class='muted'>Out of arrows — find a chest.</span>");
        return;
      }
      if (now - this.lastBowAt < BOW_EVERY_MS) return;
      this.lastBowAt = now;
      this.me!.shoot();
      sfx.bow();
      this.flashSlot(1, BOW_EVERY_MS);
      // Local arrow flight for instant feedback; the TEE decides what it hits.
      let ex = this.pred.x;
      let ey = this.pred.y;
      for (let i = 0; i < 7; i++) {
        const nx = ex + DX[this.facing];
        const ny = ey + DY[this.facing];
        // Same rule as the program: only solid blocks stop an arrow (it flies over water and grass).
        if (tileAt(nx, ny) === 1) break;
        ex = nx;
        ey = ny;
        if (this.enemyAt(ex, ey)) break;
      }
      this.o.scene.arrow(this.pred.x, this.pred.y, ex, ey);
    }
    this.send(kind, this.facing);
  }

  private flashSlot(i: number, ms: number) {
    const el = h(this.hud, `[data-slot='${i}']`);
    el.classList.add("cool");
    setTimeout(() => el.classList.remove("cool"), ms);
  }

  private frame(dt: number) {
    if (this.held.length) this.tryMove(this.held[0]);
    else if (this.pathTarget) this.followPath();
    this.senses();
    if (this.me && this.alive) {
      this.me.target.copy(this.pred);
      this.me.facing = this.facing;
      this.o.scene.setTorch(this.me.pos.x, this.me.pos.y, true);
      this.o.scene.setViewer(Math.round(this.pred.x), Math.round(this.pred.y), true);
    } else if (!this.revealed) {
      this.o.scene.setTorch(0, 0, false);
      this.o.scene.setViewer(-100, -100, false);
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.o.scene.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      this.o.scene.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    }
    const now = performance.now();
    for (const [slot, g] of this.ghosts) {
      const age = (now - g.born) / 1000;
      (g.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - age / 5);
      g.sprite.position.y = 0.9 + Math.sin(age * 3) * 0.05;
      if (age > 5) {
        g.sprite.removeFromParent();
        this.ghosts.delete(slot);
      }
    }
    for (const [slot, until] of this.dyingUntil)
      if (now > until) {
        this.o.scene.characters.get(slot)?.dispose();
        if (slot !== this.o.slot) this.o.scene.characters.delete(slot);
        this.dyingUntil.delete(slot);
      }
  }


  /** Walk one step along the clicked path; if an enemy stands there, walk up and attack. */
  private followPath() {
    const t = this.pathTarget!;
    const v = this.vision;
    const { x, y } = this.pred;
    const enemyThere = !!v && v.seen.slice(0, v.seenCount).some((e) => e[1] === t.x && e[2] === t.y);
    const dist = Math.abs(t.x - x) + Math.abs(t.y - y);
    if (dist === 0 || (enemyThere && dist === 1)) {
      if (enemyThere) this.smartAttack();
      this.pathTarget = null;
      return;
    }
    if (Date.now() - this.lastMoveAt < MOVE_EVERY_MS) return;
    const d = firstStepToward(
      x,
      y,
      (a, b) => (enemyThere ? Math.abs(a - t.x) + Math.abs(b - t.y) === 1 : a === t.x && b === t.y),
      (a, b) => this.enemyAt(a, b),
    );
    if (d < 0) {
      this.pathTarget = null;
      return;
    }
    this.tryMove(d);
  }

  /** Hearing arcs + footsteps, heartbeat at low health, border guide and countdown beeps. */
  private senses() {
    const v = this.vision;
    const a = this.arena;
    const { scene } = this.o;
    if (!v || !a || !this.alive || a.status !== STATUS.live) {
      scene.setHeard(0, 0, 0);
      scene.setGuide(0, 0, null);
      return;
    }
    const me = this.me?.pos ?? this.pred;
    scene.setHeard(me.x, me.y, v.heard);
    const now = performance.now();
    if (v.heard && now - this.lastHeardSfx > 1300) {
      this.lastHeardSfx = now;
      const ks = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => (v.heard >> k) & 1);
      const k = ks[Math.floor(Math.random() * ks.length)];
      sfx.heard(Math.sin((k * Math.PI) / 4));
    }
    const hp = v.me[2];
    if (hp > 0 && hp <= 6 && now - this.lastHeartbeat > (hp <= 3 ? 650 : 950)) {
      this.lastHeartbeat = now;
      sfx.heartbeat();
      const vig = h(this.hud, ".vignette");
      vig.style.opacity = "0.55";
      setTimeout(() => (vig.style.opacity = "0"), 220);
    }
    // Guide arrow: outside the border, or about to be.
    const elapsed = Date.now() / 1000 - a.startTs.toNumber();
    const nextZone = elapsed < ZONE.graceSecs - 8 ? a.zone : Math.max(ZONE.min, a.zone - 1);
    const [mx, my] = [Math.round(this.pred.x), Math.round(this.pred.y)];
    const danger = !inZone(a.zone, mx, my) || !inZone(nextZone, mx, my);
    scene.setGuide(me.x, me.y, danger ? { x: 11.5, y: 11.5 } : null);
    if (danger) this.coach("border", `🧭 The border is coming for you. Follow the <b style="color:#8fd8ff">blue arrow</b> to the safe zone.`, 6000);
    // Countdown beeps for the last 3 seconds before the border moves.
    const untilShrink = elapsed < ZONE.graceSecs ? ZONE.graceSecs - elapsed : ZONE.shrinkSecs - ((elapsed - ZONE.graceSecs) % ZONE.shrinkSecs);
    const sec = Math.ceil(untilShrink);
    if (a.zone > ZONE.min && sec <= 3 && sec !== this.lastBeep) {
      this.lastBeep = sec;
      sfx.beep(sec === 1);
    }
    if (sec > 3) this.lastBeep = -1;
  }

  // ───────────── coaching (learn by doing) ─────────────

  private coach(id: string, html: string, autoHideMs: number) {
    if (this.coachId || coachSeen(id) >= 2) return;
    coachMark(id);
    this.coachId = id;
    const el = h(this.hud, "[data-coach]");
    el.innerHTML = html;
    el.classList.add("on");
    clearTimeout(this.coachTimer);
    if (autoHideMs) this.coachTimer = setTimeout(() => this.coachDone(), autoHideMs);
  }

  private coachDone() {
    this.coachId = null;
    h(this.hud, "[data-coach]").classList.remove("on");
  }

  private toggleHelp() {
    const existing = this.hud.querySelector(".help");
    if (existing) return existing.remove();
    const el = document.createElement("div");
    el.className = "help panel";
    el.innerHTML = `
      <div class="label">How to play · press ${key("H")} to close</div>
      <div class="help-grid">
        <div>${key("W")}${key("A")}${key("S")}${key("D")} / arrows</div><div>Move · or <b>click the ground</b></div>
        <div>${key("SPACE")}</div><div>Attack: sword if adjacent, bow if they're lined up</div>
        <div>${key("F")}</div><div>Shoot your bow straight ahead</div>
        <div>${key("X")}</div><div>X-ray: try to see through the fog (you can't)</div>
        <div>${key("M")}</div><div>Mute</div>
      </div>
      <ul>
        <li>You only see what your <b>torch</b> lights. So does everyone else.</li>
        <li><b style="color:#ff6060">Red arcs</b> = footsteps you can hear but can't see.</li>
        <li><b>Tall grass</b> hides you unless someone is right next to you.</li>
        <li><b>Chests</b> glow: 💎 Diamond Sword (more damage) · 🍎 Golden Apple (+8 health) · ➶ Arrows.</li>
        <li>After 40s the <b style="color:#8fd8ff">world border</b> shrinks every 8s. Outside it, you burn.</li>
        <li>Last one standing wins the pot.</li>
      </ul>
      <button class="btn small" data-close>Got it</button>`;
    this.hud.appendChild(el);
    h(el, "[data-close]").addEventListener("click", () => el.remove());
  }

  // ───────────── minimap ─────────────

  private minimapBase: HTMLCanvasElement | null = null;

  private drawMinimap() {
    const c = this.minimap;
    const a = this.arena;
    if (!c || !a) return;
    const S = 5;
    if (!this.minimapBase) {
      const base = document.createElement("canvas");
      base.width = base.height = MAP_W * S;
      const b = base.getContext("2d")!;
      ROWS.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          b.fillStyle = ch === "T" ? "#24461b" : ch === "#" ? "#5a5a66" : ch === "~" ? "#2a4f9a" : ch === '"' ? "#3f6e2a" : "#1d2e17";
          b.fillRect(x * S, y * S, S, S);
        }),
      );
      this.minimapBase = base;
    }
    const ctx = c.getContext("2d")!;
    ctx.drawImage(this.minimapBase, 0, 0);
    // Border.
    const lo = (11.5 - a.zone + 0.5) * S;
    const size = (a.zone * 2) * S;
    ctx.strokeStyle = "#8fd8ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(lo, lo, size, size);
    ctx.fillStyle = "rgba(60,120,255,0.18)";
    ctx.fillRect(0, 0, c.width, lo);
    ctx.fillRect(0, lo + size, c.width, c.height);
    ctx.fillRect(0, lo, lo, size);
    ctx.fillRect(lo + size, lo, c.width, size);
    // Last-seen enemies (fade over 6s), then me.
    const now = performance.now();
    for (const [, p] of this.lastSeenAt) {
      const age = (now - p.t) / 6000;
      if (age > 1) continue;
      ctx.fillStyle = `rgba(255,70,70,${1 - age})`;
      ctx.fillRect(p.x * S - 1, p.y * S - 1, S + 2, S + 2);
    }
    if (this.vision?.me[6]) {
      ctx.fillStyle = "#ffe040";
      ctx.fillRect(this.pred.x * S - 1, this.pred.y * S - 1, S + 2, S + 2);
    }
  }

  // ───────────── HUD ─────────────

  private buildHud() {
    const el = document.createElement("div");
    el.className = "hud";
    el.innerHTML = `
      <div class="vignette"></div>
      <div class="hit-arrow"></div>
      <div class="top-left">
        <div class="pill" data-alive>waiting</div>
        <div class="pill" data-kills></div>
        <div class="pill border-warn" data-zone>Border: —</div>
        <div class="pill muted" data-xy style="font-size:11px">XY —</div>

      </div>
      <div class="top-right">
        <div class="row">
          <button class="btn small" data-help title="How to play (H)">?</button>
          <button class="btn small" data-xray title="Try to see through the fog (X)">🕶 X-RAY</button>
          <button class="btn small" data-mute title="Mute (M)">🔊</button>
          <button class="btn small" data-leave title="Leave">✕</button>
        </div>
        <canvas class="minimap" data-minimap width="120" height="120" ${this.spectator ? "" : ""}></canvas>
        <div class="pill muted" data-net style="font-size:11px">TEE · devnet</div>
        <div class="feed" data-feed></div>
      </div>
      <div class="chat" data-chat></div>
      <div class="center-banner" data-banner></div>
      <div class="coach" data-coach></div>
      <div class="bottom" ${this.spectator ? 'style="display:none"' : ""}>
        <div class="keys hide-touch">${key("WASD")} move · ${key("SPACE")} attack · ${key("F")} bow · ${key("H")} help</div>
        <div class="hearts" data-hearts></div>
        <div class="hotbar">
          <div class="slot" data-slot="0"><span class="key">1</span><img data-sword-icon src="${ICONS.woodSword()}" alt="sword"/></div>
          <div class="slot" data-slot="1"><span class="key">2</span><img src="${ICONS.bow()}" alt="bow"/><span class="count" data-arrows>0</span></div>
        </div>
      </div>
      <div class="touch" ${this.spectator ? 'style="display:none"' : ""}>
        <div class="pad">
          <span></span><button data-pad="0">▲</button><span></span>
          <button data-pad="3">◀</button><span></span><button data-pad="1">▶</button>
          <span></span><button data-pad="2">▼</button><span></span>
        </div>
        <div class="acts">
          <button data-act-bow>BOW</button>
          <button data-act-sword>ATTACK</button>
        </div>
      </div>`;
    this.o.ui.appendChild(el);
    this.hud = el;
    h(el, "[data-xray]").addEventListener("click", () => this.toggleXray());
    h(el, "[data-help]").addEventListener("click", () => this.toggleHelp());
    this.minimap = h<HTMLCanvasElement>(el, "[data-minimap]");
    h(el, "[data-mute]").addEventListener("click", (e) => ((e.target as HTMLElement).textContent = sfx.toggle() ? "🔇" : "🔊"));
    h(el, "[data-leave]").addEventListener("click", () => {
      if (this.arena?.status === STATUS.live && this.alive && !confirm("Leave the match? You'll stay in the arena and the border will catch you.")) return;
      this.o.onExit();
    });
    this.renderStats();
  }

  private renderStats() {
    const v = this.vision;
    const hp = v?.me[2] ?? MAX_HP;
    const hearts = h(this.hud, "[data-hearts]");
    const icons: string[] = [];
    for (let i = 0; i < MAX_HP / 2; i++) {
      const left = hp - i * 2;
      icons.push(`<img src="${ICONS.heart(left >= 2 ? "full" : left === 1 ? "half" : "empty")}" alt=""/>`);
    }
    hearts.innerHTML = icons.join("");
    hearts.classList.toggle("low", hp > 0 && hp <= 6);
    h<HTMLImageElement>(this.hud, "[data-sword-icon]").src = v?.me[4] === 2 ? ICONS.diamondSword() : ICONS.woodSword();
    h(this.hud, "[data-arrows]").textContent = String(v?.me[5] ?? 0);
    if (v) h(this.hud, "[data-xy]").textContent = `XY ${v.me[0]}, ${v.me[1]} · seen ${v.seenCount} · v${v.version}`;
    if (this.latency.length) {
      const sorted = [...this.latency].sort((a, b) => a - b);
      h(this.hud, "[data-net]").textContent = `TEE rollup · ${Math.round(sorted[sorted.length >> 1])}ms`;
    }
  }

  private renderZoneTimer() {
    const a = this.arena;
    const el = h(this.hud, "[data-zone]");
    if (!a || a.status !== STATUS.live) {
      if (a && a.status >= STATUS.ended) el.style.display = "none";
      return;
    }
    const now = Date.now() / 1000;
    const elapsed = now - a.startTs.toNumber();
    let label: string;
    let urgent = false;
    if (elapsed < ZONE.graceSecs) {
      const s = Math.ceil(ZONE.graceSecs - elapsed);
      label = `Border moves in <b>${s}s</b>`;
      urgent = s <= 5;
    } else if (a.zone > ZONE.min) {
      const into = (elapsed - ZONE.graceSecs) % ZONE.shrinkSecs;
      label = `Border shrinks in <b>${Math.ceil(ZONE.shrinkSecs - into)}s</b>`;
      urgent = true;
    } else label = `<b>Final circle</b>`;
    const me = this.vision?.me;
    if (me && me[6] && !this.spectator && !this.insideZone(me[0], me[1], a.zone)) {
      label = `<b>OUTSIDE THE BORDER</b> — move!`;
      urgent = true;
    }
    el.innerHTML = label;
    el.classList.toggle("urgent", urgent);
  }

  private insideZone(x: number, y: number, z: number) {
    return Math.abs(2 * x - 23) < 2 * z && Math.abs(2 * y - 23) < 2 * z;
  }

  private chat(html: string) {
    const box = h(this.hud, "[data-chat]");
    const line = document.createElement("div");
    line.innerHTML = html;
    box.appendChild(line);
    while (box.children.length > 6) box.firstElementChild?.remove();
    setTimeout(() => (line.style.opacity = "0"), 7000);
    setTimeout(() => line.remove(), 8200);
  }

  private feed(html: string) {
    const box = h(this.hud, "[data-feed]");
    const line = document.createElement("div");
    line.innerHTML = html;
    box.prepend(line);
    while (box.children.length > 5) box.lastElementChild?.remove();
    this.chat(html);
  }

  private banner(title: string, sub: string, ms: number) {
    const el = h(this.hud, "[data-banner]");
    el.innerHTML = `<h2>${title}</h2><p>${sub}</p>`;
    el.style.opacity = "1";
    setTimeout(() => (el.style.opacity = "0"), ms);
  }

  // ───────────── the X-ray: try (and fail) to cheat ─────────────

  private async toggleXray() {
    const existing = this.hud.querySelector(".xray");
    if (existing) return existing.remove();
    const a = this.arena;
    if (!a) return;
    const panel = document.createElement("div");
    panel.className = "xray panel";
    panel.innerHTML = `<div class="label">X-ray — querying the TEE with your own wallet's token</div><div data-rows><span class="spinner"></span></div>`;
    this.hud.appendChild(panel);
    const conn = await this.o.me.teeConn();
    const rows: string[] = [];
    const probe = async (label: string, pda: ReturnType<typeof worldPda>, expectOpen: boolean) => {
      const info = await conn.getAccountInfo(pda).catch(() => null);
      const ok = !!info === expectOpen;
      rows.push(
        `<div class="res"><span>${label}<br/><a href="${explorerAddress(pda.toBase58())}" target="_blank" rel="noreferrer" style="font-size:16px">${pda.toBase58().slice(0, 10)}…</a></span><span class="${info ? (ok ? "ok" : "no") : "ok"}">${info ? `${info.data.length} bytes` : "null — sealed"}</span></div>`,
      );
    };
    await probe("World (every position)", worldPda(this.o.arenaId), a.status >= STATUS.ended);
    for (let s = 0; s < a.playerCount; s++)
      await probe(s === this.o.slot ? "Your Vision" : `${esc(this.name(s))}'s Vision`, visionPda(this.o.arenaId, s), s === this.o.slot);
    const base = await this.o.me.base.getAccountInfo(worldPda(this.o.arenaId)).catch(() => null);
    rows.push(
      `<div class="res"><span>World on Solana base layer</span><span class="ok">${base ? "delegated · no positions" : "—"}</span></div>`,
      `<p class="muted" style="margin:8px 0 0">Positions only exist inside MagicBlock's Intel TDX enclave. The host, the RPC and other players get <b>null</b>. Your wallet can read your Vision and nothing else.</p>`,
    );
    h(panel, "[data-rows]").innerHTML = rows.join("");
  }

  // ───────────── death & endgame ─────────────

  private showDead() {
    if (this.ended || this.hud.querySelector(".dead-screen")) return;
    const el = document.createElement("div");
    el.className = "dead-screen";
    const place = this.aliveAtDeath || (this.arena ? this.arena.playerCount : 0);
    el.innerHTML = `<h2>You died!</h2><p>You placed <b style="color:#ffcf40">#${place}</b> of ${this.arena?.playerCount ?? "?"} · ${this.arena?.kills[this.o.slot] ?? 0} kills</p>
      <p class="muted">Dead players see nothing until the night ends.</p>
      <div class="row">${this.o.onPlayAgain ? `<button class="btn primary" data-again>▶ Play again</button>` : ""}<button class="btn" data-spec>Spectate</button><button class="btn" data-menu>Title screen</button></div>`;
    this.hud.appendChild(el);
    el.querySelector("[data-again]")?.addEventListener("click", () => this.o.onPlayAgain?.());
    h(el, "[data-spec]").addEventListener("click", () => el.remove());
    h(el, "[data-menu]").addEventListener("click", () => this.o.onExit());
  }

  private showEnd() {
    const a = this.arena!;
    this.hud.querySelector(".dead-screen")?.remove();
    const won = a.winner === this.o.slot;
    if (won) sfx.win();
    const stake = a.stake.toNumber() / 1e9;
    const pot = stake * a.playerCount;
    const ranking = Array.from({ length: a.playerCount }, (_, i) => i).sort((x, y) => (y === a.winner ? 1 : 0) - (x === a.winner ? 1 : 0) || a.kills[y] - a.kills[x]);
    const el = document.createElement("div");
    el.className = `dead-screen ${won ? "win" : ""}`;
    el.innerHTML = `
      <h2>${won ? "You survived the night!" : a.winner === NONE ? "Nobody survived" : `${esc(this.name(a.winner))} survived the night`}</h2>
      <div class="panel" style="min-width:min(420px,92vw)">
        ${ranking.map((i) => `<div class="res row" style="justify-content:space-between"><span style="color:${this.skinColor(i)}">${i === a.winner ? "👑 " : ""}${esc(this.name(i))}${i === this.o.slot ? " (you)" : ""}</span><span>${a.kills[i]} kills</span></div>`).join("")}
        ${pot > 0 ? `<p class="muted">Pot: <b style="color:#ffcf40">${pot} SOL</b> → ${esc(this.name(a.winner))}</p>` : ""}
        <div class="log" data-endlog></div>
      </div>
      <div class="row" style="flex-wrap:wrap;justify-content:center">
        <button class="btn primary" data-reveal>☀ Reveal the night</button>
        <button class="btn" data-settle>${pot > 0 ? "Settle & pay winner" : "Settle on Solana"}</button>
        ${this.o.onPlayAgain ? `<button class="btn primary" data-again>▶ Play again</button>` : ""}
        <button class="btn" data-menu>Title screen</button>
      </div>`;
    this.hud.appendChild(el);
    el.querySelector("[data-again]")?.addEventListener("click", () => this.o.onPlayAgain?.());
    const log = (s: string) => (h(el, "[data-endlog]").innerHTML += `<div>${s}</div>`);
    h(el, "[data-menu]").addEventListener("click", () => this.o.onExit());
    h<HTMLButtonElement>(el, "[data-reveal]").addEventListener("click", async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      try {
        log("Unsealing the World permission inside the TEE…");
        const conn = await this.o.me.teeConn();
        let info = await conn.getAccountInfo(worldPda(this.o.arenaId));
        if (!info) {
          const sig = await this.o.me.reveal(this.o.arenaId);
          log(`Revealed inside the TEE · <code>${sig.slice(0, 10)}…</code>`);
          info = await conn.getAccountInfo(worldPda(this.o.arenaId));
        }
        if (info) this.revealWorld(this.o.me.decodeWorld(info.data));
        el.classList.add("collapsed");
      } catch (err) {
        log(`<span style="color:#ff8080">${esc((err as Error).message.split("\n")[0])}</span>`);
        b.disabled = false;
      }
    });
    h<HTMLButtonElement>(el, "[data-settle]").addEventListener("click", async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      try {
        log("Committing the result to Solana and closing the rollup session…");
        const s1 = await this.o.me.settle(this.o.arenaId);
        log(`Commit scheduled from the TEE · <code>${s1.slice(0, 10)}…</code>`);
        if (a.winner !== NONE) {
          log("Waiting for the arena to land on Solana, then paying the winner…");
          const s2 = await this.o.me.claim(this.o.arenaId, a.players[a.winner]);
          log(`Paid ✅ · <a href="${explorerTx(s2)}" target="_blank" rel="noreferrer">Solana tx</a>`);
        }
      } catch (err) {
        log(`<span style="color:#ff8080">${esc((err as Error).message.split("\n")[0])}</span>`);
        b.disabled = false;
      }
    });
  }

  /** After the reveal, draw every player where they actually were. */
  private revealWorld(w: WorldState) {
    const a = this.arena!;
    const { scene } = this.o;
    this.revealed = true;
    scene.clearFog();
    scene.setTorch(0, 0, false);
    for (let s = 0; s < a.playerCount; s++) {
      let c = scene.characters.get(s);
      if (!c) {
        c = new Character(a.skins[s], this.name(s), s === a.winner ? "#ffcf40" : "#ffffff");
        scene.scene.add(c.root);
        scene.characters.set(s, c);
      }
      c.place(w.x[s], w.y[s], w.facing[s]);
      c.setWeapon(w.weapon[s]);
      if (!((a.alive >> s) & 1)) c.die();
    }
    scene.setChests(w.chests.filter((c) => !c[3]).map(([x, y, kind]) => ({ x, y, kind })));
    scene.follow = null;
    this.chat("☀ The sun rises. Every position is now public — check it against what you saw.");
  }
}
