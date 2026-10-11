//! Pure game rules. Everything here runs inside the TEE; nothing here ever logs a position.
use crate::map::{MapDef, MAPS, MAP_COUNT, MAP_H, MAP_W};
use crate::state::*;

pub const MAX_HP: u8 = 20;
pub const START_ARROWS: u8 = 3;
/// Torch radius, squared (≈4.5 tiles).
pub const VISION_R2: i32 = 20;
/// Under a Flare your sight reaches ≈8 tiles.
pub const FLARE_R2: i32 = 64;
/// You can hear (but not see) enemies within ~8 tiles.
pub const HEARING_R2: i32 = 64;
pub const BOW_DMG: u8 = 3;
pub const BOW_RANGE: i32 = 7;
pub const BOW_COOLDOWN_SLOTS: u64 = 10;
pub const APPLE_HEAL: u8 = 8;
pub const QUIVER_ARROWS: u8 = 4;
pub const POWER_SECS: i64 = 8;
pub const BLINK_RANGE: i32 = 3;

/// Nobody can be hurt by another player for the first seconds of a match.
pub const SPAWN_SAFE_SECS: i64 = 10;

pub const ZONE_START: u8 = 12;
pub const ZONE_MIN: u8 = 1;
pub const ZONE_GRACE_SECS: i64 = 40;
pub const ZONE_SHRINK_SECS: i64 = 8;
pub const ZONE_TICK_SECS: i64 = 2;
pub const ZONE_DMG: u8 = 2;

/// Melee weapons: (damage, cooldown slots, reach in tiles, knockback tiles).
pub const WEAPONS: [(u8, u64, i32, i32); 6] = [
    (0, 4, 1, 0), // unused
    (4, 4, 1, 0), // 1 wooden sword
    (6, 4, 1, 0), // 2 diamond sword
    (9, 10, 1, 0), // 3 battle axe: huge hit, slow swing
    (5, 7, 1, 2), // 4 war hammer: knocks the target back two tiles
    (5, 6, 2, 0), // 5 spear: hits two tiles away
];
pub const SWORD_COOLDOWN_SLOTS: u64 = 4;

pub const CHEST_DIAMOND_SWORD: u8 = 1;
pub const CHEST_GOLDEN_APPLE: u8 = 2;
pub const CHEST_QUIVER: u8 = 3;
pub const CHEST_AXE: u8 = 4;
pub const CHEST_HAMMER: u8 = 5;
pub const CHEST_SPEAR: u8 = 6;
pub const POWER_PEARL: u8 = 7;
pub const POWER_CLOAK: u8 = 8;
pub const POWER_FLARE: u8 = 9;
/// What the ten chests hold before the shuffle: four weapons, three heals/ammo, three powers.
const CHEST_LOOT: [u8; MAX_CHESTS] = [
    CHEST_DIAMOND_SWORD,
    CHEST_AXE,
    CHEST_HAMMER,
    CHEST_SPEAR,
    CHEST_GOLDEN_APPLE,
    CHEST_GOLDEN_APPLE,
    CHEST_QUIVER,
    POWER_PEARL,
    POWER_CLOAK,
    POWER_FLARE,
];

pub const CAUSE_SWORD: u8 = 1;
pub const CAUSE_BOW: u8 = 2;
pub const CAUSE_BORDER: u8 = 3;

pub const ACT_MOVE: u8 = 0;
pub const ACT_SWORD: u8 = 1;
pub const ACT_BOW: u8 = 2;
pub const ACT_POWER: u8 = 3;

const DX: [i32; 4] = [0, 1, 0, -1];
const DY: [i32; 4] = [-1, 0, 1, 0];

pub fn map(id: u8) -> &'static MapDef {
    &MAPS[id as usize % MAP_COUNT]
}

pub fn tile(m: &MapDef, x: i32, y: i32) -> u8 {
    if x < 0 || y < 0 || x >= MAP_W as i32 || y >= MAP_H as i32 {
        return 1;
    }
    m.tiles[y as usize * MAP_W + x as usize]
}

fn walkable(m: &MapDef, x: i32, y: i32) -> bool {
    matches!(tile(m, x, y), 0 | 2)
}

