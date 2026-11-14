import { AppShell } from "@/components/layout/AppShell";
import { GlassPanel } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ScreenTitle, StepIndicator } from "@/components/ui/Page";
import type { User } from "@/api/types";
import { Avatar } from "@/features/avatar/Avatar";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import { ProfileForm } from "./ProfileForm";

function AvatarPreviewPanel({ avatar }: { avatar: AvatarConfig }) {
  return (
    <GlassPanel className="avatar-panel">
      <div className="science-tag">
        <Icon name="wave" size={16} /> OPTYCZNA TOMOGRAFIA KORY
      </div>
      <Avatar avatar={avatar} interactive />
    </GlassPanel>
  );
}

export function ProfileScreen({
  user,
  avatar,
  onAvatarChange,
  onDone,
}: {
  /** Current user when editing an existing profile; the form starts pre-filled. */
  user?: User | null;
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
        <ProfileForm user={user} avatar={avatar} onAvatarChange={onAvatarChange} onDone={onDone} />
      </section>
    </AppShell>
  );
}
