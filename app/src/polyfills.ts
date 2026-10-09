// Must be the first import: web3.js / anchor / the MagicBlock SDK touch Buffer at load time.
import { Buffer } from "buffer";

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
