import { useRef, useEffect, useCallback, useState } from 'react';
import { useThreeScene } from '../../hooks/useThreeScene';
import { usePlayback } from '../../hooks/usePlayback';
import { useStore } from '../../store/useStore';
import type { TrackedPoint, ViewMode } from '../../store/useStore';
import { getSimData } from '../../lib/simData';
import { partZoneMap } from '../../lib/partsData';
import { TRACK_COLORS } from '../../lib/constants';
import Tooltip from './Tooltip';

interface Props {
  onShowCurve: (tp: TrackedPoint) => void;
  // Exposed for App to wire up Sidebar
  sceneRef: React.MutableRefObject<SceneAPI | null>;
}

export interface SceneAPI {
  buildMeshView: () => Promise<void>;
  setViewMode: (m: ViewMode) => void;
  updateMeshOpacity: (v: number, wf: boolean) => void;
}

export default function Viewer({ onShowCurve, sceneRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    buildScene, applyFrame, updateTrackSpheres,
    focusTarget, intersectSpheres, getDomElement,
    buildMeshView, updateMeshOpacity, setViewMode,
  } = useThreeScene(containerRef);

  const curFrame = useStore(s => s.curFrame);
  const trackedPoints = useStore(s => s.trackedPoints);
  const hiddenPartsSize = useStore(s => s.hiddenParts.size);
  const meshOpacity = useStore(s => s.meshOpacity);
  const meshWireframe = useStore(s => s.meshWireframe);

  const [tooltip, setTooltip] = useState<{ nodeIdx: number; x: number; y: number } | null>(null);

  // Expose API to parent
  useEffect(() => {
    sceneRef.current = {
      buildMeshView: () => buildMeshView(meshOpacity, meshWireframe),
      setViewMode,
      updateMeshOpacity: (v, wf) => updateMeshOpacity(v, wf),
    };
  }, [buildMeshView, setViewMode, updateMeshOpacity, meshOpacity, meshWireframe, sceneRef]);

  const handleFrame = useCallback((fi: number) => {
    applyFrame(fi);
    updateTrackSpheres(fi, useStore.getState().trackedPoints);
  }, [applyFrame, updateTrackSpheres]);

  usePlayback(handleFrame);

  useEffect(() => {
    applyFrame(curFrame);
    updateTrackSpheres(curFrame, trackedPoints);
  }, [trackedPoints, hiddenPartsSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const loaded = useStore(s => s.loaded);
  useEffect(() => {
    if (loaded) {
      buildScene();
      applyFrame(0);
      updateTrackSpheres(0, useStore.getState().trackedPoints);
    }
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => focusTarget(-1962, 15, 643, 400);
    document.addEventListener('focus-driver', handler);
    return () => document.removeEventListener('focus-driver', handler);
  }, [focusTarget]);

  const isDraggingRef = useRef(false);
  const mouseDownRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const dx = e.clientX - mouseDownRef.current.x;
    const dy = e.clientY - mouseDownRef.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > 4) isDraggingRef.current = true;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isDraggingRef.current) return;
    setTooltip(null);
    const tpIdx = intersectSpheres(e.clientX, e.clientY);
    if (tpIdx === null) return;
    const tp = useStore.getState().trackedPoints[tpIdx];
    if (!tp) return;
    const dom = getDomElement();
    if (!dom) return;
    const rect = dom.getBoundingClientRect();
    const x = Math.min(e.clientX - rect.left + 16, rect.width - 210);
    const y = Math.min(e.clientY - rect.top - 10, rect.height - 200);
    setTooltip({ nodeIdx: tp.idx, x, y });
  }, [intersectSpheres, getDomElement]);

  const handleAddTrack = useCallback(() => {
    if (!tooltip) return;
    const data = getSimData();
    if (!data) return;
    const nodeIdx = tooltip.nodeIdx;
    const pts = useStore.getState().trackedPoints;
    if (pts.some(tp => tp.idx === nodeIdx)) return;
    const color = TRACK_COLORS[pts.length % TRACK_COLORS.length];
    const pid = data.partArr[nodeIdx];
    const zone = partZoneMap[pid] ?? '未知';
    useStore.setState(s => ({
      trackedPoints: [...s.trackedPoints, { idx: nodeIdx, label: zone, color, hidden: false }],
      activeTab: 'track',
    }));
    updateTrackSpheres(curFrame, useStore.getState().trackedPoints);
  }, [tooltip, curFrame, updateTrackSpheres]);

  const viewMode = useStore(s => s.viewMode);
  const viewLabel = viewMode === 'stress' ? 'PEEQ / Von Mises' : viewMode === 'partColor' ? '部件颜色' : '网格视图';

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100vh' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
      />
      {tooltip && (
        <Tooltip
          nodeIdx={tooltip.nodeIdx}
          x={tooltip.x}
          y={tooltip.y}
          curFrame={curFrame}
          trackedPoints={trackedPoints}
          onAddTrack={handleAddTrack}
          onShowCurve={onShowCurve}
          onClose={() => setTooltip(null)}
        />
      )}
      <div className="top-bar">
        <div className="viewer-title">碰撞仿真 — {viewLabel}</div>
        <div className="viewer-hint">左键旋转 · 右键平移 · 滚轮缩放</div>
      </div>
    </div>
  );
}
