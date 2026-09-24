/**
 * Minimal QR encoder (byte mode, EC level M, versions 1–10).
 * Pure TypeScript — no native modules. Used for single-QR routine transport only.
 * Not a security feature. Payloads over MAX_PORTABLE_PAYLOAD_BYTES are rejected upstream.
 */

import { utf8ByteLength } from './canonical';

export interface QrMatrix {
  size: number;
  /** row-major, 1 = dark */
  modules: boolean[][];
}

// capacities (bytes) for EC level M, versions 1..10 (data codewords approx)
const BYTE_CAP_M: number[] = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
const EC_M: number[] = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const TOTAL_CODEWORDS: number[] = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const G1: number[] = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2];
const G2: number[] = [0, 16, 28, 24, 16, 18, 22, 20, 24, 24];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(deg: number): Uint8Array {
  let poly = Uint8Array.from([1]);
  for (let i = 0; i < deg; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const b of data) {
    const factor = b ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

function pickVersion(byteLen: number): number {
  for (let v = 1; v <= 10; v++) {
    // mode + count (8-bit count for v1-9, 16-bit for v10)
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    const neededBytes = Math.ceil((headerBits + byteLen * 8 + 4) / 8); // + terminator approx
    if (neededBytes <= BYTE_CAP_M[v - 1]) return v;
  }
  throw new Error('qr: payload too large for versions 1-10');
}

function buildCodewords(payload: Uint8Array, version: number): Uint8Array {
  const capacity = BYTE_CAP_M[version - 1];
  const bitBuf: number[] = [];
  const push = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bitBuf.push((val >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(payload.length, version <= 9 ? 8 : 16);
  for (const b of payload) push(b, 8);
  // terminator
  const totalBits = capacity * 8;
  for (let i = 0; i < 4 && bitBuf.length < totalBits; i++) bitBuf.push(0);
  while (bitBuf.length % 8 !== 0) bitBuf.push(0);
  const data = new Uint8Array(capacity);
  for (let i = 0; i < bitBuf.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bitBuf[i + j];
    data[i / 8] = byte;
  }
  // pad
  const pad = [0xec, 0x11];
  for (let i = bitBuf.length / 8, p = 0; i < capacity; i++, p++) data[i] = pad[p % 2];

  const ecLen = EC_M[version - 1];
  const g1 = G1[version - 1];
  const g2 = G2[version - 1];
  const blockSizes: number[] = [];
  for (let i = 0; i < g1; i++) blockSizes.push(Math.floor((capacity - g2 * Math.floor(capacity / (g1 + g2)) + g2) / (g1 + g2)) === 0 ? 0 : 0);
  // Simpler block split for EC-M:
  // Use standard tables for v1-10 EC-M block structure
  const blocks = splitBlocks(data, version);
  const ecBlocks = blocks.map((b) => rsEncode(b, ecLen));
  // interleave
  const total = TOTAL_CODEWORDS[version - 1];
  const out = new Uint8Array(total);
  const maxData = Math.max(...blocks.map((b) => b.length));
  let idx = 0;
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) {
      if (i < b.length) out[idx++] = b[i];
    }
  }
  const maxEc = ecLen;
  for (let i = 0; i < maxEc; i++) {
    for (const e of ecBlocks) out[idx++] = e[i];
  }
  void blockSizes;
  return out;
}

function splitBlocks(data: Uint8Array, version: number): Uint8Array[] {
  // EC-M block counts for versions 1-10: [groups]
  const structure: Array<Array<[number, number]>> = [
    [[1, 16]],
    [[1, 28]],
    [[1, 44]],
    [[2, 32]],
    [[2, 43]],
    [[4, 27]],
    [[4, 31]],
    [[2, 38], [2, 39]],
    [[3, 36], [2, 37]],
    [[4, 43], [1, 44]],
  ];
  const groups = structure[version - 1];
  const blocks: Uint8Array[] = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      blocks.push(data.subarray(offset, offset + size));
      offset += size;
    }
  }
  return blocks;
}

function maskFn(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

const ALIGN: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function placeFinders(m: boolean[][], reserved: boolean[][], size: number) {
  const place = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inRing && (
          r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        );
        m[rr][cc] = dark;
        reserved[rr][cc] = true;
      }
    }
  };
  place(0, 0);
  place(0, size - 7);
  place(size - 7, 0);
}

function placeTiming(m: boolean[][], reserved: boolean[][], size: number) {
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    if (!reserved[6][i]) { m[6][i] = dark; reserved[6][i] = true; }
    if (!reserved[i][6]) { m[i][6] = dark; reserved[i][6] = true; }
  }
}

function placeAlign(m: boolean[][], reserved: boolean[][], size: number, version: number) {
  const centers = ALIGN[version] ?? [];
  for (const r of centers) {
    for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          m[rr][cc] = dark;
          reserved[rr][cc] = true;
        }
      }
    }
  }
}

function reserveFormat(m: boolean[][], reserved: boolean[][], size: number) {
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  reserved[size - 8][8] = true; // dark module
}

function placeData(m: boolean[][], reserved: boolean[][], size: number, codewords: Uint8Array) {
  const bits: number[] = [];
  for (const b of codewords) {
    for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  }
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row][cc]) continue;
        m[row][cc] = bitIdx < bits.length ? bits[bitIdx++] === 1 : false;
      }
    }
    upward = !upward;
  }
}

function applyMask(m: boolean[][], reserved: boolean[][], size: number, mask: number) {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      if (maskFn(mask, r, c)) m[r][c] = !m[r][c];
    }
  }
}

function placeFormat(m: boolean[][], size: number, mask: number) {
  // EC level M = 00, format = (ec << 3 | mask), BCH
  const data = (0b00 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;
  const get = (i: number) => ((bits >> i) & 1) === 1;
  // horizontal near top-left
  for (let i = 0; i <= 5; i++) m[8][i] = get(i);
  m[8][7] = get(6);
  m[8][8] = get(7);
  m[7][8] = get(8);
  for (let i = 9; i <= 14; i++) m[14 - i][8] = get(i);
  // copy
  for (let i = 0; i <= 7; i++) m[size - 1 - i][8] = get(i);
  for (let i = 8; i <= 14; i++) m[8][size - 15 + i] = get(i);
  m[size - 8][8] = true;
}

function penalty(m: boolean[][], size: number): number {
  let score = 0;
  // rule 1: runs
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (m[r][c] === m[r][c - 1]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (m[r][c] === m[r - 1][c]) run++;
      else { if (run >= 5) score += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  // rule 2: 2x2
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  return score;
}

/** Encode UTF-8 string to QR module matrix (EC level M). Throws if too large. */
export function encodeQr(text: string): QrMatrix {
  const version = pickVersion(utf8ByteLength(text));
  const size = 17 + 4 * version;
  const payload = new TextEncoder().encode(text);
  const codewords = buildCodewords(payload, version);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    const reserved: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    placeFinders(m, reserved, size);
    placeTiming(m, reserved, size);
    placeAlign(m, reserved, size, version);
    reserveFormat(m, reserved, size);
    // dark module
    m[size - 8][8] = true;
    reserved[size - 8][8] = true;
    placeData(m, reserved, size, codewords);
    applyMask(m, reserved, size, mask);
    placeFormat(m, size, mask);
    const s = penalty(m, size);
    if (s < bestScore) { bestScore = s; best = m; }
  }
  return { size, modules: best! };
}

/** True when text is within single-QR capacity for this encoder. */
export function fitsQr(text: string): boolean {
  try {
    pickVersion(utf8ByteLength(text));
    return true;
  } catch {
    return false;
  }
}
