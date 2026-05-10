import { useStore } from '../../store/useStore';
import type { TrackedPoint, ViewMode } from '../../store/useStore';
import ZoneView from './ZoneView';
import PartView from './PartView';
import TrackView from './TrackView';
import MeshView from './MeshView';

const TABS = [
  { key: 'zone',  label: '区域' },
  { key: 'part',  label: 'Part' },
  { key: 'track', label: '跟踪' },
  { key: 'mesh',  label: '部件/网格' },
] as const;

interface Props {
  onFrameRefresh: () => void;
  onShowCurve: (tp: TrackedPoint) => void;
  onBuildMesh: () => Promise<void>;
  onViewModeChange: (m: ViewMode) => void;
  onMeshOpacityChange: (v: number) => void;
  onMeshWireframeChange: (v: boolean) => void;
}

export default function Sidebar({
  onFrameRefresh, onShowCurve,
  onBuildMesh, onViewModeChange, onMeshOpacityChange, onMeshWireframeChange,
}: Props) {
  const { activeTab, setActiveTab } = useStore();

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            className={`tab-btn${activeTab === key ? ' active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {activeTab === 'zone'  && <ZoneView onFrameRefresh={onFrameRefresh} />}
      {activeTab === 'part'  && <PartView onFrameRefresh={onFrameRefresh} />}
      {activeTab === 'track' && <TrackView onShowCurve={onShowCurve} />}
      {activeTab === 'mesh'  && (
        <MeshView
          onBuildMesh={onBuildMesh}
          onViewModeChange={onViewModeChange}
          onOpacityChange={onMeshOpacityChange}
          onWireframeChange={onMeshWireframeChange}
        />
      )}
    </div>
  );
}
