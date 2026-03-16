/**
 * main.js — Crash simulation viewer
 *
 * IMPORTANT: The Geometry profile import MUST be first.
 * VTK.js v28+ uses a profiles system — without this import the rendering
 * pipeline (render passes, mappers, etc.) is never registered and every
 * render() call throws "Cannot read properties of undefined (reading 'traverse')".
 */
import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkGenericRenderWindow         from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkInteractorStyleTrackballCamera
  from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
import vtkActor                       from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper                      from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkXMLPolyDataReader           from '@kitware/vtk.js/IO/XML/XMLPolyDataReader';
import vtkDataArray                   from '@kitware/vtk.js/Common/Core/DataArray';
import vtkColorTransferFunction       from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';

import { loadFrame }                  from './decoder.js';
import { buildColorTransferFunction, drawColormapToCanvas } from './colormap.js';
import { EnergyChart }                from './energyChart.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const SERVER_BASE = 'http://localhost:3001/data';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
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

// ─── State ────────────────────────────────────────────────────────────────────
let manifest        = null;
let polydata        = null;
let basePoints      = null;
let frameCache      = new Map();
let currentField    = 'peeq';

let globalMaxPEEQ    = 0;
let globalMaxDispMag = 0;

let ctf          = null;
let mapper       = null;
let renderer     = null;
let renderWindow = null;

let isPlaying       = false;
let currentFrameIdx = 0;
let playSpeed       = 1.0;
let lastRAFTime     = null;
let simElapsed      = 0;

let energyChart   = null;
let peeqCellArray = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setProgress(fraction, message) {
  progressInner.style.width = `${Math.round(fraction * 100)}%`;
  if (message !== undefined) loadingMsg.textContent = message;
}

function hideLoadingScreen() {
  loadingScreen.style.transition = 'opacity 0.4s';
  loadingScreen.style.opacity    = '0';
  setTimeout(() => { loadingScreen.style.display = 'none'; }, 420);
}

function lerpArrays(a, b, t, out) {
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
}

function resolveFrameTime(simTime) {
  const frames = manifest.frames;
  const n      = frames.length;
  if (simTime <= frames[0].time)     return { iA: 0,     iB: 0,     alpha: 0 };
  if (simTime >= frames[n-1].time)   return { iA: n - 1, iB: n - 1, alpha: 0 };
  for (let i = 0; i < n - 1; i++) {
    if (simTime >= frames[i].time && simTime <= frames[i+1].time) {
      const span = frames[i+1].time - frames[i].time;
      return { iA: i, iB: i + 1, alpha: span > 0 ? (simTime - frames[i].time) / span : 0 };
    }
  }
  return { iA: n - 1, iB: n - 1, alpha: 0 };
}

function computeDispMag(displacement) {
  const n   = displacement.length / 3;
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dx = displacement[i*3], dy = displacement[i*3+1], dz = displacement[i*3+2];
    mag[i] = Math.sqrt(dx*dx + dy*dy + dz*dz);
  }
  return mag;
}

function avgNodeToCell(nodeMag) {
  const nCells  = manifest.n_surf_cells;
  const cellMag = new Float32Array(nCells);
  const data    = polydata.getPolys().getData();
  let   offset  = 0;
  for (let c = 0; c < nCells; c++) {
    const nPts = data[offset++];
    let   sum  = 0;
    for (let p = 0; p < nPts; p++) sum += nodeMag[data[offset++]];
    cellMag[c] = sum / nPts;
  }
  return cellMag;
}

// ─── VTK setup ────────────────────────────────────────────────────────────────
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
  actor.getProperty().setAmbient(0.2);
  actor.getProperty().setDiffuse(0.8);
  actor.getProperty().setSpecular(0.1);

  renderer.addActor(actor);
}

