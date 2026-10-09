// All the pixel art in the app. Every sprite is built on a tiny grid and drawn as
// one SVG <path> per colour, so it stays crisp at any size and needs no image files.
// The same grids are rasterised by tools/gen-art.js to bake the backdrop PNGs.
// Nothing here touches the DOM; everything returns markup (or a grid).
(function (root) {
  // ---------- grid helpers ----------
  const grid = (w, h) => ({ w, h, c: new Array(w * h).fill(0) });
  const put = (g, x, y, k) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.c[y * g.w + x] = k;
  };
  const get = (g, x, y) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? 0 : g.c[y * g.w + x]);
  const inEllipse = (x, y, cx, cy, rx, ry) =>
    ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
  function mask(g, fn) {
    const m = new Array(g.w * g.h).fill(false);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (fn(x, y)) m[y * g.w + x] = true;
    return m;
  }
  // Paint a 1px ring of `k` on every empty cell touching a filled one (4-neighbour).
  function outline(g, k) {
    const add = [];
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (get(g, x, y)) continue;
      if (get(g, x - 1, y) || get(g, x + 1, y) || get(g, x, y - 1) || get(g, x, y + 1)) add.push([x, y]);
    }
    for (const [x, y] of add) put(g, x, y, k);
  }
  // Hand-drawn maps: one string per row, one char per pixel, "." is empty.
  function fromMap(rows, legend) {
    const g = grid(rows[0].length, rows.length);
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== "." && legend[ch]) put(g, x, y, legend[ch]); }));
    return g;
  }

  // ---------- grid -> SVG ----------
  // One path per colour; runs of equal pixels in a row are merged into single rects.
  // `cls` maps a palette key to a CSS class so a few pixels (tears, steam) can animate.
  function toSVG(g, pal, opts) {
    const o = opts || {};
    const paths = {};
    for (let y = 0; y < g.h; y++) {
      let x = 0;
      while (x < g.w) {
        const k = g.c[y * g.w + x];
        if (!k) { x++; continue; }
        let n = 1;
        while (x + n < g.w && g.c[y * g.w + x + n] === k) n++;
        (paths[k] || (paths[k] = [])).push(`M${x} ${y}h${n}v1h-${n}z`);
        x += n;
      }
    }
    let body = "";
    for (const k in paths) {
      const cls = o.cls && o.cls[k] ? ` class="${o.cls[k]}"` : "";
      body += `<path${cls} fill="${pal[k] || "#f0f"}" d="${paths[k].join("")}"/>`;
    }
    return (
      `<svg class="pix ${o.className || ""}" viewBox="0 0 ${g.w} ${g.h}" width="${g.w}" height="${g.h}"` +
      ` shape-rendering="crispEdges" aria-hidden="true" focusable="false">${body}</svg>`
    );
  }

  // ---------- the octopus ----------
  // Built from the plush toy references: a big round dome, flat petal tentacles that
  // fan out low and wide, glossy black eyes and a tiny mouth. Three skins, same body.
  const MOOD = {
    happy: { label: "Happy", body: "#ffa8c8", light: "#ffd3e4", shade: "#f27fab", tent: "#ff95bd",
             under: "#c8a9f2", edge: "#a63e6c", cheek: "#ff6f9f", ui: "#ff9ec7" },
    angry: { label: "Angry", body: "#a68df2", light: "#cdbcff", shade: "#7d63d0", tent: "#9179e8",
             under: "#ffb4d2", edge: "#43338d", cheek: "#c98cf0", ui: "#a68df2" },
    sad:   { label: "Sad",   body: "#8fdde6", light: "#c6f2f7", shade: "#5eb1ca", tent: "#7bcfe0",
             under: "#f8cbdd", edge: "#27688a", cheek: "#a5e6ee", ui: "#8fdde6" },
  };
  const ORDER = ["happy", "angry", "sad"];
  const INK = "#1b1030";

  const OW = 40, OH = 31; // octopus grid
  const DOME = { cx: 20, cy: 10.5, rx: 10, ry: 9.3 };
  // Flat petal tentacles: [cx, cy, rx, ry]. Outer pair rise a little: the battle stance.
  const PETALS = [
    [4.8, 21.5, 4.8, 3.6], [9.8, 24.2, 4.8, 3.8], [15.2, 25.7, 4.4, 3.8],
    [24.8, 25.7, 4.4, 3.8], [30.2, 24.2, 4.8, 3.8], [35.2, 21.5, 4.8, 3.6],
  ];

  // opts: look (-1 left, 0, 1 right), expr (idle|mwah|hit), frame (0|1 tentacle flex), raise (arms up)
  function octopusGrid(mood, opts) {
    const o = opts || {};
    const key = MOOD[mood] ? mood : "happy";
    const look = o.look || 0;
    const frame = o.frame || 0;
    const expr = o.expr || "idle";
    const g = grid(OW, OH);

    // tentacles first, so the dome overlaps them
    const tmask = new Array(OW * OH).fill(false);
    // paint order: outer petals first, front-centre last, so each later one overlaps and seams read
    const order = [0, 5, 1, 4, 2, 3];
    order.forEach((i, n) => {
      const [cx, cy, rx, ry] = PETALS[i];
      const outer = i === 0 || i === 5;
      let y0 = cy - (outer ? 2 : 0) - (o.raise && outer ? 7 : 0);
      let ryy = ry + (o.raise && outer ? 1.6 : 0);
      if (frame === 1) y0 += outer ? -1 : (i % 2 ? 1 : 0.6);
      for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
        if (!inEllipse(x, y, cx, y0, rx, ryy)) continue;
        const low = y + 0.5 > y0 + ryy * 0.62;
        const top = y + 0.5 < y0 - ryy * 0.55;
        const edgeOfNew = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(
          ([a, b]) => !inEllipse(a, b, cx, y0, rx, ryy) && tmask[b * OW + a]);
        tmask[y * OW + x] = true;
        put(g, x, y, edgeOfNew && n > 0 ? "sm" : low ? "u" : top ? "l" : "t");
      }
    });

    // dome, with a little dithered shading from the upper-left light
    const dmask = mask(g, (x, y) => inEllipse(x, y, DOME.cx, DOME.cy, DOME.rx, DOME.ry));
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
      if (!dmask[y * OW + x]) continue;
      const u = (x + 0.5 - DOME.cx) / DOME.rx, v = (y + 0.5 - DOME.cy) / DOME.ry;
      const s = 0.7 * u + 0.85 * v;
      let k = "b";
      if (s > 0.62) k = "s";
      else if (s > 0.46 && (x + y) % 2 === 0) k = "s";
      else if (s < -0.62) k = "l";
      else if (s < -0.46 && (x + y) % 2 === 0) k = "l";
      put(g, x, y, k);
    }
    // glossy highlight
    for (const [dx, dy] of [[-6, -6], [-5, -6], [-4, -6], [-7, -5], [-6, -5], [-7, -4]]) put(g, DOME.cx + dx, DOME.cy + dy, "w");
    // seam where the dome sits on the tentacles
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
      if (!dmask[y * OW + x]) continue;
      const nb = [[x, y + 1], [x - 1, y], [x + 1, y]].some(([a, b]) => tmask[b * OW + a] && !dmask[b * OW + a]);
      if (nb && y > DOME.cy + 3) put(g, x, y, "e2");
    }
    outline(g, "e");

    // ---- face ----
    const fx = 20 + look * 2; // the face slides toward whoever it is looking at
    const eyeShape = (ex, ey, flatTop) => {
      const rows = flatTop ? [[0, 3], [0, 3], [0, 3], [1, 2]] : [[1, 2], [0, 3], [0, 3], [0, 3], [1, 2]];
      rows.forEach(([a, b], r) => { for (let c = a; c <= b; c++) put(g, ex + c, ey + r, "k"); });
    };
    const shine = (ex, ey) => {
      const sx = look > 0 ? 3 : look < 0 ? 0 : 2;
      put(g, ex + sx, ey + 1, "w");
      if (key === "sad") put(g, ex + (sx === 0 ? 1 : sx - 1), ey + 3, "w");
    };
    const L = fx - 6, R = fx + 2; // left-most column of each 4px eye
    if (expr === "mwah") {
      for (const ex of [L, R]) { // happy closed arches
        put(g, ex, 12, "k"); put(g, ex + 1, 11, "k"); put(g, ex + 2, 11, "k"); put(g, ex + 3, 12, "k");
      }
      // pursed lips: two bumps on top, wide middle, narrower bottom
      [[-2, 15], [1, 15], [-3, 16], [-2, 16], [-1, 16], [0, 16], [1, 16], [2, 16], [-2, 17], [-1, 17], [0, 17], [1, 17]]
        .forEach(([dx, dy]) => put(g, fx + dx, dy, dy === 16 && dx === -2 ? "p" : "r"));
      for (const dx of [-9, -8, 7, 8]) put(g, fx + dx, 15, "c");
    } else if (expr === "love") { // heart eyes
      for (const ex of [L - 1, R - 1]) {
        [[0, 0], [1, 0], [3, 0], [4, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [2, 3]]
          .forEach(([dx, dy]) => put(g, ex + dx, 10 + dy, "r"));
        put(g, ex + 1, 10, "p");
      }
      put(g, fx - 3, 16, "k"); put(g, fx + 2, 16, "k");
      for (let c = -2; c <= 1; c++) put(g, fx + c, 17, "k");
      for (const dx of [-9, -8, 7, 8]) put(g, fx + dx, 15, "c");
    } else if (expr === "shock") { // wide eyes, tiny pupils, round mouth
      for (const ex of [L, R]) {
        for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) {
          const edge = r === 0 || r === 5 || c === 0 || c === 3;
          if ((r === 0 || r === 5) && (c === 0 || c === 3)) continue;
          put(g, ex + c, 9 + r, edge ? "k" : "w");
        }
        put(g, ex + 1, 12, "k"); put(g, ex + 2, 12, "k");
      }
      for (let r = 0; r < 3; r++) { put(g, fx - 1, 16 + r, "k"); put(g, fx, 16 + r, "k"); }
      put(g, fx - 2, 17, "k"); put(g, fx + 1, 17, "k");
    } else if (expr === "dizzy") { // x eyes, wobbly mouth, stars
      for (const ex of [L, R]) for (let i = 0; i < 4; i++) { put(g, ex + i, 10 + i, "k"); put(g, ex + 3 - i, 10 + i, "k"); }
      for (let c = -3; c <= 2; c++) put(g, fx + c, 16 + (c % 2 ? 1 : 0), "k");
      for (const [x, y] of [[13, 0], [14, 1], [12, 1], [13, 2], [24, 1], [25, 2], [23, 2], [24, 3], [19, 0]]) put(g, x, y, "y");
    } else if (expr === "cheer") { // happy squint, big open grin
      for (const ex of [L, R]) { put(g, ex, 12, "k"); put(g, ex + 1, 11, "k"); put(g, ex + 2, 11, "k"); put(g, ex + 3, 12, "k"); }
      for (let c = -3; c <= 2; c++) put(g, fx + c, 16, "k");
      for (let c = -2; c <= 1; c++) put(g, fx + c, 17, "r");
      for (const dx of [-9, -8, 7, 8]) put(g, fx + dx, 15, "c");
    } else if (expr === "hit") {
      [[0, 10], [1, 11], [2, 12], [1, 13], [0, 14]].forEach(([dx, dy]) => { put(g, L + dx, dy, "k"); put(g, L + dx + 1, dy, "k"); });
      [[3, 10], [2, 11], [1, 12], [2, 13], [3, 14]].forEach(([dx, dy]) => { put(g, R + dx, dy, "k"); put(g, R + dx - 1, dy, "k"); });
      put(g, fx - 1, 16, "k"); put(g, fx, 16, "k"); put(g, fx - 1, 17, "k"); put(g, fx, 17, "k");
    } else if (key === "angry") {
      eyeShape(L, 11, true); eyeShape(R, 11, true);
      shine(L, 11); shine(R, 11);
      for (let i = 0; i < 5; i++) { // brows slant down toward the nose
        const y = 7 + Math.floor(i * 0.62);
        put(g, L - 1 + i, y, "k"); put(g, L - 1 + i, y + 1, "k");
        put(g, R + 4 - i, y, "k"); put(g, R + 4 - i, y + 1, "k");
      }
      for (let c = -2; c <= 1; c++) put(g, fx + c, 16, "k");
      put(g, fx - 3, 17, "k"); put(g, fx + 2, 17, "k");
      // steam puffs off the top, animated by CSS
      for (const [x, y] of [[6, 5], [5, 4], [6, 3], [33, 5], [34, 4], [33, 3]]) put(g, x, y, "g");
    } else if (key === "sad") {
      eyeShape(L, 10, false); eyeShape(R, 10, false);
      shine(L, 10); shine(R, 10);
      for (let i = 0; i < 5; i++) { // brows lift in the middle
        const y = 10 - Math.floor(i * 0.5);
        put(g, L - 1 + i, y - 2, "k"); put(g, R + 4 - i, y - 2, "k");
      }
      for (let c = -2; c <= 1; c++) put(g, fx + c, 16, "k");
      put(g, fx - 3, 17, "k"); put(g, fx + 2, 17, "k");
      for (const y of [15, 16, 17]) put(g, R + 4, y, "d"); // tear
      put(g, R + 4, 18, "d");
    } else {
      eyeShape(L, 10, false); eyeShape(R, 10, false);
      shine(L, 10); shine(R, 10);
      put(g, fx - 3, 16, "k"); put(g, fx + 2, 16, "k");
      for (let c = -2; c <= 1; c++) put(g, fx + c, 17, "k");
      for (const dx of [-9, -8, 7, 8]) put(g, fx + dx, 15, "c");
    }
    return g;
  }

  const mix = (a, b, t) => {
    const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [n(a), n(b)];
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
  };
  function octoPalette(mood) {
    const m = MOOD[mood] || MOOD.happy;
    return {
      b: m.body, l: m.light, s: m.shade, t: m.tent, u: m.under, e: m.edge, e2: m.edge, sm: mix(m.shade, m.edge, 0.4),
      k: INK, w: "#ffffff", c: m.cheek, r: "#e8365f", p: "#ff8aa8", g: "#ffffff", d: "#8fe0ff", y: "#ffe45c",
    };
  }

  // One frame as an <svg>. mood: happy | angry | sad.
  function octopusFrame(mood, opts) {
    return toSVG(octopusGrid(mood, opts), octoPalette(mood), {
      className: "octo-f", cls: { g: "px-steam", d: "px-tear" },
    });
  }

  // The animated sprite: two tentacle-flex frames cross-faded by CSS (steps), same silhouette.
  // opts.look: -1 faces left, 1 faces right. opts.expr: idle | mwah | hit.
  function octopus(mood, opts) {
    const o = opts || {};
    const key = MOOD[mood] ? mood : "happy";
    return (
      `<span class="octo octo-${key}" data-look="${o.look || 0}">` +
        octopusFrame(key, { ...o, frame: 0 }).replace("octo-f", "octo-f f0") +
        octopusFrame(key, { ...o, frame: 1 }).replace("octo-f", "octo-f f1") +
      `</span>`
    );
  }

  // ---------- small sprites ----------
  function heartGrid(w) {
    const W = w || 13, H = Math.round(W * 0.92);
    const g = grid(W + 2, H + 2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const hx = ((x + 0.5) / W - 0.5) * 2.7;
      const hy = (0.62 - (y + 0.5) / H) * 2.5;
      if ((hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3 > 0) continue;
      const lit = hx < -0.15 && hy > 0.28;
      const low = hx + (-hy) * 0.5 > 0.55;
      put(g, x + 1, y + 1, lit ? "l" : low ? "s" : "b");
    }
    outline(g, "e");
    return g;
  }
  const HEART_PAL = (c) => ({ b: c.body, l: c.light, s: c.shade, e: c.edge });
  const HEART = {
    pink:  { body: "#ff6fa1", light: "#ffb7d1", shade: "#e04a82", edge: "#8e1f4d" },
    red:   { body: "#ff4568", light: "#ff9aa9", shade: "#d12a52", edge: "#7e1236" },
    blush: { body: "#ffb1cd", light: "#ffe0ec", shade: "#f08cb2", edge: "#a63e6c" },
    sky:   { body: "#8fdcff", light: "#d4f3ff", shade: "#5ab4e6", edge: "#2a5f93" },
    gold:  { body: "#ffd35a", light: "#fff0a8", shade: "#f2a93c", edge: "#a8641e" },
  };
  const heart = (tint, size) =>
    toSVG(heartGrid(size), HEART_PAL(HEART[tint] || HEART.pink), { className: "px-heart" });

  const sparkle = (c) =>
    toSVG(fromMap(["..Y..", "..Y..", "YYWYY", "..Y..", "..Y.."], { Y: "y", W: "w" }),
      { y: c || "#fff2a8", w: "#ffffff" }, { className: "px-sparkle" });

  const BUBBLE_MAP = [".OOO.", "O...O", "O.W.O", "O...O", ".OOO."];
  const bubble = () =>
    toSVG(fromMap(BUBBLE_MAP, { O: "o", W: "w" }), { o: "rgba(255,255,255,.75)", w: "#fff" }, { className: "px-bubble" });

  // Icons for the move buttons (hand-drawn maps).
  const ICON_PAL = { o: INK, y: "#ffd35a", Y: "#fff0a8", w: "#ffffff", r: "#e8365f", p: "#ff8aa8", c: "#bfeaff", b: "#7bd3ff" };
  const ICONS = {
    // exclamation burst
    attention: fromMap([
      "...ooo...",
      "..oyyyo..",
      "..oyYyo..",
      "..oyyyo..",
      "..oyyyo..",
      "...oyo...",
      "...ooo...",
      ".........",
      "..ooooo..",
      "..oyyyo..",
      "..ooooo..",
    ], { o: "o", y: "y", Y: "Y" }),
    // thought cloud
    thinking: fromMap([
      "....ooo.......",
      "..ooccco.oo...",
      ".occcccocccoo.",
      "occcwcccccccco",
      "occcccccccccco",
      ".oocccccccccoo",
      "...ooooooooo..",
      ".....o........",
      "....ooo.......",
      ".....o........",
    ], { o: "o", c: "c", w: "w" }),
    // lips
    mwah: fromMap([
      "..ooo...ooo..",
      ".orrrooorrro.",
      "orrwrrrrrrrro",
      ".ooooooooooo.",
      ".oppppppppo..",
      "..oppppppo...",
      "...ooooooo...",
    ], { o: "o", r: "r", p: "p", w: "w" }),
  };
  // The "missing you" icon is just a heart, kept in the same family.
  const icon = (name, cls) =>
    name === "missing" ? heart("red", 11).replace("px-heart", cls || "px-icon")
      : toSVG(ICONS[name], ICON_PAL, { className: cls || "px-icon" });
  const iconHeart = () => heart("red", 11);

  // Toolbar glyphs: 16x16 viewBox, drawn in currentColor so CSS can tint them.
  const UI_ICONS = {
    music: "M6 2h8v2H8v8H6zM12 4h2v6h-2zM3 10h5v4H3zM9 8h5v4H9z",
    menu: "M3 4h10v2H3zM3 7h10v2H3zM3 10h10v2H3z",
    log: "M3 3h10v2H3zM3 7h10v2H3zM3 11h6v2H3z",
  };
  const uiIcon = (name) =>
    `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="${UI_ICONS[name]}"/></svg>`;

  // Backdrop life ---------------------------------------------------------
  function jellyGrid(frame) {
    const g = grid(15, 20);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 15; x++) {
      if (!inEllipse(x, y, 7.5, 8.5, 6.8, 7.5)) continue;
      put(g, x, y + 1, y < 3 && x > 8 ? "l" : y > 6 ? "s" : "b");
    }
    for (const x of [3, 6, 9, 12]) {
      for (let y = 10; y < 19; y++) {
        const sway = Math.round(Math.sin((y + x + frame * 2) * 0.9));
        put(g, x + sway, y, y % 3 === 2 ? "s" : "t");
      }
    }
    return g;
  }
  const jellyfish = (tint, frame) => toSVG(jellyGrid(frame || 0), tint || { b: "#ffc4e4", l: "#fff0f8", s: "#f59ccf", t: "#ffa9d8" }, { className: "px-jelly" });

  function fishGrid(face) {
    const g = grid(14, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 14; x++) {
      if (inEllipse(x, y, 6, 4, 5, 2.9)) put(g, x, y, y > 4.6 ? "s" : "b");
    }
    for (let i = 0; i < 4; i++) for (let y = 3 - i; y <= 4 + i; y++) put(g, 10 + i, y, "t");
    put(g, 3, 3, "k"); put(g, 6, 2, "s"); put(g, 6, 3, "s"); put(g, 6, 4, "s");
    if (face < 0) { // mirror so it swims left
      const m = grid(14, 8);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 14; x++) put(m, 13 - x, y, g.c[y * 14 + x]);
      return m;
    }
    return g;
  }
  const fish = (pal, face) => toSVG(fishGrid(face || 1), pal || { b: "#ffd18a", s: "#f39f6a", t: "#ffb86b", k: INK }, { className: "px-fish" });

  // A kelp strand: 2px stalk that wiggles, with leaves.
  function kelpGrid(h, seed) {
    const g = grid(11, h);
    let x = 5;
    for (let y = h - 1; y >= 0; y--) {
      x = 5 + Math.round(Math.sin((h - y) * 0.32 + seed) * 2.4);
      put(g, x, y, "b"); put(g, x + 1, y, "s");
      if ((h - y) % 7 === 3) { // leaf
        const dir = ((h - y) / 7 | 0) % 2 ? 1 : -1;
        for (let i = 1; i <= 3; i++) { put(g, x + dir * (i + (dir > 0 ? 1 : 0)), y - (i >> 1), i === 3 ? "l" : "b"); }
      }
    }
    return g;
  }
  const kelp = (pal, h, seed) => toSVG(kelpGrid(h || 40, seed || 0), pal || { b: "#2fa28c", s: "#1c7667", l: "#6fe0b8" }, { className: "px-kelp" });

  // Seabed props -------------------------------------------------------
  function starGrid() {
    const g = grid(13, 13);
    for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
      const dx = x + 0.5 - 6.5, dy = y + 0.5 - 6.5, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const lim = 6.2 * (0.34 + 0.66 * Math.pow(Math.abs(Math.cos(2.5 * (a + Math.PI / 2))), 2.2));
      if (r > lim) continue;
      put(g, x, y, r < 1.8 ? "l" : dy > 1.2 ? "s" : (x + y) % 4 === 0 && r > 2.5 && r < 4.8 ? "l" : "b");
    }
    outline(g, "e");
    return g;
  }
  const STAR = { b: "#ff9a62", l: "#ffd29c", s: "#e0703c", e: "#7a3126" };
  const starfish = (pal) => toSVG(starGrid(), pal || STAR, { className: "px-prop" });

  function shellGrid() {
    const g = grid(13, 9);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 13; x++) {
      const dx = (x + 0.5 - 6.5) / 6.2, dy = (y + 0.5 - 7.5) / 7;
      if (dx * dx + dy * dy > 1 || y > 7) continue;
      const rib = Math.round((Math.atan2(dy, dx) + Math.PI) * 4.2) % 2 === 0;
      put(g, x, y, rib ? "s" : y < 3 ? "l" : "b");
    }
    for (let x = 4; x < 9; x++) put(g, x, 8, "s");
    outline(g, "e");
    return g;
  }
  const SHELL = { b: "#ffd0dc", l: "#fff0f4", s: "#f3a4bf", e: "#9b4768" };
  const shell = (pal) => toSVG(shellGrid(), pal || SHELL, { className: "px-prop" });

  root.SPRITES = {
    octopus, octopusFrame, octopusGrid, octoPalette, MOOD, MOODS: ORDER, INK,
    heart, HEART, sparkle, bubble, starfish, shell, icon, iconHeart, uiIcon, jellyfish, fish, kelp,
    // low level, used by tools/gen-art.js
    _px: { grid, put, get, inEllipse, outline, fromMap, toSVG, heartGrid, kelpGrid, jellyGrid, fishGrid, ICONS, ICON_PAL, HEART },
  };
  if (typeof module !== "undefined") module.exports = root.SPRITES;
})(typeof window !== "undefined" ? window : globalThis);
