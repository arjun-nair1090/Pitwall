import pytest

from app.core.config import settings
from app.services import saved_analyses


@pytest.fixture
def saving(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_ANALYSES_DIR", str(tmp_path))
    return tmp_path


def _counting():
    calls = []

    @saved_analyses.saved_analysis
    def analysis(year, gp, session, round_number=None):
        calls.append((year, gp, session, round_number))
        return {"year": year, "round": round_number, "laps": {1: (0.5, None)}}

    return analysis, calls


def test_an_analysis_is_worked_out_once_and_comes_back_exactly(saving):
    analysis, calls = _counting()
    first = analysis(2026, "", "R", 20)
    assert analysis(2026, "", "R", 20) == first == {"year": 2026, "round": 20, "laps": {1: (0.5, None)}}
    assert len(calls) == 1
    analysis(2026, "", "S", 20)  # another session is its own entry
    assert len(calls) == 2
    assert list((saving / saved_analyses.VERSION / "2026").glob("*.pkl"))


def test_a_race_named_by_text_is_never_saved(saving):
    # any spelling FastF1 can match would otherwise get its own file
    analysis, calls = _counting()
    analysis(2026, "Brazil", "R")
    analysis(2026, "Brazil", "R")
    assert len(calls) == 2
    assert not list(saving.rglob("*.pkl"))


def test_nothing_is_saved_when_it_is_switched_off(monkeypatch):
    monkeypatch.setattr(settings, "SAVED_ANALYSES_DIR", "")
    analysis, calls = _counting()
    analysis(2026, "", "R", 20)
    analysis(2026, "", "R", 20)
    assert len(calls) == 2


def test_a_failure_is_not_saved(saving):
    calls = []

    @saved_analyses.saved_analysis
    def flaky(year, gp, session):
        calls.append(year)
        if len(calls) == 1:
            raise ValueError("not synced yet")
        return "ok"

    with pytest.raises(ValueError):
        flaky(2026, "", "R")
    assert flaky(2026, "", "R") == "ok"
    assert flaky(2026, "", "R") == "ok"
    assert len(calls) == 2


def test_a_torn_file_is_worked_out_again(saving):
    analysis, calls = _counting()
    analysis(2026, "", "R", 20)
    for f in (saving / saved_analyses.VERSION / "2026").glob("*.pkl"):
        f.write_bytes(b"\x80half")
    assert analysis(2026, "", "R", 20)["round"] == 20
    assert len(calls) == 2


def test_older_code_versions_are_pruned(saving):
    (saving / "oldversion" / "2026").mkdir(parents=True)
    analysis, _ = _counting()
    analysis(2026, "", "R", 20)
    saved_analyses.prune_old_versions()
    assert [p.name for p in saving.iterdir()] == [saved_analyses.VERSION]


def test_a_stored_value_can_be_peeked_at_and_nothing_is_kept_when_off(saving, monkeypatch):
    assert saved_analyses.peek("debrief_summary", 2026, (2026, "São Paulo Grand Prix", "Race")) is None
    saved_analyses.store("debrief_summary", 2026, (2026, "São Paulo Grand Prix", "Race"), {"source": "ai"})
    assert saved_analyses.peek("debrief_summary", 2026, (2026, "São Paulo Grand Prix", "Race")) == {"source": "ai"}
    monkeypatch.setattr(settings, "SAVED_ANALYSES_DIR", "")
    saved_analyses.store("debrief_summary", 2026, ("x",), 1)
    assert saved_analyses.peek("debrief_summary", 2026, ("x",)) is None
