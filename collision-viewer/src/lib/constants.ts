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
    label: 'Show All',
    color: '#378ADD',
    buildHidden: () => new Set(),
  },
  cabin_interior: {
    label: 'Cabin Interior Only',
    color: '#4CAF50',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => { if (!p.zone.startsWith('Cabin')) s.add(p.id); });
      return s;
    },
  },
  no_roof: {
    label: 'Hide Roof',
    color: '#FF9800',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => { if (p.zone.includes('Top')) s.add(p.id); });
      return s;
    },
  },
  no_doors: {
    label: 'Hide Door Panels',
    color: '#9C27B0',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => { if (p.zone.includes('Upper/Left') || p.zone.includes('Upper/Right')) s.add(p.id); });
      return s;
    },
  },
  structure_only: {
    label: 'Main Structure Only',
    color: '#F44336',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => {
        if (p.zone.includes('Top') || p.zone.includes('Upper/Left') || p.zone.includes('Upper/Right')) s.add(p.id);
      });
      return s;
    },
  },
  barrier_only: {
    label: 'Barrier Only',
    color: '#607D8B',
    buildHidden: () => {
      const s = new Set<number>();
      PARTS_DATA.forEach(p => { if (p.zone !== 'Barrier') s.add(p.id); });
      return s;
    },
  },
};

export const ZONE_LABELS: Record<string, string> = {
  'Cabin': '🚗',
  'Front': '⚙️',
  'Rear': '🪑',
  'Trunk': '📦',
  'Barrier': '🚧',
  'All': '🌐',
};

export const ZLAYER_RANGES: Record<string, { min: number; max: number }> = {
  'Top': { min: 1200, max: Infinity },
  'Upper': { min: 800, max: 1200 },
  'Mid': { min: 400, max: 800 },
  'Bottom': { min: -Infinity, max: 400 },
};
