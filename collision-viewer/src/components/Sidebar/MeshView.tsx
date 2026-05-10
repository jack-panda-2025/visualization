import { useState } from 'react';
import { useStore } from '../../store/useStore';
import type { ViewMode } from '../../store/useStore';
import { PARTS_DATA } from '../../lib/partsData';
import { partColorHex } from '../../lib/partColors';

interface Props {
  onBuildMesh: () => Promise<void>;
  onViewModeChange: (m: ViewMode) => void;
  onOpacityChange: (v: number) => void;
  onWireframeChange: (v: boolean) => void;
}

const VIEW_MODES: { key: ViewMode; label: string; desc: string }[] = [
  { key: 'stress',    label: '应力色', desc: 'PEEQ / Von Mises 应力热图，支持动画' },
  { key: 'partColor', label: '部件色', desc: '每个部件独立颜色，支持动画' },
  { key: 'mesh',      label: '网格',   desc: '凸包近似网格，静态可透视内部' },
];

export default function MeshView({ onBuildMesh, onViewModeChange, onOpacityChange, onWireframeChange }: Props) {
  const { viewMode, meshOpacity, meshWireframe, meshBuilt, playing,
    setViewMode, setMeshOpacity, setMeshWireframe, setMeshBuilt } = useStore();
  const [building, setBuilding] = useState(false);
  const [filter, setFilter] = useState('');

  const handleModeClick = async (mode: ViewMode) => {
    setViewMode(mode);
    onViewModeChange(mode);
    if (mode === 'mesh' && !meshBuilt) {
      setBuilding(true);
      await onBuildMesh();
      setMeshBuilt(true);
      setBuilding(false);
    }
  };

  const handleRebuild = async () => {
    setBuilding(true);
    setMeshBuilt(false);
    await onBuildMesh();
    setMeshBuilt(true);
    setBuilding(false);
  };

  const handleOpacity = (v: number) => {
    setMeshOpacity(v);
    onOpacityChange(v);
  };

  const handleWireframe = (v: boolean) => {
    setMeshWireframe(v);
    onWireframeChange(v);
  };

  const filteredParts = PARTS_DATA.filter(p => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return String(p.id).includes(q) || p.zone.toLowerCase().includes(q);
  });

  return (
    <div className="mesh-view">
      {/* View mode selector */}
      <div className="section-title">渲染模式</div>
      <div className="view-mode-group">
        {VIEW_MODES.map(({ key, label, desc }) => (
          <button
            key={key}
            className={`view-mode-btn${viewMode === key ? ' active' : ''}`}
            onClick={() => handleModeClick(key)}
            disabled={building}
            title={desc}
          >
            <span className="vmb-label">{label}</span>
            <span className="vmb-desc">{desc}</span>
          </button>
        ))}
      </div>

      {/* Mesh controls */}
      {viewMode === 'mesh' && (
        <div className="mesh-controls">
          <div className="divider" />
          <div className="section-title">网格选项</div>

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

          <div className="mesh-ctrl-row">
            <label className="mesh-check-label">
              <input type="checkbox" checked={meshWireframe}
                onChange={e => handleWireframe(e.target.checked)} />
              显示线框
            </label>
          </div>

          <button
            className={`rebuild-btn${building ? ' loading' : ''}`}
            onClick={handleRebuild}
            disabled={building}
          >
            {building ? '构建中…' : meshBuilt ? '重建网格（当前帧）' : '构建网格'}
          </button>

          {playing && (
            <div className="mesh-hint">⚠ 网格模式不随动画更新，建议暂停后使用</div>
          )}

          <div className="mesh-hint">
            网格为凸包近似，适合查看零件外形。<br />
            降低透明度可透视车辆内部结构。
          </div>
        </div>
      )}

      {/* Part color legend */}
      {(viewMode === 'partColor' || viewMode === 'mesh') && (
        <>
          <div className="divider" />
          <div className="section-title">部件颜色图例</div>
          <input
            className="search-input"
            placeholder="搜索 part ID 或区域…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <div className="part-legend">
            {filteredParts.map(p => (
              <div key={p.id} className="legend-item">
                <span className="legend-dot" style={{ background: partColorHex.get(p.id) ?? '#888' }} />
                <span className="legend-id">{p.id}</span>
                <span className="legend-zone">{p.zone}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {viewMode === 'stress' && (
        <div className="mesh-hint" style={{ marginTop: 12 }}>
          应力模式下颜色代表 PEEQ / Von Mises 应力大小（蓝=低，红=高）。
          切换到「部件色」可按零件区分颜色。
        </div>
      )}
    </div>
  );
}
