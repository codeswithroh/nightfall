import * as THREE from "three";
import { Character } from "./character";
import type { ArenaScene } from "./scene";
import { DX, DY, firstStepToward, walkable } from "../lib/map";
import { sfx } from "./sfx";

const key = (k: string) => `<kbd>${k}</kbd>`;

export interface Quest {
  id: string;
  html: string;
  done: boolean;
}

/** Steps the chain goes through while you warm up. */
export const SETUP_STEPS = [
  { id: "arena", label: "Arena opened on Solana" },
  { id: "bots", label: "Three bots answer the call" },
  { id: "seal", label: "Every vision sealed inside the TEE" },
  { id: "ready", label: "Night ready to fall" },
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number]["id"];

/**
 * A local practice yard shown while the arena is being set up onchain (the PUBG-style
 * warm-up idea): the wait becomes play, and players learn every control by doing it once.
 * Nothing here touches the chain.
 */
export class WarmupYard {
  private el: HTMLElement;
  private hero: Character;
  private dummy: Character;
  private pos = new THREE.Vector2();
  private facing = 1;
  private held: number[] = [];
  private lastMove = 0;
  private lastSwing = 0;
  private dummyHp = 20;
  private steps = 0;
  private hasPearl = true;
  private pathTarget: { x: number; y: number } | null = null;
  private onReadyCb: (() => void) | null = null;
  private ready = false;
  private quests: Quest[] = [
    { id: "move", html: `Walk around: ${key("W")}${key("A")}${key("S")}${key("D")} or click the ground`, done: false },
    { id: "hit", html: `Hit the dummy: stand next to it, press ${key("SPACE")}`, done: false },
    { id: "shoot", html: `Step back 2+ tiles in line with it, press ${key("F")}`, done: false },
    { id: "power", html: `Blink with your Ender Pearl: ${key("E")}`, done: false },
  ];

  constructor(
    private scene: ArenaScene,
    private ui: HTMLElement,
    skin: number,
    name: string,
  ) {
    const c = scene.heroAt;
    this.pos.set(Math.round(c.x) - 1, Math.round(c.y));
    this.hero = new Character(skin, name, "#ffff80");
    this.hero.setRing(0xffe040);
    this.hero.place(this.pos.x, this.pos.y, 1);
    scene.scene.add(this.hero.root);
    scene.characters.set(200, this.hero);
    // Dummy two tiles east, on the first walkable tile we find.
    let dx = this.pos.x + 3;
    while (!walkable(dx, this.pos.y) && dx > this.pos.x + 1) dx--;
    this.dummy = new Character(3, "Training Dummy", "#ffcf40");
    this.dummy.place(dx, this.pos.y, 3);
    scene.scene.add(this.dummy.root);
    scene.characters.set(201, this.dummy);
    scene.campfire(this.pos.x, this.pos.y + 2);
    scene.follow = this.pos;
    scene.cameraMode = "game";
    scene.clearFog();
    scene.setTorch(this.pos.x, this.pos.y, true);

    this.el = document.createElement("div");
    this.el.className = "warmup";
    this.el.innerHTML = `
      <div class="wu-left panel">
        <div class="label">Warm up while the night falls</div>
        <ol class="quests" data-quests></ol>
      </div>
      <div class="wu-right panel">
        <div class="label">Preparing your match</div>
        <ul class="setup" data-setup>${SETUP_STEPS.map((s) => `<li data-step="${s.id}"><span class="dot"></span>${s.label}</li>`).join("")}</ul>
        <div class="muted wu-hint">Positions will live only inside MagicBlock's enclave. Nobody can peek.</div>
      </div>
      <div class="wu-ready" data-ready>
        <h2>THE NIGHT IS READY</h2>
        <button class="btn primary big" data-drop>🌙 Drop in <kbd>ENTER</kbd></button>
      </div>`;
    ui.appendChild(this.el);
    this.renderQuests();
    this.el.querySelector("[data-drop]")!.addEventListener("click", () => this.drop());
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    scene.renderer.domElement.addEventListener("pointerdown", this.onPointer);
    scene.onFrame = (dt) => this.frame(dt);
    (window as unknown as { __yard: WarmupYard }).__yard = this;
  }

