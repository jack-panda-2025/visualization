import "@kitware/vtk.js/Rendering/Profiles/Geometry";
import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkXMLPolyDataReader from "@kitware/vtk.js/IO/XML/XMLPolyDataReader";
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkInteractorStyleTrackballCamera from "@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";

const API = "http://localhost:3001";
const VM_MAX = 699.0;

// ── VTK setup ──────────────────────────────────────────────────────────────
const fullScreen = vtkFullScreenRenderWindow.newInstance({
  rootContainer: document.getElementById("vtk-container"),
  background: [1, 1, 1],
});
const renderer     = fullScreen.getRenderer();
const renderWindow = fullScreen.getRenderWindow();
const interactor   = fullScreen.getInteractor();
interactor.setInteractorStyle(vtkInteractorStyleTrackballCamera.newInstance());

// ── Colormaps ──────────────────────────────────────────────────────────────
const barrierCtf = vtkColorTransferFunction.newInstance();
barrierCtf.addRGBPoint(0,   0.10, 0.30, 0.80);
barrierCtf.addRGBPoint(50,  0.00, 0.85, 0.85);
barrierCtf.addRGBPoint(100, 0.10, 0.90, 0.10);
barrierCtf.addRGBPoint(160, 1.00, 0.75, 0.00);
barrierCtf.addRGBPoint(228, 1.00, 0.00, 0.00);

const pcCtf = vtkColorTransferFunction.newInstance();
pcCtf.addRGBPoint(0,   0.15, 0.30, 0.70);
pcCtf.addRGBPoint(50,  0.00, 0.95, 0.80);
pcCtf.addRGBPoint(100, 0.40, 1.00, 0.00);
pcCtf.addRGBPoint(160, 1.00, 0.85, 0.00);
pcCtf.addRGBPoint(228, 1.00, 0.15, 0.00);

// ── Actors ─────────────────────────────────────────────────────────────────
// Barrier: von Mises colored
const barrierMapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: true });
barrierMapper.setLookupTable(barrierCtf);
barrierMapper.setScalarRange(0, 228);
barrierMapper.setScalarVisibility(true);
barrierMapper.setScalarModeToUsePointFieldData();
barrierMapper.setColorByArrayName("von_mises");
const barrierActor = vtkActor.newInstance();
barrierActor.setMapper(barrierMapper);

// Vehicle: solid grey, body + tires combined
const vehicleMapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: false });
vehicleMapper.setScalarVisibility(false);
const vehicleActor = vtkActor.newInstance();
vehicleActor.setMapper(vehicleMapper);
vehicleActor.getProperty().setColor(0.55, 0.57, 0.58);
vehicleActor.getProperty().setBackfaceCulling(false);
vehicleActor.getProperty().setFrontfaceCulling(false);

// Point cloud
const pcMapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: true });
pcMapper.setLookupTable(pcCtf);
pcMapper.setScalarRange(0, 228);
pcMapper.setScalarVisibility(true);
pcMapper.setScalarModeToUsePointFieldData();
pcMapper.setColorByArrayName("von_mises");
const pcActor = vtkActor.newInstance();
pcActor.setMapper(pcMapper);
pcActor.getProperty().setPointSize(5);

// ── State ──────────────────────────────────────────────────────────────────
let metadata    = null;   // surface metadata
let pcMetadata  = null;   // point cloud metadata
let N_TOTAL     = 0;      // total points in surface binary
let N_BARRIER   = 0;      // barrier points (first N_BARRIER in binary)
let frameCache  = {};
let pcCache     = {};
let currentFrame = 0;
let viewMode    = "surface";
let isPlaying   = false;
let looping     = true;
let playTimer   = null;
let barrierPd   = null;
let vehiclePd   = null;

// ── UI refs ────────────────────────────────────────────────────────────────
const loadingEl    = document.getElementById("loading");
const ldetail      = document.getElementById("ldetail");
const hFrame       = document.getElementById("h-frame");
const hTime        = document.getElementById("h-time");
const hVmmax       = document.getElementById("h-vmmax");
const lFmax        = document.getElementById("l-fmax");
const lFrames      = document.getElementById("l-frames");
const timeBadge    = document.getElementById("time-badge");
const tlFill       = document.getElementById("tl-fill");
const tlThumb      = document.getElementById("tl-thumb");
const tlRange      = document.getElementById("tl-range");
const btnPlay      = document.getElementById("btn-play");
const btnLoop      = document.getElementById("btn-loop");
const btnMesh      = document.getElementById("btn-mesh");
const btnParticles = document.getElementById("btn-particles");

