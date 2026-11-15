import { useEffect, useState } from "react";
import { api } from "@/api/backend";
import type { Exercise, SourceIn, User } from "@/api/types";
import { AppShell } from "@/components/layout/AppShell";
import { GlassPanel } from "@/components/ui/Card";
import { ScreenTitle } from "@/components/ui/Page";
import { Avatar } from "@/features/avatar/Avatar";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import { cx, formatOrdinal } from "@/lib/utils";
import { ActivityModal } from "./HubModals";

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
        <span className="eyebrow">YOUR PLAN FOR TODAY</span>
        <h2>Ready for another session?</h2>
        <p>Check your vitals or start a workout matched to how ready you are today.</p>
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

function ReadinessCard({ avatar, onAvatarClick }: { avatar: AvatarConfig; onAvatarClick: () => void }) {
  return (
    <GlassPanel
      as="button"
      type="button"
      className="readiness avatar-select"
      onClick={onAvatarClick}
      aria-label="Update your profile and avatar"
    >
      <Avatar aura avatar={avatar} introGesture="six_seven" />
    </GlassPanel>
  );
}

export function HubScreen({
  user,
  avatar,
  onStats,
  onProfile,
  onSession,
}: {
  user: User;
  avatar: AvatarConfig;
  onStats: () => void;
  onProfile: () => void;
  onSession: (exercise: Exercise, source: SourceIn) => void;
}) {
  const [activityOpen, setActivityOpen] = useState(false);
  const [exercises, setExercises] = useState<Exercise[]>([]);

  useEffect(() => {
    api.exercises().then(setExercises).catch(() => setExercises([]));
  }, [user.id]);

  // Demo personas replay their own real recordings; everyone else gets the simulator.
  const source: SourceIn = user.is_demo ? { type: "replay" } : { type: "mock" };

  const actions: HubAction[] = [
    {
      tone: "stats",
      title: "Vitals",
      subtitle: "Statistics and trends",
      onClick: onStats,
    },
    {
      tone: "start",
      title: "Start an activity",
      subtitle: "Choose a session type",
      onClick: () => setActivityOpen(true),
    },
    {
      tone: "avatar",
      title: "Update profile",
      subtitle: "Your details and avatar",
      onClick: onProfile,
    },
  ];

  return (
    <AppShell>
      <ScreenTitle
        eyebrow={`GOOD DAY, ${user.name.toUpperCase()}`}
        title="Training hub"
        description="Pick a mode and sync your breathing with your cortical activity."
      />
      <section className="hub-dashboard">
        <HubActionsPanel actions={actions} />
        <ReadinessCard avatar={avatar} onAvatarClick={onProfile} />
      </section>

      <ActivityModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        exercises={exercises}
        user={user}
        onSelect={(exercise) => onSession(exercise, source)}
      />
    </AppShell>
  );
}
