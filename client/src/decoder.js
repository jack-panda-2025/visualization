/**
 * decoder.js — 读取 zlib 压缩的帧文件
 *
 * 帧文件布局（解压后）：
 *   [0 .. n_surf_nodes*3*4)     float32  表面节点坐标 XYZ（绝对，mm）
 *   [.. +n_tris*4)              float32  PEEQ per triangle
 *   [.. +n_tris*1)              uint8    alive flag（1=可见, 0=已删除）
 */

async function decompress(arrayBuffer) {
  const ds     = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(arrayBuffer));
  writer.close();

  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out   = new Uint8Array(total);
  let   off   = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}

export async function loadFrame(url, manifest) {
  const nNodes = manifest.n_surf_nodes;
  const nTris  = manifest.n_tris;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${url} → ${resp.status}`);

  const compBuf = await resp.arrayBuffer();
  const buf     = await decompress(compBuf);

  const posByteLen   = nNodes * 3 * 4;
  const peeqByteLen  = nTris  * 4;
  const aliveByteLen = nTris  * 1;
  const expected     = posByteLen + peeqByteLen + aliveByteLen;

  if (buf.byteLength < expected) {
    throw new Error(
      `Frame too small after decompress: got ${buf.byteLength} bytes, expected ${expected}`
    );
  }

  return {
    positions: new Float32Array(buf.slice(0, posByteLen)),
    peeq:      new Float32Array(buf.slice(posByteLen, posByteLen + peeqByteLen)),
    alive:     new Uint8Array(buf.slice(posByteLen + peeqByteLen, expected)),
  };
}
