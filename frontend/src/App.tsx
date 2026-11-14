import { useCallback, useState } from "react";
import type { Exercise, SourceIn, Summary, User } from "@/api/types";
import {
  avatarFromUser,
  DEFAULT_AVATAR,
  type AvatarConfig,
} from "@/features/avatar/avatarConfig";
import { HubScreen } from "@/features/hub/HubScreen";
import { ProfileScreen } from "@/features/profile/ProfileScreen";
import { SessionScreen } from "@/features/session/SessionScreen";
import { SummaryScreen } from "@/features/session/SummaryScreen";
import { StatsScreen } from "@/features/stats/StatsScreen";

type Screen = "profile" | "hub" | "stats" | "session" | "summary";

type ActiveSession = { exercise: Exercise; source: SourceIn };

export default function App() {
  const [screen, setScreen] = useState<Screen>("profile");
  const [user, setUser] = useState<User | null>(null);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [avatar, setAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);
  const goToHub = () => setScreen("hub");

  const onSummary = useCallback((s: Summary) => {
    setSummary(s);
    setScreen("summary");
  }, []);

  if (!user || screen === "profile") {
    return (
      <ProfileScreen
        avatar={avatar}
        onAvatarChange={setAvatar}
        onDone={(u) => {
          setUser(u);
          setAvatar(avatarFromUser(u));
          goToHub();
        }}
      />
    );
  }

  switch (screen) {
    case "hub":
      return (
        <HubScreen
          user={user}
          avatar={avatar}
          onAvatarChange={setAvatar}
          onStats={() => setScreen("stats")}
          onSession={(exercise, source) => {
            setActive({ exercise, source });
            setScreen("session");
          }}
        />
      );
    case "stats":
      return <StatsScreen userId={user.id} onBack={goToHub} />;
    case "session":
      return active ? (
        <SessionScreen
          userId={user.id}
          exercise={active.exercise}
          source={active.source}
          avatar={avatar}
          onSummary={onSummary}
          onExit={goToHub}
        />
      ) : null;
    case "summary":
      return summary ? <SummaryScreen summary={summary} onDone={goToHub} /> : null;
  }
}
