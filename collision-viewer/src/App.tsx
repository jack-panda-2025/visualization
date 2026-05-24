import { useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from './store/useStore';
import type { TrackedPoint } from './store/useStore';
import { parseBin } from './lib/parseBin';
import { setSimData } from './lib/simData';
import { fetchSignedUrl } from './lib/api';
import type { SimulationItem } from './lib/api';
import { DATA_URL } from './lib/constants';
import Loading from './components/Loading';
import SimSelector from './components/SimSelector';
import Sidebar from './components/Sidebar';
import Viewer from './components/Viewer';
import type { SceneAPI } from './components/Viewer';
import Controls from './components/Controls';
import StressChartModal from './components/Chart/StressChartModal';

// 有后端时走选择界面，否则直接读本地文件
const USE_BACKEND = !!import.meta.env.VITE_API_BASE_URL;

export default function App() {
  const [phase, setPhase] = useState<'select' | 'loading' | 'ready'>(
    USE_BACKEND ? 'select' : 'loading'
  );
  const [loadState, setLoadState] = useState<{ text: string; progress: number; error?: string }>({
    text: '', progress: 0,
  });
  const [chartTarget, setChartTarget] = useState<TrackedPoint | null>(null);
  const { loaded, setLoaded, curFrame, setFrame } = useStore();
  const sceneRef = useRef<SceneAPI | null>(null);

  // Sync view mode with active tab
  const activeTab = useStore(s => s.activeTab);
  useEffect(() => {
    if (!loaded || !sceneRef.current) return;
    if (activeTab === 'mesh') {
      if (useStore.getState().meshBuilt) sceneRef.current.setViewMode('mesh');
    } else {
      sceneRef.current.setViewMode('stress');
    }
  }, [activeTab, loaded]);

  const loadSimulation = useCallback(async (dataUrl: string) => {
    setPhase('loading');
    try {
      setLoadState({ text: '下载数据...', progress: 10 });
      const resp = await fetch(dataUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const total = parseInt(resp.headers.get('content-length') ?? '0');
      const reader = resp.body!.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) setLoadState({ text: '下载数据...', progress: 10 + 65 * received / total });
      }

      setLoadState({ text: '解析数据...', progress: 78 });
      const merged = new Uint8Array(received);
      let o = 0;
      for (const c of chunks) { merged.set(c, o); o += c.length; }
      const simData = parseBin(merged.buffer);
      setSimData(simData);

      setLoadState({ text: '构建场景...', progress: 90 });

      const p0 = simData.posFrames[0];
      function findClosest(tx: number, ty: number, tz: number, filterFn?: (i: number) => boolean) {
        let best = -1, bestD = Infinity;
        for (let i = 0; i < simData.meta.n_nodes; i++) {
          if (filterFn && !filterFn(i)) continue;
          const dx = p0[i * 3] - tx, dy = p0[i * 3 + 1] - ty, dz = p0[i * 3 + 2] - tz;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; best = i; }
        }
        return best;
      }

      const buttIdx = findClosest(-5203, 1007, 1729);
      const headIdx = findClosest(-5332, 1200, 2934);

      const sampleFrames = [
        Math.floor(simData.meta.n_frames * 0.4),
        Math.floor(simData.meta.n_frames * 0.6),
        Math.floor(simData.meta.n_frames * 0.8),
        simData.meta.n_frames - 1,
      ];
      let impactIdx = -1, impactMaxVal = 0;
      for (let i = 0; i < simData.meta.n_nodes; i++) {
        if (simData.layerArr[i] !== 1) continue;
        let nodeMax = 0;
        for (const fi of sampleFrames) {
          const v = simData.valFrames[fi][i];
          if (v > nodeMax) nodeMax = v;
        }
        if (nodeMax > impactMaxVal) { impactMaxVal = nodeMax; impactIdx = i; }
      }

      const initialPoints: TrackedPoint[] = [];
      if (buttIdx >= 0) initialPoints.push({ idx: buttIdx, label: '座椅中部（臀部）', color: '#FFD700', hidden: false });
      if (headIdx >= 0) initialPoints.push({ idx: headIdx, label: '座椅上部（头部）', color: '#FF4455', hidden: false });
      if (impactIdx >= 0) initialPoints.push({ idx: impactIdx, label: '车身碰撞点（峰值应力）', color: '#00FFAA', hidden: false });

      useStore.setState({ trackedPoints: initialPoints, activeTab: 'track', meshBuilt: false });
      setLoadState({ text: '完成', progress: 100 });
      setTimeout(() => { setLoaded(true); setPhase('ready'); }, 250);
    } catch (err) {
      setLoadState({ text: '', progress: 0, error: `加载失败：${(err as Error).message}` });
    }
  }, [setLoaded]);

  // 无后端时直接加载本地文件
  useEffect(() => {
    if (!USE_BACKEND) loadSimulation(DATA_URL);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectSim = useCallback(async (sim: SimulationItem) => {
    try {
      setPhase('loading');
      setLoadState({ text: '获取下载链接...', progress: 5 });
      const url = await fetchSignedUrl(sim.id);
      await loadSimulation(url);
    } catch (err) {
      setLoadState({ text: '', progress: 0, error: `获取链接失败：${(err as Error).message}` });
    }
  }, [loadSimulation]);

  const handleFrameChange = useCallback((fi: number) => setFrame(fi), [setFrame]);
  const handleShowCurve = useCallback((tp: TrackedPoint) => setChartTarget(tp), []);

  const handleBuildMesh = useCallback(async () => {
    sceneRef.current?.setViewMode('mesh');
    await sceneRef.current?.buildMeshView();
  }, []);

  const handleBuildInspect = useCallback(async (pids: number[]) => {
    await sceneRef.current?.buildInspectMesh(pids);
  }, []);

  const handleMeshOpacityChange = useCallback((v: number) => {
    sceneRef.current?.updateMeshOpacity(v, useStore.getState().meshWireframe);
  }, []);

  const handleMeshWireframeChange = useCallback((v: boolean) => {
    sceneRef.current?.updateMeshOpacity(useStore.getState().meshOpacity, v);
  }, []);

  return (
    <div className="app-layout">
      {phase === 'select' && (
        <SimSelector onSelect={handleSelectSim} />
      )}
      {phase === 'loading' && (
        <Loading text={loadState.text} progress={loadState.progress} error={loadState.error} />
      )}
      {phase === 'ready' && (
        <>
          <Sidebar
            onShowCurve={handleShowCurve}
            onBuildMesh={handleBuildMesh}
            onMeshOpacityChange={handleMeshOpacityChange}
            onMeshWireframeChange={handleMeshWireframeChange}
            onBuildInspect={handleBuildInspect}
          />
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <Viewer onShowCurve={handleShowCurve} sceneRef={sceneRef} />
            <Controls onFrameChange={handleFrameChange} />
          </div>
        </>
      )}
      {chartTarget && (
        <StressChartModal target={chartTarget} curFrame={curFrame} onClose={() => setChartTarget(null)} />
      )}
    </div>
  );
}
