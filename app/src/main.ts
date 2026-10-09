import "./polyfills";
import "./ui/style.css";
import * as THREE from "three";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { BN } from "./lib/anchor";
import { NightfallClient, browserKV, decodeName, type ArenaState } from "./lib/nightfall";
import { MAX_PLAYERS, PROGRAM_ID, STATUS, explorerAddress } from "./lib/config";
import { ArenaScene } from "./game/scene";
import { Character, SKINS } from "./game/character";
import { MatchSession } from "./game/session";
import { Bot } from "./game/bot";
import { sfx } from "./game/sfx";

const ui = document.getElementById("ui")!;
const stage = document.getElementById("stage")!;
const scene = new ArenaScene(stage);
const kv = browserKV();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────── wallet (a burner per browser) ─────────────

const loadKeypair = (key: string) => {
  const saved = kv.get(key);
  if (saved) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
  const kp = Keypair.generate();
  kv.set(key, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
};
const me = new NightfallClient(loadKeypair("nightfall-burner"), kv);
let myName = kv.get("nightfall-name") || ["Steve", "Alex", "Nova", "Pixel", "Blaze", "Echo"][Math.floor(Math.random() * 6)];
let mySkin = Number(kv.get("nightfall-skin") ?? Math.floor(Math.random() * SKINS.length)) % SKINS.length;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toast = (msg: string, err = false) => {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = `toast ${err ? "err" : ""}`;
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), err ? 6000 : 3000);
};
const errMsg = (e: unknown) => {
  const m = (e as Error)?.message ?? String(e);
  if (/insufficient|0x1\b|debit an account/i.test(m)) return "Not enough devnet SOL — top up your burner wallet first.";
  return m.split("\n")[0].slice(0, 200);
};

// ───────────── screens ─────────────

let session: MatchSession | null = null;
let lobbyStop = false;
let bots: Bot[] = [];
let lobbyChars: Character[] = [];

const clearUi = () => {
  ui.innerHTML = "";
  lobbyStop = true;
  for (const c of lobbyChars) c.dispose();
  lobbyChars = [];
  for (const k of [...scene.characters.keys()]) if (k >= 100) scene.characters.delete(k);
};

const setUrl = (arena?: string, watch = false) => {
  const url = new URL(location.href);
  url.search = "";
  if (arena) url.searchParams.set("arena", arena);
  if (watch) url.searchParams.set("watch", "1");
  history.replaceState(null, "", url);
};

/** Rotating 3D preview of the chosen skin. */
function skinPreview(canvas: HTMLCanvasElement, getSkin: () => number) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(2);
  renderer.setSize(96, 120, false);
  const s = new THREE.Scene();
  s.add(new THREE.AmbientLight(0xffffff, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4);
  dl.position.set(1, 2, 3);
  s.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 96 / 120, 0.1, 10);
  cam.position.set(0, 0.62, 2.7);
  cam.lookAt(0, 0.52, 0);
  let current = -1;
  let ch: Character | null = null;
  let alive = true;
  const loop = (t: number) => {
    if (!alive || !canvas.isConnected) return renderer.dispose();
    if (getSkin() !== current) {
      ch?.root.removeFromParent();
      current = getSkin();
      ch = new Character(current);
      ch.place(0, 0, 2);
      s.add(ch.root);
    }
    ch!.update(0.016, t / 1000);
    ch!.root.rotation.y = Math.sin(t / 900) * 0.7;
    renderer.render(s, cam);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return () => (alive = false);
}

async function refreshBalance(el: HTMLElement | null) {
  if (!el) return;
  const lamports = await me.balance().catch(() => 0);
  el.textContent = `${(lamports / LAMPORTS_PER_SOL).toFixed(3)} SOL`;
  return lamports;
}

