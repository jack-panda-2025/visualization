import { useStore } from '../../store/useStore';
import type { TrackedPoint } from '../../store/useStore';
import TrackView from './TrackView';
import MeshView from './MeshView';
import InspectView from './InspectView';

const TABS = [
  { key: 'track',   label: '跟踪' },
  { key: 'mesh',    label: '网格' },
  { key: 'inspect', label: '检查' },
] as const;

interface Props {
  onShowCurve: (tp: TrackedPoint) => void;
  onBuildMesh: () => Promise<void>;
  onMeshOpacityChange: (v: number) => void;
  onMeshWireframeChange: (v: boolean) => void;
  onBuildInspect: (pids: number[]) => Promise<void>;
}

export default function Sidebar({
  onShowCurve,
  onBuildMesh, onMeshOpacityChange, onMeshWireframeChange,
  onBuildInspect,
}: Props) {
  const { activeTab, setActiveTab } = useStore();

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            className={`tab-btn${activeTab === key ? ' active' : ''}`}
            onClick={() => setActiveTab(key as typeof activeTab)}
          >
            {label}
          </button>
        ))}
      </div>
      {activeTab === 'track'   && <TrackView onShowCurve={onShowCurve} onBuildInspect={onBuildInspect} />}
      {activeTab === 'mesh'    && (
        <MeshView
          onBuildMesh={onBuildMesh}
          onOpacityChange={onMeshOpacityChange}
          onWireframeChange={onMeshWireframeChange}
        />
      )}
      {activeTab === 'inspect' && <InspectView onBuildInspect={onBuildInspect} />}
    </div>
  );
}
