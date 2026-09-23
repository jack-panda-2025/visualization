import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { RAMPS, rampForField, rampCssForField } from '../../lib/colors';
import type { RampName } from '../../lib/colors';
import { loadPair, REGION_NAMES, describeField } from '../../lib/compareData';
import type { Panel, PairMeta } from '../../lib/compareData';
import {
  buildGroupColors, GROUP_COLORS, GROUP_ORDER, INTERNAL_GROUPS, OUTER_GROUPS,
} from '../../lib/partGroups';
import Loading from '../Loading';
import CaseSelector from '../CaseSelector';
import { loadManifest, findReady, selectionOf } from '../../lib/cases';
import type { CaseManifest, Selection } from '../../lib/cases';

/**
 * Point-cloud comparison page — the whole sampled mesh, truth beside prediction.
 *
 * Deliberately standalone. The surface page renders the same data through a
 * completely different pipeline and answers a different question (what does
 * the body look like, vs where is every node), and the two were previously one
 * component with mode switches. That coupling kept producing bugs where a fix
 * on one side silently changed the other — hidden assemblies leaking across
 * views, a splat parameter reaching into the point shader. Nothing is shared
 * here but the data layer: COL2 parsing, the assembly rules and the colour ramp.
 */

const PLAY_MS = 90;
const FALLBACK_SPACING = 40;
const REGION_COLORS = [
  '#c9a227', '#a85751', '#7c6270', '#4f8f7d', '#4e7391', '#5a6472',
];
// Viewport ground, kept in step with --surface-3 in index.css. Dark inside
// light chrome, the way CAD and FE post-processors are: the shaded body reads
// as a solid object against it instead of washing out.
const GROUND = 0x171b21;
// Nodes below the field threshold. A neutral grey, lighter than the ground and
// off the ramp's hue, so it cannot be mistaken for cividis's dark-blue low end
// — which is a real low value, not an absent one.
const DIM: [number, number, number] = [0.14, 0.17, 0.34];

type ColorMode = 'field' | 'error' | 'group' | 'region';

const COLOR_MODES: { key: ColorMode; label: string; short: string; hint: string }[] = [
  { key: 'field', label: 'Field', short: 'each side’s own quantity — not comparable',
    hint: "Each panel's own quantity: plastic strain on the truth side, "
        + 'position error on the prediction side. Different units, different '
        + 'scales and deliberately different colour ramps — the two pictures '
        + 'are not comparable. Switch to Error for a like-for-like view.' },
  { key: 'error', label: 'Error', short: '|pred − truth|, one shared scale',
    hint: 'Both panels coloured by |prediction − truth| in mm, one shared '
        + 'scale, so the same defect is visible on the true geometry too.' },
  { key: 'group', label: 'Assembly', short: 'structure, not a measurement',
    hint: 'Coloured by assembly — hood, doors, barrier and so on, matching '
        + 'the key on the left. Structure, not a measured quantity.' },
  { key: 'region', label: 'Region', short: 'the sampler’s six regions',
    hint: 'Coloured by the sampler\'s six regions (veh_contact, veh_near, '
        + 'barrier_fine …), the same split as the checkboxes below.' },
];


