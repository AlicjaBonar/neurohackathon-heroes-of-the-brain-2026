import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import type { Probe } from "@/api/types";
import { divergingRgb } from "./colormap";
import type { HoverInfo } from "./brainScene";

const GRID = 150;
const SIGMA = 0.12; // in head radii
const SPAN = 1.15; // grid covers [-SPAN, SPAN]

/** Top view of the head (nose up) with an interpolated channel map, optodes and 10-10 labels. */
export function TopoMap({
  probe,
  values,
  scale,
  onHover,
}: {
  probe: Probe;
  values: (number | null)[];
  scale: number;
  onHover: (h: HoverInfo) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const field = useRef<HTMLCanvasElement | null>(null);
  const long = useMemo(() => probe.pairs.filter((p) => !p.short), [probe]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const size = canvas.clientWidth || 300;
    canvas.width = canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const R = size * 0.4;
    const cx = size / 2;
    const cy = size * 0.52;
    const P = (x: number, y: number) => [cx + x * R, cy - y * R] as const;

    // Interpolated field on a small grid, upscaled with smoothing.
    const f = (field.current ??= document.createElement("canvas"));
    f.width = f.height = GRID;
    const fctx = f.getContext("2d")!;
    const img = fctx.createImageData(GRID, GRID);
    const pts = long
      .map((p) => ({ x: p.x, y: p.y, v: values[p.index] }))
      .filter((p): p is { x: number; y: number; v: number } => p.v !== null && p.v !== undefined);
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const x = -SPAN + (2 * SPAN * i) / (GRID - 1);
        const y = SPAN - (2 * SPAN * j) / (GRID - 1);
        if (x * x + y * y > 1) continue;
        let sw = 0, swx = 0;
        for (const p of pts) {
          const w = Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) / (2 * SIGMA * SIGMA));
          sw += w;
          swx += w * p.v;
        }
        if (sw < 1e-3) continue;
        const v = swx / sw / (scale || 1);
        const [r, g, b] = divergingRgb(v);
        const a = (1 - Math.exp(-sw * 2.5)) * Math.min(1, Math.abs(v) * 1.4 + 0.12);
        const o = (j * GRID + i) * 4;
        img.data.set([r, g, b, Math.round(a * 235)], o);
      }
    }
    fctx.putImageData(img, 0, 0);

    // Head
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#5b8c94";
    ctx.fillStyle = "#f7fbfb";
    ctx.beginPath();
    ctx.moveTo(...P(-0.12, 0.99));
    ctx.lineTo(...P(0, 1.12));
    ctx.lineTo(...P(0.12, 0.99));
    ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * R * 1.03, cy, R * 0.07, R * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    const [fx, fy] = P(-SPAN, SPAN);
    ctx.drawImage(f, fx, fy, 2 * SPAN * R, 2 * SPAN * R);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 10-10 labels
    ctx.font = "600 9px 'Plus Jakarta Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(15, 76, 92, 0.45)";
    for (const l of probe.landmarks) {
      if (l.x * l.x + l.y * l.y > 1.02 || l.label === "Nz") continue;
      const [x, y] = P(l.x, l.y);
      ctx.fillText(l.label, x, y - 9);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }

    // Channels and optodes
    const src = new Map(probe.sources.map((s) => [s.id, s]));
    const det = new Map(probe.detectors.map((d) => [d.id, d]));
    ctx.strokeStyle = "rgba(15, 118, 110, 0.35)";
    ctx.lineWidth = 1;
    for (const p of long) {
      const a = src.get(p.source), b = det.get(p.detector);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(...P(a.x, a.y));
      ctx.lineTo(...P(b.x, b.y));
      ctx.stroke();
    }
    const optode = (x: number, y: number, color: string) => {
      ctx.beginPath();
      ctx.arc(...P(x, y), 3.2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };
    probe.sources.forEach((s) => optode(s.x, s.y, "#ef4444"));
    probe.detectors.forEach((d) => optode(d.x, d.y, "#2563eb"));
    for (const p of long) {
      if (values[p.index] === null || values[p.index] === undefined) {
        const [x, y] = P(p.x, p.y);
        ctx.strokeStyle = "#94a3b8";
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 3);
        ctx.lineTo(x + 3, y + 3);
        ctx.moveTo(x + 3, y - 3);
        ctx.lineTo(x - 3, y + 3);
        ctx.stroke();
      }
    }
  }, [probe, values, scale, long]);

  const handleMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const r = canvas.getBoundingClientRect();
    const size = r.width;
    const R = size * 0.4;
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    let best: { index: number; d: number } | null = null;
    for (const p of long) {
      const d = Math.hypot(size / 2 + p.x * R - mx, size * 0.52 - p.y * R - my);
      if (d < 14 && (!best || d < best.d)) best = { index: p.index, d };
    }
    onHover(best ? { index: best.index, x: mx, y: my } : null);
  };

  return (
    <canvas
      ref={ref}
      className="topo-canvas"
      role="img"
      aria-label="Top view of the head with the channel map"
      onPointerMove={handleMove}
      onPointerLeave={() => onHover(null)}
    />
  );
}
