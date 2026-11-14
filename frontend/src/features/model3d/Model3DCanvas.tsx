import { useEffect, useRef } from "react";

export type Model3DAnimationState = {
  breathingRate: number;
  oxygenation: number;
  coherence: number;
  phase: "inhale" | "exhale" | "rest";
};

export type Model3DRenderer = {
  mount: (canvas: HTMLCanvasElement) => void;
  update: (state: Model3DAnimationState) => void;
  dispose: () => void;
};

export function Model3DCanvas({
  renderer,
  state,
  label = "Animowany model 3D",
}: {
  renderer: Model3DRenderer;
  state: Model3DAnimationState;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    renderer.mount(canvas);
    return () => renderer.dispose();
  }, [renderer]);

  useEffect(() => {
    renderer.update(state);
  }, [renderer, state]);

  return <canvas ref={canvasRef} role="img" aria-label={label} />;
}