function home() {
  clearUi();
  session?.dispose();
  session = null;
  scene.follow = null;
  // The title screen shows the whole moonlit arena; fog only exists during a match.
  scene.clearFog();
  scene.setTorch(0, 0, false);
  setUrl();
  const el = document.createElement("div");
  el.className = "screen";
  el.innerHTML = `
    <h1 class="title">NIGHTFALL</h1>
    <div class="splash">Even the host can't see you!</div>
    <p class="tagline">A real-time battle royale with true fog of war. Every position is sealed inside MagicBlock's Private Ephemeral Rollup. Nobody can see past their own torch: not other players, not spectators, not the server.</p>
    <div class="menu col">
      <div class="panel col">
        <div class="row" style="gap:16px;align-items:stretch">
          <div class="skin-picker">
            <button class="btn small" data-prev aria-label="Previous skin">◀</button>
            <canvas data-preview></canvas>
            <button class="btn small" data-next aria-label="Next skin">▶</button>
          </div>
          <div class="col" style="flex:1;justify-content:center">
            <div class="label">Your name · <span data-skinname></span></div>
            <input class="field" data-name maxlength="12" value="${esc(myName)}" aria-label="Your name"/>
          </div>
        </div>
        <div class="wallet">
          <span><span class="label" style="display:inline">Burner</span> <code data-addr title="Click to copy">${me.publicKey.toBase58().slice(0, 4)}…${me.publicKey.toBase58().slice(-4)}</code> · <span data-bal>…</span></span>
          <span class="row"><button class="btn small" data-airdrop>Get devnet SOL</button></span>
        </div>
      </div>
      <div class="panel col">
        <div class="label">Entry stake (winner takes the pot)</div>
        <div class="chips" data-stakes>
          <button class="chip on" data-stake="0">FREE</button>
          <button class="chip" data-stake="0.01">0.01 SOL</button>
          <button class="chip" data-stake="0.05">0.05 SOL</button>
        </div>
        <button class="btn primary" data-create>⚔ Create arena</button>
        <div class="grid2">
          <input class="field" data-code placeholder="Arena code" inputmode="numeric" aria-label="Arena code"/>
          <button class="btn" data-join>Join</button>
        </div>
        <button class="btn" data-watch>👁 Spectate an arena</button>
      </div>
    </div>
    <div class="feature-strip">
      <span>⚡ Ephemeral Rollup · ~50ms moves</span><span>🔒 Private ER (Intel TDX)</span><span>🎲 VRF spawns</span><span>⏱ Crank-driven border</span><span>💰 Onchain pot</span>
    </div>
    <p class="muted" style="margin-top:14px;font-size:16px">Program <a href="${explorerAddress(PROGRAM_ID.toBase58())}" target="_blank" rel="noreferrer">${PROGRAM_ID.toBase58().slice(0, 8)}…</a> on Solana devnet</p>`;
  ui.appendChild(el);

  const nameInput = el.querySelector<HTMLInputElement>("[data-name]")!;
  nameInput.addEventListener("input", () => {
    myName = nameInput.value.trim() || "Player";
    kv.set("nightfall-name", myName);
  });
  const skinName = el.querySelector<HTMLElement>("[data-skinname]")!;
  const setSkin = (d: number) => {
    mySkin = (mySkin + d + SKINS.length) % SKINS.length;
    kv.set("nightfall-skin", String(mySkin));
    skinName.textContent = SKINS[mySkin].name;
    sfx.click();
  };
  setSkin(0);
  el.querySelector("[data-prev]")!.addEventListener("click", () => setSkin(-1));
  el.querySelector("[data-next]")!.addEventListener("click", () => setSkin(1));
  skinPreview(el.querySelector("[data-preview]")!, () => mySkin);

  const bal = el.querySelector<HTMLElement>("[data-bal]");
  void refreshBalance(bal);
  el.querySelector("[data-addr]")!.addEventListener("click", () => {
    void navigator.clipboard?.writeText(me.publicKey.toBase58());
    toast("Burner address copied. Send it some devnet SOL.");
  });
  el.querySelector("[data-airdrop]")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const { Connection } = await import("@solana/web3.js");
      const c = new Connection("https://api.devnet.solana.com", "confirmed");
      const sig = await c.requestAirdrop(me.publicKey, 0.5 * LAMPORTS_PER_SOL);
      await c.confirmTransaction(sig, "confirmed");
      toast("+0.5 devnet SOL");
    } catch {
      void navigator.clipboard?.writeText(me.publicKey.toBase58());
      toast("Devnet faucet is rate-limited. Address copied, so paste it at faucet.solana.com.", true);
      window.open("https://faucet.solana.com", "_blank", "noopener");
    }
    b.disabled = false;
    void refreshBalance(bal);
  });

  let stake = 0;
  el.querySelectorAll<HTMLButtonElement>("[data-stake]").forEach((b) =>
    b.addEventListener("click", () => {
      el.querySelectorAll("[data-stake]").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      stake = Number(b.dataset.stake);
      sfx.click();
    }),
  );

  const busy = (b: HTMLButtonElement, label: string) => {
    b.disabled = true;
    b.innerHTML = `<span class="spinner"></span> ${label}`;
  };
  el.querySelector("[data-create]")!.addEventListener("click", async (e) => {
    sfx.unlock();
    const b = e.currentTarget as HTMLButtonElement;
    busy(b, "Opening arena…");
    try {
      const id = new BN(Date.now()).muln(10).addn(Math.floor(Math.random() * 10));
      await me.createArena(id, new BN(Math.round(stake * LAMPORTS_PER_SOL)), MAX_PLAYERS, myName, mySkin);
      kv.set(`nightfall-host-${id}`, "1");
      void me.sealMyVision(id, 0).catch(() => {});
      lobby(id);
    } catch (err) {
      toast(errMsg(err), true);
      b.disabled = false;
      b.textContent = "⚔ Create arena";
    }
  });
  const codeInput = el.querySelector<HTMLInputElement>("[data-code]")!;
  el.querySelector("[data-join]")!.addEventListener("click", async (e) => {
    sfx.unlock();
    const code = codeInput.value.trim();
    if (!/^\d+$/.test(code)) return toast("Paste the arena code (digits only).", true);
    const b = e.currentTarget as HTMLButtonElement;
    busy(b, "Joining…");
    try {
      await joinFlow(new BN(code));
    } catch (err) {
      toast(errMsg(err), true);
      b.disabled = false;
      b.textContent = "Join";
    }
  });
  el.querySelector("[data-watch]")!.addEventListener("click", () => {
    const code = codeInput.value.trim();
    if (!/^\d+$/.test(code)) return toast("Enter the arena code to spectate.", true);
    void spectate(new BN(code));
  });
}

