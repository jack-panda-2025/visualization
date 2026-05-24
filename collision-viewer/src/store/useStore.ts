import { create } from 'zustand';
import { TRACK_COLORS } from '../lib/constants';

export interface TrackedPoint {
  idx: number;
  label: string;
  color: string;
  hidden: boolean;
}

export type ViewMode = 'stress' | 'partColor' | 'mesh';

interface SimStore {
  loaded: boolean;
  curFrame: number;
  playing: boolean;
  hiddenParts: Set<number>;
  trackedPoints: TrackedPoint[];
  chartTarget: TrackedPoint | null;
  activeTab: 'track' | 'mesh' | 'inspect';
  viewMode: ViewMode;
  meshOpacity: number;
  meshWireframe: boolean;
  meshBuilt: boolean;

  setLoaded: (v: boolean) => void;
  setFrame: (fi: number) => void;
  setPlaying: (v: boolean) => void;
  setHiddenParts: (s: Set<number>) => void;
  togglePart: (pid: number) => void;
  addTrackedPoint: (idx: number) => void;
  removeTrackedPoint: (i: number) => void;
  toggleTrackHidden: (i: number) => void;
  setChartTarget: (tp: TrackedPoint | null) => void;
  setActiveTab: (tab: 'track' | 'mesh' | 'inspect') => void;
  setViewMode: (m: ViewMode) => void;
  setMeshOpacity: (v: number) => void;
  setMeshWireframe: (v: boolean) => void;
  setMeshBuilt: (v: boolean) => void;
  inspectPartIds: number[];
  addInspectPart: (pid: number) => void;
  removeInspectPart: (pid: number) => void;
}

export const useStore = create<SimStore>((set, get) => ({
  loaded: false,
  curFrame: 0,
  playing: false,
  hiddenParts: new Set(),
  trackedPoints: [],
  chartTarget: null,
  activeTab: 'track',
  viewMode: 'stress',
  meshOpacity: 0.75,
  meshWireframe: true,
  meshBuilt: false,
  inspectPartIds: [],

  setLoaded: (v) => set({ loaded: v }),
  setFrame: (fi) => set({ curFrame: fi }),
  setPlaying: (v) => set({ playing: v }),
  setHiddenParts: (s) => set({ hiddenParts: new Set(s) }),

  togglePart: (pid) => {
    const next = new Set(get().hiddenParts);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    set({ hiddenParts: next });
  },

  addTrackedPoint: (idx) => {
    const { trackedPoints } = get();
    if (trackedPoints.some(tp => tp.idx === idx)) return;
    const color = TRACK_COLORS[trackedPoints.length % TRACK_COLORS.length];
    const newTp: TrackedPoint = { idx, label: 'Node', color, hidden: false };
    set({ trackedPoints: [...trackedPoints, newTp], activeTab: 'track' });
  },

  removeTrackedPoint: (i) => {
    const pts = get().trackedPoints.filter((_, j) => j !== i);
    set({ trackedPoints: pts });
  },

  toggleTrackHidden: (i) => {
    const pts = get().trackedPoints.map((tp, j) =>
      j === i ? { ...tp, hidden: !tp.hidden } : tp
    );
    set({ trackedPoints: pts });
  },

  setChartTarget: (tp) => set({ chartTarget: tp }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setViewMode: (m) => set({ viewMode: m }),
  setMeshOpacity: (v) => set({ meshOpacity: v }),
  setMeshWireframe: (v) => set({ meshWireframe: v }),
  setMeshBuilt: (v) => set({ meshBuilt: v }),
  addInspectPart: (pid) => {
    const { inspectPartIds } = get();
    if (inspectPartIds.includes(pid)) return;
    set({ inspectPartIds: [...inspectPartIds, pid] });
  },
  removeInspectPart: (pid) => set({ inspectPartIds: get().inspectPartIds.filter(p => p !== pid) }),
}));