// Per-point size in mm, so every region covers the same share of the surface
// it sits on: sampling runs from 14 mm inside the contact zone to 79 mm at the
// rear, and one shared size smears the first and scatters the second.
// (three's PointsMaterial default of 2.5 mm projects to 0.08 px here, pinned
// to the GL 1 px floor, which is why its size setting never did anything.)
const POINT_VERT = `
attribute vec3 color;
attribute float size;
uniform float uScale;
uniform float uMul;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uMul * (uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const POINT_FRAG = `
varying vec3 vColor;
void main() {
  if (vColor.r + vColor.g + vColor.b == 0.0) discard;   // hidden or thinned out
  gl_FragColor = vec4(vColor, 1.0);
  #include <colorspace_fragment>
}`;

function regionSpacing(regions: PairMeta['regions']): Float32Array {
  const out = new Float32Array(256).fill(FALLBACK_SPACING);
  for (const r of regions ?? []) if (r.spacing_mm > 0) out[r.id] = r.spacing_mm;
  return out;
}

/** Nodes on a surface go as 1/spacing^2, so keeping every k-th point widens
 *  the spacing by sqrt(k). At grain = the finest region's own spacing nothing
 *  is dropped. */
function regionStrides(spacing: Float32Array, grain: number): Int32Array {
  const out = new Int32Array(256).fill(1);
  for (let r = 0; r < 256; r++) out[r] = Math.max(1, Math.round((grain / spacing[r]) ** 2));
  return out;
}

/** Thinned regions grow to cover the gaps they just opened. */
function fillSizes(out: Float32Array, layer: Uint8Array, n: number,
                   spacing: Float32Array, strides: Int32Array): void {
  const size = new Float32Array(256);
  for (let r = 0; r < 256; r++) size[r] = spacing[r] * Math.sqrt(strides[r]);
  for (let i = 0; i < n; i++) out[i] = size[layer[i]];
}

interface Orbit {
  theta: number; phi: number; r: number;
  base: THREE.Vector3;
  off: THREE.Vector3;
}

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  posBuf: Float32Array;
  colBuf: Float32Array;
  cloud: THREE.Points;
  mat: THREE.ShaderMaterial;
}

export default function PointsView({ stem, onExit, onSurface }: {
  stem: string; onExit: () => void; onSurface: () => void;
}) {
  const [status, setStatus] = useState({ text: 'Loading…', pct: 0, error: '' });
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [meta, setMeta] = useState<PairMeta | null>(null);
  const [manifest, setManifest] = useState<CaseManifest | null>(null);
  const [ramp, setRamp] = useState<RampName>('spectrum');
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>('field');
  const [follow, setFollow] = useState(true);
  const [pointScale, setPointScale] = useState(0.8);
  const [grain, setGrain] = useState(0);
  const [hiddenRegions, setHiddenRegions] = useState<Set<number>>(new Set());
  // Everything visible: this view exists to show the whole sampled mesh,
  // frame and powertrain included.
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(() => new Set());

  const hostRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rigsRef = useRef<Rig[]>([]);
  const orbitRef = useRef<Orbit>({
    theta: 0.4, phi: 1.1, r: 5000,
    base: new THREE.Vector3(), off: new THREE.Vector3(),
  });
  const trackRef = useRef<Float32Array | null>(null);
  const frameRef = useRef(0);
  const followRef = useRef(true);
  const syncRef = useRef<(() => void) | null>(null);
  const pointScaleRef = useRef(0.8);
  const stridesRef = useRef<Int32Array>(new Int32Array(256).fill(1));
  const sizeBufRef = useRef<Float32Array | null>(null);
  const sizeDirtyRef = useRef(false);

  const spacing = useMemo(() => regionSpacing(meta?.regions), [meta]);
  const grainRange = useMemo(() => {
    const present = [...(meta?.regions ?? [])]
      .filter(r => r.spacing_mm > 0 && r.nodes > 100)
      .map(r => r.spacing_mm).sort((a, b) => a - b);
    return present.length
      ? { min: present[0], max: present[present.length - 1] }
      : { min: FALLBACK_SPACING, max: FALLBACK_SPACING };
  }, [meta]);
  const effGrain = grain || grainRange.min;
  const strides = useMemo(() => regionStrides(spacing, effGrain), [spacing, effGrain]);

  const grouped = useMemo(() => (
    panels
      ? buildGroupColors(panels[0].data.part, panels[0].data.nNodes, meta?.parts ?? [])
      : null
  ), [panels, meta]);
  const legend = grouped?.legend ?? [];
  const hiddenIdx = useMemo(() => {
    const flags = new Uint8Array(GROUP_ORDER.length);
    GROUP_ORDER.forEach((g, i) => { flags[i] = hiddenGroups.has(g) ? 1 : 0; });
    return flags;
  }, [hiddenGroups]);

  // Mirrored into refs for the render loop and input handlers, which outlive
  // any single render. Declared before the effects that read them.
  useEffect(() => { frameRef.current = frame; }, [frame]);
  useEffect(() => { followRef.current = follow; }, [follow]);
  useEffect(() => { pointScaleRef.current = pointScale; }, [pointScale]);
  useEffect(() => {
    stridesRef.current = strides;
    const buf = sizeBufRef.current;
    if (!buf || !panels) return;
    fillSizes(buf, panels[0].data.layer, panels[0].data.nNodes, spacing, strides);
    sizeDirtyRef.current = true;
  }, [strides, spacing, panels]);

  useEffect(() => { loadManifest().then(setManifest); }, []);

  // The stem in the URL *is* the case; the dropdowns read their state back off
  // it, so the address bar stays the single source of truth for what is shown
  // and any case can be linked or bookmarked directly.
  const entry = useMemo(
    () => manifest?.cases.find(c => c.id === stem) ?? null, [manifest, stem]);
  const selection: Selection | null = entry ? selectionOf(entry) : null;

  const pickCase = useCallback((sel: Selection) => {
    if (!manifest) return;
    // findReady, not findCase: a 'pending' case has no COL2 files, so
    // navigating to it would only produce a failed fetch. The selector already
    // disables those options; this is the guard behind that.
    const hit = findReady(manifest, sel);
    if (!hit || hit.id === stem) return;
    window.location.href =
      `${window.location.pathname}?points=${encodeURIComponent(hit.id)}`;
  }, [manifest, stem]);

  useEffect(() => {
    let cancelled = false;
    loadPair(stem, (text, pct) => !cancelled && setStatus({ text, pct, error: '' }))
      .then(({ panels, meta }) => {
        if (cancelled) return;
        setPanels(panels); setMeta(meta);
      })
      .catch((e: Error) => !cancelled && setStatus({ text: '', pct: 0, error: e.message }));
    return () => { cancelled = true; };
  }, [stem]);

  useEffect(() => {
    if (!panels) return;
    const orbit = orbitRef.current;
    const p0 = panels[0].data.pos[0];
    const layer = panels[0].data.layer;
    const n = panels[0].data.nNodes;

    // Framed on the vehicle (regions 3-5): the barrier runs tens of metres
    // past the impact and a whole-scene fit leaves the car a few pixels wide.
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      if (layer[i] < 3) continue;
      for (let k = 0; k < 3; k++) {
        const v = p0[i * 3 + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    if (!isFinite(lo[0])) { lo.fill(-1000); hi.fill(1000); }
    const half = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
    orbit.base.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    orbit.r = half * 2.4;

    // The truth vehicle's centroid per frame. Both panels share it, so the
    // prediction's drift shows as the car sliding off centre instead of both
    // cars quietly leaving the frame — at 100 km/h it covers ~26 m here.
    const nf = panels[0].data.nFrames;
    const track = new Float32Array(nf * 3);
    for (let f = 0; f < nf; f++) {
      const pf = panels[0].data.pos[f];
      let sx = 0, sy = 0, sz = 0, c = 0;
      for (let i = 0; i < n; i++) {
        if (layer[i] < 3) continue;
        sx += pf[i * 3]; sy += pf[i * 3 + 1]; sz += pf[i * 3 + 2]; c++;
      }
      if (c) { track[f * 3] = sx / c; track[f * 3 + 1] = sy / c; track[f * 3 + 2] = sz / c; }
    }
    trackRef.current = track;

    const sizeAttr = new Float32Array(n);
    fillSizes(sizeAttr, layer, n, spacing, stridesRef.current);
    sizeBufRef.current = sizeAttr;

    const rigs: Rig[] = panels.map((p, i) => {
      const host = hostRefs.current[i]!;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(GROUND);
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
      const geo = new THREE.BufferGeometry();
      const posBuf = new Float32Array(p.data.nNodes * 3);
      const colBuf = new Float32Array(p.data.nNodes * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(sizeAttr, 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
        uniforms: { uScale: { value: 300 }, uMul: { value: 1 } },
      });
      const cloud = new THREE.Points(geo, mat);
      // The bounding sphere is computed once and never refreshed, while the
      // position buffer is rewritten every frame. Once the camera follows the
      // car away from that stale sphere three.js culls the whole cloud and the
      // panel goes black. One object per scene, always drawn — skip the test.
      cloud.frustumCulled = false;
      scene.add(cloud);
      return { renderer, scene, camera, posBuf, colBuf, cloud, mat };
    });
    rigsRef.current = rigs;

    const anchor = new THREE.Vector3();
    function currentTarget() {
      const t = trackRef.current;
      if (followRef.current && t) {
        const f = frameRef.current * 3;
        anchor.set(t[f], t[f + 1], t[f + 2]);
      } else {
        anchor.copy(orbit.base);
      }
      return anchor.add(orbit.off);
    }
    function syncCameras() {
      const { theta, phi, r } = orbit;
      const tgt = currentTarget();
      for (const rig of rigs) {
        rig.camera.position.set(
          tgt.x + r * Math.sin(phi) * Math.sin(theta),
          tgt.y + r * Math.cos(phi),
          tgt.z + r * Math.sin(phi) * Math.cos(theta),
        );
        rig.camera.lookAt(tgt);
      }
    }
    syncRef.current = syncCameras;

    let drag: 'rotate' | 'pan' | null = null;
    let px = 0, py = 0;
    const onDown = (e: MouseEvent) => {
      drag = e.button === 2 ? 'pan' : 'rotate'; px = e.clientX; py = e.clientY;
    };
    const onUp = () => { drag = null; };
    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
      if (drag === 'rotate') {
        orbit.theta -= dx * 0.005;
        orbit.phi = Math.max(0.05, Math.min(Math.PI - 0.05, orbit.phi - dy * 0.005));
      } else {
        const cam = rigs[0].camera;
        const dir = new THREE.Vector3().subVectors(cam.position, currentTarget()).normalize();
        const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, dir).normalize();
        const k = orbit.r * 0.001;
        orbit.off.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      }
      syncCameras();
    };
    const onWheel = (e: WheelEvent) => {
      orbit.r = Math.max(10, Math.min(1e6, orbit.r * (1 + e.deltaY * 0.001)));
      syncCameras(); e.preventDefault();
    };
    const noCtx = (e: Event) => e.preventDefault();
    for (const rig of rigs) {
      const el = rig.renderer.domElement;
      el.addEventListener('mousedown', onDown);
      el.addEventListener('wheel', onWheel, { passive: false });
      el.addEventListener('contextmenu', noCtx);
    }
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);

    const resize = () => {
      for (let i = 0; i < rigs.length; i++) {
        const host = hostRefs.current[i];
        if (!host) continue;
        const w = host.clientWidth, h = host.clientHeight;
        if (!w || !h) continue;
        rigs[i].renderer.setSize(w, h);
        rigs[i].camera.aspect = w / h;
        rigs[i].camera.updateProjectionMatrix();
        rigs[i].mat.uniforms.uScale.value = h * 0.5;
      }
    };
    const ro = new ResizeObserver(resize);
    hostRefs.current.forEach(h => h && ro.observe(h));
    resize();
    syncCameras();

    let raf = 0;
    const loop = () => {
      const sizeDirty = sizeDirtyRef.current;
      for (const rig of rigs) {
        rig.mat.uniforms.uMul.value = pointScaleRef.current;
        if (sizeDirty) rig.cloud.geometry.attributes.size.needsUpdate = true;
        rig.renderer.render(rig.scene, rig.camera);
      }
      sizeDirtyRef.current = false;
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      syncRef.current = null;
      ro.disconnect();
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      for (const rig of rigs) {
        const el = rig.renderer.domElement;
        el.removeEventListener('mousedown', onDown);
        el.removeEventListener('wheel', onWheel);
        el.removeEventListener('contextmenu', noCtx);
        rig.cloud.geometry.dispose();
        rig.mat.dispose();
        rig.renderer.dispose();
        el.remove();
      }
      rigsRef.current = [];
    };
  }, [panels, meta, spacing]);

  useEffect(() => {
    const rigs = rigsRef.current;
    if (!panels || rigs.length !== panels.length) return;
    const errPanel = panels.find(p => p.meta.field === 'position_error');

    for (let pi = 0; pi < panels.length; pi++) {
      const { data } = panels[pi];
      // Error mode shows one quantity on both panels, so both take the error
      // ramp; Field mode shows each panel's own, so the ramps differ — which
      // is the point: the colours themselves say "not comparable".
      const shownField = colorMode === 'error' && errPanel
        ? errPanel.meta.field : panels[pi].meta.field;
      const ramp255 = rampForField(shownField, ramp);
      const { posBuf, colBuf, cloud } = rigs[pi];
      const pos = data.pos[frame];
      const val = colorMode === 'error' && errPanel
        ? errPanel.data.val[frame] : data.val[frame];
      const stride = stridesRef.current;
      const gIdx = grouped?.groupIdx;
      const regionCol = REGION_COLORS.map(h => new THREE.Color(h));

      for (let i = 0; i < data.nNodes; i++) {
        const i3 = i * 3;
        posBuf[i3] = pos[i3]; posBuf[i3 + 1] = pos[i3 + 1]; posBuf[i3 + 2] = pos[i3 + 2];

        // Hidden or thinned out: black, which the fragment shader discards.
        // Keyed on node index so both panels drop exactly the same nodes — a
        // point present on one side only would read as prediction error.
        if (hiddenRegions.has(data.layer[i]) || i % stride[data.layer[i]] !== 0
          || (gIdx && hiddenIdx[gIdx[i]] === 1)) {
          colBuf[i3] = 0; colBuf[i3 + 1] = 0; colBuf[i3 + 2] = 0;
          continue;
        }
        if (colorMode === 'group') {
          const pc = grouped?.buf;
          if (pc) { colBuf[i3] = pc[i3]; colBuf[i3 + 1] = pc[i3 + 1]; colBuf[i3 + 2] = pc[i3 + 2]; }
          continue;
        }
        if (colorMode === 'region') {
          const c = regionCol[data.layer[i]] ?? regionCol[0];
          colBuf[i3] = c.r; colBuf[i3 + 1] = c.g; colBuf[i3 + 2] = c.b;
          continue;
        }
        const v = val[i];
        if (v < 2) {
          colBuf[i3] = DIM[0]; colBuf[i3 + 1] = DIM[1]; colBuf[i3 + 2] = DIM[2];
        } else {
          const [r, g, b] = ramp255((v - 2) / 253);
          colBuf[i3] = r; colBuf[i3 + 1] = g; colBuf[i3 + 2] = b;
        }
      }
      cloud.geometry.attributes.position.needsUpdate = true;
      cloud.geometry.attributes.color.needsUpdate = true;
    }
  }, [frame, panels, colorMode, hiddenRegions, strides, grouped, hiddenIdx, ramp]);

  useEffect(() => { syncRef.current?.(); }, [frame, follow, panels]);

  useEffect(() => {
    if (!playing || !panels) return;
    const n = panels[0].data.nFrames;
    const id = setInterval(() => setFrame(f => (f + 1) % n), PLAY_MS);
    return () => clearInterval(id);
  }, [playing, panels]);

  const toggleRegion = useCallback((r: number) => {
    setHiddenRegions(prev => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
  }, []);

  if (!panels || !meta) {
    return <Loading text={status.text} progress={status.pct} error={status.error || undefined} />;
  }

  const nFrames = panels[0].data.nFrames;
  const t = panels[0].data.times[frame];
  const rmse = meta.pred?.rmse_per_frame?.[frame];
  const isPlaceholder = meta.pred?.source?.startsWith('baseline:');

  return (
    <div className="cmp-root">
      <header className="cmp-bar">
        <button className="cmp-btn" onClick={onExit}>← Single view</button>
        <span className="cmp-title">{meta.stem}</span>
        <span className="cmp-dim">
          points · {meta.n_nodes.toLocaleString()} nodes · frames {meta.frames.start}–
          {meta.frames.start + nFrames - 1} · {(meta.frames.dt_s * 1000).toFixed(0)} ms/frame
        </span>
        <div className="cmp-spacer" />
        <button className="cmp-btn" title="Same data, shaded outer skin"
          onClick={onSurface}>Surface view →</button>
      </header>

      {isPlaceholder && (
        <div className="cmp-warn">
          Prediction side is a <b>{meta.pred!.source}</b> placeholder, not model output —
          run <code>configs/hpc/rollout_dgx.slurm</code> and replace the .bin files.
        </div>
      )}

      <div className="cmp-body">
        <aside className="cmp-side">
          {manifest && selection && (
            <CaseSelector manifest={manifest} selection={selection} onChange={pickCase} />
          )}
          <div className="cmp-side-head">Colouring</div>
          {COLOR_MODES.map(({ key, label, short, hint }) => (
            <button key={key} title={hint}
              className={`cmp-mode${colorMode === key ? ' on' : ''}`}
              disabled={key === 'error' && !meta.pred}
              onClick={() => setColorMode(key)}>
              {label}<em>{short}</em>
            </button>
          ))}

          <div className="cmp-side-head">
            Sampling regions
            <button className="cmp-mini" title="Show every region"
              onClick={() => setHiddenRegions(new Set())}>all</button>
          </div>
          <ul className="cmp-key">
            {REGION_NAMES.map((name, r) => (
              <li key={r} className={hiddenRegions.has(r) ? 'off' : ''}
                onClick={() => toggleRegion(r)}>
                <i style={{ background: REGION_COLORS[r] }} />
                <span>{name}</span>
              </li>
            ))}
          </ul>

          {legend.length > 0 && (
            <>
              <div className="cmp-side-head">
                Assemblies
                <button className="cmp-mini" title="Outer skin only"
                  onClick={() => setHiddenGroups(new Set(INTERNAL_GROUPS))}>skin</button>
                <button className="cmp-mini" title="Show every assembly"
                  onClick={() => setHiddenGroups(new Set())}>all</button>
              </div>
              <ul className="cmp-key">
                {legend.map(({ group, nodes }) => (
                  <li key={group} className={hiddenGroups.has(group) ? 'off' : ''}
                    title={OUTER_GROUPS.has(group) ? 'Outer skin' : 'Internal'}
                    onClick={() => setHiddenGroups(prev => {
                      const next = new Set(prev);
                      if (next.has(group)) next.delete(group); else next.add(group);
                      return next;
                    })}>
                    <i style={{ background: GROUP_COLORS[group] }} />
                    <span>{group}</span>
                    <b>{nodes >= 1000 ? `${(nodes / 1000).toFixed(1)}k` : nodes}</b>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="cmp-side-head">Point rendering</div>
          <label className="cmp-select" title={RAMPS.find(r => r.name === ramp)!.note}>
            <span>colour ramp</span>
            <select value={ramp} onChange={e => setRamp(e.target.value as RampName)}>
              {RAMPS.map(r => (
                <option key={r.name} value={r.name}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="cmp-field" title="Point diameter as a multiple of node spacing.">
            <span>size<b>{pointScale.toFixed(2)}x</b></span>
            <input type="range" min={0.2} max={2.5} step={0.05} value={pointScale}
              onChange={e => setPointScale(+e.target.value)} />
          </label>
          <label className="cmp-field"
            title="Thin the finely-sampled regions toward this spacing. Left = full data.">
            <span>grain<b>
              {effGrain <= grainRange.min + 0.01 ? 'full' : `${effGrain.toFixed(0)} mm`}
            </b></span>
            <input type="range" min={grainRange.min} max={grainRange.max} step={0.5}
              value={effGrain} onChange={e => setGrain(+e.target.value)} />
          </label>
        </aside>

        <div className="cmp-panels">
          {panels.map((p, i) => (
            <section className="cmp-panel" key={p.key}>
              <div className="cmp-panel-head">
                <b>{p.label}</b>
                <span>{colorMode === 'field'
                  ? describeField(p.meta)
                  : colorMode === 'error'
                    ? describeField((panels.find(q => q.meta.field === 'position_error') ?? p).meta)
                    : colorMode === 'group' ? `assembly (${legend.length} groups)`
                      : 'sampling region'}</span>
              </div>
              <div className="cmp-canvas" ref={el => { hostRefs.current[i] = el; }} />
              <RampKey panel={colorMode === 'error'
                ? panels.find(q => q.meta.field === 'position_error') ?? p : p}
                mode={colorMode} ramp={ramp} />
            </section>
          ))}
        </div>
      </div>

      <footer className="cmp-foot">
        <button className="cmp-play" onClick={() => setPlaying(p => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="cmp-step" title="Previous frame"
          onClick={() => setFrame(f => Math.max(0, f - 1))}>Prev</button>
        <button className="cmp-step" title="Next frame"
          onClick={() => setFrame(f => Math.min(nFrames - 1, f + 1))}>Next</button>
        <input className="slider" type="range" min={0} max={nFrames - 1} value={frame}
          onChange={e => setFrame(+e.target.value)} />
        <span className="cmp-read">
          Frame {frame + 1} of {nFrames} · {t.toFixed(3)} s
          {rmse !== undefined && <> · RMSE <b>{rmse.toFixed(1)} mm</b></>}
        </span>
        <button className={`cmp-btn${follow ? ' on' : ''}`}
          title="Keep the camera on the ground-truth vehicle as it travels"
          onClick={() => setFollow(f => !f)}>
          Follow vehicle
        </button>
      </footer>
    </div>
  );
}

/** Colour ramp key, labelled with the physical value at each end so a log
 *  ramp reads correctly. */
function RampKey({ panel, mode, ramp }: { panel: Panel; mode: ColorMode; ramp: RampName }) {
  if (mode === 'region' || mode === 'group') return <div className="cmp-legend" />;
  const { scale, transform, floor = 1e-3, unit, field } = panel.meta;
  const label = (f: number) => {
    const v = transform === 'log'
      ? Math.pow(10, Math.log10(floor) + f * (Math.log10(scale) - Math.log10(floor)))
      : f * scale;
    const s = v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toPrecision(2);
    return unit ? `${s} ${unit}` : s;
  };
  return (
    <div className="cmp-legend">
      <span className="cmp-legend-name">
        {field === 'position_error' ? 'position error' : 'plastic strain'}
        {transform === 'log' && <em> (log)</em>}
      </span>
      <span>{label(0)}</span>
      <div className="cmp-ramp" style={{ background: rampCssForField(panel.meta.field, ramp) }} />
      <span>{label(1)}</span>
    </div>
  );
}
