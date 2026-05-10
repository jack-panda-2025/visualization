export interface SimMeta {
  n_frames: number;
  n_nodes: number;
  n_tires: number;
  eps_p95: number;
  vm_p95: number;
}

export interface SimData {
  meta: SimMeta;
  timesArr: Float32Array;
  posFrames: Float32Array[];
  valFrames: Uint8Array[];
  tireFrames: Float32Array[];
  layerArr: Uint8Array;
  partArr: Int32Array;
}

export function parseBin(buffer: ArrayBuffer): SimData {
  const view = new DataView(buffer);
  let off = 0;

  const magic = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
  );
  if (magic !== 'COL2') throw new Error(`Invalid magic: "${magic}"`);
  off = 4;

  const n_frames = view.getInt32(off, true); off += 4;
  const n_nodes  = view.getInt32(off, true); off += 4;
  const n_tires  = view.getInt32(off, true); off += 4;
  const eps_p95  = view.getFloat32(off, true); off += 4;
  const vm_p95   = view.getFloat32(off, true); off += 4;

  const meta: SimMeta = { n_frames, n_nodes, n_tires, eps_p95, vm_p95 };

  const timesArr = new Float32Array(n_frames);
  for (let i = 0; i < n_frames; i++) { timesArr[i] = view.getFloat32(off, true); off += 4; }

  const posFrames: Float32Array[] = [];
  const valFrames: Uint8Array[] = [];
  for (let f = 0; f < n_frames; f++) {
    const pArr = new Float32Array(n_nodes * 3);
    for (let i = 0; i < n_nodes * 3; i++) { pArr[i] = view.getFloat32(off, true); off += 4; }
    posFrames.push(pArr);
    const vArr = new Uint8Array(n_nodes);
    for (let i = 0; i < n_nodes; i++) { vArr[i] = view.getUint8(off); off += 1; }
    valFrames.push(vArr);
  }

  const tireFrames: Float32Array[] = [];
  for (let f = 0; f < n_frames; f++) {
    const tArr = new Float32Array(n_tires * 8);
    for (let i = 0; i < n_tires * 8; i++) { tArr[i] = view.getFloat32(off, true); off += 4; }
    tireFrames.push(tArr);
  }

  const layerArr = new Uint8Array(n_nodes);
  for (let i = 0; i < n_nodes; i++) { layerArr[i] = view.getUint8(off); off += 1; }

  const partArr = new Int32Array(n_nodes);
  for (let i = 0; i < n_nodes; i++) { partArr[i] = view.getInt32(off, true); off += 4; }

  return { meta, timesArr, posFrames, valFrames, tireFrames, layerArr, partArr };
}
