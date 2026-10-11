#![allow(unexpected_cfgs, deprecated)]
//! Nightfall — a real-time battle royale with true fog of war.
//!
//! Positions live in a `World` account sealed inside MagicBlock's Private Ephemeral Rollup (TEE)
//! with zero readers. Each move recomputes one `Vision` account per player, readable only by that
//! player's wallet. Nobody — not opponents, not spectators, not the host — can see more.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::instructions::{CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi};
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, EphemeralPermission, Member, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::vrf::instructions::{create_request_high_priority_scoped_randomness_ix, RequestRandomnessParams};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

pub mod logic;
pub mod map;
pub mod state;

use state::*;

declare_id!("Ccu5SMkkNDj2sBE3mpFhWeUGujQg29aQZ2BKS7CRXbDB");

pub const ARENA_SEED: &[u8] = b"arena";
pub const WORLD_SEED: &[u8] = b"world";
pub const VISION_SEED: &[u8] = b"vision";
pub const VAULT_SEED: &[u8] = b"vault";
pub const BROADCAST_SEED: &[u8] = b"broadcast";
pub const REGISTRY_SEED: &[u8] = b"registry";
/// Seconds the host must wait for the VRF callback before falling back to TEE-local entropy.
pub const SPAWN_FALLBACK_SECS: i64 = 8;

#[ephemeral]
#[program]
pub mod nightfall {
    use super::*;

    // ───────────────────────────── base layer: lobby ─────────────────────────────

    /// Host opens an arena and takes slot 0. Every PDA is pre-funded with the rent its
    /// ephemeral permission will need once it lives on the TEE.
    pub fn create_arena(
        ctx: Context<CreateArena>,
        arena_id: u64,
        stake: u64,
        max_players: u8,
        name: [u8; NAME_LEN],
        skin: u8,
        map_id: u8,
        mode: u8,
    ) -> Result<()> {
        let payer = &ctx.accounts.host;
        let sys = ctx.accounts.system_program.key();
        fund(sys, payer, &ctx.accounts.arena.to_account_info(), EphemeralPermission::size_of(0))?;
        fund(sys, payer, &ctx.accounts.world.to_account_info(), EphemeralPermission::size_of(0))?;
        fund(sys, payer, &ctx.accounts.vision.to_account_info(), EphemeralPermission::size_of(1))?;
        fund(sys, payer, &ctx.accounts.broadcast.to_account_info(), EphemeralPermission::size_of(0))?;
        if stake > 0 {
            transfer(
                CpiContext::new(sys, Transfer { from: payer.to_account_info(), to: ctx.accounts.vault.to_account_info() }),
                stake,
            )?;
        }

        let arena = &mut ctx.accounts.arena;
        arena.arena_id = arena_id;
        arena.host = payer.key();
        arena.status = STATUS_LOBBY;
        arena.max_players = max_players.clamp(1, MAX_PLAYERS as u8);
        arena.player_count = 1;
        arena.stake = stake;
        arena.players[0] = payer.key();
        arena.names[0] = name;
        arena.skins[0] = skin;
        arena.winner = NONE;
        arena.zone = logic::ZONE_START;
        arena.bump = ctx.bumps.arena;
        arena.map_id = map_id % map::MAP_COUNT as u8;
        arena.mode = mode.min(MODE_DAY);

        let b = &mut ctx.accounts.broadcast;
        b.arena_id = arena_id;
        b.bump = ctx.bumps.broadcast;

        let r = &mut ctx.accounts.registry;
        r.bump = ctx.bumps.registry;
        let h = r.head as usize % REGISTRY_LEN;
        r.ids[h] = arena_id;
        r.maps[h] = arena.map_id;
        r.modes[h] = arena.mode;
        r.created[h] = Clock::get()?.unix_timestamp;
        r.head = ((h + 1) % REGISTRY_LEN) as u8;

        let world = &mut ctx.accounts.world;
        world.arena_id = arena_id;
        world.hit_dir = [NONE; MAX_PLAYERS];
        world.bump = ctx.bumps.world;
        world.map_id = map_id % map::MAP_COUNT as u8;

        init_vision(&mut ctx.accounts.vision, arena_id, 0, payer.key(), ctx.bumps.vision);
        Ok(())
    }

