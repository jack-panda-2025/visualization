/**
 * decoder.js — 读取无压缩 raw binary 帧文件
 *
 * Layout:
 *   [0 .. n_nodes*3*4)          float32  positions XYZ (absolute, mm)
 *   [n_nodes*12 .. +n_shell*4)  float32  PEEQ per shell element
 *   [rest)                       float32  alive flag per shell (1=alive)
 */

export async function loadFrame(url, manifest) {
  const nNodes = manifest.n_nodes;
  const nShell = manifest.n_shell;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${url} → ${resp.status}`);

  const buf = await resp.arrayBuffer();

  const posByteLen  = nNodes * 3 * 4;
  const peeqByteLen = nShell * 4;
  const expected    = posByteLen + peeqByteLen + nShell * 4;

  if (buf.byteLength < expected) {
    throw new Error(
      `Frame too small: got ${buf.byteLength} bytes, expected ${expected}`
    );
  }

  return {
    positions: new Float32Array(buf.slice(0, posByteLen)),
    peeq:      new Float32Array(buf.slice(posByteLen, posByteLen + peeqByteLen)),
    alive:     new Float32Array(buf.slice(posByteLen + peeqByteLen, expected)),
  };
}