async function joinFlow(id: BN) {
  const found = await me.fetchArena(id);
  if (!found) throw new Error("No arena with that code");
  const mine = found.arena.players.slice(0, found.arena.playerCount).findIndex((p) => p.equals(me.publicKey));
  if (mine >= 0) {
    if (found.arena.status >= STATUS.live) return play(id, mine);
    return lobby(id);
  }
  if (found.arena.status !== STATUS.lobby) {
    toast("That match already started, so you're spectating.");
    return spectate(id);
  }
  const slot = await me.joinArena(id, myName, mySkin);
  void me.sealMyVision(id, slot).catch(() => {});
  lobby(id);
}

// ───────────── lobby ─────────────

const botNames = ["Herobot", "Creepbot", "Endbot", "Blockbot", "Pixbot"];

async function addBot(id: BN, arena: ArenaState, log: (s: string) => void) {
  const n = Number(kv.get(`nightfall-bots-${id}`) ?? "0");
  const kp = loadKeypair(`nightfall-bot-${id}-${n}`);
  kv.set(`nightfall-bots-${id}`, String(n + 1));
  const bot = new NightfallClient(kp, kv);
  const need = 0.012 * LAMPORTS_PER_SOL + arena.stake.toNumber();
  log(`Funding a bot wallet (${(need / LAMPORTS_PER_SOL).toFixed(3)} SOL)…`);
  await me.fund(kp.publicKey, need);
  const slot = await bot.joinArena(id, botNames[n % botNames.length], Math.floor(Math.random() * SKINS.length));
  log(`${botNames[n % botNames.length]} took slot ${slot + 1}. Sealing its vision…`);
  await bot.sealMyVision(id, slot);
}

