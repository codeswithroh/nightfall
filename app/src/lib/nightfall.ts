import { AnchorProvider, BN, Program, type Wallet } from "./anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  getAuthToken,
  permissionPdaFromAccount,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import rawIdl from "../idl/nightfall.json";
import type { Nightfall } from "../idl/nightfall";
import {
  BASE_ENDPOINT,
  EPHEMERAL_VAULT_ID,
  NAME_LEN,
  PROGRAM_ID,
  SEEDS,
  STATUS,
  TEE_ENDPOINT,
  TEE_VALIDATOR,
  TEE_WS_ENDPOINT,
  VRF_EPHEMERAL_QUEUE,
} from "./config";

export interface ArenaState {
  arenaId: BN;
  host: PublicKey;
  status: number;
  maxPlayers: number;
  playerCount: number;
  stake: BN;
  players: PublicKey[];
  names: number[][];
  skins: number[];
  alive: number;
  kills: number[];
  spawnRequestedTs: BN;
  startTs: BN;
  endTs: BN;
  lastZoneTick: BN;
  zone: number;
  winner: number;
  feed: number[][];
  feedSeq: number;
  tick: number;
  mapId: number;
  mode: number;
}

export interface BroadcastState {
  arenaId: BN;
  snapshotTs: BN;
  x: number[];
  y: number[];
  hp: number[];
  facing: number[];
  version: number;
}

export interface RegistryState {
  ids: BN[];
  maps: number[];
  modes: number[];
  created: BN[];
  head: number;
}

export interface VisionState {
  arenaId: BN;
  slot: number;
  owner: PublicKey;
  version: number;
  status: number;
  zone: number;
  me: number[];
  hitDir: number;
  hitSeq: number;
  seenCount: number;
  seen: number[][];
  chestCount: number;
  chests: number[][];
  shots: number[][];
  /** Bit k = an unseen enemy is within earshot in compass octant k (0 = N, clockwise). */
  heard: number;
}

export interface WorldState {
  x: number[];
  y: number[];
  hp: number[];
  facing: number[];
  weapon: number[];
  arrows: number[];
  chests: number[][];
  power: number[];
}

/** Minimal key-value store so the client works in the browser and in node. */
export interface KV {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

export const memoryKV = (): KV => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

export const browserKV = (): KV => ({
  get: (k) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
});

export const encodeName = (name: string): number[] => {
  const bytes = Array.from(new TextEncoder().encode(name.trim().slice(0, NAME_LEN))).slice(0, NAME_LEN);
  while (bytes.length < NAME_LEN) bytes.push(0);
  return bytes;
};

export const decodeName = (bytes: number[]): string =>
  new TextDecoder().decode(Uint8Array.from(bytes.filter((b) => b !== 0)));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const keypairWallet = (kp: Keypair) => ({
  publicKey: kp.publicKey,
  payer: kp,
  async signTransaction<T>(tx: T): Promise<T> {
    (tx as unknown as Transaction).partialSign(kp);
    return tx;
  },
  async signAllTransactions<T>(txs: T[]): Promise<T[]> {
    txs.forEach((tx) => (tx as unknown as Transaction).partialSign(kp));
    return txs;
  },
});

const idl = { ...(rawIdl as object), address: PROGRAM_ID.toBase58() } as Nightfall;

/**
 * Send and confirm by polling, rebroadcasting every 1.5 s. Public devnet RPCs silently drop
 * transactions; web3.js's default confirm then waits out the whole blockhash (60–90 s). This
 * gives up after `timeoutMs` and re-signs with a fresh blockhash, up to `attempts` times.
 */
export async function sendReliably(
  conn: Connection,
  build: (blockhash: string) => Transaction,
  { timeoutMs = 20_000, attempts = 3, label = "transaction" } = {},
): Promise<string> {
  let lastErr: unknown = null;
  // Every signature we've sent stays in play: a "dropped" attempt can still land late, and the
  // retry must not execute the same action twice.
  const sigs: string[] = [];
  const raws: Buffer[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const raw = build(blockhash).serialize();
    raws.push(raw);
    sigs.push(await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }));
    const deadline = Date.now() + timeoutMs;
    let lastSend = Date.now();
    while (Date.now() < deadline) {
      await sleep(500);
      const statuses = (await conn.getSignatureStatuses(sigs).catch(() => null))?.value ?? [];
      for (let i = 0; i < sigs.length; i++) {
        const st = statuses[i];
        if (!st) continue;
        if (st.err) {
          const info = await conn.getTransaction(sigs[i], { maxSupportedTransactionVersion: 0 }).catch(() => null);
          throw new Error(`${label} failed: ${JSON.stringify(st.err)}\n${info?.meta?.logMessages?.join("\n") ?? ""}`);
        }
        if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return sigs[i];
      }
      if (Date.now() - lastSend > 1500) {
        lastSend = Date.now();
        for (const r of raws) void conn.sendRawTransaction(r, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
      }
    }
    lastErr = new Error(`${label} was not confirmed in ${(timeoutMs * (attempt + 1)) / 1000}s. The network may be congested; try again.`);
  }
  throw lastErr;
}

