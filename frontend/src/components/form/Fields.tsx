import { digitsOnly } from "@/lib/utils";

/** Numeric text input with a unit suffix (e.g. "lat", "kg"). Accepts digits only. */
export function UnitField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <div className="input-wrap">
        <input
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(digitsOnly(event.target.value))}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}

/** Labelled native `<select>` with the app's field styling. */
export function SelectField<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <label className="select-label">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
