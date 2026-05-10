import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { rainbowRGB } from '../lib/colors';
import { getSimData } from '../lib/simData';
import { TIRE_OUTER_MIN_RADIUS, TIRE_RPM, FRAME_MS } from '../lib/constants';
import { PARTS_DATA } from '../lib/partsData';
import { partColorMap, buildPartColorBuffer } from '../lib/partColors';
import { useStore } from '../store/useStore';
import type { TrackedPoint, ViewMode } from '../store/useStore';

const SPHERE_R = 45;
const MAX_HULL_POINTS = 250; // max sample points per part for convex hull

export function useThreeScene(containerRef: React.RefObject<HTMLDivElement | null>) {
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const bodyCloudRef = useRef<THREE.Points | null>(null);
  const posBufRef = useRef<Float32Array | null>(null);
  const colBufRef = useRef<Float32Array | null>(null);
  const partColBufRef = useRef<Float32Array | null>(null);  // pre-baked part colors
  const tireMeshesRef = useRef<{ mesh: THREE.Mesh; ti: number }[]>([]);
  const tireAngleRef = useRef(0);
  const trackSpheresRef = useRef<{ inner: THREE.Mesh; outer: THREE.Mesh }[]>([]);
  const meshGroupRef = useRef<THREE.Group | null>(null);   // convex hull meshes
  const orbRef = useRef<OrbitalCamera | null>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0a14);
    // Enable clipping planes support
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
    cameraRef.current = camera;

    const orb = createOrbitalCamera(renderer.domElement, camera);
    orbRef.current = orb;

    const resize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = () => {
      animFrameRef.current = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  const buildScene = useCallback(() => {
    const data = getSimData();
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const orb = orbRef.current;
    if (!data || !scene || !camera || !orb) return;
    const { meta, posFrames, tireFrames, partArr } = data;

    // Pre-bake part color buffer
    partColBufRef.current = buildPartColorBuffer(meta.n_nodes, partArr);

    // Body point cloud
    const geo = new THREE.BufferGeometry();
    const posBuf = new Float32Array(meta.n_nodes * 3);
    const colBuf = new Float32Array(meta.n_nodes * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));
    const cloud = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 2.5, vertexColors: true, sizeAttenuation: true })
    );
    scene.add(cloud);
    bodyCloudRef.current = cloud;
    posBufRef.current = posBuf;
    colBufRef.current = colBuf;

    // Tires
    const t0 = tireFrames[0];
    const tireMeshes: { mesh: THREE.Mesh; ti: number }[] = [];
    for (let ti = 0; ti < meta.n_tires; ti++) {
      const base = ti * 8, radius = t0[base + 6], width = t0[base + 7];
      if (radius < TIRE_OUTER_MIN_RADIUS) continue;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(radius, Math.max(width * 0.45, 20), 10, 36),
        new THREE.MeshBasicMaterial({ color: 0x2a3080, wireframe: true, transparent: true, opacity: 0.9 })
      );
      scene.add(mesh);
      tireMeshes.push({ mesh, ti });
    }
    tireMeshesRef.current = tireMeshes;

    // Mesh group placeholder
    const meshGroup = new THREE.Group();
    meshGroup.visible = false;
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    // Camera fit
    const p0 = posFrames[0];
    const step = Math.max(1, Math.floor(meta.n_nodes / 2000));
    let cx = 0, cy = 0, cz = 0, cnt = 0, maxD = 0;
    for (let i = 0; i < meta.n_nodes; i += step) {
      cx += p0[i * 3]; cy += p0[i * 3 + 1]; cz += p0[i * 3 + 2]; cnt++;
    }
    cx /= cnt; cy /= cnt; cz /= cnt;
    for (let i = 0; i < meta.n_nodes; i += step) {
      const dx = p0[i * 3] - cx, dy = p0[i * 3 + 1] - cy, dz = p0[i * 3 + 2] - cz;
      maxD = Math.max(maxD, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    orb.setTarget(new THREE.Vector3(cx, cy, cz));
    orb.setR(maxD * 2.2);
  }, []);

  const applyFrame = useCallback((fi: number) => {
    const data = getSimData();
    const cloud = bodyCloudRef.current;
    const posBuf = posBufRef.current;
    const colBuf = colBufRef.current;
    if (!data || !cloud || !posBuf || !colBuf) return;

    const { meta, posFrames, valFrames, partArr, tireFrames } = data;
    const pos = posFrames[fi], val = valFrames[fi];
    const hidden = useStore.getState().hiddenParts;
    const viewMode = useStore.getState().viewMode;
    const partColBuf = partColBufRef.current;

    for (let i = 0; i < meta.n_nodes; i++) {
      const pid = partArr[i];
      const i3 = i * 3;
      posBuf[i3] = pos[i3]; posBuf[i3 + 1] = pos[i3 + 1]; posBuf[i3 + 2] = pos[i3 + 2];
      if (hidden.has(pid)) {
        colBuf[i3] = 0; colBuf[i3 + 1] = 0; colBuf[i3 + 2] = 0;
      } else if (viewMode === 'partColor' && partColBuf) {
        colBuf[i3] = partColBuf[i3]; colBuf[i3 + 1] = partColBuf[i3 + 1]; colBuf[i3 + 2] = partColBuf[i3 + 2];
      } else {
        // stress coloring
        const v = val[i];
        if (v < 2) { colBuf[i3] = 0.12; colBuf[i3 + 1] = 0.14; colBuf[i3 + 2] = 0.35; }
        else { const [r, g, b] = rainbowRGB((v - 2) / 253); colBuf[i3] = r; colBuf[i3 + 1] = g; colBuf[i3 + 2] = b; }
      }
    }
    cloud.geometry.attributes.position.needsUpdate = true;
    cloud.geometry.attributes.color.needsUpdate = true;

    // Tires
    const t = tireFrames[fi];
    tireAngleRef.current += (TIRE_RPM / 60) * (FRAME_MS / 1000) * Math.PI * 2;
    for (const { mesh, ti } of tireMeshesRef.current) {
      const base = ti * 8;
      mesh.position.set(t[base], t[base + 1], t[base + 2]);
      const axis = new THREE.Vector3(t[base + 3], t[base + 4], t[base + 5]).normalize();
      const qAlign = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
      const qSpin = new THREE.Quaternion().setFromAxisAngle(axis, tireAngleRef.current);
      mesh.quaternion.copy(qSpin.multiply(qAlign));
    }
  }, []);

  // Build convex hull meshes for current frame
  const buildMeshView = useCallback((opacity: number, showWireframe: boolean): Promise<void> => {
    return new Promise(resolve => {
      const data = getSimData();
      const scene = sceneRef.current;
      const meshGroup = meshGroupRef.current;
      if (!data || !scene || !meshGroup) { resolve(); return; }

      const { meta, posFrames, partArr } = data;
      const fi = useStore.getState().curFrame;
      const pos = posFrames[fi];
      const hidden = useStore.getState().hiddenParts;

      // Clear old mesh group
      while (meshGroup.children.length) {
        const child = meshGroup.children[0] as THREE.Mesh;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        meshGroup.remove(child);
      }

      // Group node indices per part
      const partNodes = new Map<number, number[]>();
      for (let i = 0; i < meta.n_nodes; i++) {
        const pid = partArr[i];
        if (hidden.has(pid)) continue;
        let arr = partNodes.get(pid);
        if (!arr) { arr = []; partNodes.set(pid, arr); }
        arr.push(i);
      }

      // Build hulls in chunks to avoid blocking UI
      const parts = PARTS_DATA.filter(p => partNodes.has(p.id));
      let idx = 0;
      const CHUNK = 20;

      const step = () => {
        const end = Math.min(idx + CHUNK, parts.length);
        for (let pi = idx; pi < end; pi++) {
          const part = parts[pi];
          const nodes = partNodes.get(part.id)!;
          if (nodes.length < 4) continue;

          // Reservoir sampling to get MAX_HULL_POINTS uniformly
          const sampled: THREE.Vector3[] = [];
          const take = Math.min(nodes.length, MAX_HULL_POINTS);
          if (nodes.length <= take) {
            for (const ni of nodes) sampled.push(new THREE.Vector3(pos[ni * 3], pos[ni * 3 + 1], pos[ni * 3 + 2]));
          } else {
            // Systematic stride sampling (faster than reservoir for visual purposes)
            const stride = Math.floor(nodes.length / take);
            for (let k = 0; k < take; k++) {
              const ni = nodes[k * stride];
              sampled.push(new THREE.Vector3(pos[ni * 3], pos[ni * 3 + 1], pos[ni * 3 + 2]));
            }
          }
          if (sampled.length < 4) continue;

          let geo: ConvexGeometry;
          try { geo = new ConvexGeometry(sampled); }
          catch { continue; }

          const col = partColorMap.get(part.id) ?? new THREE.Color(0x888888);

          // Solid face mesh
          const solidMat = new THREE.MeshBasicMaterial({
            color: col, transparent: true, opacity, side: THREE.DoubleSide,
            depthWrite: false,
          });
          const solidMesh = new THREE.Mesh(geo, solidMat);
          solidMesh.userData.partId = part.id;
          meshGroup.add(solidMesh);

          // Wireframe overlay
          if (showWireframe) {
            const wireMat = new THREE.MeshBasicMaterial({
              color: col, wireframe: true, transparent: true, opacity: Math.min(1, opacity + 0.4),
            });
            meshGroup.add(new THREE.Mesh(geo, wireMat));
          }
        }
        idx = end;
        if (idx < parts.length) {
          setTimeout(step, 0);
        } else {
          meshGroup.visible = true;
          resolve();
        }
      };

      step();
    });
  }, []);

  const updateMeshOpacity = useCallback((opacity: number, showWireframe: boolean) => {
    const meshGroup = meshGroupRef.current;
    if (!meshGroup) return;
    let solidIdx = 0;
    for (const child of meshGroup.children) {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat.wireframe) {
        mat.opacity = Math.min(1, opacity + 0.4);
        mat.visible = showWireframe;
      } else {
        mat.opacity = opacity;
        solidIdx++;
      }
      mat.needsUpdate = true;
    }
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    const cloud = bodyCloudRef.current;
    const meshGroup = meshGroupRef.current;
    if (!cloud || !meshGroup) return;
    cloud.visible = mode !== 'mesh';
    meshGroup.visible = mode === 'mesh';
  }, []);

  const updateTrackSpheres = useCallback((fi: number, tps: TrackedPoint[]) => {
    const scene = sceneRef.current;
    const data = getSimData();
    if (!scene || !data) return;

    for (const { inner, outer } of trackSpheresRef.current) {
      scene.remove(inner); scene.remove(outer);
    }
    trackSpheresRef.current = [];
    if (!tps.length) return;

    const pos = data.posFrames[fi];
    const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
    const ringGeo = new THREE.SphereGeometry(1, 10, 8);

    tps.forEach((tp, tpIdx) => {
      if (tp.hidden) return;
      const x = pos[tp.idx * 3], y = pos[tp.idx * 3 + 1], z = pos[tp.idx * 3 + 2];
      const col = new THREE.Color(tp.color);
      const inner = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
        color: col, depthTest: false, transparent: true, opacity: 0.85,
      }));
      inner.scale.setScalar(SPHERE_R);
      inner.position.set(x, y, z);
      inner.renderOrder = 999;
      inner.userData.tpIdx = tpIdx;
      const outer = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: col, wireframe: true, depthTest: false, transparent: true, opacity: 0.45,
      }));
      outer.scale.setScalar(SPHERE_R * 1.7);
      outer.position.set(x, y, z);
      outer.renderOrder = 998;
      outer.userData.tpIdx = tpIdx;
      scene.add(inner); scene.add(outer);
      trackSpheresRef.current.push({ inner, outer });
    });
  }, []);

  const focusTarget = useCallback((x: number, y: number, z: number, r?: number) => {
    const orb = orbRef.current;
    if (!orb) return;
    orb.setTarget(new THREE.Vector3(x, y, z));
    if (r !== undefined) orb.setR(r);
  }, []);

  const intersectSpheres = useCallback((clientX: number, clientY: number): number | null => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const meshes = trackSpheresRef.current.flatMap(s => [s.inner, s.outer]);
    const hits = raycaster.intersectObjects(meshes);
    if (!hits.length) return null;
    return hits[0].object.userData.tpIdx as number;
  }, []);

  const getDomElement = useCallback(() => rendererRef.current?.domElement ?? null, []);

  return {
    buildScene, applyFrame, updateTrackSpheres, focusTarget,
    intersectSpheres, getDomElement, buildMeshView, updateMeshOpacity, setViewMode,
  };
}

