/**
 * Diverging colour map for the brain map, v in [-1, 1]:
 * negative = blue -> cyan, positive = red -> yellow (|v| = 1 is the brightest).
 * Channels in linear RGB (three.js working space) and as CSS for the 2D map / legend.
 */
const NEG = [
  [0.02, 0.18, 0.75],
  [0.1, 0.75, 0.95],
];
const POS = [
  [0.8, 0.05, 0.05],
  [1.0, 0.8, 0.1],
];

export function divergingColor(v: number, out: { r: number; g: number; b: number }) {
  const t = Math.min(1, Math.abs(v));
  const [a, b] = v < 0 ? NEG : POS;
  const k = Math.max(0, t - 0.35) / 0.65; // first deepen, then brighten
  out.r = a[0] + (b[0] - a[0]) * k;
  out.g = a[1] + (b[1] - a[1]) * k;
  out.b = a[2] + (b[2] - a[2]) * k;
  return out;
}

const toSrgb = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));

/** Same map as an sRGB triple (0..255), for canvas / CSS. */
export function divergingRgb(v: number): [number, number, number] {
  const c = divergingColor(v, { r: 0, g: 0, b: 0 });
  return [toSrgb(c.r), toSrgb(c.g), toSrgb(c.b)];
}

/** CSS gradient for the legend bar, -1 .. +1. */
export const LEGEND_GRADIENT = `linear-gradient(90deg, ${[-1, -0.6, -0.3, 0, 0.3, 0.6, 1]
  .map((v) => (v === 0 ? "#f4e6e3" : `rgb(${divergingRgb(v).join(",")})`))
  .join(", ")})`;
