// The seabed behind every screen, built as depth layers so the camera can move.
//
// Layers sit at different depths. Dragging (or, on a desktop, moving the mouse)
// slides each layer by an amount proportional to its depth, so the far rocks barely
// move while the foreground kelp sweeps past: a 3D diorama for flat 8-bit sprites.
// The two fighters live in the middle layer, on the seabed, facing each other.
//
// Sea life (bubbles, jellyfish, fish, plankton, swaying kelp) is plain CSS animation,
// so it keeps moving even if GSAP never loads.
(function () {
  const root = document.getElementById("world");
  const S = window.SPRITES;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const px = (n) => n.toFixed(1) + "px";

  // How far the nearest layer travels at full camera swing. "Slightly", on purpose.
  const AMP_X = 20, AMP_Y = 9;

  const KELP_MID = { b: "#2fa28c", s: "#1c7667", l: "#6fe0b8" };
  const KELP_FORE = { b: "#1d6b78", s: "#12414f", l: "#3a9a9a" };
  const JELLY = [
    { b: "#ffc4e4", l: "#fff0f8", s: "#f59ccf", t: "#ffa9d8" },
    { b: "#c8b6ff", l: "#efe8ff", s: "#9d86ee", t: "#b39bff" },
    { b: "#a8f0e4", l: "#e6fff9", s: "#6fd0c0", t: "#86e0d0" },
  ];
  const FISH = [
    { b: "#ffd18a", s: "#f39f6a", t: "#ffb86b", k: S.INK },
    { b: "#ff9ab8", s: "#e8708f", t: "#ff86a6", k: S.INK },
    { b: "#9fe3ff", s: "#6cb9e6", t: "#7fd0f5", k: S.INK },
  ];

  const flip2 = (a, b, cls) => `<span class="flip2 ${cls || ""}">${a.replace("pix ", "pix f0 ")}${b.replace("pix ", "pix f1 ")}</span>`;

  function build() {
    let jelly = "";
    JELLY.forEach((pal, i) => {
      const left = [12, 58, 82][i], top = [14, 24, 10][i], w = [38, 30, 34][i];
      jelly += `<div class="jelly" style="left:${left}%;top:${top}%;width:${w}px;--d:${rnd(7, 11).toFixed(1)}s;--dl:${-rnd(0, 8).toFixed(1)}s">` +
        flip2(S.jellyfish(pal, 0), S.jellyfish(pal, 1)) + `</div>`;
    });

    let fish = "";
    for (let g = 0; g < 3; g++) {
      const dir = g % 2 ? -1 : 1;
      const top = [30, 18, 38][g];
      const school = [0, 1, 2, 3].map((n) =>
        `<span class="fish-one" style="left:${n * 15 + (n % 2) * 6}px;top:${(n % 3) * 9 - 6}px">${S.fish(FISH[g], dir)}</span>`).join("");
      fish += `<div class="school ${dir < 0 ? "school-rtl" : ""}" style="top:${top}%;--d:${(26 + g * 9)}s;--dl:${-g * 11}s">${school}</div>`;
    }

    let kelpMid = "";
    [[13, 46, 0.2], [18, 34, 1.7], [80, 52, 3.1], [85, 38, 4.4], [72, 30, 5.2]].forEach(([left, h, seed], i) => {
      kelpMid += `<div class="kelp kelp-mid" style="left:${left}%;width:${h * 0.78}px;--sway:${(3.2 + i * 0.6).toFixed(1)}s;--dl:${-i * 0.9}s">${S.kelp(KELP_MID, h, seed)}</div>`;
    });

    let kelpFore = "";
    [[8, 74, 0.6, 1], [14, 52, 2.4, 0], [82, 80, 4.1, 1], [88, 58, 1.2, 0]].forEach(([left, h, seed, big], i) => {
      kelpFore += `<div class="kelp kelp-fore" style="left:${left}%;width:${h * 0.95}px;--sway:${(4.2 + i * 0.7).toFixed(1)}s;--dl:${-i * 1.3}s">${S.kelp(KELP_FORE, h, seed)}</div>`;
      void big;
    });

    let bubbles = "";
    for (let i = 0; i < 16; i++) {
      const s = rnd(8, 18);
      bubbles += `<span class="bubble" style="left:${rnd(2, 96).toFixed(1)}%;width:${s.toFixed(0)}px;--d:${rnd(8, 17).toFixed(1)}s;--dl:${-rnd(0, 16).toFixed(1)}s;--w:${rnd(6, 20).toFixed(0)}px">${S.bubble()}</span>`;
    }
    let hearts = "";
    const tints = ["pink", "blush", "sky", "pink", "red", "blush"];
    for (let i = 0; i < 6; i++) {
      hearts += `<span class="float-heart" style="left:${rnd(6, 92).toFixed(1)}%;width:${rnd(11, 17).toFixed(0)}px;--d:${rnd(14, 24).toFixed(1)}s;--dl:${-rnd(0, 20).toFixed(1)}s;--w:${rnd(10, 24).toFixed(0)}px">${S.heart(tints[i], 9)}</span>`;
    }
    let snow = "";
    for (let i = 0; i < 26; i++) {
      snow += `<i class="snow" style="left:${rnd(0, 100).toFixed(1)}%;--d:${rnd(10, 22).toFixed(1)}s;--dl:${-rnd(0, 22).toFixed(1)}s;--s:${Math.random() < 0.25 ? 3 : 2}px"></i>`;
    }
    // Things lying on the seabed. Lower on screen means nearer, so they grow with y.
    const SEAGRASS = [{ b: "#ff86ac", s: "#d85a86", l: "#ffc0d4" }, { b: "#58d6bf", s: "#2c9c8a", l: "#9af0dc" }];
    let props = "";
    [[10, 26, "star", 0], [58, 40, "shell", 0], [86, 18, "grass", 1], [30, 96, "grass", 0], [72, 120, "star", 1],
     [46, 158, "shell", 1], [8, 188, "star", 2], [90, 205, "grass", 1], [62, 232, "shell", 0], [24, 258, "grass", 0],
     [80, 270, "star", 2], [50, 290, "grass", 1]].forEach(([left, y, kind, v], i) => {
      const w = Math.round(14 + y * 0.14);
      const star = [{ b: "#ff9a62", l: "#ffd29c", s: "#e0703c", e: "#7a3126" }, { b: "#ff7aa8", l: "#ffc0d6", s: "#e0507f", e: "#7a2448" }, { b: "#ffd35a", l: "#fff0a8", s: "#e8a93c", e: "#8a5a1e" }][v % 3];
      const art = kind === "star" ? S.starfish(star) : kind === "shell" ? S.shell() : S.kelp(SEAGRASS[v % 2], 16, i);
      props += `<span class="prop prop-${kind}" style="left:${left}%;top:calc(var(--hz) + ${y}px);width:${kind === "grass" ? w * 0.9 : w}px">${art}</span>`;
    });
    let glints = "";
    for (let i = 0; i < 9; i++) {
      glints += `<span class="glint" style="left:${rnd(8, 92).toFixed(1)}%;top:calc(var(--hz) + ${(14 + (i * 41) % 260)}px);--dl:${-rnd(0, 4).toFixed(1)}s">${S.sparkle("#fff2b8")}</span>`;
    }

    root.innerHTML =
      `<div class="layer l-rays" data-depth="0.1"><i></i><i></i><i></i></div>` +
      `<div class="layer l-life-far" data-depth="0.28">${jelly}${fish}</div>` +
      `<div class="layer l-far" data-depth="0.4"><div class="img"></div></div>` +
      `<div class="layer l-mid" data-depth="0.65"><div class="img"></div>${kelpMid}</div>` +
      `<div class="layer l-floor" data-depth="0.9"><div class="floor"></div>${props}${glints}</div>` +
      `<div class="layer l-actors" data-depth="1.05"><div class="actors">` +
        `<div class="actor actor-foe" id="actor-foe"><div class="pad"></div><div class="sprite sprite-foe" id="sprite-foe"></div></div>` +
        `<div class="actor actor-me" id="actor-me"><div class="pad"></div>` +
          `<button class="sprite sprite-me" id="sprite-me" aria-label="Your mood. Tap to flip it."></button></div>` +
      `</div></div>` +
      `<div class="layer l-life-near" data-depth="1.45">${bubbles}${hearts}${snow}</div>` +
      `<div class="layer l-fore" data-depth="2.1">${kelpFore}</div>`;
  }

  build();
  const layers = [...root.querySelectorAll(".layer")].map((el) => ({ el, depth: Number(el.dataset.depth) }));

  // ---------- camera ----------
  let tx = 0, ty = 0; // where the camera wants to be, -1..1
  let cx = 0, cy = 0; // where it is
  let drag = null, letGoAt = 0;
  let sway = !reduced;

  const IGNORE = "button:not(.sprite-me), input, textarea, a, dialog, summary, .panel, .plate, .dock, .burst";
  const skip = (t) => t && t.closest && t.closest(IGNORE);

  window.addEventListener("pointerdown", (e) => {
    if (skip(e.target) || e.button > 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: tx, ty: ty };
  }, { passive: true });
  window.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.id) {
      tx = clamp(drag.tx + (e.clientX - drag.x) / (innerWidth * 0.42), -1, 1);
      ty = clamp(drag.ty + (e.clientY - drag.y) / (innerHeight * 0.5), -1, 1);
    } else if (e.pointerType === "mouse" && !skip(e.target)) {
      tx = (e.clientX / innerWidth - 0.5) * 1.4; // desktop: the camera follows the pointer
      ty = (e.clientY / innerHeight - 0.5) * 0.8;
    }
  }, { passive: true });
  const letGo = (e) => {
    if (drag && e.pointerId === drag.id) { drag = null; letGoAt = performance.now(); }
  };
  window.addEventListener("pointerup", letGo, { passive: true });
  window.addEventListener("pointercancel", letGo, { passive: true });

  let last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    // after a swipe the camera drifts home, like a camera on a spring
    if (!drag && now - letGoAt > 500) {
      const home = 1 - Math.pow(0.12, dt);
      tx += (0 - tx) * home; ty += (0 - ty) * home;
    }
    const ease = 1 - Math.pow(0.0008, dt);
    cx += (tx - cx) * ease; cy += (ty - cy) * ease;
    const sx = sway ? Math.sin(now / 2600) * 0.1 : 0, sy = sway ? Math.sin(now / 3400 + 1) * 0.06 : 0;
    for (const l of layers) {
      l.el.style.transform = `translate3d(${px((cx + sx) * l.depth * AMP_X)},${px((cy + sy) * l.depth * AMP_Y)},0)`;
    }
  }
  requestAnimationFrame(frame);

  // ---------- layout hooks ----------
  const de = document.documentElement;
  // The stage is the open space between the top bar and the dock; the fighters and
  // the horizon are placed against it so nothing ever sits under the UI.
  function measure() {
    const stage = document.getElementById("stage");
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    if (r.height < 40) return;
    de.style.setProperty("--st", px(r.top));
    de.style.setProperty("--sh", px(r.height));
    const dock = document.getElementById("dock");
    if (dock && dock.offsetHeight) de.style.setProperty("--dock-h", px(dock.offsetHeight));
  }
  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", measure);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(measure);
    for (const id of ["stage", "dock"]) { const el = document.getElementById(id); if (el) ro.observe(el); }
  }

  window.WORLD = {
    // menu | home: the fighters only show up for the battle
    setMode(m) { root.dataset.mode = m; if (m === "home") requestAnimationFrame(measure); },
    measure,
    // brief camera shove for impacts (a kick toward the point of impact)
    nudge(x, y) { tx = clamp(tx + x, -1, 1); ty = clamp(ty + y, -1, 1); letGoAt = performance.now() - 200; },
    root,
  };
})();