    /// Take the next free slot and match the host's stake.
    pub fn join_arena(ctx: Context<JoinArena>, name: [u8; NAME_LEN], skin: u8) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let player = ctx.accounts.player.key();
        require!(arena.status == STATUS_LOBBY, NightfallError::NotInLobby);
        require!(arena.player_count < arena.max_players, NightfallError::ArenaFull);
        require!(!arena.players[..arena.player_count as usize].contains(&player), NightfallError::AlreadyJoined);

        let sys = ctx.accounts.system_program.key();
        fund(sys, &ctx.accounts.player, &ctx.accounts.vision.to_account_info(), EphemeralPermission::size_of(1))?;
        if arena.stake > 0 {
            transfer(
                CpiContext::new(sys, Transfer { from: ctx.accounts.player.to_account_info(), to: ctx.accounts.vault.to_account_info() }),
                arena.stake,
            )?;
        }

        let slot = arena.player_count;
        arena.players[slot as usize] = player;
        arena.names[slot as usize] = name;
        arena.skins[slot as usize] = skin;
        arena.player_count += 1;
        let arena_id = arena.arena_id;
        init_vision(&mut ctx.accounts.vision, arena_id, slot, player, ctx.bumps.vision);
        Ok(())
    }

    /// Hand an arena PDA to the TEE validator.
    pub fn delegate_pda(ctx: Context<DelegatePda>, account_type: AccountType) -> Result<()> {
        let seeds = seeds_for(&account_type);
        let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &seed_refs,
            DelegateConfig { validator: ctx.accounts.validator.as_ref().map(|v| v.key()), ..Default::default() },
        )?;
        Ok(())
    }

    // ───────────────────────────── TEE: privacy setup ─────────────────────────────

    /// Create the ephemeral permission for a delegated PDA. The program — never the caller —
    /// decides who may read: the Arena is public, the World has no readers at all, and a
    /// Vision is readable only by the wallet that owns that slot.
    pub fn init_permission(ctx: Context<InitPermission>, account_type: AccountType) -> Result<()> {
        // Ephemeral accounts carry no lamports, so test for existence by owner / data instead.
        let existing = &ctx.accounts.permission;
        if *existing.owner == PERMISSION_PROGRAM_ID || !existing.data_is_empty() {
            return Ok(());
        }
        let mut seeds = seeds_for(&account_type);
        let refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
        let (pda, bump) = Pubkey::find_program_address(&refs, &crate::ID);
        require_keys_eq!(pda, ctx.accounts.permissioned_account.key(), NightfallError::BadAccount);
        seeds.push(vec![bump]);
        let refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();

        let (is_private, members) = match account_type {
            AccountType::Arena { .. } | AccountType::Broadcast { .. } => (false, vec![]),
            AccountType::World { .. } => (true, vec![]),
            AccountType::Vision { .. } => {
                let data = ctx.accounts.permissioned_account.try_borrow_data()?;
                let vision = Vision::try_deserialize(&mut &data[..])?;
                (true, vec![Member { flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG, pubkey: vision.owner }])
            }
        };
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.permissioned_account.to_account_info(),
            permissioned_account: ctx.accounts.permissioned_account.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private, members },
        }
        .invoke_signed(&[refs.as_slice()])?;
        Ok(())
    }

    // ───────────────────────────── TEE: spawn via VRF ─────────────────────────────

    /// Ask MagicBlock's VRF oracle where everyone spawns. The randomness is delivered straight
    /// into the sealed World, so even the oracle's output can't be used to locate a player.
    pub fn request_spawn<'info>(ctx: Context<'info, RequestSpawn<'info>>, client_seed: u8) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        require_keys_eq!(ctx.accounts.payer.key(), arena.host, NightfallError::NotHost);
        require!(arena.status == STATUS_LOBBY || arena.status == STATUS_SPAWNING, NightfallError::AlreadyStarted);
        require_sealed(arena, &ctx.accounts.world.key(), ctx.remaining_accounts)?;
        arena.status = STATUS_SPAWNING;
        arena.spawn_requested_ts = Clock::get()?.unix_timestamp;

        let ix = create_request_high_priority_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: instruction::SpawnCallback::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![
                SerializableAccountMeta { pubkey: arena.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.world.key(), is_signer: false, is_writable: true },
            ]),
            callback_args: None,
        });
        arena.exit(&crate::ID)?;
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    pub fn spawn_callback(ctx: Context<SpawnCallback>, randomness: [u8; 32]) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        if arena.status != STATUS_SPAWNING {
            return Ok(()); // late or duplicate delivery
        }
        logic::spawn(arena, &mut ctx.accounts.world, &randomness, Clock::get()?.unix_timestamp);
        msg!("Nightfall: the sun has set");
        Ok(())
    }

    /// If the oracle hasn't answered, the host can start from entropy mixed inside the TEE.
    pub fn spawn_fallback<'info>(ctx: Context<'info, SpawnFallback<'info>>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let clock = Clock::get()?;
        require_keys_eq!(ctx.accounts.host.key(), arena.host, NightfallError::NotHost);
        require_sealed(arena, &ctx.accounts.world.key(), ctx.remaining_accounts)?;
        // Straight from the lobby (the VRF request itself failed) or after the oracle timed out.
        require!(
            arena.status == STATUS_LOBBY
                || (arena.status == STATUS_SPAWNING && clock.unix_timestamp >= arena.spawn_requested_ts + SPAWN_FALLBACK_SECS),
            NightfallError::TooEarly
        );
        let mut entropy = arena.key().to_bytes();
        let mut acc = clock.slot ^ (clock.unix_timestamp as u64).rotate_left(32);
        for (i, b) in entropy.iter_mut().enumerate() {
            let p = arena.players[i % MAX_PLAYERS].to_bytes()[i];
            acc = acc.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407 ^ p as u64);
            *b ^= (acc >> 33) as u8;
        }
        logic::spawn(arena, &mut ctx.accounts.world, &entropy, clock.unix_timestamp);
        Ok(())
    }

    // ───────────────────────────── TEE: gameplay ─────────────────────────────

    /// One action: move / sword / bow in a direction. Remaining accounts: every Vision PDA in
    /// slot order, so every player's fog of war updates in the same transaction.
    pub fn act<'info>(ctx: Context<'info, Act<'info>>, action: u8, dir: u8) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let world = &mut ctx.accounts.world;
        require!(arena.status == STATUS_LIVE, NightfallError::NotLive);
        let me = arena.players[..arena.player_count as usize]
            .iter()
            .position(|p| *p == ctx.accounts.player.key())
            .ok_or(NightfallError::NotAPlayer)?;
        require!(arena.is_alive(me), NightfallError::Dead);

        let clock = Clock::get()?;
        logic::tick(arena, world, clock.unix_timestamp);
        if arena.status == STATUS_LIVE && arena.is_alive(me) {
            logic::act(arena, world, me, action, dir, clock.slot, clock.unix_timestamp).map_err(|e| match e {
                logic::ActError::Cooldown => NightfallError::Cooldown,
                logic::ActError::NoArrows => NightfallError::NoArrows,
                logic::ActError::NoPower => NightfallError::NoPower,
            })?;
        }
        refresh_visions(arena, world, ctx.remaining_accounts, clock.unix_timestamp)
    }

    /// Advance the world border. Permissionless and idempotent; scheduled as a MagicBlock crank.
    pub fn tick<'info>(ctx: Context<'info, Tick<'info>>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        let world = &mut ctx.accounts.world;
        let now = Clock::get()?.unix_timestamp;
        logic::tick(arena, world, now);
        logic::broadcast(world, &mut ctx.accounts.broadcast);
        refresh_visions(arena, world, ctx.remaining_accounts, now)
    }

    /// Schedule `tick` on the ER's own scheduler so the border closes in even if nobody moves.
    pub fn schedule_ticks<'info>(ctx: Context<'info, ScheduleTicks<'info>>, task_id: i64, interval_ms: i64, iterations: i64) -> Result<()> {
        let mut metas = vec![
            AccountMeta::new(ctx.accounts.arena.key(), false),
            AccountMeta::new(ctx.accounts.world.key(), false),
            AccountMeta::new(ctx.accounts.broadcast.key(), false),
        ];
        metas.extend(ctx.remaining_accounts.iter().map(|a| AccountMeta::new(a.key(), false)));
        let tick_ix = Instruction {
            program_id: crate::ID,
            accounts: metas,
            data: anchor_lang::InstructionData::data(&instruction::Tick {}),
        };
        let mut accounts = vec![
            ctx.accounts.arena.to_account_info(),
            ctx.accounts.world.to_account_info(),
            ctx.accounts.broadcast.to_account_info(),
        ];
        accounts.extend(ctx.remaining_accounts.iter().cloned());
        ScheduleCrankCpi {
            payer: &ctx.accounts.payer,
            magic_program: &ctx.accounts.magic_program,
            instruction_accounts: &accounts,
            args: ScheduleTaskArgs { task_id, execution_interval_millis: interval_ms, iterations, instructions: vec![tick_ix] },
        }
        .invoke()?;
        Ok(())
    }

    // ───────────────────────────── endgame ─────────────────────────────

    /// After the last player falls, unseal the World so everyone can see how it played out.
    pub fn reveal(ctx: Context<Reveal>) -> Result<()> {
        require!(ctx.accounts.arena.status >= STATUS_ENDED, NightfallError::NotEnded);
        let world = &ctx.accounts.world;
        UpdateEphemeralPermissionCpi {
            payer: world.to_account_info(),
            permissioned_account: world.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: world.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs { is_private: false, members: vec![] },
        }
        .invoke_signed(&[&[WORLD_SEED, &world.arena_id.to_le_bytes(), &[world.bump]]])?;
        Ok(())
    }

    /// Commit the final result to Solana and release the arena from the rollup.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        require!(ctx.accounts.arena.status >= STATUS_ENDED, NightfallError::NotEnded);
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.arena.to_account_info(), ctx.accounts.world.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Base layer: the vault pays the whole pot to the last one standing.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let arena = &mut ctx.accounts.arena;
        require!(arena.status == STATUS_ENDED, NightfallError::NotEnded);
        require!(arena.winner != NONE, NightfallError::NoWinner);
        require_keys_eq!(ctx.accounts.winner.key(), arena.players[arena.winner as usize], NightfallError::NotWinner);
        arena.status = STATUS_PAID;
        let pot = arena.stake * arena.player_count as u64;
        if pot > 0 {
            let id = arena.arena_id.to_le_bytes();
            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.key(),
                    Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.winner.to_account_info() },
                    &[&[VAULT_SEED, &id, &[ctx.bumps.vault]]],
                ),
                pot,
            )?;
        }
        Ok(())
    }
}

