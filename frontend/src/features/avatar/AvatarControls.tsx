import { cx } from "@/lib/utils";
import {
  HAIR_COLOR_PRESETS,
  LENGTH_OPTIONS,
  SEX_OPTIONS,
  TEXTURE_OPTIONS,
  type AvatarConfig,
} from "./avatarConfig";

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="control-group" role="radiogroup" aria-label={label}>
      <span className="control-title">{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={cx(value === option.value && "selected")}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            key={option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Setters for the 3D avatar: sex, hair type, hair length and hair colour. */
export function AvatarControls({
  avatar,
  onChange,
  layout = "inline",
}: {
  avatar: AvatarConfig;
  onChange: (avatar: AvatarConfig) => void;
  layout?: "inline" | "centered";
}) {
  const set = (patch: Partial<AvatarConfig>) => onChange({ ...avatar, ...patch });
  const bald = avatar.texture === "bald";
  const isPreset = HAIR_COLOR_PRESETS.some(
    (preset) => preset.hex.toLowerCase() === avatar.color.toLowerCase(),
  );

  return (
    <div className={cx("avatar-controls", layout === "centered" && "is-centered")}>
      <Segmented
        label="Płeć"
        options={SEX_OPTIONS}
        value={avatar.sex}
        onChange={(sex) => set({ sex, length: sex === "F" ? "long" : "short" })}
      />
      <Segmented
        label="Rodzaj włosów"
        options={TEXTURE_OPTIONS}
        value={avatar.texture}
        onChange={(texture) => set({ texture })}
      />
      <Segmented
        label="Długość włosów"
        options={LENGTH_OPTIONS}
        value={avatar.length}
        onChange={(length) => set({ length })}
        disabled={bald}
      />
      <div className="control-group" aria-disabled={bald}>
        <span className="control-title">Kolor włosów</span>
        <div
          className={cx(layout === "inline" ? "swatches" : "modal-swatches", bald && "is-disabled")}
          role="radiogroup"
          aria-label="Kolor włosów"
        >
          {HAIR_COLOR_PRESETS.map((preset) => {
            const selected = preset.hex.toLowerCase() === avatar.color.toLowerCase();
            return (
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                className={cx(selected && "selected")}
                disabled={bald}
                onClick={() => set({ color: preset.hex })}
                key={preset.hex}
              >
                <i style={{ background: preset.hex }} />
                <span>{preset.label}</span>
              </button>
            );
          })}
          <label className={cx("swatch-custom", !isPreset && "selected")}>
            <i
              style={{
                background: isPreset
                  ? "conic-gradient(#f43f5e, #f59e0b, #10b981, #3b82f6, #a855f7, #f43f5e)"
                  : avatar.color,
              }}
            />
            <input
              type="color"
              value={avatar.color}
              disabled={bald}
              onChange={(event) => set({ color: event.target.value })}
              aria-label="Własny kolor włosów"
            />
            <span>Własny</span>
          </label>
        </div>
      </div>
    </div>
  );
}
