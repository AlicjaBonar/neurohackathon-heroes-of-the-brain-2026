import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/features/avatar/Avatar";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import { AvatarControls } from "@/features/avatar/AvatarControls";
import { SESSION_MODES, type SessionMode } from "@/features/session/sessionData";
import { formatOrdinal } from "@/lib/utils";

export function ActivityModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (mode: SessionMode) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="NOWA SESJA"
      title="Wybierz aktywność"
      description="Każdy tryb dostosowuje rytm oddechu i analizę fNIRS."
    >
      <div className="activity-choices">
        {SESSION_MODES.map((mode, index) => (
          <button type="button" key={mode.title} onClick={() => onSelect(mode)}>
            <small>{formatOrdinal(index)}</small>
            <div>
              <strong>{mode.title}</strong>
              <span>{mode.description}</span>
            </div>
            <b>{mode.duration}</b>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function AvatarModal({
  open,
  onClose,
  avatar,
  onAvatarChange,
}: {
  open: boolean;
  onClose: () => void;
  avatar: AvatarConfig;
  onAvatarChange: (avatar: AvatarConfig) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="WYGLĄD"
      title="Zmień awatara"
      description="Ustaw płeć oraz rodzaj, długość i kolor włosów."
      closeLabel="Gotowe"
      className="avatar-modal"
    >
      <div className="avatar-preview">
        <Avatar avatar={avatar} aura interactive />
      </div>
      <AvatarControls layout="centered" avatar={avatar} onChange={onAvatarChange} />
    </Modal>
  );
}
