export function rainbowRGB(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  let r: number, g: number, b: number;
  if (t < 0.25) { const s = t / 0.25; r = 0; g = s; b = 1; }
  else if (t < 0.5) { const s = (t - 0.25) / 0.25; r = 0; g = 1; b = 1 - s; }
  else if (t < 0.75) { const s = (t - 0.5) / 0.25; r = s; g = 1; b = 0; }
  else { const s = (t - 0.75) / 0.25; r = 1; g = 1 - s; b = 0; }
  return [r, g, b];
}
