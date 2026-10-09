import { BN } from "../lib/anchor";
import { ACTION, STATUS } from "../lib/config";
import { DX, DY, firstStepToward, inZone, walkable } from "../lib/map";
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

  constructor(
    readonly client: NightfallClient,
    readonly arenaId: BN,
    readonly slot: number,
    private playerCount: number,
  ) {}

  async start() {
    this.stop = await this.client.watch(visionPda(this.arenaId, this.slot), (d) => {
      this.vision = this.client.decodeVision(d);
    }, 500);
    this.timer = setInterval(() => void this.think(), 380 + Math.random() * 120);
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

    // 1. Adjacent enemy → swing.
    for (let d = 0; d < 4 && dir < 0; d++)
      if (occupied(mx + DX[d], my + DY[d]) && Date.now() - this.lastAttack > 260) {
        action = ACTION.sword;
        dir = d;
      }
    // 2. Enemy in a straight line → shoot.
    if (dir < 0 && arrows > 0 && Date.now() - this.lastAttack > 650)
      for (const e of enemies) {
        if (e.x === mx || e.y === my) {
          const d = e.x === mx ? (e.y < my ? 0 : 2) : e.x > mx ? 1 : 3;
          if (Math.abs(e.x - mx) + Math.abs(e.y - my) <= 6) {
            action = ACTION.bow;
            dir = d;
            break;
          }
        }
      }
    // 3. Outside / near the border → head for the centre.
    if (dir < 0 && !inZone(Math.max(1, v.zone - 1), mx, my))
      dir = firstStepToward(mx, my, (x, y) => inZone(Math.max(1, v.zone - 2), x, y), occupied);
    // 4. Visible enemy → chase. Visible chest → loot.
    if (dir < 0 && enemies.length)
      dir = firstStepToward(mx, my, (x, y) => enemies.some((e) => Math.abs(e.x - x) + Math.abs(e.y - y) === 1), occupied);
    if (dir < 0 && v.chestCount > 0) {
      const chests = v.chests.slice(0, v.chestCount);
      dir = firstStepToward(mx, my, (x, y) => chests.some((c) => c[0] === x && c[1] === y), occupied);
    }
    // 5. Wander, drifting toward the centre.
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
