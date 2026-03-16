/**
 * main.js — Crash simulation viewer
 *
 * Profile import MUST be first — registers VTK.js rendering pipeline.
 */
import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkGenericRenderWindow        from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkInteractorStyleTrackballCamera
  from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
import vtkActor                      from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper                     from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkDataArray                  from '@kitware/vtk.js/Common/Core/DataArray';
import vtkPolyData                   from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints                     from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray                  from '@kitware/vtk.js/Common/Core/CellArray';
import vtkColorTransferFunction      from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';

import { loadFrame }                 from './decoder.js';
import { buildColorTransferFunction, drawColormapToCanvas } from './colormap.js';
import { EnergyChart }               from './energyChart.js';

const SERVER = 'http://localhost:3001/data';

// ── DOM ───────────────────────────────────────────────────────────────────────
const loadingScreen  = document.getElementById('loading-screen');
const loadingMsg     = document.getElementById('loading-message');
const progressInner  = document.getElementById('progress-bar-inner');
const timeInfo       = document.getElementById('time-info');
const energyCanvas   = document.getElementById('energy-canvas');
const colorbarCanvas = document.getElementById('colorbar-gradient');
const colorbarMin    = document.getElementById('colorbar-min');
const colorbarMax    = document.getElementById('colorbar-max');
const colorbarTitle  = document.getElementById('colorbar-title');
const btnFirst       = document.getElementById('btn-first');
const btnPlay        = document.getElementById('btn-play');
const btnLast        = document.getElementById('btn-last');
const frameSlider    = document.getElementById('frame-slider');
const speedSelect    = document.getElementById('speed-select');
const fieldSelect    = document.getElementById('field-select');

// ── State ─────────────────────────────────────────────────────────────────────
let manifest     = null;
let frameCache   = new Map();   // idx → { positions, peeq, alive }
let loadingSet   = new Set();   // frames currently being fetched
let connectivity = null;        // Int32Array flat tri indices (3 per tri)

let renderer     = null;
let renderWindow = null;
let mapper       = null;
let polydata     = null;
let scalarArray  = null;

let peeqMax      = 0;
let dispMagMax   = 0;
let currentField = 'peeq';
let currentFrame = 0;
let isPlaying    = false;
let playSpeed    = 1.0;
let lastRAFTime  = null;
let simElapsed   = 0;
let energyChart  = null;
let bgLoadDone   = false;       // true when all frames are in cache

// ── Helpers ───────────────────────────────────────────────────────────────────
function setProgress(f, msg) {
  progressInner.style.width = `${Math.round(f * 100)}%`;
  if (msg) loadingMsg.textContent = msg;
}

function hideLoading() {
  loadingScreen.style.transition = 'opacity 0.4s';
  loadingScreen.style.opacity    = '0';
  setTimeout(() => loadingScreen.style.display = 'none', 420);
}

function computeDispMag(positions, frame0positions) {
  const n   = positions.length / 3;
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dx = positions[i*3]   - frame0positions[i*3];
    const dy = positions[i*3+1] - frame0positions[i*3+1];
    const dz = positions[i*3+2] - frame0positions[i*3+2];
    mag[i] = Math.sqrt(dx*dx + dy*dy + dz*dz);
  }
  return mag;
}

function avgNodeToCell(nodeMag, nCells) {
  const cellMag = new Float32Array(nCells);
  for (let c = 0; c < nCells; c++) {
    const b = c * 3;
    cellMag[c] = (nodeMag[connectivity[b]] +
                  nodeMag[connectivity[b+1]] +
                  nodeMag[connectivity[b+2]]) / 3;
  }
  return cellMag;
}

// ── VTK setup ─────────────────────────────────────────────────────────────────
function setupVTK(container) {
  const grw = vtkGenericRenderWindow.newInstance();
  grw.setContainer(container);
  grw.resize();

  renderer     = grw.getRenderer();
  renderWindow = grw.getRenderWindow();
  renderer.setBackground(0.05, 0.05, 0.10);

  grw.getInteractor().setInteractorStyle(
    vtkInteractorStyleTrackballCamera.newInstance()
  );
  window.addEventListener('resize', () => grw.resize());

  mapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: false });
  mapper.setScalarModeToUseCellData();
  mapper.setScalarVisibility(true);

  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setAmbient(0.15);
  actor.getProperty().setDiffuse(0.85);
  actor.getProperty().setSpecular(0.05);
  renderer.addActor(actor);
}