  onReady(cb: () => void) {
    this.onReadyCb = cb;
  }

  setStep(id: SetupStep, state: "active" | "done", detail = "") {
    const li = this.el.querySelector<HTMLElement>(`[data-step="${id}"]`);
    if (!li) return;
    li.classList.toggle("active", state === "active");
    li.classList.toggle("done", state === "done");
    if (detail) li.dataset.detail = detail;
    if (state === "done") sfx.tick();
  }

  /** The chain is ready: show the drop-in call to action. */
  setReady() {
    this.ready = true;
    this.setStep("ready", "done");
    this.el.querySelector("[data-ready]")!.classList.add("on");
    sfx.streak(1);
  }

  private drop() {
    if (!this.ready) return;
    sfx.unlock();
    this.onReadyCb?.();
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.scene.renderer.domElement.removeEventListener("pointerdown", this.onPointer);
    this.scene.onFrame = () => {};
    this.scene.setGuide(0, 0, null);
    this.hero.dispose();
    this.dummy.dispose();
    this.scene.characters.delete(200);
    this.scene.characters.delete(201);
    this.scene.clearProps();
    this.el.remove();
  }

  // ───────────── quests ─────────────

  private renderQuests() {
    const list = this.el.querySelector("[data-quests]")!;
    list.innerHTML = this.quests.map((q) => `<li class="${q.done ? "done" : ""}">${q.html}</li>`).join("");
  }

  private complete(id: string) {
    const q = this.quests.find((x) => x.id === id);
    if (!q || q.done) return;
    q.done = true;
    this.renderQuests();
    sfx.chest();
    this.scene.floatText(this.pos.x, this.pos.y, "✓", "#6fe36f", 1.2);
    this.scene.burst(this.pos.x, 1, this.pos.y, 0xffe040, 18);
    if (this.quests.every((x) => x.done)) {
      this.scene.floatText(this.pos.x, this.pos.y, "READY!", "#ffe040", 1.6);
      sfx.win();
    }
  }

  // ───────────── input ─────────────

  private keyDir = (k: string) => ({ w: 0, arrowup: 0, d: 1, arrowright: 1, s: 2, arrowdown: 2, a: 3, arrowleft: 3 })[k.toLowerCase()] ?? -1;

