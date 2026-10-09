// Dev helper: rasterise the sprites into one PNG so the art can be checked by eye.
//   node tools/preview-sprites.js <out.png>
const path = require("path");
const { Canvas } = require("./png");
const S = require("../public/sprites.js");
const P = S._px;

const out = process.argv[2] || "preview.png";
const c = new Canvas(345, 110);
c.rect(0, 0, c.w, c.h, "#3d5ab5");
let x = 2;
for (const mood of ["happy", "angry", "sad"]) {
  const pal = S.octoPalette(mood);
  c.blit(S.octopusGrid(mood, { look: 1 }), pal, x, 2); x += 42;
  c.blit(S.octopusGrid(mood, { look: -1, frame: 1 }), pal, x, 2); x += 42;
}
c.blit(S.octopusGrid("happy", { expr: "mwah", look: 1 }), S.octoPalette("happy"), 2, 36);
c.blit(S.octopusGrid("happy", { expr: "hit" }), S.octoPalette("happy"), 40, 36);
c.blit(S.octopusGrid("angry", { raise: true, look: -1 }), S.octoPalette("angry"), 84, 36);
let ix = 130;
for (const t of Object.keys(P.HEART)) { const h = P.HEART[t]; c.blit(P.heartGrid(13), { b: h.body, l: h.light, s: h.shade, e: h.edge }, ix, 40); ix += 17; }
ix = 130;
for (const n of ["attention", "thinking", "mwah"]) { c.blit(P.ICONS[n], P.ICON_PAL, ix, 62); ix += 18; }
c.blit(P.jellyGrid(0), { b: "#ffc4e4", l: "#fff0f8", s: "#f59ccf", t: "#ffa9d8" }, 222, 36);
c.blit(P.fishGrid(1), { b: "#ffd18a", s: "#f39f6a", t: "#ffb86b", k: "#1b1030" }, 245, 40);
c.blit(P.kelpGrid(40, 0), { b: "#2fa28c", s: "#1c7667", l: "#6fe0b8" }, 266, 36);
c.scaled(3).save(out);
console.log("wrote", path.resolve(out));
