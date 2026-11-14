import type { ReactNode } from "react";
import { SENSOR_RATE_LABEL } from "@/lib/utils";

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <span />
        <span />
        <span />
      </div>
      <div>
        <strong>NeuroFlow</strong>
        <small>ODDECH • RUCH • FLOW</small>
      </div>
    </div>
  );
}

export function StatusPill() {
  return (
    <div className="status-pill">
      <i /> fNIRS połączony <b>{SENSOR_RATE_LABEL}</b>
    </div>
  );
}

/**
 * Page frame shared by every screen: background, header with the brand on the left
 * and `headerContent` on the right (defaults to the sensor status pill).
 */
export function AppShell({
  variant = "default",
  headerContent = <StatusPill />,
  children,
}: {
  variant?: "default" | "session";
  headerContent?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className={variant === "session" ? "session-shell" : "app-shell"}>
      <header>
        <Brand />
        {headerContent}
      </header>
      {children}
    </main>
  );
}
