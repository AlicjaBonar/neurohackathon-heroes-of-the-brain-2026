import { Modal } from "@/components/ui/Modal";
import { Avatar, type HairColor } from "@/features/avatar/Avatar";
import { HairColorPicker } from "@/features/avatar/HairColorPicker";
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
  hair,
  onHairChange,
}: {
  open: boolean;
  onClose: () => void;
  hair: HairColor;
  onHairChange: (hair: HairColor) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="WYGLĄD"
      title="Zmień awatara"
      description="Wybierz wariant koloru włosów."
      closeLabel="Gotowe"
      className="avatar-modal"
    >
      <div className="avatar-preview">
        <Avatar hair={hair} aura />
      </div>
      <HairColorPicker layout="centered" value={hair} onChange={onHairChange} />
    </Modal>
  );
}
