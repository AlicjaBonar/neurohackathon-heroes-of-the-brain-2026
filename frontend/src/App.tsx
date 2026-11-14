import { useCallback, useState } from "react";
import type { Exercise, SourceIn, Summary, User } from "@/api/types";
import { DEFAULT_HAIR_COLOR, HAIR_COLORS, type HairColor } from "@/features/avatar/Avatar";
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
  const [hair, setHair] = useState<HairColor>(DEFAULT_HAIR_COLOR);
  const goToHub = () => setScreen("hub");

  const onSummary = useCallback((s: Summary) => {
    setSummary(s);
    setScreen("summary");
  }, []);

  if (!user || screen === "profile") {
    return (
      <ProfileScreen
        hair={hair}
        onHairChange={setHair}
        onDone={(u) => {
          setUser(u);
          const saved = u.avatar?.hair_color;
          if (saved && saved in HAIR_COLORS) setHair(saved as HairColor);
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
          hair={hair}
          onHairChange={setHair}
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
          hair={hair}
          onSummary={onSummary}
          onExit={goToHub}
        />
      ) : null;
    case "summary":
      return summary ? <SummaryScreen summary={summary} onDone={goToHub} /> : null;
  }
}
