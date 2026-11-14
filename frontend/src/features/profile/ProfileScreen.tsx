import { AppShell } from "@/components/layout/AppShell";
import { GlassPanel } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ScreenTitle, StepIndicator } from "@/components/ui/Page";
import type { User } from "@/api/types";
import { Avatar, type HairColor } from "@/features/avatar/Avatar";
import { ProfileForm } from "./ProfileForm";

function CalibrationBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="calibration-badge">
      <span>
        <Icon name="check" size={17} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function AvatarPreviewPanel({ hair }: { hair: HairColor }) {
  return (
    <GlassPanel className="avatar-panel">
      <div className="science-tag">
        <Icon name="wave" size={16} /> OPTYCZNA TOMOGRAFIA KORY
      </div>
      <Avatar hair={hair} />
      <CalibrationBadge label="Kalibracja fNIRS" value="po podłączeniu opaski" />
    </GlassPanel>
  );
}

export function ProfileScreen({
  hair,
  onHairChange,
  onDone,
}: {
  hair: HairColor;
  onHairChange: (hair: HairColor) => void;
  onDone: (user: User) => void;
}) {
  return (
    <AppShell>
      <ScreenTitle
        eyebrow="KROK 1 Z 2"
        title="Profil i kalibracja"
        description="Dopasuj profil, aby zwiększyć precyzję odczytów biomarkerów."
        aside={<StepIndicator current={1} total={2} />}
      />
      <section className="split profile-grid">
        <AvatarPreviewPanel hair={hair} />
        <ProfileForm hair={hair} onHairChange={onHairChange} onDone={onDone} />
      </section>
    </AppShell>
  );
}
