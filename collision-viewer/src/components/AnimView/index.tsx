import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { parseMsh2, GROUP_COLOR } from '../../lib/parseMsh';
import type { AnimData } from '../../lib/parseMsh';
import Loading from '../Loading';

const GROUND = 0x13161b;
const PLAY_MS = 120;
const ALIVE = 0xffff;

/** A dozen frames of the raw mesh, played back.
 *
 *  Indexed geometry, unlike the static MeshView. Non-indexed would mean
 *  rewriting 1.86 M x 9 floats per frame — 67 MB of JS writes, far too slow —
 *  where indexed copies one position per vertex, 11 MB. The cost is that
 *  colour is per vertex rather than per triangle, so group boundaries blend
 *  over one triangle. Worth it.
 */
export default function AnimView({ stem, onExit }: { stem: string; onExit: () => void }) {
  const [status, setStatus] = useState({ text: 'Loading…', pct: 0, error: '' });
  const [anim, setAnim] = useState<AnimData | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [wire, setWire] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const applyRef = useRef<((f: number) => void) | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${stem}.msh2`);
        if (!r.ok) throw new Error(`${stem}.msh2: HTTP ${r.status}`);
        const total = parseInt(r.headers.get('content-length') ?? '0');
        const reader = r.body!.getReader();
        const chunks: Uint8Array[] = []; let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); got += value.length;
          if (total) setStatus({ text: 'Downloading frames…', pct: 90 * got / total, error: '' });
        }
        const buf = new Uint8Array(got); let o = 0;
        for (const c of chunks) { buf.set(c, o); o += c.length; }
        setStatus({ text: 'Parsing…', pct: 95, error: '' });
        if (!cancelled) setAnim(parseMsh2(buf.buffer));
      } catch (e) {
        if (!cancelled) setStatus({ text: '', pct: 0, error: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [stem]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !anim) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(GROUND);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(1, 1.4, 1); scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-1, -0.4, -0.8); scene.add(fill);

    const nVert = anim.frames[0].length / 3;
    const colors = new Float32Array(nVert * 3);
    const groupOf = new Uint8Array(nVert);
    const tri = anim.triangles;
    for (let t = 0; t < tri.length / 3; t++) {
      const g = anim.triGroup[t];
      for (let k = 0; k < 3; k++) groupOf[tri[t * 3 + k]] = g;
    }
    const gc = anim.groups.map(g => new THREE.Color(GROUP_COLOR[g] ?? '#5c6169'));
    const paint = (hide: Set<number>) => {
      for (let v = 0; v < nVert; v++) {
        const c = hide.has(groupOf[v]) ? null : gc[groupOf[v]];
        colors[v * 3] = c ? c.r : 0;
        colors[v * 3 + 1] = c ? c.g : 0;
        colors[v * 3 + 2] = c ? c.b : 0;
      }
    };
    paint(new Set());

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(anim.frames[0].slice(), 3);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // index is uploaded once and mutated only where a triangle dies
    const index = new THREE.BufferAttribute(tri.slice(), 1);
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    // Flat shading, to match the single-frame view. Indexed geometry averages
    // normals across every triangle meeting a vertex, which polishes the flat
    // panels smooth and then leaves the stamped creases — real 90-degree folds
    // in the hood and roof — standing out as hard dark lines. Flat shading
    // faceting hides them the way the non-indexed view did. Doing it properly
    // would mean splitting normals above an angle threshold and shipping a
    // normal per vertex per frame, doubling the per-frame payload.
    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true, side: THREE.DoubleSide, shininess: 12,
      flatShading: true,
    });
    const obj = new THREE.Mesh(geo, mat);
    obj.frustumCulled = false;
    scene.add(obj);
    meshRef.current = obj;

    /** Swap in a frame: positions, then collapse whatever has died by now.
     *
     *  A dead triangle is degenerated rather than removed — all three indices
     *  point at one vertex, so it rasterises to nothing. Deleting it from the
     *  index buffer would mean rebuilding 22 MB every frame for the sake of a
     *  couple of hundred triangles, and scrubbing backwards has to restore
     *  them anyway. */
    const idxArr = index.array as Uint32Array;
    // Only the triangles that ever die are worth visiting — 208 of 1.86 M
    // here. Scanning the whole triDeath array per frame cost seconds.
    const mortal: number[] = [];
    for (let t = 0; t < anim.triDeath.length; t++)
      if (anim.triDeath[t] !== ALIVE) mortal.push(t);

    applyRef.current = (f: number) => {
      (posAttr.array as Float32Array).set(anim.frames[f]);
      posAttr.needsUpdate = true;
      for (const t of mortal) {
        const dead = f >= anim.triDeath[t];
        const o = t * 3, a0 = tri[o];
        idxArr[o + 1] = dead ? a0 : tri[o + 1];
        idxArr[o + 2] = dead ? a0 : tri[o + 2];
      }
      index.needsUpdate = true;
      curFrame = f;
      sync();
      // No computeVertexNormals() here: it rebuilds normals for 1.86 M
      // triangles and took most of the 7.6 s a frame change used to cost.
      // Lighting comes from the frame-0 normals instead, which drift as the
      // body deforms but stay close enough to read the shape. Recomputing
      // properly needs a shader-side normal, not a CPU pass.
    };
    // the initial apply happens after sync() exists, below

    // frame on the vehicle; the barrier runs 73 m
    const veh = anim.groups.findIndex(g => g === 'Cab body');
    const box = new THREE.Box3(); const p = new THREE.Vector3();
    const f0 = anim.frames[0];
    for (let t = 0, n = 0; t < anim.triGroup.length && n < 4000; t++) {
      if (anim.triGroup[t] !== veh) continue;
      n++;
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k] * 3;
        box.expandByPoint(p.set(f0[v], f0[v + 1], f0[v + 2]));
      }
    }
    // Per-frame vehicle centroid. Without it the camera stays at frame 0
    // while the car travels 26 m, and it leaves the screen by frame 3.
    const vehVerts: number[] = [];
    for (let t = 0; t < anim.triGroup.length; t++) {
      if (anim.triGroup[t] !== veh) continue;
      vehVerts.push(tri[t * 3]);
      if (vehVerts.length > 6000) break;
    }
    const track = anim.frames.map(fr => {
      let x = 0, y = 0, z = 0;
      for (const v of vehVerts) { x += fr[v * 3]; y += fr[v * 3 + 1]; z += fr[v * 3 + 2]; }
      const n = vehVerts.length || 1;
      return new THREE.Vector3(x / n, y / n, z / n);
    });

    const target = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length(), 1000);

    const camera = new THREE.PerspectiveCamera(45, 1, 10, 4e5);
    const sph = { theta: 0.9, phi: 1.05, r: radius * 2.6 };
    const off = new THREE.Vector3();
    let curFrame = 0;
    const sync = () => {
      const t = (track[curFrame] ?? target).clone().add(off);
      camera.position.set(
        t.x + sph.r * Math.sin(sph.phi) * Math.sin(sph.theta),
        t.y + sph.r * Math.sin(sph.phi) * Math.cos(sph.theta),
        t.z + sph.r * Math.cos(sph.phi));
      camera.up.set(0, 0, 1); camera.lookAt(t);
    };
    applyRef.current(0);
    sync();

    let drag: 'rot' | 'pan' | null = null, px = 0, py = 0;
    const el = renderer.domElement;
    const down = (e: MouseEvent) => { drag = e.button === 2 ? 'pan' : 'rot'; px = e.clientX; py = e.clientY; };
    const up = () => { drag = null; };
    const move = (e: MouseEvent) => {
      if (!drag) return;
      const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
      if (drag === 'rot') {
        sph.theta -= dx * 0.005;
        sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dy * 0.005));
      } else {
        const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
        const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
        const upv = new THREE.Vector3().crossVectors(right, dir).normalize();
        off.addScaledVector(right, -dx * sph.r * 0.001).addScaledVector(upv, dy * sph.r * 0.001);
      }
      sync();
    };
    const wheel = (e: WheelEvent) => {
      sph.r = Math.max(50, Math.min(5e5, sph.r * (1 + e.deltaY * 0.001)));
      sync(); e.preventDefault();
    };
    el.addEventListener('mousedown', down);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', ev => ev.preventDefault());
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', move);

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(host); resize();

    let raf = 0;
    const loop = () => { renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener('mouseup', up);
      window.removeEventListener('mousemove', move);
      geo.dispose(); mat.dispose(); renderer.dispose(); el.remove();
      applyRef.current = null; meshRef.current = null;
    };
  }, [anim]);

  useEffect(() => { applyRef.current?.(frame); }, [frame]);

  useEffect(() => {
    if (!playing || !anim) return;
    const id = setInterval(() => setFrame(f => (f + 1) % anim.frames.length), PLAY_MS);
    return () => clearInterval(id);
  }, [playing, anim]);

  useEffect(() => {
    const obj = meshRef.current;
    if (obj) (obj.material as THREE.MeshPhongMaterial).wireframe = wire;
  }, [wire]);

  const toggle = useCallback((g: number) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  }), []);

  useEffect(() => {
    const obj = meshRef.current;
    if (!obj || !anim) return;
    const col = obj.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    const nVert = arr.length / 3;
    const tri = anim.triangles;
    const groupOf = new Uint8Array(nVert);
    for (let t = 0; t < tri.length / 3; t++)
      for (let k = 0; k < 3; k++) groupOf[tri[t * 3 + k]] = anim.triGroup[t];
    for (let v = 0; v < nVert; v++) {
      const g = groupOf[v];
      const c = hidden.has(g) ? null : new THREE.Color(GROUP_COLOR[anim.groups[g]] ?? '#5c6169');
      arr[v * 3] = c ? c.r : 0; arr[v * 3 + 1] = c ? c.g : 0; arr[v * 3 + 2] = c ? c.b : 0;
    }
    col.needsUpdate = true;
  }, [hidden, anim]);

  if (!anim) {
    return <Loading text={status.text} progress={status.pct} error={status.error || undefined} />;
  }

  const n = anim.frames.length;
  const counts = new Map<number, number>();
  for (const g of anim.triGroup) counts.set(g, (counts.get(g) ?? 0) + 1);
  const dead = [...anim.triDeath].filter(d => d !== ALIVE && frame >= d).length;

  return (
    <div className="cmp-root">
      <header className="cmp-bar">
        <button className="cmp-btn" onClick={onExit}>← Single view</button>
        <span className="cmp-title">{stem}</span>
        <span className="cmp-dim">
          {(anim.frames[0].length / 3).toLocaleString()} vertices ·{' '}
          {(anim.triangles.length / 3).toLocaleString()} triangles · {n} frames
        </span>
        <div className="cmp-spacer" />
        <button className={`cmp-btn${wire ? ' on' : ''}`} onClick={() => setWire(w => !w)}>
          Wireframe
        </button>
      </header>

      <div className="cmp-body">
        <aside className="cmp-side">
          <div className="cmp-side-head">
            Assemblies
            <button className="cmp-mini" onClick={() => setHidden(new Set())}>all</button>
          </div>
          <ul className="cmp-key">
            {anim.groups.map((g, i) => (
              <li key={g} className={hidden.has(i) ? 'off' : ''} onClick={() => toggle(i)}>
                <i style={{ background: GROUP_COLOR[g] ?? '#5c6169' }} />
                <span>{g}</span>
                <b>{((counts.get(i) ?? 0) / 1000).toFixed(0)}k</b>
              </li>
            ))}
          </ul>
        </aside>
        <div className="cmp-panels">
          <section className="cmp-panel">
            <div className="cmp-canvas" ref={hostRef} />
          </section>
        </div>
      </div>

      <footer className="cmp-foot">
        <button className="cmp-play" onClick={() => setPlaying(p => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="cmp-step" onClick={() => setFrame(f => Math.max(0, f - 1))}>Prev</button>
        <button className="cmp-step" onClick={() => setFrame(f => Math.min(n - 1, f + 1))}>Next</button>
        <input type="range" min={0} max={n - 1} value={frame}
          onChange={e => setFrame(+e.target.value)} />
        <span className="cmp-read">
          Frame {frame + 1} of {n} · {anim.times[frame].toFixed(3)} s
          {dead > 0 && <> · {dead} deleted</>}
        </span>
      </footer>
    </div>
  );
}
