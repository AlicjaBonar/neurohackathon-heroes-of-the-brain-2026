import type { ReactNode } from "react";
import { BackButton } from "@/components/ui/Button";

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

/**
 * Page frame shared by every screen: background, header with the brand on the left and
 * `headerContent` plus the back button on the right. The back button always sits in the same
 * place (last item of the header) on every screen that has one.
 */
export function AppShell({
  variant = "default",
  headerContent,
  onBack,
  backLabel = "Back",
  tagline,
  children,
}: {
  variant?: "default" | "session";
  tagline?: string;
  headerContent?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <main className={variant === "session" ? "session-shell" : "app-shell"}>
      <header>
        <Brand tagline={tagline} />
        {(headerContent || onBack) && (
          <div className="header-right">
            {headerContent}
            {onBack && <BackButton onClick={onBack} label={backLabel} />}
          </div>
        )}
      </header>
      {children}
    </main>
  );
}
