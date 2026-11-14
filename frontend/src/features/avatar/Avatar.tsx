import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/utils";
import type { AvatarConfig } from "./avatarConfig";
import { AvatarScene, type Gesture } from "./avatarScene";

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
  sceneRef,
}: {
  avatar: AvatarConfig;
  interactive: boolean;
  introGesture?: Gesture;
  sceneRef: React.RefObject<AvatarScene | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(avatar);
  latest.current = avatar;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new AvatarScene(canvas);
    sceneRef.current = scene;
    if (interactive) scene.enableRotation();
    scene.setAppearance(latest.current);
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
}: {
  avatar: AvatarConfig;
  breathing?: boolean;
  aura?: boolean;
  /** Drag to rotate in any direction and show the gesture buttons. */
  interactive?: boolean;
  /** Gesture played once, as soon as the model has loaded. */
  introGesture?: Gesture;
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
          sceneRef={sceneRef}
        />
      </div>
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