// ───────────────────────────── helpers ─────────────────────────────

fn fund<'info>(sys: Pubkey, from: &Signer<'info>, to: &AccountInfo<'info>, permission_size: usize) -> Result<()> {
    transfer(
        CpiContext::new(sys, Transfer { from: from.to_account_info(), to: to.clone() }),
        ephemeral_rollups_sdk::ephemeral_accounts::rent(permission_size as u32),
    )
}

fn init_vision(v: &mut Account<Vision>, arena_id: u64, slot: u8, owner: Pubkey, bump: u8) {
    v.arena_id = arena_id;
    v.slot = slot;
    v.owner = owner;
    v.hit_dir = NONE;
    v.bump = bump;
}

/// Recompute every player's Vision. Requires exactly one Vision per player, in slot order, so
/// nobody can blind an opponent by leaving their account out.
fn refresh_visions(arena: &Arena, world: &World, visions: &[AccountInfo], now: i64) -> Result<()> {
    require!(visions.len() == arena.player_count as usize, NightfallError::BadVisionList);
    for (i, acc) in visions.iter().enumerate() {
        require_keys_eq!(*acc.owner, crate::ID, NightfallError::BadAccount);
        let mut data = acc.try_borrow_mut_data()?;
        let mut v = Vision::try_deserialize(&mut &data[..])?;
        require!(v.arena_id == arena.arena_id && v.slot as usize == i, NightfallError::BadVisionList);
        logic::compute_vision(arena, world, i, &mut v, now);
        let mut out: &mut [u8] = &mut data[..];
        v.try_serialize(&mut out)?;
    }
    Ok(())
}