  private onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    sfx.unlock();
    const d = this.keyDir(e.key);
    if (d >= 0) {
      e.preventDefault();
      this.pathTarget = null;
      if (!this.held.includes(d)) {
        this.held.unshift(d);
        if (!e.repeat) this.step(d, true);
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (e.key === "Enter") return this.drop();
    if (e.key === " ") {
      e.preventDefault();
      this.swing();
    } else if (k === "f") this.shoot();
    else if (k === "e" || k === "q") this.blink();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const d = this.keyDir(e.key);
    if (d >= 0) this.held = this.held.filter((x) => x !== d);
  };

  private onPointer = (e: PointerEvent) => {
    const t = this.scene.pickTile(e.clientX, e.clientY);
    if (t) {
      this.pathTarget = t;
      this.scene.burst(t.x, 0.1, t.y, 0xffe040, 5);
    }
  };

  private blocked = (x: number, y: number) => x === this.dummy.target.x && y === this.dummy.target.y;

  private step(d: number, tap = false) {
    const now = performance.now();
    if (now - this.lastMove < (tap ? 60 : 125)) return;
    this.lastMove = now;
    this.facing = d;
    const nx = this.pos.x + DX[d];
    const ny = this.pos.y + DY[d];
    if (walkable(nx, ny) && !this.blocked(nx, ny)) {
      this.pos.set(nx, ny);
      sfx.step();
      this.scene.dust(nx, ny);
      if (++this.steps >= 5) this.complete("move");
    }
  }

  private dummyDir() {
    const t = this.dummy.target;
    for (let d = 0; d < 4; d++) if (this.pos.x + DX[d] === t.x && this.pos.y + DY[d] === t.y) return d;
    return -1;
  }

  private hitDummy(dmg: number) {
    const t = this.dummy.target;
    this.dummy.hurt();
    sfx.hit();
    this.scene.hitStop(70);
    this.scene.floatText(t.x, t.y, `-${dmg}`, "#ffe040", 1.2);
    this.scene.burst(t.x, 0.8, t.y, 0xd8c070, 10);
    this.dummyHp -= dmg;
    if (this.dummyHp <= 0) {
      this.dummyHp = 20;
      this.scene.floatText(t.x, t.y, "Good!", "#6fe36f", 1.4);
    }
  }

  private swing() {
    const now = performance.now();
    if (now - this.lastSwing < 230) return;
    this.lastSwing = now;
    const d = this.dummyDir();
    if (d >= 0) this.facing = d;
    this.hero.swing();
    sfx.swing();
    if (d >= 0) {
      this.hitDummy(4);
      this.complete("hit");
    } else this.scene.floatText(this.pos.x, this.pos.y, "Get closer!", "#ffffff", 0.8);
  }

  private shoot() {
    const now = performance.now();
    if (now - this.lastSwing < 450) return;
    this.lastSwing = now;
    // Lined up with the dummy? Aim at it, like SPACE does in the real match.
    const t = this.dummy.target;
    if (t.x === this.pos.x) this.facing = t.y < this.pos.y ? 0 : 2;
    else if (t.y === this.pos.y) this.facing = t.x > this.pos.x ? 1 : 3;
    this.hero.facing = this.facing;
    this.hero.shoot();
    sfx.bow();
    let x = this.pos.x;
    let y = this.pos.y;
    let hit = false;
    for (let i = 0; i < 7; i++) {
      const nx = x + DX[this.facing];
      const ny = y + DY[this.facing];
      if (!walkable(nx, ny) && !this.blocked(nx, ny)) break;
      x = nx;
      y = ny;
      if (this.blocked(x, y)) {
        hit = true;
        break;
      }
    }
    this.scene.arrow(this.pos.x, this.pos.y, x, y);
    if (hit) {
      setTimeout(() => this.hitDummy(3), 250);
      if (Math.abs(x - this.pos.x) + Math.abs(y - this.pos.y) >= 2) this.complete("shoot");
    }
  }

  private blink() {
    if (!this.hasPearl) return;
    // Facing direction first, then any other open direction.
    const dirs = [this.facing, 0, 1, 2, 3];
    for (const d of dirs) for (let r = 3; r >= 2; r--) {
      const tx = this.pos.x + DX[d] * r;
      const ty = this.pos.y + DY[d] * r;
      this.facing = d;
      if (walkable(tx, ty) && !this.blocked(tx, ty)) {
        this.scene.burst(this.pos.x, 0.6, this.pos.y, 0x5fe0c8, 14);
        this.pos.set(tx, ty);
        this.hero.place(tx, ty, this.facing);
        this.scene.burst(tx, 0.6, ty, 0x5fe0c8, 14);
        sfx.bow();
        this.complete("power");
        // A practice pearl recharges after a moment.
        this.hasPearl = false;
        setTimeout(() => (this.hasPearl = true), 900);
        return;
      }
    }
  }

  private frame(_dt: number) {
    if (this.held.length) this.step(this.held[0]);
    else if (this.pathTarget) {
      const t = this.pathTarget;
      if (t.x === this.pos.x && t.y === this.pos.y) this.pathTarget = null;
      else if (performance.now() - this.lastMove >= 125) {
        const d = firstStepToward(this.pos.x, this.pos.y, (x, y) => x === t.x && y === t.y, this.blocked);
        if (d < 0) this.pathTarget = null;
        else this.step(d);
      }
    }
    this.hero.target.copy(this.pos);
    this.hero.facing = this.facing;
    this.scene.setTorch(this.hero.pos.x, this.hero.pos.y, true);
    // Point at the dummy until both attack quests are done.
    const need = !this.quests[1].done || !this.quests[2].done;
    this.scene.setGuide(this.hero.pos.x, this.hero.pos.y, need && this.hero.pos.distanceTo(this.dummy.target) > 1.5 ? this.dummy.target : null);
  }
}
