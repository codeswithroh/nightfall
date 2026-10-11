import { BN } from "../lib/anchor";
import { ACTION, STATUS } from "../lib/config";
import { DX, DY, firstStepToward, inZone, tileAt, walkable } from "../lib/map";
import { visionPda, type NightfallClient, type VisionState } from "../lib/nightfall";

/**
 * A bot is just another wallet. It plays from its own sealed Vision — the same fog as humans —
 * so it can't cheat either.
 */
export class Bot {
  private vision: VisionState | null = null;
  private stop: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wander = Math.floor(Math.random() * 4);
  private lastAttack = 0;
  private startedAt = Date.now();
  /** Each bot has a fighting style so fights look different: keep distance and shoot, charge in, or mix. */
  readonly style: "archer" | "brawler" | "mixed" = (["archer", "brawler", "mixed"] as const)[Math.floor(Math.random() * 3)];

  constructor(
    readonly client: NightfallClient,
    readonly arenaId: BN,
    readonly slot: number,
    private playerCount: number,
    /** "easy" bots react slower and hesitate more: good for a first match. */
    private difficulty: "easy" | "normal" = "normal",
  ) {}

  async start() {
    this.stop = await this.client.watch(visionPda(this.arenaId, this.slot), (d) => {
      this.vision = this.client.decodeVision(d);
    }, 500);
    // Human-ish reaction time; each bot is a little different.
    const base = this.difficulty === "easy" ? 640 : 430;
    this.timer = setInterval(() => void this.think(), base + Math.random() * 160);
  }

  private clearLine(x: number, y: number, tx: number, ty: number) {
    const d = tx === x ? (ty < y ? 0 : 2) : tx > x ? 1 : 3;
    while (x !== tx || y !== ty) {
      x += DX[d];
      y += DY[d];
      if (x === tx && y === ty) return true;
      if (tileAt(x, y) === 1) return false;
    }
    return true;
  }

  dispose() {
    this.stop?.();
    if (this.timer) clearInterval(this.timer);
  }

  private async think() {
    const v = this.vision;
    if (!v || v.status !== STATUS.live || !v.me[6]) return;
    const [mx, my, , , , arrows] = v.me;
    const enemies = v.seen.slice(0, v.seenCount).map((s) => ({ x: s[1], y: s[2] }));
    const occupied = (x: number, y: number) => enemies.some((e) => e.x === x && e.y === y);
    let action: number = ACTION.move;
    let dir = -1;

    // Powers: flare toward sounds, slip away (cloak / pearl) when hurt and in a fight.
    const power = v.me[7];
    const hp = v.me[2];
    if (power === 9 && v.heard && !enemies.length) return void this.client.act(this.arenaId, this.playerCount, ACTION.power, 0).catch(() => {});
    if ((power === 8 || power === 7) && hp <= 8 && enemies.length) {
      const e = enemies[0];
      const away = Math.abs(e.x - mx) > Math.abs(e.y - my) ? (e.x > mx ? 3 : 1) : e.y > my ? 0 : 2;
      return void this.client.act(this.arenaId, this.playerCount, ACTION.power, away).catch(() => {});
    }
    // Bots hesitate sometimes, so a quick human can win the exchange.
    const hesitate = Math.random() < (this.difficulty === "easy" ? 0.35 : 0.18);
    // Easy bots spend the opening looting and exploring instead of hunting.
    const calm = this.difficulty === "easy" && Date.now() - this.startedAt < 25_000;
    // Archers (and mixed bots, half the time) prefer the bow while they have arrows.
    const preferBow = arrows > 0 && (this.style === "archer" || (this.style === "mixed" && Math.random() < 0.5));
    const lined = enemies.find((e) => (e.x === mx || e.y === my) && Math.abs(e.x - mx) + Math.abs(e.y - my) <= 6 && this.clearLine(mx, my, e.x, e.y));
    const adjacent = [0, 1, 2, 3].find((d) => occupied(mx + DX[d], my + DY[d]));
    const dirTo = (e: { x: number; y: number }) => (e.x === mx ? (e.y < my ? 0 : 2) : e.x > mx ? 1 : 3);
    // 1. Lined up and we like arrows → shoot (archers even point-blank, to keep it varied).
    if (!hesitate && preferBow && lined && Date.now() - this.lastAttack > 650) {
      action = ACTION.bow;
      dir = dirTo(lined);
    }
    // 2. Someone adjacent → swing (an archer first tries to back off a step).
    if (dir < 0 && !hesitate && adjacent !== undefined && Date.now() - this.lastAttack > 260) {
      const back = (adjacent + 2) % 4;
      if (this.style === "archer" && arrows > 0 && walkable(mx + DX[back], my + DY[back]) && !occupied(mx + DX[back], my + DY[back]) && Math.random() < 0.6) {
        dir = back;
      } else {
        action = ACTION.sword;
        dir = adjacent;
      }
    }
    // 2b. Not lined up yet: archers step to share a row or column at range instead of charging.
    if (dir < 0 && !calm && preferBow && enemies.length) {
      const e = enemies[0];
      dir = firstStepToward(mx, my, (x, y) => (x === e.x || y === e.y) && Math.abs(x - e.x) + Math.abs(y - e.y) >= 2 && Math.abs(x - e.x) + Math.abs(y - e.y) <= 5, occupied);
    }
    // 3. Outside / near the border → head for the centre.
    if (dir < 0 && !inZone(Math.max(1, v.zone - 1), mx, my))
      dir = firstStepToward(mx, my, (x, y) => inZone(Math.max(1, v.zone - 2), x, y), occupied);
    // 4. Visible enemy → chase. Visible chest → loot.
    if (dir < 0 && enemies.length && !calm)
      dir = firstStepToward(mx, my, (x, y) => enemies.some((e) => Math.abs(e.x - x) + Math.abs(e.y - y) === 1), occupied);
    if (dir < 0 && v.chestCount > 0) {
      const chests = v.chests.slice(0, v.chestCount);
      dir = firstStepToward(mx, my, (x, y) => chests.some((c) => c[0] === x && c[1] === y), occupied);
    }
    // 5. Heard footsteps → creep toward the sound.
    if (dir < 0 && v.heard && !calm && Math.random() < (this.difficulty === "easy" ? 0.5 : 1)) {
      const ks = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => (v.heard >> k) & 1);
      const k = ks[Math.floor(Math.random() * ks.length)];
      const ang = (k * Math.PI) / 4;
      const tx = Math.round(mx + Math.sin(ang) * 4);
      const ty = Math.round(my - Math.cos(ang) * 4);
      dir = firstStepToward(mx, my, (x, y) => Math.abs(x - tx) + Math.abs(y - ty) <= 1, occupied);
    }
    // 6. Wander, drifting toward the centre.
    if (dir < 0) {
      if (Math.random() < 0.25 || !walkable(mx + DX[this.wander], my + DY[this.wander])) {
        const towardCenter = Math.abs(11.5 - mx) > Math.abs(11.5 - my) ? (mx < 11.5 ? 1 : 3) : my < 11.5 ? 2 : 0;
        this.wander = Math.random() < 0.6 ? towardCenter : Math.floor(Math.random() * 4);
      }
      dir = this.wander;
    }
    if (action !== ACTION.move) this.lastAttack = Date.now();
    await this.client.act(this.arenaId, this.playerCount, action, dir).catch(() => {});
  }
}
