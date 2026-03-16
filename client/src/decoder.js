import pako from 'pako';

export async function loadFrame(url, manifest) {
  const nNodes = manifest.n_nodes;
  const nShell = manifest.n_shell;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${url} → ${resp.status}`);

  const raw = pako.inflate(new Uint8Array(await resp.arrayBuffer()));

  const posByteLen  = nNodes * 3 * 4;   // float32
  const peeqByteLen = nShell     * 4;
  const aliveByteLen= nShell     * 4;

  const total = posByteLen + peeqByteLen + aliveByteLen;
  if (raw.byteLength < total) {
    throw new Error(
      `Frame buffer too small: got ${raw.byteLength} bytes, expected ${total}`
    );
  }

  // slice → each gets its own aligned ArrayBuffer
  const posBuf   = raw.buffer.slice(raw.byteOffset,                           raw.byteOffset + posByteLen);
  const peeqBuf  = raw.buffer.slice(raw.byteOffset + posByteLen,              raw.byteOffset + posByteLen + peeqByteLen);
  const aliveBuf = raw.buffer.slice(raw.byteOffset + posByteLen + peeqByteLen,raw.byteOffset + total);

  return {
    positions: new Float32Array(posBuf),
    peeq:      new Float32Array(peeqBuf),
    alive:     new Float32Array(aliveBuf),
  };
}
