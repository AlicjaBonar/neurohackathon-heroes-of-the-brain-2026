import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cx, digitsOnly } from "@/lib/utils";

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

/** Labelled custom dropdown (listbox) with the app's field styling. */
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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const show = () => {
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  };
  const choose = (option: T) => {
    onChange(option);
    setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") return setOpen(false);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return show();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(options[active]);
    }
  };

  return (
    <div className="select-label" ref={root}>
      <span className="select-caption">{label}</span>
      <div className={cx("select-box", open && "is-open")}>
        <button
          type="button"
          className="select-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : show())}
          onKeyDown={onKeyDown}
        >
          {value}
        </button>
        {open && (
          <ul className="select-menu" role="listbox">
            {options.map((option, index) => (
              <li
                key={option}
                role="option"
                aria-selected={option === value}
                className={cx(option === value && "selected", index === active && "active")}
                onPointerEnter={() => setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {option}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
