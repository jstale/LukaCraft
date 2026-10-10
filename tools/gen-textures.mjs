// Procedural texture generator. Writes 16x16 PNG textures for every block and item
// into ./textures, plus a scaled-up preview sheet (textures/preview.png).
// Run: node tools/gen-textures.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'textures');

// ---------------------------------------------------------------- PNG encoding
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(img) {
  const { w, h, d } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(d.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- helpers
class Img {
  constructor(w = 16, h = 16) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h * 4);
  }
  set(x, y, c, a = 255) {
    x = ((x % this.w) + this.w) % this.w;
    y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    this.d[i] = clamp(c[0]);
    this.d[i + 1] = clamp(c[1]);
    this.d[i + 2] = clamp(c[2]);
    this.d[i + 3] = c.length > 3 ? clamp(c[3]) : a;
  }
  get(x, y) {
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  alpha(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[(y * this.w + x) * 4 + 3];
  }
  clone() {
    const o = new Img(this.w, this.h);
    o.d.set(this.d);
    return o;
  }
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed) {
  let a = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Tileable value noise over a w x w image using a `cells` x `cells` lattice.
function valueNoise(r, w, cells) {
  const g = Array.from({ length: cells * cells }, () => r());
  const s = w / cells;
  const at = (i, j) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / s, gy = y / s;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = sm(gx - x0), fy = sm(gy - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}
function each(img, fn) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) fn(x, y);
}

// ---------------------------------------------------------------- block textures
function dirt(r = rng('dirt')) {
  const img = new Img();
  const base = [134, 96, 67];
  each(img, (x, y) => {
    const v = r();
    let f = 0.92 + r() * 0.14;
    if (v < 0.14) f = 0.72;
    else if (v > 0.92) f = 1.16;
    img.set(x, y, mul(base, f));
  });
  // a few pebbles
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    const c = r() < 0.5 ? [150, 140, 125] : [95, 68, 48];
    img.set(x, y, c);
    img.set(x + 1, y, mul(c, 0.9));
  }
  return img;
}

function grassColor(r) {
  const base = [92, 156, 54];
  const v = r();
  if (v < 0.15) return mul(base, 0.78);
  if (v > 0.88) return mix(base, [140, 200, 80], 0.6);
  return mul(base, 0.9 + r() * 0.15);
}
function grassTop() {
  const r = rng('grass_top');
  const img = new Img();
  const n = valueNoise(r, 16, 4);
  each(img, (x, y) => img.set(x, y, mul(grassColor(r), 0.88 + n(x, y) * 0.22)));
  return img;
}
function grassSide() {
  const r = rng('grass_side');
  const img = dirt(rng('dirt'));
  for (let x = 0; x < 16; x++) {
    const depth = 3 + (r() < 0.55 ? 1 : 0) + (r() < 0.25 ? 1 : 0);
    for (let y = 0; y < depth; y++) img.set(x, y, grassColor(r));
    img.set(x, depth, mul(grassColor(r), 0.7)); // shadow edge
  }
  return img;
}

function stone(r = rng('stone')) {
  const img = new Img();
  const n = valueNoise(r, 16, 4);
  const n2 = valueNoise(r, 16, 8);
  const base = [125, 125, 125];
  each(img, (x, y) => {
    let f = 0.86 + n(x, y) * 0.16 + n2(x, y) * 0.08 + (r() - 0.5) * 0.08;
    img.set(x, y, mul(base, f));
  });
  // dark streaks
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    const len = 2 + Math.floor(r() * 3);
    for (let k = 0; k < len; k++) img.set(x + k, y, mul(base, 0.74 + r() * 0.06));
  }
  // light specks
  for (let i = 0; i < 6; i++) img.set(Math.floor(r() * 16), Math.floor(r() * 16), mul(base, 1.18));
  return img;
}

