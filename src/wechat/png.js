/**
 * Minimal truecolour PNG encoder built on node:zlib.
 *
 * The Skill ships no third-party dependencies, so the cover renderer needs its
 * own encoder. This writes the smallest valid PNG that carries an RGB raster:
 * signature, IHDR, one IDAT, IEND, with every scanline using filter type 0.
 */

import { deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** A width x height RGB surface with float compositing. */
export class Surface {
  constructor(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new TypeError("Surface dimensions must be positive integers.");
    }
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 3);
  }

  set(x, y, [r, g, b]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const offset = (y * this.width + x) * 3;
    this.data[offset] = r;
    this.data[offset + 1] = g;
    this.data[offset + 2] = b;
  }

  get(x, y) {
    const offset = (y * this.width + x) * 3;
    return [this.data[offset], this.data[offset + 1], this.data[offset + 2]];
  }

  /** Source-over blend of one pixel at the given alpha (0..1). */
  blend(x, y, [r, g, b], alpha) {
    if (alpha <= 0) return;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const a = Math.min(1, alpha);
    const [br, bg, bb] = this.get(x, y);
    this.set(x, y, [br + (r - br) * a, bg + (g - bg) * a, bb + (b - bb) * a]);
  }

  fillRect(x0, y0, w, h, colour, alpha = 1) {
    const startX = Math.max(0, Math.round(x0));
    const startY = Math.max(0, Math.round(y0));
    const endX = Math.min(this.width, Math.round(x0 + w));
    const endY = Math.min(this.height, Math.round(y0 + h));
    for (let y = startY; y < endY; y += 1) for (let x = startX; x < endX; x += 1) this.blend(x, y, colour, alpha);
  }

  toPng() {
    const stride = this.width * 3;
    const raw = Buffer.alloc((stride + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (stride + 1)] = 0; // filter type: none
      Buffer.from(this.data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // colour type: truecolour
    header[10] = 0; // deflate
    header[11] = 0; // adaptive filtering
    header[12] = 0; // no interlace
    return Buffer.concat([
      SIGNATURE,
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

export { SIGNATURE as PNG_SIGNATURE };
