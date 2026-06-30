'use strict';
// Builds icon16/48/128.png (toolbar) + app/assets/icon.png & tray.png:
// the keyboard.png artwork, recolored white and CENTERED (aspect-correct) on the
// violet brand gradient — the same look as the on-page bubble.
// Pure Node (zlib + manual PNG read/write); run: node generate-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'keyboard.png');
// Brand (violet) palette — matches the on-page launcher / extension bubble.
const C_IN = [167, 139, 255];   // #a78bff
const C_OUT = [109, 74, 240];   // #6d4af0
const BORDER = [233, 225, 255]; // #e9e1ff

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// --- PNG read (8-bit palette + tRNS) -> coverage ---------------------------
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodeCoverage(file) {
  const b = fs.readFileSync(file);
  let o = 8, w = 0, ht = 0, trns = null;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString('ascii', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); ht = data.readUInt32BE(4); }
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w;
  const idx = Buffer.alloc(w * ht);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < ht; y++) {
    const ft = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 1 ? cur[x - 1] : 0;
      const bb = prev[x];
      const c = x >= 1 ? prev[x - 1] : 0;
      let v = row[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) v += paeth(a, bb, c);
      cur[x] = v & 0xff;
    }
    cur.copy(idx, y * stride);
    prev = cur;
  }
  const cov = new Float32Array(w * ht);
  for (let i = 0; i < idx.length; i++) {
    const a = trns && idx[i] < trns.length ? trns[idx[i]] : 255;
    cov[i] = a / 255;
  }
  return { cov, w, h: ht };
}

// Tight bounding box of the opaque glyph (center on real content, not padding).
function bbox(cov, w, h, thr = 0.05) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (cov[y * w + x] > thr) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { minX: 0, minY: 0, w, h };
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
function crop(cov, w, h, bb) {
  const out = new Float32Array(bb.w * bb.h);
  for (let y = 0; y < bb.h; y++) for (let x = 0; x < bb.w; x++)
    out[y * bb.w + x] = cov[(bb.minY + y) * w + (bb.minX + x)];
  return out;
}
function scaleCoverage(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor((dy / dh) * sh);
    const sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) / dh) * sh));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor((dx / dw) * sw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) / dw) * sw));
      let sum = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) { sum += src[sy * sw + sx]; n++; }
      out[dy * dw + dx] = n ? sum / n : 0;
    }
  }
  return out;
}
// Crop to content, aspect-fit into a box `frac` of the tile, centered.
// `nudge` shifts the glyph by whole pixels {x, y} (e.g. icon16 looks better 1px left).
function centeredGlyph(src, size, frac, nudge = {}) {
  const bb = bbox(src.cov, src.w, src.h);
  const sub = crop(src.cov, src.w, src.h, bb);
  const scale = (size * frac) / Math.max(bb.w, bb.h);
  const gw = Math.max(1, Math.round(bb.w * scale));
  const gh = Math.max(1, Math.round(bb.h * scale));
  return {
    data: scaleCoverage(sub, bb.w, bb.h, gw, gh),
    gw, gh,
    gx0: Math.round((size - gw) / 2) + (nudge.x || 0),
    gy0: Math.round((size - gh) / 2) + (nudge.y || 0),
  };
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function composite(r, g, b, gl, x, y) {
  const lx = x - gl.gx0, ly = y - gl.gy0;
  if (lx >= 0 && ly >= 0 && lx < gl.gw && ly < gl.gh) {
    const a = gl.data[ly * gl.gw + lx];
    if (a > 0) { r = Math.round(r + (255 - r) * a); g = Math.round(g + (255 - g) * a); b = Math.round(b + (255 - b) * a); }
  }
  return [r, g, b];
}

// Rounded-square toolbar tile: violet radial gradient + centered white glyph.
function buildTile(size, gl) {
  const px = Buffer.alloc(size * size * 4);
  const R = size * 0.22;
  const cx = size * 0.5, cy = size * 0.35;
  const maxR = Math.hypot(Math.max(cx, size - cx), Math.max(cy, size - cy));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRoundedRect(x + 0.5, y + 0.5, 0, 0, size, size, R)) { px[i + 3] = 0; continue; }
      const t = Math.min(1, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / maxR);
      let [r, g, b] = lerp(C_IN, C_OUT, t);
      [r, g, b] = composite(r, g, b, gl, x, y);
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return px;
}

// Circle bubble (desktop app + tray): gradient circle, light border, centered glyph.
function buildBubble(size, gl, opts = {}) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const margin = (opts.margin != null ? opts.margin : 0.02) * size;
  const R = size / 2 - margin;
  const border = (opts.border != null ? opts.border : 0.04) * size;
  const Rin = R - border;
  const gcx = size * 0.5, gcy = size * 0.35;
  const maxR = Rin * 1.3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const edge = Math.max(0, Math.min(1, R - dist));
      if (edge <= 0) { px[i + 3] = 0; continue; }
      let r, g, b;
      if (dist > Rin) {
        [r, g, b] = BORDER;
      } else {
        const t = Math.min(1, Math.hypot(x + 0.5 - gcx, y + 0.5 - gcy) / maxR);
        [r, g, b] = lerp(C_IN, C_OUT, t);
        [r, g, b] = composite(r, g, b, gl, x, y);
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = Math.round(255 * edge);
    }
  }
  return px;
}

// --- PNG write -------------------------------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (stride + 1)] = 0; pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const src = decodeCoverage(SRC);

// Chrome toolbar icons (rounded-square tile, glyph ~62% of the tile).
for (const size of [16, 48, 128]) {
  const png = encodePNG(size, buildTile(size, centeredGlyph(src, size, 0.62)));
  fs.writeFileSync(path.join(__dirname, `icon${size}.png`), png);
  console.log(`wrote icon${size}.png (${png.length} bytes)`);
}

// Desktop-app + tray icons feed the electron build; only rebuild them on demand
// (node generate-icons.js --app) so a routine toolbar-icon tweak can't disturb
// the released app artwork.
if (process.argv.includes('--app')) {
const appIconDir = path.join(__dirname, '..', '..', 'app', 'assets');
fs.mkdirSync(appIconDir, { recursive: true });

// Desktop-app icon — the bubble (circle). electron-builder makes .icns/.png from it.
{
  const size = 512;
  const png = encodePNG(size, buildBubble(size, centeredGlyph(src, size, 0.46)));
  fs.writeFileSync(path.join(appIconDir, 'icon.png'), png);
  console.log(`wrote app/assets/icon.png (${png.length} bytes)`);
}

// System-tray / menu-bar icon — the same bubble, small + colored.
{
  const size = 64;
  const png = encodePNG(size, buildBubble(size, centeredGlyph(src, size, 0.5), { margin: 0.04, border: 0.06 }));
  fs.writeFileSync(path.join(appIconDir, 'tray.png'), png);
  console.log(`wrote app/assets/tray.png (${png.length} bytes)`);
}
}
