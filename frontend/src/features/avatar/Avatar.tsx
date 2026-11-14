import { cx } from "@/lib/utils";

export const HAIR_COLORS = {
  Blond: "#e9c875",
  Brązowe: "#67412c",
  Czarne: "#182127",
  Siwe: "#b8c3c6",
  Brak: "transparent",
} as const;

export type HairColor = keyof typeof HAIR_COLORS;

export const DEFAULT_HAIR_COLOR: HairColor = "Brązowe";

const BUBBLES = [
  { id: "b1", left: "72%", top: "11%", size: "62px", label: "O₂" },
  { id: "b2", left: "15%", top: "22%", size: "42px" },
  { id: "b3", left: "79%", top: "42%", size: "37px" },
  { id: "b4", left: "12%", top: "56%", size: "53px" },
  { id: "b5", left: "69%", top: "67%", size: "30px" },
  { id: "b6", left: "29%", top: "4%", size: "25px" },
] as const;

export function Avatar({
  hair = DEFAULT_HAIR_COLOR,
  breathing = false,
  aura = false,
}: {
  hair?: HairColor;
  breathing?: boolean;
  aura?: boolean;
}) {
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
        <div className="avatar-head">
          {hair !== "Brak" && (
            <div className="avatar-hair" style={{ background: HAIR_COLORS[hair] }} />
          )}
          <div className="avatar-ear left" />
          <div className="avatar-ear right" />
          <div className="avatar-face">
            <i />
            <i />
          </div>
        </div>
        <div className="avatar-neck" />
        <div className="avatar-body">
          <div className="avatar-top" />
          <div className="sensor sensor-one" />
          <div className="sensor sensor-two" />
        </div>
        <div className="avatar-arm left" />
        <div className="avatar-arm right" />
        <div className="avatar-legs">
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}
