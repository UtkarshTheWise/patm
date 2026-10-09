// Bakes the raster art the CSS leans on: the 9-slice UI frames and the layered backdrop.
//   node tools/gen-art.js      -> writes public/art/*.png
// Everything is drawn at a tiny resolution and scaled up by the browser with
// `image-rendering: pixelated`, which is what gives it the 8-bit look.
const fs = require("fs");
const path = require("path");
const { Canvas } = require("./png");
const S = require("../public/sprites.js");
const P = S._px;

const OUT = path.join(__dirname, "..", "public", "art");
fs.mkdirSync(OUT, { recursive: true });

// seeded RNG so the art is the same on every run
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = Canvas.hex;
const lerp = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map((r) => r.map((v) => (v + 0.5) / 16));
const bayer = (x, y) => BAYER[y & 3][x & 3];

// ---------- palette ----------
const C = {
  ink: "#140d2c", plum0: "#1a1240", plum1: "#2a1f5c", plum2: "#3a2c78", plum3: "#54429f",
  gold0: "#fff0a8", gold1: "#f4bb4c", gold2: "#b9732a",
};

// ---------- 9-slice frames ----------
// A rounded, gold-trimmed frame with a rivet in each corner. d = how many pixels in from the edge.
function frame(N, R, o) {
  const c = new Canvas(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = Math.min(x, N - 1 - x), dy = Math.min(y, N - 1 - y);
    let t;
    if (dx < R && dy < R) t = R - Math.hypot(R - dx - 0.5, R - dy - 0.5);
    else t = Math.min(dx, dy) + 0.5;
    if (t < 0) continue;
    const d = Math.floor(t);
    const lit = x + y < N - 1;
    let col = null;
    if (d === 0) col = o.ink;
    else if (d === 1) col = lit ? o.hi : o.sh;
    else if (d === 2) col = o.gold;
    else if (d === 3) col = o.ink2;
    else if (d === 4 && o.bevel) col = lit ? o.bevelHi : o.bevelLo;
    else col = o.fill; // may be null: leaves the middle for CSS to colour
    if (col) c.set(x, y, col);
  }
  if (o.studs) {
    const s = o.studs;
    for (const [sx, sy] of [[s, s], [N - 1 - s, s], [s, N - 1 - s], [N - 1 - s, N - 1 - s]]) {
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) c.set(sx + i, sy + j, i === 0 && j === 0 ? o.hi : i + j > 0 ? o.sh : o.gold);
    }
  }
  return c;
}

const panel = (extra) => frame(20, 5, {
  ink: C.ink, hi: C.gold0, gold: C.gold1, sh: C.gold2, ink2: C.ink, bevel: true,
  bevelHi: C.plum3, bevelLo: C.plum0, fill: hex(C.plum1).slice(0, 3).concat(238), studs: 3, ...extra,
});
panel().save(path.join(OUT, "panel.png"));

// a quieter, smaller frame for status plates and chips
frame(14, 4, { ink: C.ink, hi: C.gold0, gold: C.gold1, sh: C.gold2, ink2: C.ink, bevel: false,
  fill: hex(C.plum1).slice(0, 3).concat(236), studs: 0 })
  .save(path.join(OUT, "plate.png"));

// buttons: hollow centre, so each move can pour its own colour in with CSS
const btn = (down, gold) => frame(14, 3, {
  ink: C.ink, ink2: C.ink, bevel: false,
  hi: down ? C.gold2 : gold ? "#fff6c4" : C.gold0, gold: down ? "#c98a36" : gold ? "#ffd35a" : C.gold1, sh: down ? C.ink : C.gold2,
  fill: null, studs: 0,
});
btn(false).save(path.join(OUT, "btn.png"));
btn(true).save(path.join(OUT, "btn-down.png"));
btn(false, true).save(path.join(OUT, "btn-gold.png"));