// ─── Frame application ────────────────────────────────────────────────────────
function applyFrame(frameData, alpha, nextFrameData) {
  let { displacement, peeq, alive } = frameData;

  if (nextFrameData && alpha > 0) {
    const blendDisp = new Float32Array(displacement.length);
    const blendPeeq = new Float32Array(peeq.length);
    lerpArrays(displacement, nextFrameData.displacement, alpha, blendDisp);
    lerpArrays(peeq,         nextFrameData.peeq,         alpha, blendPeeq);
    displacement = blendDisp;
    peeq         = blendPeeq;
    alive        = alpha < 0.5 ? alive : nextFrameData.alive;
  }

  // Update positions
  const ptsArr = polydata.getPoints().getData();
  const n      = manifest.n_surf_points;
  for (let i = 0; i < n; i++) {
    ptsArr[i*3]   = basePoints[i*3]   + displacement[i*3];
    ptsArr[i*3+1] = basePoints[i*3+1] + displacement[i*3+1];
    ptsArr[i*3+2] = basePoints[i*3+2] + displacement[i*3+2];
  }
  polydata.getPoints().modified();

  // Build cell scalars
  let cellScalars, scalarRange;
  if (currentField === 'peeq') {
    cellScalars = new Float32Array(peeq.length);
    for (let i = 0; i < peeq.length; i++)
      cellScalars[i] = alive[i] === 0 ? NaN : peeq[i];
    scalarRange = [0, globalMaxPEEQ || 1e-9];
  } else {
    const cellMag = avgNodeToCell(computeDispMag(displacement));
    cellScalars   = new Float32Array(cellMag.length);
    for (let i = 0; i < cellMag.length; i++)
      cellScalars[i] = alive[i] === 0 ? NaN : cellMag[i];
    scalarRange = [0, globalMaxDispMag || 1e-9];
  }

  peeqCellArray.setData(cellScalars);
  peeqCellArray.modified();
  polydata.getCellData().modified();
  polydata.modified();

  mapper.setScalarRange(scalarRange[0], scalarRange[1]);
  renderWindow.render();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function updateHUD(frameIdx, simTime) {
  timeInfo.textContent = `t=${simTime.toFixed(4)}s  f=${frameIdx+1}/${manifest.n_frames}`;
  frameSlider.value    = frameIdx;
  if (energyChart) energyChart.setCurrentTime(simTime);
}

// ─── Animation loop ───────────────────────────────────────────────────────────
function animationStep(rafTime) {
  if (!isPlaying) return;
  if (lastRAFTime !== null) simElapsed += ((rafTime - lastRAFTime) / 1000) * playSpeed;
  lastRAFTime = rafTime;

  const totalTime = manifest.frames[manifest.frames.length - 1].time;
  if (simElapsed > totalTime) simElapsed = 0;

  const { iA, iB, alpha } = resolveFrameTime(simElapsed);
  currentFrameIdx = iA;
  const dataA = frameCache.get(iA);
  if (dataA) applyFrame(dataA, alpha, frameCache.get(iB) || null);
  updateHUD(iA, simElapsed);

  requestAnimationFrame(animationStep);
}

function jumpToFrame(idx) {
  currentFrameIdx = Math.max(0, Math.min(manifest.n_frames - 1, idx));
  simElapsed      = manifest.frames[currentFrameIdx].time;
  const data = frameCache.get(currentFrameIdx);
  if (data) { applyFrame(data, 0, null); updateHUD(currentFrameIdx, simElapsed); }
}

// ─── Colorbar ─────────────────────────────────────────────────────────────────
function refreshColorbar() {
  const maxVal = currentField === 'peeq' ? globalMaxPEEQ : globalMaxDispMag;
  const label  = currentField === 'peeq' ? 'PEEQ' : '|u| mm';
  colorbarMin.textContent   = (0).toExponential(2);
  colorbarMax.textContent   = maxVal.toExponential(2);
  colorbarTitle.textContent = label;
  ctf = buildColorTransferFunction(vtkColorTransferFunction, 0, maxVal || 1e-9);
  mapper.setLookupTable(ctf);
  drawColormapToCanvas(colorbarCanvas, ctf, 0, maxVal || 1e-9);
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function setupControls() {
  btnPlay.addEventListener('click', () => {
    isPlaying = !isPlaying;
    btnPlay.textContent = isPlaying ? '⏸' : '▶';
    if (isPlaying) { lastRAFTime = null; requestAnimationFrame(animationStep); }
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
    const data = frameCache.get(currentFrameIdx);
    if (data) applyFrame(data, 0, null);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    setProgress(0, 'Fetching manifest…');
    const mfResp = await fetch(`${SERVER_BASE}/manifest.json`);
    if (!mfResp.ok) throw new Error(`Server unreachable at ${SERVER_BASE}`);
    manifest = await mfResp.json();

    setProgress(0.04, 'Loading geometry…');
    const vtpResp = await fetch(`${SERVER_BASE}/${manifest.geometry_file}`);
    if (!vtpResp.ok) throw new Error(`Failed to fetch geometry: ${vtpResp.status}`);
    const vtpBuffer = await vtpResp.arrayBuffer();

    setProgress(0.12, 'Parsing geometry…');
    const reader = vtkXMLPolyDataReader.newInstance();
    reader.parseAsArrayBuffer(vtpBuffer);
    polydata   = reader.getOutputData(0);
    basePoints = new Float32Array(polydata.getPoints().getData());

    setProgress(0.15, 'Setting up renderer…');
    setupVTK(document.getElementById('vtk-container'));

    peeqCellArray = vtkDataArray.newInstance({
      name: 'Scalars', numberOfComponents: 1,
      values: new Float32Array(manifest.n_surf_cells),
    });
    polydata.getCellData().setScalars(peeqCellArray);
    mapper.setInputData(polydata);

    for (let i = 0; i < manifest.n_frames; i++) {
      setProgress(0.15 + (i / manifest.n_frames) * 0.80, `Loading frames ${i+1}/${manifest.n_frames}…`);
      const data = await loadFrame(`${SERVER_BASE}/${manifest.frames[i].file}`, manifest);
      frameCache.set(i, data);
      for (const v of data.peeq) if (v > globalMaxPEEQ) globalMaxPEEQ = v;
      const mag = computeDispMag(data.displacement);
      for (const v of mag) if (v > globalMaxDispMag) globalMaxDispMag = v;
    }

    setProgress(0.97, 'Building colormap…');
    refreshColorbar();

    energyChart = new EnergyChart(energyCanvas, manifest.energy || null);
    setupControls();

    setProgress(1.0, 'Done.');
    jumpToFrame(0);
    renderer.resetCamera();
    renderWindow.render();
    hideLoadingScreen();

  } catch (err) {
    loadingMsg.textContent         = `Error: ${err.message}`;
    progressInner.style.background = '#c62828';
    console.error(err);
  }
}

init();
