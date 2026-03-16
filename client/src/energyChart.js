/**
 * energyChart.js
 * Canvas-based KE / IE energy chart with a current-time marker.
 */

export class EnergyChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} energyData  { times: number[], ke: number[], ie: number[] }
   *                              If energyData is null / empty, shows a placeholder.
   */
  constructor(canvas, energyData) {
    this.canvas      = canvas;
    this.ctx         = canvas.getContext('2d');
    this.energyData  = energyData;
    this.currentTime = 0;

    // Layout padding inside the canvas
    this.pad = { top: 6, right: 8, bottom: 20, left: 38 };

    this.draw();
  }

  /** Update the vertical time marker and redraw. */
  setCurrentTime(t) {
    this.currentTime = t;
    this.draw();
  }

  /** Full redraw. */
  draw() {
    const canvas = this.canvas;
    const ctx    = this.ctx;
    const { pad } = this;
    const W = canvas.width;
    const H = canvas.height;

    // Clear
    ctx.clearRect(0, 0, W, H);

    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top  - pad.bottom;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, W, H);

    const data = this.energyData;
    if (!data || !data.times || data.times.length === 0) {
      this._drawPlaceholder(ctx, W, H);
      return;
    }

    const times = data.times;
    const ke    = data.ke    || [];
    const ie    = data.ie    || [];

    const tMin  = times[0];
    const tMax  = times[times.length - 1];
    const tRange = tMax - tMin || 1;

    // Compute value range (combined KE + IE)
    let vMax = 0;
    for (let i = 0; i < times.length; i++) {
      if (ke[i] !== undefined) vMax = Math.max(vMax, ke[i]);
      if (ie[i] !== undefined) vMax = Math.max(vMax, ie[i]);
    }
    if (vMax === 0) vMax = 1;

    // Helper: map data coords → canvas coords
    const cx = t   => pad.left + ((t - tMin) / tRange) * plotW;
    const cy = v   => pad.top  + (1 - v / vMax) * plotH;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth   = 1;
    for (let g = 0; g <= 4; g++) {
      const gy = pad.top + (g / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(pad.left + plotW, gy);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle  = '#78909c';
    ctx.font       = '9px system-ui, sans-serif';
    ctx.textAlign  = 'right';
    ctx.textBaseline = 'middle';

    const formatE = v => {
      if (v >= 1e6)  return (v / 1e6).toFixed(0)  + 'M';
      if (v >= 1e3)  return (v / 1e3).toFixed(0)  + 'k';
      return v.toFixed(1);
    };

    ctx.fillText(formatE(vMax), pad.left - 3, pad.top);
    ctx.fillText(formatE(vMax * 0.5), pad.left - 3, pad.top + plotH * 0.5);
    ctx.fillText('0', pad.left - 3, pad.top + plotH);

    // X-axis labels
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(tMin.toFixed(2) + 's', pad.left, pad.top + plotH + 3);
    ctx.fillText(tMax.toFixed(2) + 's', pad.left + plotW, pad.top + plotH + 3);

    // Draw series helper
    const drawSeries = (values, color) => {
      if (!values || values.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.lineJoin    = 'round';
      let first = true;
      for (let i = 0; i < times.length; i++) {
        const x = cx(times[i]);
        const y = cy(values[i] ?? 0);
        if (first) { ctx.moveTo(x, y); first = false; }
        else        ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawSeries(ke, '#4fc3f7');   // KE – blue
    drawSeries(ie, '#ef5350');   // IE – red

    // Current time marker
    const markerX = cx(Math.max(tMin, Math.min(tMax, this.currentTime)));
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(markerX, pad.top);
    ctx.lineTo(markerX, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawPlaceholder(ctx, W, H) {
    ctx.fillStyle   = '#546e7a';
    ctx.font        = '11px system-ui, sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No energy data', W / 2, H / 2);
    ctx.font        = '10px system-ui, sans-serif';
    ctx.fillStyle   = '#37474f';
    ctx.fillText('Run patch_manifest.py to add energy', W / 2, H / 2 + 16);
  }
}
