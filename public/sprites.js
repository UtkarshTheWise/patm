// All the 2D art in the app, drawn as inline SVG so it stays crisp at any size.
// Style rules: thick ink outlines, flat fills, no gradients — reads like a
// 2D game sprite sheet. Nothing here touches the DOM; everything returns markup.
(function () {
  const INK = "#43202e";

  // The reversible octopus mood toy. One skin per mood, same silhouette.
  const MOOD = {
    happy: { body: "#ff9ebb", shade: "#ef6f95", cheek: "#ff5e86", label: "HAPPY" },
    angry: { body: "#ef4061", shade: "#c01b3c", cheek: "#ffa0ae", label: "ANGRY" },
    sad:   { body: "#8ed2ea", shade: "#5aa8c8", cheek: "#b6e4f3", label: "SAD"   },
  };
  const ORDER = ["happy", "angry", "sad"];

  // Dome + five hanging tentacle scallops, closed into one silhouette.
  const BODY =
    "M16,60 C16,28 31,11 50,11 C69,11 84,28 84,60 " +
    "q-6.8,13 -13.6,0 q-6.8,13 -13.6,0 q-6.8,13 -13.6,0 q-6.8,13 -13.6,0 q-6.8,13 -13.6,0 Z";

  const SUCKERS = [23, 36.6, 50, 63.4, 77]
    .map((x) => `<circle cx="${x}" cy="66" r="1.7" fill="{shade}"/>`)
    .join("");

  // Eyes are shared; only brows, mouth and extras change per mood.
  const eye = (cx, cy, r) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 1.12}" fill="${INK}"/>` +
    `<circle cx="${cx + 1.5}" cy="${cy - 1.8}" r="${r * 0.36}" fill="#fff"/>`;

  const FACE = {
    happy:
      eye(38, 43, 4.4) + eye(62, 43, 4.4) +
      `<path d="M42,54 q8,9 16,0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      `<path d="M30,25 q4,-5 8,0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>`,
    angry:
      `<path d="M30,33 L44,39" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>` +
      `<path d="M70,33 L56,39" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>` +
      eye(38, 45, 4.2) + eye(62, 45, 4.2) +
      `<path d="M42,60 q8,-8 16,0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      // steam puffs
      `<g class="spr-steam" opacity=".8"><path d="M20,22 q5,-6 10,-1" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M72,20 q5,-6 10,-1" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/></g>`,
    sad:
      `<path d="M31,37 L44,33" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>` +
      `<path d="M69,37 L56,33" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>` +
      eye(38, 46, 5) + eye(62, 46, 5) +
      `<path d="M43,60 q4,-5 8,0 q4,5 8,0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      `<path class="spr-tear" d="M68,52 q3.4,6 0,8.6 q-3.4,-2.6 0,-8.6 Z" fill="#9fd9f0" stroke="${INK}" stroke-width="2"/>`,
  };

  // mood: happy | angry | sad. opts.flip mirrors it (used for the back-facing sprite).
  function octopus(mood, opts) {
    const o = opts || {};
    const key = MOOD[mood] ? mood : "happy";
    const m = MOOD[key];
    const fill = (s) => s.replace(/\{shade\}/g, m.shade);
    return (
      `<svg class="spr spr-octo spr-${key}" viewBox="0 0 100 100" role="img" aria-hidden="true"` +
      ` style="${o.flip ? "transform:scaleX(-1)" : ""}">` +
        `<g class="spr-body">` +
          `<path d="${BODY}" fill="${m.body}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
          `<ellipse cx="50" cy="47" rx="25" ry="21" fill="#fff" opacity=".28"/>` +
          `<ellipse cx="36" cy="27" rx="9" ry="6" fill="#fff" opacity=".45" transform="rotate(-24 36 27)"/>` +
          fill(SUCKERS) +
          `<ellipse cx="27" cy="52" rx="6.2" ry="4" fill="${m.cheek}" opacity=".75"/>` +
          `<ellipse cx="73" cy="52" rx="6.2" ry="4" fill="${m.cheek}" opacity=".75"/>` +
          FACE[key] +
        `</g>` +
      `</svg>`
    );
  }

  const heart = (c) =>
    `<svg class="spr spr-heart" viewBox="0 0 32 30" aria-hidden="true">` +
      `<path d="M16,29 C4,20 1,13 1,9 A8,8 0 0 1 16,6 A8,8 0 0 1 31,9 C31,13 28,20 16,29 Z"` +
      ` fill="${c || "#ff5e86"}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<ellipse cx="10" cy="11" rx="3" ry="2.2" fill="#fff" opacity=".65" transform="rotate(-30 10 11)"/>` +
    `</svg>`;

  const cloud = () =>
    `<svg class="spr spr-cloud" viewBox="0 0 120 50" aria-hidden="true">` +
      `<path d="M14,44 a14,14 0 0 1 2,-27 a19,19 0 0 1 35,-7 a16,16 0 0 1 28,6 a14,14 0 0 1 27,10` +
      ` a10,10 0 0 1 -8,18 Z" fill="#ffffff" stroke="#e9b9c9" stroke-width="3" stroke-linejoin="round"/>` +
    `</svg>`;

  const sparkle = (c) =>
    `<svg class="spr spr-sparkle" viewBox="0 0 24 24" aria-hidden="true">` +
      `<path d="M12,0 L14.6,9.4 L24,12 L14.6,14.6 L12,24 L9.4,14.6 L0,12 L9.4,9.4 Z"` +
      ` fill="${c || "#fff2a8"}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `</svg>`;

  // The "throw a heart" projectile used by the attack animation.
  const note = (level) => heart(level === 3 ? "#ef4061" : level === 2 ? "#9fd9f0" : "#ff9ebb");

  window.SPRITES = { octopus, heart, cloud, sparkle, note, MOOD, MOODS: ORDER, INK };
})();
