"use client";

import { useEffect, useRef } from "react";

// Brightness ramp: index 0 = empty, 9 = densest glyph.
const RAMP = " .:-=+*#%@";
// Ornament ramp: round glyphs so baubles read as balls, not foliage.
const BALL = " .:ooooo@@";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const BG = "#05070d";
const GROUND = -1.2;
const GROUND_R = 1.45;
const TIP = 1.06;
const TILT = 0.22; // camera looks slightly down at the tree
const CAM = 8; // camera distance, drives perspective strength
const LIGHT = normalize(-0.55, 0.55, 0.65);
// Half-vector between light and viewer (+z) for specular highlights.
const HALF = normalize(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
const BALL_R = 0.072;
const GREETING = "Шинэ жилийн мэнд 2027";

// Six stacked skirts; each bottom rim overhangs the tier below.
const TIERS = [
  { y0: -0.95, y1: -0.22, r: 1.0 },
  { y0: -0.62, y1: 0.1, r: 0.84 },
  { y0: -0.3, y1: 0.4, r: 0.68 },
  { y0: 0.0, y1: 0.66, r: 0.52 },
  { y0: 0.3, y1: 0.88, r: 0.37 },
  { y0: 0.58, y1: TIP, r: 0.23 },
];

// Five-pointed burst; row 3 / col 7 is the core. No bottom '|' so it never hits the tip.
const STAR = [
  "      .|.      ",
  "  '.   |   .'  ",
  "    '. | .'    ",
  "--===*@@@*===--",
  "     /'*'\\     ",
  "    /'   '\\    ",
  "   /       \\   ",
];
const STAR_CORE_ROW = 3;
const STAR_CORE_COL = 7;

// Background depth bands. Every tree point (z ≈ -2..2) beats them; the order lets far snow
// fill sky cells but not the sleigh, and ground snow cover the hills.
const SKY = -3e9; // sky stars, moon, hills, sparkle trail
const SLEIGH = -2e9;
const GROUND_SNOW = -1e9;

// Santa's sleigh flying right, pulled by three reindeer with Rudolph in front.
// Each key char picks the color of the glyph above it (see SLEIGH_COLORS).
const SLEIGH_ART = [
  String.raw`   *^.                          `,
  String.raw`  _(o)_         Y      Y      Y `,
  String.raw` \_###_/---~(__)o>~(__)o>~(__)o@`,
  String.raw`  '---'     /\/\   /\/\   /\/\  `,
];
const SLEIGH_KEY = [
  "   wrr                          ",
  "  RwswR         a      a      a ",
  " grRRRrgkkkbbbbbbbbbbbbbbbbbbbbn",
  "  ggggg     dddd   dddd   dddd  ",
];
const SLEIGH_COLORS: Record<string, string> = {
  r: "hsl(0 70% 42%)", // hat, sleigh
  R: "hsl(0 75% 52%)", // Santa's coat
  w: "hsl(0 0% 90%)", // fur trim, pompom
  s: "hsl(25 60% 72%)", // face
  g: "hsl(44 80% 52%)", // gold trim, runner
  k: "hsl(36 35% 42%)", // reins
  b: "hsl(26 45% 38%)", // reindeer
  a: "hsl(32 35% 58%)", // antlers
  d: "hsl(24 40% 28%)", // legs
  n: "hsl(0 100% 60%)", // Rudolph's nose (glows)
};
const MIRROR: Record<string, string> = {
  "/": "\\",
  "\\": "/",
  "(": ")",
  ")": "(",
  "<": ">",
  ">": "<",
};
const SLEIGH_W = SLEIGH_ART[0].length;
const SANTA_CROSS_MS = 10000;
const TRAIL_LIFE = 1100;

type Sprite = {
  ch: string;
  color: string;
  glow: 0 | 1;
  dr: number;
  dc: number;
  leg: boolean;
}[];

// Flatten the art into drawable cells; `flip` mirrors it so the sleigh can fly left.
// Gaps inside a row become empty cells, so the sleigh stays a clean silhouette over the moon.
function sleighSprite(flip: boolean): Sprite {
  const cells: Sprite = [];
  SLEIGH_ART.forEach((line, dr) => {
    const first = line.search(/\S/);
    const last = line.trimEnd().length - 1;
    for (let dc = 0; dc < SLEIGH_W; dc++) {
      const src = flip ? SLEIGH_W - 1 - dc : dc;
      const g = line[src];
      if (src < first || src > last) continue;
      const key = SLEIGH_KEY[dr][src];
      cells.push({
        ch: g === " " ? "" : flip ? (MIRROR[g] ?? g) : g,
        color: SLEIGH_COLORS[key] ?? "",
        glow: key === "n" ? 1 : 0,
        dr,
        dc,
        leg: key === "d",
      });
    }
  });
  return cells;
}
const SLEIGH_RIGHT = sleighSprite(false);
const SLEIGH_LEFT = sleighSprite(true);

// A few big near flakes use this sprite; centre cell is the anchor.
const BIG_FLAKE = [String.raw` \|/ `, "--*--", String.raw` /|\ `];

// Falling snow by depth: far/mid flakes only fill background cells, near ones fall in front of the tree.
// Layer 3 (big sprite flakes) is never picked at random; a fixed handful are created separately.
const SNOW_LAYERS = [
  {
    share: 0.45,
    v: 0.0012,
    dv: 0.001,
    sway: 0.0012,
    wind: 0.25,
    glyphs: "..·",
    color: "#2c354d",
  },
  {
    share: 0.37,
    v: 0.0028,
    dv: 0.0018,
    sway: 0.0025,
    wind: 0.55,
    glyphs: "··.",
    color: "#6f7da3",
  },
  {
    share: 0.18,
    v: 0.0055,
    dv: 0.0045,
    sway: 0.004,
    wind: 1,
    glyphs: "*+*",
    color: "#eef2ff",
  },
  {
    share: 0,
    v: 0.007,
    dv: 0.003,
    sway: 0.006,
    wind: 1.3,
    glyphs: "",
    color: "#aab6d6",
  },
];
const NEAR = 2;
const BIG = 3;

type Palette = string[];

// kind: 0 = shaded surface, 1 = blinking light, 2 = ornament ball, 3 = tinsel, 4 = ground snow
type Point = {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  pal: Palette;
  kind: 0 | 1 | 2 | 3 | 4;
  tex: number;
  phase: number;
};

type Flake = {
  x: number;
  y: number;
  v: number;
  p: number;
  g: string;
  layer: number;
};
type Cell = { i: number; ch: string; color: string; glow: 0 | 1 };
// kind: 0 = faint dot, 1 = small twinkler, 2 = bright star
type SkyStar = {
  i: number;
  kind: 0 | 1 | 2;
  pal: Palette;
  phase: number;
  speed: number;
};
type Spark = { x: number; y: number; born: number };

function normalize(x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l] as const;
}

