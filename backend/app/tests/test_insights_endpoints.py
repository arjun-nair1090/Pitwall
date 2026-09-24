from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.session_frames import LruCache, SessionFrames

# Reuse the synthetic race builders from the unit tests (pytest puts this directory on sys.path).
from test_race_debrief import _make_race_control, _make_results
from test_race_debrief import _make_laps as _make_debrief_laps
from test_whatif import _lap_rows

import pandas as pd

client = TestClient(app)


def _debrief_frames():
    return SessionFrames("Belgian Grand Prix", 2023, "Race", _make_results(), _make_debrief_laps(), _make_race_control())


def _whatif_frames():
    plan = [("MEDIUM", 8), ("HARD", 12)]
    laps = pd.DataFrame(_lap_rows("VER", plan) + _lap_rows("NOR", plan))
    return SessionFrames("Belgian Grand Prix", 2023, "Race", _make_results(), laps, None)


class _Engineer:
    def __init__(self, text=None):
        self.text, self.calls = text, 0

    async def generate_text(self, system_prompt, user_prompt, **kwargs):
        self.calls += 1
        return self.text


@pytest.fixture(autouse=True)
def fresh_cache():
    from app.api.v1 import insights_endpoints
    insights_endpoints._SUMMARY_CACHE = LruCache(maxsize=8)


@pytest.fixture
def frames():
    with patch("app.api.v1.insights_endpoints.load_session_frames", return_value=_debrief_frames()) as loader:
        yield loader


@pytest.fixture
def engineer():
    fake = _Engineer(None)
    with patch("app.api.v1.insights_endpoints.ai_engineer", fake):
        yield fake


# --- GET /debrief -----------------------------------------------------------------

def test_debrief_returns_facts_and_a_template_summary_without_an_llm(frames, engineer):
    response = client.get("/api/v1/debrief", params={"year": 2023, "gp": "Belgian Grand Prix"})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "template"
    assert body["facts"]["winner"]["code"] == "VER"
    assert "Max Verstappen" in body["summary"]
    frames.assert_called_once_with(2023, "Belgian Grand Prix", "Race")


def test_debrief_uses_and_caches_a_grounded_ai_summary(frames, engineer):
    engineer.text = "Verstappen won a dominant race at Spa."
    first = client.get("/api/v1/debrief", params={"year": 2023, "gp": "Belgian Grand Prix"}).json()
    second = client.get("/api/v1/debrief", params={"year": 2023, "gp": "  belgian grand prix "}).json()
    assert first["source"] == second["source"] == "ai"
    assert second["summary"] == "Verstappen won a dominant race at Spa."
    assert engineer.calls == 1          # the second request was served from the cache


def test_debrief_does_not_cache_the_template_so_a_later_llm_can_take_over(frames, engineer):
    client.get("/api/v1/debrief", params={"year": 2023, "gp": "Belgian Grand Prix"})
    engineer.text = "Verstappen won."
    later = client.get("/api/v1/debrief", params={"year": 2023, "gp": "Belgian Grand Prix"}).json()
    assert later["source"] == "ai"


def test_debrief_reports_404_when_the_session_has_no_final_results(engineer):
    empty = SessionFrames("Belgian Grand Prix", 2023, "Race", _make_results().iloc[0:0], _make_debrief_laps(), None)
    with patch("app.api.v1.insights_endpoints.load_session_frames", return_value=empty):
        response = client.get("/api/v1/debrief", params={"year": 2023, "gp": "Belgian Grand Prix"})
    assert response.status_code == 404
    assert "classification" in response.json()["detail"].lower()


def test_debrief_reports_502_without_leaking_internals_when_loading_fails(engineer):
    with patch("app.api.v1.insights_endpoints.load_session_frames", side_effect=ConnectionError("secret-host.internal:443 refused")):
        response = client.get("/api/v1/debrief", params={"year": 2023, "gp": "Belgian Grand Prix"})
    assert response.status_code == 502
    assert "secret-host" not in response.text


@pytest.mark.parametrize("params", [
    {"year": 2010, "gp": "Belgian Grand Prix"},
    {"year": 2023, "gp": ""},
    {"year": 2023, "gp": "x" * 101},
    {"year": 2023, "gp": "Belgian Grand Prix", "session": "Qualifying"},
    {"gp": "Belgian Grand Prix"},
])
def test_debrief_validates_its_parameters(params, frames, engineer):
    assert client.get("/api/v1/debrief", params=params).status_code == 422


