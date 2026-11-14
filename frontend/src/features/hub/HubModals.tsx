import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/features/avatar/Avatar";
import type { AvatarConfig } from "@/features/avatar/avatarConfig";
import { AvatarControls } from "@/features/avatar/AvatarControls";
import type { Exercise } from "@/api/types";
import { formatOrdinal } from "@/lib/utils";

const formatMinutes = (seconds: number) => `~${Math.max(1, Math.round(seconds / 60))} min`;

export function ActivityModal({
  open,
  onClose,
  exercises,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  exercises: Exercise[];
  onSelect: (exercise: Exercise) => void;
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
        {exercises.length === 0 && <p>Nie udało się pobrać listy ćwiczeń z backendu.</p>}
        {exercises.map((exercise, index) => (
          <button type="button" key={exercise.id} onClick={() => onSelect(exercise)}>
            <small>{formatOrdinal(index)}</small>
            <div>
              <strong>{exercise.title}</strong>
              <span>{exercise.description}</span>
            </div>
            <b>{formatMinutes(exercise.duration_s)}</b>
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