// ---- Orbital camera ----
interface OrbitalCamera {
  setTarget: (v: THREE.Vector3) => void;
  setR: (r: number) => void;
  getR: () => number;
}

function createOrbitalCamera(canvas: HTMLElement, camera: THREE.PerspectiveCamera): OrbitalCamera {
  const sph = { theta: 0.4, phi: 1.1, r: 5000 };
  const tgt = new THREE.Vector3();
  let state: 'idle' | 'rotate' | 'pan' = 'idle';
  let px = 0, py = 0;

  function sync() {
    camera.position.set(
      tgt.x + sph.r * Math.sin(sph.phi) * Math.sin(sph.theta),
      tgt.y + sph.r * Math.cos(sph.phi),
      tgt.z + sph.r * Math.sin(sph.phi) * Math.cos(sph.theta),
    );
    camera.lookAt(tgt);
  }

  canvas.addEventListener('mousedown', e => { state = e.button === 2 ? 'pan' : 'rotate'; px = e.clientX; py = e.clientY; });
  window.addEventListener('mouseup', () => state = 'idle');
  window.addEventListener('mousemove', e => {
    if (state === 'idle') return;
    const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
    if (state === 'rotate') {
      sph.theta -= dx * 0.005;
      sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dy * 0.005));
    } else {
      const dir = new THREE.Vector3().subVectors(camera.position, tgt).normalize();
      const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      const k = sph.r * 0.001;
      tgt.addScaledVector(right, -dx * k);
      tgt.addScaledVector(up, dy * k);
    }
    sync();
  });
  canvas.addEventListener('wheel', e => {
    sph.r = Math.max(10, Math.min(1e6, sph.r * (1 + e.deltaY * 0.001)));
    sync(); e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  sync();

  return {
    setTarget: v => { tgt.copy(v); sync(); },
    setR: r => { sph.r = r; sync(); },
    getR: () => sph.r,
  };
}