fn blocks_sight(m: &MapDef, x: i32, y: i32) -> bool {
    matches!(tile(m, x, y), 1 | 2)
}

/// Bresenham line of sight; only the cells strictly between the endpoints can block.
pub fn line_of_sight(m: &MapDef, x0: i32, y0: i32, x1: i32, y1: i32) -> bool {
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
        if (x != x1 || y != y1) && blocks_sight(m, x, y) {
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
    let m = map(arena.map_id);
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
    let mut loot = CHEST_LOOT;
    for i in (1..loot.len()).rev() {
        loot.swap(i, rng.below(i + 1));
    }

    for i in 0..arena.player_count as usize {
        let (x, y) = m.spawns[spawns[i]];
        world.x[i] = x;
        world.y[i] = y;
        world.hp[i] = MAX_HP;
        world.facing[i] = if y < MAP_H as u8 / 2 { 2 } else { 0 };
        world.weapon[i] = 1;
        world.arrows[i] = START_ARROWS;
        world.hit_dir[i] = NONE;
        world.power[i] = 0;
        world.cloak_until[i] = 0;
        world.flare_until[i] = 0;
    }
    for c in 0..MAX_CHESTS {
        let (x, y) = m.chests[spots[c]];
        world.chests[c] = [x, y, loot[c], 0];
    }
    world.map_id = arena.map_id;
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

/// Step onto a tile: open any chest there.
fn enter(world: &mut World, me: usize, x: i32, y: i32) {
    for c in 0..MAX_CHESTS {
        let chest = world.chests[c];
        if chest[3] != 0 || chest[0] as i32 != x || chest[1] as i32 != y {
            continue;
        }
        world.chests[c][3] = 1;
        match chest[2] {
            CHEST_DIAMOND_SWORD => world.weapon[me] = 2,
            CHEST_AXE => world.weapon[me] = 3,
            CHEST_HAMMER => world.weapon[me] = 4,
            CHEST_SPEAR => world.weapon[me] = 5,
            CHEST_GOLDEN_APPLE => world.hp[me] = (world.hp[me] + APPLE_HEAL).min(MAX_HP),
            CHEST_QUIVER => world.arrows[me] = world.arrows[me].saturating_add(QUIVER_ARROWS),
            p => world.power[me] = p,
        }
    }
}

pub enum ActError {
    Cooldown,
    NoArrows,
    NoPower,
}

pub fn act(arena: &mut Arena, world: &mut World, me: usize, action: u8, dir: u8, slot: u64, now: i64) -> Result<(), ActError> {
    let m = map(arena.map_id);
    let d = (dir % 4) as usize;
    world.facing[me] = d as u8;
    let (x, y) = (world.x[me] as i32, world.y[me] as i32);
    let opposite = ((d + 2) % 4) as u8;
    let protected = now < arena.start_ts + SPAWN_SAFE_SECS;
    match action {
        ACT_MOVE => {
            let (nx, ny) = (x + DX[d], y + DY[d]);
            if walkable(m, nx, ny) && player_at(arena, world, nx, ny).is_none() {
                world.x[me] = nx as u8;
                world.y[me] = ny as u8;
                enter(world, me, nx, ny);
            }
        }
        ACT_SWORD => {
            let (dmg, cooldown, reach, knock) = WEAPONS[world.weapon[me] as usize % WEAPONS.len()];
            if slot < world.last_attack_slot[me] + cooldown {
                return Err(ActError::Cooldown);
            }
            world.last_attack_slot[me] = slot;
            world.cloak_until[me] = 0; // attacking gives you away
            let mut target = None;
            for r in 1..=reach {
                let (tx, ty) = (x + DX[d] * r, y + DY[d] * r);
                if tile(m, tx, ty) == 1 {
                    break;
                }
                if let Some(v) = player_at(arena, world, tx, ty) {
                    target = Some(v);
                    break;
                }
            }
            if let Some(v) = target.filter(|_| !protected) {
                damage(arena, world, v, dmg, me as u8, opposite, CAUSE_SWORD);
                // Knockback: shove the survivor away while the ground allows it.
                if arena.is_alive(v) {
                    for _ in 0..knock {
                        let (kx, ky) = (world.x[v] as i32 + DX[d], world.y[v] as i32 + DY[d]);
                        if !walkable(m, kx, ky) || player_at(arena, world, kx, ky).is_some() {
                            break;
                        }
                        world.x[v] = kx as u8;
                        world.y[v] = ky as u8;
                        enter(world, v, kx, ky);
                    }
                }
            }
        }
        ACT_BOW => {
            if world.arrows[me] == 0 {
                return Err(ActError::NoArrows);
            }
            if slot < world.last_attack_slot[me] + BOW_COOLDOWN_SLOTS {
                return Err(ActError::Cooldown);
            }
            world.last_attack_slot[me] = slot;
            world.arrows[me] -= 1;
            world.cloak_until[me] = 0;
            let (mut ex, mut ey) = (x, y);
            let mut hit = None;
            for _ in 0..BOW_RANGE {
                let (nx, ny) = (ex + DX[d], ey + DY[d]);
                if tile(m, nx, ny) == 1 {
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
        _ => match world.power[me] {
            POWER_PEARL => {
                // Blink to the farthest free tile up to three ahead, straight over walls.
                let landing = (1..=BLINK_RANGE).rev().map(|r| (x + DX[d] * r, y + DY[d] * r)).find(|&(tx, ty)| {
                    walkable(m, tx, ty) && player_at(arena, world, tx, ty).is_none()
                });
                let (tx, ty) = landing.ok_or(ActError::NoPower)?;
                world.power[me] = 0;
                world.x[me] = tx as u8;
                world.y[me] = ty as u8;
                enter(world, me, tx, ty);
            }
            POWER_CLOAK => {
                world.power[me] = 0;
                world.cloak_until[me] = now + POWER_SECS;
            }
            POWER_FLARE => {
                world.power[me] = 0;
                world.flare_until[me] = now + POWER_SECS;
            }
            _ => return Err(ActError::NoPower),
        },
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

fn secs_left(until: i64, now: i64) -> u8 {
    (until - now).clamp(0, 255) as u8
}

/// Rebuild what player `i` is allowed to see: the fog of war itself.
pub fn compute_vision(arena: &Arena, world: &World, i: usize, v: &mut Vision, now: i64) {
    let m = map(arena.map_id);
    v.version = v.version.wrapping_add(1);
    v.status = arena.status;
    v.zone = arena.zone;
    let alive = arena.is_alive(i);
    let (mx, my) = (world.x[i], world.y[i]);
    let flare = world.flare_until[i] > now;
    v.me = [
        mx,
        my,
        world.hp[i],
        world.facing[i],
        world.weapon[i],
        world.arrows[i],
        alive as u8,
        world.power[i],
        secs_left(world.cloak_until[i], now),
        secs_left(world.flare_until[i], now),
    ];
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
    let r2 = if flare { FLARE_R2 } else { VISION_R2 };
    let sees = |x: u8, y: u8| dist2(mx, my, x, y) <= r2 && line_of_sight(m, mx as i32, my as i32, x as i32, y as i32);

    for j in 0..arena.player_count as usize {
        if j == i || !arena.is_alive(j) || v.seen_count as usize >= MAX_SEEN {
            continue;
        }
        // A cloaked player is invisible and silent.
        if world.cloak_until[j] > now {
            continue;
        }
        let (x, y) = (world.x[j], world.y[j]);
        let hidden_in_grass = !flare && tile(m, x as i32, y as i32) == 2 && dist2(mx, my, x, y) > 2;
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
        if s[5] != 0 && (dist2(mx, my, s[1], s[2]) <= r2 || dist2(mx, my, s[3], s[4]) <= r2) {
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
            map_id: 0,
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
            map_id: 0,
            power: [0; MAX_PLAYERS],
            cloak_until: [0; MAX_PLAYERS],
            flare_until: [0; MAX_PLAYERS],
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
            me: [0; 10],
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

    /// Two players spawned on map 0 then placed side by side on open grass, protection over.
    fn duel() -> (Arena, World) {
        let (mut a, mut w) = (arena(2), world());
        spawn(&mut a, &mut w, &[3u8; 32], 0);
        w.chests = [[0; 4]; MAX_CHESTS];
        (w.x[0], w.y[0], w.x[1], w.y[1]) = (1, 7, 2, 7);
        (a, w)
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
        let (a, mut w) = duel();
        // Behind the stone at (2,3): can't be seen, can be heard to the south.
        (w.x[0], w.y[0], w.x[1], w.y[1]) = (2, 2, 2, 4);
        let mut v = vision();
        compute_vision(&a, &w, 0, &mut v, 100);
        assert_eq!(v.seen_count, 0);
        assert_eq!(v.heard, 1 << 4);
    }

    #[test]
    fn walls_and_tall_grass_block_sight() {
        let m = map(0);
        assert_eq!(tile(m, 2, 3), 1);
        assert!(!line_of_sight(m, 2, 2, 2, 4));
        assert!(line_of_sight(m, 1, 7, 3, 7));
        assert_eq!(tile(m, 1, 5), 2);
        assert!(!line_of_sight(m, 1, 4, 1, 7));
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
    fn every_map_spawns_distinct_walkable_players_and_ten_chests() {
        for id in 0..MAP_COUNT as u8 {
            let (mut a, mut w) = (arena(6), world());
            a.map_id = id;
            spawn(&mut a, &mut w, &[7u8; 32], 100);
            let m = map(id);
            for i in 0..6 {
                assert!(walkable(m, w.x[i] as i32, w.y[i] as i32));
                for j in 0..i {
                    assert!((w.x[i], w.y[i]) != (w.x[j], w.y[j]));
                }
            }
            let mut kinds: Vec<u8> = w.chests.iter().map(|c| c[2]).collect();
            kinds.sort();
            assert_eq!(kinds, vec![1, 2, 2, 3, 4, 5, 6, 7, 8, 9]);
            assert_eq!(a.status, STATUS_LIVE);
        }
    }

    #[test]
    fn fog_hides_far_players_and_sword_kills() {
        let (mut a, mut w) = duel();
        (w.x[1], w.y[1]) = (22, 16);
        let mut v = vision();
        compute_vision(&a, &w, 0, &mut v, 100);
        assert_eq!(v.seen_count, 0);
        (w.x[1], w.y[1]) = (2, 7);
        compute_vision(&a, &w, 0, &mut v, 100);
        assert_eq!(v.seen_count, 1);
        for k in 0..5u64 {
            let _ = act(&mut a, &mut w, 0, ACT_SWORD, 1, 100 + k * SWORD_COOLDOWN_SLOTS, 100);
        }
        assert!(!a.is_alive(1));
        assert_eq!(a.status, STATUS_ENDED);
        assert_eq!(a.winner, 0);
        let (mut a2, mut w2) = duel();
        assert!(act(&mut a2, &mut w2, 0, ACT_SWORD, 1, 50, 100).is_ok());
        assert!(matches!(act(&mut a2, &mut w2, 0, ACT_SWORD, 1, 51, 100), Err(ActError::Cooldown)));
    }

    #[test]
    fn spawn_protection_and_spread() {
        let (mut a, mut w) = (arena(2), world());
        spawn(&mut a, &mut w, &[5u8; 32], 1000);
        assert!((w.x[0] as i32 - w.x[1] as i32).abs() >= 20 || (w.y[0] as i32 - w.y[1] as i32).abs() >= 20);
        (w.x[0], w.y[0], w.x[1], w.y[1]) = (1, 7, 2, 7);
        assert!(act(&mut a, &mut w, 0, ACT_SWORD, 1, 100, 1005).is_ok());
        assert_eq!(w.hp[1], MAX_HP);
        assert!(act(&mut a, &mut w, 0, ACT_SWORD, 1, 200, 1000 + SPAWN_SAFE_SECS).is_ok());
        assert!(w.hp[1] < MAX_HP);
    }

    #[test]
    fn weapons_axe_hammer_spear() {
        // Axe: 9 damage, slow.
        let (mut a, mut w) = duel();
        w.weapon[0] = 3;
        act(&mut a, &mut w, 0, ACT_SWORD, 1, 100, 100).ok();
        assert_eq!(w.hp[1], MAX_HP - 9);
        assert!(matches!(act(&mut a, &mut w, 0, ACT_SWORD, 1, 105, 100), Err(ActError::Cooldown)));
        // Hammer: knocks the target two tiles east on open ground...
        let (mut a, mut w) = duel();
        w.weapon[0] = 4;
        (w.x[0], w.y[0], w.x[1], w.y[1]) = (3, 6, 4, 6);
        act(&mut a, &mut w, 0, ACT_SWORD, 1, 100, 100).ok();
        assert_eq!((w.x[1], w.y[1], w.hp[1]), (6, 6, MAX_HP - 5));
        // ...but a wall stops the shove: (4,7) is stone.
        let (mut a, mut w) = duel();
        w.weapon[0] = 4;
        act(&mut a, &mut w, 0, ACT_SWORD, 1, 100, 100).ok();
        assert_eq!((w.x[1], w.y[1]), (3, 7));
        // Spear: reaches two tiles.
        let (mut a, mut w) = duel();
        w.weapon[0] = 5;
        (w.x[1], w.y[1]) = (3, 7);
        act(&mut a, &mut w, 0, ACT_SWORD, 1, 100, 100).ok();
        assert_eq!(w.hp[1], MAX_HP - 5);
    }

    #[test]
    fn chests_grant_weapons_and_powers() {
        let (mut a, mut w) = duel();
        w.chests[0] = [2, 8, CHEST_HAMMER, 0];
        w.chests[1] = [1, 9, POWER_CLOAK, 0];
        (w.x[1], w.y[1]) = (22, 16);
        act(&mut a, &mut w, 0, ACT_MOVE, 2, 1, 100).ok(); // (1,8)
        act(&mut a, &mut w, 0, ACT_MOVE, 1, 2, 100).ok(); // (2,8): hammer
        assert_eq!(w.weapon[0], 4);
        act(&mut a, &mut w, 0, ACT_MOVE, 3, 3, 100).ok(); // (1,8)
        act(&mut a, &mut w, 0, ACT_MOVE, 2, 4, 100).ok(); // (1,9): cloak
        assert_eq!(w.power[0], POWER_CLOAK);
    }

    #[test]
    fn powers_pearl_cloak_flare() {
        // Pearl: blink east from (2,8) over the stone at (4,8) to (5,8).
        let (mut a, mut w) = duel();
        (w.x[0], w.y[0], w.x[1], w.y[1]) = (2, 8, 22, 16);
        w.power[0] = POWER_PEARL;
        assert!(act(&mut a, &mut w, 0, ACT_POWER, 1, 1, 100).is_ok());
        assert_eq!((w.x[0], w.y[0], w.power[0]), (5, 8, 0));
        assert!(matches!(act(&mut a, &mut w, 0, ACT_POWER, 1, 2, 100), Err(ActError::NoPower)));
        // Cloak: invisible and silent even when adjacent, until you attack.
        let (mut a, mut w) = duel();
        w.power[1] = POWER_CLOAK;
        act(&mut a, &mut w, 1, ACT_POWER, 0, 1, 100).ok();
        let mut v = vision();
        compute_vision(&a, &w, 0, &mut v, 101);
        assert_eq!((v.seen_count, v.heard), (0, 0));
        act(&mut a, &mut w, 1, ACT_SWORD, 3, 50, 101).ok();
        compute_vision(&a, &w, 0, &mut v, 101);
        assert_eq!(v.seen_count, 1);
        // Flare: see six tiles down an open row instead of four.
        let (mut a, mut w) = duel();
        (w.x[0], w.y[0], w.x[1], w.y[1]) = (11, 11, 17, 11);
        compute_vision(&a, &w, 0, &mut v, 100);
        assert_eq!(v.seen_count, 0);
        w.power[0] = POWER_FLARE;
        act(&mut a, &mut w, 0, ACT_POWER, 1, 1, 100).ok();
        compute_vision(&a, &w, 0, &mut v, 101);
        assert_eq!(v.seen_count, 1);
        assert_eq!(v.me[9], 7);
    }

    #[test]
    fn dead_players_see_nothing() {
        let (mut a, mut w) = (arena(2), world());
        spawn(&mut a, &mut w, &[9u8; 32], 0);
        a.alive = 0b10;
        let mut v = vision();
        compute_vision(&a, &w, 0, &mut v, 0);
        assert_eq!(v.me[6], 0);
        assert_eq!(v.seen_count, 0);
    }
}
