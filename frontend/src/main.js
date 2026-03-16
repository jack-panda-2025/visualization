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
let N_POINTS_SURFACE = 0;  // set from metadata.n_points after fetch
let N_BARRIER_PTS = 0;
let N_BODY_PTS    = 0;

// ── vtk setup ──
const container = document.getElementById("vtk-container");
const fullScreen = vtkFullScreenRenderWindow.newInstance({
  rootContainer: container,
  background: [1.0, 1.0, 1.0],
});
const renderer     = fullScreen.getRenderer();
const renderWindow = fullScreen.getRenderWindow();
const interactor   = fullScreen.getInteractor();
interactor.setInteractorStyle(vtkInteractorStyleTrackballCamera.newInstance());

// ── colormap（应力色表）──
const ctf = vtkColorTransferFunction.newInstance();
ctf.addRGBPoint(0,   0.30, 0.35, 0.55);
ctf.addRGBPoint(15,  0.10, 0.40, 0.90);
ctf.addRGBPoint(50,  0.00, 0.85, 0.85);
ctf.addRGBPoint(100, 0.10, 0.90, 0.10);
ctf.addRGBPoint(160, 1.00, 0.75, 0.00);
ctf.addRGBPoint(228, 1.00, 0.00, 0.00);

// 粒子 colormap
const pcCtf = vtkColorTransferFunction.newInstance();
pcCtf.addRGBPoint(0,   0.15, 0.30, 0.70);
pcCtf.addRGBPoint(10,  0.10, 0.55, 1.00);
pcCtf.addRGBPoint(50,  0.00, 0.95, 0.80);
pcCtf.addRGBPoint(100, 0.40, 1.00, 0.00);
pcCtf.addRGBPoint(160, 1.00, 0.85, 0.00);
pcCtf.addRGBPoint(228, 1.00, 0.15, 0.00);

// ── 护栏 pipeline（应力着色）──
const barrierMapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: true });
barrierMapper.setLookupTable(ctf);
barrierMapper.setScalarRange(0, 228);
barrierMapper.setScalarVisibility(true);
barrierMapper.setScalarModeToUsePointFieldData();
barrierMapper.setColorByArrayName("von_mises");
// 向后偏移，防止与车辆面片 z-fighting
barrierMapper.setResolveCoincidentTopologyToPolygonOffset();
barrierMapper.setResolveCoincidentTopologyPolygonOffsetParameters(4.0, 4.0);

const barrierActor = vtkActor.newInstance();
barrierActor.setMapper(barrierMapper);

// ── 车辆 pipeline（车身+轮胎合并，钢铁灰，双面渲染）──
const vehicleMapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: false });
vehicleMapper.setScalarVisibility(false);

const vehicleActor = vtkActor.newInstance();
vehicleActor.setMapper(vehicleMapper);
vehicleActor.getProperty().setColor(0.55, 0.57, 0.58);
vehicleActor.getProperty().setBackfaceCulling(false);
vehicleActor.getProperty().setFrontfaceCulling(false);

// addActor 在 splitVtpPolyData() 之后执行，确保 mapper 有数据

// ── 点云 pipeline ──
const pcMapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: true });
pcMapper.setLookupTable(pcCtf);
pcMapper.setScalarRange(0, 228);
pcMapper.setScalarVisibility(true);
pcMapper.setScalarModeToUsePointFieldData();
pcMapper.setColorByArrayName("von_mises");

const pcActor = vtkActor.newInstance();
pcActor.setMapper(pcMapper);
pcActor.getProperty().setPointSize(5);

// ── state ──
let metadata    = null;
let pcMetadata  = null;
let frameCache    = {};
let pcFrameCache  = {};
let currentFrame  = 0;
let viewMode      = "surface";
let isPlaying     = false;
let looping       = true;
let playTimer     = null;
let N_PC          = 0;
let N_VEHICLE_PTS = 0;
let barrierPd     = null;
let vehiclePd     = null;

