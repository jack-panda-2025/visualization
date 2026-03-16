/**
 * main.js
 * Crash simulation viewer – VTK.js front-end.
 */

import vtkRenderWindow               from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderer                   from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow         from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkRenderWindowInteractor     from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkInteractorStyleTrackballCamera
  from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
import vtkActor                      from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper                     from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkXMLPolyDataReader          from '@kitware/vtk.js/IO/XML/XMLPolyDataReader';
import vtkDataArray                  from '@kitware/vtk.js/Common/Core/DataArray';
import vtkColorTransferFunction      from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';

import { loadFrame }               from './decoder.js';
import { buildColorTransferFunction, drawColormapToCanvas } from './colormap.js';
import { EnergyChart }             from './energyChart.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants / config
// ─────────────────────────────────────────────────────────────────────────────
const SERVER_BASE = 'http://localhost:3001/data';

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────
const loadingScreen  = document.getElementById('loading-screen');
const loadingMsg     = document.getElementById('loading-message');
const progressInner  = document.getElementById('progress-bar-inner');
const timeInfo       = document.getElementById('time-info');
const fieldSelect    = document.getElementById('field-select');
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

// ─────────────────────────────────────────────────────────────────────────────
// Application state
// ─────────────────────────────────────────────────────────────────────────────
let manifest      = null;
let polydata      = null;
let basePoints    = null;          // Float32Array  – original positions from VTP
let frameCache    = new Map();     // frameIndex → {displacement, peeq, alive}
let currentField  = 'peeq';       // 'peeq' | 'disp_mag'

let globalMaxPEEQ   = 0;
let globalMaxDispMag = 0;

let ctf           = null;         // vtkColorTransferFunction
let mapper        = null;
let renderer      = null;
let renderWindow  = null;
let glWindow      = null;

let isPlaying     = false;
let currentFrameIdx = 0;          // integer frame index (0..n-1)
let playSpeed     = 1.0;
let lastRAFTime   = null;
let simElapsed    = 0;            // simulated time (seconds)

let energyChart   = null;
let peeqCellArray = null;         // vtkDataArray for cell scalars

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────
function setProgress(fraction, message) {
  progressInner.style.width = `${Math.round(fraction * 100)}%`;
  if (message !== undefined) loadingMsg.textContent = message;
}

function hideLoadingScreen() {
  loadingScreen.style.transition = 'opacity 0.4s';
  loadingScreen.style.opacity    = '0';
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 420);
}

function formatTime(t) {
  return t.toFixed(4) + 's';
}

/** Linear interpolation between two Float32Arrays of the same length. */
function lerpArrays(a, b, t, out) {
  const len = a.length;
  for (let i = 0; i < len; i++) {
    out[i] = a[i] + (b[i] - a[i]) * t;
  }
}

/**
 * Given a simulated time, find the two surrounding frame indices and blend.
 * Returns { iA, iB, alpha } — alpha=0 means purely frame iA.
 */
function resolveFrameTime(simTime) {
  const frames = manifest.frames;
  const n      = frames.length;

  if (simTime <= frames[0].time)       return { iA: 0, iB: 0, alpha: 0 };
  if (simTime >= frames[n - 1].time)   return { iA: n - 1, iB: n - 1, alpha: 0 };

  for (let i = 0; i < n - 1; i++) {
    if (simTime >= frames[i].time && simTime <= frames[i + 1].time) {
      const span  = frames[i + 1].time - frames[i].time;
      const alpha = span > 0 ? (simTime - frames[i].time) / span : 0;
      return { iA: i, iB: i + 1, alpha };
    }
  }
  return { iA: n - 1, iB: n - 1, alpha: 0 };
}

/** Compute per-node displacement magnitude from dx,dy,dz arrays. */
function computeDispMag(displacement) {
  const n   = displacement.length / 3;
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dx = displacement[i * 3];
    const dy = displacement[i * 3 + 1];
    const dz = displacement[i * 3 + 2];
    mag[i]   = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return mag;
}

/**
 * Average per-node scalar values onto cells.
 * polydata must have its connectivity available.
 */