function cobblestone() {
  const r = rng('cobble');
  const img = new Img();
  const pts = [];
  for (let gy = 0; gy < 3; gy++)
    for (let gx = 0; gx < 3; gx++)
      pts.push({ x: (gx + 0.2 + r() * 0.6) * (16 / 3), y: (gy + 0.2 + r() * 0.6) * (16 / 3), shade: 0.82 + r() * 0.35 });
  const base = [122, 122, 122];
  each(img, (x, y) => {
    let d1 = 1e9, d2 = 1e9, best = null;
    for (const p of pts)
      for (let oy = -16; oy <= 16; oy += 16)
        for (let ox = -16; ox <= 16; ox += 16) {
          const dx = x + 0.5 - (p.x + ox), dy = y + 0.5 - (p.y + oy);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; best = { p, dx, dy }; }
          else if (d < d2) d2 = d;
        }
    if (d2 - d1 < 1.1) {
      img.set(x, y, mul(base, 0.52 + r() * 0.08));
    } else {
      // bevel: light toward top-left of each stone
      const bevel = (-best.dx - best.dy) * 0.025;
      img.set(x, y, mul(base, best.p.shade + bevel + (r() - 0.5) * 0.1));
    }
  });
  return img;
}

function sand() {
  const r = rng('sand');
  const img = new Img();
  const base = [219, 207, 163];
  each(img, (x, y) => {
    const v = r();
    let c = mul(base, 0.95 + r() * 0.08);
    if (v < 0.12) c = [200, 186, 140];
    else if (v > 0.95) c = [236, 228, 196];
    img.set(x, y, c);
  });
  return img;
}

function snow() {
  const r = rng('snow');
  const img = new Img();
  each(img, (x, y) => {
    const v = r();
    let c = [242, 248, 252];
    if (v < 0.15) c = [220, 232, 240];
    else if (v > 0.93) c = [255, 255, 255];
    img.set(x, y, c);
  });
  return img;
}

function water() {
  const r = rng('water');
  const img = new Img();
  const n = valueNoise(r, 16, 4);
  const base = [48, 98, 206];
  each(img, (x, y) => {
    const w = Math.sin(((x + y * 0.5 + n(x, y) * 6) / 16) * Math.PI * 4);
    let c = mul(base, 0.92 + n(x, y) * 0.12);
    if (w > 0.82) c = mix(c, [130, 175, 245], 0.6);
    img.set(x, y, c, 185);
  });
  return img;
}

function logSide(name, base, crack, birch = false) {
  const r = rng(name);
  const img = new Img();
  const col = Array.from({ length: 16 }, () => 0.82 + r() * 0.26);
  each(img, (x, y) => {
    const f = (col[x] * 2 + col[(x + 1) % 16]) / 3;
    img.set(x, y, mul(base, f + (r() - 0.5) * 0.06));
  });
  if (birch) {
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      const len = 2 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) img.set(x + k, y, mix(crack, [90, 90, 85], r() * 0.5));
    }
  } else {
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
      const len = 2 + Math.floor(r() * 5);
      for (let k = 0; k < len; k++) img.set(x, y + k, crack);
    }
  }
  return img;
}
function logTop(name, inner, ringDark, bark) {
  const r = rng(name);
  const img = new Img();
  each(img, (x, y) => {
    const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
    const d = Math.max(dx, dy) * 0.7 + Math.sqrt(dx * dx + dy * dy) * 0.3;
    if (x === 0 || y === 0 || x === 15 || y === 15) img.set(x, y, mul(bark, 0.9 + r() * 0.2));
    else {
      const ring = Math.floor(d) % 2 === 0;
      img.set(x, y, mul(ring ? ringDark : inner, 0.95 + r() * 0.08));
    }
  });
  return img;
}

function leaves(name, base) {
  const r = rng(name);
  const img = new Img();
  const n = valueNoise(r, 16, 4);
  each(img, (x, y) => {
    const v = r();
    if (v < 0.16) {
      img.set(x, y, [0, 0, 0], 0);
      return;
    }
    let f = 0.75 + n(x, y) * 0.3 + (r() - 0.5) * 0.15;
    if (v > 0.9) f += 0.2;
    img.set(x, y, mul(base, f));
  });
  return img;
}

function planks(r = rng('planks')) {
  const img = new Img();
  const base = [182, 146, 94];
  for (let b = 0; b < 4; b++) {
    const seam = (b * 7 + 3) % 16;
    const boardShade = 0.92 + r() * 0.12;
    for (let yy = 0; yy < 4; yy++) {
      const y = b * 4 + yy;
      const rowShade = 0.96 + r() * 0.07;
      for (let x = 0; x < 16; x++) {
        let c = mul(base, boardShade * rowShade + (r() - 0.5) * 0.05);
        if (yy === 3) c = mul(base, 0.6);
        else if (x === seam) c = mul(base, 0.68);
        else if (yy === 0) c = mul(c, 1.06);
        img.set(x, y, c);
      }
    }
  }
  return img;
}

