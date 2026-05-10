import * as THREE from 'three';
import { PARTS_DATA } from './partsData';

// Golden-angle HSL spread — maximises perceptual distance between adjacent colors
const GOLDEN = 137.508;

export const partColorMap = new Map<number, THREE.Color>();
export const partColorHex = new Map<number, string>();

PARTS_DATA.forEach((part, i) => {
  const h = ((i * GOLDEN) % 360) / 360;
  const s = 0.62 + (i % 3) * 0.09;   // 0.62 / 0.71 / 0.80
  const l = 0.48 + (i % 2) * 0.12;   // 0.48 / 0.60  — not too dark, not too light
  const col = new THREE.Color().setHSL(h, s, l);
  partColorMap.set(part.id, col);
  partColorHex.set(part.id, '#' + col.getHexString());
});

// Pre-bake a Float32Array color buffer indexed by node (built once after data loads)
export function buildPartColorBuffer(
  n_nodes: number,
  partArr: Int32Array,
): Float32Array {
  const buf = new Float32Array(n_nodes * 3);
  for (let i = 0; i < n_nodes; i++) {
    const col = partColorMap.get(partArr[i]);
    const i3 = i * 3;
    if (col) { buf[i3] = col.r; buf[i3 + 1] = col.g; buf[i3 + 2] = col.b; }
    else { buf[i3] = 0.4; buf[i3 + 1] = 0.4; buf[i3 + 2] = 0.4; }
  }
  return buf;
}
