import { useEffect, type ReactNode } from "react";
import { cx } from "@/lib/utils";
import { Button } from "./Button";
import { GlassPanel } from "./Card";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  eyebrow: ReactNode;
  title: string;
  description?: ReactNode;
  closeLabel?: string;
  className?: string;
  children: ReactNode;
};

/** Centered glass dialog with a blurred backdrop. Closes on backdrop click and Escape. */
export function Modal({
  open,
  onClose,
  eyebrow,
  title,
  description,
  closeLabel = "Zamknij",
  className,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button className="modal-backdrop" aria-label={closeLabel} onClick={onClose} />
      <GlassPanel className={cx("choice-modal", className)}>
        <Button variant="ghost" className="modal-close" onClick={onClose}>
          {closeLabel}
        </Button>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {children}
      </GlassPanel>
    </div>
  );
}