// the dock only needs its top edge: a gold rail with a rivet every 16px, tiled sideways
{
  const c = new Canvas(16, 14);
  const rows = [C.ink, C.gold0, C.gold1, C.gold2, C.ink, C.plum3, C.plum1];
  rows.forEach((col, y) => c.rect(0, y, 16, 1, col));
  c.rect(0, 7, 16, 7, C.plum1);
  for (const [x, y, col] of [[7, 1, C.gold0], [8, 1, C.gold0], [7, 2, C.gold1], [8, 2, C.gold1], [7, 3, C.gold2], [8, 3, C.gold2], [6, 2, C.ink], [9, 2, C.ink]]) c.set(x, y, col);
  c.save(path.join(OUT, "dock.png"));
}

// 4x4 texture the panels and buttons lay under their content
{
  const t = new Canvas(4, 4);
  t.rect(0, 0, 4, 4, C.plum1);
  for (const [x, y] of [[0, 0], [2, 2]]) t.set(x, y, "#2f2466");
  t.save(path.join(OUT, "tex-panel.png"));
  const s = new Canvas(4, 4);
  s.rect(0, 0, 4, 4, [255, 255, 255, 0]);
  for (const [x, y] of [[0, 0], [2, 2]]) s.set(x, y, [255, 255, 255, 34]);
  s.save(path.join(OUT, "tex-dots.png"));
}

// ---------- the world ----------
// Dusk underwater: warm light at the surface sinking into violet, with a sand floor.
const WATER = [
  [0.0, "#ffd7c6"], [0.1, "#a8ece0"], [0.3, "#58c0d8"], [0.52, "#4283cc"], [0.74, "#34419c"], [1.0, "#221a5a"],
].map(([p, c]) => [p, hex(c)]);

function waterAt(t) {
  for (let i = 0; i < WATER.length - 1; i++) {
    const [p0, c0] = WATER[i], [p1, c1] = WATER[i + 1];
    if (t <= p1) return lerp(c0, c1, (t - p0) / (p1 - p0));
  }
  return WATER[WATER.length - 1][1];
}
// Quantise to a short ramp and dither only between neighbouring steps: bands, not noise.
const LEVELS = 20;
function waterDither(t, x, y) {
  const v = t * (LEVELS - 1), lo = Math.floor(v), frac = v - lo;
  const step = (n) => waterAt(Math.min(1, n / (LEVELS - 1)));
  return bayer(x, y) < frac ? step(lo + 1) : step(lo);
}

{ // sky/water: dithered vertical gradient + diagonal light shafts
  const W = 96, H = 176;
  const c = new Canvas(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    c.set(x, y, waterDither(y / (H - 1), x, y));
  }
  // shafts of light: slanted bands that fade with depth, dithered so they stay pixel-crisp
  const shafts = [[14, 9, 0.22], [42, 6, 0.16], [66, 11, 0.2], [88, 5, 0.12]];
  for (let y = 0; y < H * 0.78; y++) for (let x = 0; x < W; x++) {
    let lift = 0;
    for (const [x0, w, str] of shafts) {
      const cx = x0 + y * 0.42;
      const dist = Math.abs(x - cx) / w;
      if (dist < 1) lift = Math.max(lift, (1 - dist) * str * (1 - y / (H * 0.78)));
    }
    if (lift > 0 && bayer(x + 1, y) < lift) {
      const o = c.get(x, y);
      c.set(x, y, lerp(o.slice(0, 3), [255, 244, 224], 0.22));
    }
  }
  // ripples on the surface
  const r = rng(7);
  for (let x = 0; x < W; x++) if (r() < 0.35) c.set(x, 1 + (r() * 3 | 0), [255, 255, 255, 120]);
  c.save(path.join(OUT, "water.png"));
}

