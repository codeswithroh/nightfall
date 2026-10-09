import * as THREE from "three";

/** Tiny deterministic RNG so every client paints identical blocks. */
export const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

type Paint = (ctx: CanvasRenderingContext2D, r: () => number, size: number) => void;

const shade = (hex: string, amt: number) => {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
};

export const px = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

const noise = (ctx: CanvasRenderingContext2D, r: () => number, size: number, base: string, spread = 0.08) => {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) px(ctx, x, y, shade(base, (r() - 0.5) * spread * 2));
};

const cache = new Map<string, THREE.CanvasTexture>();

export const makeTexture = (key: string, paint: Paint, size = 16, seed = 1) => {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  paint(ctx, rng(seed), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  cache.set(key, tex);
  return tex;
};

export const TEX = {
  grassTop: () => makeTexture("grassTop", (c, r, s) => noise(c, r, s, "#5d9e3a", 0.07), 16, 11),
  grassSide: () =>
    makeTexture(
      "grassSide",
      (c, r, s) => {
        noise(c, r, s, "#86603e", 0.07);
        for (let x = 0; x < s; x++) {
          const depth = 3 + Math.floor(r() * 3);
          for (let y = 0; y < depth; y++) px(c, x, y, shade("#5d9e3a", (r() - 0.5) * 0.12));
        }
      },
      16,
      12,
    ),
  dirt: () => makeTexture("dirt", (c, r, s) => noise(c, r, s, "#86603e", 0.08), 16, 13),
  cobble: () =>
    makeTexture(
      "cobble",
      (c, r, s) => {
        noise(c, r, s, "#7d7d7d", 0.05);
        // Irregular stones with dark mortar.
        for (let i = 0; i < 9; i++) {
          const x = Math.floor(r() * s);
          const y = Math.floor(r() * s);
          const w = 3 + Math.floor(r() * 4);
          const h = 2 + Math.floor(r() * 3);
          px(c, x, y, shade("#8f8f8f", (r() - 0.5) * 0.15), w, h);
          px(c, x, y + h, "#4f4f4f", w, 1);
          px(c, x + w, y, "#4f4f4f", 1, h + 1);
        }
      },
      16,
      14,
    ),
  logSide: () =>
    makeTexture(
      "logSide",
      (c, r, s) => {
        for (let x = 0; x < s; x++) {
          const col = x % 4 === 0 ? "#4a3520" : "#6b4d2c";
          for (let y = 0; y < s; y++) px(c, x, y, shade(col, (r() - 0.5) * 0.1));
        }
      },
      16,
      15,
    ),
  logTop: () =>
    makeTexture(
      "logTop",
      (c, r, s) => {
        noise(c, r, s, "#a07d4f", 0.05);
        c.strokeStyle = "#7a5a34";
        for (let k = 2; k < 8; k += 2) c.strokeRect(8 - k, 8 - k, k * 2, k * 2);
        c.strokeStyle = "#6b4d2c";
        c.strokeRect(0.5, 0.5, s - 1, s - 1);
      },
      16,
      16,
    ),
  leaves: () =>
    makeTexture(
      "leaves",
      (c, r, s) => {
        for (let y = 0; y < s; y++)
          for (let x = 0; x < s; x++) {
            const v = r();
            px(c, x, y, v < 0.12 ? "rgba(0,0,0,0)" : shade("#3f7d2a", (v - 0.5) * 0.25));
          }
      },
      16,
      17,
    ),
  tallGrass: () =>
    makeTexture(
      "tallGrass",
      (c, r, s) => {
        c.clearRect(0, 0, s, s);
        for (let b = 0; b < 9; b++) {
          let x = 1 + Math.floor(r() * (s - 2));
          const h = 6 + Math.floor(r() * 9);
          const col = shade("#6aa840", (r() - 0.5) * 0.2);
          for (let y = s - 1; y > s - h; y--) {
            px(c, x, y, col);
            if (r() < 0.2) x += r() < 0.5 ? -1 : 1;
            x = Math.max(0, Math.min(s - 1, x));
          }
        }
      },
      16,
      18,
    ),
  water: () =>
    makeTexture(
      "water",
      (c, r, s) => {
        noise(c, r, s, "#2f5fbf", 0.06);
        for (let i = 0; i < 6; i++) px(c, Math.floor(r() * s), Math.floor(r() * s), "#5c86d6", 3, 1);
      },
      16,
      19,
    ),
  chestFront: () =>
    makeTexture(
      "chestFront",
      (c, r, s) => {
        noise(c, r, s, "#a3702f", 0.06);
        px(c, 0, 0, "#5a3a16", s, 1);
        px(c, 0, s - 1, "#5a3a16", s, 1);
        px(c, 0, 0, "#5a3a16", 1, s);
        px(c, s - 1, 0, "#5a3a16", 1, s);
        px(c, 0, 6, "#5a3a16", s, 1);
        px(c, 7, 5, "#c9c9c9", 2, 4);
        px(c, 7, 7, "#2a2a2a", 2, 1);
      },
      16,
      20,
    ),
  chestSide: () =>
    makeTexture(
      "chestSide",
      (c, r, s) => {
        noise(c, r, s, "#a3702f", 0.06);
        px(c, 0, 0, "#5a3a16", s, 1);
        px(c, 0, s - 1, "#5a3a16", s, 1);
        px(c, 0, 0, "#5a3a16", 1, s);
        px(c, s - 1, 0, "#5a3a16", 1, s);
        px(c, 0, 6, "#5a3a16", s, 1);
      },
      16,
      21,
    ),
  border: () =>
    makeTexture(
      "border",
      (c, r, s) => {
        c.clearRect(0, 0, s, s);
        for (let i = 0; i < s; i++) {
          px(c, i, (i * 2) % s, "rgba(140,200,255,0.9)");
          px(c, i, (i * 2 + 1) % s, "rgba(90,150,255,0.6)");
        }
      },
      16,
      22,
    ),
};

/** Pixel-art item icons for the HUD, returned as data URLs. */
const iconCache = new Map<string, string>();
const icon = (key: string, paint: (ctx: CanvasRenderingContext2D) => void) => {
  const hit = iconCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  paint(ctx);
  const url = canvas.toDataURL();
  iconCache.set(key, url);
  return url;
};

const sword = (ctx: CanvasRenderingContext2D, blade: string, edge: string) => {
  for (let i = 0; i < 9; i++) {
    px(ctx, 5 + i, 10 - i, blade);
    px(ctx, 6 + i, 10 - i, edge);
    px(ctx, 5 + i, 9 - i, edge);
  }
  px(ctx, 3, 10, "#3b2a14", 4, 1);
  px(ctx, 5, 8, "#3b2a14", 1, 5);
  for (let i = 0; i < 3; i++) px(ctx, 2 + i, 13 - i, "#6b4d2c");
  px(ctx, 1, 14, "#3b2a14");
};

export const ICONS = {
  woodSword: () => icon("woodSword", (c) => sword(c, "#9c7a48", "#c9a46a")),
  diamondSword: () => icon("diamondSword", (c) => sword(c, "#2fc6c0", "#9ef5f0")),
  bow: () =>
    icon("bow", (c) => {
      for (let i = 0; i < 10; i++) px(c, 3 + i, 12 - i, "#d9d9d9");
      const arc = [
        [3, 13],
        [3, 11],
        [4, 9],
        [5, 7],
        [7, 5],
        [9, 4],
        [11, 3],
        [13, 3],
        [4, 12],
        [12, 4],
      ];
      arc.forEach(([x, y]) => px(c, x, y, "#7a5a34"));
      px(c, 2, 14, "#5a3a16");
      px(c, 14, 2, "#5a3a16");
    }),
  arrow: () =>
    icon("arrow", (c) => {
      for (let i = 0; i < 10; i++) px(c, 3 + i, 12 - i, "#8a6a3a");
      px(c, 12, 2, "#cfcfcf", 2, 2);
      px(c, 11, 3, "#cfcfcf");
      px(c, 2, 12, "#eeeeee", 2, 1);
      px(c, 3, 13, "#eeeeee", 1, 2);
    }),
  apple: () =>
    icon("apple", (c) => {
      c.fillStyle = "#f2c230";
      c.beginPath();
      c.arc(8, 9, 5, 0, Math.PI * 2);
      c.fill();
      px(c, 6, 6, "#fff3a0", 2, 2);
      px(c, 8, 2, "#5a3a16", 1, 3);
      px(c, 9, 2, "#3f7d2a", 3, 2);
    }),
  heart: (fill: "full" | "half" | "empty") =>
    icon(`heart-${fill}`, (c) => {
      const shape = [
        "  XX   XX  ",
        " XRRX XRRX ",
        "XRWRRXRRRRX",
        "XRRRRRRRRRX",
        " XRRRRRRRX ",
        "  XRRRRRX  ",
        "   XRRRX   ",
        "    XRX    ",
        "     X     ",
      ];
      shape.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === " ") return;
          const right = x > 5;
          let col = ch === "X" ? "#1a0a0a" : ch === "W" ? "#ffd0d0" : "#d42020";
          if (ch !== "X" && (fill === "empty" || (fill === "half" && right))) col = "#3a1a1a";
          px(c, x + 2, y + 3, col);
        }),
      );
    }),
};