function craftingTop() {
  const img = planks(rng('ct_top'));
  const frame = [104, 74, 40];
  each(img, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) img.set(x, y, frame);
    else if (x === 1 || y === 1 || x === 14 || y === 14) img.set(x, y, [150, 112, 64]);
    else if (x === 5 || x === 10 || y === 5 || y === 10) img.set(x, y, [120, 88, 50]);
  });
  return img;
}
function craftingSide() {
  const img = planks(rng('ct_side'));
  const frame = [104, 74, 40];
  each(img, (x, y) => {
    if (y <= 2) img.set(x, y, y === 2 ? frame : [150, 112, 64]);
    if (x === 0 || x === 15) img.set(x, y, frame);
  });
  // saw blade (left) and hammer (right)
  for (let y = 4; y < 13; y++) {
    img.set(3, y, [170, 170, 170]);
    img.set(4, y, [200, 200, 200]);
    if (y % 2 === 0) img.set(5, y, [120, 120, 120]);
  }
  img.set(3, 3, [90, 60, 30]); img.set(4, 3, [90, 60, 30]);
  for (let x = 9; x < 14; x++) { img.set(x, 5, [120, 120, 120]); img.set(x, 6, [160, 160, 160]); }
  for (let y = 7; y < 13; y++) img.set(11, y, [110, 78, 40]);
  return img;
}

function glass() {
  const r = rng('glass');
  const img = new Img();
  const edge = [215, 238, 245];
  each(img, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) img.set(x, y, mul(edge, 0.9 + r() * 0.1));
    else img.set(x, y, [200, 230, 240], 0);
  });
  // highlight streaks
  for (const [sx, sy, len] of [[3, 4, 3], [4, 3, 1], [10, 9, 4], [11, 8, 1]])
    for (let k = 0; k < len; k++) img.set(sx + k, sy + k, [240, 250, 255], 200);
  return img;
}

function stoneBricks() {
  const r = rng('stone_bricks');
  const img = new Img();
  const base = [124, 124, 124];
  each(img, (x, y) => {
    const row = Math.floor(y / 8);
    const yy = y % 8;
    const xs = row === 0 ? x : (x + 8) % 16;
    let f = 0.93 + r() * 0.1;
    if (yy === 7 || xs === 15) f = 0.55;
    else if (yy === 0 || xs === 0) f = 1.12;
    else if (yy === 6 || xs === 14) f = 0.8;
    img.set(x, y, mul(base, f));
  });
  return img;
}

function ore(name, colors) {
  const r = rng(name);
  const img = stone(rng('stone'));
  const blobs = 5 + Math.floor(r() * 2);
  const used = new Set();
  for (let i = 0; i < blobs; i++) {
    const cx = 2 + Math.floor(r() * 12), cy = 2 + Math.floor(r() * 12);
    const size = 5 + Math.floor(r() * 3);
    let x = cx, y = cy;
    for (let k = 0; k < size; k++) {
      const key = x + ',' + y;
      if (!used.has(key)) {
        used.add(key);
        const c = colors[Math.floor(r() * colors.length)];
        img.set(x, y, c);
        // dark rim below/right for depth
        if (!used.has(x + 1 + ',' + (y + 1))) img.set(x + 1, y + 1, mul(img.get((x + 1) & 15, (y + 1) & 15), 0.75));
      }
      if (r() < 0.5) x += r() < 0.5 ? 1 : -1;
      else y += r() < 0.5 ? 1 : -1;
      x = Math.max(1, Math.min(14, x));
      y = Math.max(1, Math.min(14, y));
    }
  }
  return img;
}

function bedrock() {
  const r = rng('bedrock');
  const img = new Img();
  const palette = [[30, 30, 30], [60, 60, 60], [95, 95, 95], [130, 130, 130]];
  const cells = Array.from({ length: 64 }, () => palette[Math.floor(r() * palette.length)]);
  each(img, (x, y) => {
    const jx = (x + (r() < 0.2 ? 1 : 0)) & 15;
    img.set(x, y, mul(cells[(y >> 1) * 8 + (jx >> 1)], 0.95 + r() * 0.1));
  });
  return img;
}