// 10 colors from dark to light, one per ramp level.
function shades(h: number, s: number, l0: number, l1: number): Palette {
  return Array.from(
    { length: 10 },
    (_, i) => `hsl(${h} ${s}% ${l0 + ((l1 - l0) * i) / 9}%)`,
  );
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GREEN_A = shades(135, 60, 5, 50);
const GREEN_B = shades(150, 50, 4, 42);
const SNOWCAP = shades(205, 45, 30, 95);
const TRUNK = shades(25, 45, 8, 30);
const SNOW = shades(215, 30, 12, 88);
const TINSEL = shades(44, 95, 14, 72);
const STAR_PAL = shades(46, 100, 18, 80);
const TEXT_PAL = shades(42, 80, 22, 76);
const HIGHLIGHT = "#fffdf2";
const MOON_PAL = shades(50, 50, 12, 84);
const CRATER_PAL = shades(42, 12, 10, 58);
const SKY_STAR_PALS = [
  shades(220, 45, 8, 80),
  shades(45, 70, 8, 78),
  shades(190, 25, 8, 86),
];
const HILL = shades(218, 22, 5, 42);
const WINDOW = "hsl(42 95% 62%)";
// Moon craters as (u, v, radius) on the unit disc.
const CRATERS = [
  [-0.2, -0.35, 0.17],
  [0.4, 0.05, 0.15],
  [0.05, 0.45, 0.18],
  [0.42, -0.5, 0.1],
  [-0.45, 0.2, 0.12],
];
const MOON_LIGHT = normalize(0.45, 0.35, 0.82); // from the upper right, so the disc has some form
const ORNAMENTS = [
  shades(0, 85, 10, 60), // red
  shades(44, 95, 12, 62), // gold
  shades(212, 85, 12, 64), // blue
  shades(220, 12, 18, 88), // silver
  shades(282, 65, 12, 64), // purple
];
const LIGHTS = [
  shades(45, 100, 20, 85),
  shades(0, 100, 15, 68),
  shades(200, 100, 15, 72),
  shades(320, 100, 15, 75),
  shades(130, 90, 15, 68),
  shades(28, 100, 18, 70),
];
const GIFTS = [
  {
    a: 0.5,
    d: 1.22,
    w: 0.34,
    h: 0.3,
    dd: 0.3,
    box: shades(355, 75, 10, 52),
    rib: shades(45, 95, 15, 65),
  },
  {
    a: 1.75,
    d: 1.25,
    w: 0.28,
    h: 0.22,
    dd: 0.3,
    box: shades(210, 70, 10, 52),
    rib: shades(0, 0, 25, 92),
  },
  {
    a: 3.0,
    d: 1.2,
    w: 0.3,
    h: 0.34,
    dd: 0.28,
    box: shades(45, 85, 12, 55),
    rib: shades(355, 80, 15, 55),
  },
  {
    a: 4.2,
    d: 1.25,
    w: 0.36,
    h: 0.26,
    dd: 0.32,
    box: shades(285, 50, 12, 55),
    rib: shades(0, 0, 25, 92),
  },
  {
    a: 5.35,
    d: 1.22,
    w: 0.26,
    h: 0.24,
    dd: 0.26,
    box: shades(150, 55, 10, 45),
    rib: shades(355, 85, 18, 60),
  },
];

function treeRadius(y: number) {
  let r = 0;
  for (const T of TIERS) {
    if (y >= T.y0 && y <= T.y1)
      r = Math.max(r, T.r * (1 - (y - T.y0) / (T.y1 - T.y0)));
  }
  return r;
}

// Sample every surface as points in world space. `k` = grid cells per world unit,
// so density follows the screen size and leaves no holes.
function buildScene(k: number): Point[] {
  const pts: Point[] = [];
  const rand = mulberry32(2027);
  const d = k * 1.4;
  const TAU = Math.PI * 2;
  const add = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    pal: Palette,
    kind: Point["kind"] = 0,
    tex = 0.75 + rand() * 0.35,
  ) => {
    const [ux, uy, uz] = normalize(nx, ny, nz);
    pts.push({
      x,
      y,
      z,
      nx: ux,
      ny: uy,
      nz: uz,
      pal,
      kind,
      tex,
      phase: rand() * TAU,
    });
  };

  // Tree: stacked cones with drooping, wavy branch tips.
  TIERS.forEach((T, ti) => {
    const th = T.y1 - T.y0;
    const tips = Math.round(6 + 10 * T.r);
    const above = TIERS[ti + 1];
    const nh = Math.ceil(Math.hypot(th, T.r) * d);
    for (let i = 0; i <= nh; i++) {
      const t = i / nh;
      const e = 1 - t; // 1 at the rim, 0 at the tier's top
      const r0 = T.r * e;
      const na = Math.max(3, Math.ceil(TAU * r0 * 1.12 * d));
      for (let j = 0; j < na; j++) {
        const a = (j / na) * TAU + ti;
        const tip = 0.5 + 0.5 * Math.sin(a * tips + ti * 1.7);
        const r = r0 * (1 + 0.12 * tip * e);
        const y = T.y0 + th * t - (0.04 + 0.08 * tip) * e * e;
        // Dark band just under the next tier's drooping rim, bright tips on this rim,
        // so each layer reads as a separate skirt.
        let shade = e > 0.85 ? 1.15 : 1;
        if (above) {
          const gap = Math.max(0, above.y0 - 0.1 - y) / 0.22;
          if (gap < 1) shade = 0.12 + 0.88 * gap ** 1.5;
        }
        const snowy = e > 0.78 && tip > 0.75 && rand() < 0.45;
        const pal = snowy ? SNOWCAP : rand() < 0.5 ? GREEN_A : GREEN_B;
        add(
          r * Math.cos(a),
          y,
          r * Math.sin(a),
          Math.cos(a),
          T.r / th,
          Math.sin(a),
          pal,
          0,
          shade * (0.75 + rand() * 0.35),
        );
      }
    }
  });

  // Trunk.
  for (let y = GROUND; y < -0.9; y += 1 / d) {
    const na = Math.ceil(TAU * 0.1 * d);
    for (let j = 0; j < na; j++) {
      const a = (j / na) * TAU;
      add(
        0.1 * Math.cos(a),
        y,
        0.1 * Math.sin(a),
        Math.cos(a),
        0,
        Math.sin(a),
        TRUNK,
      );
    }
  }

  // Snowy ground: sparse dim specks, drawn only into empty cells.
  for (let rho = 0; rho < GROUND_R; rho += 1 / d) {
    const na = Math.max(1, Math.ceil(TAU * rho * d));
    for (let j = 0; j < na; j++) {
      if (rand() > 0.025) continue;
      const a = (j / na) * TAU;
      add(rho * Math.cos(a), GROUND, rho * Math.sin(a), 0, 1, 0, SNOW, 4);
    }
  }

  // Gift boxes with a ribbon cross and a bow.
  for (const g of GIFTS) {
    const bx = Math.cos(g.a) * g.d;
    const bz = Math.sin(g.a) * g.d;
    const hw = g.w / 2;
    const hd = g.dd / 2;
    const hh = g.h / 2;
    // [normal, face center, half-axis u, half-axis v]
    const faces: [number[], number[], number[], number[]][] = [
      [
        [0, 1, 0],
        [0, g.h, 0],
        [hw, 0, 0],
        [0, 0, hd],
      ],
      [
        [1, 0, 0],
        [hw, hh, 0],
        [0, 0, hd],
        [0, hh, 0],
      ],
      [
        [-1, 0, 0],
        [-hw, hh, 0],
        [0, 0, hd],
        [0, hh, 0],
      ],
      [
        [0, 0, 1],
        [0, hh, hd],
        [hw, 0, 0],
        [0, hh, 0],
      ],
      [
        [0, 0, -1],
        [0, hh, -hd],
        [hw, 0, 0],
        [0, hh, 0],
      ],
    ];
    for (const [n, c, u, v] of faces) {
      const nu = Math.ceil(Math.hypot(u[0], u[1], u[2]) * 2 * d);
      const nv = Math.ceil(Math.hypot(v[0], v[1], v[2]) * 2 * d);
      for (let iu = 0; iu <= nu; iu++) {
        for (let iv = 0; iv <= nv; iv++) {
          const su = (iu / nu) * 2 - 1;
          const sv = (iv / nv) * 2 - 1;
          const ribbon =
            Math.abs(su) < 0.18 || (n[1] === 1 && Math.abs(sv) < 0.18);
          add(
            bx + c[0] + su * u[0] + sv * v[0],
            GROUND + c[1] + su * u[1] + sv * v[1],
            bz + c[2] + su * u[2] + sv * v[2],
            n[0],
            n[1],
            n[2],
            ribbon ? g.rib : g.box,
            0,
            1.3, // no texture noise: flat, solid faces read as boxes
          );
        }
      }
    }
    // Bow: two small ribbon loops (tori) standing on the lid.
    const R = 0.045;
    const rt = 0.014;
    const nt = Math.ceil(TAU * R * d) + 4;
    for (const s of [-1, 1]) {
      const lx = bx + s * R;
      const ly = GROUND + g.h + R * 0.9;
      for (let j = 0; j < nt; j++) {
        const th = (j / nt) * TAU;
        for (let q = 0; q < 6; q++) {
          const ps = (q / 6) * TAU;
          const rr = R + rt * Math.cos(ps);
          add(
            lx + rr * Math.cos(th),
            ly + rr * Math.sin(th),
            bz + rt * Math.sin(ps),
            Math.cos(ps) * Math.cos(th),
            Math.cos(ps) * Math.sin(th),
            Math.sin(ps),
            g.rib,
          );
        }
      }
    }
  }

  // Ornament balls: small spheres, stratified by height (denser where the tree is wide)
  // and spaced by the golden angle so they never clump.
  const NB = 26;
  const rings = Math.ceil(Math.PI * BALL_R * d);
  for (let i = 0; i < NB; i++) {
    const s = (i + 0.5) / NB;
    const y = -0.85 + 1.8 * (1 - Math.sqrt(1 - s));
    const a = i * 2.39996 + rand() * 0.3;
    const r = treeRadius(y) + BALL_R * 0.5;
    const ox = r * Math.cos(a);
    const oz = r * Math.sin(a);
    const pal = ORNAMENTS[i % ORNAMENTS.length];
    for (let li = 0; li <= rings; li++) {
      const phi = (li / rings) * Math.PI;
      const ns = Math.max(1, Math.ceil(TAU * BALL_R * Math.sin(phi) * d));
      for (let j = 0; j < ns; j++) {
        const th = (j / ns) * TAU;
        const nx = Math.sin(phi) * Math.cos(th);
        const ny = Math.cos(phi);
        const nz = Math.sin(phi) * Math.sin(th);
        add(
          ox + BALL_R * nx,
          y + BALL_R * ny,
          oz + BALL_R * nz,
          nx,
          ny,
          nz,
          pal,
          2,
        );
      }
    }
  }

  // Gold tinsel: a continuous spiral with gentle swags between branches.
  const turns = 4.5;
  const span = turns * TAU;
  for (let a = 0; a < span; ) {
    const u = a / span;
    const y = -0.82 + u * 1.72 - 0.05 * Math.abs(Math.sin(a * 2.5));
    const r = treeRadius(y) * 1.04 + 0.03;
    add(
      r * Math.cos(a + 1),
      y,
      r * Math.sin(a + 1),
      Math.cos(a + 1),
      0.3,
      Math.sin(a + 1),
      TINSEL,
      3,
    );
    a += 1 / (Math.max(r, 0.05) * d);
  }

  // Blinking lights spiraling the other way round.
  const N = 150;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const y = -0.88 + u * 1.85;
    const a = -u * TAU * 7;
    const r = treeRadius(y) * 1.1;
    add(
      r * Math.cos(a),
      y,
      r * Math.sin(a),
      Math.cos(a),
      0,
      Math.sin(a),
      LIGHTS[i % LIGHTS.length],
      1,
    );
  }

  return pts;
}

