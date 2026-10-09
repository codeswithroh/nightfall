# 🌙 Nightfall

**A real-time battle royale with true fog of war — where even the host can't see you.**

▶ **Play:** https://nightfall-blitz.vercel.app

Blocky heroes, a moonlit voxel arena, a closing world border, and one rule: you only see what your torch lights.
Every position lives inside **MagicBlock's Private Ephemeral Rollup** (an Intel TDX enclave). Your wallet can read
your own line of sight and nothing else. Not your opponents, not spectators, not the RPC, not the person who
created the match.

> Fog of war has been the missing piece in onchain games since Dark Forest: public state means everyone can read
> the map. Nightfall solves it without ZK circuits and at real-time speed (~50–150 ms per move).

---

## How it plays

- Up to **6 players** (humans or bots) join an arena by code or link and pick one of six original blocky skins.
- The host starts the night. **MagicBlock VRF** rolls everyone's spawn point **inside the enclave**.
- **WASD / arrows** to move, **Space** sword, **F** bow (3 arrows), **X** opens the X-ray panel.
- Loot chests hide in the dark: **Diamond Sword**, **Golden Apple**, **Quiver**.
- Tall grass hides you unless someone is right next to you. Stone and trees block line of sight.
- After a 40 s grace period the **world border** shrinks every 8 s. A MagicBlock **crank** advances it onchain.
- Last one standing takes the **onchain pot**. Then anyone can **reveal the night**: the World unseals and you can
  check every position against what you saw.

## Why only MagicBlock can do this

| Primitive | What it does in Nightfall |
| --- | --- |
| **Ephemeral Rollup** | Every step, swing and arrow is its own transaction, gasless and fast enough to feel like a game |
| **Private ER (TEE)** | `World` (all positions) is sealed with **zero readers**. Each `Vision` PDA is readable **only by its owner** |
| **VRF** | Spawn points are rolled inside the rollup and written straight into the sealed World |
| **Crank / scheduler** | `tick` is scheduled on the ER so the border closes even when nobody moves |
| **Commit + undelegate** | The final result settles on Solana; the vault pays the winner |

### The privacy model

```
               Solana devnet (base layer)                     MagicBlock TEE rollup (Intel TDX)
  ┌────────────────────────────────────────┐     delegate     ┌───────────────────────────────────────────────┐
  │ Arena  (lobby, stake, players)         │ ───────────────▶ │ Arena   public: scoreboard, kill feed, border  │
  │ World  (empty until spawn)             │ ───────────────▶ │ World   sealed, NO readers: x, y, hp, loot      │
  │ Vision[i]                              │ ───────────────▶ │ Vision i  sealed, reader = player i only        │
  │ Vault  (stakes, never delegated)       │ ◀─── settle ──── │                                                 │
  └────────────────────────────────────────┘                  │ act(move|sword|bow) → rules run in the enclave  │
                                                              │   → every Vision recomputed in the same tx       │
                                                              └───────────────────────────────────────────────┘
```

- `act` is signed by the player, touches `World` and **every** `Vision`, runs the rules, then rewrites each player's
  Vision with only what that player can see (torch radius + Bresenham line of sight + tall-grass rule).
- Permissions are decided **by the program, not the caller**: `init_permission` ignores client input and sets
  `Arena → public`, `World → private, no members`, `Vision[i] → private, members = [players[i]]`.
- Spawning is refused unless the World and every Vision are **provably sealed** (the program parses each
  `EphemeralPermission` account). So a host can't spawn on the public base layer to learn where people are.
- Every tx must pass all Visions in slot order, so nobody can blind an opponent by leaving their account out.
- No position is ever logged. The base-layer copy of `World` is the pre-spawn snapshot, so it holds no positions.

You can check all of this live: press **X** in game. The client queries the TEE with your own token and shows
`World → null`, `Opponent's Vision → null`, `Your Vision → 139 bytes`.

## Repo layout

```
programs/nightfall/src/
  lib.rs      instructions: lobby, delegation, permissions, VRF spawn, act, tick, crank, reveal, settle, claim
  logic.rs    pure game rules + fog-of-war computation (unit-tested)
  state.rs    Arena / World / Vision accounts
  map.rs      generated from scripts/gen-map.py (shared with the client)
app/
  src/lib/      NightfallClient (base + TEE connections, auth tokens, tx plumbing), map helpers
  src/game/     three.js scene, blocky characters, session (input, prediction, HUD, X-ray), bots, sfx
  tests/e2e.ts  full devnet run: create → join → seal → VRF → hunt → kill → reveal → settle → claim
  tests/guest.ts  join any arena from a terminal as one or more bots
```

## Run it

Devnet program: [`Ccu5SMkkNDj2sBE3mpFhWeUGujQg29aQZ2BKS7CRXbDB`](https://explorer.solana.com/address/Ccu5SMkkNDj2sBE3mpFhWeUGujQg29aQZ2BKS7CRXbDB?cluster=devnet)

```bash
cd app && npm install && npm run dev
```

Open the page. A burner wallet is created in your browser, so give it ~0.05 devnet SOL (use the "Get devnet SOL"
button, or paste the address into [faucet.solana.com](https://faucet.solana.com)). Then create an arena, share the link, or press **Add bot**.

Fill a lobby from the terminal (funded from `~/.config/solana/id.json`):

```bash
cd app && npm run guest -- <arena code> 3
```

End-to-end test against devnet + the TEE:

```bash
cd app && npm run e2e
```

Build and test the program (Agave 3.1.9, Anchor 1.0.2, Rust 1.89, `ephemeral-rollups-sdk` 0.17.3):

```bash
anchor build
cargo test --manifest-path programs/nightfall/Cargo.toml
```

## Devnet e2e output (abridged)

```
match live, vrf = true
crank scheduled: Dr82KEYG…
guest peeks host vision → null ✅ sealed
guest peeks world → null ✅ sealed
host peeks world → null ✅ sealed (even the host)
spectator reads public arena → ok ✅
player 0 spotted player 1 through the fog at step 6
status 3 winner slot 0 kills [ 1, 0 ] feed [ 0, 1, 1 ]
after reveal, guest reads world → visible ✅
winner received 0.02 SOL
✅ e2e complete
```

## Credits

All art (blocks, skins, items, hearts) is procedurally drawn in code: no external assets. The look is a tribute to
classic block games; the characters are original.
Built for the MagicBlock **Solana Blitz** hackathon.
