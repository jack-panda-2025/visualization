// Loader for the model-domain COL2 pair produced by collider's
// tools/h5_to_col2.py: <stem>_gt.bin, <stem>_pred.bin, <stem>_meta.json.
//
// Deliberately separate from parseBin.ts/simData.ts: those are built around a
// single global simulation singleton, which cannot hold two datasets at once.

export interface Col2 {
  nFrames: number;
  nNodes: number;
  scale: number;          // physical value that maps to the top of the ramp
  times: Float32Array;    // (T,) seconds
  pos: Float32Array[];    // T x (N*3) mm
  val: Uint8Array[];      // T x N, 0 = below threshold, 2..255 = ramp
  layer: Uint8Array;      // (N,) region id 0..5
  part: Int32Array;       // (N,) part id
}

export interface SideMeta {
  file: string;
  field: string;
  unit: string;
  scale: number;
  transform: 'log' | 'linear';
  floor?: number;
  source?: string;
  rmse_per_frame?: number[];
}

export interface PairMeta {
  stem: string;
  source_h5: string;
  n_nodes: number;
  node_stride: number;
  frames: { start: number; count: number; dt_s: number };
  region_legend: string;
  /** Mean nearest-neighbour spacing per region, in mm. Absent in files written
   *  before the converter measured it — the viewer falls back to one size. */
  regions?: { id: number; nodes: number; spacing_mm: number }[];
  gt: SideMeta;
  pred?: SideMeta;
  parts: { id: number; name: string; nodes: number; zone: string }[];
}

/** Parse COL2. See collider's tools/h5_to_col2.py write_col2() for the layout.
 *
 *  Blocks are copied out with slice() rather than read value-by-value through
 *  a DataView: the val block is N bytes and N is rarely a multiple of 4, so
 *  every frame after the first is misaligned and a zero-copy Float32Array view
 *  onto the original buffer would throw. slice() is one memcpy per block and
 *  still parses ~50 MB in well under a second, against tens of millions of
 *  individual getFloat32 calls otherwise.
 */
export function parseCol2(buffer: ArrayBuffer): Col2 {
  const head = new DataView(buffer, 0, 24);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== 'COL2') throw new Error(`Not a COL2 file (magic "${magic}")`);

  const nFrames = head.getInt32(4, true);
  const nNodes = head.getInt32(8, true);
  const nTires = head.getInt32(12, true);
  const scale = head.getFloat32(16, true);

  let off = 24;
  const times = new Float32Array(buffer.slice(off, off + 4 * nFrames));
  off += 4 * nFrames;

  const pos: Float32Array[] = [];
  const val: Uint8Array[] = [];
  const posBytes = nNodes * 12;
  for (let f = 0; f < nFrames; f++) {
    pos.push(new Float32Array(buffer.slice(off, off + posBytes)));
    off += posBytes;
    val.push(new Uint8Array(buffer.slice(off, off + nNodes)));
    off += nNodes;
  }

  off += nFrames * nTires * 32;   // tire block — always empty for model data

  const layer = new Uint8Array(buffer.slice(off, off + nNodes));
  off += nNodes;
  const part = new Int32Array(buffer.slice(off, off + nNodes * 4));

  return { nFrames, nNodes, scale, times, pos, val, layer, part };
}

async function fetchWithProgress(
  url: string, onProgress: (frac: number) => void,
): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  const total = parseInt(resp.headers.get('content-length') ?? '0');
  const reader = resp.body!.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(received / total);
  }
  const merged = new Uint8Array(received);
  let o = 0;
  for (const c of chunks) { merged.set(c, o); o += c.length; }
  return merged.buffer;
}

export interface Panel {
  key: string;
  label: string;
  data: Col2;
  meta: SideMeta;
}

/** Load every side declared in <stem>_meta.json. Returns panels in display
 *  order — truth first, then whatever the converter emitted alongside it. */
export async function loadPair(
  stem: string, onStatus: (text: string, pct: number) => void,
): Promise<{ panels: Panel[]; meta: PairMeta }> {
  onStatus('Reading manifest…', 2);
  const metaResp = await fetch(`${stem}_meta.json`);
  if (!metaResp.ok) {
    throw new Error(
      `${stem}_meta.json not found. Generate it with collider's ` +
      `tools/h5_to_col2.py and copy the output into public/.`);
  }
  const meta: PairMeta = await metaResp.json();

  const sides: { key: string; label: string; side: SideMeta }[] = [
    { key: 'gt', label: 'FEM ground truth', side: meta.gt },
  ];
  if (meta.pred) sides.push({ key: 'pred', label: 'Model prediction', side: meta.pred });

  const panels: Panel[] = [];
  for (let i = 0; i < sides.length; i++) {
    const { key, label, side } = sides[i];
    const base = 5 + (90 * i) / sides.length;
    const span = 90 / sides.length;
    const buf = await fetchWithProgress(side.file, f =>
      onStatus(`Downloading ${label}…`, base + span * 0.8 * f));
    onStatus(`Parsing ${label}…`, base + span * 0.85);
    // No pre-baked caption: the heading is built by describeField() from the
    // metadata, so the unit and range shown always match what was written.
    panels.push({ key, label, data: parseCol2(buf), meta: side });
  }

  const n = panels[0].data.nFrames;
  for (const p of panels) {
    if (p.data.nFrames !== n || p.data.nNodes !== panels[0].data.nNodes) {
      throw new Error(
        `${p.meta.file} is ${p.data.nFrames}x${p.data.nNodes}, expected ` +
        `${n}x${panels[0].data.nNodes} — the sides were built from different runs.`);
    }
  }
  onStatus('Building scenes…', 96);
  return { panels, meta };
}

export const REGION_NAMES = [
  'force_keep', 'barrier_fine', 'barrier_coarse', 'veh_contact', 'veh_near', 'veh_far',
];


/** What a panel is coloured by, spelled out with units and range.
 *
 *  The panel heading is where a reader decides whether two pictures are
 *  comparable, so it carries the unit and the span rather than just a name:
 *  "plastic strain · 0.001–2.0 (log)" beside "position error · 0–451 mm" is
 *  self-evidently two different measurements, where "plastic strain" beside
 *  "|pred − truth|" was not.
 */
export function describeField(m: SideMeta): string {
  const hi = m.scale >= 100 ? m.scale.toFixed(0)
    : m.scale >= 10 ? m.scale.toFixed(1)
      : m.scale.toFixed(2);
  const lo = m.transform === 'log' && m.floor ? `${m.floor}` : '0';
  const unit = m.unit ? ` ${m.unit}` : '';
  const shape = m.transform === 'log' ? ' (log)' : '';
  const name = m.field === 'position_error' ? 'position error'
    : m.field === 'eff_plastic_strain' ? 'plastic strain'
      : m.field.replace(/_/g, ' ');
  return `${name} · ${lo}–${hi}${unit}${shape}`;
}
