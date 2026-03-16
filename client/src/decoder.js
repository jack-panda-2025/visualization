/**
 * decoder.js
 * Fetches and decodes a binary frame file from the crash-sim data server.
 *
 * Binary layout (after zlib decompression):
 *   [0 .. n_pts*3*2 - 1]          uint16  displacement XYZ interleaved  (N*3 values)
 *   [n_pts*6 .. n_pts*6+n_cells*2] uint16  PEEQ per cell                 (M values)
 *   [rest]                          uint8   bit-packed alive flags        (ceil(M/8) bytes)
 */

import pako from 'pako';

/**
 * Load and decode a single frame.
 *
 * @param {string} url  - Full URL to the .bin file
 * @param {object} manifest  - Parsed manifest.json
 * @returns {Promise<{displacement: Float32Array, peeq: Float32Array, alive: Uint8Array}>}
 */
export async function loadFrame(url, manifest) {
  const nPts   = manifest.n_surf_points;
  const nCells = manifest.n_surf_cells;

  const dispEnc = manifest.encoding.displacement;
  const peeqEnc = manifest.encoding.peeq;

  // ── Fetch compressed binary ──────────────────────────────────────────────
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  const compressedBuffer = await response.arrayBuffer();

  // ── Decompress with pako ────────────────────────────────────────────────
  const compressed = new Uint8Array(compressedBuffer);
  const raw = pako.inflate(compressed);          // returns Uint8Array

  // ── Slice raw bytes ──────────────────────────────────────────────────────
  const dispByteLen  = nPts   * 3 * 2;          // uint16 = 2 bytes
  const peeqByteLen  = nCells * 2;
  const aliveByteCnt = Math.ceil(nCells / 8);

  const dispOffset  = 0;
  const peeqOffset  = dispByteLen;
  const aliveOffset = peeqOffset + peeqByteLen;

  if (raw.length < aliveOffset + aliveByteCnt) {
    console.warn(
      `Frame buffer smaller than expected: got ${raw.length} bytes, ` +
      `expected >= ${aliveOffset + aliveByteCnt}`
    );
  }

  // Need an ArrayBuffer with byte-level alignment to use TypedArray views.
  // raw.buffer may be a shared/offset buffer, so copy the relevant slice.
  const rawBuf = raw.buffer.slice
    ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    : raw.buffer;

  // ── Decode displacement ──────────────────────────────────────────────────
  const dispScale  = dispEnc.scale;
  const dispOffset_ = dispEnc.offset;

  const dispU16 = new Uint16Array(rawBuf, dispOffset, nPts * 3);
  const displacement = new Float32Array(nPts * 3);
  for (let i = 0; i < nPts * 3; i++) {
    displacement[i] = dispU16[i] * dispScale + dispOffset_;
  }

  // ── Decode PEEQ ──────────────────────────────────────────────────────────
  const peeqScale   = peeqEnc.scale;
  const peeqOffset_ = peeqEnc.offset;

  const peeqU16 = new Uint16Array(rawBuf, peeqOffset, nCells);
  const peeq = new Float32Array(nCells);
  for (let i = 0; i < nCells; i++) {
    peeq[i] = peeqU16[i] * peeqScale + peeqOffset_;
  }

  // ── Decode bit-packed alive flags ────────────────────────────────────────
  const aliveBytes = new Uint8Array(rawBuf, aliveOffset, aliveByteCnt);
  const alive = new Uint8Array(nCells);
  for (let i = 0; i < nCells; i++) {
    const byteIdx = i >> 3;          // Math.floor(i / 8)
    const bitIdx  = i & 7;           // i % 8
    alive[i] = (aliveBytes[byteIdx] >> bitIdx) & 1;
  }

  return { displacement, peeq, alive };
}
