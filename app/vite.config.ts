import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // getAuthToken dynamically imports bs58; pre-bundle so the dev server doesn't reload mid-game.
    include: ["bs58", "buffer", "@coral-xyz/anchor", "@solana/web3.js", "@magicblock-labs/ephemeral-rollups-sdk", "tweetnacl", "three"],
  },
  define: { "process.env": {}, global: "globalThis" },
  build: { target: "es2022", chunkSizeWarningLimit: 2500 },
});