function makeFlake(
  layer: number,
  cols: number,
  rows: number,
  anyRow: boolean,
): Flake {
  const L = SNOW_LAYERS[layer];
  return {
    x: Math.random() * cols,
    y: anyRow ? Math.random() * rows : -1,
    v: L.v + Math.random() * L.dv,
    p: Math.random() * Math.PI * 2,
    g: L.glyphs[Math.floor(Math.random() * L.glyphs.length)] ?? "",
    layer,
  };
}

function randomLayer() {
  let r = Math.random();
  for (let l = 0; l < NEAR; l++) {
    r -= SNOW_LAYERS[l].share;
    if (r < 0) return l;
  }
  return NEAR;
}

// Shaded moon disc (cell centre mc, mr; radius R rows) with darker craters.
function buildMoon(
  mc: number,
  mr: number,
  R: number,
  aspect: number,
  cols: number,
): Cell[] {
  const cells: Cell[] = [];
  // Half-cell padding so the top and bottom rows are not single-glyph nubs.
  const Rr = R + 0.5;
  const Rc = Rr * aspect;
  for (let r = mr - R; r <= mr + R; r++) {
    for (let c = Math.floor(mc - Rc); c <= Math.ceil(mc + Rc); c++) {
      const u = (c - mc) / Rc;
      const v = (r - mr) / Rr;
      const d2 = u * u + v * v;
      if (d2 > 1 || r < 0 || c < 0 || c >= cols) continue;
      const nz = Math.sqrt(1 - d2);
      // Ambient term keeps the whole disc visible; the light only adds soft shading.
      const lit =
        0.35 +
        0.65 *
          Math.max(
            0,
            u * MOON_LIGHT[0] - v * MOON_LIGHT[1] + nz * MOON_LIGHT[2],
          );
      const lvl = Math.max(3, Math.min(9, Math.round(lit * 9.4)));
      const crater = CRATERS.some(
        ([cu, cv, cr]) => (u - cu) ** 2 + (v - cv) ** 2 < cr * cr,
      );
      const i = r * cols + c;
      if (crater)
        cells.push({
          i,
          ch: lvl > 5 ? "o" : ":",
          color: CRATER_PAL[lvl - 1],
          glow: 0,
        });
      else cells.push({ i, ch: RAMP[lvl], color: MOON_PAL[lvl], glow: 0 });
    }
  }
  return cells;
}

