import { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';

interface Props {
  onBuildMesh: () => Promise<void>;
  onOpacityChange: (v: number) => void;
  onWireframeChange: (v: boolean) => void;
}

export default function MeshView({ onBuildMesh, onOpacityChange, onWireframeChange }: Props) {
  const { meshOpacity, meshWireframe, meshBuilt,
    setMeshOpacity, setMeshWireframe, setMeshBuilt } = useStore();
  const [building, setBuilding] = useState(false);

  const handleBuild = async () => {
    setBuilding(true);
    setMeshBuilt(false);
    await onBuildMesh();
    setMeshBuilt(true);
    setBuilding(false);
  };

  // Auto-build on first mount (when tab is opened for the first time)
  useEffect(() => {
    if (!meshBuilt) handleBuild();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpacity = (v: number) => {
    setMeshOpacity(v);
    onOpacityChange(v);
  };

  const handleWireframe = (v: boolean) => {
    setMeshWireframe(v);
    onWireframeChange(v);
  };

  return (
    <div className="mesh-view">
      <button
        className={`rebuild-btn${building ? ' loading' : ''}`}
        onClick={handleBuild}
        disabled={building}
        style={{ marginTop: 12 }}
      >
        {building ? '构建中…' : meshBuilt ? '重建网格' : '构建网格'}
      </button>

      {meshBuilt && (
        <>
          <div className="divider" style={{ margin: '10px 0' }} />

          <div className="mesh-ctrl-row">
            <span className="mesh-ctrl-label">透明度</span>
            <input
              type="range" min={0.05} max={1} step={0.05}
              value={meshOpacity}
              onChange={e => handleOpacity(parseFloat(e.target.value))}
              className="mesh-slider"
            />
            <span className="mesh-ctrl-val">{Math.round(meshOpacity * 100)}%</span>
          </div>

          <div className="mesh-ctrl-row" style={{ marginTop: 6 }}>
            <label className="mesh-check-label">
              <input type="checkbox" checked={meshWireframe}
                onChange={e => handleWireframe(e.target.checked)} />
              显示线框
            </label>
          </div>
        </>
      )}

      {!meshBuilt && (
        <div className="mesh-hint" style={{ marginTop: 8 }}>
          构建后，所有部件渲染为凸包面网格，并随动画实时更新。
        </div>
      )}
    </div>
  );
}