/// Spawning is only allowed once the World is sealed with no readers and every Vision is sealed
/// to its owner — which also proves we are inside the TEE rollup, not on the public base layer.
/// Remaining accounts: [world permission, vision permission × player_count].
fn require_sealed(arena: &Arena, world: &Pubkey, perms: &[AccountInfo]) -> Result<()> {
    require!(perms.len() == 1 + arena.player_count as usize, NightfallError::NotSealed);
    // No player (host included) may be a reader of anything but their own Vision.
    let players = &arena.players[..arena.player_count as usize];
    let check = |acc: &AccountInfo, target: &Pubkey, reader: Option<&Pubkey>| -> Result<()> {
        require_keys_eq!(*acc.owner, PERMISSION_PROGRAM_ID, NightfallError::NotSealed);
        let d = acc.try_borrow_data()?;
        let perm = EphemeralPermission::from_bytes(&d).map_err(|_| error!(NightfallError::NotSealed))?;
        require!(perm.private && perm.permissioned_account == *target, NightfallError::NotSealed);
        for m in perm.members {
            require!(Some(&m.pubkey) == reader || !players.contains(&m.pubkey), NightfallError::NotSealed);
        }
        Ok(())
    };
    check(&perms[0], world, None)?;
    let id = arena.arena_id.to_le_bytes();
    for i in 0..arena.player_count as usize {
        let (vision, _) = Pubkey::find_program_address(&[VISION_SEED, &id, &[i as u8]], &crate::ID);
        check(&perms[1 + i], &vision, Some(&arena.players[i]))?;
    }
    Ok(())
}