function cactusSide() {
  const r = rng('cactus_side');
  const img = new Img();
  const base = [84, 140, 46];
  each(img, (x, y) => {
    let f = 0.92 + r() * 0.1;
    if (x === 0 || x === 15) f = 0.6;
    else if (x === 1 || x === 14) f = 0.8;
    else if (x % 4 === 3) f = 0.78;
    img.set(x, y, mul(base, f));
  });
  for (let i = 0; i < 8; i++) {
    const x = 2 + Math.floor(r() * 12), y = Math.floor(r() * 16);
    img.set(x, y, [235, 225, 170]);
  }
  return img;
}
function cactusTop() {
  const r = rng('cactus_top');
  const img = new Img();
  const base = [110, 165, 62];
  each(img, (x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    let f = 0.95 + r() * 0.08;
    if (d > 7) f = 0.6;
    else if (Math.floor(d) === 4) f = 0.8;
    img.set(x, y, mul(base, f));
  });
  img.set(7, 7, [200, 210, 120]); img.set(8, 8, [200, 210, 120]);
  return img;
}

function gravel() {
  const r = rng('gravel');
  const img = new Img();
  const palette = [[130, 124, 122], [100, 96, 96], [160, 150, 146], [80, 76, 76], [120, 110, 105]];
  each(img, (x, y) => img.set(x, y, palette[Math.floor(r() * palette.length)]));
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
    const c = palette[Math.floor(r() * palette.length)];
    img.set(x, y, c); img.set(x + 1, y, c); img.set(x, y + 1, mul(c, 0.85)); img.set(x + 1, y + 1, mul(c, 0.75));
  }
  return img;
}

// ---------------------------------------------------------------- items
const OUTLINE = [36, 26, 14];
function outline(img, color) {
  const src = img.clone();
  each(img, (x, y) => {
    if (src.alpha(x, y) > 0) return;
    if (src.alpha(x - 1, y) || src.alpha(x + 1, y) || src.alpha(x, y - 1) || src.alpha(x, y + 1)) img.set(x, y, color);
  });
  return img;
}
// Coordinates along the tool handle: a = distance along the bottom-left -> top-right diagonal,
// b = signed distance perpendicular to it (negative = up-left side).
const along = (x, y) => (x + 0.5 + (15.5 - y)) / Math.SQRT2;
const perp = (x, y) => (x + 0.5 - (15.5 - y)) / Math.SQRT2;
const HANDLE = { main: [137, 103, 39], dark: [96, 70, 27], light: [170, 132, 60] };

