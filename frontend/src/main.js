import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';
import vtkActor                  from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper                 from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkXMLPolyDataReader      from '@kitware/vtk.js/IO/XML/XMLPolyDataReader';
import vtkColorTransferFunction  from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';

const API      = 'http://localhost:3001';
const VM_MAX   = 228.0;
const N_POINTS = 1041695;

// ── vtk setup ──
const container  = document.getElementById('vtk-container');
const fullScreen = vtkFullScreenRenderWindow.newInstance({
  rootContainer: container,
  background: [0.96, 0.96, 0.96],
});
const renderer     = fullScreen.getRenderer();
const renderWindow = fullScreen.getRenderWindow();
renderer.setBackground(0.96, 0.96, 0.96);

const interactor = fullScreen.getInteractor();
interactor.setInteractorStyle(vtkInteractorStyleTrackballCamera.newInstance());

// colormap: 深蓝灰 → 蓝 → 青 → 绿 → 橙 → 红
const ctf = vtkColorTransferFunction.newInstance();
ctf.addRGBPoint(0,          0.25, 0.28, 0.45);
ctf.addRGBPoint(VM_MAX*0.1, 0.10, 0.40, 0.90);
ctf.addRGBPoint(VM_MAX*0.3, 0.00, 0.85, 0.85);
ctf.addRGBPoint(VM_MAX*0.5, 0.10, 0.90, 0.10);
ctf.addRGBPoint(VM_MAX*0.75,1.00, 0.75, 0.00);
ctf.addRGBPoint(VM_MAX,     1.00, 0.00, 0.00);

const mapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: true });
mapper.setLookupTable(ctf);
mapper.setScalarRange(0, VM_MAX);
mapper.setScalarVisibility(true);

const actor = vtkActor.newInstance();
actor.setMapper(mapper);
renderer.addActor(actor);

// ── state ──
let metadata     = null;
let frameCache   = {};
let currentFrame = 0;
let isPlaying    = false;
let looping      = true;
let playTimer    = null;

// expose for debugging
window._mapper      = mapper;
window._renderer    = renderer;
window._renderWindow= renderWindow;
window._frameCache  = frameCache;

// ── UI refs ──
const loadingEl = document.getElementById('loading');
const ldetail   = document.getElementById('ldetail');
const hFrame    = document.getElementById('h-frame');
const hTime     = document.getElementById('h-time');
const hVmmax    = document.getElementById('h-vmmax');
const lFrames   = document.getElementById('l-frames');
const lFmax     = document.getElementById('l-fmax');
const timeBadge = document.getElementById('time-badge');
const tlFill    = document.getElementById('tl-fill');
const tlThumb   = document.getElementById('tl-thumb');
const tlRange   = document.getElementById('tl-range');
const btnPlay   = document.getElementById('btn-play');
const btnLoop   = document.getElementById('btn-loop');

// ── load binary frame ──
async function loadFrame(i) {
  if (frameCache[i]) return frameCache[i];
  const url = `${API}/bin_v2/frame_${String(i).padStart(4,'0')}.bin`;
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const all    = new Float32Array(buf);
  const points = all.slice(0, N_POINTS * 3);
  const vm     = all.slice(N_POINTS * 3);
  frameCache[i] = { points, vm };
  return frameCache[i];
}

// ── show frame ──
async function showFrame(i) {
  const { points, vm } = await loadFrame(i);

  const pd = mapper.getInputData();
  pd.getPoints().setData(points);
  pd.getPoints().modified();
  pd.getPointData().getArrayByName('von_mises').setData(vm);
  pd.modified();
  mapper.modified();
  renderWindow.render();

  const frame = metadata.frames[i];
  const pct   = (i / (metadata.n_frames - 1)) * 100;
  hFrame.textContent    = `${i+1} / ${metadata.n_frames}`;
  hTime.textContent     = `${frame.time.toFixed(4)} s`;
  hVmmax.textContent    = `${frame.vm_max.toFixed(1)} MPa`;
  lFmax.textContent     = `${frame.vm_max.toFixed(1)} MPa`;
  timeBadge.textContent = `T = ${frame.time.toFixed(4)} s`;
  tlFill.style.width    = pct + '%';
  tlThumb.style.left    = pct + '%';
  tlRange.value         = i;
  drawChart(i);

  for (let k=1; k<=5; k++) {
    if (i+k < metadata.n_frames) loadFrame(i+k).catch(()=>{});
  }
}

// ── timeline marks ──
function buildMarks() {
  const el = document.getElementById('tl-marks');
  el.innerHTML = '';
  for (let k=0; k<=6; k++) {
    const idx = Math.round((k/6)*(metadata.n_frames-1));
    const d   = document.createElement('div');
    d.className   = 'tl-mark';
    d.textContent = metadata.frames[idx].time.toFixed(3) + 's';
    el.appendChild(d);
  }
}

tlRange.addEventListener('input', () => {
  currentFrame = parseInt(tlRange.value);
  showFrame(currentFrame);
});

// ── playback ──
function togglePlay() {
  isPlaying = !isPlaying;
  btnPlay.textContent = isPlaying ? '⏸' : '▶';
  btnPlay.classList.toggle('on', isPlaying);
  if (isPlaying) scheduleNext();
  else clearTimeout(playTimer);
}

