import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/utils";
import type { AvatarConfig } from "./avatarConfig";
import { armHeight, AvatarScene, type Gesture } from "./avatarScene";

const GESTURES: { id: Gesture; label: string }[] = [
  { id: "six_seven", label: "Do 67" },
  { id: "deep_breath", label: "Głęboki oddech" },
  { id: "namaste", label: "Namaste" },
  { id: "wave", label: "Pomachaj" },
];

const BUBBLES = [
  { id: "b1", left: "72%", top: "11%", size: "62px", label: "O₂" },
  { id: "b2", left: "15%", top: "22%", size: "42px" },
  { id: "b3", left: "79%", top: "42%", size: "37px" },
  { id: "b4", left: "12%", top: "56%", size: "53px" },
  { id: "b5", left: "69%", top: "67%", size: "30px" },
  { id: "b6", left: "29%", top: "4%", size: "25px" },
] as const;

function Avatar3D({
  avatar,
  interactive,
  introGesture,
  pace,
  deepBreathing,
  sceneRef,
}: {
  avatar: AvatarConfig;
  interactive: boolean;
  introGesture?: Gesture;
  pace: number | null;
  deepBreathing: boolean;
  sceneRef: React.RefObject<AvatarScene | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(avatar);
  latest.current = avatar;
  const latestPace = useRef(pace);
  latestPace.current = pace;
  const latestDeep = useRef(deepBreathing);
  latestDeep.current = deepBreathing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new AvatarScene(canvas);
    sceneRef.current = scene;
    if (interactive) scene.enableRotation();
    scene.setAppearance(latest.current);
    scene.setPace(latestPace.current);
    scene.setDeepBreathing(latestDeep.current);
    void scene.setModel(latest.current).then(() => {
      if (introGesture) void scene.playGesture(introGesture, () => {});
    });
    const observer = new ResizeObserver(() => scene.resize());
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [interactive, sceneRef]);

  useEffect(() => {
    void sceneRef.current?.setModel(avatar);
  }, [avatar.sex, avatar.texture, avatar.length]);

  useEffect(() => {
    sceneRef.current?.setDeepBreathing(deepBreathing);
  }, [deepBreathing, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setPace(pace);
  }, [pace, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setAppearance(avatar);
  }, [avatar.color, avatar.weight]);

  return (
    <canvas
      ref={canvasRef}
      className={cx(interactive && "is-draggable")}
      role="img"
      aria-label="Awatar 3D"
    />
  );
}

export function Avatar({
  avatar,
  breathing = false,
  aura = false,
  interactive = false,
  introGesture,
  pace = null,
  deepBreathing = false,
  overlay,
}: {
  avatar: AvatarConfig;
  breathing?: boolean;
  aura?: boolean;
  /** Drag to rotate in any direction and show the gesture buttons. */
  interactive?: boolean;
  /** Gesture played once, as soon as the model has loaded. */
  introGesture?: Gesture;
  /**
   * Breathing pacer position (0..1, as `target_phase` from the backend): 0-0.5 inhale with the
   * arms rising, 0.5-1 exhale with the arms lowering. Null leaves the avatar breathing idly.
   */
  pace?: number | null;
  /** Loops the deep-breath arm movement (any tempo) instead of following `pace`. */
  deepBreathing?: boolean;
  /** Drawn over the avatar (e.g. the rest countdown). */
  overlay?: ReactNode;
}) {
  const sceneRef = useRef<AvatarScene | null>(null);
  const [playing, setPlaying] = useState<Gesture | null>(null);
  const play = (gesture: Gesture) => {
    setPlaying(gesture);
    sceneRef.current?.playGesture(gesture, () => setPlaying(null));
  };

  return (
    <div className={cx("avatar-stage", breathing && "is-breathing", aura && "has-aura")}>
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      {BUBBLES.map((bubble) => (
        <div
          className={`oxygen-bubble ${bubble.id}`}
          style={{ left: bubble.left, top: bubble.top, width: bubble.size, height: bubble.size }}
          key={bubble.id}
        >
          {"label" in bubble && <span>{bubble.label}</span>}
        </div>
      ))}
      <div className="avatar-shadow" />
      <div className="pedestal">
        <div />
      </div>
      <div className="avatar">
        <Avatar3D
          avatar={avatar}
          interactive={interactive}
          introGesture={introGesture}
          pace={pace === null ? null : armHeight(pace)}
          deepBreathing={deepBreathing}
          sceneRef={sceneRef}
        />
      </div>
      {overlay && <div className="avatar-overlay">{overlay}</div>}
      {interactive && (
        <div className="avatar-gestures">
          <small>Przeciągnij, aby obrócić · dwuklik resetuje</small>
          <div>
            {GESTURES.map((gesture) => (
              <button
                type="button"
                className={cx(playing === gesture.id && "playing")}
                disabled={playing !== null}
                onClick={() => play(gesture.id)}
                key={gesture.id}
              >
                {gesture.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
