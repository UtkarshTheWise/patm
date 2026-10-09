// Every animation that GSAP drives lives here, so app.js only ever says *what*
// happened and this file decides how it moves. (Sea life and camera live in
// world.js / CSS and keep moving without GSAP.)
//
// GSAP is optional: if it failed to load (offline first run) or the person
// asked for reduced motion, every helper still lands on the same end state --
// it just gets there instantly. UI.motion says which mode we are in.
(function () {
  const g = window.gsap || null;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
  const motion = !!g && !reduced;
  if (g) g.defaults({ ease: "power2.out" });

  const S = window.SPRITES;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const $ = (s) => document.querySelector(s);

  // ---------- screens ----------
  function showScreen(id) {
    const next = document.getElementById(id);
    for (const s of document.querySelectorAll(".screen")) {
      if (s !== next && !s.hidden) s.hidden = true;
    }
    if (window.WORLD) window.WORLD.setMode(id === "home" ? "home" : "menu");
    if (!next || !next.hidden) return next;
    next.hidden = false;
    if (!motion) return next;
    g.killTweensOf(next);
    g.fromTo(next, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.36, clearProps: "transform" });
    const rows = next.querySelectorAll(".stagger > *");
    if (rows.length) {
      g.fromTo(rows, { autoAlpha: 0, y: 12 },
        { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.05, delay: 0.05, clearProps: "transform,opacity,visibility" });
    }
    return next;
  }

  // ---------- text reveal ----------
  // One run at a time; a new call cancels the old one mid-sentence.
  const typing = new WeakMap();
  function type(el, text, opts) {
    const o = opts || {};
    if (!el) return Promise.resolve();
    const prev = typing.get(el);
    if (prev) clearInterval(prev);
    if (!motion || o.instant) { el.textContent = text; typing.delete(el); return Promise.resolve(); }
    el.textContent = "";
    return new Promise((done) => {
      let i = 0;
      const t = setInterval(() => {
        el.textContent = text.slice(0, ++i);
        if (i >= text.length) { clearInterval(t); typing.delete(el); done(); }
      }, o.speed || 20);
      typing.set(el, t);
    });
  }

  // ---------- small interactions ----------
  function press(el) {
    if (!motion || !el) return;
    g.killTweensOf(el);
    g.timeline()
      .to(el, { scale: 0.94, duration: 0.07 })
      .to(el, { scale: 1, duration: 0.3, ease: "elastic.out(1, 0.45)" });
  }

  function pop(el, opts) {
    if (!motion || !el) return;
    const o = opts || {};
    g.fromTo(el, { scale: o.from || 0.7 }, { scale: 1, duration: 0.5, ease: "back.out(2.4)" });
  }

  function shake(el, strength) {
    if (!motion || !el) return;
    const s = strength || 8;
    g.killTweensOf(el, "x,y"); // only the previous shake, never a scale/fade the caller is running
    const tl = g.timeline();
    for (let i = 0; i < 6; i++) tl.to(el, { x: rnd(-s, s), y: rnd(-s / 2, s / 2), duration: 0.05 });
    tl.to(el, { x: 0, y: 0, duration: 0.12 });
  }

  // Looping idle bob, so the fighters never sit perfectly still.
  function idle(el, opts) {
    if (!motion || !el) return;
    const o = opts || {};
    const dur = o.duration || 1.5;
    g.to(el, { y: o.rise || -5, duration: dur, delay: o.delay || 0, repeat: -1, yoyo: true, ease: "sine.inOut" });
    g.to(el, {
      scaleX: 1.03, scaleY: 0.97, duration: dur / 2,
      delay: (o.delay || 0) + 0.2, repeat: -1, yoyo: true, ease: "sine.inOut",
    });
  }

  // ---------- attention meter ----------
  function setBar(fill, pct, opts) {
    if (!fill) return;
    const w = Math.max(0, Math.min(100, pct));
    fill.dataset.tier = w > 55 ? "high" : w > 22 ? "mid" : "low";
    if (!motion || (opts && opts.instant)) { fill.style.width = w + "%"; return; }
    g.to(fill, { width: w + "%", duration: 0.8, ease: "power2.inOut" });
  }

  // ---------- mood flip ----------
  // Mirrors how the real toy works: squash, turn inside out, pop back.
  function flipMood(el, render) {
    if (!motion) { render(); return Promise.resolve(); }
    return new Promise((done) => {
      g.killTweensOf(el);
      g.timeline({
        onComplete() {
          g.set(el, { clearProps: "all" });
          idle(el, { duration: 1.7 });
          done();
        },
      })
        .to(el, { scaleX: 0.08, scaleY: 1.14, rotate: -8, duration: 0.17, ease: "power2.in" })
        .add(render)
        .to(el, { scaleX: 1.1, scaleY: 0.9, rotate: 6, duration: 0.14 })
        .to(el, { scaleX: 1, scaleY: 1, rotate: 0, duration: 0.5, ease: "elastic.out(1, 0.4)" });
    });
  }

  // ---------- projectiles ----------
  const TINT = { 1: "blush", 2: "sky", 3: "red", 4: "pink", 5: "gold", 6: "gold" };
  const bit = (level) => (level === 4 ? S.icon("mwah") : S.heart(TINT[level] || "pink", 11));

  // Hearts arc from one sprite to the other along a quadratic bezier.
  // Hand-rolled instead of MotionPathPlugin so core GSAP is all we need.
  function hearts(layer, fromEl, toEl, count, level) {
    if (!motion || !layer || !fromEl || !toEl) return;
    const L = layer.getBoundingClientRect();
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    const x0 = a.left - L.left + a.width / 2;
    const y0 = a.top - L.top + a.height * 0.3;
    const x1 = b.left - L.left + b.width / 2;
    const y1 = b.top - L.top + b.height * 0.45;

    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "fx-bit";
      el.innerHTML = bit(level);
      layer.appendChild(el);
      const cx = (x0 + x1) / 2 + rnd(-40, 40);
      const cy = Math.min(y0, y1) - rnd(50, 110);
      const p = { t: 0 };
      g.to(p, {
        t: 1,
        duration: rnd(0.55, 0.8),
        delay: i * 0.07,
        ease: "power1.inOut",
        onUpdate() {
          const t = p.t, u = 1 - t;
          const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
          const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
          el.style.transform =
            "translate(" + Math.round(x) + "px, " + Math.round(y) + "px) translate(-50%, -50%) " +
            "scale(" + (0.6 + 0.7 * Math.sin(t * Math.PI)).toFixed(2) + ")";
        },
        onComplete() { el.remove(); },
      });
    }
  }

  function sparks(layer, atEl, count) {
    if (!motion || !layer || !atEl) return;
    const L = layer.getBoundingClientRect();
    const a = atEl.getBoundingClientRect();
    const x = a.left - L.left + a.width / 2;
    const y = a.top - L.top + a.height / 2;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "fx-bit";
      el.style.width = "18px";
      el.innerHTML = S.sparkle();
      layer.appendChild(el);
      g.set(el, { x: x, y: y, xPercent: -50, yPercent: -50 });
      g.to(el, {
        x: x + rnd(-80, 80), y: y + rnd(-90, 30), scale: rnd(0.5, 1.3),
        autoAlpha: 0, duration: rnd(0.5, 0.85), ease: "power2.out",
        onComplete() { el.remove(); },
      });
    }
  }

  function flash(color, strength) {
    if (!motion) return;
    const layer = $("#fx");
    if (!layer) return;
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;inset:0;background:" + color;
    layer.appendChild(el);
    g.fromTo(el, { autoAlpha: strength || 0.5 }, { autoAlpha: 0, duration: 0.4, ease: "steps(4)", onComplete() { el.remove(); } });
  }

  // ---------- the attack ----------
  // One timeline: wind up, throw, impact, recoil. Resolves when it is done so app.js can
  // write the result line at the right moment. `from` throws at `to`; the same timeline
  // plays when the *partner* attacks you, with the roles swapped.
  const HEARTS = { 1: 4, 2: 6, 3: 9, 4: 3, 6: 14 };
  function attack(opts) {
    const from = opts.me, to = opts.foe, layer = opts.layer, level = opts.level;
    const world = opts.scene;
    if (!motion) { if (opts.onHit) opts.onHit(); return Promise.resolve(); }
    const quick = level === 4;
    const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
    const dir = tr.left + tr.width / 2 >= fr.left + fr.width / 2 ? 1 : -1; // which way "at them" is
    const big = level === 3 || level === 6;
    return new Promise((done) => {
      g.killTweensOf([from, to]);
      const tl = g.timeline({
        onComplete() {
          g.set([from, to], { clearProps: "all" });
          idle(from, { duration: 1.5 });
          idle(to, { duration: 1.9, delay: 0.3 });
          done();
        },
      });
      // wind up (lean back), then lunge at them as the hearts leave, then spring home
      tl.to(from, { scaleX: 1.2, scaleY: 0.82, x: -dir * 8, duration: quick ? 0.07 : 0.12 })
        .to(from, { scaleX: 0.92, scaleY: 1.12, y: -14, x: dir * (quick ? 14 : 26), duration: quick ? 0.1 : 0.15 })
        .add(() => hearts(layer, from, to, HEARTS[level] || 4, level))
        .to(from, { scaleX: 1, scaleY: 1, y: 0, x: 0, duration: quick ? 0.25 : 0.4, ease: "elastic.out(1, 0.5)" });
      tl.add(() => {
        if (opts.onHit) opts.onHit();
        if (level !== 4) {
          flash(level === 3 || level === 6 ? "#ff4f81" : "#ffffff", level === 3 || level === 6 ? 0.45 : 0.3);
          shake(world, level === 6 ? 14 : level === 3 ? 10 : 6);
        } else shake(world, 3);
        sparks(layer, to, level === 3 || level === 6 ? 10 : 5);
        // the target takes it: shoved back, squashed, wobbles upright again
        g.timeline()
          .to(to, { x: dir * (big ? 30 : quick ? 8 : 18), rotate: dir * (big ? 14 : 7), scaleX: 1.15, scaleY: 0.86, duration: 0.11 })
          .to(to, { x: 0, rotate: 0, scaleX: 1, scaleY: 1, duration: 0.6, ease: "elastic.out(1, 0.35)" });
        if (window.WORLD && !quick) window.WORLD.nudge(dir * (big ? 0.5 : 0.25), 0);
      }, quick ? 0.42 : 0.62);
      tl.to({}, { duration: quick ? 0.1 : 0.25 });
    });
  }

  // A little symbol that pops above a fighter and floats off: "!" for a shock, a heart for love.
  function emote(layer, el, kind) {
    if (!motion || !layer || !el) return;
    const L = layer.getBoundingClientRect(), a = el.getBoundingClientRect();
    const art = kind === "shock" ? S.icon("attention") : kind === "dizzy" ? S.sparkle("#ffe45c") : S.heart(kind === "giggle" ? "blush" : "pink", 9);
    const b = document.createElement("div");
    b.className = "fx-bit";
    b.style.width = kind === "shock" ? "14px" : "22px";
    b.innerHTML = art;
    layer.appendChild(b);
    const x = a.left - L.left + a.width * rnd(0.4, 0.6), y = a.top - L.top + a.height * 0.05;
    g.set(b, { x, y, xPercent: -50, yPercent: -100, scale: 0.3 });
    g.timeline({ onComplete() { b.remove(); } })
      .to(b, { scale: 1.2, y: y - 18, duration: 0.2, ease: "back.out(3)" })
      .to(b, { y: y - 46, autoAlpha: 0, duration: 0.7, ease: "power1.in" }, 0.5);
  }

  // A small hop, for idle glances and surprise.
  function hop(el, height) {
    if (!motion || !el) return;
    g.timeline()
      .to(el, { y: -(height || 12), scaleX: 0.95, scaleY: 1.07, duration: 0.14, ease: "power2.out" })
      .to(el, { y: 0, scaleX: 1.08, scaleY: 0.92, duration: 0.14, ease: "power2.in" })
      .to(el, { scaleX: 1, scaleY: 1, duration: 0.3, ease: "elastic.out(1, 0.4)" });
  }

  // ---------- love shower ----------
  // A canvas at a third of the screen size, scaled up with nearest-neighbour: a flood of
  // pixel hearts falling from the top. Used when you send one and, bigger, when one arrives.
  let heartSprites = null;
  function buildHearts() {
    const P = S._px, out = [];
    for (const tint of ["pink", "red", "blush", "sky", "gold"]) {
      const pal = P.HEART[tint];
      const colors = { b: pal.body, l: pal.light, s: pal.shade, e: pal.edge };
      for (const w of [7, 9, 13, 17]) {
        const grid = P.heartGrid(w);
        const c = document.createElement("canvas");
        c.width = grid.w; c.height = grid.h;
        const x = c.getContext("2d");
        for (let i = 0; i < grid.c.length; i++) {
          const k = grid.c[i];
          if (!k) continue;
          x.fillStyle = colors[k];
          x.fillRect(i % grid.w, (i / grid.w) | 0, 1, 1);
        }
        out.push(c);
      }
    }
    return out;
  }

  let rainRun = null;
  function shower(opts) {
    const o = opts || {};
    const cv = $("#rain");
    if (!cv) return Promise.resolve();
    if (rainRun) rainRun.stop();
    if (!heartSprites) heartSprites = buildHearts();
    const scale = 3;
    const W = Math.ceil(innerWidth / scale), H = Math.ceil(innerHeight / scale);
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const dur = (o.duration || 6) * 1000;
    const peak = o.peak || 120; // hearts per second at the height of the storm
    const list = [];
    let start = 0, prev = 0, carry = 0, stopped = false, raf = 0;

    return new Promise((done) => {
      const finish = () => {
        stopped = true; cancelAnimationFrame(raf);
        ctx.clearRect(0, 0, W, H);
        rainRun = null; done();
      };
      rainRun = { stop: finish };

      if (reduced) { // a still scatter instead of motion
        for (let i = 0; i < 70; i++) {
          const s = heartSprites[(Math.random() * heartSprites.length) | 0];
          ctx.drawImage(s, (Math.random() * W) | 0, (Math.random() * H) | 0);
        }
        setTimeout(finish, 2200);
        return;
      }

      const spawn = () => {
        const s = heartSprites[(Math.random() * heartSprites.length) | 0];
        list.push({ s, x: rnd(-4, W), y: -s.height - rnd(0, 30), vy: rnd(38, 110) * (1 + s.width / 40), sw: rnd(4, 14), ph: rnd(0, 6.28), sp: rnd(1, 2.4) });
      };
      const tick = (now) => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (!start) { start = prev = now; }
        const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
        const t = now - start;
        if (t < dur) {
          // ramp up fast, hold, then thin out so the last hearts drift away
          const k = t < 600 ? t / 600 : t > dur * 0.72 ? Math.max(0, 1 - (t - dur * 0.72) / (dur * 0.28)) : 1;
          carry += peak * k * dt;
          while (carry >= 1) { spawn(); carry -= 1; }
        } else if (!list.length) return finish();
        ctx.clearRect(0, 0, W, H);
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          p.y += p.vy * dt; p.ph += p.sp * dt;
          if (p.y > H + 4) { list.splice(i, 1); continue; }
          ctx.drawImage(p.s, Math.round(p.x + Math.sin(p.ph) * p.sw), Math.round(p.y));
        }
      };
      raf = requestAnimationFrame(tick);
    });
  }

  // ---------- full-screen pop-up (triple threat, incoming shower) ----------
  let burstDone = null;
  function closeBurst() {
    const el = $("#burst");
    if (!el || el.hidden) return;
    el.hidden = true; el.innerHTML = "";
    if (burstDone) { burstDone(); burstDone = null; }
  }
  function burst(opts) {
    const el = $("#burst");
    if (!el) return Promise.resolve();
    closeBurst();
    const icons = (opts.icons || []).map((n) => S.icon(n)).join("");
    el.innerHTML =
      `<div class="burst-rays"></div><div class="burst-card">` +
      (icons ? `<div class="burst-icons">${icons}</div>` : "") +
      `<h2 class="burst-title"></h2><p class="burst-sub"></p><p class="burst-tap">Tap to close</p></div>`;
    el.querySelector(".burst-title").textContent = opts.title || "";
    el.querySelector(".burst-sub").textContent = opts.sub || "";
    el.hidden = false;
    return new Promise((done) => {
      burstDone = done;
      const close = () => { clearTimeout(timer); closeBurst(); };
      const timer = setTimeout(close, opts.duration || 4200);
      el.onclick = close;
      if (!motion) return;
      const card = el.querySelector(".burst-card");
      g.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 });
      g.fromTo(card, { scale: 0.2, rotate: -6 }, { scale: 1, rotate: 0, duration: 0.7, ease: "elastic.out(1, 0.45)" });
      g.fromTo(el.querySelectorAll(".burst-icons .pix"), { y: 30, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.35, stagger: 0.12, delay: 0.2, ease: "back.out(3)" });
      flash("#fff0a8", 0.7);
      shake(card, 6);
    });
  }

  window.UI = {
    motion, gsap: g,
    showScreen, type, press, pop, shake, idle, emote, hop,
    setBar, flipMood, hearts, sparks, flash, attack, shower, burst, closeBurst,
  };
})();
