# Specyfikacja aplikacji – widoki, API, dane

Aplikacja wellbeing z trenerem oddechu: pomiar → ćwiczenie → pomiar → raport.
Źródłem danych są nagrania fNIRS ze zbiorów hackathonu odtwarzane w czasie rzeczywistym oraz oznaczone symulacje (m.in. ruch: syntetyczne gesty w realnym szumie akcelerometru i żyroskopu z nagrań). **Nie używamy telefonu ani innych czujników zewnętrznych.**
Parametry i ich wiarygodność opisuje [results/EDA_REPORT.md](../results/EDA_REPORT.md).

## 0. Zasady projektowe

1. **Każda wartość ma `source` i `confidence`.**
   - `source`: `real` (z nagrań: fNIRS, akcelerometr, żyroskop), `simulated` (mock) lub `user` (z ankiety).
   - `confidence`: 0–1.
   - UI pokazuje symulacje dyskretną ikoną, a wartości o niskiej pewności wyszarza.
2. **Pokazujemy zmiany względem własnej linii bazowej** („−6 BPM względem Twojej średniej”), a nie normy populacyjne. Wartości bezwzględne fNIRS (µM) są względne i nieporównywalne między osobami.
3. **Fizjologię mierzymy w bezruchu.** W trakcie ruchu backend wysyła `motion.still = false` i wstrzymuje aktualizację tętna i HRV (`hr.frozen = true`).
4. **Przetwarzanie przyczynowe:** okna przesuwne z samymi danymi z przeszłości. Odtwarzanie nagrania zachowuje się wtedy jak prawdziwe urządzenie, a po podłączeniu realnego czujnika zmienia się tylko źródło.
5. **Język wellbeing, nie medyczny:** „regeneracja”, „rezonans”, „tolerancja CO₂”, „forma”. Nigdy „diagnoza”.

## 1. Architektura

```
frontend (web/mobile)  ──REST──►  backend (FastAPI, Python, src/hob)
        ▲   │                         │
        │                             │  źródła: replay SNIRF | mock
        └──────WS (strumień)─────────┘
```

- **Backend:** FastAPI + `src/hob` (wczytywanie, MBLL, tętno, oddech, jakość). Przechowywanie: jeden plik SQLite + pliki JSON z przebiegiem sesji (sekcja 7).
- **Strumień:** jeden WebSocket na sesję, wiadomości JSON z polem `type`.
- **Częstotliwości strumienia:** `frame` 10 Hz (płynna animacja), `vitals` 1 Hz, `quality` co 5 s, zdarzenia natychmiast.

## 2. Widoki

### V1. Onboarding / profil
**Cel:** dane potrzebne do DPF (wiek) i do wzoru Jurca.
- **Formularz:** imię lub pseudonim, rok urodzenia, płeć, wzrost, waga, ankieta aktywności (5 opcji skali Jurca, tekst z [physical_activity_scale.pdf](../infopack/additional_materials/physical_activity_scale.pdf)), opcjonalnie wygląd awatara (kolor włosów i skóry wybierany, nie przewidywany).
- **Endpointy:** `POST /api/users`, `PUT /api/users/{id}`.

### V2. Start (dashboard)
**Cel:** „jak się dziś masz” w 5 sekund.
- **Karta „Gotowość”:** tętno spoczynkowe i RMSSD z ostatniego pomiaru względem średniej z 7 sesji, plus jedno zdanie interpretacji.
- **Karta „Forma”:** szacowane CRF (MET) i jego trend; podpis „wzór Jurca 2005, ankieta + tętno z fNIRS”.
- **Karta „Rekordy”:** najdłuższy bezdech, najlepszy wynik rezonansu.
- **Mini-wykresy (sparkline):** tętno spoczynkowe, RMSSD, wynik rezonansu z ostatnich sesji.
- **Przycisk „Nowa sesja”.**
- **Endpointy:** `GET /api/users/{id}/dashboard`.

### V3. Podłączenie i kontrola sygnału
**Cel:** zbudować zaufanie do pomiaru i wyłapać złe założenie opaski.
- **Wybór źródła:**
  - „Opaska (demo: nagranie)”, czyli lista nagrań,
  - „Symulacja”.
- **Mapa optod:** pozycje 2D z `probe`, kanały pokolorowane statusem: dobry, słaby SCI, przesterowany, ciemny.
- **Wskaźniki:** % dobrych kanałów, widoczność tętna (SCI), poziom ruchu.
- **Komunikaty:** np. „3 kanały przesterowane – dociśnij opaskę”, „za dużo ruchu – usiądź wygodnie”.
- **Bramka:** przycisk „Dalej” aktywny, gdy `quality.ready = true`.
- **Endpointy:** `GET /api/sources`, `POST /api/sessions`, `GET /api/sessions/{id}/probe`, WS `quality`.

### V4. Pomiar spoczynkowy (przed i po ćwiczeniu, 2 min)
**Cel:** linia bazowa i porównanie.
- **Awatar** oddycha zgodnie z `frame.breath.phase`, a serce uderza na każde zdarzenie `beat`.
- **Na żywo:** tętno (duża liczba), RMSSD (pojawia się po 60 s), częstość oddechu (z oznaczeniem pewności), wskaźnik bezruchu.
- **Pasek postępu 2 min.** Ruch go zatrzymuje („pomiar wstrzymany – nie ruszaj się”).
- **Endpointy:** `POST /api/sessions/{id}/phases` (`baseline_pre` / `baseline_post`), WS.

### V5. Wybór ćwiczenia
**Katalog ćwiczeń** z oznaczeniem, co jest mierzone realnie:

