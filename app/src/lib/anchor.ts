// @coral-xyz/anchor ships CommonJS; Node's ESM loader can't see its named exports, Vite can.
// Re-export through whichever shape we got so the same code runs in the browser and in tsx.
import * as ns from "@coral-xyz/anchor";

// Indexed access (not `ns.default`) so the browser bundler doesn't warn about a missing export.
const DEFAULT = "default";
const a = ((ns as unknown as Record<string, typeof ns | undefined>)[DEFAULT] ?? ns) as typeof ns;

export const BN = a.BN;
export type BN = ns.BN;
export const Program = a.Program;
export type Program<T extends ns.Idl> = ns.Program<T>;
export const AnchorProvider = a.AnchorProvider;
export type Wallet = ns.Wallet;
