import { cx } from "@/lib/utils";
import { HAIR_COLORS, type HairColor } from "./Avatar";

const HAIR_COLOR_OPTIONS = Object.keys(HAIR_COLORS) as HairColor[];

/** Swatch fill: the "no hair" option is drawn as a crossed-out circle. */
function swatchBackground(color: HairColor): string {
  return color === "Brak"
    ? "linear-gradient(135deg, transparent 45%, #f43f5e 46%, #f43f5e 54%, transparent 55%)"
    : HAIR_COLORS[color];
}

/**
 * Round colour swatches for picking the avatar's hair colour.
 * `layout="inline"` fits a form row, `layout="centered"` is used inside modals.
 */
export function HairColorPicker({
  value,
  onChange,
  layout = "inline",
}: {
  value: HairColor;
  onChange: (value: HairColor) => void;
  layout?: "inline" | "centered";
}) {
  return (
    <div
      className={layout === "inline" ? "swatches" : "modal-swatches"}
      role="radiogroup"
      aria-label="Kolor włosów"
    >
      {HAIR_COLOR_OPTIONS.map((color) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === color}
          className={cx(value === color && "selected")}
          onClick={() => onChange(color)}
          key={color}
        >
          <i style={{ background: swatchBackground(color) }} />
          <span>{color}</span>
        </button>
      ))}
    </div>
  );
}
