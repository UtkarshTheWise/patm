// Every animation in the app lives here, so app.js only ever says *what*
// happened and this file decides how it moves.
//
// GSAP is optional: if it failed to load (offline first run) or the person
// asked for reduced motion, every helper still lands on the same end state --
// it just gets there instantly. UI.motion says which mode we are in.
(function () {
  const g = window.gsap || null;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
  const motion = !!g && !reduced;
  if (g) g.defaults({ ease: "power2.out" });

  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- screens ----------
  function showScreen(id) {
    const next = document.getElementById(id);
    for (const s of document.querySelectorAll(".screen")) {
      if (s !== next && !s.hidden) s.hidden = true;
    }
    if (!next || !next.hidden) return next;
    next.hidden = false;
    if (!motion) return next;
    g.killTweensOf(next);
    g.fromTo(next, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.42, clearProps: "transform" });
    const rows = next.querySelectorAll(".stagger > *");
    if (rows.length) {
      g.fromTo(rows, { autoAlpha: 0, y: 14 },
        { autoAlpha: 1, y: 0, duration: 0.34, stagger: 0.055, delay: 0.06, clearProps: "transform,opacity,visibility" });
    }
    return next;
  }

  // ---------- Pokemon-style text reveal ----------
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
      }, o.speed || 22);
      typing.set(el, t);
    });
  }

  // ---------- small interactions ----------
  function press(el) {
    if (!motion || !el) return;
    g.killTweensOf(el);
    g.timeline()
      .to(el, { scale: 0.93, y: 3, duration: 0.08 })
      .to(el, { scale: 1, y: 0, duration: 0.34, ease: "elastic.out(1, 0.45)" });
  }

  function pop(el, opts) {
    if (!motion || !el) return;
    const o = opts || {};
    g.fromTo(el, { scale: o.from || 0.7 }, { scale: 1, duration: 0.5, ease: "back.out(2.4)" });
  }

  function shake(el, strength) {
    if (!motion || !el) return;
    const s = strength || 8;
    const tl = g.timeline();
    for (let i = 0; i < 6; i++) tl.to(el, { x: rnd(-s, s), y: rnd(-s / 2, s / 2), duration: 0.05 });
    tl.to(el, { x: 0, y: 0, duration: 0.12 });
  }

  // Looping idle bob, so the scene never sits perfectly still.
  function idle(el, opts) {
    if (!motion || !el) return;
    const o = opts || {};
    const dur = o.duration || 1.5;
    g.to(el, { y: o.rise || -7, duration: dur, delay: o.delay || 0, repeat: -1, yoyo: true, ease: "sine.inOut" });
    g.to(el, {
      scaleX: 1.035, scaleY: 0.965, duration: dur / 2,
      delay: (o.delay || 0) + 0.2, repeat: -1, yoyo: true, ease: "sine.inOut",
    });
  }

  function float(el, opts) {
    if (!motion || !el) return;
    const o = opts || {};
    g.to(el, { x: o.drift || 24, duration: o.duration || 9, repeat: -1, yoyo: true, ease: "sine.inOut", delay: o.delay || 0 });
  }

  // ---------- status bar ----------
  function setBar(fill, pct, opts) {
    if (!fill) return;
    const w = Math.max(0, Math.min(100, pct));
    fill.dataset.tier = w > 55 ? "high" : w > 22 ? "mid" : "low";
    if (!motion || (opts && opts.instant)) { fill.style.width = w + "%"; return; }
    g.to(fill, { width: w + "%", duration: 0.8, ease: "power2.inOut" });
  }

  // ---------- move cursor ----------
  function cursorTo(cursor, target) {
    if (!cursor || !target) return;
    const box = cursor.offsetParent || cursor.parentElement;
    if (!box) return;
    const b = box.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const x = t.left - b.left - cursor.offsetWidth - 2;
    const y = t.top - b.top + (t.height - cursor.offsetHeight) / 2;
    cursor.hidden = false;
    if (!motion) { cursor.style.transform = "translate(" + x + "px, " + y + "px)"; return; }
    g.to(cursor, { x: x, y: y, duration: 0.26, ease: "power3.out" });
    g.fromTo(cursor, { scale: 1.3 }, { scale: 1, duration: 0.3, ease: "back.out(3)" });
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

  // ---------- particles ----------
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
      el.innerHTML = window.SPRITES.note(level);
      layer.appendChild(el);
      const cx = (x0 + x1) / 2 + rnd(-40, 40);
      const cy = Math.min(y0, y1) - rnd(50, 110);
      const p = { t: 0 };
      const spin = rnd(-220, 220);
      g.to(p, {
        t: 1,
        duration: rnd(0.6, 0.9),
        delay: i * 0.075,
        ease: "power1.inOut",
        onUpdate() {
          const t = p.t, u = 1 - t;
          const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
          const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
          el.style.transform =
            "translate(" + x + "px, " + y + "px) translate(-50%, -50%) " +
            "scale(" + (0.55 + 0.75 * Math.sin(t * Math.PI)) + ") rotate(" + spin * t + "deg)";
        },
        onComplete() { el.remove(); },
      });
    }
  }

  function burst(layer, atEl, count) {
    if (!motion || !layer || !atEl) return;
    const L = layer.getBoundingClientRect();
    const a = atEl.getBoundingClientRect();
    const x = a.left - L.left + a.width / 2;
    const y = a.top - L.top + a.height / 2;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "fx-bit";
      el.innerHTML = window.SPRITES.sparkle();
      layer.appendChild(el);
      g.set(el, { x: x, y: y, xPercent: -50, yPercent: -50 });
      g.to(el, {
        x: x + rnd(-70, 70), y: y + rnd(-80, 30), scale: rnd(0.5, 1.2), rotate: rnd(-180, 180),
        autoAlpha: 0, duration: rnd(0.5, 0.85), ease: "power2.out",
        onComplete() { el.remove(); },
      });
    }
  }

  function flash(color, strength) {
    if (!motion) return;
    const el = document.getElementById("flash");
    if (!el) return;
    el.style.background = color;
    g.fromTo(el, { autoAlpha: strength || 0.55 }, { autoAlpha: 0, duration: 0.42, ease: "power2.out" });
  }

  // Ambient hearts drifting up behind the scene, started once at boot.
  function ambient(layer, count) {
    if (!motion || !layer) return;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "sky-heart";
      el.innerHTML = window.SPRITES.heart(i % 2 ? "#ffc2d6" : "#cdeefb");
      layer.appendChild(el);
      const restart = () => {
        const w = layer.clientWidth || 360;
        const h = layer.clientHeight || 520;
        g.set(el, { x: rnd(10, w - 10), y: h + 40, scale: rnd(0.4, 0.9), rotate: rnd(-25, 25), autoAlpha: rnd(0.35, 0.75) });
        g.to(el, {
          y: -60, x: "+=" + rnd(-50, 50), rotate: rnd(-120, 120),
          duration: rnd(11, 20), ease: "none", onComplete: restart,
        });
      };
      g.delayedCall(i * 1.6, restart);
    }
  }

  // ---------- the attack ----------
  // One timeline: lunge, throw, impact, recoil. Resolves when the hit lands,
  // so app.js can write the result line at the right moment.
  function attack(opts) {
    const me = opts.me, foe = opts.foe, layer = opts.layer, scene = opts.scene, level = opts.level;
    if (!motion) return Promise.resolve();
    return new Promise((done) => {
      // Both sprites are mid-idle-loop; park them so the hit reads cleanly.
      g.killTweensOf([me, foe]);
      const tl = g.timeline({
        onComplete() {
          g.set([me, foe], { clearProps: "all" });
          idle(me, { duration: 1.5 });
          idle(foe, { duration: 1.9, delay: 0.3, rise: -5 });
          done();
        },
      });
      tl.to(me, { scaleX: 1.22, scaleY: 0.82, y: 6, duration: 0.12 })
        .to(me, { scaleX: 0.92, scaleY: 1.12, y: -16, duration: 0.16, ease: "power2.out" })
        .add(() => hearts(layer, me, foe, level === 3 ? 9 : level === 2 ? 6 : 4, level))
        .to(me, { scaleX: 1, scaleY: 1, y: 0, duration: 0.45, ease: "elastic.out(1, 0.5)" })
        .add(() => {
          flash(level === 3 ? "#ef4061" : "#ffffff", level === 3 ? 0.6 : 0.4);
          shake(scene, level === 3 ? 12 : level === 2 ? 7 : 4);
          burst(layer, foe, level === 3 ? 10 : 6);
          g.fromTo(foe, { scale: 1 }, { scale: 1.16, duration: 0.16, yoyo: true, repeat: 1, ease: "power2.out" });
        }, 0.7)
        .to({}, { duration: 0.3 });
    });
  }

  window.UI = {
    motion: motion, gsap: g,
    showScreen, type, press, pop, shake, idle, float,
    setBar, cursorTo, flipMood, hearts, burst, flash, ambient, attack,
  };
})();
