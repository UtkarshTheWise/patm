// Background music: one looping audio file.
//
// Browsers only let audio start from a tap, so "on" is the saved preference and
// the track actually begins on the first touch anywhere on the page.
(function () {
  const KEY = "patm-music";
  const SRC = "/audio/bgm.mp3";
  const VOLUME = 0.5;

  const audio = new Audio();
  audio.loop = true;
  audio.volume = VOLUME;
  audio.preload = "none"; // don't spend data on it until it is actually wanted

  let started = false; // has a tap let us play yet?
  let on = true;
  try { on = localStorage.getItem(KEY) !== "off"; } catch {}

  function play() {
    if (!audio.src) audio.src = SRC;
    started = true;
    // Rejects if the browser still wants a tap, or the file is missing.
    const p = audio.play();
    if (p) p.catch(() => { started = false; });
  }

  function toggle() {
    // Saved as on but not started yet (no tap so far): this tap is the start.
    if (on && !started) { play(); return on; }
    on = !on;
    try { localStorage.setItem(KEY, on ? "on" : "off"); } catch {}
    if (on) play(); else audio.pause();
    return on;
  }

  function unlock(e) {
    if (e.target.closest && e.target.closest(".music-toggle")) return; // its own click handles it
    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);
    if (on && !started) play();
  }
  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);

  // Don't keep playing from a pocket or a background tab.
  document.addEventListener("visibilitychange", () => {
    if (!started || !on) return;
    if (document.hidden) audio.pause(); else play();
  });

  window.MUSIC = {
    supported: true,
    get on() { return on; },
    toggle,
  };
})();
