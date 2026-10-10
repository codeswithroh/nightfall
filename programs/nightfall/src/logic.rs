//! Pure game rules. Everything here runs inside the TEE; nothing here ever logs a position.
use crate::map::{CHEST_SPOTS, MAP_H, MAP_W, SPAWNS, TILES};
use crate::state::*;

pub const MAX_HP: u8 = 20;
pub const START_ARROWS: u8 = 3;
/// Torch radius, squared (≈4.5 tiles).
pub const VISION_R2: i32 = 20;
/// You can hear (but not see) enemies within ~8 tiles.
pub const HEARING_R2: i32 = 64;
pub const SWORD_DMG: [u8; 3] = [0, 4, 7];
pub const BOW_DMG: u8 = 3;
pub const BOW_RANGE: i32 = 7;
pub const SWORD_COOLDOWN_SLOTS: u64 = 4;
pub const BOW_COOLDOWN_SLOTS: u64 = 10;
pub const APPLE_HEAL: u8 = 8;
pub const QUIVER_ARROWS: u8 = 4;

/// Nobody can be hurt by another player for the first seconds of a match.
pub const SPAWN_SAFE_SECS: i64 = 10;

pub const ZONE_START: u8 = 12;
pub const ZONE_MIN: u8 = 1;
pub const ZONE_GRACE_SECS: i64 = 40;
pub const ZONE_SHRINK_SECS: i64 = 8;
pub const ZONE_TICK_SECS: i64 = 2;
pub const ZONE_DMG: u8 = 2;

pub const CHEST_DIAMOND_SWORD: u8 = 1;
pub const CHEST_GOLDEN_APPLE: u8 = 2;
pub const CHEST_QUIVER: u8 = 3;

pub const CAUSE_SWORD: u8 = 1;
pub const CAUSE_BOW: u8 = 2;
pub const CAUSE_BORDER: u8 = 3;

pub const ACT_MOVE: u8 = 0;
pub const ACT_SWORD: u8 = 1;
pub const ACT_BOW: u8 = 2;

const DX: [i32; 4] = [0, 1, 0, -1];
const DY: [i32; 4] = [-1, 0, 1, 0];

pub fn tile(x: i32, y: i32) -> u8 {
    if x < 0 || y < 0 || x >= MAP_W as i32 || y >= MAP_H as i32 {
        return 1;
    }
    TILES[y as usize * MAP_W + x as usize]
}

fn walkable(x: i32, y: i32) -> bool {
    matches!(tile(x, y), 0 | 2)
}

fn blocks_sight(x: i32, y: i32) -> bool {
    matches!(tile(x, y), 1 | 2)
}

/// Bresenham line of sight; only the cells strictly between the endpoints can block.
pub fn line_of_sight(x0: i32, y0: i32, x1: i32, y1: i32) -> bool {
    let (dx, dy) = ((x1 - x0).abs(), -(y1 - y0).abs());
    let (sx, sy) = (if x0 < x1 { 1 } else { -1 }, if y0 < y1 { 1 } else { -1 });
    let (mut x, mut y, mut err) = (x0, y0, dx + dy);
    loop {
        if x == x1 && y == y1 {
            return true;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
        if (x != x1 || y != y1) && blocks_sight(x, y) {
            return false;
        }
    }
}

pub fn zone_at(start_ts: i64, now: i64) -> u8 {
    let elapsed = now - start_ts;
    if elapsed < ZONE_GRACE_SECS {
        return ZONE_START;
    }
    let shrunk = (elapsed - ZONE_GRACE_SECS) / ZONE_SHRINK_SECS + 1;
    (ZONE_START as i64 - shrunk).max(ZONE_MIN as i64) as u8
}

pub fn in_zone(zone: u8, x: u8, y: u8) -> bool {
    let w = MAP_W as i32 - 1;
    let z = 2 * zone as i32;
    (2 * x as i32 - w).abs() < z && (2 * y as i32 - w).abs() < z
}

/// Byte stream over the VRF output so a single 32-byte draw can feed several shuffles.
struct Rng<'a> {
    bytes: &'a [u8; 32],
    i: usize,
}

impl Rng<'_> {
    fn below(&mut self, n: usize) -> usize {
        let b = self.bytes[self.i % 32] as usize ^ (self.i / 32);
        self.i += 1;
        b % n
    }
}

