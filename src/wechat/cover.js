/**
 * Deterministic cover image for a WeChat Official Account article.
 *
 * The same briefing always renders the same cover, and a different briefing
 * gets a visibly different one. Palettes are hand-picked rather than generated
 * from a random hue, because arbitrary hues reliably look worse than a small
 * curated set. No network call and no image dependency is involved.
 *
 * Latin text only: rendering Chinese would need an embedded font, which would
 * dwarf the rest of the Skill, so the wordmark is Latin and the Chinese title
 * lives in the article itself.
 */

import { createHash } from "node:crypto";
import { Surface } from "./png.js";

export const COVER_WIDTH = 900;
export const COVER_HEIGHT = 383; // WeChat's recommended 2.35:1 cover ratio

/** Hand-picked palettes: [background top, background bottom, glow, accent, ink]. */
export const PALETTES = [
  { name: "midnight-amber", top: [14, 22, 41], bottom: [8, 12, 24], glow: [58, 84, 158], accent: [244, 176, 66], ink: [238, 242, 252] },
  { name: "ink-teal", top: [10, 32, 36], bottom: [6, 16, 20], glow: [24, 96, 104], accent: [86, 214, 196], ink: [232, 248, 246] },
  { name: "plum-rose", top: [34, 14, 40], bottom: [16, 8, 22], glow: [96, 40, 106], accent: [238, 122, 158], ink: [246, 236, 246] },
  { name: "forest-lime", top: [12, 32, 24], bottom: [6, 16, 12], glow: [30, 92, 62], accent: [158, 220, 96], ink: [234, 246, 236] },
  { name: "charcoal-orange", top: [26, 24, 22], bottom: [12, 11, 10], glow: [82, 62, 46], accent: [240, 138, 66], ink: [244, 240, 234] },
  { name: "indigo-cyan", top: [18, 20, 52], bottom: [8, 9, 26], glow: [52, 62, 150], accent: [96, 206, 236], ink: [234, 240, 252] },
];

// 5x7 glyphs. Only the characters the wordmark and date need.
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "·": ["00000", "00000", "00100", "00000", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

export function measureText(text, { scale = 1, letterSpacing = 1 } = {}) {
  const characters = [...String(text).toUpperCase()];
  if (!characters.length) return { width: 0, height: GLYPH_HEIGHT * scale };
  const width = characters.length * GLYPH_WIDTH * scale + (characters.length - 1) * letterSpacing * scale;
  return { width, height: GLYPH_HEIGHT * scale };
}

export function drawText(surface, text, x, y, { scale = 1, letterSpacing = 1, colour = [255, 255, 255], alpha = 1 } = {}) {
  let cursor = Math.round(x);
  for (const character of String(text).toUpperCase()) {
    const glyph = GLYPHS[character];
    if (glyph) {
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        for (let column = 0; column < GLYPH_WIDTH; column += 1) {
          if (glyph[row][column] !== "1") continue;
          surface.fillRect(cursor + column * scale, Math.round(y) + row * scale, scale, scale, colour, alpha);
        }
      }
    }
    cursor += (GLYPH_WIDTH + letterSpacing) * scale;
  }
  return cursor;
}

