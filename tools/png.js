// Minimal PNG writer (RGBA, 8-bit) so the art scripts need no dependencies.
const zlib = require("zlib");
const fs = require("fs");

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// A tiny RGBA canvas with the few drawing ops the pixel art needs.
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  static hex(c) {
    if (Array.isArray(c)) return c.length === 3 ? [c[0], c[1], c[2], 255] : c;
    const m = c.replace("#", "");
    const n = m.length === 3 ? [...m].map((x) => parseInt(x + x, 16)) : [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
    return [n[0], n[1], n[2], m.length === 8 ? parseInt(m.slice(6, 8), 16) : 255];
  }
  set(x, y, c, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    const [r, g, b, a0] = Canvas.hex(c);
    const i = (y * this.w + x) * 4;
    const al = (a == null ? a0 : a) / 255;
    if (al >= 1) { this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255; return; }
    const da = this.d[i + 3] / 255, oa = al + da * (1 - al);
    for (const [j, v] of [[0, r], [1, g], [2, b]]) this.d[i + j] = (v * al + this.d[i + j] * da * (1 - al)) / (oa || 1);
    this.d[i + 3] = oa * 255;
  }
  get(x, y) { const i = (y * this.w + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  // draw a sprite grid ({w,h,c}) with a {key: colour} palette
  blit(g, pal, ox, oy, flip) {
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const k = g.c[y * g.w + x];
      if (k) this.set(ox + (flip ? g.w - 1 - x : x), oy + y, pal[k]);
    }
  }
  // nearest-neighbour scale into a new canvas
  scaled(n) {
    const o = new Canvas(this.w * n, this.h * n);
    for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
      const i = ((y / n | 0) * this.w + (x / n | 0)) * 4, j = (y * o.w + x) * 4;
      o.d[j] = this.d[i]; o.d[j + 1] = this.d[i + 1]; o.d[j + 2] = this.d[i + 2]; o.d[j + 3] = this.d[i + 3];
    }
    return o;
  }
  png() {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      Buffer.from(this.d.buffer, y * this.w * 4, this.w * 4).copy(raw, y * (this.w * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
    ]);
  }
  save(file) { fs.writeFileSync(file, this.png()); }
}
module.exports = { Canvas };

// Reads back PNGs written by Canvas.png() (filter 0 only) so previews can be composed.
Canvas.load = (file) => {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString("ascii", p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const c = new Canvas(w, h);
  for (let y = 0; y < h; y++) raw.copy(Buffer.from(c.d.buffer), y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  return c;
};
