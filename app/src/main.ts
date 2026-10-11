import "./polyfills";
import "./ui/style.css";
import * as THREE from "three";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "./lib/anchor";
import { NightfallClient, browserKV, decodeName, type ArenaState } from "./lib/nightfall";
import { MAX_PLAYERS, PROGRAM_ID, STATUS, explorerAddress } from "./lib/config";
import { ArenaScene } from "./game/scene";
import { CAPES, Character, HATS, SKINS, packLook, unpackLook } from "./game/character";
import { THEMES } from "./game/textures";
import { WarmupYard } from "./game/warmup";
import { MAPS } from "./lib/map";
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
kv.set("nightfall-name", myName);
/** Packed look (skin + hat + cape) — see packLook. */
let mySkin = Number(kv.get("nightfall-skin") ?? Math.floor(Math.random() * SKINS.length)) % 210;
let myMap = Number(kv.get("nightfall-map") ?? "0") % MAPS.length;
/** 0 night (torchlight), 1 daylight. */
let myMode = Number(kv.get("nightfall-mode") ?? "0") === 1 ? 1 : 0;

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
  scene.cameraMode = "game";
  scene.onFrame = () => {};
  scene.clearProps();
  heroChar?.dispose();
  heroChar = null;
  document.querySelector(".modal-back")?.remove();
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

async function refreshBalance(el: HTMLElement | null) {
  const lamports = await me.balance().catch(() => 0);
  if (el) el.textContent = (lamports / LAMPORTS_PER_SOL).toFixed(2);
  return lamports;
}

// ───────────── title screen ─────────────

const QUICK_PLAY_SOL = 0.06;
let heroChar: Character | null = null;

/** Your hero by a campfire in the chosen arena; shadows lurk at the edge of the light. */
function stageHero() {
  scene.clearProps();
  heroChar?.dispose();
  for (const k of [...scene.characters.keys()]) if (k >= 100) scene.characters.delete(k);
  scene.setMap(myMap);
  scene.setDaylight(myMode === 1);
  scene.clearFog();
  scene.zoneTarget = 12;
  scene.heroAt.set(11, 12);
  heroChar = new Character(mySkin, myName, "#ffff80");
  heroChar.place(11, 12, 2);
  scene.scene.add(heroChar.root);
  scene.characters.set(150, heroChar);
  scene.campfire(12.5, 11.2);
  scene.lurker(7, 9, 1);
  scene.lurker(16, 8, 3);
  scene.lurker(15, 17, 0);
  // Key light in front of the hero so the face reads; the campfire rims them from behind.
  scene.setTorch(11.2, 13.4, true);
  scene.cameraMode = "hero";
  scene.follow = null;
  // Slow showcase turn so hats and capes both get seen.
  scene.onFrame = (_dt, t) => {
    if (heroChar) heroChar.root.rotation.y = Math.sin(t * 0.55) * 1.4;
  };
}

function cosmeticPop() {
  if (!heroChar) return;
  scene.burst(11, 1.2, 12, 0xffe040, 16);
  sfx.click();
}

function modal(html: string) {
  document.querySelector(".modal-back")?.remove();
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal panel">${html}<button class="btn small modal-x" data-x aria-label="Close">✕</button></div>`;
  back.addEventListener("click", (e) => e.target === back && back.remove());
  back.querySelector("[data-x]")!.addEventListener("click", () => back.remove());
  ui.appendChild(back);
  return back;
}

function walletModal(reason = "") {
  const addr = me.publicKey.toBase58();
  const m = modal(`
    <div class="label">Your burner wallet · devnet</div>
    ${reason ? `<p>${reason}</p>` : ""}
    <p class="muted">A throwaway devnet wallet lives in this browser, so there are no popups mid-fight. It needs a little devnet SOL to open arenas.</p>
    <code class="addr" data-addr>${addr}</code>
    <div class="row" style="flex-wrap:wrap;margin-top:12px">
      <button class="btn primary" data-air>Get free devnet SOL</button>
      <button class="btn" data-copy>Copy address</button>
    </div>
    <p class="muted" data-msg style="margin-bottom:0"></p>`);
  const msg = m.querySelector<HTMLElement>("[data-msg]")!;
  m.querySelector("[data-copy]")!.addEventListener("click", () => {
    void navigator.clipboard?.writeText(addr);
    msg.textContent = "Copied. Paste it at faucet.solana.com if the button is rate-limited.";
  });
  m.querySelector("[data-air]")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    msg.textContent = "Asking the devnet faucet…";
    try {
      const c = new Connection("https://api.devnet.solana.com", "confirmed");
      const sig = await c.requestAirdrop(me.publicKey, 1 * LAMPORTS_PER_SOL);
      await c.confirmTransaction(sig, "confirmed");
      msg.textContent = "+1 devnet SOL. You're good to go!";
      void refreshBalance(document.querySelector("[data-bal]"));
    } catch {
      void navigator.clipboard?.writeText(addr);
      msg.innerHTML = `The faucet is rate-limited. Your address is copied: paste it at <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>.`;
    }
    b.disabled = false;
  });
}

