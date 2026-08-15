#!/usr/bin/env node
/**
 * Generates the app icons.
 *
 * The mark is the day dial: a ring with a gap, which is the same visual idea
 * the macro rings and the checklist ring use. One idea, reused, so the icon on
 * the home screen is recognisably the thing inside the app.
 *
 * Written as a raw PNG encoder rather than pulling in an image library,
 * because a single flat-colour glyph does not justify a dependency that has to
 * compile native code.
 *
 * Run: node scripts/icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

/** Straight from tokens.css. The icon must not invent its own colours. */
const INK_900 = [0x15, 0x16, 0x1d];
const TEXT_HI = [0xe9, 0xe9, 0xf0];
const M_PROTEIN = [0x2f, 0xa8, 0xa0];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10-12: compression, filter, interlace — all zero

  // Each scanline is prefixed with a filter byte (0 = none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Draws the dial. `inset` shrinks the mark so a maskable icon survives being
 * cropped to a circle — Android clips to roughly the middle 80%.
 */
function draw(size, { inset = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;

  const radius = size * 0.34 * inset;
  const stroke = size * 0.085;
  const inner = radius - stroke / 2;
  const outer = radius + stroke / 2;

  // Gap at the top, so the ring reads as a gauge rather than a donut.
  const gapStart = -Math.PI / 2 - 0.42;
  const gapEnd = -Math.PI / 2 + 0.42;

  // The filled portion, in the protein hue: a ring showing real progress
  // rather than a decorative circle.
  const fillUntil = -Math.PI / 2 + Math.PI * 1.15;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c + 0.5;
      const dy = y - c + 0.5;
      const dist = Math.hypot(dx, dy);

      let colour = INK_900;
      let alpha = 255;

      if (dist >= inner && dist <= outer) {
        let angle = Math.atan2(dy, dx);
        // Normalise to start at twelve o'clock.
        while (angle < -Math.PI / 2) angle += Math.PI * 2;

        const inGap = angle > gapStart && angle < gapEnd;
        if (!inGap) {
          colour = angle <= fillUntil ? M_PROTEIN : TEXT_HI;
          // Soft edge, so the ring is not aliased into a staircase.
          const edge = Math.min(dist - inner, outer - dist);
          alpha = Math.min(255, Math.round(edge * 255 * 1.5) + 160);
        }
      }

      const i = (y * size + x) * 4;
      const bg = INK_900;
      const a = alpha / 255;
      // Composite onto the ground so the icon has no transparency; iOS renders
      // a transparent home-screen icon as black.
      px[i] = Math.round(colour[0] * a + bg[0] * (1 - a));
      px[i + 1] = Math.round(colour[1] * a + bg[1] * (1 - a));
      px[i + 2] = Math.round(colour[2] * a + bg[2] * (1 - a));
      px[i + 3] = 255;
    }
  }

  return px;
}

const targets = [
  { name: 'icon-192.png', size: 192, inset: 1 },
  { name: 'icon-512.png', size: 512, inset: 1 },
  { name: 'icon-maskable-512.png', size: 512, inset: 0.78 },
  { name: 'apple-touch-icon.png', size: 180, inset: 1 },
];

for (const t of targets) {
  const buf = png(t.size, draw(t.size, { inset: t.inset }));
  writeFileSync(join(outDir, t.name), buf);
  console.log(`${t.name.padEnd(26)} ${t.size}x${t.size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
