/** Sequential colour ramps for the scalar fields.
 *
 *  `cividisRGB` is the deliverable default. A rainbow ramp is not acceptable
 *  in a published engineering figure: its lightness is not monotonic, so it
 *  invents banding where the data is smooth and hides real gradients in the
 *  green plateau, and its red/green extremes are indistinguishable to the
 *  ~8% of men with deuteranomaly. Cividis was built to survive both — the
 *  lightness rises monotonically from dark blue to yellow, which also means it
 *  still reads correctly photocopied in greyscale.
 *
 *  Implemented as piecewise-linear interpolation over 11 stops sampled from
 *  the published cividis table. That is an approximation of the full 256-entry
 *  LUT, accurate to about one 8-bit step — well inside what matters here,
 *  and it preserves the two properties above exactly.
 */
const CIVIDIS_STOPS: [number, number, number][] = [
  [0.000, 0.126, 0.298],
  [0.000, 0.165, 0.400],
  [0.145, 0.243, 0.412],
  [0.247, 0.306, 0.424],
  [0.329, 0.369, 0.435],
  [0.412, 0.431, 0.455],
  [0.494, 0.494, 0.471],
  [0.588, 0.569, 0.471],
  [0.690, 0.647, 0.447],
  [0.800, 0.733, 0.404],
  [1.000, 0.918, 0.275],
];

export function cividisRGB(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const n = CIVIDIS_STOPS.length - 1;
  const x = t * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const a = CIVIDIS_STOPS[i], b = CIVIDIS_STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f];
}

/** CSS gradient for a legend swatch, sampled off the same ramp so the key and
 *  the render can never drift apart. */
export function cividisCss(steps = 12): string {
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const [r, g, b] = cividisRGB(i / (steps - 1));
    out.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) `
      + `${((i / (steps - 1)) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${out.join(', ')})`;
}

/** The vivid blue-cyan-green-yellow-red ramp. Highest contrast of the two and
 *  the better-looking render, which is why it is the default on screen. Do not
 *  use it for a figure in the written report: its lightness is not monotonic,
 *  so it invents banding in smooth data, and its red and green extremes are
 *  indistinguishable to a red-green colour-blind reader. Switch the ramp
 *  control to Cividis for anything that gets published or printed. */
export function rainbowRGB(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  let r: number, g: number, b: number;
  if (t < 0.25) { const s = t / 0.25; r = 0; g = s; b = 1; }
  else if (t < 0.5) { const s = (t - 0.25) / 0.25; r = 0; g = 1; b = 1 - s; }
  else if (t < 0.75) { const s = (t - 0.5) / 0.25; r = s; g = 1; b = 0; }
  else { const s = (t - 0.75) / 0.25; r = 1; g = 1 - s; b = 0; }
  return [r, g, b];
}


export type RampName = 'spectrum' | 'cividis';

export const RAMPS: { name: RampName; label: string; note: string }[] = [
  { name: 'spectrum', label: 'Spectrum',
    note: 'Highest contrast on screen. Not suitable for a printed figure.' },
  { name: 'cividis', label: 'Cividis',
    note: 'Colour-blind safe and greyscale-safe. Use for the report.' },
];

export function rampFn(name: RampName): (t: number) => [number, number, number] {
  return name === 'cividis' ? cividisRGB : rainbowRGB;
}

/** CSS gradient for the key, sampled off the same function the render uses so
 *  the two can never drift apart. */
export function rampCss(name: RampName, steps = 16): string {
  const f = rampFn(name);
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const [r, g, b] = f(t);
    out.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) `
      + `${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${out.join(', ')})`;
}


/* ── Error magnitude ────────────────────────────────────────────────────────
 *
 * A deliberately different ramp from the physical-field one, because the two
 * are different quantities in different units on different scales and must
 * never invite a side-by-side colour comparison. Observed in practice: with
 * one shared rainbow, a red barrier (material at failure strain) next to a
 * blue vehicle (prediction accurate) reads as "the truth is severe and the
 * prediction is mild", which is not what either panel says.
 *
 * Single-hue on purpose too. Error has no meaningful intermediate categories,
 * only more or less of one thing, and a sequential single hue says that — as
 * a side effect it is colour-blind safe and survives greyscale printing.
 * Starts at the body's own grey so "no error" recedes into the surface, and
 * only a real defect glows.
 */
const ERROR_STOPS: [number, number, number][] = [
  [0.17, 0.19, 0.23],
  [0.42, 0.22, 0.12],
  [0.68, 0.33, 0.09],
  [0.89, 0.50, 0.10],
  [1.00, 0.76, 0.28],
];

export function errorRGB(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const n = ERROR_STOPS.length - 1;
  const x = t * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const a = ERROR_STOPS[i], b = ERROR_STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f];
}

/** Which ramp a quantity gets. The physical field follows the user's choice;
 *  error is always the single-hue scale, so the distinction survives whatever
 *  the ramp control is set to. */
export function rampForField(field: string, chosen: RampName) {
  return field === 'position_error' ? errorRGB : rampFn(chosen);
}

export function rampCssForField(field: string, chosen: RampName, steps = 16): string {
  const f = rampForField(field, chosen);
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const [r, g, b] = f(t);
    out.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) `
      + `${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${out.join(', ')})`;
}