| Ćwiczenie | Czas | Mierzone |
|---|---|---|
| Oddech rezonansowy 6/min (wdech 4,5 s, wydech 5,5 s) | 3 × 5 cykli + przerwy (jak SPB) | zgodność rytmu, rezonans, tętno, HRV (`real`) |
| Seria krótkich bezdechów 7 × 10 s | ~5 min | reakcja HbO, odbicie po wdechu (`real`) |
| Bezdech maksymalny (tolerancja CO₂) | do ~2 min | czas, wykrycie końca, reakcja HbO (`real`, detektor w budowie) |
| Wyzwanie ruchowe (kiwnięcia, obroty, przysiady) | 1–2 min | weryfikacja ruchu (`simulated`); weryfikacja bezruchu (`real`) |
| Test powrotu tętna po wysiłku | 2 min po wysiłku | krzywa powrotu (`simulated`) |

- **Endpointy:** `GET /api/exercises`.

### V6. Ćwiczenie: oddech rezonansowy (widok flagowy)
- **Pacer:** kula lub koło unosi się na wdechu i opada na wydechu (`frame.pacer.target_phase`).
- **Nakładka:** linia celu i linia rzeczywistego oddechu z HbO (`frame.breath.signal`). Użytkownik widzi, czy trafia w rytm.
- **Licznik rezonansu 0–100:** rośnie, gdy moc 0,1 Hz rośnie (`vitals.resonance.score`).
- **Zgodność z rytmem:** % i kolor (`vitals.phase_lock`).
- **Tętno na żywo:** w rezonansie widać jego falowanie razem z oddechem (arytmia oddechowa). To efektowny dowód działania ćwiczenia: `frame.hr_instant`.
- **Awatar** oddycha z pacerem, a poświata rośnie z rezonansem.
- **Przerwy między seriami:** „Oddychaj swobodnie”, z odliczaniem.
- **Endpointy:** WS (`frame`, `vitals`, `beat`, `event`).

### V7. Ćwiczenie: bezdech
- **Duży licznik sekund.** Przycisk „Skończyłem” jako zapasowy sygnał od użytkownika.
- **Wykres HbO i HbR na żywo** od startu bezdechu. Krzywa rośnie (`frame.hb`), co wizualnie oddaje narastanie CO₂.
- **Wskaźnik „CO₂”** jako stylizowany pasek zależny od czasu i wzrostu HbO.
- **Automatyczne wykrycie końca:** zdarzenie `hold_end_detected` z pewnością. UI pokazuje „Wykryto wdech po 34 s” i porównanie z przyciskiem.
- **Rekord osobisty** i wynik poprzedni.
- **Endpointy:** `POST /api/sessions/{id}/events` (przycisk), WS.

### V8. Wyzwanie ruchowe
- **Karta polecenia:** np. „Kiwnij głową 3 razy”, z ikoną i animacją awatara.
- **Wykres żyroskopu na żywo** i licznik powtórzeń.
- **Weryfikacja:** ✅ „Zaliczone (3/3)” albo „Spróbuj jeszcze raz”.
- **Potem automatycznie:** „Teraz nie ruszaj się – mierzę regenerację” i przejście do V4 (`baseline_post`).
- **Źródło ruchu:** symulacja (`simulated`). Backend wstawia syntetyczny gest (impuls obrotu dla kiwnięcia lub obrotu głowy, rytmiczne przyspieszenie pionowe dla przysiadów) do **realnego szumu** akcelerometru i żyroskopu z nagrania spoczynkowego, a ten sam detektor, który działałby na prawdziwym czujniku, ocenia wykonanie.
- **Sterowanie w demo:** w trybie demo przyciski „symuluj poprawne wykonanie” / „symuluj błędne wykonanie” (`command simulate_motion`), żeby pokazać jury oba wyniki weryfikacji. Poza trybem demo backend sam symuluje wykonanie po 2–4 s.
- **Realna część:** weryfikacja „nie ruszaj się” po wyzwaniu działa na prawdziwych danych ruchu z nagrania (progi z 68 nagrań RS).
- **Endpointy:** WS (`command simulate_motion`), zdarzenia `command_*`.

### V9. Podsumowanie sesji
- **Przed i po:** tętno, RMSSD, częstość oddechu z różnicą i strzałką.
- **Wynik ćwiczenia:** rezonans (0–100), zgodność rytmu, czas bezdechu.
- **Wykres całej sesji:** tętno i oddech z zaznaczonymi fazami.
- **2–3 spostrzeżenia** generowane z reguł, np. „Po ćwiczeniu tętno spadło o 4 BPM, a HRV wzrosło o 18% – dobra relaksacja” albo „Twój bezdech był o 6 s dłuższy niż ostatnio”.
- **Karta jakości pomiaru:** % dobrych kanałów, czas w ruchu.
- **Endpointy:** `GET /api/sessions/{id}/summary`.

### V10. Postępy
- **Wykresy w czasie:** tętno spoczynkowe, RMSSD, rezonans, bezdech, CRF.
- **Rytm dnia:** wartości wg pory dnia. Realne dane z 4 sesji dziennie w DOT.
- **Endpointy:** `GET /api/users/{id}/history`.

### V11. Tryb demo dla jury (ukryty)
- Wybór persony (osoba z DOT = pełna historia z 4 sesji).
- Przełącznik „pokaż źródła danych” (`real`/`simulated` na każdej karcie).
- **Endpointy:** `GET /api/demo/personas`, `POST /api/demo/personas/{id}/load`.

