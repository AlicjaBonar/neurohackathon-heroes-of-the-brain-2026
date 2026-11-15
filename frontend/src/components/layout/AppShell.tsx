import { useEffect, useState, type ReactNode } from "react";
import { getJson } from "@/api/rest";

export function Brand({ tagline = "KEEP CALM AND CHECK YOUR BREATH" }: { tagline?: string }) {
  return (
    <div className="brand">
      <img className="brand-mark" src="/logo.png" alt="" />
      <div>
        <strong>BreathMaxxxing</strong>
        <small>{tagline}</small>
      </div>
    </div>
  );
}

type Health = { status: string; version: string; demo_data: boolean };

/** Backend connection indicator (GET /api/health). */
export function StatusPill() {
  const [health, setHealth] = useState<Health | "offline" | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getJson<Health>("health", controller.signal)
      .then(setHealth)
      .catch(() => !controller.signal.aborted && setHealth("offline"));
    return () => controller.abort();
  }, []);
  return (
    <div className="status-pill">
      <i />{" "}
      {health === "offline" ? "Backend offline" : health ? "Backend connected" : "Connecting…"}
      {health && health !== "offline" && <b>v{health.version}</b>}
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
  tagline,
  children,
}: {
  variant?: "default" | "session";
  tagline?: string;
  headerContent?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className={variant === "session" ? "session-shell" : "app-shell"}>
      <header>
        <Brand tagline={tagline} />
        {headerContent}
      </header>
      {children}
    </main>
  );
}