export const arenaPda = (id: BN) =>
  PublicKey.findProgramAddressSync([Buffer.from(SEEDS.arena), id.toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
export const worldPda = (id: BN) =>
  PublicKey.findProgramAddressSync([Buffer.from(SEEDS.world), id.toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
export const visionPda = (id: BN, slot: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.vision), id.toArrayLike(Buffer, "le", 8), Buffer.from([slot])],
    PROGRAM_ID,
  )[0];
export const broadcastPda = (id: BN) =>
  PublicKey.findProgramAddressSync([Buffer.from(SEEDS.broadcast), id.toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
export const registryPda = () => PublicKey.findProgramAddressSync([Buffer.from(SEEDS.registry)], PROGRAM_ID)[0];
export const vaultPda = (id: BN) =>
  PublicKey.findProgramAddressSync([Buffer.from(SEEDS.vault), id.toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];

/**
 * One client per wallet. Base-layer calls go to Solana devnet; everything during the match goes
 * through this wallet's own authenticated TEE connection — which is exactly what scopes what it can see.
 */
export class NightfallClient {
  readonly keypair: Keypair;
  readonly base: Connection;
  readonly program: Program<Nightfall>;
  private kv: KV;
  private tee: Connection | null = null;
  private teeExpiry = 0;
  private teeUrl: string | null = null;
  private blockhash: { value: string; at: number } | null = null;

  constructor(keypair: Keypair, kv: KV = memoryKV()) {
    this.keypair = keypair;
    this.kv = kv;
    this.base = new Connection(BASE_ENDPOINT, "confirmed");
    const provider = new AnchorProvider(this.base, keypairWallet(keypair) as unknown as Wallet, {
      commitment: "confirmed",
    });
    this.program = new Program<Nightfall>(idl, provider);
  }

  get publicKey() {
    return this.keypair.publicKey;
  }

  /** Tokenized TEE RPC for this wallet (for explorer links / the X-ray panel). */
  get teeRpcUrl() {
    return this.teeUrl;
  }

  async teeConn(): Promise<Connection> {
    if (this.tee && Date.now() < this.teeExpiry - 60_000) return this.tee;
    const cacheKey = `nightfall-tee-${TEE_ENDPOINT}-${this.publicKey.toBase58()}`;
    let auth: { token: string; expiresAt: number } | null = null;
    try {
      const cached = this.kv.get(cacheKey);
      if (cached) auth = JSON.parse(cached);
    } catch {
      auth = null;
    }
    const expMs = (a: { expiresAt: number }) => (a.expiresAt > 1e12 ? a.expiresAt : a.expiresAt * 1000);
    if (!auth || expMs(auth) - Date.now() < 120_000) {
      auth = await getAuthToken(TEE_ENDPOINT, this.publicKey, (msg) =>
        Promise.resolve(nacl.sign.detached(msg, this.keypair.secretKey)),
      );
      this.kv.set(cacheKey, JSON.stringify(auth));
    }
    this.teeUrl = `${TEE_ENDPOINT}?token=${auth.token}`;
    this.tee = new Connection(this.teeUrl, { wsEndpoint: `${TEE_WS_ENDPOINT}?token=${auth.token}`, commitment: "confirmed" });
    this.teeExpiry = expMs(auth);
    return this.tee;
  }

  // ───────────── transaction plumbing ─────────────

  async sendBase(ixs: TransactionInstruction[], signers: Keypair[] = []): Promise<string> {
    return sendReliably(
      this.base,
      (blockhash) => {
        const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), ...ixs);
        tx.feePayer = this.publicKey;
        tx.recentBlockhash = blockhash;
        tx.sign(this.keypair, ...signers);
        return tx;
      },
      { label: "Solana transaction" },
    );
  }

  private async erBlockhash(force = false) {
    if (!force && this.blockhash && Date.now() - this.blockhash.at < 15_000) return this.blockhash.value;
    const conn = await this.teeConn();
    this.blockhash = { value: (await conn.getLatestBlockhash()).blockhash, at: Date.now() };
    return this.blockhash.value;
  }

  private nonce = Math.floor(Math.random() * 50_000);

  private async buildEr(ixs: TransactionInstruction[]) {
    // Two identical moves inside one blockhash would hash to the same signature and the second
    // would be dropped as a duplicate, so every ER tx carries a unique compute-limit "nonce".
    this.nonce = (this.nonce + 1) % 100_000;
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 + this.nonce }), ...ixs);
    tx.feePayer = this.publicKey;
    tx.recentBlockhash = await this.erBlockhash();
    tx.sign(this.keypair);
    return tx;
  }

  /** ER transaction, confirmed. Throws with program logs if it failed. */
  async sendEr(ixs: TransactionInstruction[]): Promise<string> {
    const conn = await this.teeConn();
    return sendReliably(
      conn,
      (blockhash) => {
        this.nonce = (this.nonce + 1) % 100_000;
        const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 + this.nonce }), ...ixs);
        tx.feePayer = this.publicKey;
        tx.recentBlockhash = blockhash;
        tx.sign(this.keypair);
        return tx;
      },
      { timeoutMs: 12_000, label: "Rollup transaction" },
    );
  }

  /** ER transaction, fire-and-forget — used for every step and swing during the match. */
  async sendErFast(ixs: TransactionInstruction[]): Promise<string> {
    const conn = await this.teeConn();
    const tx = await this.buildEr(ixs);
    return conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  }

  async waitOnEr(pda: PublicKey, timeoutMs = 30_000) {
    const conn = await this.teeConn();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await conn.getAccountInfo(pda).catch(() => null)) return;
      await sleep(600);
    }
    throw new Error(`${pda.toBase58()} never appeared on the rollup`);
  }

  // ───────────── reads ─────────────

  decodeArena(data: Buffer) {
    return this.program.coder.accounts.decode("arena", data) as ArenaState;
  }

  decodeVision(data: Buffer) {
    return this.program.coder.accounts.decode("vision", data) as VisionState;
  }

  decodeBroadcast(data: Buffer) {
    return this.program.coder.accounts.decode("broadcast", data) as BroadcastState;
  }

  /** Recently opened arenas, newest first. */
  async fetchRegistry(): Promise<{ id: BN; map: number; mode: number; created: number }[]> {
    const info = await this.base.getAccountInfo(registryPda()).catch(() => null);
    if (!info) return [];
    const r = this.program.coder.accounts.decode("registry", info.data) as RegistryState;
    const out = [];
    for (let k = 1; k <= r.ids.length; k++) {
      const i = (r.head - k + r.ids.length) % r.ids.length;
      if (r.ids[i].isZero()) continue;
      out.push({ id: r.ids[i], map: r.maps[i], mode: r.modes[i], created: r.created[i].toNumber() });
    }
    return out;
  }

  decodeWorld(data: Buffer) {
    return this.program.coder.accounts.decode("world", data) as WorldState;
  }

  /** Arena from wherever it currently lives: the base layer in the lobby, the TEE during play. */
  async fetchArena(id: BN): Promise<{ arena: ArenaState; onEr: boolean } | null> {
    const info = await this.base.getAccountInfo(arenaPda(id)).catch(() => null);
    if (info && info.owner.equals(PROGRAM_ID)) return { arena: this.decodeArena(info.data), onEr: false };
    if (!info) return null;
    const conn = await this.teeConn();
    const er = await conn.getAccountInfo(arenaPda(id)).catch(() => null);
    return er ? { arena: this.decodeArena(er.data), onEr: true } : null;
  }

  async fetchVision(id: BN, slot: number): Promise<VisionState | null> {
    const conn = await this.teeConn();
    const info = await conn.getAccountInfo(visionPda(id, slot)).catch(() => null);
    return info ? this.decodeVision(info.data) : null;
  }

  /** Subscribe to an account over this wallet's TEE websocket, with polling as a safety net. */
  async watch(pda: PublicKey, onData: (data: Buffer) => void, pollMs = 400): Promise<() => void> {
    const conn = await this.teeConn();
    let last = "";
    const handle = (data: Buffer) => {
      const key = data.toString("base64");
      if (key === last) return;
      last = key;
      onData(data);
    };
    const sub = conn.onAccountChange(pda, (acc) => handle(acc.data), { commitment: "processed" });
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        const info = await conn.getAccountInfo(pda, "processed").catch(() => null);
        if (info) handle(info.data);
        await sleep(pollMs);
      }
    };
    void poll();
    return () => {
      stopped = true;
      void conn.removeAccountChangeListener(sub).catch(() => {});
    };
  }

  // ───────────── lobby (base layer) ─────────────

  private delegateIx(accountType: object, pda: PublicKey) {
    return this.program.methods
      .delegatePda(accountType as never)
      .accountsPartial({ payer: this.publicKey, validator: TEE_VALIDATOR, pda })
      .instruction();
  }

  async createArena(id: BN, stakeLamports: BN, maxPlayers: number, name: string, skin: number, mapId = 0, mode = 0) {
    const create = await this.program.methods
      .createArena(id, stakeLamports, maxPlayers, encodeName(name), skin, mapId, mode)
      .accountsPartial({
        arena: arenaPda(id),
        world: worldPda(id),
        vision: visionPda(id, 0),
        broadcast: broadcastPda(id),
        registry: registryPda(),
        vault: vaultPda(id),
        host: this.publicKey,
      })
      .instruction();
    const delegate = await this.delegateIx({ vision: { arenaId: id, slot: 0 } }, visionPda(id, 0));
    return this.sendBase([create, delegate]);
  }

  /** Join the next free slot and hand that slot's Vision to the TEE right away. */
  async joinArena(id: BN, name: string, skin: number): Promise<number> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const found = await this.fetchArena(id);
      if (!found) throw new Error("Arena not found");
      const { arena } = found;
      if (arena.status !== STATUS.lobby) throw new Error("This arena already started");
      const mine = arena.players.slice(0, arena.playerCount).findIndex((p) => p.equals(this.publicKey));
      if (mine >= 0) return mine;
      if (arena.playerCount >= arena.maxPlayers) throw new Error("Arena is full");
      const slot = arena.playerCount;
      const join = await this.program.methods
        .joinArena(encodeName(name), skin)
        .accountsPartial({ arena: arenaPda(id), vision: visionPda(id, slot), vault: vaultPda(id), player: this.publicKey })
        .instruction();
      const delegate = await this.delegateIx({ vision: { arenaId: id, slot } }, visionPda(id, slot));
      try {
        await this.sendBase([join, delegate]);
      } catch (e) {
        if (attempt === 3) throw e;
        await sleep(800);
        continue;
      }
      const check = await this.fetchArena(id);
      if (check?.arena.players[slot]?.equals(this.publicKey)) return slot;
    }
    throw new Error("Could not grab a slot — try again");
  }

  // ───────────── privacy setup (TEE) ─────────────

  initPermissionIx(accountType: object, pda: PublicKey) {
    return this.program.methods
      .initPermission(accountType as never)
      .accountsPartial({
        permissionedAccount: pda,
        permission: permissionPdaFromAccount(pda),
        payer: this.publicKey,
        permissionProgram: PERMISSION_PROGRAM_ID,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
      })
      .instruction();
  }

  /** Seal my Vision so only my wallet can read it. Idempotent. */
  async sealMyVision(id: BN, slot: number) {
    const pda = visionPda(id, slot);
    await this.waitOnEr(pda);
    return this.sendEr([await this.initPermissionIx({ vision: { arenaId: id, slot } }, pda)]);
  }

  // ───────────── host: start the match ─────────────

  /**
   * Host flow: delegate Arena + World to the TEE, seal everything (World with no readers,
   * every Vision to its owner), then ask the VRF oracle for spawns. Falls back to TEE-local
   * entropy if the oracle is slow.
   */
  async startMatch(id: BN, log: (s: string) => void = () => {}) {
    const n = await this.prepareMatch(id, log);
    return this.spawnMatch(id, n, log);
  }

  /** Delegate Arena + World to the TEE and seal everything. Returns the player count. */
  async prepareMatch(id: BN, log: (s: string) => void = () => {}): Promise<number> {
    const found = await this.fetchArena(id);
    if (!found) throw new Error("Arena not found");
    const { arena } = found;
    const n = arena.playerCount;

    if (!found.onEr) {
      log("Handing the arena to MagicBlock's TEE validator…");
      await this.sendBase([
        await this.delegateIx({ arena: { arenaId: id } }, arenaPda(id)),
        await this.delegateIx({ world: { arenaId: id } }, worldPda(id)),
        await this.delegateIx({ broadcast: { arenaId: id } }, broadcastPda(id)),
      ]);
    }
    await this.waitOnEr(arenaPda(id));
    await this.waitOnEr(worldPda(id));
    // Other players' Visions are (correctly) unreadable to the host once sealed, so only check
    // that each one is delegated on the base layer; the permission ix itself is idempotent.
    for (let s = 0; s < n; s++) {
      const info = await this.base.getAccountInfo(visionPda(id, s));
      if (!info || info.owner.equals(PROGRAM_ID)) throw new Error(`Player ${s + 1} has not finished joining yet`);
    }

    log("Sealing the world inside the enclave…");
    await this.waitOnEr(broadcastPda(id));
    const permIxs = [
      await this.initPermissionIx({ arena: { arenaId: id } }, arenaPda(id)),
      await this.initPermissionIx({ world: { arenaId: id } }, worldPda(id)),
      await this.initPermissionIx({ broadcast: { arenaId: id } }, broadcastPda(id)),
    ];
    for (let s = 0; s < n; s++) permIxs.push(await this.initPermissionIx({ vision: { arenaId: id, slot: s } }, visionPda(id, s)));
    // A handful per transaction keeps us under the size limit.
    for (let i = 0; i < permIxs.length; i += 3) await this.sendEr(permIxs.slice(i, i + 3));

    return n;
  }

  /** Roll spawns with VRF (falling back to enclave entropy). The match goes live here. */
  async spawnMatch(id: BN, n: number, log: (s: string) => void = () => {}) {
    // The program refuses to spawn unless the World and every Vision are provably sealed.
    const sealProof = [worldPda(id), ...Array.from({ length: n }, (_, s) => visionPda(id, s))].map((pda) => ({
      pubkey: permissionPdaFromAccount(pda),
      isSigner: false,
      isWritable: false,
    }));

    log("Rolling spawn points with MagicBlock VRF…");
    let vrfOk = true;
    try {
      await this.sendEr([
        await this.program.methods
          .requestSpawn(Math.floor(Math.random() * 256))
          .accountsPartial({ payer: this.publicKey, arena: arenaPda(id), world: worldPda(id), oracleQueue: VRF_EPHEMERAL_QUEUE })
          .remainingAccounts(sealProof)
          .instruction(),
      ]);
    } catch (e) {
      vrfOk = false;
      log(`VRF request failed (${(e as Error).message.split("\n")[0]}), using enclave entropy`);
    }

    const conn = await this.teeConn();
    const deadline = Date.now() + (vrfOk ? 15_000 : 0);
    while (Date.now() < deadline) {
      const info = await conn.getAccountInfo(arenaPda(id)).catch(() => null);
      if (info && this.decodeArena(info.data).status === STATUS.live) {
        log("The sun has set. Spawns delivered by VRF.");
        return { vrf: true };
      }
      await sleep(700);
    }
    if (vrfOk) log("VRF oracle is slow — falling back to enclave entropy");
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        await this.sendEr([
          await this.program.methods
            .spawnFallback()
            .accountsPartial({ arena: arenaPda(id), world: worldPda(id), host: this.publicKey })
            .remainingAccounts(sealProof)
            .instruction(),
        ]);
        return { vrf: false };
      } catch (e) {
        const info = await conn.getAccountInfo(arenaPda(id)).catch(() => null);
        if (info && this.decodeArena(info.data).status === STATUS.live) return { vrf: true };
        if (attempt === 11) throw e;
        await sleep(1500);
      }
    }
    return { vrf: false };
  }

  /** Put the world border on MagicBlock's scheduler. Best-effort: clients also tick. */
  async scheduleTicks(id: BN, playerCount: number) {
    const visions = Array.from({ length: playerCount }, (_, s) => ({
      pubkey: visionPda(id, s),
      isSigner: false,
      isWritable: true,
    }));
    const taskId = new BN(id.toString()).mod(new BN("9000000000000000000"));
    return this.sendEr([
      await this.program.methods
        .scheduleTicks(taskId, new BN(1000), new BN(600))
        .accountsPartial({ payer: this.publicKey, arena: arenaPda(id), world: worldPda(id), broadcast: broadcastPda(id), magicProgram: MAGIC_PROGRAM_ID })
        .remainingAccounts(visions)
        .instruction(),
    ]);
  }

  // ───────────── gameplay (TEE) ─────────────

  private visionMetas(id: BN, playerCount: number) {
    return Array.from({ length: playerCount }, (_, s) => ({ pubkey: visionPda(id, s), isSigner: false, isWritable: true }));
  }

  actIx(id: BN, playerCount: number, action: number, dir: number) {
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: arenaPda(id), isSigner: false, isWritable: true },
        { pubkey: worldPda(id), isSigner: false, isWritable: true },
        { pubkey: this.publicKey, isSigner: true, isWritable: false },
        ...this.visionMetas(id, playerCount),
      ],
      data: this.program.coder.instruction.encode("act", { action, dir }),
    });
  }

  act(id: BN, playerCount: number, action: number, dir: number) {
    return this.sendErFast([this.actIx(id, playerCount, action, dir)]);
  }

  tickIx(id: BN, playerCount: number) {
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: arenaPda(id), isSigner: false, isWritable: true },
        { pubkey: worldPda(id), isSigner: false, isWritable: true },
        { pubkey: broadcastPda(id), isSigner: false, isWritable: true },
        ...this.visionMetas(id, playerCount),
      ],
      data: this.program.coder.instruction.encode("tick", {}),
    });
  }

  tick(id: BN, playerCount: number) {
    return this.sendErFast([this.tickIx(id, playerCount)]);
  }

  // ───────────── endgame ─────────────

  async reveal(id: BN) {
    return this.sendEr([
      await this.program.methods
        .reveal()
        .accountsPartial({
          arena: arenaPda(id),
          world: worldPda(id),
          permission: permissionPdaFromAccount(worldPda(id)),
          payer: this.publicKey,
          permissionProgram: PERMISSION_PROGRAM_ID,
          ephemeralVault: EPHEMERAL_VAULT_ID,
          magicProgram: MAGIC_PROGRAM_ID,
        })
        .instruction(),
    ]);
  }

  async settle(id: BN) {
    return this.sendEr([
      await this.program.methods
        .settle()
        .accountsPartial({
          payer: this.publicKey,
          arena: arenaPda(id),
          world: worldPda(id),
          magicContext: MAGIC_CONTEXT_ID,
          magicProgram: MAGIC_PROGRAM_ID,
        })
        .instruction(),
    ]);
  }

  /** Wait until the arena is back on Solana, then pay the winner from the vault. */
  async claim(id: BN, winner: PublicKey, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await this.base.getAccountInfo(arenaPda(id)).catch(() => null);
      if (info?.owner.equals(PROGRAM_ID)) break;
      await sleep(1500);
    }
    return this.sendBase([
      await this.program.methods
        .claim()
        .accountsPartial({ arena: arenaPda(id), vault: vaultPda(id), winner, payer: this.publicKey })
        .instruction(),
    ]);
  }

  // ───────────── wallet helpers ─────────────

  balance() {
    return this.base.getBalance(this.publicKey);
  }

  async fund(to: PublicKey, lamports: number) {
    return this.sendBase([SystemProgram.transfer({ fromPubkey: this.publicKey, toPubkey: to, lamports })]);
  }
}