## 3. Endpointy REST

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/health` | status, wersja |
| POST | `/api/users` | utworzenie profilu |
| GET / PUT | `/api/users/{id}` | profil |
| GET | `/api/users/{id}/dashboard` | dane widoku startowego (V2) |
| GET | `/api/users/{id}/history?metrics=hr_bpm,rmssd_ms,resonance_score,hold_s,crf_mets&phase=before&from=&to=` | serie czasowe (V10); nazwy metryk ze słownika 7.3 |
| GET | `/api/users/{id}/fitness` | karta formy: CRF + składniki |
| GET | `/api/sources` | dostępne źródła: nagrania (filtr `dataset`, `task`), symulacja |
| GET | `/api/exercises` | katalog ćwiczeń z parametrami |
| POST | `/api/sessions` | nowa sesja: użytkownik, źródło, protokół |
| GET | `/api/sessions/{id}` | stan sesji (faza, czasy) |
| GET | `/api/sessions/{id}/probe` | geometria optod do mapy kanałów |
| POST | `/api/sessions/{id}/phases` | start lub koniec fazy (`baseline_pre`, `exercise`, `baseline_post`) |
| POST | `/api/sessions/{id}/events` | zdarzenia od użytkownika (np. `hold_end_button`) |
| POST | `/api/sessions/{id}/finish` | zamknięcie sesji, wyliczenie podsumowania |
| GET | `/api/sessions/{id}/summary` | podsumowanie (V9) |
| GET | `/api/sessions/{id}/timeline?step=1` | cała sesja po fakcie (wykres w V9) |
| GET | `/api/demo/personas` | persony demo |
| POST | `/api/demo/personas/{id}/load` | wypełnienie historii realnymi sesjami z DOT |
| POST | `/api/demo/reset` | usunięcie danych demo (`is_demo = 1`) i ponowne seedowanie (7.6) |

**WebSocket:** `/ws/sessions/{id}` (szczegóły protokołu w sekcji 8.4)
- serwer → klient: `hello`, `frame`, `vitals`, `beat`, `quality`, `event`, `phase`, `error`, `pong`, `end`,
- klient → serwer: `command` (start fazy, symulacja ruchu w demo), opcjonalnie `ping`.

## 4. Modele danych (kontrakt)

### 4.1 Profil

```json
{
  "id": "u_01",
  "name": "Zosia",
  "birth_year": 2002,
  "sex": "F",
  "height_cm": 168,
  "weight_kg": 60,
  "activity_score": 1.76,
  "avatar": { "hair_color": "brown", "skin_tone": 2 },
  "derived": { "age": 24, "bmi": 21.3 }
}
```

### 4.2 Tworzenie sesji

```json
// POST /api/sessions
{
  "user_id": "u_01",
  "source": { "type": "mock", "baseline_s": 120 },
  "protocol": ["baseline_pre", "resonance_breathing", "baseline_post"]
}
// typy źródeł: "replay" | "mock"
```

```json
// odpowiedź
{
  "session_id": "s_8f2a",
  "ws_url": "/ws/sessions/s_8f2a",
  "device": { "fs_hz": 18.27, "n_pairs": 95, "montage": "dot_frontal" },
  "phase": "setup"
}
```

### 4.3 `GET /api/sources`

```json
{
  "recordings": [
    { "id": "dot/03/SPB1", "dataset": "dot", "subject": 3, "task": "SPB", "session": 1,
      "duration_s": 319.6, "fs_hz": 18.27, "has_markers": true, "suggested_for": ["resonance_breathing"] },
    { "id": "supine/10/BH", "dataset": "supine", "subject": 10, "task": "BH",
      "duration_s": 317.8, "fs_hz": 141.79, "has_markers": true, "suggested_for": ["breath_hold"] }
  ],
  "mock": [{ "type": "mock", "label": "Symulacja" }]
}
```

### 4.4 Strumień: `frame` (10 Hz) – płynna animacja

```json
{
  "type": "frame",
  "t": 132.4,
  "breath": { "phase": 0.37, "stage": "inhale", "signal": -0.42, "source": "real", "confidence": 0.8 },
  "pacer": { "target_phase": 0.35, "stage": "inhale" },
  "hb": { "hbo_uM": 0.21, "hbr_uM": -0.03, "source": "real" },
  "hr_instant": 71.8,
  "motion": { "level": 0.12, "still": true, "source": "real" }
}
```

- `breath.phase`: 0 = początek wdechu, 0,5 = szczyt, 1 = koniec wydechu; steruje awatarem.
- `breath.signal`: znormalizowany sygnał oddechowy z HbO (z-score), do nakładki na pacer.
- `pacer` występuje tylko w ćwiczeniu z zadanym rytmem.

### 4.5 Strumień: `beat` (każde uderzenie serca)

```json
{ "type": "beat", "t": 132.71, "ibi_ms": 842, "source": "real" }
```

Frontend animuje serce awatara na każde rzeczywiste uderzenie, a nie z interwału. Dzięki temu widać arytmię oddechową.

### 4.6 Strumień: `vitals` (1 Hz)

```json
{
  "type": "vitals",
  "t": 133.0,
  "hr": { "bpm": 70.4, "window_s": 15, "confidence": 0.95, "frozen": false, "source": "real" },
  "hrv": { "rmssd_ms": 64.0, "sdnn_ms": 71.2, "window_s": 60, "confidence": 0.6, "source": "real" },
  "resp": { "rate_bpm": 6.1, "window_s": 60, "confidence": 0.55, "source": "real" },
  "resonance": { "score": 72, "power_0p1_rel": 0.18, "baseline_rel": 0.093, "source": "real" },
  "phase_lock": { "value": 0.81, "cycles": 9, "source": "real" },
  "vs_baseline": { "hr_delta_bpm": -3.2, "rmssd_delta_pct": 14 }
}
```

- `resonance.score` = 0–100, przeskalowany udział mocy 0,07–0,13 Hz względem linii bazowej osoby. W danych: spoczynek ~0,09, SPB ~0,17.
- `phase_lock` występuje tylko w ćwiczeniu z pacerem.
- Pola z niską pewnością (`confidence` < 0,5) frontend wyszarza.

### 4.7 Strumień: `quality` (co 5 s, w V3 częściej)

```json
{
  "type": "quality",
  "t": 130.0,
  "ready": true,
  "good_pct": 91,
  "sci_median": 0.98,
  "motion_level": "low",
  "channels": [
    { "pair": "S1_D1", "status": "good", "sci": 0.99, "distance_mm": 30.2 },
    { "pair": "S3_D2", "status": "saturated", "sci": -0.08, "distance_mm": 23.4 }
  ],
  "warnings": [{ "code": "saturation", "text": "2 kanały przesterowane – dociśnij opaskę" }]
}
```

Statusy kanału: `good`, `weak` (SCI < 0,7), `saturated` (natężenie przy limicie ~4,99), `dark` (brak światła).

### 4.8 Strumień: `event`

```json
{ "type": "event", "t": 210.3, "name": "hold_end_detected", "confidence": 0.82,
  "data": { "hold_s": 34.1 }, "source": "real" }
