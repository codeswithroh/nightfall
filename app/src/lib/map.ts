import mapJson from "./map.json";

export const MAP_W = 24;
export const MAP_H = 24;

export interface MapInfo {
  name: string;
  rows: string[];
  spawns: [number, number][];
  chests: [number, number][];
}
export const MAPS: MapInfo[] = mapJson.maps as MapInfo[];

/** The map currently being played or shown. Everything below reads it. */
export let mapId = 0;
export let ROWS: string[] = MAPS[0].rows;
export let SPAWNS: [number, number][] = MAPS[0].spawns;
export let CHEST_SPOTS: [number, number][] = MAPS[0].chests;

export const setMap = (id: number) => {
  mapId = ((id % MAPS.length) + MAPS.length) % MAPS.length;
  ROWS = MAPS[mapId].rows;
  SPAWNS = MAPS[mapId].spawns;
  CHEST_SPOTS = MAPS[mapId].chests;
};

/** 0 grass, 1 solid, 2 tall grass, 3 water — same encoding as map.rs */
export const tileAt = (x: number, y: number): number => {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return 1;
  const c = ROWS[y][x];
  return c === "T" || c === "#" ? 1 : c === '"' ? 2 : c === "~" ? 3 : 0;
};
export const charAt = (x: number, y: number) => ROWS[y]?.[x] ?? "T";
export const walkable = (x: number, y: number) => {
  const t = tileAt(x, y);
  return t === 0 || t === 2;
};

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

/** Same Bresenham as the program, used client-side to shade the fog (never to reveal anyone). */
export const lineOfSight = (x0: number, y0: number, x1: number, y1: number) => {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let x = x0;
  let y = y0;
  let err = dx + dy;
  for (;;) {
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if ((x !== x1 || y !== y1) && (tileAt(x, y) === 1 || tileAt(x, y) === 2)) return false;
  }
};

export const inZone = (zone: number, x: number, y: number) =>
  Math.abs(2 * x - (MAP_W - 1)) < 2 * zone && Math.abs(2 * y - (MAP_H - 1)) < 2 * zone;

/** Breadth-first path; returns the first direction to step, or -1. */
export const firstStepToward = (
  fx: number,
  fy: number,
  goal: (x: number, y: number) => boolean,
  blocked: (x: number, y: number) => boolean = () => false,
): number => {
  const seen = new Int16Array(MAP_W * MAP_H).fill(-1);
  const queue: number[] = [];
  for (let d = 0; d < 4; d++) {
    const nx = fx + DX[d];
    const ny = fy + DY[d];
    if (!walkable(nx, ny) || blocked(nx, ny)) continue;
    const k = ny * MAP_W + nx;
    if (seen[k] !== -1) continue;
    seen[k] = d;
    queue.push(k);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    const x = k % MAP_W;
    const y = (k / MAP_W) | 0;
    if (goal(x, y)) return seen[k];
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (!walkable(nx, ny) || blocked(nx, ny)) continue;
      const nk = ny * MAP_W + nx;
      if (seen[nk] !== -1) continue;
      seen[nk] = seen[k];
      queue.push(nk);
    }
  }
  return -1;
};
