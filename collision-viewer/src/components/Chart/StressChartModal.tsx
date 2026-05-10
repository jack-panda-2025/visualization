import { useEffect, useRef } from 'react';
import type { TrackedPoint } from '../../store/useStore';
import { getSimData } from '../../lib/simData';

interface Props {
  target: TrackedPoint;
  curFrame: number;
  onClose: () => void;
}

export default function StressChartModal({ target, curFrame, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Double rAF ensures layout is computed before reading clientWidth
    requestAnimationFrame(() =>
      requestAnimationFrame(() => drawCurve(canvas, target, curFrame))
    );
  }, [target, curFrame]);

  return (
    <div className="chart-modal-backdrop" onClick={onClose}>
      <div className="chart-box" onClick={e => e.stopPropagation()}>
        <div className="chart-title-bar">
          <span className="chart-title-text">应力/应变曲线 — {target.label}</span>
          <span className="chart-close" onClick={onClose}>✕</span>
        </div>
        <canvas ref={canvasRef} className="chart-canvas" height={240} />
      </div>
    </div>
  );
}

function drawCurve(canvas: HTMLCanvasElement, tp: TrackedPoint, curFrame: number) {
  const data = getSimData();
  if (!data) return;

  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth || canvas.parentElement?.clientWidth || 556;
  const ch = parseInt(canvas.getAttribute('height') ?? '240');
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const w = cw, h = ch;

  const layer = data.layerArr[tp.idx];
  const isVM = layer === 0;
  const n = data.meta.n_frames;

  const vals: number[] = [];
  let maxV = 0;
  for (let fi = 0; fi < n; fi++) {
    const raw = data.valFrames[fi][tp.idx];
    const v = raw < 2 ? 0 : (isVM
      ? ((raw - 2) / 253) * data.meta.vm_p95
      : ((raw - 2) / 253) * data.meta.eps_p95);
    vals.push(v);
    if (v > maxV) maxV = v;
  }
  if (maxV === 0) maxV = 1;

  const pad = { t: 18, r: 20, b: 32, l: 58 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;

  ctx.fillStyle = '#080814';
  ctx.fillRect(0, 0, w, h);

  // Grid + Y labels
  for (let gi = 0; gi <= 5; gi++) {
    const gy = pad.t + ph * (1 - gi / 5);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(pad.l + pw, gy); ctx.stroke();
    const gv = maxV * gi / 5;
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '9px -apple-system,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(isVM ? gv.toFixed(0) : gv.toFixed(4), pad.l - 5, gy + 3);
  }

  // X ticks
  const tickStep = Math.max(1, Math.ceil(n / 8));
  for (let fi = 0; fi < n; fi += tickStep) {
    const gx = pad.l + pw * fi / Math.max(1, n - 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(gx, pad.t); ctx.lineTo(gx, pad.t + ph); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '9px -apple-system,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(fi + 1), gx, h - pad.b + 13);
  }

  // Axis labels
  ctx.save();
  ctx.translate(11, pad.t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '9px -apple-system,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(isVM ? 'Von Mises (MPa)' : 'PEEQ', 0, 0);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '9px -apple-system,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('帧', pad.l + pw / 2, h - 2);

  // Area fill
  ctx.beginPath();
  for (let fi = 0; fi < n; fi++) {
    const gx = pad.l + pw * fi / Math.max(1, n - 1);
    const gy = pad.t + ph * (1 - vals[fi] / maxV);
    fi === 0 ? ctx.moveTo(gx, gy) : ctx.lineTo(gx, gy);
  }
  ctx.lineTo(pad.l + pw * (n - 1) / Math.max(1, n - 1), pad.t + ph);
  ctx.lineTo(pad.l, pad.t + ph);
  ctx.closePath();
  ctx.fillStyle = 'rgba(55,138,221,0.12)'; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = tp.color; ctx.lineWidth = 1.8;
  for (let fi = 0; fi < n; fi++) {
    const gx = pad.l + pw * fi / Math.max(1, n - 1);
    const gy = pad.t + ph * (1 - vals[fi] / maxV);
    fi === 0 ? ctx.moveTo(gx, gy) : ctx.lineTo(gx, gy);
  }
  ctx.stroke();

  // Current frame marker
  const cfx = pad.l + pw * curFrame / Math.max(1, n - 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(cfx, pad.t); ctx.lineTo(cfx, pad.t + ph); ctx.stroke();
  ctx.setLineDash([]);
  const cfy = pad.t + ph * (1 - vals[curFrame] / maxV);
  ctx.beginPath(); ctx.arc(cfx, cfy, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff'; ctx.fill();

  // Current value label
  const labelY = Math.max(pad.t + 14, cfy - 9);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '9px -apple-system,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(
    `帧${curFrame + 1}: ${isVM ? vals[curFrame].toFixed(2) + 'MPa' : vals[curFrame].toFixed(5)}`,
    cfx, labelY,
  );
}
