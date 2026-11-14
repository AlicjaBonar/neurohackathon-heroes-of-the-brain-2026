import { useState } from "react";
import { DEFAULT_HAIR_COLOR, type HairColor } from "@/features/avatar/Avatar";
import { HubScreen } from "@/features/hub/HubScreen";
import { ProfileScreen } from "@/features/profile/ProfileScreen";
import { SessionScreen } from "@/features/session/SessionScreen";
import { DEFAULT_SESSION_MODE, type SessionMode } from "@/features/session/sessionData";
import { StatsScreen } from "@/features/stats/StatsScreen";

type Screen = "profile" | "hub" | "stats" | "session";

export default function App() {
  const [screen, setScreen] = useState<Screen>("profile");
  const [sessionMode, setSessionMode] = useState<SessionMode>(DEFAULT_SESSION_MODE);
  const [hair, setHair] = useState<HairColor>(DEFAULT_HAIR_COLOR);
  const goToHub = () => setScreen("hub");

  switch (screen) {
    case "profile":
      return <ProfileScreen hair={hair} onHairChange={setHair} onNext={goToHub} />;
    case "hub":
      return (
        <HubScreen
          hair={hair}
          onHairChange={setHair}
          onStats={() => setScreen("stats")}
          onSession={(mode) => {
            setSessionMode(mode);
            setScreen("session");
          }}
        />
      );
    case "stats":
      return <StatsScreen onBack={goToHub} />;
    case "session":
      return <SessionScreen mode={sessionMode} hair={hair} onEnd={goToHub} />;
  }
}
