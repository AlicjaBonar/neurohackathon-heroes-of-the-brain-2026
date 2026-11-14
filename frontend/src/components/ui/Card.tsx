import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cx } from "@/lib/utils";

type GlassPanelProps<T extends ElementType> = {
  as?: T;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className">;

/** Frosted-glass surface used by every card and panel in the app. */
export function GlassPanel<T extends ElementType = "div">({
  as,
  className,
  ...rest
}: GlassPanelProps<T>) {
  const Component: ElementType = as ?? "div";
  return <Component className={cx("glass", className)} {...rest} />;
}

/** Card heading: small uppercase caption, title and an optional right-hand slot. */
export function CardHeader({
  caption,
  title,
  aside,
}: {
  caption: ReactNode;
  title: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="card-head">
      <div>
        <span>{caption}</span>
        <h2>{title}</h2>
      </div>
      {aside}
    </div>
  );
}

/** Thin horizontal bar; styling comes from the parent (`.summary-bars`, `.economy`). */
export function ProgressBar({ value }: { value: number }) {
  return (
    <i role="presentation">
      <b style={{ width: `${value}%` }} />
    </i>
  );
}

/**
 * Big number followed by a smaller unit, e.g. `61 BPM`.
 * Include a leading space in `unit` when it should be separated from the value.
 */
export function ValueWithUnit({
  value,
  unit,
  unitAs: Unit = "small",
}: {
  value: string | number;
  unit: string;
  unitAs?: ElementType;
}) {
  return (
    <strong>
      {value}
      <Unit>{unit}</Unit>
    </strong>
  );
}