/// Place every player on a random spawn and scatter the loot chests.
pub fn spawn(arena: &mut Arena, world: &mut World, randomness: &[u8; 32], now: i64) {
    let mut rng = Rng { bytes: randomness, i: 0 };
    // The four corners fill first (indices 0, 1, 6, 7 in map scan order), then the side
    // spawns, so small matches start as far apart as possible.
    let mut corners: [usize; 4] = [0, 1, 6, 7];
    let mut sides: [usize; 4] = [2, 3, 4, 5];
    for i in (1..4).rev() {
        corners.swap(i, rng.below(i + 1));
        sides.swap(i, rng.below(i + 1));
    }
    let spawns = [corners[0], corners[1], corners[2], corners[3], sides[0], sides[1], sides[2], sides[3]];
    let mut spots: [usize; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    for i in (1..spots.len()).rev() {
        spots.swap(i, rng.below(i + 1));
    }

    for i in 0..arena.player_count as usize {
        let (x, y) = SPAWNS[spawns[i]];
        world.x[i] = x;
        world.y[i] = y;
        world.hp[i] = MAX_HP;
        world.facing[i] = if y < MAP_H as u8 / 2 { 2 } else { 0 };
        world.weapon[i] = 1;
        world.arrows[i] = START_ARROWS;
        world.hit_dir[i] = NONE;
    }
    for c in 0..MAX_CHESTS {
        let (x, y) = CHEST_SPOTS[spots[c]];
        // Guarantee at least two of each loot type.
        let kind = (c % 3) as u8 + 1;
        world.chests[c] = [x, y, kind, 0];
    }
    world.spawned = true;
    arena.alive = ((1u16 << arena.player_count) - 1) as u8;
    arena.status = STATUS_LIVE;
    arena.start_ts = now;
    arena.last_zone_tick = now;
    arena.zone = ZONE_START;
}

fn push_feed(arena: &mut Arena, killer: u8, victim: u8, cause: u8) {
    let idx = arena.feed_seq as usize % FEED_LEN;
    arena.feed[idx] = [killer, victim, cause];
    arena.feed_seq = arena.feed_seq.wrapping_add(1);
}

fn damage(arena: &mut Arena, world: &mut World, victim: usize, amount: u8, from: u8, from_dir: u8, cause: u8) {
    world.hp[victim] = world.hp[victim].saturating_sub(amount);
    world.hit_dir[victim] = from_dir;
    world.hit_seq[victim] = world.hit_seq[victim].wrapping_add(1);
    if world.hp[victim] == 0 {
        arena.alive &= !(1 << victim);
        if from != NONE {
            arena.kills[from as usize] = arena.kills[from as usize].saturating_add(1);
        }
        push_feed(arena, from, victim as u8, cause);
    }
}

fn player_at(arena: &Arena, world: &World, x: i32, y: i32) -> Option<usize> {
    (0..arena.player_count as usize).find(|&j| arena.is_alive(j) && world.x[j] as i32 == x && world.y[j] as i32 == y)
}

fn check_winner(arena: &mut Arena, now: i64) {
    // A solo arena (practice) only ends when its one player dies.
    let survivors = if arena.player_count > 1 { 1 } else { 0 };
    if arena.status != STATUS_LIVE || arena.alive_count() > survivors {
        return;
    }
    arena.status = STATUS_ENDED;
    arena.end_ts = now;
    arena.winner = (0..arena.player_count as usize)
        .find(|&j| arena.is_alive(j))
        // Everyone died on the same border tick: most kills takes it.
        .or_else(|| (0..arena.player_count as usize).max_by_key(|&j| (arena.kills[j], j as u8)))
        .map(|j| j as u8)
        .unwrap_or(NONE);
}

pub enum ActError {
    Cooldown,
    NoArrows,
}

pub fn act(arena: &mut Arena, world: &mut World, me: usize, action: u8, dir: u8, slot: u64, now: i64) -> Result<(), ActError> {
    let d = (dir % 4) as usize;
    world.facing[me] = d as u8;
    let protected = now < arena.start_ts + SPAWN_SAFE_SECS;
    let (x, y) = (world.x[me] as i32, world.y[me] as i32);
    let opposite = ((d + 2) % 4) as u8;
    match action {
        ACT_MOVE => {
            let (nx, ny) = (x + DX[d], y + DY[d]);
            if walkable(nx, ny) && player_at(arena, world, nx, ny).is_none() {
                world.x[me] = nx as u8;
                world.y[me] = ny as u8;
                for chest in world.chests.iter_mut() {
                    if chest[3] == 0 && chest[0] as i32 == nx && chest[1] as i32 == ny {
                        chest[3] = 1;
                        match chest[2] {
                            CHEST_DIAMOND_SWORD => world.weapon[me] = 2,
                            CHEST_GOLDEN_APPLE => world.hp[me] = (world.hp[me] + APPLE_HEAL).min(MAX_HP),
                            _ => world.arrows[me] = world.arrows[me].saturating_add(QUIVER_ARROWS),
                        }
                    }
                }
            }
        }
        ACT_SWORD => {
            if slot < world.last_attack_slot[me] + SWORD_COOLDOWN_SLOTS {
                return Err(ActError::Cooldown);
            }
            world.last_attack_slot[me] = slot;
            if let Some(v) = player_at(arena, world, x + DX[d], y + DY[d]).filter(|_| !protected) {
                let dmg = SWORD_DMG[world.weapon[me] as usize % 3];
                damage(arena, world, v, dmg, me as u8, opposite, CAUSE_SWORD);
            }
        }
        _ => {
            if world.arrows[me] == 0 {
                return Err(ActError::NoArrows);
            }
            if slot < world.last_attack_slot[me] + BOW_COOLDOWN_SLOTS {
                return Err(ActError::Cooldown);
            }
            world.last_attack_slot[me] = slot;
            world.arrows[me] -= 1;
            let (mut ex, mut ey) = (x, y);
            let mut hit = None;
            for _ in 0..BOW_RANGE {
                let (nx, ny) = (ex + DX[d], ey + DY[d]);
                if tile(nx, ny) == 1 {
                    break;
                }
                ex = nx;
                ey = ny;
                if let Some(v) = player_at(arena, world, ex, ey) {
                    hit = Some(v);
                    break;
                }
            }
            world.shot_seq = world.shot_seq.wrapping_add(1);
            let idx = world.shot_seq as usize % MAX_SHOTS;
            world.shots[idx] = [me as u8, x as u8, y as u8, ex as u8, ey as u8, world.shot_seq];
            if let Some(v) = hit.filter(|_| !protected) {
                damage(arena, world, v, BOW_DMG, me as u8, opposite, CAUSE_BOW);
            }
        }
    }
    check_winner(arena, now);
    Ok(())
}

/// Advance the world border and burn anyone caught outside it. Safe to call any number of times.
pub fn tick(arena: &mut Arena, world: &mut World, now: i64) {
    if arena.status != STATUS_LIVE {
        return;
    }
    arena.tick = arena.tick.wrapping_add(1);
    arena.zone = zone_at(arena.start_ts, now);
    if now - arena.last_zone_tick < ZONE_TICK_SECS {
        return;
    }
    arena.last_zone_tick = now;
    for j in 0..arena.player_count as usize {
        if arena.is_alive(j) && !in_zone(arena.zone, world.x[j], world.y[j]) {
            damage(arena, world, j, ZONE_DMG, NONE, NONE, CAUSE_BORDER);
        }
    }
    check_winner(arena, now);
}

fn dist2(ax: u8, ay: u8, bx: u8, by: u8) -> i32 {
    let (dx, dy) = (ax as i32 - bx as i32, ay as i32 - by as i32);
    dx * dx + dy * dy
}

/// Compass octant of a delta (y grows southward): 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SW, 6 W, 7 NW.
pub fn octant(dx: i32, dy: i32) -> u8 {
    // tan(22.5°) ≈ 5/12: a component under 5/12 of the other one doesn't count as a diagonal.
    let (ax, ay) = (dx.abs() * 12, dy.abs() * 12);
    let horiz = ay < dx.abs() * 5;
    let vert = ax < dy.abs() * 5;
    match (dx.signum(), dy.signum(), horiz, vert) {
        (_, -1, _, true) | (0, -1, _, _) => 0,
        (1, _, true, _) | (1, 0, _, _) => 2,
        (_, 1, _, true) | (0, 1, _, _) => 4,
        (-1, _, true, _) | (-1, 0, _, _) => 6,
        (1, -1, _, _) => 1,
        (1, 1, _, _) => 3,
        (-1, 1, _, _) => 5,
        _ => 7,
    }
}

/// Rebuild what player `i` is allowed to see: the fog of war itself.
pub fn compute_vision(arena: &Arena, world: &World, i: usize, v: &mut Vision) {
    v.version = v.version.wrapping_add(1);
    v.status = arena.status;
    v.zone = arena.zone;
    let alive = arena.is_alive(i);
    let (mx, my) = (world.x[i], world.y[i]);
    v.me = [mx, my, world.hp[i], world.facing[i], world.weapon[i], world.arrows[i], alive as u8];
    v.hit_dir = world.hit_dir[i];
    v.hit_seq = world.hit_seq[i];
    v.seen = [[0; 6]; MAX_SEEN];
    v.seen_count = 0;
    v.chests = [[0; 3]; MAX_CHESTS];
    v.chest_count = 0;
    v.shots = [[0; 6]; MAX_SHOTS];
    v.heard = 0;
    // The dead see nothing until the match is over.
    if !alive || !world.spawned {
        return;
    }
    let sees = |x: u8, y: u8| dist2(mx, my, x, y) <= VISION_R2 && line_of_sight(mx as i32, my as i32, x as i32, y as i32);

    for j in 0..arena.player_count as usize {
        if j == i || !arena.is_alive(j) || v.seen_count as usize >= MAX_SEEN {
            continue;
        }
        let (x, y) = (world.x[j], world.y[j]);
        let hidden_in_grass = tile(x as i32, y as i32) == 2 && dist2(mx, my, x, y) > 2;
        if !hidden_in_grass && sees(x, y) {
            v.seen[v.seen_count as usize] = [j as u8, x, y, world.hp[j], world.facing[j], world.weapon[j]];
            v.seen_count += 1;
        } else if dist2(mx, my, x, y) <= HEARING_R2 {
            v.heard |= 1 << octant(x as i32 - mx as i32, y as i32 - my as i32);
        }
    }
    for c in world.chests.iter() {
        if c[3] == 0 && sees(c[0], c[1]) {
            v.chests[v.chest_count as usize] = [c[0], c[1], c[2]];
            v.chest_count += 1;
        }
    }
    for (k, s) in world.shots.iter().enumerate() {
        if s[5] != 0 && (dist2(mx, my, s[1], s[2]) <= VISION_R2 || dist2(mx, my, s[3], s[4]) <= VISION_R2) {
            v.shots[k] = *s;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn arena(n: u8) -> Arena {
        Arena {
            arena_id: 1,
            host: Pubkey::default(),
            status: STATUS_SPAWNING,
            max_players: 6,
            player_count: n,
            stake: 0,
            players: [Pubkey::default(); MAX_PLAYERS],
            names: [[0; NAME_LEN]; MAX_PLAYERS],
            skins: [0; MAX_PLAYERS],
            alive: 0,
            kills: [0; MAX_PLAYERS],
            spawn_requested_ts: 0,
            start_ts: 0,
            end_ts: 0,
            last_zone_tick: 0,
            zone: ZONE_START,
            winner: NONE,
            feed: [[0; 3]; FEED_LEN],
            feed_seq: 0,
            tick: 0,
            bump: 0,
        }
    }

    fn world() -> World {
        World {
            arena_id: 1,
            x: [0; MAX_PLAYERS],
            y: [0; MAX_PLAYERS],
            hp: [0; MAX_PLAYERS],
            facing: [0; MAX_PLAYERS],
            weapon: [0; MAX_PLAYERS],
            arrows: [0; MAX_PLAYERS],
            hit_dir: [NONE; MAX_PLAYERS],
            hit_seq: [0; MAX_PLAYERS],
            last_attack_slot: [0; MAX_PLAYERS],
            chests: [[0; 4]; MAX_CHESTS],
            shots: [[0; 6]; MAX_SHOTS],
            shot_seq: 0,
            spawned: false,
            bump: 0,
        }
    }

    fn vision() -> Vision {
        Vision {
            arena_id: 1,
            slot: 0,
            owner: Pubkey::default(),
            version: 0,
            status: 0,
            zone: 0,
            me: [0; 7],
            hit_dir: NONE,
            hit_seq: 0,
            seen_count: 0,
            seen: [[0; 6]; MAX_SEEN],
            chest_count: 0,
            chests: [[0; 3]; MAX_CHESTS],
            shots: [[0; 6]; MAX_SHOTS],
            heard: 0,
            bump: 0,
        }
    }

    #[test]
    fn hearing_gives_direction_not_position() {
        assert_eq!(octant(0, -5), 0);
        assert_eq!(octant(4, -4), 1);
        assert_eq!(octant(6, 1), 2);
        assert_eq!(octant(3, 3), 3);
        assert_eq!(octant(-1, 7), 4);
        assert_eq!(octant(-5, 5), 5);
        assert_eq!(octant(-7, 0), 6);
        assert_eq!(octant(-2, -2), 7);
        let (mut a, mut w) = (arena(2), world());
        spawn(&mut a, &mut w, &[3u8; 32], 0);
        // Behind the stone at (2,3): can't be seen, can be heard to the south.
        (w.x[0], w.y[0], w.x[1], w.y[1]) = (2, 2, 2, 4);
        let mut v = vision();
        compute_vision(&a, &w, 0, &mut v);
        assert_eq!(v.seen_count, 0);
        assert_eq!(v.heard, 1 << 4);
    }

    #[test]
    fn walls_and_tall_grass_block_sight() {
        // (2,2) and (2,4) are separated by the stone at (2,3).
        assert_eq!(tile(2, 3), 1);
        assert!(!line_of_sight(2, 2, 2, 4));
        // Open grass row.
        assert!(line_of_sight(1, 7, 3, 7));
        // Tall grass at (1,5),(1,6) blocks a look straight through it.
        assert_eq!(tile(1, 5), 2);
        assert!(!line_of_sight(1, 4, 1, 7));
    }

    #[test]
    fn border_shrinks_after_grace() {
        assert_eq!(zone_at(0, 10), ZONE_START);
        assert_eq!(zone_at(0, ZONE_GRACE_SECS), ZONE_START - 1);
        assert_eq!(zone_at(0, 10_000), ZONE_MIN);
        assert!(in_zone(ZONE_START, 0, 0));
        assert!(in_zone(1, 11, 12) && !in_zone(1, 10, 12));
    }

    #[test]
    fn spawns_are_distinct_and_walkable() {
        let (mut a, mut w) = (arena(6), world());
        spawn(&mut a, &mut w, &[7u8; 32], 100);
        for i in 0..6 {
            assert!(walkable(w.x[i] as i32, w.y[i] as i32));
            for j in 0..i {
                assert!((w.x[i], w.y[i]) != (w.x[j], w.y[j]));
            }
        }
        assert_eq!(a.status, STATUS_LIVE);
        assert_eq!(a.alive_count(), 6);
    }

    #[test]
    fn fog_hides_far_players_and_sword_kills() {
        let (mut a, mut w) = (arena(2), world());
        spawn(&mut a, &mut w, &[3u8; 32], 0);
        // Put them far apart: nobody sees anybody.
        (w.x[0], w.y[0], w.x[1], w.y[1]) = (1, 7, 22, 16);
        let mut v = vision();
        compute_vision(&a, &w, 0, &mut v);
        assert_eq!(v.seen_count, 0);
        // Adjacent on open grass: visible, and a sword can reach.
        (w.x[1], w.y[1]) = (2, 7);
        compute_vision(&a, &w, 0, &mut v);
        assert_eq!(v.seen_count, 1);
        assert_eq!(v.seen[0][0], 1);
        for k in 0..5u64 {
            let _ = act(&mut a, &mut w, 0, ACT_SWORD, 1, 100 + k * SWORD_COOLDOWN_SLOTS, 100);
        }
        assert!(!a.is_alive(1));
        assert_eq!(a.status, STATUS_ENDED);
        assert_eq!(a.winner, 0);
        assert_eq!(a.kills[0], 1);
        // Cooldown is enforced.
        let (mut a2, mut w2) = (arena(2), world());
        spawn(&mut a2, &mut w2, &[3u8; 32], 0);
        assert!(act(&mut a2, &mut w2, 0, ACT_SWORD, 1, 50, 1).is_ok());
        assert!(matches!(act(&mut a2, &mut w2, 0, ACT_SWORD, 1, 51, 1), Err(ActError::Cooldown)));
    }

    #[test]
    fn spawn_protection_and_spread() {
        let (mut a, mut w) = (arena(2), world());
        spawn(&mut a, &mut w, &[5u8; 32], 1000);
        // Two players always start in different corners: at least 21 tiles apart on one axis.
        assert!((w.x[0] as i32 - w.x[1] as i32).abs() >= 20 || (w.y[0] as i32 - w.y[1] as i32).abs() >= 20);
        (w.x[0], w.y[0], w.x[1], w.y[1]) = (1, 7, 2, 7);
        assert!(act(&mut a, &mut w, 0, ACT_SWORD, 1, 100, 1005).is_ok());
        assert_eq!(w.hp[1], MAX_HP);
        assert!(act(&mut a, &mut w, 0, ACT_SWORD, 1, 200, 1000 + SPAWN_SAFE_SECS).is_ok());
        assert!(w.hp[1] < MAX_HP);
    }

    #[test]
    fn dead_players_see_nothing() {
        let (mut a, mut w) = (arena(2), world());
        spawn(&mut a, &mut w, &[9u8; 32], 0);
        a.alive = 0b10;
        let mut v = vision();
        compute_vision(&a, &w, 0, &mut v);
        assert_eq!(v.me[6], 0);
        assert_eq!(v.seen_count, 0);
    }
}
