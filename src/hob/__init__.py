"""Heroes of the Brain 2026 - fNIRS data loading and exploration helpers."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RESULTS = ROOT / "results"
DOT_DIR = DATA / "dot_montage_sitting"
SUP_DIR = DATA / "fnirs_high_freq_supine"
