# Heroes of the Brain 2026 – Breath, Brain & Body

Wczytywanie i eksploracja danych fNIRS (Cortivision) z dwóch zbiorów:
`dot_montage_sitting` (17 osób, 190 kanałów, 18,27 Hz) oraz
`fnirs_high_freq_supine` (60 osób, 20 kanałów, 141,79 Hz).
Opis wyzwania i zbiorów: [infopack/](infopack/). Wyniki eksploracji: [results/EDA_REPORT.md](results/EDA_REPORT.md).

> Dane wolno wykorzystywać wyłącznie podczas hackathonu (13–15.11.2026). Folder `data/` jest w `.gitignore`.

## Środowisko

```bash
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

Dane muszą leżeć w:

```
data/dot_montage_sitting/{subjects_description.csv, data/{RS,SPB,BH}/*.snirf}
data/fnirs_high_freq_supine/{subjects_description.csv, data/{baseline,BH}/*.snirf}
```

## Uruchomienie

```bash
.venv/Scripts/python scripts/00_inspect_snirf.py      # struktura HDF5 przykładowych plików
.venv/Scripts/python scripts/01_extract_features.py   # cechy ze wszystkich 288 plików (~1 min)
.venv/Scripts/python scripts/02_explore.py            # wykresy + tabele + summary.json
.venv/Scripts/python scripts/03_predictability.py     # korelacje cząstkowe + predykcja LOSO (~15 min)
```

## Backend aplikacji (FastAPI + SQLite + WebSocket z mockiem)

Specyfikacja: [docs/APP_SPEC.md](docs/APP_SPEC.md).

```bash
.venv/Scripts/python -m uvicorn app.backend.main:app --reload --port 8000
# dokumentacja REST: http://localhost:8000/docs
.venv/Scripts/python -m pytest tests -q          # testy (~10 s)
.venv/Scripts/python scripts/10_seed_demo.py     # reset person demo (robi się też samo przy 1. starcie)
```

| Plik | Rola |
|---|---|
| `app/backend/main.py` | endpointy REST + WebSocket `/ws/sessions/{id}` |
| `app/backend/runtime.py` | stan sesji na żywo (w pamięci), fazy, podsumowanie |
| `app/backend/mock_source.py` | symulator sygnału (oddech, tętno, HbO, ruch, bezdech) |
| `app/backend/exercises.py` | katalog ćwiczeń i ich przebieg |
| `app/backend/seed.py` | persony demo z prawdziwych wyników (`results/*.csv`) |
| `app/backend/db.py`, `repo.py`, `schema.sql` | SQLite (`app_data/hob.db`) |

Szybki przepływ: `POST /api/users` → `POST /api/sessions` → WebSocket → `{"type":"command","action":"start_phase","phase":"baseline_pre"}` → … → `POST /api/sessions/{id}/finish` → `GET /api/sessions/{id}/summary`.

## Biblioteka `src/hob`

| Moduł | Zawartość |
|---|---|
| `io.py` | `load_snirf(path)` → `Recording` (natężenie, kanały z odległościami, znaczniki, akcelerometr/żyroskop, brakujące próbki, pozycje optod); `list_files(dataset)` – inwentarz plików z ID osoby, zadaniem i sesją |
| `subjects.py` | `load_subjects("dot"/"supine")` – oczyszczone metryczki: angielskie nazwy kolumn, skale liczbowe włosów (0–4), Fitzpatrick 1–6, BMI, leki |
| `signal.py` | OD, prawo Beera-Lamberta z DPF zależnym od wieku, SCI, filtry, widma, tętno, detekcja uderzeń, HRV, szablon fali tętna, częstość oddechu, metryki ruchu, epoki |
| `features.py` | `process_file(row, age)` – komplet cech z jednego nagrania + uśrednione odpowiedzi na zdarzenia |

Przykład:

```python
import sys; sys.path.insert(0, "src")
from hob.io import list_files, load_snirf
from hob.subjects import load_subjects
from hob import signal as S

files = list_files("supine")
rec = load_snirf(files.path[0])
od760, od850 = S.optical_density(rec.wl(760)), S.optical_density(rec.wl(850))
hbo, hbr = S.mbll(od760, od850, rec.pair_table().distance_mm.values, age=23)
acc, gyro = S.split_aux(rec.aux)
```

## Wyniki (`results/`)

| Plik | Zawartość |
|---|---|
| `features.csv` | 1 wiersz na nagranie, ~90 cech |
| `channels.csv` | 1 wiersz na parę źródło–detektor w każdym nagraniu (natężenie, SCI, przesterowanie) |
| `holds_supine.csv` | każdy bezdech w zbiorze supine z czasem trwania |
| `subjects.csv` | oczyszczone metryczki obu zbiorów |
| `tables/*.csv` | statystyki, korelacje, predykcja |
| `figures/*.png` | wykresy |
| `EDA_REPORT.md` | podsumowanie wniosków |
