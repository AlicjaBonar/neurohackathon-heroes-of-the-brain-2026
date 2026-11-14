import type { ReactNode } from "react";
import { cx } from "@/lib/utils";

/** Page heading with eyebrow, H1, description and an optional right-hand slot. */
export function ScreenTitle({
  eyebrow,
  title,
  description,
  aside,
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("screen-title", className)}>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Row of progress dashes, e.g. "step 1 of 2". `current` is 1-based. */
export function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="steps">
      {Array.from({ length: total }, (_, index) => (
        <i className={index < current ? "active" : undefined} key={index} />
      ))}
    </div>
  );
}
