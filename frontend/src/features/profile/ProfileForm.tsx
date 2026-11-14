import { useEffect, useState } from "react";
import { api, errorMessage } from "@/api/backend";
import type { Persona, User } from "@/api/types";
import { SelectField, UnitField } from "@/components/form/Fields";
import { Button } from "@/components/ui/Button";
import { GlassPanel } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { HAIR_COLORS, type HairColor } from "@/features/avatar/Avatar";
import { HairColorPicker } from "@/features/avatar/HairColorPicker";

/** Self-reported activity, values of the Jurca 2005 scale (docs V1). */
const ACTIVITY = [
  { value: 0, label: "Unikam wysiłku" },
  { value: 0.32, label: "Spacery, lekka aktywność" },
  { value: 1.06, label: "Regularna aktywność umiarkowana" },
  { value: 1.76, label: "Regularny bieg / trening" },
  { value: 3.03, label: "Intensywny trening kilka razy w tygodniu" },
] as const;
const ACTIVITY_LABELS = ACTIVITY.map((a) => a.label);
const SEXES = ["Kobieta", "Mężczyzna"] as const;
const NEW_PROFILE = "Nowy profil";

const personaLabel = (p: Persona) =>
  `${p.id.replace("demo_", "").replace("_", " ").toUpperCase()} · ${p.sex ?? "?"}, ${p.age ?? "?"} l.`;

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
  onDone,
}: {
  hair: HairColor;
  onHairChange: (hair: HairColor) => void;
  onDone: (user: User) => void;
}) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("24");
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("70");
  const [sex, setSex] = useState<(typeof SEXES)[number]>("Kobieta");
  const [activity, setActivity] = useState(ACTIVITY_LABELS[2]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [persona, setPersona] = useState(NEW_PROFILE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.personas().then(setPersonas).catch(() => setPersonas([]));
  }, []);

  const personaOptions = [NEW_PROFILE, ...personas.map(personaLabel)];
  const selected = personas.find((p) => personaLabel(p) === persona);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (selected) {
        onDone(await api.getUser(selected.id));
        return;
      }
      if (!name.trim()) {
        setError("Podaj imię lub pseudonim.");
        return;
      }
      const user = await api.createUser({
        name: name.trim(),
        birth_year: new Date().getFullYear() - Number(age),
        sex: sex === "Kobieta" ? "F" : "M",
        height_cm: Number(height),
        weight_kg: Number(weight),
        activity_score: ACTIVITY.find((a) => a.label === activity)?.value ?? null,
        avatar: { hair_color: hair in HAIR_COLORS ? hair : null },
      });
      onDone(user);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassPanel className="form-panel">
      <div className="panel-heading">
        <span className="heading-icon">
          <Icon name="person" />
        </span>
        <div>
          <h2>Twój profil</h2>
          <p>Wiek, wzrost i waga służą do korekcji sygnału i szacowania formy</p>
        </div>
      </div>

      {personas.length > 0 && (
        <SelectField label="Profil demo (prawdziwe nagrania)" options={personaOptions} value={persona} onChange={setPersona} />
      )}

      {!selected && (
        <>
          <label className="text-field">
            Imię lub pseudonim
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="form-row">
            <UnitField label="Wiek" unit="lat" value={age} onChange={setAge} />
            <SelectField label="Płeć" options={SEXES} value={sex} onChange={setSex} />
          </div>
          <div className="form-row">
            <UnitField label="Wzrost" unit="cm" value={height} onChange={setHeight} />
            <UnitField label="Waga" unit="kg" value={weight} onChange={setWeight} />
          </div>
          <SelectField label="Aktywność fizyczna" options={ACTIVITY_LABELS} value={activity} onChange={setActivity} />
          <div className="field-block">
            <label>Kolor włosów</label>
            <HairColorPicker value={hair} onChange={onHairChange} />
          </div>
        </>
      )}

      <SignalCorrectionStatus label="Korekcja NIR 760/850 nm" status="Aktywna" />
      {error && <p className="form-error" role="alert">{error}</p>}

      <Button block trailing="→" onClick={() => void submit()} disabled={busy}>
        {busy ? "Zapisywanie…" : selected ? "Wczytaj profil demo" : "Zapisz profil"}
      </Button>
      <p className="privacy">Dane są przetwarzane lokalnie i pozostają prywatne.</p>
    </GlassPanel>
  );
}