function drawHandle(img, aMin, aMax) {
  each(img, (x, y) => {
    const a = along(x, y), b = perp(x, y);
    if (a >= aMin && a <= aMax && Math.abs(b) < 0.75) img.set(x, y, b < 0 ? HANDLE.light : HANDLE.main);
  });
}
const MATERIALS = {
  wood: { main: [158, 122, 70], light: [196, 160, 104], dark: [108, 80, 42] },
  stone: { main: [128, 128, 128], light: [168, 168, 168], dark: [84, 84, 84] },
  copper: { main: [214, 118, 66], light: [244, 168, 120], dark: [148, 72, 38] },
  iron: { main: [210, 210, 210], light: [250, 250, 250], dark: [140, 140, 140] },
  gold: { main: [246, 212, 52], light: [255, 248, 150], dark: [196, 140, 24] },
};
function headColor(m, shade) {
  return shade > 0.5 ? m.light : shade < -0.5 ? m.dark : m.main;
}
function pickaxe(mat) {
  const m = MATERIALS[mat];
  const img = new Img();
  drawHandle(img, 2.2, 17);
  // head: an arc around a centre far down-left
  const cx = 0.5, cy = 16.5;
  each(img, (x, y) => {
    const dx = x + 0.5 - cx, dy = cy - (y + 0.5);
    const rr = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dy, dx); // 0 = right, PI/2 = up
    if (rr > 13.2 && rr < 15.6 && ang > 0.2 && ang < 1.37) {
      const shade = rr > 14.9 ? 1 : rr < 13.9 ? -1 : 0;
      img.set(x, y, headColor(m, shade));
    }
  });
  return outline(img, mul(m.dark, 0.45));
}
function axe(mat) {
  const m = MATERIALS[mat];
  const img = new Img();
  drawHandle(img, 2.2, 17.5);
  each(img, (x, y) => {
    const a = along(x, y), b = perp(x, y);
    // half-moon blade on the up-left side of the handle
    const da = (a - 15.2) * 0.8, db = b + 0.2;
    const d = Math.sqrt(da * da + db * db);
    if (b < -0.4 && d < 5.4) {
      const shade = d > 4.3 ? 1 : d < 2.2 ? -1 : 0;
      img.set(x, y, headColor(m, shade));
    }
    // small back nub on the other side
    if (a > 14.2 && a < 16.6 && b >= -0.4 && b < 1.6) img.set(x, y, m.dark);
  });
  return outline(img, mul(m.dark, 0.45));
}
function shovel(mat) {
  const m = MATERIALS[mat];
  const img = new Img();
  drawHandle(img, 2.2, 14);
  each(img, (x, y) => {
    const a = along(x, y), b = perp(x, y);
    const width = a > 19.2 ? 2.4 - (a - 19.2) * 1.6 : 2.4;
    if (a > 13.6 && a < 20.6 && Math.abs(b) < width) {
      const shade = b < -1.2 ? 1 : b > 1.2 ? -1 : 0;
      img.set(x, y, headColor(m, shade));
    }
  });
  return outline(img, mul(m.dark, 0.45));
}
function stick() {
  const img = new Img();
  drawHandle(img, 4, 18);
  return outline(img, OUTLINE);
}
function lump(name, colors, spots) {
  const r = rng(name);
  const img = new Img();
  const n = valueNoise(r, 16, 4);
  each(img, (x, y) => {
    const dx = x - 7.5, dy = (y - 8) * 1.15;
    const d = Math.sqrt(dx * dx + dy * dy) + (n(x, y) - 0.5) * 2.5;
    if (d < 5.6) {
      const light = (-dx - dy) / 8; // light from top-left
      let c = light > 0.35 ? colors[2] : light < -0.3 ? colors[0] : colors[1];
      if (spots && r() < 0.18) c = spots[Math.floor(r() * spots.length)];
      img.set(x, y, mul(c, 0.94 + r() * 0.1));
    }
  });
  return outline(img, mul(colors[0], 0.45));
}
function ingot(mat) {
  const m = MATERIALS[mat];
  const img = new Img();
  // isometric bar: top face (light), front face (main), right side (dark)
  for (let y = 5; y <= 11; y++)
    for (let x = 1; x <= 14; x++) {
      const t = y - 5;
      const left = 4 - Math.min(t, 3);
      if (x < left + 1 || x > 14 - Math.max(0, t - 3)) continue;
      if (t < 3) img.set(x, y, x > 12 - t ? m.dark : m.light);
      else img.set(x, y, t === 3 ? m.light : x > 12 ? m.dark : m.main);
    }
  return outline(img, mul(m.dark, 0.45));
}

// ---------------------------------------------------------------- misc
function destroyStages(count = 8) {
  const r = rng('destroy');
  // ordered list of crack pixels from random walks starting near the centre
  const order = [];
  const seen = new Set();
  for (let walk = 0; walk < 7; walk++) {
    let x = 6 + Math.floor(r() * 4), y = 6 + Math.floor(r() * 4);
    const dir = r() * Math.PI * 2;
    for (let step = 0; step < 14; step++) {
      const key = x + ',' + y;
      if (!seen.has(key) && x >= 0 && y >= 0 && x < 16 && y < 16) {
        seen.add(key);
        order.push([x, y, step]);
      }
      const a = dir + (r() - 0.5) * 1.6;
      x += Math.round(Math.cos(a));
      y += Math.round(Math.sin(a));
    }
  }
  order.sort((p, q) => p[2] - q[2]);
  const stages = [];
  for (let s = 0; s < count; s++) {
    const img = new Img();
    const n = Math.ceil(((s + 1) / count) * order.length);
    for (let i = 0; i < n; i++) img.set(order[i][0], order[i][1], [20, 20, 20], 200);
    stages.push(img);
  }
  return stages;
}
function clouds() {
  const r = rng('clouds');
  const img = new Img(64, 64);
  const n1 = valueNoise(r, 64, 8);
  const n2 = valueNoise(r, 64, 16);
  each(img, (x, y) => {
    const v = n1(x, y) * 0.75 + n2(x, y) * 0.25;
    if (v > 0.6) img.set(x, y, [255, 255, 255], 230);
    else img.set(x, y, [255, 255, 255], 0);
  });
  return img;
}

