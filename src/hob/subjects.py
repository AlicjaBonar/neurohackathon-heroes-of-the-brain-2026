"""Loading and cleaning subjects_description.csv of both datasets.

Both CSVs have Polish column names, decimal commas and inconsistent values
(Polish/English mixed, typos, trailing spaces). Everything is normalised to
English column names and ordinal scales from infopack/additional_materials:

hair_color   (Fischer-Saller): 0 none, 1 grey/white, 2 blonde, 3 brown, 4 red/black
hair_type    (Andre Walker):   0 none, 1 straight, 2 wavy, 3 curly, 4 kinky
hair_texture (FIA):            0 none, 1 fine, 2 medium, 3 coarse
fitzpatrick:                   1..6
activity     (Jurca 2005):     0, 0.32, 1.06, 1.76, 3.03
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

from . import DOT_DIR, SUP_DIR

HAIR_COLOR = {
    "brak": 0, "no hair": 0, "none": 0,
    "siwe": 1, "grey": 1, "gray": 1, "white": 1,
    "blond": 2, "blonde": 2, "ciemny blond": 2,
    "brown": 3, "brązowe": 3, "brazowe": 3, "brażowe": 3,
    "black": 4, "czarne": 4, "red": 4, "rude": 4,
}
HAIR_COLOR_NAME = {0: "none", 1: "grey", 2: "blonde", 3: "brown", 4: "black/red"}
HAIR_TYPE = {"brak": 0, "no hair": 0, "straight": 1, "straigth": 1, "wavy": 2,
             "curly": 3, "kinky": 4}
HAIR_TEXTURE = {"brak": 0, "no hair": 0, "fine": 1, "medium": 2, "coarse": 3}
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6}


def _num(s: pd.Series) -> pd.Series:
    """'56,5' / '2,5km/h' / '3.2 km/h' -> float."""
    def conv(v):
        if pd.isna(v):
            return np.nan
        m = re.search(r"[-+]?\d+(?:[.,]\d+)?", str(v))
        return float(m.group(0).replace(",", ".")) if m else np.nan
    return s.map(conv)


def _map(s: pd.Series, table: dict) -> pd.Series:
    def conv(v):
        if pd.isna(v):
            return np.nan
        key = str(v).strip().lower()
        if key not in table:
            raise ValueError(f"Unknown category value: {v!r}")
        return table[key]
    return s.map(conv)


def _common(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    out["age"] = _num(df["Wiek"])
    out["height_cm"] = _num(df["Wzrost"])
    out["weight_kg"] = _num(df["Waga"])
    out["bmi"] = out.weight_kg / (out.height_cm / 100) ** 2
    out["hair_color"] = _map(df["Kolor włosów"], HAIR_COLOR)
    out["hair_color_name"] = out.hair_color.map(HAIR_COLOR_NAME)
    out["hair_type"] = _map(df["Typ włosów"], HAIR_TYPE)
    out["hair_texture"] = _map(df["Tekstura włosów"], HAIR_TEXTURE)
    out["fitzpatrick"] = df["Fitzpatrick"].str.strip().map(ROMAN)
    out["head_circ_cm"] = _num(df["Rozmiar głowy"])
    out["activity"] = _num(df["Ocena aktywności fizycznej"])
    out["treadmill_kmh"] = _num(df["Prędkość bieżni"])
    meds = df["Przyjmowane leki"].fillna("-").str.strip()
    out["medication"] = meds.where(meds != "-", "")
    out["has_medication"] = out.medication != ""
    return out


def load_dot_subjects() -> pd.DataFrame:
    df = pd.read_csv(DOT_DIR / "subjects_description.csv", dtype=str)
    out = _common(df)
    out.insert(0, "subject", df["ID"].astype(int))
    out.insert(1, "sex", df["Płeć"].str.strip().map({"K": "F", "M": "M"}))
    out["cap_size"] = _num(df["Rozmiar czepka"])
    dis = df["Choroby przewlekłe"].fillna("-").str.strip()
    out["chronic_disease"] = dis.where(dis != "-", "")
    out.insert(0, "dataset", "dot")
    return out


def load_supine_subjects() -> pd.DataFrame:
    df = pd.read_csv(SUP_DIR / "subjects_description.csv", dtype=str)
    out = _common(df)
    out.insert(0, "subject", df["Nr osoby badanej"].astype(int))
    out.insert(1, "sex", df["Płeć"].str.strip().map({"Kobieta": "F", "Mężczyzna": "M"}))
    out["group"] = _num(df["Grupa"])
    # medication that may affect haemodynamics (DATASET_DESCRIPTION)
    m = out.medication.str.lower()
    out["vasoactive_med"] = m.str.contains("nadcisnienia|nebilet")
    out.insert(0, "dataset", "supine")
    return out


def load_subjects(dataset: str) -> pd.DataFrame:
    return {"dot": load_dot_subjects, "supine": load_supine_subjects}[dataset]()