// Two rolling snowy ridges behind the ground (far one higher and dimmer), a sparse snowfield
// below them, and two tiny cabins with lit windows on the far ridge.
function buildHills(base: number, cols: number, rows: number): Cell[] {
  const cells: Cell[] = [];
  const rand = mulberry32(7);
  const farH = Math.max(3, Math.round(rows * 0.12));
  const nearH = Math.max(2, Math.round(rows * 0.07));
  // Ridge height in fractional rows.
  const ridge = (c: number, near: boolean) => {
    const x = c / cols;
    return near
      ? base -
          nearH *
            (0.5 + 0.3 * Math.sin(x * 13 + 2.1) + 0.2 * Math.sin(x * 29 + 0.7))
      : base -
          2 -
          farH *
            (0.5 + 0.3 * Math.sin(x * 9 + 1.3) + 0.2 * Math.sin(x * 21 + 0.4));
  };
  const put = (
    r: number,
    c: number,
    ch: string,
    color: string,
    glow: 0 | 1 = 0,
  ) => {
    if (r >= 0 && r < rows && c >= 0 && c < cols)
      cells.push({ i: r * cols + c, ch, color, glow });
  };
  // Snow crest: '_' when the ridge crosses the lower half of the cell, '-' when the upper.
  const crest = (y: number) => (y - Math.floor(y) > 0.5 ? "_" : "-");
  for (let c = 0; c < cols; c++) {
    const far = ridge(c, false);
    const near = ridge(c, true);
    const farRow = Math.floor(far);
    const nearRow = Math.floor(near);
    // Each hill: a crest line, then a snowy texture that thins out further down.
    if (farRow < nearRow) put(farRow, c, crest(far), HILL[4]);
    for (let r = farRow + 1; r < nearRow; r++) {
      if (rand() < 0.1 + 0.4 * Math.exp(-(r - farRow - 1) / 1.5))
        put(r, c, rand() < 0.7 ? "." : ":", HILL[2]);
    }
    put(nearRow, c, crest(near), HILL[6]);
    for (let r = nearRow + 1; r < rows; r++) {
      if (rand() < 0.04 + 0.5 * Math.exp(-(r - nearRow - 1) / 2))
        put(r, c, rand() < 0.7 ? "." : ":", HILL[3]);
    }
  }
  for (const c of [Math.round(cols * 0.1), Math.round(cols * 0.88)]) {
    const r = Math.floor(ridge(c + 1, false));
    put(r - 1, c + 1, "/", HILL[6]);
    put(r - 1, c + 2, "\\", HILL[6]);
    put(r, c, "|", HILL[5]);
    put(r, c + 1, "'", WINDOW, 1);
    put(r, c + 2, "'", WINDOW, 1);
    put(r, c + 3, "|", HILL[5]);
  }
  return cells;
}

