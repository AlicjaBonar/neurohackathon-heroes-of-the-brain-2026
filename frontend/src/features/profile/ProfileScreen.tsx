import { AppShell } from "@/components/layout/AppShell";
import { GlassPanel } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ScreenTitle, StepIndicator } from "@/components/ui/Page";
import type { User } from "@/api/types";
import { Avatar } from "@/features/avatar/Avatar";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
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

function AvatarPreviewPanel({ avatar }: { avatar: AvatarConfig }) {
  return (
    <GlassPanel className="avatar-panel">
      <div className="science-tag">
        <Icon name="wave" size={16} /> OPTYCZNA TOMOGRAFIA KORY
      </div>
      <Avatar avatar={avatar} interactive />
      <CalibrationBadge label="Kalibracja fNIRS" value="po podłączeniu opaski" />
    </GlassPanel>
  );
}

export function ProfileScreen({
  avatar,
  onAvatarChange,
  onDone,
}: {
  avatar: AvatarConfig;
  onAvatarChange: (avatar: AvatarConfig) => void;
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
        <AvatarPreviewPanel avatar={avatar} />
        <ProfileForm avatar={avatar} onAvatarChange={onAvatarChange} onDone={onDone} />
      </section>
    </AppShell>
  );
}
