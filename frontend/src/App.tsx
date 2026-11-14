import { useState } from "react";
import { DEFAULT_AVATAR, type AvatarConfig } from "@/features/avatar/avatarConfig";
import { HubScreen } from "@/features/hub/HubScreen";
import { ProfileScreen } from "@/features/profile/ProfileScreen";
import { SessionScreen } from "@/features/session/SessionScreen";
import { DEFAULT_SESSION_MODE, type SessionMode } from "@/features/session/sessionData";
import { StatsScreen } from "@/features/stats/StatsScreen";

type Screen = "profile" | "hub" | "stats" | "session";

export default function App() {
  const [screen, setScreen] = useState<Screen>("profile");
  const [sessionMode, setSessionMode] = useState<SessionMode>(DEFAULT_SESSION_MODE);
  const [avatar, setAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);
  const goToHub = () => setScreen("hub");

  switch (screen) {
    case "profile":
      return <ProfileScreen avatar={avatar} onAvatarChange={setAvatar} onNext={goToHub} />;
    case "hub":
      return (
        <HubScreen
          avatar={avatar}
          onAvatarChange={setAvatar}
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
      return <SessionScreen mode={sessionMode} avatar={avatar} onEnd={goToHub} />;
  }
}
