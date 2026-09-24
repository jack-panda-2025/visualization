import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { parseMsh, GROUP_COLOR } from '../../lib/parseMsh';
import type { MeshData } from '../../lib/parseMsh';
import Loading from '../Loading';

const GROUND = 0x13161b;

/** One static frame of the raw d3plot, drawn as a real triangle mesh.
 *
 *  Separate from the comparison views on purpose: those animate a sampled
 *  point cloud, this draws 2.5 M triangles of full-resolution geometry and
 *  does not move. It exists to answer whether the extraction is correct and
 *  what it costs, before any streaming is built on top of it.
 */
export default function MeshView({ stem, onExit }: { stem: string; onExit: () => void }) {
  const [status, setStatus] = useState({ text: 'Loading…', pct: 0, error: '' });
  const [mesh, setMesh] = useState<MeshData | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [wire, setWire] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const hiddenRef = useRef(hidden);
  const wireRef = useRef(wire);
  useEffect(() => { hiddenRef.current = hidden; }, [hidden]);
  useEffect(() => { wireRef.current = wire; }, [wire]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus({ text: 'Downloading mesh…', pct: 10, error: '' });
        const r = await fetch(`${stem}.msh`);
        if (!r.ok) throw new Error(`${stem}.msh: HTTP ${r.status}`);
        const total = parseInt(r.headers.get('content-length') ?? '0');
        const reader = r.body!.getReader();
        const chunks: Uint8Array[] = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); got += value.length;
          if (total) setStatus({ text: 'Downloading mesh…', pct: 10 + 70 * got / total, error: '' });
        }
        const buf = new Uint8Array(got);
        let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
        setStatus({ text: 'Parsing…', pct: 85, error: '' });
        if (!cancelled) setMesh(parseMsh(buf.buffer));
      } catch (e) {
        if (!cancelled) setStatus({ text: '', pct: 0, error: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [stem]);

  // group index -> THREE.Color, resolved once
  const groupColors = useMemo(() => mesh?.groups.map(g =>
    new THREE.Color(GROUP_COLOR[g] ?? '#5c6169')), [mesh]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !mesh || !groupColors) return;

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

    // Vertex colours rather than one draw call per group: the group is a
    // per-triangle property, so splitting by group would mean 22 index
    // buffers over the same vertices. Colouring the corners is one buffer and
    // one draw call, at the cost of duplicating vertices that two groups share
    // — which is why the triangle list is expanded rather than indexed here.
    const tri = mesh.triangles, pos = mesh.positions;
    const n = tri.length;
    const vp = new Float32Array(n * 3);
    const vc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = tri[i] * 3, o = i * 3;
      vp[o] = pos[v]; vp[o + 1] = pos[v + 1]; vp[o + 2] = pos[v + 2];
      const c = groupColors[mesh.triGroup[(i / 3) | 0]];
      vc[o] = c.r; vc[o + 1] = c.g; vc[o + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vp, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true, side: THREE.DoubleSide, flatShading: false,
      shininess: 12,
    });
    const obj = new THREE.Mesh(geo, mat);
    scene.add(obj);
    meshRef.current = obj;

    // frame on the vehicle: the barrier runs 73 m and a whole-scene fit
    // leaves the car a few pixels wide
    const veh = mesh.groups.findIndex(g => g === 'Cab body');
    const sel: number[] = [];
    for (let i = 0; i < mesh.triGroup.length && sel.length < 4000; i++)
      if (mesh.triGroup[i] === veh) sel.push(i);
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const t of sel.length ? sel : [0])
      for (let k = 0; k < 3; k++) {
        const v = tri[t * 3 + k] * 3;
        box.expandByPoint(p.set(pos[v], pos[v + 1], pos[v + 2]));
      }
    const target = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length(), 1000);

    const camera = new THREE.PerspectiveCamera(45, 1, 10, 4e5);
    const sph = { theta: 0.9, phi: 1.05, r: radius * 2.2 };
    const off = new THREE.Vector3();
    const sync = () => {
      const t = target.clone().add(off);
      camera.position.set(
        t.x + sph.r * Math.sin(sph.phi) * Math.sin(sph.theta),
        t.y + sph.r * Math.sin(sph.phi) * Math.cos(sph.theta),
        t.z + sph.r * Math.cos(sph.phi));
      camera.up.set(0, 0, 1);
      camera.lookAt(t);
    };
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
      meshRef.current = null;
    };
  }, [mesh, groupColors]);

  // hiding a group rewrites its vertex colours to black and lets the material
  // skip it, which avoids rebuilding the geometry
  useEffect(() => {
    const obj = meshRef.current;
    if (!obj || !mesh || !groupColors) return;
    const col = obj.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    for (let t = 0; t < mesh.triGroup.length; t++) {
      const c = hidden.has(mesh.triGroup[t])
        ? { r: 0, g: 0, b: 0 } : groupColors[mesh.triGroup[t]];
      for (let k = 0; k < 3; k++) {
        const o = (t * 3 + k) * 3;
        arr[o] = c.r; arr[o + 1] = c.g; arr[o + 2] = c.b;
      }
    }
    col.needsUpdate = true;
  }, [hidden, mesh, groupColors]);

  useEffect(() => {
    const obj = meshRef.current;
    if (obj) (obj.material as THREE.MeshPhongMaterial).wireframe = wire;
  }, [wire]);

  const toggle = useCallback((g: number) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  }), []);

  if (!mesh) {
    return <Loading text={status.text} progress={status.pct} error={status.error || undefined} />;
  }

  const nTris = mesh.triangles.length / 3;
  const counts = new Map<number, number>();
  for (const g of mesh.triGroup) counts.set(g, (counts.get(g) ?? 0) + 1);

  return (
    <div className="cmp-root">
      <header className="cmp-bar">
        <button className="cmp-btn" onClick={onExit}>← Single view</button>
        <span className="cmp-title">{stem}</span>
        <span className="cmp-dim">
          mesh · {(mesh.positions.length / 3).toLocaleString()} vertices ·{' '}
          {nTris.toLocaleString()} triangles · t = {mesh.time.toFixed(3)} s
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
            {mesh.groups.map((g, i) => (
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
    </div>
  );
}
