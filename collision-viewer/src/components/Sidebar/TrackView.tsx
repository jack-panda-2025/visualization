import { useStore } from '../../store/useStore';
import type { TrackedPoint } from '../../store/useStore';
import { nodeStressStr } from '../../lib/simData';

interface Props {
  onShowCurve: (tp: TrackedPoint) => void;
}

export default function TrackView({ onShowCurve }: Props) {
  const { curFrame, trackedPoints, removeTrackedPoint, toggleTrackHidden } = useStore();

  if (!trackedPoints.length) {
    return (
      <div className="track-view">
        <div className="track-empty">
          点击 3D 视图中的节点<br />
          再点击「📌 跟踪此点」<br />
          即可添加跟踪
        </div>
      </div>
    );
  }

  return (
    <div className="track-view">
      {trackedPoints.map((tp, i) => {
        const valStr = nodeStressStr(tp.idx, curFrame);
        return (
          <TrackItem
            key={i}
            tp={tp}
            valStr={valStr}
            onRemove={() => removeTrackedPoint(i)}
            onToggleHide={() => toggleTrackHidden(i)}
            onShowCurve={() => onShowCurve(tp)}
          />
        );
      })}
    </div>
  );
}

interface ItemProps {
  tp: TrackedPoint;
  valStr: string;
  onRemove: () => void;
  onToggleHide: () => void;
  onShowCurve: () => void;
}

function TrackItem({ tp, valStr, onRemove, onToggleHide, onShowCurve }: ItemProps) {
  return (
    <div className="track-item">
      <div className="track-item-header">
        <div className="track-dot" style={{ background: tp.color, color: tp.color }} />
        <div className="track-label" title={tp.label}>{tp.label}</div>
        <span className="track-remove" onClick={onRemove}>✕</span>
      </div>
      <div className="track-val">{valStr}</div>
      <div className="track-btns">
        <button
          className={`track-locate-btn${tp.hidden ? ' hidden-marker' : ''}`}
          onClick={onToggleHide}
        >
          {tp.hidden ? '● 隐藏中' : '● 显示中'}
        </button>
        <button className="track-curve-btn" onClick={onShowCurve}>
          📈 应力曲线
        </button>
      </div>
    </div>
  );
}
