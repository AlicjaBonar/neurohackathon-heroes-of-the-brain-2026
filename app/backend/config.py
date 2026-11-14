"""Paths and constants. HOB_APP_DATA overrides the data directory (used by tests)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_DATA = Path(os.environ.get("HOB_APP_DATA", ROOT / "app_data"))
DB_PATH = APP_DATA / "hob.db"
TIMELINES = APP_DATA / "timelines"
RESULTS = ROOT / "results"
SCHEMA = Path(__file__).with_name("schema.sql")

PROTOCOL_VERSION = 1
VERSION = "0.1.0"