function scheduleNext() {
  if (!isPlaying) return;
  const spd   = parseFloat(document.getElementById('spd').value);
  const delay = Math.round(100 / spd);
  playTimer = setTimeout(async () => {
    currentFrame++;
    if (currentFrame >= metadata.n_frames) {
      currentFrame = looping ? 0 : metadata.n_frames - 1;
      if (!looping) { togglePlay(); return; }
    }
    await showFrame(currentFrame);
    scheduleNext();
  }, delay);
}

btnPlay.addEventListener('click', togglePlay);
document.getElementById('btn-rew').addEventListener('click', () => {
  currentFrame = Math.max(0, currentFrame-1); showFrame(currentFrame);
});
document.getElementById('btn-fwd').addEventListener('click', () => {
  currentFrame = Math.min(metadata.n_frames-1, currentFrame+1); showFrame(currentFrame);
});
btnLoop.addEventListener('click', () => {
  looping = !looping; btnLoop.classList.toggle('on', looping);
});

// ── chart ──
function buildChart() {
  const canvas = document.getElementById('chart-vm');
  const p = canvas.parentElement;
  canvas.width  = p.clientWidth - 24;
  canvas.height = Math.max(80, p.clientHeight - 36);
  drawChart(currentFrame);
}

function drawChart(activeIdx) {
  const canvas = document.getElementById('chart-vm');
  if (!canvas || !metadata) return;
  const ctx  = canvas.getContext('2d');
  const W    = canvas.width, H = canvas.height;
  const vms  = metadata.frames.map(f => f.vm_max);
  const maxV = metadata.vm_global_max;

  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = '#070b10'; ctx.fillRect(0,0,W,H);

  // yield line
  const yY = H - (350/maxV)*(H-16) - 4;
  ctx.save();
  ctx.strokeStyle = 'rgba(232,240,74,0.25)'; ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(0,yY); ctx.lineTo(W,yY); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(232,240,74,0.45)';
  ctx.font = '8px DM Mono,monospace';
  ctx.fillText('yield ~350 MPa', 3, yY-3);

  // area
  ctx.beginPath();
  vms.forEach((v,i) => {
    const x=(i/(vms.length-1))*W, y=H-(v/maxV)*(H-16)-4;
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
  ctx.fillStyle = 'rgba(255,60,31,0.08)'; ctx.fill();

  // curve
  ctx.beginPath(); ctx.strokeStyle='#ff3c1f'; ctx.lineWidth=1.5;
  vms.forEach((v,i) => {
    const x=(i/(vms.length-1))*W, y=H-(v/maxV)*(H-16)-4;
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  });
  ctx.stroke();

  // playhead
  const px = (activeIdx/(vms.length-1))*W;
  ctx.strokeStyle='rgba(232,240,74,0.7)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(px,0); ctx.lineTo(px,H); ctx.stroke();
  const py = H-(vms[activeIdx]/maxV)*(H-16)-4;
  ctx.beginPath(); ctx.arc(px,py,3,0,Math.PI*2);
  ctx.fillStyle='#e8f04a'; ctx.fill();
}

// ── main ──
async function main() {
  ldetail.textContent = 'fetching metadata...';
  try {
    const res = await fetch(`${API}/api/metadata`);
    metadata  = await res.json();
    buildMarks();
    lFrames.textContent = `${metadata.n_frames} / ${metadata.n_frames}`;
  } catch(e) {
    ldetail.textContent = 'ERROR: run: cd server && node server.js';
    return;
  }

  // 用第0帧 vtp 初始化网格结构
  ldetail.textContent = 'loading geometry...';
  const initReader = vtkXMLPolyDataReader.newInstance();
  await initReader.setUrl(`${API}/data_v2/frame_0000.vtp`);
  await initReader.loadData();
  const initPd = initReader.getOutputData(0);
  initPd.getPointData().setActiveScalars('von_mises');
  mapper.setScalarModeToUsePointFieldData();
  mapper.setColorByArrayName('von_mises');
  mapper.setInputData(initPd);

  // 设置相机对准碰撞区域
  const camera = renderer.getActiveCamera();
  camera.setPosition(3917, 555 - 40000, 25000);
  camera.setFocalPoint(3917, 555, 822);
  camera.setViewUp(0, 0, 1);
  renderer.resetCameraClippingRange();
  renderWindow.render();

  // 加载第0帧二进制数据
  ldetail.textContent = 'loading frame 0...';
  await loadFrame(0);

  // 更新 UI
  hFrame.textContent = `1 / ${metadata.n_frames}`;
  hTime.textContent  = `${metadata.frames[0].time.toFixed(4)} s`;
  hVmmax.textContent = `${metadata.frames[0].vm_max.toFixed(1)} MPa`;

  // 隐藏 loading
  loadingEl.classList.add('hidden');
  setTimeout(() => { loadingEl.style.display='none'; }, 500);
  setTimeout(buildChart, 200);
  window.addEventListener('resize', buildChart);

  // 后台预加载所有帧
  (async () => {
    for (let k=1; k<metadata.n_frames; k++) {
      await loadFrame(k);
    }
    console.log('所有帧预加载完成');
  })();
}

main().catch(e => {
  ldetail.textContent = 'ERROR: ' + e.message;
  console.error(e);
});
