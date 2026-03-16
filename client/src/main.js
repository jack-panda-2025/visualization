/**
 * main.js — Crash simulation viewer (simplified pipeline)
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
const loadingScreen = document.getElementById('loading-screen');
const loadingMsg    = document.getElementById('loading-message');
const progressInner = document.getElementById('progress-bar-inner');
const timeInfo      = document.getElementById('time-info');
const energyCanvas  = document.getElementById('energy-canvas');
const colorbarCanvas= document.getElementById('colorbar-gradient');
const colorbarMin   = document.getElementById('colorbar-min');
const colorbarMax   = document.getElementById('colorbar-max');
const colorbarTitle = document.getElementById('colorbar-title');
const btnFirst      = document.getElementById('btn-first');
const btnPlay       = document.getElementById('btn-play');
const btnLast       = document.getElementById('btn-last');
const frameSlider   = document.getElementById('frame-slider');
const speedSelect   = document.getElementById('speed-select');
const fieldSelect   = document.getElementById('field-select');

// ── State ─────────────────────────────────────────────────────────────────────
let manifest     = null;
let frameCache   = new Map();     // idx → { positions, peeq, alive }
let connectivity = null;          // Int32Array flat triangle indices (3 per cell)

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function setProgress(f, msg) {
  progressInner.style.width = `${Math.round(f * 100)}%`;
  if (msg) loadingMsg.textContent = msg;
}

function hideLoading() {
  loadingScreen.style.transition = 'opacity 0.4s';
  loadingScreen.style.opacity = '0';
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
  // connectivity: flat triangle indices, 3 values per cell
  for (let c = 0; c < nCells; c++) {
    const base = c * 3;
    cellMag[c] = (nodeMag[connectivity[base]]   + nodeMag[connectivity[base+1]] +
                  nodeMag[connectivity[base+2]]) / 3;
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

// ── Build polydata from connectivity + positions ───────────────────────────────
function buildPolyData(positions) {
  const nNodes = positions.length / 3;
  const nCells = connectivity.length / 3;  // triangles: 3 indices per cell

  // Points
  const pts = vtkPoints.newInstance({ dataType: 'Float32Array' });
  pts.setData(positions, 3);

  // Cells: VTK CellArray format [n0, i0, i1, i2,  n1, i0, i1, i2, ...]
  const cellData = new Int32Array(nCells * 4);
  for (let c = 0; c < nCells; c++) {
    cellData[c*4]   = 3;
    cellData[c*4+1] = connectivity[c*3];
    cellData[c*4+2] = connectivity[c*3+1];
    cellData[c*4+3] = connectivity[c*3+2];
  }
  const polys = vtkCellArray.newInstance();
  polys.setData(cellData);

  // Scalar array
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

// ── Apply frame ───────────────────────────────────────────────────────────────
function applyFrame(idx) {
  const { positions, peeq, alive } = frameCache.get(idx);
  const nCells = manifest.n_tris;

  // Update point positions
  polydata.getPoints().setData(positions, 3);
  polydata.getPoints().modified();

  // Build cell scalars
  let scalars;
  let range;

  if (currentField === 'peeq') {
    scalars = new Float32Array(nCells);
    for (let i = 0; i < nCells; i++)
      scalars[i] = alive[i] < 0.5 ? NaN : peeq[i];
    range = [0, peeqMax || 1e-6];
  } else {
    const frame0pos = frameCache.get(0).positions;
    const nodeMag   = computeDispMag(positions, frame0pos);
    const cellMag   = avgNodeToCell(nodeMag, nCells);
    scalars = new Float32Array(nCells);
    for (let i = 0; i < nCells; i++)
      scalars[i] = alive[i] < 0.5 ? NaN : cellMag[i];
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
  const t = manifest.frames[idx].time;
  timeInfo.textContent = `t=${t.toFixed(4)}s  f=${idx+1}/${manifest.n_frames}`;
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

  // Find frame
  let fi = 0;
  for (let i = 0; i < manifest.n_frames - 1; i++) {
    if (simElapsed >= manifest.frames[i].time) fi = i;
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
  btnFirst.addEventListener('click', () => { isPlaying = false; btnPlay.textContent = '▶'; jumpToFrame(0); });
  btnLast.addEventListener('click',  () => { isPlaying = false; btnPlay.textContent = '▶'; jumpToFrame(manifest.n_frames - 1); });
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
    connectivity   = new Int32Array(connBuf);   // flat triangle indices (3 per tri)

    setProgress(0.10, 'Setting up renderer…');
    setupVTK(document.getElementById('vtk-container'));

    // Load all frames
    for (let i = 0; i < manifest.n_frames; i++) {
      setProgress(0.10 + (i / manifest.n_frames) * 0.85,
        `Loading frame ${i+1}/${manifest.n_frames}…`);
      const data = await loadFrame(`${SERVER}/${manifest.frames[i].file}`, manifest);
      frameCache.set(i, data);

      // Track global maxima
      for (const v of data.peeq) if (v > peeqMax) peeqMax = v;
    }
    peeqMax = manifest.peeq_max || peeqMax;

    // Compute dispMagMax from frame 0 vs last frame
    const pos0  = frameCache.get(0).positions;
    const posN  = frameCache.get(manifest.n_frames - 1).positions;
    const magN  = computeDispMag(posN, pos0);
    for (const v of magN) if (v > dispMagMax) dispMagMax = v;

    setProgress(0.97, 'Building scene…');

    // Build VTK polydata from frame 0
    polydata = buildPolyData(frameCache.get(0).positions);
    mapper.setInputData(polydata);

    // Colormap
    refreshColorbar();

    // Energy chart
    energyChart = new EnergyChart(energyCanvas, manifest.energy || null);

    setupControls();

    setProgress(1.0, 'Done.');
    jumpToFrame(0);
    renderer.resetCamera();
    renderWindow.render();
    hideLoading();

  } catch (err) {
    loadingMsg.textContent         = `❌ ${err.message}`;
    progressInner.style.background = '#c62828';
    console.error(err);
  }
}

init();
