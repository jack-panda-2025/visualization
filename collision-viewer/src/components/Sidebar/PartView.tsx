import { useState, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import { PARTS_DATA } from '../../lib/partsData';
import type { PartInfo } from '../../lib/partsData';

const ZONE_ORDER = ['Cabin', 'Front', 'Rear', 'Trunk', 'Hood', 'Barrier'];

interface Props { onFrameRefresh: () => void; }

export default function PartView({ onFrameRefresh }: Props) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    PARTS_DATA.forEach(p => { if (p.zone !== 'Cabin') m[p.zone] = true; });
    return m;
  });
  const { hiddenParts, togglePart, setHiddenParts } = useStore();

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return PARTS_DATA.filter(p =>
      !q || String(p.id).includes(q) || p.zone.toLowerCase().includes(q)
    );
  }, [filter]);

  const grouped = useMemo(() => {
    const g: Record<string, PartInfo[]> = {};
    filtered.forEach(p => { (g[p.zone] = g[p.zone] ?? []).push(p); });
    return g;
  }, [filtered]);

  const zones = useMemo(() => {
    const keys = Object.keys(grouped);
    return [...ZONE_ORDER.filter(z => grouped[z]), ...keys.filter(z => !ZONE_ORDER.includes(z))];
  }, [grouped]);

  const showAll = () => { setHiddenParts(new Set()); onFrameRefresh(); };
  const hideAll = () => { setHiddenParts(new Set(PARTS_DATA.map(p => p.id))); onFrameRefresh(); };

  return (
    <div className="part-view">
      <div className="part-header">
        <input
          className="search-input"
          placeholder="Search part ID or zone..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <div className="part-actions">
          <button className="sb-btn" onClick={showAll}>Show All</button>
          <button className="sb-btn" onClick={hideAll}>Hide All</button>
        </div>
      </div>
      <div className="part-list">
        {zones.map(zone => (
          <div key={zone} className="zone-group">
            <div
              className={`zone-header${collapsed[zone] ? ' collapsed' : ''}`}
              onClick={() => setCollapsed(c => ({ ...c, [zone]: !c[zone] }))}
            >
              <div className="zh-left">
                <span className="zh-arrow">▾</span>
                <span>{zone}</span>
              </div>
              <span className="zone-count">{grouped[zone].length}</span>
            </div>
            {!collapsed[zone] && (
              <div className="zone-items">
                {grouped[zone].map(p => (
                  <div key={p.id} className={`part-item${hiddenParts.has(p.id) ? ' hidden-part' : ''}`}>
                    <input
                      type="checkbox"
                      className="part-checkbox"
                      checked={!hiddenParts.has(p.id)}
                      onChange={() => { togglePart(p.id); onFrameRefresh(); }}
                    />
                    <div className="part-label">{p.id}</div>
                    <div className="part-count">
                      {p.count > 999 ? Math.round(p.count / 1000) + 'k' : p.count}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