// Sparse fixed stars above the hills, kept clear of the moon and the back link.
function buildSkyStars(
  maxRow: number,
  cols: number,
  avoid: (r: number, c: number) => boolean,
): SkyStar[] {
  const stars: SkyStar[] = [];
  const rand = mulberry32(12);
  const n = Math.round((cols * maxRow) / 110);
  for (let k = 0; k < n * 3 && stars.length < n; k++) {
    const r = Math.floor(rand() * maxRow);
    const c = Math.floor(rand() * cols);
    if (avoid(r, c)) continue;
    const t = rand();
    stars.push({
      i: r * cols + c,
      kind: t < 0.55 ? 0 : t < 0.88 ? 1 : 2,
      pal: SKY_STAR_PALS[Math.floor(rand() * SKY_STAR_PALS.length)],
      phase: rand() * Math.PI * 2,
      speed: 0.0006 + rand() * 0.001,
    });
  }
  return stars;
}

export default function AsciiTree() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let w = 0,
      h = 0,
      fs = 12,
      cw = 0,
      chH = 0,
      cols = 0,
      rows = 0;
    let ox = 0,
      oy = 0,
      sx = 0,
      sy = 0,
      cx = 0,
      cy = 0;
    let starRow = 0,
      textRow = 0;
    let pts: Point[] = [];
    let snow: Flake[] = [];
    let depth = new Float32Array(0);
    let chars: string[] = [];
    let colors: string[] = [];
    let glow = new Uint8Array(0);
    let skyStatic: Cell[] = []; // moon + hills
    let skyStars: SkyStar[] = [];
    let halo: CanvasGradient | null = null;
    let haloX = 0,
      haloY = 0,
      haloR = 0;
    let santaMin = 0,
      santaMax = 0;
    // dir starts at -1 so the first pass (a few seconds after load) flies right.
    const santa = {
      active: false,
      dir: -1,
      x: 0,
      row: 0,
      start: 0,
      next: performance.now() + 3500,
    };
    const trail: Spark[] = Array.from({ length: 40 }, () => ({
      x: 0,
      y: 0,
      born: -Infinity,
    }));
    let trailHead = 0,
      lastSpark = 0;

    const setCell = (
      i: number,
      ch: string,
      color: string,
      g: number,
      d: number,
    ) => {
      chars[i] = ch;
      colors[i] = color;
      glow[i] = g;
      depth[i] = d;
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fs = Math.max(7, Math.min(13, Math.round(Math.min(w, h) / 80)));
      ctx.font = `${fs}px ${FONT}`;
      ctx.textBaseline = "top";
      cw = ctx.measureText("M").width;
      chH = Math.round(fs * 1.2);
      cols = Math.floor(w / cw);
      rows = Math.floor(h / chH);
      ox = (w - cols * cw) / 2;
      oy = (h - rows * chH) / 2;

      // Vertical extent (in units of sy) from the tree tip down to the front edge of the ground.
      const cT = Math.cos(TILT),
        sT = Math.sin(TILT);
      const above = TIP * cT * (CAM / (CAM - TIP * sT));
      const below =
        (-GROUND * cT + GROUND_R * sT) *
        (CAM / (CAM - (GROUND * sT + GROUND_R * cT)));
      // Leave rows for the star sprite above and a gap + greeting line below.
      const free = rows - STAR.length - 4;
      const aspect = chH / cw; // cells are taller than wide
      // Clamp: a 0-size canvas (e.g. while navigating away) makes `free` negative, and a
      // negative scale turns the sampling loops in buildScene into infinite loops.
      sy = Math.max(
        1,
        Math.min(free / (above + below), (cols * 0.94) / (3.2 * aspect)),
      );
      sx = sy * aspect;
      const top = (rows - (STAR.length + (above + below) * sy + 3)) / 2;
      cx = cols / 2;
      cy = top + STAR.length + above * sy;
      // Star's bottom row sits one row above the tip.
      starRow =
        Math.round(cy - above * sy) - 1 - (STAR.length - 1 - STAR_CORE_ROW);
      textRow = Math.min(rows - 2, Math.round(cy + below * sy) + 2);

      pts = buildScene(sx * 1.2);
      const n = cols * rows;
      depth = new Float32Array(n);
      chars = new Array(n);
      colors = new Array(n);
      glow = new Uint8Array(n);
      snow = Array.from({ length: Math.round(n / 40) }, () =>
        makeFlake(randomLayer(), cols, rows, true),
      );
      const bigCount = Math.max(3, Math.min(5, Math.round(cols / 40)));
      for (let k = 0; k < bigCount; k++)
        snow.push(makeFlake(BIG, cols, rows, true));

      // Night sky. Moon sits upper right, clear of the star and the back link (top left).
      const linkRows = Math.ceil(40 / chH);
      const R = Math.max(
        3,
        Math.min(7, Math.round(Math.min(rows, cols / aspect) * 0.1)),
      );
      const mc = Math.round(cols * 0.8);
      const mr = Math.max(linkRows + R, Math.round(rows * 0.17));
      // Hills rise from the row where the ground disc's back edge projects.
      const groundBack = Math.round(
        cy -
          (GROUND * cT + GROUND_R * sT) *
            sy *
            (CAM / (CAM - GROUND * sT + GROUND_R * cT)),
      );
      const hills = buildHills(groundBack, cols, rows);
      const hillTop = hills.reduce(
        (m, cell) => Math.min(m, Math.floor(cell.i / cols)),
        rows,
      );
      skyStatic = [...hills, ...buildMoon(mc, mr, R, aspect, cols)];
      skyStars = buildSkyStars(
        hillTop - 1,
        cols,
        (r, c) =>
          ((c - mc) / (R * aspect)) ** 2 + ((r - mr) / R) ** 2 < 2.2 ||
          (r < linkRows && c * cw < 130),
      );
      haloX = ox + (mc + 0.5) * cw;
      haloY = oy + (mr + 0.5) * chH;
      haloR = R * chH * 3;
      halo = ctx.createRadialGradient(haloX, haloY, 0, haloX, haloY, haloR);
      halo.addColorStop(0, "rgba(255, 244, 214, 0.16)");
      halo.addColorStop(0.35, "rgba(255, 244, 214, 0.06)");
      halo.addColorStop(1, "rgba(255, 244, 214, 0)");
      santaMin = linkRows + 1;
      santaMax = Math.max(santaMin + 1, Math.round(rows * 0.22));
    };

    // Santa's sleigh: crosses every 15–30 s with a gentle arc and bob, leaving a fading sparkle trail.
    const paintSanta = (now: number, dt: number) => {
      if (!santa.active) {
        if (now < santa.next) return;
        santa.active = true;
        santa.dir = -santa.dir;
        santa.x = santa.dir > 0 ? -SLEIGH_W : cols;
        santa.row = santaMin + Math.random() * (santaMax - santaMin);
        santa.start = now;
      }
      santa.x += santa.dir * ((cols + SLEIGH_W) / SANTA_CROSS_MS) * dt;
      const progress =
        (santa.dir > 0 ? santa.x + SLEIGH_W : cols - santa.x) /
        (cols + SLEIGH_W);
      if (progress >= 1) {
        santa.active = false;
        santa.next = now + 15000 + Math.random() * 15000;
      }
      const top = Math.round(
        santa.row -
          2 * Math.sin(Math.PI * progress) +
          0.6 * Math.sin((now - santa.start) * 0.005),
      );
      const left = Math.round(santa.x);

      if (santa.active && now - lastSpark > 70) {
        lastSpark = now;
        const s = trail[trailHead];
        trailHead = (trailHead + 1) % trail.length;
        s.x = left + (santa.dir > 0 ? 0 : SLEIGH_W - 1);
        s.y = top + 1 + Math.random() * 2;
        s.born = now;
      }
      for (const s of trail) {
        const age = (now - s.born) / TRAIL_LIFE;
        if (age >= 1) continue;
        const r = Math.round(s.y + age * 1.5); // sparks sink slowly as they fade
        const c = Math.round(s.x);
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        setCell(
          r * cols + c,
          "*+·."[Math.floor(age * 4)],
          STAR_PAL[8 - Math.round(age * 5)],
          0,
          SKY,
        );
      }

      if (!santa.active) return;
      const gallop = Math.floor(now / 150) % 2 === 1;
      for (const p of santa.dir > 0 ? SLEIGH_RIGHT : SLEIGH_LEFT) {
        const r = top + p.dr;
        const c = left + p.dc;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        setCell(
          r * cols + c,
          gallop && p.leg ? (MIRROR[p.ch] ?? p.ch) : p.ch,
          p.color,
          p.glow,
          SLEIGH,
        );
      }
    };

    // Everything behind the tree is painted first, so any tree point simply overwrites it.
    const paintSky = (now: number, dt: number) => {
      for (const s of skyStars) {
        const b = 0.5 + 0.5 * Math.sin(now * s.speed + s.phase);
        if (s.kind === 0)
          setCell(s.i, ".", s.pal[2 + Math.round(b * 4)], 0, SKY);
        else if (s.kind === 1)
          setCell(
            s.i,
            b > 0.7 ? "+" : "·",
            s.pal[3 + Math.round(b * 5)],
            0,
            SKY,
          );
        else
          setCell(
            s.i,
            b > 0.8 ? "*" : b > 0.35 ? "+" : "·",
            s.pal[4 + Math.round(b * 5)],
            b > 0.93 ? 1 : 0,
            SKY,
          );
      }
      for (const cell of skyStatic)
        setCell(cell.i, cell.ch, cell.color, cell.glow, SKY);
      paintSanta(now, dt);
    };

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      depth.fill(-Infinity);
      chars.fill("");
      glow.fill(0);
      paintSky(now, dt);

      const yaw = now * 0.0005;
      const cY = Math.cos(yaw),
        sY = Math.sin(yaw);
      const cT = Math.cos(TILT),
        sT = Math.sin(TILT);

      // Project points with a z-buffer: nearest point wins each cell.
      for (const p of pts) {
        const x1 = p.x * cY - p.z * sY;
        const z1 = p.x * sY + p.z * cY;
        const y2 = p.y * cT - z1 * sT;
        const z2 = p.y * sT + z1 * cT;
        const k = CAM / (CAM - z2);
        const c = Math.round(cx + x1 * sx * k);
        const r = Math.round(cy - y2 * sy * k);
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const i = r * cols + c;

        // Ground snow is background texture: it only fills cells nothing else claims.
        if (p.kind === 4) {
          if (depth[i] > SKY) continue;
          depth[i] = GROUND_SNOW;
          glow[i] = 0;
          const spark = Math.sin(now * 0.0011 + p.phase * 5) > 0.992;
          const g = Math.min(2, Math.floor(((p.tex - 0.75) / 0.35) * 3));
          chars[i] = spark ? "+" : ".,:"[g];
          colors[i] = p.pal[spark ? 9 : 2 + g];
          continue;
        }

        if (z2 <= depth[i]) continue;
        depth[i] = z2;
        glow[i] = 0;

        if (p.kind === 1) {
          const on = Math.sin(now * 0.003 + p.phase) > -0.2;
          chars[i] = on ? "*" : ".";
          colors[i] = p.pal[on ? 9 : 3];
          glow[i] = on ? 1 : 0;
          continue;
        }

        const nx = p.nx * cY - p.nz * sY;
        const nz1 = p.nx * sY + p.nz * cY;
        const ny = p.ny * cT - nz1 * sT;
        const nz = p.ny * sT + nz1 * cT;
        const lit = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);

        if (p.kind === 2) {
          // Specular hot spot makes each bauble look glossy.
          if (nx * HALF[0] + ny * HALF[1] + nz * HALF[2] > 0.88) {
            chars[i] = "@";
            colors[i] = HIGHLIGHT;
            glow[i] = 1;
            continue;
          }
          const lvl = Math.max(
            2,
            Math.min(9, Math.round((0.15 + 0.85 * lit) * 9)),
          );
          chars[i] = BALL[lvl];
          colors[i] = p.pal[lvl];
          continue;
        }

        const lvl = Math.max(
          1,
          Math.min(9, Math.round((0.12 + 0.88 * lit) * p.tex * 9)),
        );
        if (p.kind === 3) {
          const sparkle = Math.sin(now * 0.002 + p.phase) > 0.97;
          chars[i] = sparkle ? "*" : "~";
          colors[i] = p.pal[sparkle ? 9 : Math.max(3, lvl)];
          glow[i] = sparkle ? 1 : 0;
          continue;
        }
        chars[i] = RAMP[lvl];
        colors[i] = p.pal[lvl];
      }

      // Star on top: screen-space sprite, always in front. A brightness wave runs out along the rays.
      const sc = Math.round(cx);
      STAR.forEach((line, dr) => {
        for (let dc = 0; dc < line.length; dc++) {
          const g = line[dc];
          if (g === " ") continue;
          const c = sc + dc - STAR_CORE_COL;
          const r = starRow + dr - STAR_CORE_ROW;
          if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
          const i = r * cols + c;
          const dist = Math.hypot((dc - STAR_CORE_COL) / 2, dr - STAR_CORE_ROW);
          const lvl =
            g === "@" || g === "*"
              ? 9
              : 3 + Math.round(3 + 3 * Math.sin(now * 0.004 - dist * 1.4));
          depth[i] = Infinity;
          chars[i] = g;
          colors[i] = g === "@" ? HIGHLIGHT : STAR_PAL[lvl];
          glow[i] = lvl >= 8 ? 1 : 0;
        }
      });

      // Greeting line with a slow shimmer travelling left to right.
      const tc = Math.round(cx - GREETING.length / 2);
      for (let j = 0; j < GREETING.length; j++) {
        const c = tc + j;
        if (c < 0 || c >= cols || textRow < 0) continue;
        const i = textRow * cols + c;
        depth[i] = Infinity; // keeps snow and sky out of the gaps too
        if (GREETING[j] === " ") {
          chars[i] = "";
          continue;
        }
        const lvl =
          6 + Math.round(1.5 + 1.5 * Math.sin(now * 0.0025 - j * 0.45));
        chars[i] = GREETING[j];
        colors[i] = TEXT_PAL[lvl];
        glow[i] = lvl === 9 ? 1 : 0;
      }

      // Snow: far/mid flakes only fill background cells; near and big flakes fall in front of
      // the tree (never over star/text). Wind gusts swell slowly both ways, stronger up close.
      const wind = Math.sin(now * 0.00025) ** 3 * 0.006;
      for (const f of snow) {
        const L = SNOW_LAYERS[f.layer];
        f.y += f.v * dt;
        f.x += (Math.sin(now * 0.0012 + f.p) * L.sway + wind * L.wind) * dt;
        if (f.y >= rows + 1)
          Object.assign(f, makeFlake(f.layer, cols, rows, false));
        const c = ((Math.floor(f.x) % cols) + cols) % cols;
        const r = Math.floor(f.y);
        if (f.layer === BIG) {
          for (let dr = 0; dr < BIG_FLAKE.length; dr++) {
            for (let dc = 0; dc < BIG_FLAKE[dr].length; dc++) {
              const g = BIG_FLAKE[dr][dc];
              const rr = r + dr - 1;
              const cc = c + dc - 2;
              if (g === " " || rr < 0 || rr >= rows || cc < 0 || cc >= cols)
                continue;
              const i = rr * cols + cc;
              if (depth[i] === Infinity) continue;
              const core = g === "*";
              chars[i] = g;
              colors[i] = core ? HIGHLIGHT : L.color;
              glow[i] = core ? 1 : 0;
            }
          }
          continue;
        }
        if (r < 0 || r >= rows) continue;
        const i = r * cols + c;
        if (f.layer >= NEAR ? depth[i] === Infinity : depth[i] > SKY) continue;
        chars[i] = f.g;
        colors[i] = L.color;
        glow[i] = 0;
      }

      ctx.shadowBlur = 0;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);
      if (halo) {
        ctx.fillStyle = halo;
        ctx.fillRect(haloX - haloR, haloY - haloR, haloR * 2, haloR * 2);
      }
      const glowing: number[] = [];
      let cur = "";
      for (let i = 0; i < chars.length; i++) {
        if (!chars[i]) continue;
        if (glow[i]) {
          glowing.push(i);
          continue;
        }
        if (colors[i] !== cur) ctx.fillStyle = cur = colors[i];
        ctx.fillText(
          chars[i],
          ox + (i % cols) * cw,
          oy + Math.floor(i / cols) * chH,
        );
      }
      ctx.shadowBlur = fs;
      for (const i of glowing) {
        ctx.shadowColor = ctx.fillStyle = colors[i];
        ctx.fillText(
          chars[i],
          ox + (i % cols) * cw,
          oy + Math.floor(i / cols) * chH,
        );
      }

      raf = requestAnimationFrame(frame);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 h-full w-full"
      aria-label="ASCII шинэ жилийн мод"
      role="img"
    />
  );
}
