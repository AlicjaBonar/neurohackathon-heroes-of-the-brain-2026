import { Modal } from "@/components/ui/Modal";
import type { Exercise, User } from "@/api/types";

/** Exercises missing from a dataset's recordings (the session then falls back to the simulator). */
const NOT_RECORDED: Record<string, string[]> = {
  supine: ["resonance_breathing", "short_holds", "hr_recovery"],
  dot: ["hr_recovery"],
};

/** Whether a session of this exercise will play a real fNIRS recording or the simulator. */
function dataSource(user: User | undefined, exercise: Exercise): { real: boolean; text: string } {
  const dataset = user?.is_demo ? user.persona_source?.split("/")[0] : undefined;
  if (!dataset) return { real: false, text: "Simulation" };
  if (NOT_RECORDED[dataset]?.includes(exercise.id))
    return { real: false, text: "Simulation – not in the recordings" };
  return { real: true, text: "Real recording" };
}

export function ActivityModal({
  open,
  onClose,
  exercises,
  onSelect,
  user,
}: {
  open: boolean;
  onClose: () => void;
  exercises: Exercise[];
  user?: User;
  onSelect: (exercise: Exercise) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose an activity"
      description="Each mode sets its own breathing rhythm and fNIRS analysis."
    >
      <div className="activity-choices">
        {exercises.length === 0 && <p>Could not load the exercise list from the backend.</p>}
        {exercises.map((exercise) => {
          const src = dataSource(user, exercise);
          return (
            <button type="button" key={exercise.id} onClick={() => onSelect(exercise)}>
              <div>
                <strong>{exercise.title}</strong>
                <span>{exercise.description}</span>
                <em className={`data-badge ${src.real ? "real" : "sim"}`}>{src.text}</em>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