// ── Binary loaders ─────────────────────────────────────────────────────────
// Binary layout: [xyz: N_TOTAL*3 float32] [vm: N_TOTAL float32]
// Point order:   [barrier: 0..N_BARRIER-1] [vehicle: N_BARRIER..N_TOTAL-1]
async function loadFrame(i) {
  if (frameCache[i]) return frameCache[i];
  const buf = await fetch(`${API}/bin_v2/frame_${String(i).padStart(4, "0")}.bin`)
    .then(r => r.arrayBuffer());
  const all = new Float32Array(buf);
  frameCache[i] = {
    barrierXyz: all.slice(0, N_BARRIER * 3),
    vehicleXyz: all.slice(N_BARRIER * 3, N_TOTAL * 3),
    barrierVm:  all.slice(N_TOTAL * 3, N_TOTAL * 3 + N_BARRIER),
  };
  return frameCache[i];
}

async function loadPcFrame(i) {
  if (pcCache[i]) return pcCache[i];
  const buf = await fetch(`${API}/pointcloud/frame_${String(i).padStart(4, "0")}.bin`)
    .then(r => r.arrayBuffer());
  const all = new Float32Array(buf);
  const n = pcMetadata.n_points;
  pcCache[i] = { xyz: all.slice(0, n * 3), vm: all.slice(n * 3) };
  return pcCache[i];
}

// ── Render frames ──────────────────────────────────────────────────────────
async function showSurfaceFrame(i) {
  const { barrierXyz, vehicleXyz, barrierVm } = await loadFrame(i);

  barrierPd.getPoints().setData(barrierXyz, 3);
  barrierPd.getPointData().getArrayByName("von_mises").setData(barrierVm);
  barrierPd.modified();
  barrierMapper.modified();

  vehiclePd.getPoints().setData(vehicleXyz, 3);
  vehiclePd.modified();
  vehicleMapper.modified();

  renderer.resetCameraClippingRange();
  renderWindow.render();

  // Prefetch next frames
  for (let k = 1; k <= 3; k++) {
    if (i + k < metadata.n_frames) loadFrame(i + k).catch(() => {});
  }
}

async function showPcFrame(i) {
  const { xyz, vm } = await loadPcFrame(i);
  const pd = pcMapper.getInputData();
  pd.getPoints().setData(xyz, 3);
  pd.getPointData().getArrayByName("von_mises").setData(vm);
  pd.modified();
  pcMapper.modified();
  renderer.resetCameraClippingRange();
  renderWindow.render();

  for (let k = 1; k <= 3; k++) {
    if (i + k < pcMetadata.n_frames) loadPcFrame(i + k).catch(() => {});
  }
}

async function showFrame(i) {
  if (viewMode === "surface") await showSurfaceFrame(i);
  else await showPcFrame(i);
  updateUI(i);
}

// ── UI updates ─────────────────────────────────────────────────────────────
function updateUI(i) {
  const meta  = viewMode === "surface" ? metadata : pcMetadata;
  const frame = meta.frames[i];
  const pct   = (i / (meta.n_frames - 1)) * 100;
  hFrame.textContent    = `${i + 1} / ${meta.n_frames}`;
  hTime.textContent     = `${frame.time.toFixed(4)} s`;
  hVmmax.textContent    = `${frame.vm_max.toFixed(1)} MPa`;
  lFmax.textContent     = `${frame.vm_max.toFixed(1)} MPa`;
  timeBadge.textContent = `T = ${frame.time.toFixed(4)} s`;
  tlFill.style.width    = pct + "%";
  tlThumb.style.left    = pct + "%";
  tlRange.value         = i;
  drawChart(i);
}

function setViewMode(mode) {
  if (mode === viewMode) return;
  if (mode === "particles" && !pcMetadata) return;
  viewMode = mode;
  const isSurface = mode === "surface";
  barrierActor.setVisibility(isSurface);
  vehicleActor.setVisibility(isSurface);
  pcActor.setVisibility(!isSurface);
  renderer.setBackground(isSurface ? [1, 1, 1] : [0.027, 0.043, 0.078]);
  btnMesh.classList.toggle("on", isSurface);
  btnParticles.classList.toggle("on", !isSurface);
  showFrame(currentFrame);
}

btnMesh.addEventListener("click", () => setViewMode("surface"));
btnParticles.addEventListener("click", () => setViewMode("particles"));