// ── UI refs ──
const loadingEl    = document.getElementById("loading");
const ldetail      = document.getElementById("ldetail");
const hFrame       = document.getElementById("h-frame");
const hTime        = document.getElementById("h-time");
const hVmmax       = document.getElementById("h-vmmax");
const lFrames      = document.getElementById("l-frames");
const lFmax        = document.getElementById("l-fmax");
const timeBadge    = document.getElementById("time-badge");
const tlFill       = document.getElementById("tl-fill");
const tlThumb      = document.getElementById("tl-thumb");
const tlRange      = document.getElementById("tl-range");
const btnPlay      = document.getElementById("btn-play");
const btnLoop      = document.getElementById("btn-loop");
const btnMesh      = document.getElementById("btn-mesh");
const btnParticles = document.getElementById("btn-particles");

// ── load surface frame ──
async function loadFrame(i) {
  if (frameCache[i]) return frameCache[i];
  const res = await fetch(`${API}/bin_v2/frame_${String(i).padStart(4, "0")}.bin`);
  const buf = await res.arrayBuffer();
  const all = new Float32Array(buf);
  frameCache[i] = {
    barrierXyz: all.slice(0, N_BARRIER_PTS * 3),
    vehicleXyz: all.slice(N_BARRIER_PTS * 3, N_POINTS_SURFACE * 3),
    barrierVm:  all.slice(N_POINTS_SURFACE * 3, N_POINTS_SURFACE * 3 + N_BARRIER_PTS),
  };
  return frameCache[i];
}

// ── load point cloud frame ──
async function loadPcFrame(i) {
  if (pcFrameCache[i]) return pcFrameCache[i];
  const res = await fetch(`${API}/pointcloud/frame_${String(i).padStart(4, "0")}.bin`);
  const buf = await res.arrayBuffer();
  const all = new Float32Array(buf);
  pcFrameCache[i] = { points: all.slice(0, N_PC * 3), vm: all.slice(N_PC * 3) };
  return pcFrameCache[i];
}