function howModal() {
  modal(`
    <div class="label">How can a blockchain game have fog of war?</div>
    <ol class="how">
      <li><b>Every position is sealed inside an Intel TDX enclave</b> run by MagicBlock's Private Ephemeral Rollup. The World account has <i>zero</i> readers.</li>
      <li><b>Each move recomputes what every player may see</b>, writing it to a "Vision" only that player's wallet can read. Your torch radius, walls and tall grass decide.</li>
      <li><b>The host, the RPC and spectators get <code>null</code>.</b> Press <kbd>X</kbd> in a match to try to cheat. You can't.</li>
      <li>Spawns are rolled by <b>MagicBlock VRF</b>, the shrinking border is a <b>crank</b>, and the winner is paid <b>onchain</b>. When the match ends, the night is revealed so anyone can verify.</li>
    </ol>`);
}

function friendsModal() {
  const m = modal(`
    <div class="label">Play with friends</div>
    <div class="col">
      <div class="label" style="margin:0">Entry stake (winner takes the pot)</div>
      <div class="chips" data-stakes>
        <button class="chip on" data-stake="0">FREE</button>
        <button class="chip" data-stake="0.01">0.01 SOL</button>
        <button class="chip" data-stake="0.05">0.05 SOL</button>
      </div>
      <button class="btn primary" data-create>⚔ Create a private arena · ${MAPS[myMap].name}</button>
      <div class="label" style="margin:8px 0 0">Got a code?</div>
      <div class="grid2">
        <input class="field" data-code placeholder="Arena code" inputmode="numeric" aria-label="Arena code"/>
        <button class="btn" data-join>Join</button>
      </div>
    </div>`);
  let stake = 0;
  m.querySelectorAll<HTMLButtonElement>("[data-stake]").forEach((b) =>
    b.addEventListener("click", () => {
      m.querySelectorAll("[data-stake]").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      stake = Number(b.dataset.stake);
      sfx.click();
    }),
  );
  m.querySelector("[data-create]")!.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    b.innerHTML = `<span class="spinner"></span> Opening arena…`;
    try {
      const id = new BN(Date.now()).muln(10).addn(Math.floor(Math.random() * 10));
      await me.createArena(id, new BN(Math.round(stake * LAMPORTS_PER_SOL)), MAX_PLAYERS, myName, mySkin, myMap, myMode);
      kv.set(`nightfall-host-${id}`, "1");
      void me.sealMyVision(id, 0).catch(() => {});
      m.remove();
      lobby(id);
    } catch (err) {
      toast(errMsg(err), true);
      b.disabled = false;
      b.textContent = "⚔ Create a private arena";
    }
  });
  m.querySelector("[data-join]")!.addEventListener("click", async (e) => {
    const code = m.querySelector<HTMLInputElement>("[data-code]")!.value.trim();
    if (!/^\d+$/.test(code)) return toast("Paste the arena code (digits only).", true);
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      m.remove();
      await joinFlow(new BN(code));
    } catch (err) {
      toast(errMsg(err), true);
      b.disabled = false;
    }
  });
}