function botsFor(id: BN, arena: ArenaState) {
  const out: Bot[] = [];
  const n = Number(kv.get(`nightfall-bots-${id}`) ?? "0");
  for (let i = 0; i < n; i++) {
    const saved = kv.get(`nightfall-bot-${id}-${i}`);
    if (!saved) continue;
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
    const slot = arena.players.slice(0, arena.playerCount).findIndex((p) => p.equals(kp.publicKey));
    if (slot >= 0) out.push(new Bot(new NightfallClient(kp, kv), id, slot, arena.playerCount));
  }
  return out;
}

function placeLobbyCharacters(arena: ArenaState) {
  for (const c of lobbyChars) c.dispose();
  lobbyChars = [];
  for (const k of [...scene.characters.keys()]) if (k >= 100) scene.characters.delete(k);
  for (let i = 0; i < arena.playerCount; i++) {
    const c = new Character(arena.skins[i], decodeName(arena.names[i]), arena.players[i].equals(me.publicKey) ? "#ffff80" : "#ffffff");
    c.place(9 + i, 12, 2);
    scene.scene.add(c.root);
    lobbyChars.push(c);
    scene.characters.set(100 + i, c);
  }
  scene.follow = new THREE.Vector2(11.5, 11.5);
}

function lobby(id: BN) {
  clearUi();
  lobbyStop = false;
  setUrl(id.toString());
  const isHost = kv.get(`nightfall-host-${id}`) === "1";
  const link = `${location.origin}${location.pathname}?arena=${id}`;
  const el = document.createElement("div");
  el.className = "screen";
  el.style.justifyContent = "flex-end";
  el.innerHTML = `
    <div class="lobby panel col">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap">
        <div><div class="label">Arena code</div><div class="code" data-code>${id}</div></div>
        <div class="row"><button class="btn small" data-copy>Copy invite link</button><button class="btn small" data-back>✕</button></div>
      </div>
      <div class="label">Players <span data-count></span> <span data-stake></span></div>
      <div class="players" data-players></div>
      <div class="row" style="flex-wrap:wrap">
        ${isHost ? `<button class="btn" data-bot>🤖 Add bot</button><button class="btn primary" data-start style="flex:1">🌙 Start the night</button>` : `<div class="muted" style="flex:1">Waiting for the host to start… share the link to fill the arena.</div>`}
      </div>
      <div class="log" data-log></div>
    </div>`;
  ui.appendChild(el);
  const logEl = el.querySelector<HTMLElement>("[data-log]")!;
  const log = (s: string) => {
    const d = document.createElement("div");
    d.innerHTML = s;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  };
  el.querySelector("[data-copy]")!.addEventListener("click", () => {
    void navigator.clipboard?.writeText(link);
    toast("Invite link copied");
  });
  el.querySelector("[data-back]")!.addEventListener("click", home);

  let arena: ArenaState | null = null;
  let shownCount = -1;
  const render = (a: ArenaState) => {
    arena = a;
    el.querySelector("[data-count]")!.textContent = `(${a.playerCount}/${a.maxPlayers})`;
    el.querySelector("[data-stake]")!.textContent = a.stake.isZero() ? "· free" : `· stake ${a.stake.toNumber() / LAMPORTS_PER_SOL} SOL each`;
    const cards: string[] = [];
    for (let i = 0; i < a.maxPlayers; i++) {
      if (i < a.playerCount) {
        const s = SKINS[a.skins[i] % SKINS.length];
        const tag = i === 0 ? "host" : botNames.includes(decodeName(a.names[i])) ? "bot" : "player";
        cards.push(`<div class="player-card"><div class="swatch" style="background:${s.shirt};box-shadow:inset 0 8px 0 ${s.helmet ?? s.hood ?? s.hair}"></div><div><div>${esc(decodeName(a.names[i]))}${a.players[i].equals(me.publicKey) ? " (you)" : ""}</div><div class="tag">${tag} · ${s.name}</div></div></div>`);
      } else cards.push(`<div class="player-card empty"><div class="swatch" style="background:#222"></div><div class="tag">open slot</div></div>`);
    }
    el.querySelector("[data-players]")!.innerHTML = cards.join("");
    if (a.playerCount !== shownCount) {
      shownCount = a.playerCount;
      placeLobbyCharacters(a);
    }
    const start = el.querySelector<HTMLButtonElement>("[data-start]");
    if (start && !start.dataset.busy) start.disabled = a.playerCount < 2;
  };

  el.querySelector("[data-bot]")?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    if (!arena || arena.playerCount >= arena.maxPlayers) return;
    b.disabled = true;
    try {
      await addBot(id, arena, log);
      log("Bot ready: it plays from its own sealed Vision, same fog as you.");
    } catch (err) {
      log(`<span style="color:#ff8080">${esc(errMsg(err))}</span>`);
    }
    b.disabled = false;
  });
  el.querySelector("[data-start]")?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.dataset.busy = "1";
    b.disabled = true;
    b.innerHTML = `<span class="spinner"></span> Starting…`;
    try {
      const res = await me.startMatch(id, log);
      log(res.vrf ? "🎲 Spawns rolled by MagicBlock VRF inside the TEE." : "Spawns rolled from enclave entropy.");
      const fresh = (await me.fetchArena(id))!.arena;
      me.scheduleTicks(id, fresh.playerCount)
        .then(() => log("⏱ World border handed to MagicBlock's crank scheduler."))
        .catch(() => log("Crank unavailable; clients will advance the border."));
    } catch (err) {
      log(`<span style="color:#ff8080">${esc(errMsg(err))}</span>`);
      b.dataset.busy = "";
      b.disabled = false;
      b.textContent = "🌙 Start the night";
    }
  });

  void (async () => {
    let mySealed = false;
    while (!lobbyStop) {
      const found = await me.fetchArena(id).catch(() => null);
      if (lobbyStop) return;
      if (found) {
        render(found.arena);
        const mySlot = found.arena.players.slice(0, found.arena.playerCount).findIndex((p) => p.equals(me.publicKey));
        if (!mySealed && mySlot >= 0) {
          mySealed = true;
          me.sealMyVision(id, mySlot).catch(() => (mySealed = false));
        }
        if (found.arena.status === STATUS.live || found.arena.status >= STATUS.ended) {
          return mySlot >= 0 ? play(id, mySlot) : spectate(id);
        }
      }
      await sleep(found?.onEr ? 800 : 1500);
    }
  })();
}

