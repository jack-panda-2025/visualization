import type { TrackedPoint } from '../../store/useStore';
import { getSimData, nodeStressStr } from '../../lib/simData';
import { partZoneMap } from '../../lib/partsData';

interface Props {
  nodeIdx: number;
  x: number;
  y: number;
  curFrame: number;
  trackedPoints: TrackedPoint[];
  onAddTrack: () => void;
  onShowCurve: (tp: TrackedPoint) => void;
  onClose: () => void;
}

export default function Tooltip({ nodeIdx, x, y, curFrame, trackedPoints, onAddTrack, onShowCurve, onClose }: Props) {
  const data = getSimData();
  if (!data) return null;

  const pid = data.partArr[nodeIdx];
  const zone = partZoneMap[pid] ?? '未知';
  const layer = data.layerArr[nodeIdx];
  const typeStr = layer === 0 ? '护栏（Von Mises）' : '车身（PEEQ）';
  const valStr = nodeStressStr(nodeIdx, curFrame);
  const pos = data.posFrames[curFrame];
  const posStr = `${pos[nodeIdx * 3].toFixed(0)}, ${pos[nodeIdx * 3 + 1].toFixed(0)}, ${pos[nodeIdx * 3 + 2].toFixed(0)}`;

  const existingTp = trackedPoints.find(tp => tp.idx === nodeIdx);

  // Build a temporary tp for showing curve from tooltip
  const tempTp: TrackedPoint = existingTp ?? {
    idx: nodeIdx,
    label: zone,
    color: '#00FFAA',
    hidden: false,
  };

  return (
    <div
      className="tooltip"
      style={{ left: x, top: y, display: 'block' }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="tt-close" onClick={onClose}>✕</div>
      <div className="tt-title">{zone}</div>
      <div className="tt-row"><span className="tt-key">Part ID</span><span className="tt-val">{pid}</span></div>
      <div className="tt-row"><span className="tt-key">区域</span><span className="tt-val">{zone}</span></div>
      <div className="tt-row"><span className="tt-key">类型</span><span className="tt-val">{typeStr}</span></div>
      <div className="tt-row"><span className="tt-key">应力/应变</span><span className="tt-val">{valStr}</span></div>
      <div className="tt-row"><span className="tt-key">位置</span><span className="tt-val">{posStr}</span></div>
      <button className="tt-curve-btn" onClick={() => { onClose(); onShowCurve(tempTp); }}>
        📈 应力曲线
      </button>
      {!existingTp && (
        <button className="tt-track-btn" onClick={() => { onAddTrack(); onClose(); }}>
          📌 跟踪此点
        </button>
      )}
    </div>
  );
}