# --- POST /whatif -----------------------------------------------------------------

def _whatif_body(**overrides):
    body = {
        "year": 2023, "gp": "Belgian Grand Prix", "session": "Race", "driver_code": "VER",
        "changes": [{"type": "shift_stop", "stop": 1, "laps": 2}],
    }
    body.update(overrides)
    return body


@pytest.fixture
def whatif_frames():
    with patch("app.api.v1.insights_endpoints.load_session_frames", return_value=_whatif_frames()) as loader:
        yield loader


@pytest.fixture
def whatif_engineer():
    fake = _Engineer(None)
    with patch("app.services.whatif_graph.ai_engineer", fake):
        yield fake


def test_whatif_returns_the_delta_plans_and_an_explanation(whatif_frames, whatif_engineer):
    response = client.post("/api/v1/whatif", json=_whatif_body())
    assert response.status_code == 200
    body = response.json()
    assert body["driver"] == "VER"
    assert body["delta_seconds"] == pytest.approx(-1.56, abs=1e-6)
    assert body["actual_stints"] == [{"compound": "MEDIUM", "laps": 8}, {"compound": "HARD", "laps": 12}]
    assert body["modified_pit_laps"] == [10]
    assert body["explanation_source"] == "template"
    assert "1.6" in body["explanation"]
    assert body["event"] == "Belgian Grand Prix" and body["year"] == 2023


def test_whatif_uses_grounded_ai_explanations(whatif_frames, whatif_engineer):
    whatif_engineer.text = "Pitting two laps later would have saved about 1.6 seconds."
    body = client.post("/api/v1/whatif", json=_whatif_body()).json()
    assert body["explanation_source"] == "ai"


def test_whatif_normalises_the_driver_code(whatif_frames, whatif_engineer):
    body = client.post("/api/v1/whatif", json=_whatif_body(driver_code="ver")).json()
    assert body["driver"] == "VER"


def test_whatif_reports_an_impossible_hypothetical_as_a_400_with_the_reason(whatif_frames, whatif_engineer):
    response = client.post("/api/v1/whatif", json=_whatif_body(changes=[{"type": "shift_stop", "stop": 1, "laps": 50}]))
    assert response.status_code == 400
    assert "no laps" in response.json()["detail"].lower()
    assert whatif_engineer.calls == 0


def test_whatif_reports_a_driver_with_no_laps_as_a_400(whatif_frames, whatif_engineer):
    response = client.post("/api/v1/whatif", json=_whatif_body(driver_code="ZZZ"))
    assert response.status_code == 400
    assert "ZZZ" in response.json()["detail"]


def test_whatif_reports_502_when_the_session_cannot_be_loaded(whatif_engineer):
    with patch("app.api.v1.insights_endpoints.load_session_frames", side_effect=ConnectionError("boom")):
        assert client.post("/api/v1/whatif", json=_whatif_body()).status_code == 502


@pytest.mark.parametrize("overrides", [
    {"changes": []},
    {"changes": [{"type": "shift_stop", "stop": 1, "laps": 1}] * 6},
    {"changes": [{"type": "shift_stop", "stop": 1}]},                           # missing laps
    {"changes": [{"type": "shift_stop", "laps": 2}]},                           # missing stop
    {"changes": [{"type": "change_compound", "stint": 1}]},                     # missing compound
    {"changes": [{"type": "change_compound", "compound": "SOFT"}]},             # missing stint
    {"changes": [{"type": "teleport"}]},
    {"driver_code": "VERSTAPPEN"},
    {"driver_code": "V3R"},
    {"session": "Qualifying"},
    {"year": 1999},
    {"gp": ""},
])
def test_whatif_validates_its_request(overrides, whatif_frames, whatif_engineer):
    assert client.post("/api/v1/whatif", json=_whatif_body(**overrides)).status_code == 422


def test_whatif_needs_no_authentication_or_csrf(whatif_frames, whatif_engineer):
    # Stateless and read-only (it computes a hypothetical, changes nothing), like /strategy/simulate.
    assert client.post("/api/v1/whatif", json=_whatif_body()).status_code == 200
