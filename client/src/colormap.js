/**
 * colormap.js
 * Builds a blue→cyan→green→yellow→red VTK color transfer function for PEEQ.
 */

/**
 * Configure a vtkColorTransferFunction with a cool-to-warm PEEQ colormap.
 *
 * @param {object} vtkColorTransferFunction - VTK.js CTF class (not instance)
 * @param {number} minVal
 * @param {number} maxVal
 * @returns {object} Configured CTF instance
 */
export function buildColorTransferFunction(vtkColorTransferFunction, minVal, maxVal) {
  const ctf = vtkColorTransferFunction.newInstance();

  const range = maxVal - minVal || 1.0;

  // Control points: [value, r, g, b]  (RGB in [0..1])
  const stops = [
    [0.00, 0.000, 0.000, 0.800],   // deep blue
    [0.25, 0.000, 0.700, 1.000],   // cyan
    [0.50, 0.000, 0.800, 0.100],   // green
    [0.75, 1.000, 0.900, 0.000],   // yellow
    [1.00, 1.000, 0.050, 0.000],   // red
  ];

  ctf.removeAllPoints();
  for (const [t, r, g, b] of stops) {
    ctf.addRGBPoint(minVal + t * range, r, g, b);
  }

  return ctf;
}

/**
 * Draw the PEEQ colormap into a canvas element (vertical gradient, top=max).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} ctf - VTK CTF instance with .getColor()
 * @param {number} minVal
 * @param {number} maxVal
 */
export function drawColormapToCanvas(canvas, ctf, minVal, maxVal) {
  const ctx    = canvas.getContext('2d');
  const height = canvas.height;
  const width  = canvas.width;

  const rgb = [0, 0, 0];
  for (let py = 0; py < height; py++) {
    // py=0 → top → maxVal, py=height-1 → bottom → minVal
    const t   = 1.0 - py / (height - 1);
    const val = minVal + t * (maxVal - minVal);
    ctf.getColor(val, rgb);
    ctx.fillStyle = `rgb(${Math.round(rgb[0]*255)},${Math.round(rgb[1]*255)},${Math.round(rgb[2]*255)})`;
    ctx.fillRect(0, py, width, 1);
  }
}
