import { useMemo } from 'react';
import type { CaseManifest, Selection } from '../lib/cases';
import { availableFor, anywhere, findCase } from '../lib/cases';

/** Condition dropdowns, driven entirely by the case manifest.
 *
 *  Options are never hidden. An engineer reading this needs to see the whole
 *  envelope the study is meant to cover and which parts of it have data yet,
 *  so unavailable values stay listed and say why — distinguishing "no run at
 *  this value at all" from "no run at this value in this combination".
 *
 *  Native <select> on purpose: keyboard and screen-reader behaviour comes for
 *  free, which a custom dropdown would have to re-earn.
 */
export default function CaseSelector({ manifest, selection, onChange }: {
  manifest: CaseManifest;
  selection: Selection;
  onChange: (s: Selection) => void;
}) {
  const resolved = useMemo(() => findCase(manifest, selection), [manifest, selection]);

  // Three states per option, and they mean different things to whoever has to
  // act on them: open it, wait for a conversion, or commission a simulation.
  const ready = {
    speed_kmh: availableFor(manifest, selection, 'speed_kmh', 'ready'),
    angle_deg: availableFor(manifest, selection, 'angle_deg', 'ready'),
    barrier: availableFor(manifest, selection, 'barrier', 'ready'),
  };
  const pending = {
    speed_kmh: availableFor(manifest, selection, 'speed_kmh', 'pending'),
    angle_deg: availableFor(manifest, selection, 'angle_deg', 'pending'),
    barrier: availableFor(manifest, selection, 'barrier', 'pending'),
  };
  const ever = {
    speed_kmh: anywhere(manifest, 'speed_kmh'),
    angle_deg: anywhere(manifest, 'angle_deg'),
    barrier: anywhere(manifest, 'barrier'),
  };

  type Dim = keyof typeof ready;
  const has = (s: ReadonlySet<unknown>, v: number | string) => s.has(v);
  const why = (dim: Dim, v: number | string): string => {
    if (has(ready[dim], v)) return '';
    if (has(pending[dim], v)) return ' — simulated, viewer data pending';
    if (has(ever[dim], v)) return ' — not in this combination';
    return ' — not yet simulated';
  };

  return (
    <>
      <div className="cmp-side-head">Impact conditions</div>

      <label className="cmp-select">
        <span>Impact speed</span>
        <select value={selection.speed_kmh}
          onChange={e => onChange({ ...selection, speed_kmh: +e.target.value })}>
          {manifest.dimensions.speed_kmh.map(v => (
            <option key={v} value={v} disabled={!has(ready.speed_kmh, v)}>
              {v} km/h{why('speed_kmh', v)}
            </option>
          ))}
        </select>
      </label>

      <label className="cmp-select">
        <span>Impact angle</span>
        <select value={selection.angle_deg}
          onChange={e => onChange({ ...selection, angle_deg: +e.target.value })}>
          {manifest.dimensions.angle_deg.map(v => (
            <option key={v} value={v} disabled={!has(ready.angle_deg, v)}>
              {v}°{why('angle_deg', v)}
            </option>
          ))}
        </select>
      </label>

      <label className="cmp-select">
        <span>Barrier design</span>
        <select value={selection.barrier}
          onChange={e => onChange({ ...selection, barrier: e.target.value })}>
          {manifest.dimensions.barrier.map(b => (
            <option key={b.id} value={b.id} disabled={!has(ready.barrier, b.id)}>
              {b.label}{why('barrier', b.id)}
            </option>
          ))}
        </select>
      </label>

      {resolved === null
        ? <p className="cmp-prov missing">
            No LS-DYNA run exists for this combination.
          </p>
        : resolved.status === 'pending'
          ? <p className="cmp-prov unvalidated">
              Simulated, but the viewer data has not been generated yet — run
              the rollout and conversion for <code>{resolved.source_h5}</code>.
            </p>
          : resolved.validated
            ? <p className="cmp-prov">
                LS-DYNA simulation available — the truth panel is measured.
              </p>
            : <p className="cmp-prov unvalidated">
                No LS-DYNA run for this case. Model prediction only, not validated.
              </p>}
    </>
  );
}
