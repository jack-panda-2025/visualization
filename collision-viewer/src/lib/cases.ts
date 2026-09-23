// The case manifest: which condition combinations actually have data.
//
// Availability is read from public/cases.json, never hardcoded here, so a new
// LS-DYNA run plus a rollout only has to append an entry to that file for the
// selector to offer it. A combination with no matching case is presented as
// not yet simulated — a control that appears to work but silently returns
// another condition's result is worse than one that explains itself.

export interface BarrierDim {
  id: string;
  label: string;
  material: string;
  layers: number;
  thickness: number;
}

/** 'ready'   — COL2 files are present; the case can be opened.
 *  'pending' — the LS-DYNA run exists but the rollout and conversion have not
 *              been generated yet. Listed so the selector can say so, instead
 *              of implying the simulation itself is missing.
 *  A combination absent from `cases` entirely has no simulation at all. */
export type CaseStatus = 'ready' | 'pending';

export interface CaseEntry {
  id: string;             // also the COL2 file stem: <id>_gt.bin / <id>_pred.bin
  status: CaseStatus;
  speed_kmh: number;
  angle_deg: number;
  barrier: string;        // BarrierDim.id
  checkpoint: string;
  /** True when an LS-DYNA run exists for this combination, so the truth panel
   *  is measured rather than absent. False means prediction only. */
  validated: boolean;
  source_h5?: string;
}

export interface CaseManifest {
  schema: number;
  dimensions: {
    speed_kmh: number[];
    angle_deg: number[];
    barrier: BarrierDim[];
  };
  cases: CaseEntry[];
}

export interface Selection {
  speed_kmh: number;
  angle_deg: number;
  barrier: string;
}

export async function loadManifest(): Promise<CaseManifest | null> {
  try {
    const r = await fetch('cases.json');
    if (!r.ok) return null;
    const m: CaseManifest = await r.json();
    return m.cases?.length ? m : null;
  } catch {
    return null;         // no manifest: callers fall back to a fixed stem
  }
}

function matches(c: CaseEntry, sel: Selection): boolean {
  return c.speed_kmh === sel.speed_kmh
    && Math.abs(c.angle_deg - sel.angle_deg) < 1e-6
    && c.barrier === sel.barrier;
}

/** The case for a selection, whatever its status. */
export function findCase(m: CaseManifest, sel: Selection): CaseEntry | null {
  return m.cases.find(c => matches(c, sel)) ?? null;
}

/** Only an openable case — what the selector may actually navigate to. */
export function findReady(m: CaseManifest, sel: Selection): CaseEntry | null {
  return m.cases.find(c => matches(c, sel) && c.status === 'ready') ?? null;
}

export function selectionOf(c: CaseEntry): Selection {
  return { speed_kmh: c.speed_kmh, angle_deg: c.angle_deg, barrier: c.barrier };
}

/** Which values of one dimension are reachable, holding the other two fixed.
 *
 *  Driving each dropdown off the manifest this way means an option is enabled
 *  exactly when picking it lands on real data — the user never has to discover
 *  by trial which combinations exist.
 */
export function availableFor<K extends keyof Selection>(
  m: CaseManifest, sel: Selection, dim: K, status?: CaseStatus,
): Set<Selection[K]> {
  const out = new Set<Selection[K]>();
  for (const c of m.cases) {
    if (status && c.status !== status) continue;
    const cs = selectionOf(c);
    const othersMatch = (Object.keys(sel) as (keyof Selection)[])
      .filter(k => k !== dim)
      .every(k => k === 'angle_deg'
        ? Math.abs((cs[k] as number) - (sel[k] as number)) < 1e-6
        : cs[k] === sel[k]);
    if (othersMatch) out.add(cs[dim] as Selection[K]);
  }
  return out;
}

/** Every value of a dimension that appears in at least one case, regardless of
 *  the rest of the selection — used to explain *why* an option is unavailable:
 *  not simulated at all, versus not simulated in this combination. */
export function anywhere<K extends keyof Selection>(
  m: CaseManifest, dim: K,
): Set<Selection[K]> {
  return new Set(m.cases.map(c => selectionOf(c)[dim] as Selection[K]));
}