function avgNodeToCell(nodeMag, polydata) {
  const nCells  = manifest.n_surf_cells;
  const cellMag = new Float32Array(nCells);

  const polys = polydata.getPolys();
  // polys data is stored as: [nPts0, pt0, pt1, …, nPts1, …]
  const data  = polys.getData();
  let   offset = 0;
  for (let c = 0; c < nCells; c++) {
    const nPts = data[offset++];
    let   sum  = 0;
    for (let p = 0; p < nPts; p++) {
      sum += nodeMag[data[offset++]];
    }
    cellMag[c] = sum / nPts;
  }
  return cellMag;
}

// ─────────────────────────────────────────────────────────────────────────────
// VTK pipeline setup
// ─────────────────────────────────────────────────────────────────────────────
function setupVTK(container) {
  renderWindow = vtkRenderWindow.newInstance();
  renderer     = vtkRenderer.newInstance({
    background: [0.05, 0.05, 0.10],
  });
  renderWindow.addRenderer(renderer);

  glWindow = vtkOpenGLRenderWindow.newInstance();
  glWindow.setContainer(container);
  renderWindow.addView(glWindow);

  // Match canvas to container size.
  // render() is intentionally omitted here — mapper has no data yet.
  // Re-render is triggered by applyFrame() once data is loaded.
  const resizeGL = () => {
    glWindow.setSize(container.clientWidth, container.clientHeight);
    if (mapper && mapper.getInputData && mapper.getInputData()) {
      renderWindow.render();
    }
  };
  window.addEventListener('resize', resizeGL);
  resizeGL();

  // Actor / mapper — must exist before interactor.initialize() triggers render
  mapper = vtkMapper.newInstance({
    interpolateScalarsBeforeMapping: false,
  });
  mapper.setScalarModeToUseCellData();
  mapper.setScalarVisibility(true);

  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setAmbient(0.2);
  actor.getProperty().setDiffuse(0.8);
  actor.getProperty().setSpecular(0.1);

  renderer.addActor(actor);

  // Interactor — initialize() internally triggers a render; actor must exist
  const interactor = vtkRenderWindowInteractor.newInstance();
  interactor.setView(glWindow);
  interactor.initialize();
  interactor.bindEvents(container);

  const style = vtkInteractorStyleTrackballCamera.newInstance();
  interactor.setInteractorStyle(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply a decoded frame to the VTK pipeline
// ─────────────────────────────────────────────────────────────────────────────
function applyFrame(frameData, alpha, nextFrameData) {
  const { displacement: dispA, peeq: peeqA, alive: aliveA } = frameData;

  let displacement = dispA;
  let peeq         = peeqA;
  let alive        = aliveA;

  // Interpolate if blending between two frames
  if (nextFrameData && alpha > 0) {
    const dispB = nextFrameData.displacement;
    const peeqB = nextFrameData.peeq;

    const blendDisp = new Float32Array(dispA.length);
    const blendPeeq = new Float32Array(peeqA.length);
    lerpArrays(dispA, dispB, alpha, blendDisp);
    lerpArrays(peeqA, peeqB, alpha, blendPeeq);

    displacement = blendDisp;
    peeq         = blendPeeq;
    // Use alive from the closer frame
    alive        = alpha < 0.5 ? aliveA : nextFrameData.alive;
  }

  // ── Update point positions ──────────────────────────────────────────────
  const pts    = polydata.getPoints();
  const ptsArr = pts.getData();              // Float32Array, in-place

  const n = manifest.n_surf_points;
  for (let i = 0; i < n; i++) {
    const i3 = i * 3;
    ptsArr[i3]     = basePoints[i3]     + displacement[i3];
    ptsArr[i3 + 1] = basePoints[i3 + 1] + displacement[i3 + 1];
    ptsArr[i3 + 2] = basePoints[i3 + 2] + displacement[i3 + 2];
  }
  pts.modified();

  // ── Choose scalar data ──────────────────────────────────────────────────
  let cellScalars;
  let scalarRange;

  if (currentField === 'peeq') {
    cellScalars = new Float32Array(peeq.length);
    for (let i = 0; i < peeq.length; i++) {
      cellScalars[i] = alive[i] === 0 ? NaN : peeq[i];
    }
    scalarRange = [0, globalMaxPEEQ || 1e-9];
  } else {
    // Displacement magnitude: per-node → averaged onto cells
    const nodeMag  = computeDispMag(displacement);
    const cellMagFull = avgNodeToCell(nodeMag, polydata);
    cellScalars = new Float32Array(cellMagFull.length);
    for (let i = 0; i < cellMagFull.length; i++) {
      cellScalars[i] = alive[i] === 0 ? NaN : cellMagFull[i];
    }
    scalarRange = [0, globalMaxDispMag || 1e-9];
  }

  // ── Update cell data array ──────────────────────────────────────────────
  peeqCellArray.setData(cellScalars);
  peeqCellArray.modified();

  polydata.getCellData().modified();
  polydata.modified();

  // ── Update mapper color range ────────────────────────────────────────────
  mapper.setScalarRange(scalarRange[0], scalarRange[1]);

  renderWindow.render();
}

// ─────────────────────────────────────────────────────────────────────────────
// Update HUD elements
// ─────────────────────────────────────────────────────────────────────────────
function updateHUD(frameIdx, simTime) {
  const n = manifest.n_frames;
  timeInfo.textContent = `t=${formatTime(simTime)}  f=${frameIdx + 1}/${n}`;
  frameSlider.value    = frameIdx;

  if (energyChart) {
    energyChart.setCurrentTime(simTime);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation loop
// ─────────────────────────────────────────────────────────────────────────────
function animationStep(rafTime) {
  if (!isPlaying) return;

  if (lastRAFTime !== null) {
    const wallDt = (rafTime - lastRAFTime) / 1000;    // seconds (wall clock)
    const simDt  = wallDt * playSpeed;
    simElapsed  += simDt;
  }
  lastRAFTime = rafTime;

  const frames      = manifest.frames;
  const totalSimTime = frames[frames.length - 1].time;

  // Wrap around
  if (simElapsed > totalSimTime) simElapsed = 0;

  const { iA, iB, alpha } = resolveFrameTime(simElapsed);
  currentFrameIdx = iA;

  const dataA = frameCache.get(iA);
  const dataB = frameCache.get(iB);

  if (dataA) {
    applyFrame(dataA, alpha, dataB || null);
  }

  updateHUD(iA, simElapsed);

  requestAnimationFrame(animationStep);
}

// ─────────────────────────────────────────────────────────────────────────────
// Jump to a specific frame index (for slider / button interactions)
// ─────────────────────────────────────────────────────────────────────────────
function jumpToFrame(idx) {
  currentFrameIdx = Math.max(0, Math.min(manifest.n_frames - 1, idx));
  simElapsed      = manifest.frames[currentFrameIdx].time;

  const data = frameCache.get(currentFrameIdx);
  if (data) {
    applyFrame(data, 0, null);
    updateHUD(currentFrameIdx, simElapsed);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Colorbar rendering
// ─────────────────────────────────────────────────────────────────────────────
function refreshColorbar() {
  if (!ctf) return;

  let minVal = 0;
  let maxVal = currentField === 'peeq' ? globalMaxPEEQ : globalMaxDispMag;
  const label = currentField === 'peeq' ? 'PEEQ' : '|u| mm';

  colorbarMin.textContent   = minVal.toExponential(2);
  colorbarMax.textContent   = maxVal.toExponential(2);
  colorbarTitle.textContent = label;

  // Rebuild CTF for new range
  ctf = buildColorTransferFunction(vtkColorTransferFunction, minVal, maxVal || 1e-9);
  mapper.setLookupTable(ctf);

  drawColormapToCanvas(colorbarCanvas, ctf, minVal, maxVal || 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls wiring
// ─────────────────────────────────────────────────────────────────────────────
function setupControls() {
  btnPlay.addEventListener('click', () => {
    isPlaying = !isPlaying;
    btnPlay.textContent = isPlaying ? '⏸' : '▶';
    if (isPlaying) {
      lastRAFTime = null;
      requestAnimationFrame(animationStep);
    }
  });

  btnFirst.addEventListener('click', () => {
    isPlaying = false;
    btnPlay.textContent = '▶';
    jumpToFrame(0);
  });

  btnLast.addEventListener('click', () => {
    isPlaying = false;
    btnPlay.textContent = '▶';
    jumpToFrame(manifest.n_frames - 1);
  });

  frameSlider.max = manifest.n_frames - 1;
  frameSlider.addEventListener('input', () => {
    isPlaying = false;
    btnPlay.textContent = '▶';
    jumpToFrame(parseInt(frameSlider.value, 10));
  });

  speedSelect.addEventListener('change', () => {
    playSpeed = parseFloat(speedSelect.value);
  });

  fieldSelect.addEventListener('change', () => {
    currentField = fieldSelect.value;
    refreshColorbar();
    const data = frameCache.get(currentFrameIdx);
    if (data) {
      applyFrame(data, 0, null);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main init
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  try {
    // ── 1. Fetch manifest ──────────────────────────────────────────────────
    setProgress(0, 'Fetching manifest…');
    const mfResp = await fetch(`${SERVER_BASE}/manifest.json`);
    if (!mfResp.ok) throw new Error(`Cannot reach server at ${SERVER_BASE}. Is the server running?`);
    manifest = await mfResp.json();

    const nFrames = manifest.n_frames;
    setProgress(0.02, 'Manifest loaded.');

    // ── 2. Load geometry.vtp ───────────────────────────────────────────────
    setProgress(0.04, 'Loading geometry…');
    const vtpResp = await fetch(`${SERVER_BASE}/${manifest.geometry_file}`);
    if (!vtpResp.ok) throw new Error(`Failed to fetch geometry: ${vtpResp.status}`);
    const vtpBuffer = await vtpResp.arrayBuffer();
    setProgress(0.12, 'Parsing geometry…');

    const reader = vtkXMLPolyDataReader.newInstance();
    reader.parseAsArrayBuffer(vtpBuffer);
    polydata = reader.getOutputData(0);

    // Store pristine base positions
    basePoints = new Float32Array(polydata.getPoints().getData());

    setProgress(0.15, 'Setting up renderer…');

    // ── 3. Setup VTK pipeline ─────────────────────────────────────────────
    const container = document.getElementById('vtk-container');
    setupVTK(container);

    // Create a cell data array for scalars (initially zeros)
    const nCells    = manifest.n_surf_cells;
    peeqCellArray   = vtkDataArray.newInstance({
      name:           'Scalars',
      numberOfComponents: 1,
      values:         new Float32Array(nCells),
    });
    polydata.getCellData().setScalars(peeqCellArray);

    mapper.setInputData(polydata);

    // ── 4. Preload all frames ──────────────────────────────────────────────
    for (let i = 0; i < nFrames; i++) {
      const frameInfo = manifest.frames[i];
      setProgress(0.15 + (i / nFrames) * 0.80, `Loading frames ${i + 1}/${nFrames}…`);

      const url  = `${SERVER_BASE}/${frameInfo.file}`;
      const data = await loadFrame(url, manifest);
      frameCache.set(i, data);

      // Track global scalar max during loading
      for (let j = 0; j < data.peeq.length; j++) {
        if (data.peeq[j] > globalMaxPEEQ) globalMaxPEEQ = data.peeq[j];
      }
      const mag = computeDispMag(data.displacement);
      for (let j = 0; j < mag.length; j++) {
        if (mag[j] > globalMaxDispMag) globalMaxDispMag = mag[j];
      }
    }

    setProgress(0.97, 'Building colormap…');

    // ── 5. Build colormap + colorbar ──────────────────────────────────────
    ctf = buildColorTransferFunction(vtkColorTransferFunction, 0, globalMaxPEEQ || 1e-9);
    mapper.setLookupTable(ctf);
    mapper.setScalarRange(0, globalMaxPEEQ || 1e-9);

    refreshColorbar();

    // ── 6. Energy chart ────────────────────────────────────────────────────
    const energyData = manifest.energy || null;
    energyChart = new EnergyChart(energyCanvas, energyData);

    // ── 7. Setup controls ──────────────────────────────────────────────────
    setupControls();

    // ── 8. Show first frame ────────────────────────────────────────────────
    setProgress(1.0, 'Done.');
    jumpToFrame(0);
    renderer.resetCamera();
    renderWindow.render();

    hideLoadingScreen();

  } catch (err) {
    loadingMsg.textContent = `Error: ${err.message}`;
    progressInner.style.background = '#c62828';
    console.error(err);
  }
}

init();
