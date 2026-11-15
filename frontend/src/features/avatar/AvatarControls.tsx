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
  showSex = true,
}: {
  avatar: AvatarConfig;
  onChange: (avatar: AvatarConfig) => void;
  /** Hide when the surrounding form already has its own sex field. */
  showSex?: boolean;
}) {
  const set = (patch: Partial<AvatarConfig>) => onChange({ ...avatar, ...patch });
  const bald = avatar.texture === "bald";
  const isPreset = HAIR_COLOR_PRESETS.some(
    (preset) => preset.hex.toLowerCase() === avatar.color.toLowerCase(),
  );

  return (
    <div className="avatar-controls">
      {showSex && (
        <Segmented
          label="Sex"
          options={SEX_OPTIONS}
          value={avatar.sex}
          onChange={(sex) => set({ sex, length: sex === "F" ? "long" : "short" })}
        />
      )}
      <Segmented
        label="Hair type"
        options={TEXTURE_OPTIONS}
        value={avatar.texture}
        onChange={(texture) => set({ texture })}
      />
      <Segmented
        label="Hair length"
        options={LENGTH_OPTIONS}
        value={avatar.length}
        onChange={(length) => set({ length })}
        disabled={bald}
      />
      <div className="control-group" aria-disabled={bald}>
        <span className="control-title">Hair colour</span>
        <div
          className={cx("swatches", bald && "is-disabled")}
          role="radiogroup"
          aria-label="Hair colour"
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
              aria-label="Custom hair colour"
            />
            <span>Custom</span>
          </label>
        </div>
      </div>
    </div>
  );
}
