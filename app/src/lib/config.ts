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

export const SEEDS = { arena: "arena", world: "world", vision: "vision", vault: "vault" } as const;

export const NAME_LEN = 12;
export const MAX_PLAYERS = 6;
export const NONE = 255;
export const STATUS = { lobby: 0, spawning: 1, live: 2, ended: 3, paid: 4 } as const;
export const ACTION = { move: 0, sword: 1, bow: 2 } as const;
export const CHEST = { diamondSword: 1, goldenApple: 2, quiver: 3 } as const;
export const CAUSE = { sword: 1, bow: 2, border: 3 } as const;
export const MAX_HP = 20;
/** Mirrors logic.rs so the client can draw the border without asking anyone. */
export const ZONE = { start: 12, min: 1, graceSecs: 40, shrinkSecs: 8 } as const;
export const VISION_R2 = 20;
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