// A ridge of silhouettes: fills below a noisy line.
function ridge(c, seed, base, amp, col, step) {
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let x = 0; x < c.w; x++) {
    const h = base + Math.sin(x * 0.07 + ph[0]) * amp + Math.sin(x * 0.19 + ph[1]) * amp * 0.5 + Math.sin(x * 0.43 + ph[2]) * amp * 0.2;
    for (let y = Math.round(h); y < c.h; y++) c.set(x, y, col);
  }
  void step;
}

{ // far: hazy rock spires, an arch and kelp forest, all one cool tone so they read as distance
  const W = 170, H = 78;
  const c = new Canvas(W, H);
  const far = "#7b8ee6", near = "#6a76d2", haze = "#9aa9f0";
  ridge(c, 3, 46, 7, far);
  // arch
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const outer = P.inEllipse(x, y, 112, 62, 26, 34), inner = P.inEllipse(x, y, 112, 66, 14, 24);
    if (outer && !inner) c.set(x, y, near);
  }
  // spires
  const r = rng(11);
  for (const x0 of [14, 36, 62, 148, 160]) {
    const w = 5 + (r() * 4 | 0), h = 20 + (r() * 22 | 0);
    for (let i = 0; i < h; i++) {
      const ww = Math.max(1, Math.round(w * (1 - (i / h) ** 1.6)));
      for (let k = -ww; k <= ww; k++) c.set(x0 + k, H - 10 - i, near);
    }
  }
  ridge(c, 5, 60, 4, "#5967bd");
  // kelp forest silhouettes
  for (let x = 4; x < W; x += 9 + (r() * 8 | 0)) {
    const h = 14 + (r() * 22 | 0);
    for (let i = 0; i < h; i++) c.set(x + Math.round(Math.sin(i * 0.5 + x) * 1.4), H - 14 - i, "#5a6ac4");
  }
  // haze at the top edge of the silhouettes (dithered)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = c.get(x, y);
    if (o[3] && bayer(x, y) < 0.45 * (1 - y / H) ** 1.2) c.set(x, y, haze);
  }
  c.save(path.join(OUT, "far.png"));
}

{ // mid: coral, rocks and anemones, kept to the sides so the fighters have a clear lane
  const W = 170, H = 64;
  const c = new Canvas(W, H);
  const r = rng(21);
  const brain = (cx, cy, rx, ry, base, dark, light) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!P.inEllipse(x, y, cx, cy, rx, ry)) continue;
      const stripe = Math.floor((x + y * 0.8) / 3) % 3 === 0;
      const u = (y + 0.5 - cy) / ry;
      c.set(x, y, u > 0.45 ? dark : (x + y) % 5 === 0 && u < -0.2 ? light : stripe ? dark : base);
    }
    // outline
    const copy = new Canvas(W, H); copy.d.set(c.d);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (copy.get(x, y)[3]) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => x + a >= 0 && y + b >= 0 && x + a < W && y + b < H && copy.get(x + a, y + b)[3] && P.inEllipse(x + a, y + b, cx, cy, rx, ry))) c.set(x, y, "#3a2a6e");
    }
  };
  const tube = (x, base, h, w, col, dark, light) => {
    for (let y = 0; y < h; y++) for (let k = 0; k < w; k++) c.set(x + k, base - y, k === 0 ? light : k === w - 1 ? dark : col);
    for (let k = -1; k <= w; k++) c.set(x + k, base - h, "#3a2a6e");
    for (let k = 0; k < w; k++) c.set(x + k, base - h + 1, dark);
  };
  const rock = (cx, cy, rx, ry) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!P.inEllipse(x, y, cx, cy, rx, ry)) continue;
      const s = ((x - cx) / rx) * 0.6 + ((y - cy) / ry) * 0.8;
      c.set(x, y, s > 0.4 ? "#5a4e9c" : s < -0.4 ? "#9b8fe0" : "#7a6dc4");
    }
  };
  // left cluster
  rock(16, 62, 22, 12); rock(40, 64, 14, 8);
  brain(14, 50, 11, 9, "#ff8fb4", "#e0618f", "#ffc6d9");
  tube(30, 58, 20, 4, "#ffb066", "#e08a44", "#ffd29c"); tube(36, 58, 13, 4, "#ffb066", "#e08a44", "#ffd29c"); tube(24, 58, 9, 3, "#ffb066", "#e08a44", "#ffd29c");
  // right cluster
  rock(148, 63, 26, 11); rock(124, 65, 12, 7);
  brain(152, 49, 12, 10, "#b88cf0", "#8a5ed0", "#dcc2ff");
  tube(132, 58, 22, 4, "#7be0c8", "#42b79c", "#b8f5e6"); tube(138, 58, 12, 4, "#7be0c8", "#42b79c", "#b8f5e6"); tube(126, 58, 10, 3, "#7be0c8", "#42b79c", "#b8f5e6");
  // a few pebbles in the middle distance
  for (let i = 0; i < 9; i++) {
    const x = 62 + (r() * 50 | 0), y = 60 + (r() * 3 | 0);
    c.rect(x, y, 2, 1, "#8c80d6"); c.set(x, y - 1, "#b4a9f0");
  }
  c.save(path.join(OUT, "mid.png"));
}

