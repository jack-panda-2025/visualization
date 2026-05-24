import { useState, useEffect } from 'react';
import { fetchSimulations } from '../lib/api';
import type { SimulationItem } from '../lib/api';

interface Props {
  onSelect: (sim: SimulationItem) => void;
}

function formatSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatDate(iso: string) {
  return iso.slice(0, 10);
}

export default function SimSelector({ onSelect }: Props) {
  const [sims, setSims] = useState<SimulationItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSimulations()
      .then(setSims)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="sim-selector-overlay">
      <div className="sim-selector-card">
        <div className="sim-selector-title">Select Simulation File</div>

        {loading && <div className="sim-selector-hint">Loading list…</div>}
        {error   && <div className="sim-selector-error">{error}</div>}

        {!loading && !error && sims.length === 0 && (
          <div className="sim-selector-hint">No simulation files available</div>
        )}

        <div className="sim-list">
          {sims.map(sim => (
            <button
              key={sim.id}
              className="sim-row"
              onClick={() => onSelect(sim)}
            >
              <span className="sim-row-name">{sim.name}</span>
              <span className="sim-row-meta">
                {formatSize(sim.size)} · {formatDate(sim.last_modified)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
