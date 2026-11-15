# Heroes of the Brain 2026 – Breath, Brain & Body

Loading and exploring fNIRS data (Cortivision) from two datasets:
`dot_montage_sitting` (17 subjects, 190 channels, 18.27 Hz) and
`fnirs_high_freq_supine` (60 subjects, 20 channels, 141.79 Hz).
Challenge and dataset descriptions: [infopack/](infopack/). Exploration results: [results/EDA_REPORT.md](results/EDA_REPORT.md).

> The data may only be used during the hackathon (Nov 13–15, 2026). The `data/` folder is in `.gitignore`.

## Environment

```bash
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

The data must be located in:

```
data/dot_montage_sitting/{subjects_description.csv, data/{RS,SPB,BH}/*.snirf}
data/fnirs_high_freq_supine/{subjects_description.csv, data/{baseline,BH}/*.snirf}
```

## Running

```bash
.venv/Scripts/python scripts/00_inspect_snirf.py      # HDF5 structure of sample files
.venv/Scripts/python scripts/01_extract_features.py   # features from all 288 files (~1 min)
.venv/Scripts/python scripts/02_explore.py            # plots + tables + summary.json
.venv/Scripts/python scripts/03_predictability.py     # partial correlations + LOSO prediction (~15 min)
# optional: independent MNE cross-check in Cedalion (separate environment OUTSIDE the repo, see script header)
%USERPROFILE%/.venvs/hob-cedalion/Scripts/python scripts/04_crosscheck_cedalion.py
```

## Application Backend (FastAPI + SQLite + WebSocket with mock)

Specification: [docs/APP_SPEC.md](docs/APP_SPEC.md).

```bash
.venv/Scripts/python -m uvicorn app.backend.main:app --reload --port 8000
# REST documentation: http://localhost:8000/docs
.venv/Scripts/python -m pytest tests -q          # tests (~10 s)
.venv/Scripts/python scripts/10_seed_demo.py     # reset demo personas (also runs automatically on 1st startup)
```

| File | Role |
|---|---|
| `app/backend/main.py` | REST endpoints + WebSocket `/ws/sessions/{id}` |
| `app/backend/runtime.py` | live session state (in memory), phases, summary |
| `app/backend/mock_source.py` | signal simulator (breathing, heart rate, HbO, motion, breath-hold) |
| `app/backend/replay.py` | playback of real SNIRF recordings of the same subject (requires `data/`) |
| `app/backend/exercises.py` | exercise catalog and workflow |
| `app/backend/seed.py` | demo personas generated from real results (`results/*.csv`) |
| `app/backend/db.py`, `repo.py`, `schema.sql` | SQLite (`app_data/hob.db`) |

Session data sources (`POST /api/sessions`, `source` field):
- `{"type": "mock"}`: simulator, works everywhere;

- `{"type": "replay"}` for a demo persona (e.g., `user_id: "demo_dot_03"`) or `{"type": "replay", "recording_id": "dot/03"}`: real recordings of that subject. DOT: baseline measurement, slow-paced/resonant breathing (SPB), short and maximum breath-hold; supine: baseline measurement and breath-hold. Motion and heart rate recovery always come from the mock.


Quick flow: `POST /api/users` → `POST /api/sessions` → WebSocket → `{"type":"command","action":"start_phase","phase":"baseline_pre"}` → … → `POST /api/sessions/{id}/finish` → `GET /api/sessions/{id}/summary`.

## `src/hob` Library

| Module | Contents |
|---|---|
| `io.py` | `load_snirf(path)` → `Recording` (intensity, channels with distances, markers, accelerometer/gyroscope, missing samples, optode positions); `list_files(dataset)` – inventory of files with subject ID, task, and session |
| `subjects.py` | `load_subjects("dot"/"supine")` – cleaned demographic/subject metadata: English column names, numerical hair scales (0–4), Fitzpatrick 1–6, BMI, medications |
| `pipeline.py` | **standard processing**: MNE-Python (OD, SCI, TDDR, Beer-Lambert with age-dependent DPF) + NeuroKit2 (heartbeats, HRV, respiratory rate); `hemo(rec, age)`, `beats`, `hrv`, `resp_rate` |
| `signal.py` | OD, Beer-Lambert law with age-dependent DPF, SCI, filters, spectra, heart rate, beat detection, HRV, pulse wave template, respiratory rate, motion metrics, epochs |
| `features.py` | `process_file(row, age)` – full feature set from a single recording + event-averaged responses |

Example:

```python
import sys; sys.path.insert(0, "src")
from hob.io import list_files, load_snirf
from hob import pipeline as P, signal as S

files = list_files("supine")
rec = load_snirf(files.path[0])
H = P.hemo(rec, age=23)                 # MNE: OD -> SCI -> TDDR -> Beer-Lambert; H.hbo, H.hbr [uM], H.sci
beats = P.beats(H.hbo, H.fs)            # NeuroKit2
print(P.hrv(beats))                     # HR, RMSSD, SDNN
acc, gyro = S.split_aux(rec.aux)
```

## Results (`results/`)

| File | Contents |
|---|---|
| `features.csv` | 1 row per recording, ~90 features |
| `channels.csv` | 1 row per source–detector pair in each recording (intensity, SCI, saturation/clipping) |
| `holds_supine.csv` | every breath-hold in the supine dataset with duration |
| `subjects.csv` | cleaned demographic/subject metadata for both datasets |
| `tables/*.csv` | statistics, correlations, prediction |
| `figures/*.png` | plots |
| `EDA_REPORT.md` | summary of findings |
