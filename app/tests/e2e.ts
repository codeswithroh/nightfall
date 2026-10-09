/**
 * End-to-end on devnet + MagicBlock's TEE: two burner players, a full match, and a cheat attempt.
 *   cd app && npm run e2e
 */
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "../src/lib/anchor";
import fs from "node:fs";
import os from "node:os";
import { NightfallClient, arenaPda, decodeName, visionPda, worldPda } from "../src/lib/nightfall";
import { ACTION, STATUS } from "../src/lib/config";
import { DX, DY, firstStepToward } from "../src/lib/map";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function main() {
  const funder = new NightfallClient(
    Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8")))),
  );
  const host = new NightfallClient(Keypair.generate());
  const guest = new NightfallClient(Keypair.generate());
  const STAKE = new BN(0.01 * LAMPORTS_PER_SOL);
  log("funding burners", host.publicKey.toBase58(), guest.publicKey.toBase58());
  await funder.fund(host.publicKey, 0.06 * LAMPORTS_PER_SOL);
  await funder.fund(guest.publicKey, 0.06 * LAMPORTS_PER_SOL);

  const id = new BN(Date.now());
  log("arena", id.toString(), arenaPda(id).toBase58());
  log("create:", await host.createArena(id, STAKE, 2, "Ember", 0));
  const slot = await guest.joinArena(id, "Frost", 2);
  log("guest joined slot", slot);
  const arena0 = (await host.fetchArena(id))!.arena;
  log("players:", arena0.names.slice(0, arena0.playerCount).map(decodeName));

  log("seal host vision:", await host.sealMyVision(id, 0));
  log("seal guest vision:", await guest.sealMyVision(id, 1));

  const started = await host.startMatch(id, (s) => log("  host:", s));
  log("match live, vrf =", started.vrf);
  try {
    log("crank scheduled:", await host.scheduleTicks(id, 2));
  } catch (e) {
    log("crank schedule failed (clients will tick):", (e as Error).message.split("\n").slice(0, 3).join(" | "));
  }

  // ── privacy checks ──
  const hostConn = await host.teeConn();
  const guestConn = await guest.teeConn();
  const mine = await guest.fetchVision(id, 1);
  log("guest reads own vision →", mine ? `me @ (${mine.me[0]},${mine.me[1]}) hp ${mine.me[2]}` : "NULL (unexpected)");
  const peekVision = await guestConn.getAccountInfo(visionPda(id, 0));
  log("guest peeks host vision →", peekVision ? "VISIBLE ❌" : "null ✅ sealed");
  const peekWorldGuest = await guestConn.getAccountInfo(worldPda(id));
  const peekWorldHost = await hostConn.getAccountInfo(worldPda(id));
  log("guest peeks world →", peekWorldGuest ? "VISIBLE ❌" : "null ✅ sealed");
  log("host peeks world →", peekWorldHost ? "VISIBLE ❌" : "null ✅ sealed (even the host)");
  const spectator = new NightfallClient(Keypair.generate());
  const arenaSpect = await (await spectator.teeConn()).getAccountInfo(arenaPda(id));
  log("spectator reads public arena →", arenaSpect ? "ok ✅" : "null ❌");
  const base = await funder.base.getAccountInfo(worldPda(id));
  log("world on base layer owned by", base?.owner.toBase58(), "(delegation program — nothing to read)");

  // ── hunt: both players path toward each other using only what the harness knows ──
  const clients = [host, guest];
  const latencies: number[] = [];
  let state = await Promise.all([host.fetchVision(id, 0), guest.fetchVision(id, 1)]);
  const firstSeen = { at: -1 };
  for (let step = 0; step < 220; step++) {
    const arena = (await host.fetchArena(id))!.arena;
    if (arena.status !== STATUS.live) break;
    for (let i = 0; i < 2; i++) {
      const me = state[i]!;
      const other = state[1 - i]!;
      const [mx, my] = me.me;
      const [ox, oy] = other.me;
      const seen = me.seenCount > 0;
      if (seen && firstSeen.at < 0) {
        firstSeen.at = step;
        log(`player ${i} spotted player ${me.seen[0][0]} through the fog at step ${step}`);
      }
      const adj = Math.abs(mx - ox) + Math.abs(my - oy) === 1;
      let action: number = ACTION.move;
      let dir: number;
      if (adj) {
        action = ACTION.sword;
        dir = [0, 1, 2, 3].find((d) => mx + DX[d] === ox && my + DY[d] === oy)!;
      } else {
        dir = firstStepToward(mx, my, (x, y) => Math.abs(x - ox) + Math.abs(y - oy) === 1);
        if (dir < 0) dir = step % 4;
      }
      const before = Date.now();
      const sig = await clients[i].sendEr([clients[i].actIx(id, 2, action, dir)]).catch((e) => {
        if (!String(e).includes("Cooldown")) log("act err", String(e).split("\n")[0]);
        return null;
      });
      if (sig) latencies.push(Date.now() - before);
    }
    state = await Promise.all([host.fetchVision(id, 0), guest.fetchVision(id, 1)]);
    if (step % 10 === 0) log(`step ${step}: host hp ${state[0]!.me[2]} guest hp ${state[1]!.me[2]}`);
  }
  latencies.sort((a, b) => a - b);
  log(`act round-trip (send+confirm) p50 ${latencies[latencies.length >> 1]}ms p90 ${latencies[Math.floor(latencies.length * 0.9)]}ms over ${latencies.length} txs`);

  const final = (await host.fetchArena(id))!.arena;
  log("status", final.status, "winner slot", final.winner, "kills", final.kills.slice(0, 2), "feed", final.feed[0]);
  if (final.status !== STATUS.ended) throw new Error("match did not end");

  log("reveal:", await host.reveal(id));
  const revealed = await guestConn.getAccountInfo(worldPda(id));
  log("after reveal, guest reads world →", revealed ? "visible ✅" : "still sealed");
  log("settle:", await host.settle(id));
  const winner: PublicKey = final.players[final.winner];
  const before = await funder.base.getBalance(winner);
  log("claim:", await host.claim(id, winner, 90_000));
  const after = await funder.base.getBalance(winner);
  log(`winner received ${(after - before) / LAMPORTS_PER_SOL} SOL`);
  log("✅ e2e complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
