"""Backend tests: REST, a short real-time WebSocket session, exercise logic, demo seed."""
import pytest
from starlette.websockets import WebSocketDisconnect

from app.backend import db, repo, runtime, seed


def new_session(client, user, protocol, baseline_s=2):
    r = client.post("/api/sessions", json=dict(user_id=user["id"], protocol=protocol,
                                               source=dict(type="mock", baseline_s=baseline_s)))
    assert r.status_code == 201, r.text
    return r.json()["session_id"]


def wait_for(ws, pred, limit=2000):
    for _ in range(limit):
        m = ws.receive_json()
        if m["type"] == "error":
            raise AssertionError(m)
        if pred(m):
            return m
    raise AssertionError("message not received")


# ------------------------------------------------------------------------------ REST

def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_user_crud_and_errors(client, user):
    assert user["derived"]["bmi"] == pytest.approx(21.3, abs=0.1)
    assert client.put(f"/api/users/{user['id']}", json=dict(name="Zmiana")).json()["name"] == "Zmiana"
    r = client.get("/api/users/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "user_not_found"
    r = client.post("/api/users", json=dict(name="x", activity_score=2.0))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


def test_catalogue_and_validation(client, user):
    assert len(client.get("/api/exercises").json()) == 5
    r = client.post("/api/sessions", json=dict(user_id=user["id"], protocol=["baseline_pre", "dance"]))
    assert r.json()["error"]["code"] == "unknown_phase"
    r = client.post("/api/sessions", json=dict(user_id=user["id"], source=dict(type="replay")))
    assert r.status_code == 501


# ------------------------------------------------------------------------------ WebSocket (real time)

def test_ws_unknown_session(client):
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/ws/sessions/s_missing") as ws:
            ws.receive_json()
    assert e.value.code == 4004


def test_ws_baseline_session_end_to_end(client, user):
    sid = new_session(client, user, ["baseline_pre", "baseline_post"], baseline_s=2)
    with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
        assert ws.receive_json()["type"] == "hello"
        wait_for(ws, lambda m: m["type"] == "quality")
        ws.send_json(dict(type="ping", t=1.5))
        assert wait_for(ws, lambda m: m["type"] == "pong")["t"] == 1.5
        ws.send_json(dict(type="command", action="start_phase", phase="breath_hold"))   # not in protocol
        while (m := ws.receive_json())["type"] != "error":
            pass
        assert m["code"] == "phase_not_in_protocol"
        for phase in ("baseline_pre", "baseline_post"):
            ws.send_json(dict(type="command", action="start_phase", phase=phase))
            seen = set()
            while True:
                m = ws.receive_json()
                seen.add(m["type"])
                if m["type"] == "phase" and m["phase"] == phase and m["state"] == "finished":
                    break
            assert {"frame", "vitals"} <= seen
        s = client.post(f"/api/sessions/{sid}/finish").json()
        assert wait_for(ws, lambda m: m["type"] == "end")["reason"] == "finished"
    assert [p["name"] for p in s["phases"]] == ["baseline_pre", "baseline_post"]
    assert client.get(f"/api/sessions/{sid}").json()["status"] == "finished"
    assert len(client.get(f"/api/sessions/{sid}/timeline").json()["series"]["t"]) >= 4
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect(f"/ws/sessions/{sid}") as ws:
            ws.receive_json()
    assert e.value.code == 4009


# ------------------------------------------------------------------------------ exercise logic (no server)

def live(user, protocol, baseline_s=30):
    with db.get_conn() as conn:
        exs = [p for p in protocol if p not in ("baseline_pre", "baseline_post")]
        s = repo.create_session(conn, user_id=user["id"], source_type="mock", recording_id=None,
                                protocol=protocol, exercise=exs[0] if exs else "baseline_only")
    return runtime.LiveSession(s, user, baseline_s)


def run_phase(ls, phase, on_msg=None):
    assert ls.start_phase(phase) is None
    msgs = []
    for _ in range(20_000):
        for m in ls.tick():
            msgs.append(m)
            if on_msg:
                on_msg(m)
            if m["type"] == "phase" and m["phase"] == phase and m["state"] == "finished":
                return msgs
    raise AssertionError(f"{phase} did not finish")


def test_resonance_breathing(user):
    ls = live(user, ["baseline_pre", "resonance_breathing", "baseline_post"])
    run_phase(ls, "baseline_pre")
    msgs = run_phase(ls, "resonance_breathing")
    assert sum(m["type"] == "event" and m["name"] == "cycle" for m in msgs) == 15
    assert sum(m["type"] == "frame" and "pacer" in m for m in msgs) >= 1400
    run_phase(ls, "baseline_post")
    s = ls.finish()
    assert s["scores"]["resonance"] > 40 and s["scores"]["phase_lock"] > 0.6
    assert s["before"]["hr_bpm"] and s["after"]["hr_bpm"] and "relaxation" in s["scores"]


def test_breath_hold_button(user):
    ls = live(user, ["breath_hold"])

    def press(m):
        if m["type"] == "event" and m["name"] == "hold_start":
            for _ in range(50):            # 5 s into the hold
                ls.tick()
            assert ls.src.user_event("hold_end_button")

    msgs = run_phase(ls, "breath_hold", press)
    end = [m for m in msgs if m["type"] == "event" and m["name"] == "hold_end_detected"][0]
    assert end["data"]["by"] == "button" and end["data"]["hold_s"] == pytest.approx(5, abs=0.3)
    assert ls.finish()["holds"][0]["by"] == "button"


def test_movement_forced_fail(user):
    ls = live(user, ["movement"])

    def fail(m):
        if m["type"] == "event" and m["name"] == "command_issued":
            assert ls.src.simulate_motion("nod", 3, correct=False)

    msgs = run_phase(ls, "movement", fail)
    assert any(m["type"] == "event" and m["name"] == "command_failed" for m in msgs)
    assert ls.finish()["movement"][0]["verified"] is False


# ------------------------------------------------------------------------------ demo personas

@pytest.mark.skipif(not seed.available(), reason="results/*.csv not generated")
def test_demo_personas_from_real_data(client):
    ps = client.get("/api/demo/personas").json()
    dot = [p for p in ps if p["source"].startswith("dot/")]
    assert len(dot) == 17 and all(p["n_sessions"] == 6 for p in dot)
    d = client.post("/api/demo/personas/demo_dot_01/load").json()
    assert d["readiness"]["hr_rest"]["source"] == "real"
    h = client.get("/api/users/demo_dot_01/history?metrics=hr_bpm&by_hour=true").json()
    assert len(h["metrics"]["hr_bpm"]) == 4 and len(h["by_hour"]["hr_bpm"]) >= 3
    assert client.get("/api/users/demo_dot_01/fitness").json()["crf_mets"] is not None
    r = client.post("/api/demo/reset").json()
    assert r["seeded"] and r["removed_users"] == r["users"]