// ── Timeline ───────────────────────────────────────────────────────────────
function buildMarks() {
  const el = document.getElementById("tl-marks");
  el.innerHTML = "";
  for (let k = 0; k <= 6; k++) {
    const idx = Math.round((k / 6) * (metadata.n_frames - 1));
    const d = document.createElement("div");
    d.className = "tl-mark";
    d.textContent = metadata.frames[idx].time.toFixed(3) + "s";
    el.appendChild(d);
  }
}

tlRange.addEventListener("input", () => {
  currentFrame = parseInt(tlRange.value);
  showFrame(currentFrame);
});

// ── Playback ───────────────────────────────────────────────────────────────
function togglePlay() {
  isPlaying = !isPlaying;
  btnPlay.textContent = isPlaying ? "⏸" : "▶";
  btnPlay.classList.toggle("on", isPlaying);
  if (isPlaying) scheduleNext();
  else clearTimeout(playTimer);
}

function scheduleNext() {
  if (!isPlaying) return;
  const delay = Math.round(100 / parseFloat(document.getElementById("spd").value));
  playTimer = setTimeout(async () => {
    const meta = viewMode === "surface" ? metadata : pcMetadata;
    currentFrame++;
    if (currentFrame >= meta.n_frames) {
      currentFrame = looping ? 0 : meta.n_frames - 1;
      if (!looping) { togglePlay(); return; }
    }
    await showFrame(currentFrame);
    scheduleNext();
  }, delay);
}

btnPlay.addEventListener("click", togglePlay);
document.getElementById("btn-rew").addEventListener("click", () => {
  currentFrame = Math.max(0, currentFrame - 1);
  showFrame(currentFrame);
});
document.getElementById("btn-fwd").addEventListener("click", () => {
  const meta = viewMode === "surface" ? metadata : pcMetadata;
  currentFrame = Math.min(meta.n_frames - 1, currentFrame + 1);
  showFrame(currentFrame);
});
btnLoop.addEventListener("click", () => {
  looping = !looping;
  btnLoop.classList.toggle("on", looping);
});

// ── Chart ──────────────────────────────────────────────────────────────────
function buildChart() {
  const canvas = document.getElementById("chart-vm");
  const p = canvas.parentElement;
  canvas.width  = p.clientWidth - 24;
  canvas.height = Math.max(80, p.clientHeight - 36);
  drawChart(currentFrame);
}

