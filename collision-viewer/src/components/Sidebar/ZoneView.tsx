import { useStore } from '../../store/useStore';
import { PARTS_DATA } from '../../lib/partsData';
import { PRESETS, ZONE_LABELS } from '../../lib/constants';
import type { PresetKey } from '../../lib/constants';

const ZONES = ['Cabin', 'Front', 'Rear', 'Trunk', 'Barrier', 'All'];
const ZLAYERS = [
  { label: 'Top', sub: 'Z>1200', min: 1200, max: Infinity },
  { label: 'Upper', sub: '800~1200', min: 800, max: 1200 },
  { label: 'Mid', sub: '400~800', min: 400, max: 800 },
  { label: 'Bottom', sub: 'Z<400', min: -Infinity, max: 400 },
];

interface Props { onFrameRefresh: () => void; }

export default function ZoneView({ onFrameRefresh }: Props) {
  const setHiddenParts = useStore(s => s.setHiddenParts);

  const applyZone = (zone: string) => {
    const next = new Set<number>();
    if (zone !== 'All') PARTS_DATA.forEach(p => { if (!p.zone.startsWith(zone)) next.add(p.id); });
    setHiddenParts(next);
    onFrameRefresh();
  };

  const applyPreset = (key: PresetKey) => {
    setHiddenParts(PRESETS[key].buildHidden());
    onFrameRefresh();
  };

  const applyZLayer = (min: number, max: number) => {
    const next = new Set<number>();
    PARTS_DATA.forEach(p => { if (p.cz < min || p.cz >= max) next.add(p.id); });
    setHiddenParts(next);
    onFrameRefresh();
  };

  const presetKeys = Object.keys(PRESETS) as PresetKey[];

  return (
    <div className="zone-view">
      <div className="section-title">Quick Focus</div>
      <div className="zone-btn-grid">
        {ZONES.map(z => (
          <button key={z} className="zone-btn" onClick={() => applyZone(z)}>
            <span className="zb-icon">{ZONE_LABELS[z]}</span>
            <span className="zb-label">{z}</span>
          </button>
        ))}
      </div>

      <div className="divider" />
      <div className="section-title">Preset Combinations</div>
      <div className="zone-presets">
        {presetKeys.map(key => (
          <button key={key} className="preset-btn" onClick={() => applyPreset(key)}>
            <span className="pb-dot" style={{ background: PRESETS[key].color }} />
            {PRESETS[key].label}
          </button>
        ))}
      </div>

      <div className="divider" />
      <div className="section-title">Camera Focus</div>
      <div className="zone-presets">
        <button className="preset-btn" onClick={() => document.dispatchEvent(new CustomEvent('focus-driver'))}>
          <span className="pb-dot" style={{ background: '#FFD700' }} />
          Driver Seat (for node selection)
        </button>
      </div>

      <div className="divider" />
      <div className="section-title">Z-Axis Height Filter</div>
      <div className="zone-btn-grid">
        {ZLAYERS.map(z => (
          <button key={z.label} className="zone-btn" onClick={() => applyZLayer(z.min, z.max)}>
            {z.label}<br />
            <small style={{ opacity: 0.5 }}>{z.sub}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
