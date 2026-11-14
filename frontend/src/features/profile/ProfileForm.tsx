import { useState } from "react";
import { UnitField } from "@/components/form/Fields";
import { Button } from "@/components/ui/Button";
import { GlassPanel } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import { AvatarControls } from "@/features/avatar/AvatarControls";

function SignalCorrectionStatus({ label, status }: { label: string; status: string }) {
  return (
    <div className="correction">
      <span>
        <Icon name="wave" size={18} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{status}</strong>
      </div>
      <i />
    </div>
  );
}

export function ProfileForm({
  avatar,
  onAvatarChange,
  onSubmit,
}: {
  avatar: AvatarConfig;
  onAvatarChange: (avatar: AvatarConfig) => void;
  onSubmit: () => void;
}) {
  const [age, setAge] = useState("24");

  return (
    <GlassPanel className="form-panel">
      <div className="panel-heading">
        <span className="heading-icon">
          <Icon name="person" />
        </span>
        <div>
          <h2>Twój profil</h2>
          <p>Podstawowe parametry treningowe</p>
        </div>
      </div>

      <div className="form-row">
        <UnitField label="Wiek" unit="lat" value={age} onChange={setAge} />
        <UnitField label="Waga" unit="kg" value={avatar.weight > 0 ? String(avatar.weight) : ""}
          onChange={(value) => onAvatarChange({ ...avatar, weight: Number(value) })} />
      </div>

      <AvatarControls avatar={avatar} onChange={onAvatarChange} />

      <SignalCorrectionStatus label="Korekcja NIR 760/850 nm" status="Aktywna" />

      <Button block trailing="→" onClick={onSubmit}>
        Zapisz profil
      </Button>
      <p className="privacy">Dane są przetwarzane lokalnie i pozostają prywatne.</p>
    </GlassPanel>
  );
}