// ---------------------------------------------------------------- registry
const blocks = {
  grass_top: grassTop(),
  grass_side: grassSide(),
  dirt: dirt(),
  stone: stone(),
  cobblestone: cobblestone(),
  sand: sand(),
  gravel: gravel(),
  snow: snow(),
  water: water(),
  oak_log: logSide('oak_log', [104, 82, 50], [62, 48, 28]),
  oak_log_top: logTop('oak_log_top', [182, 148, 95], [158, 126, 78], [104, 82, 50]),
  oak_leaves: leaves('oak_leaves', [62, 134, 40]),
  birch_log: logSide('birch_log', [216, 215, 208], [45, 45, 40], true),
  birch_log_top: logTop('birch_log_top', [206, 186, 132], [184, 164, 112], [216, 215, 208]),
  birch_leaves: leaves('birch_leaves', [108, 164, 66]),
  planks: planks(),
  crafting_table_top: craftingTop(),
  crafting_table_side: craftingSide(),
  glass: glass(),
  stone_bricks: stoneBricks(),
  coal_ore: ore('coal_ore', [[38, 38, 38], [56, 56, 56], [24, 24, 24]]),
  copper_ore: ore('copper_ore', [[224, 120, 62], [240, 160, 110], [88, 170, 140], [190, 96, 50]]),
  iron_ore: ore('iron_ore', [[216, 175, 147], [236, 206, 184], [186, 140, 112]]),
  gold_ore: ore('gold_ore', [[252, 236, 76], [255, 252, 170], [214, 160, 32]]),
  bedrock: bedrock(),
  cactus_side: cactusSide(),
  cactus_top: cactusTop(),
};
const items = {
  stick: stick(),
  coal: lump('coal', [[28, 28, 28], [52, 52, 52], [84, 84, 84]]),
  raw_copper: lump('raw_copper', [[150, 72, 38], [214, 118, 66], [244, 168, 120]], [[88, 170, 140]]),
  raw_iron: lump('raw_iron', [[150, 116, 92], [208, 168, 140], [236, 206, 184]]),
  raw_gold: lump('raw_gold', [[196, 140, 24], [246, 212, 52], [255, 248, 150]]),
  copper_ingot: ingot('copper'),
  iron_ingot: ingot('iron'),
  gold_ingot: ingot('gold'),
};
for (const mat of Object.keys(MATERIALS)) {
  items[`${mat}_pickaxe`] = pickaxe(mat);
  items[`${mat}_axe`] = axe(mat);
  items[`${mat}_shovel`] = shovel(mat);
}
const misc = { clouds: clouds() };
destroyStages().forEach((img, i) => (misc[`destroy_${i}`] = img));

function writeAll(dir, map) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, img] of Object.entries(map)) fs.writeFileSync(path.join(dir, `${name}.png`), encodePNG(img));
}
writeAll(path.join(OUT, 'blocks'), blocks);
writeAll(path.join(OUT, 'items'), items);
writeAll(path.join(OUT, 'misc'), misc);

// preview sheet: every 16x16 texture scaled 4x on a checkerboard, 10 per row
const all = [...Object.values(blocks), ...Object.values(items), ...Object.entries(misc).filter(([k]) => k !== 'clouds').map(([, v]) => v)];
const S = 4, PAD = 4, COLS = 10, CELL = 16 * S + PAD;
const sheet = new Img(COLS * CELL + PAD, Math.ceil(all.length / COLS) * CELL + PAD);
each(sheet, (x, y) => sheet.set(x, y, ((x >> 3) + (y >> 3)) & 1 ? [90, 90, 100] : [120, 120, 130]));
all.forEach((img, i) => {
  const ox = PAD + (i % COLS) * CELL, oy = PAD + Math.floor(i / COLS) * CELL;
  for (let y = 0; y < 16 * S; y++)
    for (let x = 0; x < 16 * S; x++) {
      const c = img.get(Math.floor(x / S), Math.floor(y / S));
      if (c[3] === 0) continue;
      const bg = sheet.get(ox + x, oy + y);
      sheet.set(ox + x, oy + y, mix(bg, c, c[3] / 255));
    }
});
fs.writeFileSync(path.join(OUT, 'preview.png'), encodePNG(sheet));
console.log(`Generated ${Object.keys(blocks).length} block, ${Object.keys(items).length} item, ${Object.keys(misc).length} misc textures.`);
