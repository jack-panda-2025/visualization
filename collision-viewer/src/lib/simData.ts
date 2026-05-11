// Module-level store for heavy typed arrays — NOT in React state to avoid cloning.
import type { SimData } from './parseBin';

let _data: SimData | null = null;
let _availablePartIds: Set<number> | null = null;

export function setSimData(d: SimData) {
  _data = d;
  _availablePartIds = new Set(d.partArr);
}
export function getSimData(): SimData | null { return _data; }
export function getAvailablePartIds(): Set<number> { return _availablePartIds ?? new Set(); }

export function nodeStressValue(idx: number, fi: number): number {
  if (!_data) return 0;
  const raw = _data.valFrames[fi][idx];
  const isVM = _data.layerArr[idx] === 0;
  if (raw < 2) return 0;
  return isVM
    ? ((raw - 2) / 253) * _data.meta.vm_p95
    : ((raw - 2) / 253) * _data.meta.eps_p95;
}

export function nodeStressStr(idx: number, fi: number): string {
  if (!_data) return '—';
  const raw = _data.valFrames[fi][idx];
  const isVM = _data.layerArr[idx] === 0;
  if (raw < 2) return isVM ? '0 MPa' : '0';
  const v = ((raw - 2) / 253) * (isVM ? _data.meta.vm_p95 : _data.meta.eps_p95);
  return isVM ? `${v.toFixed(2)} MPa` : v.toFixed(5);
}
