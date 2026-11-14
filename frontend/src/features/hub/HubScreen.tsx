import { useEffect, useState } from "react";
import { api } from "@/api/backend";
import type { Dashboard, Exercise, SourceIn, User } from "@/api/types";
import { AppShell } from "@/components/layout/AppShell";
import { GlassPanel } from "@/components/ui/Card";
import { ScreenTitle } from "@/components/ui/Page";
import { Avatar } from "@/features/avatar/Avatar";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import { cx, formatOrdinal } from "@/lib/utils";
import { ActivityModal, AvatarModal } from "./HubModals";

type HubAction = {
  tone: "stats" | "start" | "avatar";
  title: string;
  subtitle: string;
  onClick: () => void;
};

function HubActionsPanel({ actions }: { actions: HubAction[] }) {
  return (
    <GlassPanel className="hub-actions">
      <div className="hub-actions-copy">
        <span className="eyebrow">TWÓJ DZISIEJSZY PLAN</span>
        <h2>Gotowy na kolejną sesję?</h2>
        <p>Sprawdź parametry albo rozpocznij trening dopasowany do aktualnej gotowości.</p>
      </div>
      <div className="hub-button-row">
        {actions.map((action, index) => (
          <button
            type="button"
            key={action.tone}
            className={cx("hub-button", `${action.tone}-button`)}
            onClick={action.onClick}
          >
            <small>{formatOrdinal(index)}</small>
            <strong>{action.title}</strong>
            <span>{action.subtitle}</span>
          </button>
        ))}
      </div>
    </GlassPanel>
  );
}

function ReadinessCard({
  avatar,
  dashboard,
  onAvatarClick,
}: {
  avatar: AvatarConfig;
  dashboard: Dashboard | null;
  onAvatarClick: () => void;
}) {
  const hr = dashboard?.readiness.hr_rest;
  const rmssd = dashboard?.readiness.rmssd;
  return (
    <GlassPanel
      as="button"
      type="button"
      className="readiness avatar-select"
      onClick={onAvatarClick}
      aria-label="Zmień wygląd awatara"
    >
      <div className="readiness-top">
        <div>
          <span>GOTOWOŚĆ</span>
          <strong>
            <i /> {dashboard?.readiness.text ?? "Brak pomiarów – zrób pierwszą sesję"}
          </strong>
        </div>
        <span className="avatar-hint">Kliknij, aby zmienić</span>
      </div>
      <Avatar aura avatar={avatar} introGesture="six_seven" />
      <div className="flow-score">
        <div className="score-ring">
          <strong>
            {hr ? Math.round(hr.value) : "—"}
            <small> BPM</small>
          </strong>
        </div>
        <div>
          <small>TĘTNO SPOCZYNKOWE</small>
          <strong>{rmssd ? `HRV ${Math.round(rmssd.value)} ms` : "HRV —"}</strong>
          <span>
            {hr?.delta != null
              ? `${hr.delta > 0 ? "+" : ""}${hr.delta} BPM vs. Twoja średnia`
              : "linia bazowa po kilku sesjach"}
          </span>
        </div>
      </div>
    </GlassPanel>
  );
}

type OpenModal = "activity" | "avatar" | null;

export function HubScreen({
  user,
  avatar,
  onAvatarChange,
  onStats,
  onSession,
}: {
  user: User;
  avatar: AvatarConfig;
  onAvatarChange: (avatar: AvatarConfig) => void;
  onStats: () => void;
  onSession: (exercise: Exercise, source: SourceIn) => void;
}) {
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);

  useEffect(() => {
    api.dashboard(user.id).then(setDashboard).catch(() => setDashboard(null));
    api.exercises().then(setExercises).catch(() => setExercises([]));
  }, [user.id]);

  // Demo personas replay their own real recordings; everyone else gets the simulator.
  const source: SourceIn = user.is_demo ? { type: "replay" } : { type: "mock" };
  const closeModal = () => setOpenModal(null);

  const actions: HubAction[] = [
    {
      tone: "stats",
      title: "Parametry życiowe",
      subtitle: "Statystyki i trendy",
      onClick: onStats,
    },
    {
      tone: "start",
      title: "Rozpocznij aktywność",
      subtitle: "Wybierz rodzaj sesji",
      onClick: () => setOpenModal("activity"),
    },
    {
      tone: "avatar",
      title: "Zmień awatara",
      subtitle: "Dopasuj wygląd",
      onClick: () => setOpenModal("avatar"),
    },
  ];

  return (
    <AppShell>
      <ScreenTitle
        eyebrow={`DZIEŃ DOBRY, ${user.name.toUpperCase()}`}
        title="Centrum treningowe"
        description="Wybierz tryb i zsynchronizuj oddech z aktywnością kory."
        aside={
          dashboard?.fitness.crf_mets != null ? (
            <div className="day-score">
              <span>Forma (CRF)</span>
              <strong>{dashboard.fitness.crf_mets} MET</strong>
            </div>
          ) : undefined
        }
      />
      <section className="hub-dashboard">
        <HubActionsPanel actions={actions} />
        <ReadinessCard avatar={avatar} dashboard={dashboard} onAvatarClick={() => setOpenModal("avatar")} />
      </section>

      <ActivityModal
        open={openModal === "activity"}
        onClose={closeModal}
        exercises={exercises}
        onSelect={(exercise) => onSession(exercise, source)}
      />
      <AvatarModal
        open={openModal === "avatar"}
        onClose={closeModal}
        avatar={avatar}
        onAvatarChange={onAvatarChange}
      />
    </AppShell>
  );
}
