import { useEffect, useRef } from 'react';
import type { TrackedPoint } from '../../store/useStore';
import { getSimData } from '../../lib/simData';

interface Props {
  tp: TrackedPoint;
  curFrame: number;
}

export default function InlineStressChart({ tp, curFrame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    requestAnimationFrame(() => draw(canvas, tp, curFrame));
  }, [tp, curFrame]);

  return (
    <div className="inline-chart-wrap">
      <canvas ref={canvasRef} className="inline-chart-canvas" height={80} />
    </div>
  );
}

function draw(canvas: HTMLCanvasElement, tp: TrackedPoint, curFrame: number) {
  const data = getSimData();
  if (!data) return;

  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth || 280;
  const ch = 80;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const n = data.meta.n_frames;
  const pad = { t: 8, r: 8, b: 18, l: 8 };
  const pw = cw - pad.l - pad.r;
  const ph = ch - pad.t - pad.b;

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, cw, ch);

  const isVM = data.layerArr[tp.idx] === 0;
  const p95 = isVM ? data.meta.vm_p95 : data.meta.eps_p95;
  const vals: number[] = [];
  let maxV = 0;
  for (let fi = 0; fi < n; fi++) {
    const raw = data.valFrames[fi][tp.idx];
    const v = raw < 2 ? 0 : ((raw - 2) / 253) * p95;
    vals.push(v);
    if (v > maxV) maxV = v;
  }
  if (maxV === 0) maxV = 1;

  // Grid
  for (let gi = 0; gi <= 3; gi++) {
    const gy = pad.t + ph * (1 - gi / 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(pad.l + pw, gy); ctx.stroke();
  }

  // X ticks
  const tickStep = Math.max(1, Math.ceil(n / 6));
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = '8px -apple-system,sans-serif';
  ctx.textAlign = 'center';
  for (let fi = 0; fi < n; fi += tickStep) {
    const gx = pad.l + pw * fi / (n - 1);
    ctx.fillText(String(fi + 1), gx, ch - 4);
  }

  // Area fill
  ctx.beginPath();
  for (let fi = 0; fi < n; fi++) {
    const gx = pad.l + pw * fi / (n - 1);
    const gy = pad.t + ph * (1 - vals[fi] / maxV);
    fi === 0 ? ctx.moveTo(gx, gy) : ctx.lineTo(gx, gy);
  }
  ctx.lineTo(pad.l + pw, pad.t + ph);
  ctx.lineTo(pad.l, pad.t + ph);
  ctx.closePath();
  ctx.fillStyle = tp.color + '20';
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = tp.color;
  ctx.lineWidth = 1.5;
  for (let fi = 0; fi < n; fi++) {
    const gx = pad.l + pw * fi / (n - 1);
    const gy = pad.t + ph * (1 - vals[fi] / maxV);
    fi === 0 ? ctx.moveTo(gx, gy) : ctx.lineTo(gx, gy);
  }
  ctx.stroke();

  // Current frame vertical line
  const cfx = pad.l + pw * curFrame / (n - 1);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(cfx, pad.t); ctx.lineTo(cfx, pad.t + ph); ctx.stroke();
  ctx.setLineDash([]);

  // Current frame dot + value
  const cfy = pad.t + ph * (1 - vals[curFrame] / maxV);
  ctx.beginPath();
  ctx.arc(cfx, cfy, 3, 0, Math.PI * 2);
  ctx.fillStyle = tp.color;
  ctx.fill();

  const valStr = isVM ? vals[curFrame].toFixed(1) + 'MPa' : vals[curFrame].toFixed(4);
  const labelX = Math.min(Math.max(cfx, 30), cw - 30);
  const labelY = Math.max(pad.t + 10, cfy - 6);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '8px -apple-system,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(valStr, labelX, labelY);
}
