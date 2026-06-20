'use strict';
// Builds icon16/48/128.png: the keyboard.png artwork, recolored white, centered
// on the brand radial gradient (same look as the on-page bubble).
// Pure Node (zlib + manual PNG read/write); run: node generate-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'keyboard.png');
const C_IN = [143, 188, 255]; // #8fbcff
const C_OUT = [74, 141, 240]; // #4a8df0
// Bubble palette (matches the on-page launcher / extension bubble).
const B_IN = [167, 139, 255]; // #a78bff
const B_OUT = [109, 74, 240]; // #6d4af0
const B_BORDER = [233, 225, 255]; // #e9e1ff

function lerp(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// --- PNG read (8-bit palette + tRNS) ---------------------------------------
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodeCoverage(file) {
  const b = fs.readFileSync(file);
  let o = 8, w = 0, ht = 0, palette = null, trns = null;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o);
    const type = b.toString('ascii', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); ht = data.readUInt32BE(4); }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w; // 1 byte per pixel (palette index)
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
  // coverage = 1 where the glyph is opaque, 0 where transparent
  const cov = new Float32Array(w * ht);
  for (let i = 0; i < idx.length; i++) {
    const a = trns && idx[i] < trns.length ? trns[idx[i]] : 255;
    cov[i] = a / 255;
  }
  return { cov, w, h: ht };
}

// Box-average downscale of a coverage map into a dw x dh region.
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

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function buildPixels(size, glyph) {
  const px = Buffer.alloc(size * size * 4);
  const R = size * 0.22;
  const cx = size * 0.5, cy = size * 0.35;
  const maxR = Math.hypot(Math.max(cx, size - cx), Math.max(cy, size - cy));
  // glyph placement (centered, ~66% of the tile)
  const g = Math.round(size * 0.66);
  const gx0 = Math.round((size - g) / 2);
  const gy0 = Math.round((size - g) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRoundedRect(x + 0.5, y + 0.5, 0, 0, size, size, R)) { px[i + 3] = 0; continue; }
      const t = Math.min(1, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / maxR);
      let [r, gg, b] = lerp(C_IN, C_OUT, t);
      // composite white glyph
      const lx = x - gx0, ly = y - gy0;
      if (lx >= 0 && ly >= 0 && lx < g && ly < g) {
        const a = glyph[ly * g + lx];
        if (a > 0) { r = Math.round(r + (255 - r) * a); gg = Math.round(gg + (255 - gg) * a); b = Math.round(b + (255 - b) * a); }
      }
      px[i] = r; px[i + 1] = gg; px[i + 2] = b; px[i + 3] = 255;
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

// The bubble: a violet radial-gradient circle (highlight at 50% 35%) with a
// light border and the white keyboard glyph — same look as the on-page launcher.
function buildBubble(size, glyph, opts = {}) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const margin = (opts.margin != null ? opts.margin : 0.02) * size;
  const R = size / 2 - margin; // outer radius (circle edge)
  const border = (opts.border != null ? opts.border : 0.04) * size;
  const Rin = R - border; // gradient radius (inside the border ring)
  const gcx = size * 0.5;
  const gcy = size * 0.35; // gradient highlight position
  const maxR = Rin * 1.3;
  const g = glyph.size;
  const gx0 = Math.round((size - g) / 2);
  const gy0 = Math.round((size - g) / 2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const edge = Math.max(0, Math.min(1, R - dist)); // 1px anti-alias at rim
      if (edge <= 0) { px[i + 3] = 0; continue; }

      let r, gg, b;
      if (dist > Rin) {
        [r, gg, b] = B_BORDER;
      } else {
        const t = Math.min(1, Math.hypot(x + 0.5 - gcx, y + 0.5 - gcy) / maxR);
        [r, gg, b] = lerp(B_IN, B_OUT, t);
        const lx = x - gx0, ly = y - gy0;
        if (lx >= 0 && ly >= 0 && lx < g && ly < g) {
          const a = glyph.data[ly * g + lx];
          if (a > 0) { r = Math.round(r + (255 - r) * a); gg = Math.round(gg + (255 - gg) * a); b = Math.round(b + (255 - b) * a); }
        }
      }
      px[i] = r; px[i + 1] = gg; px[i + 2] = b; px[i + 3] = Math.round(255 * edge);
    }
  }
  return px;
}

function glyphAt(g) {
  return { size: g, data: scaleCoverage(src.cov, src.w, src.h, g, g) };
}

const src = decodeCoverage(SRC);

// Chrome extension toolbar icons (rounded-square tile).
for (const size of [16, 48, 128]) {
  const glyph = scaleCoverage(src.cov, src.w, src.h, Math.round(size * 0.66), Math.round(size * 0.66));
  const png = encodePNG(size, buildPixels(size, glyph));
  fs.writeFileSync(path.join(__dirname, `icon${size}.png`), png);
  console.log(`wrote icon${size}.png (${png.length} bytes)`);
}

const appIconDir = path.join(__dirname, '..', '..', 'app', 'assets');
fs.mkdirSync(appIconDir, { recursive: true });

// Desktop-app icon — the bubble (circle). electron-builder makes .icns/.png from it.
{
  const size = 512;
  const png = encodePNG(size, buildBubble(size, glyphAt(Math.round(size * 0.46))));
  fs.writeFileSync(path.join(appIconDir, 'icon.png'), png);
  console.log(`wrote app/assets/icon.png (${png.length} bytes)`);
}

// System-tray / menu-bar icon — the same bubble, small + colored (not a template).
{
  const size = 64;
  const png = encodePNG(size, buildBubble(size, glyphAt(Math.round(size * 0.5)), { margin: 0.04, border: 0.06 }));
  fs.writeFileSync(path.join(appIconDir, 'tray.png'), png);
  console.log(`wrote app/assets/tray.png (${png.length} bytes)`);
}
