use anchor_lang::prelude::*;

pub const MAX_PLAYERS: usize = 6;
pub const NAME_LEN: usize = 12;
pub const MAX_CHESTS: usize = 6;
pub const MAX_SEEN: usize = 5;
pub const MAX_SHOTS: usize = 4;
pub const FEED_LEN: usize = 5;
pub const NONE: u8 = 255;

pub const STATUS_LOBBY: u8 = 0;
pub const STATUS_SPAWNING: u8 = 1;
pub const STATUS_LIVE: u8 = 2;
pub const STATUS_ENDED: u8 = 3;
pub const STATUS_PAID: u8 = 4;

/// Public match state. Never contains a position — only what a scoreboard would show.
#[account]
pub struct Arena {
    pub arena_id: u64,
    pub host: Pubkey,
    pub status: u8,
    pub max_players: u8,
    pub player_count: u8,
    pub stake: u64,
    pub players: [Pubkey; MAX_PLAYERS],
    pub names: [[u8; NAME_LEN]; MAX_PLAYERS],
    pub skins: [u8; MAX_PLAYERS],
    /// Bitmask of living players.
    pub alive: u8,
    pub kills: [u8; MAX_PLAYERS],
    pub spawn_requested_ts: i64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub last_zone_tick: i64,
    /// World-border half-size in tiles (Chebyshev distance from the map centre).
    pub zone: u8,
    pub winner: u8,
    /// Kill feed ring buffer: [killer, victim, cause]. killer = NONE means the border.
    pub feed: [[u8; 3]; FEED_LEN],
    pub feed_seq: u16,
    pub tick: u32,
    pub bump: u8,
}

impl Arena {
    pub const LEN: usize = 8 + 32 + 1 + 1 + 1 + 8
        + 32 * MAX_PLAYERS
        + NAME_LEN * MAX_PLAYERS
        + MAX_PLAYERS
        + 1
        + MAX_PLAYERS
        + 8 * 4
        + 1
        + 1
        + 3 * FEED_LEN
        + 2
        + 4
        + 1;

    pub fn alive_count(&self) -> u8 {
        (self.alive & ((1u16 << self.player_count) - 1) as u8).count_ones() as u8
    }

    pub fn is_alive(&self, i: usize) -> bool {
        self.alive & (1 << i) != 0
    }
}

/// The ground truth: every position, every heart. Sealed inside the TEE with no readers.
#[account]
pub struct World {
    pub arena_id: u64,
    pub x: [u8; MAX_PLAYERS],
    pub y: [u8; MAX_PLAYERS],
    pub hp: [u8; MAX_PLAYERS],
    pub facing: [u8; MAX_PLAYERS],
    /// 1 wooden sword, 2 diamond sword
    pub weapon: [u8; MAX_PLAYERS],
    pub arrows: [u8; MAX_PLAYERS],
    pub hit_dir: [u8; MAX_PLAYERS],
    pub hit_seq: [u8; MAX_PLAYERS],
    pub last_attack_slot: [u64; MAX_PLAYERS],
    /// [x, y, kind, opened]
    pub chests: [[u8; 4]; MAX_CHESTS],
    /// [shooter, x0, y0, x1, y1, seq]
    pub shots: [[u8; 6]; MAX_SHOTS],
    pub shot_seq: u8,
    pub spawned: bool,
    pub bump: u8,
}

impl World {
    pub const LEN: usize = 8 + MAX_PLAYERS * 8 + 8 * MAX_PLAYERS + 4 * MAX_CHESTS + 6 * MAX_SHOTS + 1 + 1 + 1;
}

/// What one player is allowed to know. Readable only by that player's wallet.
#[account]
pub struct Vision {
    pub arena_id: u64,
    pub slot: u8,
    pub owner: Pubkey,
    pub version: u32,
    pub status: u8,
    pub zone: u8,
    /// [x, y, hp, facing, weapon, arrows, alive]
    pub me: [u8; 7],
    pub hit_dir: u8,
    pub hit_seq: u8,
    pub seen_count: u8,
    /// [slot, x, y, hp, facing, weapon]
    pub seen: [[u8; 6]; MAX_SEEN],
    pub chest_count: u8,
    /// [x, y, kind]
    pub chests: [[u8; 3]; MAX_CHESTS],
    /// [shooter, x0, y0, x1, y1, seq]
    pub shots: [[u8; 6]; MAX_SHOTS],
    /// Hearing: bit k set = an unseen enemy is somewhere in compass octant k (0 = N, clockwise).
    /// A direction, never a position.
    pub heard: u8,
    pub bump: u8,
}

impl Vision {
    pub const LEN: usize = 8 + 1 + 32 + 4 + 1 + 1 + 7 + 1 + 1 + 1 + 6 * MAX_SEEN + 1 + 3 * MAX_CHESTS + 6 * MAX_SHOTS + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    Arena { arena_id: u64 },
    World { arena_id: u64 },
    Vision { arena_id: u64, slot: u8 },
}
