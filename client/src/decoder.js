/**
 * decoder.js — 解码 float32 直出的帧数据
 *
 * Binary layout (after zlib decompression):
 *   [0 .. n_nodes*3*4 - 1]        float32  positions XYZ (absolute coords, mm)
 *   [n_nodes*12 .. +n_shell*4]    float32  PEEQ per shell element
 *   [rest]                         float32  alive flag per shell element (1=alive)
 */
import pako from 'pako';

export async function loadFrame(url, manifest) {
  const nNodes = manifest.n_nodes;
  const nShell = manifest.n_shell;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${url} → ${resp.status}`);

  const raw = pako.inflate(new Uint8Array(await resp.arrayBuffer()));

  // Copy into a fresh ArrayBuffer to ensure alignment
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

  const posByteLen  = nNodes * 3 * 4;
  const peeqByteLen = nShell * 4;

  const positions = new Float32Array(buf, 0,           nNodes * 3);
  const peeq      = new Float32Array(buf, posByteLen,  nShell);
  const alive     = new Float32Array(buf, posByteLen + peeqByteLen, nShell);

  return { positions, peeq, alive };
}
