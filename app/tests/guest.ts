/**
 * Join an arena from the terminal as a bot (its own burner, its own sealed Vision).
 *   cd app && npm run guest -- <arena code> [count]
 * Funds each bot from ~/.config/solana/id.json.
 */
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "node:fs";
import os from "node:os";
import { BN } from "../src/lib/anchor";
import { NightfallClient, arenaPda } from "../src/lib/nightfall";
import { STATUS } from "../src/lib/config";
import { Bot } from "../src/game/bot";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [code, countArg] = process.argv.slice(2);
if (!code) {
  console.error("usage: npm run guest -- <arena code> [count]");
  process.exit(1);
}
const id = new BN(code);
const names = ["Zomboy", "Skelly", "Spidra", "Witchy", "Golem"];

async function main() {
  const funder = new NightfallClient(
    Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8")))),
  );
  const count = Number(countArg ?? 1);
  const bots: { client: NightfallClient; slot: number }[] = [];
  for (let i = 0; i < count; i++) {
    const client = new NightfallClient(Keypair.generate());
    const arena = (await funder.fetchArena(id))?.arena;
    if (!arena) throw new Error("arena not found");
    await funder.fund(client.publicKey, 0.012 * LAMPORTS_PER_SOL + arena.stake.toNumber());
    const slot = await client.joinArena(id, names[i % names.length], Math.floor(Math.random() * 6));
    await client.sealMyVision(id, slot);
    console.log(`${names[i % names.length]} joined slot ${slot + 1} and sealed its vision`);
    bots.push({ client, slot });
  }
  console.log("waiting for the host to start…");
  for (;;) {
    const found = await funder.fetchArena(id);
    if (found?.arena.status === STATUS.live) {
      const n = found.arena.playerCount;
      // IDLE=1 keeps the guests standing still (handy for testing).
      if (!process.env.IDLE) for (const b of bots) void new Bot(b.client, id, b.slot, n).start();
      console.log(`match live with ${n} players — bots are hunting`);
      break;
    }
    await sleep(1500);
  }
  const conn = await funder.teeConn();
  for (;;) {
    const info = await conn.getAccountInfo(arenaPda(id));
    if (info && funder.decodeArena(info.data).status >= STATUS.ended) {
      console.log("match over");
      process.exit(0);
    }
    await sleep(3000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
