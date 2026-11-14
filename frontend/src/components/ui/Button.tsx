import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/utils";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Stretches the button to the full width of its container. */
  block?: boolean;
  /** Optional icon rendered before the label. */
  icon?: IconName;
  /** Optional element rendered after the label (e.g. an arrow). */
  trailing?: ReactNode;
};

export function Button({
  variant = "primary",
  block = false,
  icon,
  trailing,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("btn", `btn-${variant}`, block && "btn-block", className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
      {trailing && <span className="btn-trailing">{trailing}</span>}
    </button>
  );
}

/** Text-only "back" link used in screen headers. */
export function BackButton({ onClick, label = "Wróć" }: { onClick: () => void; label?: string }) {
  return (
    <Button variant="ghost" icon="arrow" onClick={onClick}>
      {label}
    </Button>
  );
}
