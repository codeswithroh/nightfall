import { Keypair, PublicKey } from "@solana/web3.js";
import { NightfallClient } from "../src/lib/nightfall";
const c = new NightfallClient(Keypair.generate());
const conn = await c.teeConn();
for (const a of process.argv.slice(2)) {
  const info = await conn.getAccountInfo(new PublicKey(a)).catch((e) => String(e));
  console.log(a, typeof info === "string" ? info : info ? `owner ${info.owner.toBase58()} len ${info.data.length} lamports ${info.lamports}` : null);
}
const r = await fetch(c.teeRpcUrl!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [process.argv[2], { encoding: "base64" }] }) });
console.log((await r.text()).slice(0, 400));
