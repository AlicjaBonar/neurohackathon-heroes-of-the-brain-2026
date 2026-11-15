import { useEffect, useState } from "react";
import { api, errorMessage } from "@/api/backend";
import type { Persona, User } from "@/api/types";
import { SelectField, UnitField } from "@/components/form/Fields";
import { Button } from "@/components/ui/Button";
import { GlassPanel } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { avatarToStored, type AvatarConfig, type Sex } from "@/features/avatar/avatarConfig";
import { AvatarControls } from "@/features/avatar/AvatarControls";

/** Self-reported activity, values of the Jurca 2005 scale (docs V1). */
const ACTIVITY = [
  { value: 0, label: "I avoid exercise" },
  { value: 0.32, label: "Walks, light activity" },
  { value: 1.06, label: "Regular moderate activity" },
  { value: 1.76, label: "Regular running / training" },
  { value: 3.03, label: "Intense training several times a week" },
] as const;
const ACTIVITY_LABELS = ACTIVITY.map((a) => a.label);
const SEXES = ["Female", "Male"] as const;
type SexLabel = (typeof SEXES)[number];
const SEX_BY_LABEL: Record<SexLabel, Sex> = { Female: "F", Male: "M" };
const NEW_PROFILE = "New profile";

const closestActivity = (score: number | null | undefined) =>
  score == null
    ? undefined
    : ACTIVITY.reduce((best, a) => (Math.abs(a.value - score) < Math.abs(best.value - score) ? a : best));

const personaLabel = (p: Persona) =>
  `${p.id.replace("demo_", "").replace("_", " ").toUpperCase()} · ${p.sex ?? "?"}, ${p.age ?? "?"} y`;

export function ProfileForm({
  user,
  avatar,
  onAvatarChange,
  onDone,
}: {
  user?: User | null;
  avatar: AvatarConfig;
  onAvatarChange: (avatar: AvatarConfig) => void;
  onDone: (user: User) => void;
}) {
  const editing = user && !user.is_demo ? user : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [age, setAge] = useState(String(editing?.derived.age ?? 24));
  const [height, setHeight] = useState(String(editing?.height_cm ?? 170));
  // Sex and weight live in the avatar config so the 3D model follows the form.
  const sex: SexLabel = avatar.sex === "F" ? "Female" : "Male";
  const setSex = (label: SexLabel) => {
    const next = SEX_BY_LABEL[label];
    onAvatarChange({ ...avatar, sex: next, length: next === "F" ? "long" : "short" });
  };
  const weight = avatar.weight > 0 ? String(avatar.weight) : "";
  const setWeight = (value: string) => onAvatarChange({ ...avatar, weight: Number(value) });
  const [activity, setActivity] = useState<string>(
    closestActivity(editing?.activity_score)?.label ?? ACTIVITY_LABELS[2],
  );
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [persona, setPersona] = useState(NEW_PROFILE);
  const demoId = user?.is_demo ? user.id : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .personas()
      .then((list) => {
        setPersonas(list);
        const current = list.find((p) => p.id === demoId);
        if (current) setPersona(personaLabel(current));
      })
      .catch(() => setPersonas([]));
  }, [demoId]);

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
        setError("Enter your name or a nickname.");
        return;
      }
      const body = {
        name: name.trim(),
        birth_year: new Date().getFullYear() - Number(age),
        sex: avatar.sex,
        height_cm: Number(height),
        weight_kg: avatar.weight,
        activity_score: ACTIVITY.find((a) => a.label === activity)?.value ?? null,
        avatar: avatarToStored(avatar),
      };
      onDone(editing ? await api.updateUser(editing.id, body) : await api.createUser(body));
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
          <h2>Your profile</h2>
        </div>
      </div>

      {personas.length > 0 && (
        <SelectField label="Demo profile (real recordings)" options={personaOptions} value={persona} onChange={setPersona} />
      )}

      {!selected && (
        <>
          <label>
            Name or nickname
            <div className="input-wrap">
              <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </div>
          </label>
          <div className="form-row">
            <UnitField label="Age" unit="years" value={age} onChange={setAge} />
            <SelectField label="Sex" options={SEXES} value={sex} onChange={setSex} />
          </div>
          <div className="form-row">
            <UnitField label="Height" unit="cm" value={height} onChange={setHeight} />
            <UnitField label="Weight" unit="kg" value={weight} onChange={setWeight} />
          </div>
          <SelectField label="Physical activity" options={ACTIVITY_LABELS} value={activity} onChange={setActivity} />
          <AvatarControls avatar={avatar} onChange={onAvatarChange} showSex={false} />
        </>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <Button onClick={() => void submit()} disabled={busy}>
        {busy ? "Saving…" : selected ? "Load demo profile" : "Save profile"}
      </Button>
    </GlassPanel>
  );
}
