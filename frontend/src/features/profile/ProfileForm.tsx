import { useState } from "react";
import { SelectField, UnitField } from "@/components/form/Fields";
import { Button } from "@/components/ui/Button";
import { GlassPanel } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import type { HairColor } from "@/features/avatar/Avatar";
import { HairColorPicker } from "@/features/avatar/HairColorPicker";

const HAIR_LENGTHS = ["Krótkie", "Średnie", "Długie"] as const;
type HairLength = (typeof HAIR_LENGTHS)[number];

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
  hair,
  onHairChange,
  onSubmit,
}: {
  hair: HairColor;
  onHairChange: (hair: HairColor) => void;
  onSubmit: () => void;
}) {
  const [age, setAge] = useState("24");
  const [weight, setWeight] = useState("72");
  const [hairLength, setHairLength] = useState<HairLength>("Krótkie");

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
        <UnitField label="Waga" unit="kg" value={weight} onChange={setWeight} />
      </div>

      <div className="field-block">
        <label>Kolor włosów</label>
        <HairColorPicker value={hair} onChange={onHairChange} />
      </div>

      <SelectField
        label="Długość włosów"
        options={HAIR_LENGTHS}
        value={hairLength}
        onChange={setHairLength}
      />

      <SignalCorrectionStatus label="Korekcja NIR 760/850 nm" status="Aktywna" />

      <Button block trailing="→" onClick={onSubmit}>
        Zapisz profil
      </Button>
      <p className="privacy">Dane są przetwarzane lokalnie i pozostają prywatne.</p>
    </GlassPanel>
  );
}
