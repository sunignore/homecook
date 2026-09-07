#!/usr/bin/env bun
// @version 1.0.0
// generate-icons.ts — renders the PWA icons in public/ from one definition here.
//
// The manifest referenced icon-192.png / icon-512.png that were never created.
// Because the SPA rewrite serves index.html for anything unmatched, those URLs
// returned 200 with text/html rather than 404 — so the icons looked present and
// the install prompt silently never qualified.
//
// No image dependency: shapes are rasterised into an RGBA buffer and written as
// PNG directly, so the icons are reproducible with `bun scripts/generate-icons.ts`
// and nothing extra has to be installed to build the app.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ── PNG encoding ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(new Uint8Array([...typeBytes, ...data])));
  return out;
}

function encodePng(rgba: Uint8Array, size: number): Uint8Array {
  // One filter byte (0 = None) per scanline.
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}

// ── drawing ──────────────────────────────────────────────────────────────────

type RGB = [number, number, number];

/** --hc-color-accent-600, the app's accent (src/styles/tokens.json). */
const BACKGROUND: RGB = [0xc2, 0x41, 0x0c];
const FOREGROUND: RGB = [0xff, 0xff, 0xff];

/** Coverage of a rounded rectangle at a point, in unit coordinates. */
function roundedRectCoverage(x: number, y: number, radius: number): boolean {
  const clamped = Math.min(Math.max(radius, 0), 0.5);
  const dx = Math.max(clamped - x, x - (1 - clamped), 0);
  const dy = Math.max(clamped - y, y - (1 - clamped), 0);
  return dx * dx + dy * dy <= clamped * clamped;
}

function circle(x: number, y: number, cx: number, cy: number, r: number): boolean {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function rect(x: number, y: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/**
 * A chef's hat, drawn in unit coordinates within `scale` of the centre.
 *
 * `scale` is what makes the maskable variant work: Android crops icons to an
 * arbitrary shape, so the glyph is shrunk into the safe zone rather than the
 * background being padded.
 */
function glyph(x: number, y: number, scale: number): boolean {
  const u = (x - 0.5) / scale + 0.5;
  const v = (y - 0.5) / scale + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;

  // Three puffs forming the crown.
  if (circle(u, v, 0.5, 0.36, 0.20)) return true;
  if (circle(u, v, 0.30, 0.44, 0.16)) return true;
  if (circle(u, v, 0.70, 0.44, 0.16)) return true;

  // Band the crown sits on, plus the brim.
  if (rect(u, v, 0.24, 0.44, 0.76, 0.60)) return true;
  if (rect(u, v, 0.28, 0.63, 0.72, 0.76)) return true;

  return false;
}

interface IconSpec {
  file: string;
  size: number;
  /** Rounded-corner radius in unit coordinates; 0 fills the square. */
  cornerRadius: number;
  /** Glyph scale — smaller keeps it inside a maskable safe zone. */
  glyphScale: number;
}

const SUPERSAMPLE = 4;

function render({ size, cornerRadius, glyphScale }: IconSpec): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let inBackground = 0;
      let inGlyph = 0;

      // Supersample for antialiasing — these icons are read at small sizes and
      // hard edges look broken on a phone home screen.
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          const bg = cornerRadius > 0 ? roundedRectCoverage(x, y, cornerRadius) : true;
          if (!bg) continue;
          inBackground += 1;
          if (glyph(x, y, glyphScale)) inGlyph += 1;
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = inBackground / samples;
      const glyphRatio = inBackground === 0 ? 0 : inGlyph / inBackground;

      const idx = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[idx + c] = Math.round(
          BACKGROUND[c]! * (1 - glyphRatio) + FOREGROUND[c]! * glyphRatio,
        );
      }
      rgba[idx + 3] = Math.round(alpha * 255);
    }
  }

  return rgba;
}

const ICONS: IconSpec[] = [
  { file: 'icon-192.png', size: 192, cornerRadius: 0.22, glyphScale: 0.78 },
  { file: 'icon-512.png', size: 512, cornerRadius: 0.22, glyphScale: 0.78 },
  // Maskable: full bleed, glyph inside the 80% safe zone Android may crop to.
  { file: 'icon-512-maskable.png', size: 512, cornerRadius: 0, glyphScale: 0.56 },
  // iOS ignores the manifest and uses this; it must not be transparent.
  { file: 'apple-touch-icon.png', size: 180, cornerRadius: 0, glyphScale: 0.7 },
];

mkdirSync(publicDir, { recursive: true });

for (const spec of ICONS) {
  const png = encodePng(render(spec), spec.size);
  writeFileSync(join(publicDir, spec.file), png);
  console.log(`✓ ${spec.file} — ${spec.size}x${spec.size}, ${(png.length / 1024).toFixed(1)} KB`);
}
