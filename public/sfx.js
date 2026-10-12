// Sound effects: tiny synthesized blips, no audio files.
//
// Follows the music toggle (MUSIC.on) as its mute switch. The AudioContext is created on the
// first tap/key so iOS and Chrome let it start; before that, SFX.play() is a silent no-op.
(function () {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx = null, master = null, noiseBuf = null;
  const lastPlayed = {};

  function wake() {
    if (!Ctx) return;
    if (!ctx) {
      try {
        ctx = new Ctx();
        master = ctx.createGain();
        master.gain.value = 0.35;
        master.connect(ctx.destination);
      } catch { ctx = null; return; }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }
  // pointerdown/keydown are user gestures; keep listening so a suspended context gets resumed.
  document.addEventListener("pointerdown", wake, true);
  document.addEventListener("keydown", wake, true);

  // One oscillator with a fast attack and exponential release. `to` slides the pitch.
  function tone(freq, dur, o) {
    o = o || {};
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const vol = o.vol == null ? 0.2 : o.vol, atk = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, o) {
    o = o || {};
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = "lowpass"; f.frequency.value = o.freq || 2000;
    g.gain.setValueAtTime(o.vol == null ? 0.2 : o.vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // A run of notes: seq([f, f, ...], step, opts)
  const seq = (freqs, step, o) => freqs.forEach((f, i) => tone(f, step * 1.6, { ...o, delay: i * step }));

  const SOUNDS = {
    click: () => tone(1200, 0.03, { type: "square", vol: 0.15 }),
    attention: () => { tone(880, 0.06, { type: "square" }); tone(1175, 0.06, { type: "square", delay: 0.07 }); },
    thinking: () => seq([523, 659, 784], 0.09),
    missing: () => tone(660, 0.35, { type: "triangle", to: 440 }),
    mwah: () => { tone(1400, 0.12, { to: 300 }); noise(0.04, { freq: 3000 }); },
    hug: () => { tone(330, 0.4, { type: "triangle", attack: 0.08 }); tone(415, 0.4, { type: "triangle", attack: 0.08 }); },
    shower: () => { for (let i = 0; i < 8; i++) tone(1000 + Math.random() * 1000, 0.08, { vol: 0.12, delay: i * 0.04 }); },
    combo: () => {
      seq([523, 659, 784], 0.09, { type: "square", vol: 0.15 });
      tone(1046, 0.3, { type: "square", vol: 0.15, delay: 0.27 });
    },
    hit: () => { noise(0.12, { freq: 800 }); tone(120, 0.15, { to: 60 }); },
    pop: () => noise(0.05, { freq: 2500, vol: 0.15 }),
    incoming: () => { tone(988, 0.08); tone(1318, 0.08, { delay: 0.08 }); },
    fanfare: () => {
      seq([523, 659, 784], 0.09, { type: "square", vol: 0.15 });
      tone(1046, 0.4, { type: "square", vol: 0.12, delay: 0.27 });
      tone(784, 0.4, { type: "square", vol: 0.1, delay: 0.27 });
      tone(659, 0.4, { type: "square", vol: 0.1, delay: 0.27 });
    },
    flip: () => { tone(300, 0.125, { to: 700 }); tone(700, 0.125, { to: 350, delay: 0.125 }); },
    unlock: () => seq([523, 659, 784, 1046], 0.07),
    error: () => tone(160, 0.18, { type: "sawtooth", vol: 0.12 }),
    duelStart: () => { for (let i = 0; i < 4; i++) tone(i % 2 ? 880 : 660, 0.09, { type: "square", vol: 0.15, delay: i * 0.09 }); },
    count: () => tone(440, 0.09, { type: "square", vol: 0.15 }),
    go: () => tone(880, 0.3, { type: "square", vol: 0.18 }),
    time: () => tone(1200, 0.4, { type: "triangle", to: 400 }),
    win: () => seq([523, 659, 784, 1046], 0.1, { type: "square", vol: 0.15 }),
    lose: () => seq([392, 370, 349, 330], 0.2, { type: "triangle" }),
    draw: () => { tone(523, 0.12, { type: "square", vol: 0.15 }); tone(523, 0.12, { type: "square", vol: 0.15, delay: 0.18 }); },
    tap: (n) => tone(600 + Math.min(n || 0, 80) * 12, 0.035, { vol: 0.2 }),
  };

  function play(name, arg) {
    if (!ctx || document.hidden || (window.MUSIC && !window.MUSIC.on)) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    // The duel tap sound is meant to be rapid; everything else gets a 25ms floor against doubles.
    const t = performance.now();
    if (name !== "tap" && t - (lastPlayed[name] || 0) < 25) return;
    lastPlayed[name] = t;
    try { fn(arg); } catch {}
  }

  window.SFX = { play, get on() { return !!ctx && !(window.MUSIC && !window.MUSIC.on); } };
})();
