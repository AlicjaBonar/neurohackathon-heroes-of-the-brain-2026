import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { GlassPanel } from "@/components/ui/Card";
import { ScreenTitle } from "@/components/ui/Page";
import { Avatar } from "@/features/avatar/Avatar";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import type { SessionMode } from "@/features/session/sessionData";
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
  score,
  onAvatarClick,
}: {
  avatar: AvatarConfig;
  score: number;
  onAvatarClick: () => void;
}) {
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
          <span>GOTOWOŚĆ NEUROFIZJOLOGICZNA</span>
          <strong>
            <i /> Sygnał optymalny
          </strong>
        </div>
        <span className="avatar-hint">Kliknij, aby zmienić</span>
      </div>
      <Avatar aura avatar={avatar} introGesture="six_seven" />
      <div className="flow-score">
        <div className="score-ring">
          <strong>
            {score}
            <small>%</small>
          </strong>
        </div>
        <div>
          <small>GOTOWOŚĆ</small>
          <strong>Flow</strong>
          <span>Wysoka dyspozycja</span>
        </div>
      </div>
    </GlassPanel>
  );
}

type OpenModal = "activity" | "avatar" | null;

export function HubScreen({
  avatar,
  onAvatarChange,
  onStats,
  onSession,
}: {
  avatar: AvatarConfig;
  onAvatarChange: (avatar: AvatarConfig) => void;
  onStats: () => void;
  onSession: (mode: SessionMode) => void;
}) {
  const [openModal, setOpenModal] = useState<OpenModal>(null);
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
        eyebrow="DZIEŃ DOBRY, KAMIL"
        title="Centrum treningowe"
        description="Wybierz tryb i zsynchronizuj oddech z aktywnością kory."
        aside={
          <div className="day-score">
            <span>Seria</span>
            <strong>12 dni</strong>
          </div>
        }
      />
      <section className="hub-dashboard">
        <HubActionsPanel actions={actions} />
        <ReadinessCard avatar={avatar} score={88} onAvatarClick={() => setOpenModal("avatar")} />
      </section>

      <ActivityModal open={openModal === "activity"} onClose={closeModal} onSelect={onSession} />
      <AvatarModal
        open={openModal === "avatar"}
        onClose={closeModal}
        avatar={avatar}
        onAvatarChange={onAvatarChange}
      />
    </AppShell>
  );
}