function drawChart(idx) {
  const canvas = document.getElementById("chart-vm");
  if (!canvas || !metadata) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const vms = metadata.frames.map(f => f.vm_max);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#070b10";
  ctx.fillRect(0, 0, W, H);

  // Yield line
  const yY = H - (350 / VM_MAX) * (H - 16) - 4;
  ctx.save();
  ctx.strokeStyle = "rgba(232,240,74,0.25)";
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(0, yY); ctx.lineTo(W, yY); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "rgba(232,240,74,0.45)";
  ctx.font = "8px DM Mono,monospace";
  ctx.fillText("yield ~350 MPa", 3, yY - 3);

  // Area
  ctx.beginPath();
  vms.forEach((v, i) => {
    const x = (i / (vms.length - 1)) * W;
    const y = H - (v / VM_MAX) * (H - 16) - 4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = "rgba(255,60,31,0.08)";
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = "#ff3c1f";
  ctx.lineWidth = 1.5;
  vms.forEach((v, i) => {
    const x = (i / (vms.length - 1)) * W;
    const y = H - (v / VM_MAX) * (H - 16) - 4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Cursor
  const px = (idx / (vms.length - 1)) * W;
  ctx.strokeStyle = "rgba(232,240,74,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  const py = H - (vms[idx] / VM_MAX) * (H - 16) - 4;
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#e8f04a";
  ctx.fill();
}

// ── Build surface PolyData from VTP frame 0 ────────────────────────────────
// VTP point order: [barrier: 0..N_BARRIER-1] [vehicle: N_BARRIER..N_TOTAL-1]
// We split polys at N_BARRIER and build two separate PolyData instances.
function buildSurface(vtpPd) {
  const allPts  = vtpPd.getPoints().getData();
  const polys   = vtpPd.getPolys().getData();
  const vmAll   = vtpPd.getPointData().getArrayByName("von_mises").getData();

  const bPolys = [];  // barrier polys (original indices)
  const vPolys = [];  // vehicle polys (indices remapped by -N_BARRIER)

  let off = 0;
  while (off < polys.length) {
    const n         = polys[off];
    const firstIdx  = polys[off + 1];
    if (firstIdx < N_BARRIER) {
      // Barrier polygon
      for (let k = 0; k <= n; k++) bPolys.push(polys[off + k]);
    } else {
      // Vehicle polygon (body or tire — treated the same)
      vPolys.push(n);
      for (let k = 1; k <= n; k++) vPolys.push(polys[off + k] - N_BARRIER);
    }
    off += n + 1;
  }

  // Barrier PolyData
  barrierPd = vtkPolyData.newInstance();
  barrierPd.getPoints().setData(new Float32Array(allPts.slice(0, N_BARRIER * 3)), 3);
  barrierPd.getPolys().setData(new Uint32Array(bPolys));
  const bVm = vtkDataArray.newInstance({
    name: "von_mises",
    values: new Float32Array(vmAll.slice(0, N_BARRIER)),
    numberOfComponents: 1,
  });
  barrierPd.getPointData().addArray(bVm);
  barrierPd.getPointData().setActiveScalars("von_mises");

  // Vehicle PolyData (body + tires, grey, no scalar coloring)
  vehiclePd = vtkPolyData.newInstance();
  vehiclePd.getPoints().setData(new Float32Array(allPts.slice(N_BARRIER * 3)), 3);
  vehiclePd.getPolys().setData(new Uint32Array(vPolys));

  barrierMapper.setInputData(barrierPd);
  vehicleMapper.setInputData(vehiclePd);
  renderer.addActor(barrierActor);
  renderer.addActor(vehicleActor);
}

// ── Init point cloud ───────────────────────────────────────────────────────
async function initPointCloud() {
  try {
    const res = await fetch(`${API}/api/pointcloud_metadata`);
    if (!res.ok) return;
    pcMetadata = await res.json();

    const { xyz, vm } = await loadPcFrame(0);
    const n = pcMetadata.n_points;
    const pd = vtkPolyData.newInstance();
    pd.getPoints().setData(xyz, 3);
    // Each point as a vertex cell
    const verts = new Uint32Array(n * 2);
    for (let i = 0; i < n; i++) { verts[i * 2] = 1; verts[i * 2 + 1] = i; }
    pd.getVerts().setData(verts);
    const vmArr = vtkDataArray.newInstance({
      name: "von_mises", values: vm, numberOfComponents: 1,
    });
    pd.getPointData().addArray(vmArr);
    pd.getPointData().setActiveScalars("von_mises");
    pcMapper.setInputData(pd);
    renderer.addActor(pcActor);
    pcActor.setVisibility(false);
    btnParticles.disabled = false;

    // Preload all PC frames in background
    (async () => {
      for (let k = 1; k < pcMetadata.n_frames; k++) await loadPcFrame(k);
    })();
  } catch (e) {
    console.warn("Point cloud not available:", e.message);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  ldetail.textContent = "fetching metadata...";
  try {
    const res = await fetch(`${API}/api/metadata`);
    metadata  = await res.json();
    N_TOTAL   = metadata.n_points;
    N_BARRIER = metadata.n_pts_barrier;
    tlRange.max = metadata.n_frames - 1;
    buildMarks();
  } catch (e) {
    ldetail.textContent = "ERROR: server not running";
    return;
  }

  if (!N_TOTAL || !N_BARRIER) {
    ldetail.textContent = "ERROR: metadata missing n_points or n_pts_barrier";
    return;
  }

  // Load topology from VTP frame 0
  ldetail.textContent = "loading geometry...";
  const reader = vtkXMLPolyDataReader.newInstance();
  await reader.setUrl(`${API}/data_v2/frame_0000.vtp`);
  await reader.loadData();
  buildSurface(reader.getOutputData(0));

  // Camera aimed at crash zone
  const cam = renderer.getActiveCamera();
  cam.setPosition(3917, 555 - 40000, 25000);
  cam.setFocalPoint(3917, 555, 822);
  cam.setViewUp(0, 0, 1);
  renderer.resetCameraClippingRange();

  // Show frame 0
  ldetail.textContent = "loading frame 0...";
  await showSurfaceFrame(0);
  updateUI(0);
  lFrames.textContent = `${metadata.n_frames} / ${metadata.n_frames}`;

  loadingEl.classList.add("hidden");
  setTimeout(() => { loadingEl.style.display = "none"; }, 500);
  setTimeout(buildChart, 200);
  window.addEventListener("resize", buildChart);

  // Preload all surface frames in background
  (async () => {
    for (let k = 1; k < metadata.n_frames; k++) await loadFrame(k);
  })();

  await initPointCloud();
}

main().catch(e => {
  ldetail.textContent = "ERROR: " + e.message;
  console.error(e);
});