// ── Build VTK PolyData from positions + triangle connectivity ─────────────────
function buildPolyData(positions) {
  const nCells = connectivity.length / 3;   // triangles

  const pts = vtkPoints.newInstance({ dataType: 'Float32Array' });
  pts.setData(positions, 3);

  // CellArray format: [3, i0, i1, i2,  3, i0, i1, i2, ...]
  const cellData = new Int32Array(nCells * 4);
  for (let c = 0; c < nCells; c++) {
    cellData[c*4]   = 3;
    cellData[c*4+1] = connectivity[c*3];
    cellData[c*4+2] = connectivity[c*3+1];
    cellData[c*4+3] = connectivity[c*3+2];
  }
  const polys = vtkCellArray.newInstance();
  polys.setData(cellData);

  scalarArray = vtkDataArray.newInstance({
    name: 'Scalars', numberOfComponents: 1,
    values: new Float32Array(nCells),
  });

  const pd = vtkPolyData.newInstance();
  pd.setPoints(pts);
  pd.setPolys(polys);
  pd.getCellData().setScalars(scalarArray);
  return pd;
}

// ── Apply frame data to VTK scene ─────────────────────────────────────────────
function applyFrame(idx) {
  if (!frameCache.has(idx)) return;
  const { positions, peeq, alive } = frameCache.get(idx);
  const nCells = manifest.n_tris;

  // Update node positions
  polydata.getPoints().setData(positions, 3);
  polydata.getPoints().modified();

  // Build per-cell scalar array
  let scalars, range;

  if (currentField === 'peeq') {
    scalars = new Float32Array(nCells);
    for (let i = 0; i < nCells; i++)
      scalars[i] = alive[i] === 0 ? NaN : peeq[i];
    range = [0, peeqMax || 1e-6];
  } else {
    const frame0pos = frameCache.get(0).positions;
    const nodeMag   = computeDispMag(positions, frame0pos);
    const cellMag   = avgNodeToCell(nodeMag, nCells);
    scalars = new Float32Array(nCells);
    for (let i = 0; i < nCells; i++)
      scalars[i] = alive[i] === 0 ? NaN : cellMag[i];
    range = [0, dispMagMax || 1e-6];
  }

  scalarArray.setData(scalars);
  scalarArray.modified();
  polydata.getCellData().modified();
  polydata.modified();

  mapper.setScalarRange(range[0], range[1]);
  renderWindow.render();
}

// ── HUD ───────────────────────────────────────────────────────────────────────
function updateHUD(idx) {
  const t         = manifest.frames[idx].time;
  const loaded    = frameCache.size;
  const loadNote  = bgLoadDone ? '' : `  (${loaded}/${manifest.n_frames} loaded)`;
  timeInfo.textContent = `t=${t.toFixed(4)}s  f=${idx+1}/${manifest.n_frames}${loadNote}`;
  frameSlider.value    = idx;
  if (energyChart) energyChart.setCurrentTime(t);
}

function jumpToFrame(idx) {
  currentFrame = Math.max(0, Math.min(manifest.n_frames - 1, idx));
  simElapsed   = manifest.frames[currentFrame].time;
  applyFrame(currentFrame);
  updateHUD(currentFrame);
}

// ── Animation ─────────────────────────────────────────────────────────────────
function animStep(now) {
  if (!isPlaying) return;
  if (lastRAFTime !== null) simElapsed += ((now - lastRAFTime) / 1000) * playSpeed;
  lastRAFTime = now;

  const totalT = manifest.frames[manifest.n_frames - 1].time;
  if (simElapsed > totalT) simElapsed = 0;

  let fi = 0;
  for (let i = 0; i < manifest.n_frames - 1; i++) {
    if (simElapsed >= manifest.frames[i].time && frameCache.has(i)) fi = i;
  }
  currentFrame = fi;
  applyFrame(fi);
  updateHUD(fi);

  requestAnimationFrame(animStep);
}