```

| `name` | Kiedy |
|---|---|
| `phase_started` / `phase_finished` | zmiana fazy protokołu |
| `cycle` | nowy cykl pacera (`data.index`) |
| `hold_start` / `hold_end_detected` | bezdech |
| `motion_warning` | ruch w fazie pomiaru |
| `command_issued` / `command_verified` / `command_failed` | wyzwanie ruchowe (`data.reps`, `data.target`) |
| `quality_warning` | pogorszenie jakości |

### 4.9 Symulacja ruchu (zamiast czujnika zewnętrznego)

Nie mamy nagrań poleconych ruchów ani telefonu. Wyzwanie ruchowe działa tak:

1. Backend wysyła `event command_issued` (`data.target`: `nod` | `turn_left` | `turn_right` | `squat`, `data.reps`).
2. Generator ruchu bierze **realny** fragment akcelerometru i żyroskopu z nagrania spoczynkowego (szum i drobne ruchy urządzenia) i dodaje syntetyczny gest:
   - kiwnięcie: impuls prędkości kątowej wokół osi poprzecznej (~0,5 s, kształt półsinusa, w obie strony),
   - obrót głowy: impuls wokół osi pionowej,
   - przysiad: oscylacja przyspieszenia pionowego ~0,5 Hz.
   Amplitudy kalibrujemy względem 99. percentyla ruchu w nagraniach RS (jednostki urządzenia są nieopisane).
3. Detektor (progi + liczenie impulsów) ocenia wykonanie i wysyła `command_verified` / `command_failed` z `source: "simulated"`.
4. Klient może wymusić wynik w trybie demo:

```json
{ "type": "command", "action": "simulate_motion", "gesture": "nod", "reps": 3, "correct": true }
```

`correct: false` generuje za mało powtórzeń albo zły kierunek ruchu, żeby pokazać odrzucenie.

Trafność detektora mierzymy offline na wygenerowanych przykładach (wiele gestów w szumie z różnych nagrań).

### 4.10 Podsumowanie sesji (V9)

```json
{
  "session_id": "s_8f2a",
  "exercise": "resonance_breathing",
  "duration_s": 540,
  "before": { "hr_bpm": 72.1, "rmssd_ms": 58, "resp_rate_bpm": 13.5 },
  "after":  { "hr_bpm": 68.3, "rmssd_ms": 69, "resp_rate_bpm": 11.0 },
  "delta":  { "hr_bpm": -3.8, "rmssd_pct": 19, "resp_rate_bpm": -2.5 },
  "scores": { "resonance": 74, "phase_lock": 0.78, "relaxation": 68 },
  "holds": [],
  "quality": { "good_pct": 92, "motion_s": 6 },
  "insights": [
    { "kind": "positive", "text": "Po ćwiczeniu tętno spadło o 4 BPM, a HRV wzrosło o 19%." },
    { "kind": "info", "text": "Najlepiej trafiałaś w rytm w 2. serii." }
  ],
  "sources": { "hr": "real", "hrv": "real", "resonance": "real" }
}
```

- `relaxation` = 0–100, łączy zmianę tętna i RMSSD z wynikiem rezonansu.
- `insights` powstają z prostych reguł progowych. Są w API, żeby frontend tylko je wyświetlał.

### 4.11 Karta formy (`/fitness`)

```json
{
  "crf_mets": 12.4,
  "method": "Jurca 2005: płeć, wiek, BMI, tętno spoczynkowe, ankieta",
  "components": {
    "hr_rest_bpm": { "value": 64, "source": "real" },
    "activity_score": { "value": 1.76, "source": "user" },
    "bmi": { "value": 21.3, "source": "user" }
  },
  "hr_recovery": {
    "drop_1min_bpm": 18, "tau_s": 45, "source": "simulated",
    "note": "symulacja – brak danych z wysiłku w zbiorze"
  },
  "trend": [{ "date": "2026-11-14T09:32", "crf_mets": 12.3 }]
}
```

### 4.12 Historia (V10)

```json
{
  "metrics": {
    "hr_rest": [{ "t": "2026-11-14T09:32", "value": 68.4, "source": "real" }],
    "rmssd":   [{ "t": "2026-11-14T09:32", "value": 88.0, "source": "real" }],
    "resonance": [],
    "hold_s": []
  },
  "baseline": { "hr_rest": 69.1, "rmssd": 82.0 }
}
```

## 5. Skąd dane w demo

| Element | Źródło | Status |
|---|---|---|
| Pomiar spoczynkowy | DOT RS (pierwsze 2 min) lub supine BS | real |
| Oddech rezonansowy | DOT SPB tej samej osoby (pacer zsynchronizowany ze znacznikami 21–28) | real |
| Krótkie bezdechy | DOT BH (znaczniki 71/72) | real |
| Bezdech maksymalny | supine BH (znane końce do walidacji detektora) | real |
| Historia i rytm dnia | 4 sesje RS i SPB z jednego dnia w DOT = persona z 4 „dniami” | real (przemapowane w czasie) |
| Profil persony | `subjects_description.csv` (wiek, płeć, BMI, aktywność) | real |
| Wyzwanie ruchowe | gesty syntetyczne w realnym szumie akcelerometru i żyroskopu (4.9) | simulated |
| Powrót tętna po wysiłku | model wykładniczy z τ zależnym od aktywności | simulated |

**Uwaga:** po ćwiczeniu SPB w danych nie ma osobnego pomiaru spoczynkowego. „Po” bierzemy z ostatnich 20 s pliku SPB albo z następnego RS (godziny później), co trzeba oznaczyć. Druga opcja: `baseline_post` = `simulated` na podstawie zmian zaobserwowanych między RS a SPB.

## 6. Kolejność implementacji

0. **Baza:** `schema.sql` + `db.py` + skrypt seedujący persony (sekcja 7). Daje to od razu dane do V2 i V10, zanim powstanie strumień.
1. **Backend: replay i strumień.** `frame`, `beat`, `vitals` dla RS i SPB w oknach przesuwnych (korzysta z `src/hob/signal.py`).
2. **Frontend:** V4 (pomiar) + V6 (oddech rezonansowy) z awatarem – rdzeń demo.
3. `quality` + V3, potem V9 (podsumowanie z regułami).
4. V7 (bezdech) + detektor końca bezdechu.
5. V2 / V10 (historia z person DOT) + karta formy.
6. V8 (generator gestów + detektor) + symulacja powrotu tętna.

## 7. Baza danych (SQLite)

### 7.1 Założenia

- **Jeden plik** `app_data/hob.db` (SQLite, wbudowany w Pythona). Do tego katalog `app_data/timelines/` z przebiegiem sesji w JSON.
- **Surowe sygnały nie trafiają do bazy.** Nagrania zostają w `data/` (SNIRF). Strumień na żywo trzymamy w pamięci i zapisujemy do pliku dopiero przy `finish`.
- **Do bazy piszemy rzadko:** profil, start i koniec sesji, podsumowanie i metryki. Brak zapisów 10×/s, więc nie ma problemów z wydajnością ani blokadami.
- **Bez migracji:** `schema.sql` z `CREATE TABLE IF NOT EXISTS`. Zmiana schematu oznacza usunięcie pliku i ponowne seedowanie (na hackathon wystarczy).
- **Lokalnie:** `app_data/` w `.gitignore`, bez chmury (licencja danych, dane zdrowotne).

### 7.2 Schemat

```sql
-- app/backend/schema.sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,                -- "u_01", "demo_dot_03"
    name            TEXT NOT NULL,
    birth_year      INTEGER,
    sex             TEXT CHECK (sex IN ('F','M')),
    height_cm       REAL,
    weight_kg       REAL,
    activity_score  REAL CHECK (activity_score IN (0, 0.32, 1.06, 1.76, 3.03)),
    avatar          TEXT,                            -- JSON: {"hair_color": "...", "skin_tone": 2}
    is_demo         INTEGER NOT NULL DEFAULT 0,
    persona_source  TEXT,                            -- np. "dot/03" dla person demo
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,                -- "s_8f2a"
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at      TEXT NOT NULL,                   -- ISO 8601; dla person: realny czas z SNIRF
    finished_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'setup'
                    CHECK (status IN ('setup','running','finished','aborted')),
    exercise        TEXT,                            -- 'resonance_breathing' | 'breath_hold' | 'short_holds' | 'movement' | 'baseline_only'
    source_type     TEXT NOT NULL CHECK (source_type IN ('replay','mock')),
    recording_id    TEXT,                            -- "dot/03/SPB1" (dla replay)
    protocol        TEXT,                            -- JSON: ["baseline_pre","resonance_breathing","baseline_post"]
    summary         TEXT,                            -- JSON: dokładnie odpowiedź GET /summary (4.10)
    timeline_path   TEXT,                            -- "app_data/timelines/s_8f2a.json"
    is_demo         INTEGER NOT NULL DEFAULT 0
);

