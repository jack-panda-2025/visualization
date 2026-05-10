import { PARTS_DATA } from './partsData';

export const DATA_URL = 'collision_light.bin';
export const FRAME_MS = 50;
export const TIRE_RPM = 300;
export const TIRE_OUTER_MIN_RADIUS = 550;
export const TRACK_COLORS = ['#FF4455', '#44FF88', '#FFD700', '#00FFFF', '#FF88FF', '#FF9944'];

export type PresetKey = 'all' | 'cabin_interior' | 'no_roof' | 'no_doors' | 'structure_only' | 'barrier_only';

export interface Preset {
  label: string;
  color: string;
  buildHidden: () => Set<number>;
}

export const PRESETS: Record<PresetKey, Preset> = {
  all: {
    label: '显示全部',
    color: '#378ADD',
    buildHidden: () => new Set(),
  },
  cabin_interior: {
    label: '仅驾驶舱内部',
    color: '#4CAF50',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => { if (!p.zone.startsWith('驾驶舱')) s.add(p.id); });
      return s;
    },
  },
  no_roof: {
    label: '隐藏顶棚',
    color: '#FF9800',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => { if (p.zone.includes('顶部')) s.add(p.id); });
      return s;
    },
  },
  no_doors: {
    label: '隐藏车门侧板',
    color: '#9C27B0',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => { if (p.zone.includes('上部/左') || p.zone.includes('上部/右')) s.add(p.id); });
      return s;
    },
  },
  structure_only: {
    label: '仅主要结构',
    color: '#F44336',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => {
        if (p.zone.includes('顶部') || p.zone.includes('上部/左') || p.zone.includes('上部/右')) s.add(p.id);
      });
      return s;
    },
  },
  barrier_only: {
    label: '仅护栏',
    color: '#607D8B',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => { if (p.zone !== '护栏') s.add(p.id); });
      return s;
    },
  },
};

export const ZONE_LABELS: Record<string, string> = {
  '驾驶舱': '🚗',
  '前舱': '⚙️',
  '后舱': '🪑',
  '车尾': '📦',
  '护栏': '🚧',
  '全部': '🌐',
};

export const ZLAYER_RANGES: Record<string, { min: number; max: number }> = {
  '顶部': { min: 1200, max: Infinity },
  '上部': { min: 800, max: 1200 },
  '中部': { min: 400, max: 800 },
  '底部': { min: -Infinity, max: 400 },
};
