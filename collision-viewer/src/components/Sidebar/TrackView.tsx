import { useStore } from '../../store/useStore';
import type { TrackedPoint } from '../../store/useStore';
import { nodeStressStr, getSimData } from '../../lib/simData';
import { PARTS_DATA } from '../../lib/partsData';
import InlineStressChart from '../Chart/InlineStressChart';

interface Props {
  onShowCurve: (tp: TrackedPoint) => void;
  onBuildInspect: (pids: number[]) => Promise<void>;
}

export default function TrackView({ onShowCurve, onBuildInspect }: Props) {
  const { curFrame, trackedPoints, removeTrackedPoint, toggleTrackHidden } = useStore();

  if (!trackedPoints.length) {
    return (
      <div className="track-view">
        <div className="track-empty">
          Click a node in the 3D view<br />
          then click "📌 Track this node"<br />
          to add a tracking point
        </div>
      </div>
    );
  }

  return (
    <div className="track-view">
      {trackedPoints.map((tp, i) => {
        const valStr = nodeStressStr(tp.idx, curFrame);
        const data = getSimData();
        const partId = data ? data.partArr[tp.idx] : null;
        const partInfo = partId ? PARTS_DATA.find(p => p.id === partId) : null;
        return (
          <TrackItem
            key={i}
            tp={tp}
            valStr={valStr}
            partId={partId}
            partZone={partInfo?.zone ?? null}
            curFrame={curFrame}
            onRemove={() => removeTrackedPoint(i)}
            onToggleHide={() => toggleTrackHidden(i)}
            onShowCurve={() => onShowCurve(tp)}
            onInspectPart={partId ? () => {
              useStore.setState({ activeTab: 'inspect' });
              const cur = useStore.getState().inspectPartIds;
              if (!cur.includes(partId)) useStore.getState().addInspectPart(partId);
              onBuildInspect([...new Set([...cur, partId])]);
            } : undefined}
          />
        );
      })}
    </div>
  );
}

interface ItemProps {
  tp: TrackedPoint;
  valStr: string;
  partId: number | null;
  partZone: string | null;
  curFrame: number;
  onRemove: () => void;
  onToggleHide: () => void;
  onShowCurve: () => void;
  onInspectPart?: () => void;
}

function TrackItem({ tp, valStr, partId, partZone, curFrame, onRemove, onToggleHide, onShowCurve, onInspectPart }: ItemProps) {
  return (
    <div className="track-item">
      <div className="track-item-header">
        <div className="track-dot" style={{ background: tp.color }} />
        <div className="track-label" title={tp.label}>{tp.label}</div>
        <span className="track-remove" onClick={onRemove}>✕</span>
      </div>
      {partId && (
        <div className="track-part-info">
          <span className="track-part-id">Part {partId}</span>
          {partZone && <span className="track-part-zone">{partZone}</span>}
          {onInspectPart && (
            <button className="track-inspect-btn" onClick={onInspectPart} title="Highlight this part in the Inspect tab">
              Inspect
            </button>
          )}
        </div>
      )}
      <div className="track-val">{valStr}</div>
      <InlineStressChart tp={tp} curFrame={curFrame} />
      <div className="track-btns">
        <button
          className={`track-locate-btn${tp.hidden ? ' hidden-marker' : ''}`}
          onClick={onToggleHide}
        >
          {tp.hidden ? '● Hidden' : '● Visible'}
        </button>
        <button className="track-curve-btn" onClick={onShowCurve}>
          📈 Stress Curve
        </button>
      </div>
    </div>
  );
}