function seedNumbers(seed) {
  const digest = createHash("sha256").update(String(seed)).digest();
  return { digest, at: (index) => digest[index % digest.length] };
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function selectPalette(seed) {
  const { at } = seedNumbers(seed);
  return PALETTES[at(0) % PALETTES.length];
}

/**
 * Render the cover.
 *
 * @param {object} options
 * @param {string} options.seed        Anything stable for this briefing; drives palette and motif.
 * @param {string} [options.wordmark]  Latin wordmark, uppercased.
 * @param {string} [options.dateLabel] e.g. "2026.09.06"
 * @param {string[]} [options.tags]    Short Latin section labels, at most four.
 * @returns {{png: Buffer, palette: object, width: number, height: number}}
 */
export function renderCover({
  seed = "ai-growth-intelligence",
  wordmark = "AI GROWTH INTELLIGENCE",
  dateLabel = "",
  tags = [],
  width = COVER_WIDTH,
  height = COVER_HEIGHT,
} = {}) {
  const palette = selectPalette(seed);
  const { at } = seedNumbers(seed);
  const surface = new Surface(width, height);

  // 1. Vertical gradient base.
  for (let y = 0; y < height; y += 1) {
    const colour = mix(palette.top, palette.bottom, y / (height - 1));
    for (let x = 0; x < width; x += 1) surface.set(x, y, colour);
  }

  // 2. Soft off-centre glow, positioned from the seed.
  const glowX = width * (0.58 + (at(1) / 255) * 0.26);
  const glowY = height * (0.12 + (at(2) / 255) * 0.3);
  const glowRadius = Math.max(width, height) * (0.42 + (at(3) / 255) * 0.2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - glowX, y - glowY);
      const strength = 1 - smoothstep(0, glowRadius, distance);
      if (strength > 0) surface.blend(x, y, palette.glow, strength * 0.55);
    }
  }

  // 3. Diagonal bands, low alpha, for depth.
  const bandCount = 3 + (at(4) % 3);
  const slope = 0.35 + (at(5) / 255) * 0.5;
  for (let band = 0; band < bandCount; band += 1) {
    const offset = ((at(6 + band) / 255) * 1.6 - 0.3) * width;
    const thickness = height * (0.05 + (at(10 + band) / 255) * 0.08);
    for (let y = 0; y < height; y += 1) {
      const centre = offset + y * slope;
      for (let x = Math.max(0, Math.floor(centre)); x < Math.min(width, Math.ceil(centre + thickness)); x += 1) {
        surface.blend(x, y, palette.ink, 0.035);
      }
    }
  }

  // 4. Data-bar motif along the lower edge: a briefing that looks like a briefing.
  const barCount = 34;
  const barGap = 4;
  const barWidth = (width - 96 - barGap * (barCount - 1)) / barCount;
  const barBaseline = height - 54;
  for (let index = 0; index < barCount; index += 1) {
    const magnitude = at(20 + index) / 255;
    const barHeight = 6 + magnitude * 54;
    const x = 48 + index * (barWidth + barGap);
    const highlighted = magnitude > 0.72;
    surface.fillRect(x, barBaseline - barHeight, barWidth, barHeight,
      highlighted ? palette.accent : palette.ink, highlighted ? 0.9 : 0.16);
  }

  // 5. Accent rule above the wordmark.
  surface.fillRect(48, 96, 132, 5, palette.accent, 1);

  // 6. Wordmark and date.
  const wordmarkScale = 6;
  drawText(surface, wordmark, 48, 128, { scale: wordmarkScale, letterSpacing: 1, colour: palette.ink, alpha: 0.97 });
  if (dateLabel) {
    const measured = measureText(dateLabel, { scale: 3 });
    drawText(surface, dateLabel, width - 48 - measured.width, 100, { scale: 3, colour: palette.accent, alpha: 0.95 });
  }

  // 7. Section tags under the wordmark.
  if (tags.length) {
    let cursor = 48;
    for (const tag of tags.slice(0, 4)) {
      const measured = measureText(tag, { scale: 2 });
      surface.fillRect(cursor - 10, 214, measured.width + 20, 30, palette.ink, 0.1);
      drawText(surface, tag, cursor, 222, { scale: 2, colour: palette.ink, alpha: 0.72 });
      cursor += measured.width + 34;
      if (cursor > width - 120) break;
    }
  }

  // 8. Fine grain so flat gradients do not band on phone screens.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const noise = ((x * 92837111) ^ (y * 689287499) ^ at(x % 31)) & 7;
      if (noise === 0) surface.blend(x, y, palette.ink, 0.02);
    }
  }

  return { png: surface.toPng(), palette, width, height };
}
