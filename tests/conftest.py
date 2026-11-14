import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# isolated database for tests - must be set before app.backend.config is imported
os.environ["HOB_APP_DATA"] = tempfile.mkdtemp(prefix="hob_test_")


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from app.backend.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def user(client):
    r = client.post("/api/users", json=dict(name="Test", birth_year=2000, sex="F", height_cm=168,
                                            weight_kg=60, activity_score=1.76))
    assert r.status_code == 201, r.text
    return r.json()
