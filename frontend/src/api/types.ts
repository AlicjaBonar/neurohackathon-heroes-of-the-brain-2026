/** Contract with the backend (docs/APP_SPEC.md sections 3-4 and 8.2). */

export type Source = "real" | "simulated" | "user";

// ---------------------------------------------------------------- users

export type Avatar = {
  hair_color?: string | null;
  hair_texture?: string | null;
  hair_length?: string | null;
  skin_tone?: number | null;
};

export type UserIn = {
  name: string;
  birth_year?: number | null;
  sex?: "F" | "M" | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  activity_score?: number | null;
  avatar?: Avatar | null;
};

export type User = UserIn & {
  id: string;
  is_demo: boolean | number;
  persona_source: string | null;
  derived: { age: number | null; bmi: number | null };
};

export type Persona = {
  id: string;
  name: string;
  source: string | null;
  sex: "F" | "M" | null;
  age: number | null;
  bmi: number | null;
  activity_score: number | null;
  avatar: Avatar | null;
  n_sessions: number;
};

// ---------------------------------------------------------------- dashboard / history

export type SeriesPoint = { t: string; value: number; source?: Source; session_id?: string };

export type Readiness = {
  value: number;
  t: string;
  source: Source;
  baseline: number | null;
  delta: number | null;
};

export type Dashboard = {
  user: { id: string; name: string; avatar: Avatar | null };
  readiness: { hr_rest: Readiness | null; rmssd: Readiness | null; text: string | null };
  fitness: { crf_mets: number | null; trend: SeriesPoint[]; method: string };
  records: {
    hold_s: { value: number; t: string; source: Source } | null;
    resonance_score: { value: number; t: string; source: Source } | null;
  };
  sparklines: Record<string, SeriesPoint[]>;
  last_sessions: { id: string; started_at: string; exercise: string; status: string }[];
};

export type History = {
  metrics: Record<string, SeriesPoint[]>;
  baseline: Record<string, number | null>;
};

// ---------------------------------------------------------------- exercises / sessions

export type Exercise = {
  id: string;
  title: string;
  description: string;
  duration_s: number;
  measures: { name: string; label: string; source: Source }[];
};

export type SourceIn = { type: "mock" | "replay"; recording_id?: string | null; baseline_s?: number };

export type SessionCreated = {
  session_id: string;
  ws_url: string;
  device: { fs_hz: number; n_pairs: number; montage: string; source: string };
  recording_id: string | null;
  phase: string;
  protocol: string[];
  exercise: string;
};

export type Insight = { kind: "positive" | "info" | "tip"; text: string };

type Stats = { hr_bpm: number | null; rmssd_ms: number | null; resp_rate_bpm: number | null };

export type Summary = {
  session_id: string;
  exercise: string;
  duration_s: number;
  before: Stats | null;
  after: Stats | null;
  delta: { hr_bpm: number | null; rmssd_pct: number | null; resp_rate_bpm: number | null } | null;
  exercise_stats: { hr_bpm: number | null } | null;
  scores: { resonance?: number; phase_lock?: number | null; relaxation?: number } | null;
  holds: { t: number; hold_s: number; by: string; hbo_rise_uM: number; confidence: number }[];
  movement: { target: string; reps: number; detected_reps: number; verified: boolean }[];
  recovery: { drop_1min_bpm: number; source: Source } | null;
  crf_mets: number | null;
  quality: { good_pct: number | null; motion_s: number; measured_s: number };
  insights: Insight[];
  sources: Record<string, Source>;
};

// ---------------------------------------------------------------- WebSocket stream

/** Live HbO/HbR incl. the cardiac pulse (0.005–2.5 Hz) and their trend without it (0.005–0.5 Hz). */
export type HbValues = { hbo_uM: number; hbr_uM: number; hbo_trend_uM?: number; hbr_trend_uM?: number };

