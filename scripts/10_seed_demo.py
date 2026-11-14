"""(Re)create demo personas in app_data/hob.db from the real feature tables.

The backend seeds automatically on first start; use this to reset by hand.
Usage:  .venv/Scripts/python scripts/10_seed_demo.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.backend import db, seed  # noqa: E402

if __name__ == "__main__":
    db.init_db()
    with db.get_conn() as conn:
        print(seed.reset(conn))