fn seeds_for(t: &AccountType) -> Vec<Vec<u8>> {
    match t {
        AccountType::Arena { arena_id } => vec![ARENA_SEED.to_vec(), arena_id.to_le_bytes().to_vec()],
        AccountType::World { arena_id } => vec![WORLD_SEED.to_vec(), arena_id.to_le_bytes().to_vec()],
        AccountType::Vision { arena_id, slot } => {
            vec![VISION_SEED.to_vec(), arena_id.to_le_bytes().to_vec(), vec![*slot]]
        }
        AccountType::Broadcast { arena_id } => vec![BROADCAST_SEED.to_vec(), arena_id.to_le_bytes().to_vec()],
    }
}

// ───────────────────────────── contexts ─────────────────────────────

#[derive(Accounts)]
#[instruction(arena_id: u64)]
pub struct CreateArena<'info> {
    #[account(init, payer = host, space = 8 + Arena::LEN, seeds = [ARENA_SEED, &arena_id.to_le_bytes()], bump)]
    pub arena: Account<'info, Arena>,
    #[account(init, payer = host, space = 8 + World::LEN, seeds = [WORLD_SEED, &arena_id.to_le_bytes()], bump)]
    pub world: Account<'info, World>,
    #[account(init, payer = host, space = 8 + Vision::LEN, seeds = [VISION_SEED, &arena_id.to_le_bytes(), &[0u8]], bump)]
    pub vision: Account<'info, Vision>,
    #[account(init, payer = host, space = 8 + Broadcast::LEN, seeds = [BROADCAST_SEED, &arena_id.to_le_bytes()], bump)]
    pub broadcast: Account<'info, Broadcast>,
    #[account(init_if_needed, payer = host, space = 8 + Registry::LEN, seeds = [REGISTRY_SEED], bump)]
    pub registry: Account<'info, Registry>,
    #[account(mut, seeds = [VAULT_SEED, &arena_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub host: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinArena<'info> {
    #[account(mut, seeds = [ARENA_SEED, &arena.arena_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(
        init,
        payer = player,
        space = 8 + Vision::LEN,
        seeds = [VISION_SEED, &arena.arena_id.to_le_bytes(), &[arena.player_count]],
        bump
    )]
    pub vision: Account<'info, Vision>,
    #[account(mut, seeds = [VAULT_SEED, &arena.arena_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePda<'info> {
    /// CHECK: the arena PDA to delegate; seeds are re-derived from `account_type`
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: the TEE validator
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct InitPermission<'info> {
    /// CHECK: verified against `account_type` seeds; pays for and signs its own permission
    #[account(mut)]
    pub permissioned_account: UncheckedAccount<'info>,
    /// CHECK: verified by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestSpawn<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ARENA_SEED, &arena.arena_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(seeds = [WORLD_SEED, &arena.arena_id.to_le_bytes()], bump = world.bump)]
    pub world: Account<'info, World>,
    /// CHECK: MagicBlock VRF oracle queue
    #[account(
        mut,
        constraint = oracle_queue.key() == ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct SpawnCallback<'info> {
    #[account(mut)]
    pub arena: Account<'info, Arena>,
    #[account(mut, constraint = world.arena_id == arena.arena_id @ NightfallError::BadAccount)]
    pub world: Account<'info, World>,
}