{ // floor: a perspective checkered seabed fading into the haze at the horizon
  const W = 120, H = 130;
  const c = new Canvas(W, H);
  const r = rng(31);
  const sandA = hex("#f4d2cb"), sandB = hex("#eec3c8"), hazeCol = hex("#c9bcee");
  for (let y = 0; y < H; y++) {
    const t = (y + 1) / H;               // 0 at the horizon, 1 at the viewer
    const z = 1 / (t * 0.95 + 0.05);     // depth of this row
    for (let x = 0; x < W; x++) {
      const X = (x - W / 2) * z * 0.11;
      const ix = Math.floor(X), iz = Math.floor(z * 0.75);
      let col = (ix + iz) & 1 ? sandB : sandA;
      // grain
      if (r() < 0.02) col = lerp(col, [255, 255, 255], 0.35);
      // distance haze, dithered
      const fog = Math.max(0, 1 - t * 3.2);
      if (bayer(x, y) < fog) col = lerp(col, hazeCol, 0.7);
      c.set(x, y, col);
    }
  }
  // pebbles and shells scattered on the floor, bigger toward the viewer
  for (let i = 0; i < 26; i++) {
    const t = 0.25 + r() * 0.75, y = Math.floor(t * H) - 1, x = (r() * W) | 0;
    const s = t > 0.7 ? 2 : 1;
    c.rect(x, y, s * 2, s, "#c99aa8"); c.rect(x, y - 1, s, 1, "#fbe6e8");
  }
  for (let i = 0; i < 5; i++) { // little stars
    const t = 0.45 + r() * 0.5, y = Math.floor(t * H), x = (r() * W) | 0;
    c.set(x, y, "#ffb86b"); c.set(x - 1, y, "#ffb86b"); c.set(x + 1, y, "#ffb86b"); c.set(x, y - 1, "#ffb86b"); c.set(x, y + 1, "#ffd9a0");
  }
  c.save(path.join(OUT, "floor.png"));
}

{ // pad: the glowing ring each fighter stands on
  const W = 48, H = 16;
  const c = new Canvas(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = ((x + 0.5 - W / 2) / (W / 2)) ** 2 + ((y + 0.5 - H / 2) / (H / 2)) ** 2;
    if (u > 1) continue;
    if (u > 0.82) c.set(x, y, C.ink);
    else if (u > 0.7) c.set(x, y, (x + y) % 2 ? C.gold1 : C.gold0);
    else if (u > 0.56) c.set(x, y, "#b8688a");
    else c.set(x, y, bayer(x, y) < 0.35 ? "#d78aaa" : "#9a4f78");
  }
  c.save(path.join(OUT, "pad.png"));
}

console.log("art written to", OUT);