function home() {
  clearUi();
  session?.dispose();
  session = null;
  sfx.ambience(false);
  setUrl();
  stageHero();
  const firstVisit = !kv.get("nightfall-played");
  const el = document.createElement("div");
  el.className = "title-screen";
  el.innerHTML = `
    <header class="ts-top">
      <div class="ts-logo">
        <h1 class="title">NIGHTFALL</h1>
        <div class="ts-tag">Everyone's in the dark. <b>Even the server.</b></div>
      </div>
      <button class="wallet-chip" data-wallet title="Your burner wallet">◎ <span data-bal>…</span> <span class="muted">devnet</span></button>
    </header>

    <aside class="ts-hero panel">
      <div class="label">Your hero</div>
      <input class="field" data-name maxlength="12" value="${esc(myName)}" aria-label="Your name"/>
      <div class="pickers">
        ${(["base", "hat", "cape"] as const)
          .map(
            (k) => `<div class="picker" data-pick="${k}">
              <button class="arrow" data-dir="-1" aria-label="Previous">◀</button>
              <div class="pick-val"><span class="pick-k">${k === "base" ? "Skin" : k === "hat" ? "Hat" : "Cape"}</span><span data-val></span></div>
              <button class="arrow" data-dir="1" aria-label="Next">▶</button>
            </div>`,
          )
          .join("")}
      </div>
      <button class="btn small" data-random>🎲 Surprise me</button>
    </aside>

    <aside class="ts-arenas panel">
      <div class="label">Choose your arena</div>
      <div class="mode-toggle" role="group" aria-label="Time of day">
        <button class="chip ${myMode === 0 ? "on" : ""}" data-mode="0" title="Torchlight only: ~4 tiles of sight">🌙 NIGHT</button>
        <button class="chip ${myMode === 1 ? "on" : ""}" data-mode="1" title="Daylight: ~7 tiles of sight">☀ DAY</button>
      </div>
      ${THEMES.map(
        (t, i) => `<button class="arena-card ${i === myMap ? "on" : ""}" data-map="${i}" style="--accent:${t.accent}">
          <span class="arena-swatch" style="background:linear-gradient(135deg, ${t.top}, ${t.wall} 55%, ${t.liquid})"></span>
          <span class="arena-text"><b>${t.name}</b><span>${t.blurb}</span></span>
        </button>`,
      ).join("")}
    </aside>

    <footer class="ts-bottom">
      ${firstVisit ? `<div class="start-here">New here? Press play, you'll learn in 30 seconds ↓</div>` : ""}
      <button class="btn primary mega" data-play>▶ PLAY</button>
      <div class="ts-sub">vs 3 bots · ready in ~15s · no wallet popups</div>
      <nav class="ts-links">
        <button data-friends>👥 Play with friends</button>
        <button data-watch>👁 Spectate</button>
        <button data-how>🔒 How is it private?</button>
      </nav>
    </footer>`;
  ui.appendChild(el);

  const bal = el.querySelector<HTMLElement>("[data-bal]");
  void refreshBalance(bal);
  el.querySelector("[data-wallet]")!.addEventListener("click", () => walletModal());

  const nameInput = el.querySelector<HTMLInputElement>("[data-name]")!;
  nameInput.addEventListener("input", () => {
    myName = nameInput.value.trim() || "Player";
    kv.set("nightfall-name", myName);
  });
  nameInput.addEventListener("change", stageHero);

  const sizes = { base: SKINS.length, hat: HATS.length, cape: CAPES.length };
  const label = (k: "base" | "hat" | "cape", v: number) => (k === "base" ? SKINS[v].name : k === "hat" ? HATS[v] : CAPES[v].name);
  const renderPickers = () => {
    const l = unpackLook(mySkin);
    el.querySelectorAll<HTMLElement>("[data-pick]").forEach((row) => {
      const k = row.dataset.pick as "base" | "hat" | "cape";
      row.querySelector("[data-val]")!.textContent = label(k, l[k]);
    });
  };
  const setLook = (l: { base: number; hat: number; cape: number }) => {
    mySkin = packLook(l.base, l.hat, l.cape);
    kv.set("nightfall-skin", String(mySkin));
    renderPickers();
    stageHero();
    cosmeticPop();
  };
  el.querySelectorAll<HTMLElement>("[data-pick]").forEach((row) => {
    const k = row.dataset.pick as "base" | "hat" | "cape";
    row.querySelectorAll<HTMLButtonElement>("[data-dir]").forEach((b) =>
      b.addEventListener("click", () => {
        const l = unpackLook(mySkin);
        l[k] = (l[k] + Number(b.dataset.dir) + sizes[k]) % sizes[k];
        setLook(l);
      }),
    );
  });
  el.querySelector("[data-random]")!.addEventListener("click", () =>
    setLook({ base: Math.floor(Math.random() * sizes.base), hat: Math.floor(Math.random() * sizes.hat), cape: Math.floor(Math.random() * sizes.cape) }),
  );
  renderPickers();

  el.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((b) =>
    b.addEventListener("click", () => {
      myMap = Number(b.dataset.map);
      kv.set("nightfall-map", String(myMap));
      el.querySelectorAll("[data-map]").forEach((x) => x.classList.toggle("on", x === b));
      stageHero();
      sfx.click();
    }),
  );

  el.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      myMode = Number(b.dataset.mode);
      kv.set("nightfall-mode", String(myMode));
      el.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
      scene.setDaylight(myMode === 1);
      sfx.click();
    }),
  );
  el.querySelector("[data-play]")!.addEventListener("click", async (e) => {
    sfx.unlock();
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    const lamports = (await refreshBalance(bal)) ?? 0;
    b.disabled = false;
    if (lamports < QUICK_PLAY_SOL * LAMPORTS_PER_SOL) {
      walletModal(`<b>Almost there!</b> A match needs about ${QUICK_PLAY_SOL} devnet SOL (free) to open the arena and wake three bots.`);
      return;
    }
    void quickPlay();
  });
  el.querySelector("[data-friends]")!.addEventListener("click", friendsModal);
  el.querySelector("[data-how]")!.addEventListener("click", howModal);
  el.querySelector("[data-watch]")!.addEventListener("click", spectateModal);
}

/** Browse recent arenas (from the onchain registry) and pick one to watch. */
async function spectateModal() {
  const m = modal(`<div class="label">Spectate</div>
    <p class="muted" style="margin-top:0">Watch every player on a short broadcast delay. Live matches first.</p>
    <div class="arena-list" data-list><span class="spinner"></span> Finding matches…</div>
    <div class="label" style="margin-top:10px">Or enter a code</div>
    <div class="grid2"><input class="field" data-code placeholder="Arena code" inputmode="numeric"/><button class="btn" data-go>Watch</button></div>`);
  const go = (id: BN) => {
    m.remove();
    void spectate(id);
  };
  m.querySelector("[data-go]")!.addEventListener("click", () => {
    const code = m.querySelector<HTMLInputElement>("[data-code]")!.value.trim();
    if (!/^\d+$/.test(code)) return toast("Enter the arena code.", true);
    go(new BN(code));
  });
  const list = m.querySelector<HTMLElement>("[data-list]")!;
  const entries = await me.fetchRegistry().catch(() => []);
  const rows = await Promise.all(
    entries.slice(0, 10).map(async (e) => ({ e, found: await me.fetchArena(e.id).catch(() => null) })),
  );
  const label = ["lobby", "starting", "LIVE", "ended", "paid out"];
  const sorted = rows
    .filter((r) => r.found)
    .sort((a, b) => (b.found!.arena.status === STATUS.live ? 1 : 0) - (a.found!.arena.status === STATUS.live ? 1 : 0));
  if (!sorted.length) {
    list.innerHTML = `<p class="muted">No arenas yet. Start one with ▶ PLAY and send a friend here.</p>`;
    return;
  }
  list.innerHTML = sorted
    .map(({ e, found }) => {
      const a = found!.arena;
      const alive = Array.from({ length: a.playerCount }, (_, i) => (a.alive >> i) & 1).reduce((x, y) => x + y, 0);
      const live = a.status === STATUS.live;
      const ago = Math.max(1, Math.round((Date.now() / 1000 - e.created) / 60));
      return `<button class="arena-row ${live ? "live" : ""}" data-id="${e.id}">
        <span class="arena-swatch" style="background:linear-gradient(135deg, ${THEMES[e.map].top}, ${THEMES[e.map].wall} 55%, ${THEMES[e.map].liquid})"></span>
        <span class="arena-text"><b>${live ? "🔴 " : ""}${THEMES[e.map].name} · ${e.mode ? "☀ day" : "🌙 night"}</b>
        <span>${label[a.status] ?? "?"} · ${live ? `${alive} of ${a.playerCount} alive` : `${a.playerCount} players`} · ${ago} min ago</span></span>
      </button>`;
    })
    .join("");
  list.querySelectorAll<HTMLElement>("[data-id]").forEach((b) => b.addEventListener("click", () => go(new BN(b.dataset.id!))));
}

/**
 * One click: open an arena, wake three bots and seal everything while you warm up in a
 * practice yard; the match only goes live (VRF spawns) when you choose to drop in.
 */
async function quickPlay() {
  kv.set("nightfall-played", "1");
  clearUi();
  scene.clearProps();
  heroChar?.dispose();
  heroChar = null;
  for (const k of [...scene.characters.keys()]) if (k >= 100) scene.characters.delete(k);
  scene.setMap(myMap);
  scene.setDaylight(myMode === 1);
  scene.heroAt.set(11, 12);
  const yard = new WarmupYard(scene, ui, mySkin, myName);
  sfx.ambience(true);
  const id = new BN(Date.now()).muln(10).addn(Math.floor(Math.random() * 10));
  let playerCount = 0;
  try {
    yard.setStep("arena", "active");
    await me.createArena(id, new BN(0), MAX_PLAYERS, myName, mySkin, myMap, myMode);
    kv.set(`nightfall-host-${id}`, "1");
    kv.set(`nightfall-quick-${id}`, "1");
    const mySeal = me.sealMyVision(id, 0);
    yard.setStep("arena", "done");

    yard.setStep("bots", "active");
    const botKeys = [0, 1, 2].map((i) => {
      kv.set(`nightfall-bots-${id}`, String(i + 1));
      return loadKeypair(`nightfall-bot-${id}-${i}`);
    });
    await me.sendBase(botKeys.map((k) => SystemProgram.transfer({ fromPubkey: me.publicKey, toPubkey: k.publicKey, lamports: 0.012 * LAMPORTS_PER_SOL })));
    const seals: Promise<unknown>[] = [mySeal];
    for (const [i, kp] of botKeys.entries()) {
      const bot = new NightfallClient(kp, kv);
      const slot = await bot.joinArena(id, botNames[i % botNames.length], Math.floor(Math.random() * 210));
      seals.push(bot.sealMyVision(id, slot));
    }
    yard.setStep("bots", "done");

    yard.setStep("seal", "active");
    await Promise.all(seals);
    playerCount = await me.prepareMatch(id);
    yard.setStep("seal", "done");
    yard.setReady();
  } catch (err) {
    toast(errMsg(err), true);
    yard.dispose();
    home();
    return;
  }

  yard.onReady(async () => {
    // Dramatic cut to black while VRF rolls the spawns.
    const curtain = document.createElement("div");
    curtain.className = "curtain";
    curtain.innerHTML = `<h1 class="title">NIGHTFALL</h1><p>MagicBlock VRF is choosing where you wake up…</p>`;
    document.body.appendChild(curtain);
    sfx.border();
    try {
      await me.spawnMatch(id, playerCount);
      void me.scheduleTicks(id, playerCount).catch(() => {});
      yard.dispose();
      await play(id, 0);
    } catch (err) {
      toast(errMsg(err), true);
      yard.dispose();
      home();
    }
    curtain.classList.add("out");
    setTimeout(() => curtain.remove(), 900);
  });
}

/** From the end screen: straight into a fresh quick-play match. */
function playAgain() {
  session?.dispose();
  session = null;
  void quickPlay();
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

function botsFor(id: BN, arena: ArenaState, difficulty: "easy" | "normal" = "normal") {
  const out: Bot[] = [];
  const n = Number(kv.get(`nightfall-bots-${id}`) ?? "0");
  for (let i = 0; i < n; i++) {
    const saved = kv.get(`nightfall-bot-${id}-${i}`);
    if (!saved) continue;
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved)));
    const slot = arena.players.slice(0, arena.playerCount).findIndex((p) => p.equals(kp.publicKey));
    if (slot >= 0) out.push(new Bot(new NightfallClient(kp, kv), id, slot, arena.playerCount, difficulty));
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
  scene.follow = new THREE.Vector2(8.5 + arena.playerCount / 2, 12);
  scene.cameraMode = "lobby";
  scene.setTorch(8.5 + arena.playerCount / 2, 13.5, true);
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
      if (shownCount < 0) scene.setMap(a.mapId ?? 0);
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
  const easy = kv.get(`nightfall-quick-${id}`) === "1";
  bots = arena && kv.get(`nightfall-host-${id}`) === "1" ? botsFor(id, arena, easy ? "easy" : "normal") : [];
  session = new MatchSession({ scene, me, arenaId: id, slot, ui, bots, onExit: home, toast, onPlayAgain: playAgain });
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
