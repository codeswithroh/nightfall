import { PublicKey } from "@solana/web3.js";
import rawIdl from "../idl/nightfall.json";

const env: Record<string, string | undefined> =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env) ||
  (typeof process !== "undefined" ? process.env : {});

export const PROGRAM_ID = new PublicKey(env.VITE_PROGRAM_ID || rawIdl.address);
export const BASE_ENDPOINT = env.VITE_BASE_ENDPOINT || "https://rpc.magicblock.app/devnet";
export const TEE_ENDPOINT = (env.VITE_TEE_ENDPOINT || "https://devnet-tee.magicblock.app").replace(/\/$/, "");
export const TEE_WS_ENDPOINT = (env.VITE_TEE_WS_ENDPOINT || TEE_ENDPOINT.replace(/^http/, "ws")).replace(/\/$/, "");
/** MagicBlock's devnet TEE validator — every arena PDA is delegated here. */
export const TEE_VALIDATOR = new PublicKey(env.VITE_VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const EPHEMERAL_VAULT_ID = new PublicKey("MagicVau1t999999999999999999999999999999999");
/** VRF oracle queue that lives inside the ephemeral rollup. */
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");

export const SEEDS = { arena: "arena", world: "world", vision: "vision", vault: "vault", broadcast: "broadcast", registry: "registry" } as const;

export const NAME_LEN = 12;
export const MAX_PLAYERS = 6;
export const NONE = 255;
export const STATUS = { lobby: 0, spawning: 1, live: 2, ended: 3, paid: 4 } as const;
export const ACTION = { move: 0, sword: 1, bow: 2, power: 3 } as const;
export const CHEST = { diamondSword: 1, goldenApple: 2, quiver: 3, axe: 4, hammer: 5, spear: 6, pearl: 7, cloak: 8, flare: 9 } as const;

/** Mirrors WEAPONS in logic.rs: name, damage, reach, flavour. */
export const WEAPONS = [
  { name: "Fists", dmg: 0, reach: 1, note: "" },
  { name: "Wooden Sword", dmg: 4, reach: 1, note: "quick" },
  { name: "Diamond Sword", dmg: 6, reach: 1, note: "quick and sharp" },
  { name: "Battle Axe", dmg: 9, reach: 1, note: "huge hit, slow swing" },
  { name: "War Hammer", dmg: 5, reach: 1, note: "knocks them back 2 tiles" },
  { name: "Spear", dmg: 5, reach: 2, note: "hits from 2 tiles away" },
];
export const POWERS: Record<number, { name: string; note: string; icon: string }> = {
  7: { name: "Ender Pearl", note: "blink 3 tiles ahead, even through walls", icon: "pearl" },
  8: { name: "Cloak", note: "invisible and silent for 8s (attacking breaks it)", icon: "cloak" },
  9: { name: "Flare", note: "see twice as far for 8s, even into tall grass", icon: "flare" },
};
export const CHEST_LOOT_NAMES: Record<number, string> = {
  1: "Diamond Sword",
  2: "Golden Apple",
  3: "Quiver of Arrows",
  4: "Battle Axe",
  5: "War Hammer",
  6: "Spear",
  7: "Ender Pearl",
  8: "Cloak",
  9: "Flare",
};
export const CAUSE = { sword: 1, bow: 2, border: 3 } as const;
export const MAX_HP = 20;
/** Mirrors logic.rs so the client can draw the border without asking anyone. */
export const ZONE = { start: 12, min: 1, graceSecs: 60, shrinkSecs: 14 } as const;
export const VISION_R2 = 20;
export const FLARE_R2 = 64;
export const DAY_R2 = 50;
export const DAY_FLARE_R2 = 100;
export const MODE = { night: 0, day: 1 } as const;
/** Mirrors logic.rs: no player damage for the first seconds of a match. */
export const SPAWN_SAFE_SECS = 10;

export const zoneAt = (startTs: number, nowSecs: number) => {
  const elapsed = nowSecs - startTs;
  if (elapsed < ZONE.graceSecs) return ZONE.start;
  return Math.max(ZONE.min, ZONE.start - (Math.floor((elapsed - ZONE.graceSecs) / ZONE.shrinkSecs) + 1));
};

export const isDevnet = BASE_ENDPOINT.includes("devnet");
export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}${isDevnet ? "?cluster=devnet" : ""}`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}${isDevnet ? "?cluster=devnet" : ""}`;