#[derive(Accounts)]
pub struct SpawnFallback<'info> {
    #[account(mut, seeds = [ARENA_SEED, &arena.arena_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut, seeds = [WORLD_SEED, &arena.arena_id.to_le_bytes()], bump = world.bump)]
    pub world: Account<'info, World>,
    pub host: Signer<'info>,
}

#[derive(Accounts)]
pub struct Act<'info> {
    #[account(mut, seeds = [ARENA_SEED, &arena.arena_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut, seeds = [WORLD_SEED, &arena.arena_id.to_le_bytes()], bump = world.bump)]
    pub world: Account<'info, World>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(mut, seeds = [ARENA_SEED, &arena.arena_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut, seeds = [WORLD_SEED, &arena.arena_id.to_le_bytes()], bump = world.bump)]
    pub world: Account<'info, World>,
    #[account(mut, seeds = [BROADCAST_SEED, &arena.arena_id.to_le_bytes()], bump = broadcast.bump)]
    pub broadcast: Account<'info, Broadcast>,
}

#[derive(Accounts)]
pub struct ScheduleTicks<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: passed through to the scheduled instruction (not re-serialized here)
    #[account(mut)]
    pub arena: UncheckedAccount<'info>,
    /// CHECK: passed through to the scheduled instruction
    #[account(mut)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: passed through to the scheduled instruction
    #[account(mut)]
    pub broadcast: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Reveal<'info> {
    #[account(seeds = [ARENA_SEED, &arena.arena_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut, seeds = [WORLD_SEED, &arena.arena_id.to_le_bytes()], bump = world.bump)]
    pub world: Account<'info, World>,
    /// CHECK: verified by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ARENA_SEED, &arena.arena_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut, seeds = [WORLD_SEED, &arena.arena_id.to_le_bytes()], bump = world.bump)]
    pub world: Account<'info, World>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut, seeds = [ARENA_SEED, &arena.arena_id.to_le_bytes()], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut, seeds = [VAULT_SEED, &arena.arena_id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: checked against the recorded winner
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum NightfallError {
    #[msg("Arena is no longer in the lobby")]
    NotInLobby,
    #[msg("Arena is full")]
    ArenaFull,
    #[msg("Already in this arena")]
    AlreadyJoined,
    #[msg("Only the host can do that")]
    NotHost,
    #[msg("Match already started")]
    AlreadyStarted,
    #[msg("Wait for the VRF oracle a little longer")]
    TooEarly,
    #[msg("Match is not live")]
    NotLive,
    #[msg("Not a player in this arena")]
    NotAPlayer,
    #[msg("You are dead")]
    Dead,
    #[msg("Weapon is cooling down")]
    Cooldown,
    #[msg("Out of arrows")]
    NoArrows,
    #[msg("No power to use (or nowhere to blink)")]
    NoPower,
    #[msg("Vision accounts must be passed for every player in slot order")]
    BadVisionList,
    #[msg("Unexpected account")]
    BadAccount,
    #[msg("Match has not ended")]
    NotEnded,
    #[msg("No winner recorded")]
    NoWinner,
    #[msg("That is not the winner")]
    NotWinner,
    #[msg("World and every Vision must be sealed inside the TEE before spawning")]
    NotSealed,
}