// ── UI update ──
function updateUI(i, meta) {
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

// ── show surface frame ──
async function showSurfaceFrame(i) {
  const { barrierXyz, vehicleXyz, barrierVm } = await loadFrame(i);

  barrierPd.getPoints().setData(barrierXyz);
  barrierPd.getPointData().getArrayByName("von_mises").setData(barrierVm);
  barrierPd.modified();
  barrierMapper.modified();

  vehiclePd.getPoints().setData(vehicleXyz);
  vehiclePd.modified();
  vehicleMapper.modified();

  renderer.resetCameraClippingRange();
  renderWindow.render();

  for (let k = 1; k <= 5; k++) {
    if (i + k < metadata.n_frames) loadFrame(i + k).catch(() => {});
  }
}

// ── show point cloud frame ──
async function showPcFrame(i) {
  const { points, vm } = await loadPcFrame(i);
  const pd = pcMapper.getInputData();
  pd.getPoints().setData(points, 3);
  pd.getPointData().getArrayByName("von_mises").setData(vm);
  pd.modified();
  pcMapper.modified();
  renderer.resetCameraClippingRange();
  renderWindow.render();

  for (let k = 1; k <= 5; k++) {
    if (i + k < pcMetadata.n_frames) loadPcFrame(i + k).catch(() => {});
  }
}

// ── unified showFrame ──
async function showFrame(i) {
  if (viewMode === "surface") {
    await showSurfaceFrame(i);
    updateUI(i, metadata);
  } else {
    await showPcFrame(i);
    updateUI(i, pcMetadata);
  }
}

// ── view mode toggle ──
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

btnMesh.addEventListener("click",      () => setViewMode("surface"));
btnParticles.addEventListener("click", () => setViewMode("particles"));

// ── timeline ──
function buildMarks() {
  const el = document.getElementById("tl-marks");
  el.innerHTML = "";
  for (let k = 0; k <= 6; k++) {
    const idx = Math.round((k / 6) * (metadata.n_frames - 1));
    const d   = document.createElement("div");
    d.className   = "tl-mark";
    d.textContent = metadata.frames[idx].time.toFixed(3) + "s";
    el.appendChild(d);
  }
}

tlRange.addEventListener("input", () => {
  currentFrame = parseInt(tlRange.value);
  showFrame(currentFrame);
});

// ── playback ──
function togglePlay() {
  isPlaying = !isPlaying;
  btnPlay.textContent = isPlaying ? "⏸" : "▶";
  btnPlay.classList.toggle("on", isPlaying);
  if (isPlaying) scheduleNext();
  else clearTimeout(playTimer);
}

function scheduleNext() {
  if (!isPlaying) return;
  const spd   = parseFloat(document.getElementById("spd").value);
  const delay = Math.round(100 / spd);
  playTimer = setTimeout(async () => {
    currentFrame++;
    const total = viewMode === "surface"
      ? metadata.n_frames
      : (pcMetadata?.n_frames ?? metadata.n_frames);
    if (currentFrame >= total) {
      currentFrame = looping ? 0 : total - 1;
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
  const total = viewMode === "surface"
    ? metadata.n_frames
    : (pcMetadata?.n_frames ?? metadata.n_frames);
  currentFrame = Math.min(total - 1, currentFrame + 1);
  showFrame(currentFrame);
});
btnLoop.addEventListener("click", () => {
  looping = !looping;
  btnLoop.classList.toggle("on", looping);
});

// ── chart ──
function buildChart() {
  const canvas = document.getElementById("chart-vm");
  const p = canvas.parentElement;
  canvas.width  = p.clientWidth - 24;
  canvas.height = Math.max(80, p.clientHeight - 36);
  drawChart(currentFrame);
}

function drawChart(activeIdx) {
  const canvas = document.getElementById("chart-vm");
  if (!canvas || !metadata) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const vms = metadata.frames.map((f) => f.vm_max);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#070b10";
  ctx.fillRect(0, 0, W, H);

  const yY = H - (350 / VM_MAX) * (H - 16) - 4;
  ctx.save();
  ctx.strokeStyle = "rgba(232,240,74,0.25)";
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(0, yY); ctx.lineTo(W, yY); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "rgba(232,240,74,0.45)";
  ctx.font = "8px DM Mono,monospace";
  ctx.fillText("yield ~350 MPa", 3, yY - 3);

  ctx.beginPath();
  vms.forEach((v, i) => {
    const x = (i / (vms.length - 1)) * W;
    const y = H - (v / VM_MAX) * (H - 16) - 4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = "rgba(255,60,31,0.08)";
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = "#ff3c1f";
  ctx.lineWidth = 1.5;
  vms.forEach((v, i) => {
    const x = (i / (vms.length - 1)) * W;
    const y = H - (v / VM_MAX) * (H - 16) - 4;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  const px = (activeIdx / (vms.length - 1)) * W;
  ctx.strokeStyle = "rgba(232,240,74,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  const py = H - (vms[activeIdx] / VM_MAX) * (H - 16) - 4;
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#e8f04a";
  ctx.fill();
}

// ── 从 VTP 拆分护栏 / 车身 / 轮胎 三个独立 PolyData ──
// VTP 点序：[barrier pts][body pts][tire pts]
function splitVtpPolyData(initPd) {
  const allPoints = initPd.getPoints().getData();
  const polysData = initPd.getPolys().getData();
  const vmAll     = initPd.getPointData().getArrayByName("von_mises").getData();

  const bodyStart = N_BARRIER_PTS;
  const tireStart = N_BARRIER_PTS + N_BODY_PTS;

  const barrierPolys = [];
  const vehiclePolys = [];
  let offset = 0;
  while (offset < polysData.length) {
    const n        = polysData[offset];
    const firstIdx = polysData[offset + 1];
    if (firstIdx < bodyStart) {
      // barrier
      for (let k = 0; k <= n; k++) barrierPolys.push(polysData[offset + k]);
    } else {
      // body + tire 合并，统一偏移 -bodyStart
      vehiclePolys.push(n);
      for (let k = 1; k <= n; k++) vehiclePolys.push(polysData[offset + k] - bodyStart);
    }
    offset += n + 1;
  }

  // 护栏 PolyData
  barrierPd = vtkPolyData.newInstance();
  barrierPd.getPoints().setData(new Float32Array(allPoints.slice(0, bodyStart * 3)));
  barrierPd.getPolys().setData(new Uint32Array(barrierPolys));
  const bVm = vtkDataArray.newInstance({
    name: "von_mises",
    values: new Float32Array(vmAll.slice(0, N_BARRIER_PTS)),
    numberOfComponents: 1,
  });
  barrierPd.getPointData().addArray(bVm);
  barrierPd.getPointData().setActiveScalars("von_mises");

  // 车辆 PolyData（车身 + 轮胎合并）
  vehiclePd = vtkPolyData.newInstance();
  vehiclePd.getPoints().setData(new Float32Array(allPoints.slice(bodyStart * 3)));
  vehiclePd.getPolys().setData(new Uint32Array(vehiclePolys));

  barrierMapper.setInputData(barrierPd);
  vehicleMapper.setInputData(vehiclePd);
  renderer.addActor(barrierActor);
  renderer.addActor(vehicleActor);
}

// ── 初始化点云 ──
async function initPointCloud() {
  try {
    const res = await fetch(`${API}/api/pointcloud_metadata`);
    if (!res.ok) return;
    pcMetadata = await res.json();
    N_PC = pcMetadata.n_points;

    ldetail.textContent = "loading point cloud frame 0...";
    const { points, vm } = await loadPcFrame(0);

    const pd = vtkPolyData.newInstance();
    pd.getPoints().setData(points, 3);
    const n = points.length / 3;
    const verts = new Uint32Array(n * 2);
    for (let i = 0; i < n; i++) { verts[i * 2] = 1; verts[i * 2 + 1] = i; }
    pd.getVerts().setData(verts);
    const vmArr = vtkDataArray.newInstance({ name: "von_mises", values: vm, numberOfComponents: 1 });
    pd.getPointData().addArray(vmArr);
    pd.getPointData().setActiveScalars("von_mises");
    pcMapper.setInputData(pd);

    renderer.addActor(pcActor);
    pcActor.setVisibility(false);
    btnParticles.disabled = false;
    console.log(`点云就绪: ${N_PC.toLocaleString()} 点/帧`);

    (async () => {
      for (let k = 1; k < pcMetadata.n_frames; k++) await loadPcFrame(k);
      console.log("点云所有帧预加载完成");
    })();
  } catch (e) {
    console.warn("点云数据未找到:", e.message);
  }
}

// ── main ──
async function main() {
  ldetail.textContent = "fetching metadata...";
  try {
    const res = await fetch(`${API}/api/metadata`);
    metadata = await res.json();
    N_BARRIER_PTS = metadata.n_pts_barrier || 0;
    N_BODY_PTS    = metadata.n_pts_body    || 0;
    N_POINTS_SURFACE = metadata.n_points   || 0;
    N_VEHICLE_PTS = N_POINTS_SURFACE - N_BARRIER_PTS;
    buildMarks();
  } catch (e) {
    ldetail.textContent = "ERROR: run node server/server.js first!";
    return;
  }

  if (!N_BARRIER_PTS || !N_BODY_PTS || !N_POINTS_SURFACE) {
    ldetail.textContent = "ERROR: metadata missing — re-run export_vtp_v2.py then export_binary_v2.py";
    return;
  }

  // 初始化两个 surface pipeline
  ldetail.textContent = "loading geometry...";
  const initReader = vtkXMLPolyDataReader.newInstance();
  await initReader.setUrl(`${API}/data_v2/frame_0000.vtp`);
  await initReader.loadData();
  const initPd = initReader.getOutputData(0);
  splitVtpPolyData(initPd);

  // 对准碰撞区域
  const camera = renderer.getActiveCamera();
  camera.setPosition(3917, 555 - 40000, 25000);
  camera.setFocalPoint(3917, 555, 822);
  camera.setViewUp(0, 0, 1);
  renderer.resetCameraClippingRange();
  renderWindow.render();

  ldetail.textContent = "loading frame 0...";
  await loadFrame(0);

  lFrames.textContent = `${metadata.n_frames} / ${metadata.n_frames}`;
  updateUI(0, metadata);

  loadingEl.classList.add("hidden");
  setTimeout(() => { loadingEl.style.display = "none"; }, 500);
  setTimeout(buildChart, 200);
  window.addEventListener("resize", buildChart);

  (async () => {
    for (let k = 1; k < metadata.n_frames; k++) await loadFrame(k);
    console.log("Surface 所有帧预加载完成");
  })();

  await initPointCloud();
}

main().catch((e) => {
  ldetail.textContent = "ERROR: " + e.message;
  console.error(e);
});
