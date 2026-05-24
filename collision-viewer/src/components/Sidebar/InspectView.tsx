import { useState, useCallback } from 'react';
import { useStore } from '../../store/useStore';
import { PARTS_DATA } from '../../lib/partsData';
import { getAvailablePartIds } from '../../lib/simData';

const INSPECT_COLORS = ['#FF6B35', '#FFD700', '#00FFCC', '#FF44AA', '#44AAFF', '#AAFFAA'];

interface Props {
  onBuildInspect: (pids: number[]) => Promise<void>;
}

function topZone(zone: string) {
  return zone.split('/')[0];
}

export default function InspectView({ onBuildInspect }: Props) {
  const { inspectPartIds } = useStore();
  const [filter, setFilter] = useState('');
  const [building, setBuilding] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const availableIds = getAvailablePartIds();
  const allParts = PARTS_DATA.filter(p => availableIds.has(p.id));

  const filtered = allParts.filter(p => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return String(p.id).includes(q) || p.zone.toLowerCase().includes(q);
  });

  // Build groups preserving zone order
  const groupOrder: string[] = [];
  const groups: Record<string, typeof filtered> = {};
  for (const p of filtered) {
    const g = topZone(p.zone);
    if (!groups[g]) { groups[g] = []; groupOrder.push(g); }
    groups[g].push(p);
  }

  const rebuild = useCallback(async (next: number[]) => {
    useStore.setState({ inspectPartIds: next });
    setBuilding(true);
    await onBuildInspect(next);
    setBuilding(false);
  }, [onBuildInspect]);

  const togglePart = (pid: number) => {
    if (building) return;
    const cur = useStore.getState().inspectPartIds;
    const next = cur.includes(pid) ? cur.filter(p => p !== pid) : [...cur, pid];
    rebuild(next);
  };

  const toggleGroup = (groupPids: number[]) => {
    if (building) return;
    const cur = useStore.getState().inspectPartIds;
    const allSelected = groupPids.every(pid => cur.includes(pid));
    const next = allSelected
      ? cur.filter(pid => !groupPids.includes(pid))
      : [...new Set([...cur, ...groupPids])];
    rebuild(next);
  };

  const selectAll = () => {
    if (building) return;
    const allPids = allParts.map(p => p.id);
    rebuild(allPids);
  };

  const clearAll = () => {
    if (building) return;
    rebuild([]);
  };

  return (
    <div className="inspect-view">
      <input
        className="search-input"
        placeholder="Search Part ID or Zone…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />

      <div className="inspect-global-bar">
        <button className="inspect-global-btn" onClick={selectAll} disabled={building}>Select All</button>
        <button className="inspect-global-btn" onClick={clearAll} disabled={building}>Clear</button>
        <span className="inspect-count">
          {inspectPartIds.length > 0 ? `Selected ${inspectPartIds.length}` : ''}
          {building ? ' · Rendering…' : ''}
        </span>
      </div>

      <div className="inspect-list">
        {groupOrder.map(g => {
          const parts = groups[g];
          const pids = parts.map(p => p.id);
          const selectedInGroup = pids.filter(pid => inspectPartIds.includes(pid)).length;
          const allSelected = selectedInGroup === pids.length;
          const isCollapsed = collapsed[g];

          return (
            <div key={g} className="inspect-group">
              <div className="inspect-group-header">
                <button
                  className="inspect-group-toggle"
                  onClick={() => setCollapsed(c => ({ ...c, [g]: !c[g] }))}
                >
                  {isCollapsed ? '▶' : '▼'}
                </button>
                <span className="inspect-group-name">{g}</span>
                <span className="inspect-group-count">{selectedInGroup}/{pids.length}</span>
                <button
                  className={`inspect-group-sel-btn${allSelected ? ' active' : ''}`}
                  onClick={() => toggleGroup(pids)}
                  disabled={building}
                >
                  {allSelected ? 'Deselect' : 'Select All'}
                </button>
              </div>

              {!isCollapsed && parts.map(p => {
                const selIdx = inspectPartIds.indexOf(p.id);
                const selected = selIdx >= 0;
                const color = selected ? INSPECT_COLORS[selIdx % INSPECT_COLORS.length] : undefined;
                return (
                  <div
                    key={p.id}
                    className={`inspect-row${selected ? ' selected' : ''}`}
                    style={selected ? { borderLeftColor: color } : undefined}
                    onClick={() => togglePart(p.id)}
                  >
                    {selected && <span className="inspect-row-dot" style={{ background: color }} />}
                    <span className="inspect-row-id">{p.id}</span>
                    <span className="inspect-row-zone">{p.zone}</span>
                    <span className="inspect-row-count">{p.count.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