// ── Colorbar ──────────────────────────────────────────────────────────────────
function refreshColorbar() {
  const maxVal = currentField === 'peeq' ? peeqMax : dispMagMax;
  const label  = currentField === 'peeq' ? 'PEEQ' : 'Disp |mm|';
  colorbarMin.textContent   = '0.00';
  colorbarMax.textContent   = maxVal.toFixed(4);
  colorbarTitle.textContent = label;
  const ctf = buildColorTransferFunction(vtkColorTransferFunction, 0, maxVal || 1e-6);
  mapper.setLookupTable(ctf);
  drawColormapToCanvas(colorbarCanvas, ctf, 0, maxVal || 1e-6);
}

// ── Controls ──────────────────────────────────────────────────────────────────
function setupControls() {
  btnPlay.addEventListener('click', () => {
    isPlaying = !isPlaying;
    btnPlay.textContent = isPlaying ? '⏸' : '▶';
    if (isPlaying) { lastRAFTime = null; requestAnimationFrame(animStep); }
  });
  btnFirst.addEventListener('click', () => {
    isPlaying = false; btnPlay.textContent = '▶'; jumpToFrame(0);
  });
  btnLast.addEventListener('click', () => {
    isPlaying = false; btnPlay.textContent = '▶'; jumpToFrame(manifest.n_frames - 1);
  });
  frameSlider.max = manifest.n_frames - 1;
  frameSlider.addEventListener('input', () => {
    isPlaying = false; btnPlay.textContent = '▶';
    jumpToFrame(parseInt(frameSlider.value, 10));
  });
  speedSelect.addEventListener('change', () => { playSpeed = parseFloat(speedSelect.value); });
  fieldSelect.addEventListener('change', () => {
    currentField = fieldSelect.value;
    refreshColorbar();
    applyFrame(currentFrame);
  });
}

// ── Background load remaining frames ─────────────────────────────────────────
async function backgroundLoad() {
  const pos0 = frameCache.get(0).positions;
  for (let i = 1; i < manifest.n_frames; i++) {
    if (frameCache.has(i)) continue;
    try {
      const data = await loadFrame(`${SERVER}/${manifest.frames[i].file}`, manifest);
      frameCache.set(i, data);

      // Track running max PEEQ
      for (const v of data.peeq) if (v > peeqMax) peeqMax = v;

      // Track running dispMagMax
      const mag = computeDispMag(data.positions, pos0);
      for (const v of mag) if (v > dispMagMax) dispMagMax = v;

      // Refresh colorbar range & current display when maximums grow
      refreshColorbar();
      updateHUD(currentFrame);
    } catch (err) {
      console.warn(`Failed to load frame ${i}:`, err);
    }
  }
  bgLoadDone = true;
  updateHUD(currentFrame);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  try {
    setProgress(0.02, 'Fetching manifest…');
    const resp = await fetch(`${SERVER}/manifest.json`);
    if (!resp.ok) throw new Error(`Server not reachable at ${SERVER}`);
    manifest = await resp.json();

    setProgress(0.05, 'Loading connectivity…');
    const connResp = await fetch(`${SERVER}/connectivity.bin`);
    const connBuf  = await connResp.arrayBuffer();
    connectivity   = new Int32Array(connBuf);   // flat tri indices (3 per tri)

    setProgress(0.10, 'Setting up renderer…');
    setupVTK(document.getElementById('vtk-container'));

    // Load only frame 0 up front — show viewer immediately
    setProgress(0.50, 'Loading frame 0…');
    const frame0 = await loadFrame(`${SERVER}/${manifest.frames[0].file}`, manifest);
    frameCache.set(0, frame0);
    for (const v of frame0.peeq) if (v > peeqMax) peeqMax = v;
    peeqMax = manifest.peeq_max || peeqMax;

    setProgress(0.95, 'Building scene…');
    polydata = buildPolyData(frame0.positions);
    mapper.setInputData(polydata);

    refreshColorbar();
    energyChart = new EnergyChart(energyCanvas, manifest.energy || null);
    setupControls();

    setProgress(1.0, 'Done.');
    jumpToFrame(0);
    renderer.resetCamera();
    renderWindow.render();
    hideLoading();

    // Load remaining frames in the background
    backgroundLoad();

  } catch (err) {
    loadingMsg.textContent         = `❌ ${err.message}`;
    progressInner.style.background = '#c62828';
    console.error(err);
  }
}

init();
