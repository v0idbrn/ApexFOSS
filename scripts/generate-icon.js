/**
 * Generates assets/icon.png (1024x1024) without external binaries.
 * Minimal PNG encoder: black AMOLED background with a cyan accent chevron.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

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
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const W = 1024;
const raw = Buffer.alloc(W * (W * 4 + 1));
const CYAN = [34, 211, 238];
const BLACK = [0, 0, 0];
const DIM = [20, 20, 20];

for (let y = 0; y < W; y++) {
  const rowStart = y * (W * 4 + 1);
  raw[rowStart] = 0; // filter none
  for (let x = 0; x < W; x++) {
    // background: subtle surface banding
    let color = y > 700 ? DIM : BLACK;
    // accent chevron: rising bar triangle from bottom-left area
    const inChevron =
      y >= 300 && y <= 760 && x >= 220 && x <= 804 && x >= 220 + (760 - y) * 0.75 && x <= 220 + (760 - y) * 0.75 + 260;
    if (inChevron) color = CYAN;
    const i = rowStart + 1 + x * 4;
    raw[i] = color[0];
    raw[i + 1] = color[1];
    raw[i + 2] = color[2];
    raw[i + 3] = 255;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