-- Liczby do historii, dashboardu i rekordów: jeden wiersz = jedna metryka sesji
CREATE TABLE IF NOT EXISTS session_metrics (
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- zdenormalizowane, dla szybkich zapytań
    name            TEXT NOT NULL,                   -- słownik w 7.3
    phase           TEXT NOT NULL DEFAULT 'session'
                    CHECK (phase IN ('before','exercise','after','session')),
    value           REAL NOT NULL,
    source          TEXT NOT NULL CHECK (source IN ('real','simulated','user')),
    confidence      REAL,
    PRIMARY KEY (session_id, name, phase)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_time ON sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_metrics_user_name  ON session_metrics(user_id, name);
```

**Dlaczego trzy tabele:**
- `users` i `sessions` to oczywiste encje.
- `session_metrics` to wąska tabela liczb. Dzięki niej historia, dashboard i rekordy to proste `SELECT … WHERE name = ?` zamiast parsowania JSON. Nowa metryka nie wymaga zmiany schematu.
- Podsumowanie sesji (`summary`) zostaje jako JSON w jednej kolumnie. Frontend dostaje je 1:1, bez składania.

### 7.3 Słownik metryk (`session_metrics.name`)

| name | Jednostka | Faza | Źródło | Skąd (cecha z `src/hob`) |
|---|---|---|---|---|
| `hr_bpm` | BPM | before / after / exercise | real | `hr_beats` |
| `rmssd_ms` | ms | before / after | real | `rmssd_ms` |
| `resp_rate_bpm` | /min | before / after | real (niska pewność) | `resp_rate_bpm` |
| `resonance_score` | 0–100 | exercise | real | z `rel_mayer` / `spb_power_0p1` względem linii bazowej |
| `phase_lock` | 0–1 | exercise | real | `spb_phase_locking` |
| `relaxation_score` | 0–100 | session | real | zmiana tętna i RMSSD + rezonans |
| `hold_s` | s | exercise | real (przycisk lub detektor) | czas bezdechu |
| `hold_hbo_peak_uM` | µM | exercise | real | `hold_hbo_peak` / `short_hold_hbo_peak` |
| `good_pct` | % | session | real | `good_pct` |
| `motion_s` | s | session | real | czas w ruchu |
| `crf_mets` | MET | session | real + user | wzór Jurca (tętno `before` + profil) |
| `hr_recovery_drop_bpm` | BPM | after | simulated | model wykładniczy |
| `reps_verified` | liczba | exercise | simulated | wyzwanie ruchowe (4.9) |

### 7.4 Kto co zapisuje i kiedy

| Moment | Operacja |
|---|---|
| `POST /api/users` | `INSERT users` |
| `POST /api/sessions` | `INSERT sessions` (status `setup`) |
| `POST /api/sessions/{id}/phases` | `UPDATE sessions SET status='running'` przy pierwszej fazie; reszta tylko w pamięci |
| strumień WS | **brak zapisów**; bufor w pamięci (1 próbka/s do przebiegu + zdarzenia) |
| `POST /api/sessions/{id}/finish` | w jednej transakcji: zapis pliku timeline → `UPDATE sessions` (summary, finished_at, status) → `INSERT session_metrics` |
| przerwanie / rozłączenie > 60 s | `UPDATE sessions SET status='aborted'` |

### 7.5 Zapytania dla widoków

```sql
-- V2 dashboard: ostatnia wartość + średnia z 7 poprzednich sesji (linia bazowa)
SELECT m.name, m.value, s.started_at
FROM session_metrics m JOIN sessions s ON s.id = m.session_id
WHERE m.user_id = :uid AND m.name IN ('hr_bpm','rmssd_ms') AND m.phase = 'before'
  AND s.status = 'finished'
ORDER BY s.started_at DESC LIMIT 16;          -- agregacja w Pythonie: [0] = ostatnia, [1:8] = baseline

-- V2 rekordy
SELECT name, MAX(value) AS best FROM session_metrics
WHERE user_id = :uid AND name IN ('hold_s','resonance_score') GROUP BY name;

-- V10 historia (seria czasowa jednej metryki)
SELECT s.started_at AS t, m.value, m.source
FROM session_metrics m JOIN sessions s ON s.id = m.session_id
WHERE m.user_id = :uid AND m.name = :metric AND m.phase = :phase
ORDER BY s.started_at;

-- V10 rytm dnia: średnia wg godziny
SELECT CAST(strftime('%H', s.started_at) AS INTEGER) AS hour, AVG(m.value) AS value, COUNT(*) AS n
FROM session_metrics m JOIN sessions s ON s.id = m.session_id
WHERE m.user_id = :uid AND m.name = 'hr_bpm' AND m.phase = 'before'
GROUP BY hour ORDER BY hour;
```

### 7.5a Plik przebiegu sesji (`app_data/timelines/{session_id}.json`)

Zasila wykres całej sesji w V9 (`GET /api/sessions/{id}/timeline`). Krok 1 s, ~5–15 min, czyli kilkanaście KB.

```json
{
  "session_id": "s_8f2a",
  "step_s": 1,
  "phases": [{ "name": "baseline_pre", "t0": 0, "t1": 120 }, { "name": "resonance_breathing", "t0": 120, "t1": 440 }],
  "series": {
    "t": [0, 1, 2],
    "hr_bpm": [72.1, 71.8, 72.4],
    "breath_signal": [0.1, -0.3, -0.6],
    "resonance_score": [null, null, 31],
    "motion_level": [0.05, 0.04, 0.06]
  },
  "events": [{ "t": 210.3, "name": "hold_end_detected", "confidence": 0.82 }],
  "sources": { "hr_bpm": "real", "breath_signal": "real", "resonance_score": "real" }
}
```

### 7.6 Seedowanie person demo (`scripts/10_seed_demo.py`)

Cel: po starcie aplikacji V2 i V10 od razu mają **realne** dane do pokazania.

1. Dla każdej osoby z DOT (17) tworzymy `users`:
   - `id = demo_dot_XX`, profil z `results/subjects.csv` (wiek → `birth_year`, płeć, wzrost, waga, aktywność),
   - `is_demo = 1`, `persona_source = "dot/XX"`.
2. Dla każdej z 4 par RS → SPB tworzymy sesję `resonance_breathing`:
   - `started_at` = **realny czas nagrania** (`MeasurementDate` + `MeasurementTime` z pliku RS). Dzięki temu rytm dnia w V10 jest prawdziwy (09:30 / 12:00 / 15:00 / 17:30),
   - metryki z `results/features.csv`:
     - `before`: `hr_bpm`, `rmssd_ms`, `resp_rate_bpm` z RS,
     - `exercise`: `hr_bpm`, `resonance_score`, `phase_lock` z SPB,
   - `after`: brak realnego pomiaru (patrz sekcja 5); albo pomijamy, albo wpisujemy z `source = 'simulated'`.
3. Dla 2 sesji BH: sesja `short_holds` z `hold_hbo_peak_uM` (`exercise`).
4. Opcjonalnie persony z supine (60): jedna sesja `breath_hold` z `hold_s` z `results/holds_supine.csv` (znane końce) i `hold_hbo_peak_uM`.
5. `crf_mets` liczony wzorem Jurca dla każdej sesji z `hr_bpm` (`before`).

**Reset demo:** `POST /api/demo/reset` usuwa wiersze z `is_demo = 1` (kaskada usuwa sesje i metryki) i uruchamia seed od nowa. Sesje nagrane na żywo na scenie (`is_demo = 0`) zostają.

### 7.7 Kod

```
app/backend/
  schema.sql
  db.py          # connect() (check_same_thread=False, row_factory=sqlite3.Row), init_db(), transaction()
  repo.py        # create_user, create_session, finish_session(summary, metrics, timeline), get_history, get_dashboard
scripts/10_seed_demo.py
app_data/        # w .gitignore: hob.db, timelines/
```

- **Połączenie:** jedno na żądanie (FastAPI dependency). Zapisy są rzadkie, więc WAL wystarcza na kilka równoległych odczytów.
- **ORM niepotrzebny:** czysty `sqlite3` + kilka funkcji w `repo.py`. `SQLModel` opcjonalnie, jeśli zespół woli modele.
- **Do `.gitignore`:** `app_data/`.

## 8. Komunikacja backend ↔ frontend (React)

### 8.1 Podział i środowisko

| | Backend | Frontend |
|---|---|---|
| Stos | FastAPI (Python 3.12), `src/hob`, SQLite | React + TypeScript + Vite |
| Port (dev) | `localhost:8000` | `localhost:5173` |
| Zadanie | sygnał, metryki, sesje, zapis, symulacja ruchu | widoki, animacja, wykresy |

**Dev bez CORS:** proxy w Vite przekierowuje `/api` i `/ws` na backend, więc frontend używa ścieżek względnych.

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
```

Backend dodatkowo włącza `CORSMiddleware` dla `http://localhost:5173` na wypadek pracy bez proxy.

### 8.2 Kontrakt typów (jedno źródło prawdy)

- **REST:** modele Pydantic w backendzie generują OpenAPI (`/openapi.json`), z którego frontend generuje typy:
  `npx openapi-typescript http://localhost:8000/openapi.json -o src/api/schema.ts`
  Uruchamiać po każdej zmianie API; plik w repo, żeby frontend nie zależał od działającego backendu.
- **WebSocket:** OpenAPI nie opisuje WS. Kontraktem są przykłady JSON z sekcji 4.4–4.8 i typy w `frontend/src/api/stream.ts` (poniżej). Backend buduje te wiadomości w `app/backend/runtime.py` i `mock_source.py`; zmiana formatu = zmiana tutaj i w `stream.ts`.

```ts
// frontend/src/api/stream.ts
export type Source = "real" | "simulated" | "user";

export type FrameMsg = {
  type: "frame"; t: number;
  breath: { phase: number; stage: "inhale" | "exhale" | "hold"; signal: number; source: Source; confidence: number };
  pacer?: { target_phase: number; stage: "inhale" | "exhale" };
  hb: { hbo_uM: number; hbr_uM: number; source: Source };
  hr_instant: number | null;
  motion: { level: number; still: boolean; source: Source };
};
export type BeatMsg    = { type: "beat"; t: number; ibi_ms: number; source: Source };
export type VitalsMsg  = { type: "vitals"; t: number; hr: {...}; hrv: {...}; resp: {...}; resonance?: {...}; phase_lock?: {...}; vs_baseline?: {...} };
export type QualityMsg = { type: "quality"; t: number; ready: boolean; good_pct: number; sci_median: number; channels: Channel[]; warnings: Warning[] };
export type EventMsg   = { type: "event"; t: number; name: EventName; confidence?: number; data?: Record<string, unknown>; source: Source };
export type PhaseMsg   = { type: "phase"; t: number; phase: PhaseName; state: "started" | "finished"; duration_s?: number };
export type HelloMsg   = { type: "hello"; protocol: 1; session_id: string; fs_hz: number };
export type ErrorMsg   = { type: "error"; code: string; message: string; fatal: boolean };
export type EndMsg     = { type: "end"; reason: "finished" | "aborted" | "source_ended"; summary_url: string };

export type ServerMsg = HelloMsg | FrameMsg | BeatMsg | VitalsMsg | QualityMsg | EventMsg | PhaseMsg | ErrorMsg | EndMsg | { type: "pong"; t: number };

export type ClientMsg =
  | { type: "command"; action: "start_phase"; phase: PhaseName }
  | { type: "command"; action: "simulate_motion"; gesture: "nod" | "turn_left" | "turn_right" | "squat"; reps: number; correct: boolean }
  | { type: "ping"; t: number };
```

Pełne pola `vitals`, `quality` i `event` są w sekcji 4. Typy TS mają odpowiadać im 1:1.

### 8.3 REST z React: TanStack Query

Struktura:

```
frontend/src/api/
  client.ts      // fetch z bazowym URL, JSON, mapowanie błędów
  schema.ts      // wygenerowane z OpenAPI
  stream.ts      // typy WS (8.2)
  queries.ts     // hooki useQuery / useMutation
  useSessionStream.ts
```

**Klucze zapytań i odświeżanie:**

| Hook | Klucz | Kiedy odświeżać |
|---|---|---|
| `useUser(id)` | `["user", id]` | po `PUT /users/{id}` |
| `useDashboard(id)` | `["dashboard", id]` | po `finish` sesji |
| `useHistory(id, metrics)` | `["history", id, metrics]` | po `finish` sesji |
| `useFitness(id)` | `["fitness", id]` | po `finish` sesji |
| `useSources()` / `useExercises()` | `["sources"]` / `["exercises"]` | `staleTime: Infinity` (stałe) |
| `useSummary(sid)` | `["summary", sid]` | jednorazowo po `end` |
| `useTimeline(sid)` | `["timeline", sid]` | jednorazowo po `end` |

```ts
// po zakończeniu sesji jedna mutacja unieważnia wszystko, co od niej zależy
export const useFinishSession = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: string) => api.post(`/api/sessions/${sid}/finish`),
    onSuccess: (_, sid) => {
      ["dashboard", "history", "fitness"].forEach(k => qc.invalidateQueries({ queryKey: [k, userId] }));
      qc.prefetchQuery({ queryKey: ["summary", sid], queryFn: () => api.get(`/api/sessions/${sid}/summary`) });
    },
  });
};
```

**Błędy REST:** backend zwraca zawsze `{"error": {"code": "session_not_found", "message": "..."}}` z odpowiednim statusem HTTP (404, 409 itd.). `client.ts` rzuca typowany `ApiError`, a widoki pokazują `message`.

### 8.4 Protokół WebSocket (wersja demo: maksymalnie prosta)

**Połączenie:** `ws://<host>/ws/sessions/{session_id}`; sesja musi istnieć (utworzona przez `POST /api/sessions`).

```
klient                                   serwer
  │──────────── connect ─────────────────►│
  │◄── hello {protocol:1, session_id} ────│   serwer wita się sam, klient nic nie musi wysyłać
  │◄── frame ×10/s, beat, vitals ×1/s, quality ─│   strumień leci od razu (faza "setup")
  │── command start_phase baseline_pre ──►│
  │◄── phase {baseline_pre, started} ─────│
  │◄── phase {baseline_pre, finished} ────│   koniec ogłasza backend
  │── command start_phase <ćwiczenie> ───►│
  │      (REST) POST /sessions/{id}/finish │
  │◄── end {reason:"finished"} + close ───│
```

**Zasady:**
- Serwer wysyła dane co 0,1 s w czasie rzeczywistym. Czas `t` to sekundy od startu sesji.
- Symulacja posuwa się tylko wtedy, gdy jest podłączony klient. Po rozłączeniu i ponownym połączeniu sesja leci dalej od miejsca, w którym stanęła (dostajesz `hello` i, jeśli trwa, aktualną fazę).
- Błędne komendy nie zrywają połączenia: przychodzi `{"type":"error","code":...,"fatal":false}`.
- `ping` jest opcjonalny (odpowiedź `pong` z tym samym `t`).
- Kody zamknięcia: 1000 normalne zakończenie, 4004 brak sesji, 4009 sesja już zakończona.
- Jeden klient na sesję (demo). Bez pauzy, zmiany prędkości i automatycznego przerywania sesji.
- Stan sesji na żywo jest w pamięci serwera: restart backendu kasuje trwające sesje (zakończone są w SQLite).

### 8.5 Hook strumienia i wydajność renderowania

10 wiadomości na sekundę w stanie Reacta oznacza 10 przerysowań całego widoku na sekundę. Dlatego rozdzielamy dane szybkie i wolne:

| Dane | Gdzie trzymamy | Kto czyta |
|---|---|---|
| `frame` (10 Hz), `beat` | `useRef` / zewnętrzny store bez re-renderu (np. Zustand z `subscribe`) | awatar, pacer i wykres na żywo czytają w `requestAnimationFrame` |
| `vitals` (1 Hz), `quality`, `phase` | stan Zustand (selektory) | karty z liczbami, paski |
| `event` | kolejka w store + toast | licznik bezdechu, weryfikacja poleceń |

```ts
// frontend/src/api/useSessionStream.ts (szkic)
export function useSessionStream(sessionId: string | null) {
  const store = useStreamStore();
  useEffect(() => {
    if (!sessionId) return;
    const ws = new WebSocket(`ws://${location.host}/ws/sessions/${sessionId}`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMsg;
      switch (msg.type) {
        case "frame":   store.pushFrame(msg); break;          // bez re-renderu
        case "beat":    store.pushBeat(msg); break;           // awatar: puls serca
        case "vitals":  store.setVitals(msg); break;          // re-render kart 1×/s
        case "quality": store.setQuality(msg); break;
        case "phase":   store.setPhase(msg); break;
        case "event":   store.pushEvent(msg); break;
        case "error":   store.setError(msg); break;
        case "end":     store.setEnded(msg); break;
      }
    };
    store.setSend((m: ClientMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)));
    return () => ws.close();
  }, [sessionId]);
}
```

- **Bufor** w store: ostatnie 60 s ramek (600 elementów) na wykres na żywo w V6 i V7.
- **Wykres na żywo:** canvas (np. `uPlot` albo własny canvas) odświeżany w `requestAnimationFrame`. Nie SVG z setkami punktów przez React.
- **Animacja awatara:** interpolacja między ostatnimi dwiema ramkami po `t` (płynne 60 fps przy danych 10 Hz).

### 8.6 Przepływ widoków i wywołań

| Krok (widok) | REST | WS |
|---|---|---|
| V1 profil | `POST /users` | — |
| V2 start | `GET /users/{id}/dashboard`, `/fitness` | — |
| „Nowa sesja” → V5 | `GET /exercises`, `GET /sources` | — |
| V3 kontrola sygnału | `POST /sessions`, `GET /sessions/{id}/probe` | połączenie, `hello`, `quality` |
| V4 pomiar przed | — | `start_phase baseline_pre`, `frame`, `beat`, `vitals` |
| V6 / V7 / V8 ćwiczenie | `POST /sessions/{id}/events` (przycisk „Skończyłem”) | `start_phase <ćwiczenie>`, `event`, w V8 `command simulate_motion` (demo) |
| V4 pomiar po | — | `start_phase baseline_post` |
| V9 podsumowanie | `POST /sessions/{id}/finish`, `GET /summary`, `GET /timeline` | `end`, rozłączenie |
| V10 postępy | `GET /users/{id}/history` | — |

Routing (React Router): `/onboarding`, `/`, `/exercises`, `/session/:sid/setup`, `/session/:sid/live`, `/session/:sid/summary`, `/progress`, `/demo`.
Widok `/session/:sid/live` przełącza się sam na podstawie `phase` ze strumienia. Frontend nie musi pilnować czasów faz.

### 8.7 Praca równoległa: frontend bez gotowego backendu

1. **Najpierw kontrakt:** typy z 8.2 i przykłady JSON z sekcji 4 są gotowe od razu. Frontend startuje od nich.
2. **REST:** MSW (Mock Service Worker) z odpowiedziami z sekcji 4 w `frontend/src/mocks/`. Wyłączany flagą `VITE_USE_MOCKS=false`.
3. **WS:** backend ma od początku źródło `mock` (generator: sinusoida oddechu 6/min, tętno 70 ± arytmia oddechowa, zdarzenia co kilkanaście sekund). To pierwsza rzecz do zrobienia w backendzie (~1 h). Wtedy frontend od razu łączy się z prawdziwym serwerem WS, a podmiana na replay nagrań nic nie zmienia po stronie Reacta.
4. **Nagrania strumienia:** backend zapisuje 2–3 przykładowe sesje WS do plików `.jsonl` (`frontend/src/mocks/streams/`). Frontend może je odtwarzać lokalnie, przydatne do testów UI offline i jako plan B na scenie.

### 8.8 Plan B na demo

- Backend padnie → frontend odtwarza nagraną sesję `.jsonl` (8.7, pkt 4) z tym samym hookiem (`VITE_STREAM_SOURCE=file`).
- Persony i historia są w SQLite, a `POST /api/demo/reset` przywraca stan sprzed prezentacji.