export type FrameMsg = {
  type: "frame";
  t: number;
  breath: { phase: number; stage: "inhale" | "exhale" | "hold"; signal: number; source: Source; confidence: number };
  pacer?: { target_phase: number; stage: "inhale" | "exhale" };
  /** Mean of the good long channels, plus the strongest single channel. */
  hb: HbValues & { n_channels?: number; best?: HbValues & { pair: string; label: string; sci: number }; source: Source };
  hr_instant?: number | null;
  motion: { level: number; still: boolean; source: Source };
};

export type VitalsMsg = {
  type: "vitals";
  t: number;
  hr: { bpm: number | null; window_s: number; confidence: number; frozen: boolean; source: Source };
  hrv: { rmssd_ms: number | null; sdnn_ms?: number | null; window_s: number; confidence: number; source: Source };
  resp: { rate_bpm: number | null; window_s: number; confidence: number; source: Source };
  resonance: { score: number; power_0p1_rel?: number; baseline_rel?: number; source: Source };
  phase_lock?: { value: number; cycles: number; source: Source };
  vs_baseline?: { hr_delta_bpm?: number; rmssd_delta_pct?: number };
};

export type ChannelStatus = "good" | "weak" | "saturated" | "dark";

export type ChannelQuality = { pair: string; status: ChannelStatus; sci: number; distance_mm: number };

export type QualityMsg = {
  type: "quality";
  t: number;
  ready: boolean;
  good_pct: number;
  channels?: ChannelQuality[];
  warnings: { code: string; text: string }[];
};

/** Per-pair HbO/HbR for the brain map (2 Hz); index i = probe.pairs[i]; null = bad channel. */
export type ChannelsMsg = {
  type: "channels";
  t: number;
  hbo: (number | null)[];
  hbr: (number | null)[];
  scale_uM: number;
  source: Source;
};

type Vec3 = [number, number, number];

export type ProbePair = {
  index: number;
  pair: string;
  source: number;
  detector: number;
  distance_mm: number;
  short: boolean;
  /** Nearest 10-10 position. */
  label: string;
  /** Top view, head unit circle (Cz = 0,0; nose up). */
  x: number;
  y: number;
  pos3d: Vec3;
  normal: Vec3;
  /** Same point 15 mm deep, where fNIRS is most sensitive. */
  cortex3d: Vec3;
};

export type Optode = { id: number; x: number; y: number; pos3d: Vec3 };

/** Optode geometry, GET /api/sessions/{id}/probe (docs 4.7a). Units mm; x right, y nose, z up. */
export type Probe = {
  montage: string;
  sources: Optode[];
  detectors: Optode[];
  landmarks: { label: string; x: number; y: number; pos3d: Vec3 }[];
  head3d: { ellipsoid_radii_mm: Vec3; cortex_depth_mm: number; points: { label: string; pos3d: Vec3 }[] };
  pairs: ProbePair[];
};

export type EventMsg = {
  type: "event";
  t: number;
  name: string;
  confidence?: number;
  data?: Record<string, unknown>;
  source?: Source;
};

export type PhaseMsg = {
  type: "phase";
  t: number;
  phase: string;
  state: "started" | "finished";
  duration_s?: number | null;
};

export type ServerMsg =
  | { type: "hello"; protocol: number; session_id: string; fs_hz: number }
  | FrameMsg
  | { type: "beat"; t: number; ibi_ms: number; source: Source }
  | VitalsMsg
  | QualityMsg
  | ChannelsMsg
  | EventMsg
  | PhaseMsg
  | { type: "error"; code: string; message: string; fatal: boolean }
  | { type: "pong"; t: number }
  | { type: "end"; reason: "finished" | "aborted" | "source_ended"; summary_url: string };

export type ClientMsg =
  | { type: "command"; action: "start_phase"; phase: string }
  | {
      type: "command";
      action: "simulate_motion";
      gesture: string;
      reps: number;
      correct: boolean;
    }
  | { type: "ping"; t: number };