// ───────────── match ─────────────

async function play(id: BN, slot: number) {
  clearUi();
  setUrl(id.toString());
  const found = await me.fetchArena(id);
  const arena = found?.arena;
  bots = arena && kv.get(`nightfall-host-${id}`) === "1" ? botsFor(id, arena) : [];
  session = new MatchSession({ scene, me, arenaId: id, slot, ui, bots, onExit: home, toast });
  await session.start();
  for (const b of bots) void b.start();
}

async function spectate(id: BN) {
  clearUi();
  setUrl(id.toString(), true);
  session = new MatchSession({ scene, me, arenaId: id, slot: -1, ui, bots: [], onExit: home, toast });
  await session.start().catch((e) => toast(errMsg(e), true));
}

// ───────────── boot ─────────────

async function boot() {
  const params = new URLSearchParams(location.search);
  const code = params.get("arena");
  if (!code || !/^\d+$/.test(code)) return home();
  const id = new BN(code);
  if (params.get("watch")) return spectate(id);
  try {
    const found = await me.fetchArena(id);
    if (!found) return home();
    const mine = found.arena.players.slice(0, found.arena.playerCount).findIndex((p: PublicKey) => p.equals(me.publicKey));
    if (mine >= 0) return found.arena.status >= STATUS.live ? play(id, mine) : lobby(id);
    if (found.arena.status === STATUS.lobby) {
      home();
      const input = document.querySelector<HTMLInputElement>("[data-code]");
      if (input) input.value = code;
      toast("Pick a name and skin, then hit Join.");
      return;
    }
    return spectate(id);
  } catch (e) {
    toast(errMsg(e), true);
    home();
  }
}

void boot();
