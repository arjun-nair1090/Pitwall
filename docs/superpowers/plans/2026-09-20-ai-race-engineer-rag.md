# AI Race Engineer — Real RAG (Historical Retrieval) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI Race Engineer a historical corpus (FastF1 data, summarized per driver per session, embedded into ChromaDB) and a retrieval step so it can answer cross-season questions, not just live-session ones.

**Architecture:** An offline CLI script builds prose summaries per (year, event, session, driver) via FastF1 and upserts them into a `f1_race_history` Chroma collection using Chroma's built-in local embedding function. A new LangGraph node in the existing AI Engineer graph queries that collection at chat time and appends hits to the same context blob already sent to the LLM. Both the ingestion script and the retrieval node degrade to a no-op (skip / empty string) on any Chroma failure — chat never breaks because of this feature.

**Tech Stack:** Python 3.12, FastAPI, FastF1, pandas, chromadb 1.5.9 (already in `requirements.txt`), LangGraph (already in `ai_engineer.py`), pytest + pytest-asyncio (existing test stack).

**Spec:** `docs/superpowers/specs/2026-09-20-ai-race-engineer-rag-design.md`

## Global Constraints

- No new hard API-key requirement — embeddings run locally via Chroma's `DefaultEmbeddingFunction` (bundled with `chromadb`, no extra dependency).
- Retrieval failure (Chroma down, empty corpus) must degrade to today's live-only behavior — never raise out of the chat path.
- Ingestion must be resumable: check-before-load per session so a killed/restarted run doesn't redo work or re-embed already-indexed sessions.
- Tests must not require a live Chroma server or a network-downloaded embedding model — use `chromadb.EphemeralClient()` with a fake embedding function everywhere in tests.
- Document id format: `f"{year}_{event_slug}_{session_slug}_{driver_code.lower()}"`.

---

### Task 1: Chroma connection settings

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `.env.example`
- Test: `backend/app/tests/test_config.py` (new file)

**Interfaces:**
- Produces: `settings.CHROMA_CONNECTION_HOST -> str`, `settings.CHROMA_CONNECTION_PORT -> int` (used by Task 3's `rag_service.py`)

- [ ] **Step 1: Write the failing test**

```python
# backend/app/tests/test_config.py
import importlib
import os

import pytest


def _reload_settings():
    from app.core import config
    importlib.reload(config)
    return config.settings


def test_chroma_connection_defaults_to_docker_service_name(monkeypatch):
    monkeypatch.delenv("RUNNING_LOCALLY", raising=False)
    monkeypatch.delenv("CHROMA_HOST", raising=False)
    monkeypatch.delenv("CHROMA_PORT", raising=False)
    settings = _reload_settings()
    assert settings.CHROMA_CONNECTION_HOST == "chromadb"
    assert settings.CHROMA_CONNECTION_PORT == 8000


def test_chroma_connection_swaps_to_localhost_when_running_locally(monkeypatch):
    monkeypatch.setenv("RUNNING_LOCALLY", "true")
    monkeypatch.delenv("CHROMA_HOST", raising=False)
    monkeypatch.delenv("CHROMA_PORT", raising=False)
    settings = _reload_settings()
    assert settings.CHROMA_CONNECTION_HOST == "localhost"
    assert settings.CHROMA_CONNECTION_PORT == 8001
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'CHROMA_CONNECTION_HOST'`

- [ ] **Step 3: Add the settings**

In `backend/app/core/config.py`, add after the existing `REDIS_CONNECTION_URL` property block:

```python
    CHROMA_HOST: str = os.getenv("CHROMA_HOST", "chromadb")
    CHROMA_PORT: int = int(os.getenv("CHROMA_PORT", "8000"))

    @property
    def CHROMA_CONNECTION_HOST(self) -> str:
        if os.getenv("RUNNING_LOCALLY") == "true":
            return "localhost"
        return self.CHROMA_HOST

    @property
    def CHROMA_CONNECTION_PORT(self) -> int:
        if os.getenv("RUNNING_LOCALLY") == "true":
            return 8001  # docker-compose maps host 8001 -> container 8000
        return self.CHROMA_PORT
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && SECRET_KEY=test python -m pytest app/tests/test_config.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Update `.env.example`**

In `.env.example`, after the `# --- FastF1 ---` section, add:

```bash
# --- ChromaDB (AI Race Engineer historical RAG) ---
# Use "chromadb" (the docker-compose service name) inside Docker, "localhost" when running locally.
CHROMA_HOST=chromadb
CHROMA_PORT=8000
```

- [ ] **Step 6: Run full backend test suite to confirm no regressions**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (existing 8 + new 2 = 10)

- [ ] **Step 7: Commit**

```bash
git add backend/app/core/config.py backend/app/tests/test_config.py .env.example
git commit -m "feat: add Chroma connection settings for AI Engineer RAG"
```

---

### Task 2: Pure summary-building function

**Files:**
- Create: `backend/app/services/history_summarizer.py`
- Test: `backend/app/tests/test_history_summarizer.py`

**Interfaces:**
- Produces:
  - `slugify(text: str) -> str`
  - `make_doc_id(year: int, event: str, session: str, driver_code: str) -> str`
  - `build_driver_session_summary(laps: pandas.DataFrame, driver_code: str, event_name: str, year: int, session_name: str, race_control_messages: pandas.DataFrame | None = None) -> tuple[str, dict]` — returns `(document_text, metadata_dict)`. `metadata_dict` has keys `year` (int), `event` (str), `session` (str), `driver_code` (str), `team` (str).
- Consumes: nothing (pure — no FastF1, no I/O). Callers pass in an already-loaded `session.laps` (or a `.pick_driver(...)` subset), filtered to one driver, plus the driver's team name (read from the laps `Team` column).

- [ ] **Step 1: Write the failing tests**

```python
# backend/app/tests/test_history_summarizer.py
import pandas as pd
import pytest

from app.services.history_summarizer import (
    build_driver_session_summary,
    make_doc_id,
    slugify,
)


def _lap(lap_number, stint, compound, lap_time_s, position=1, pit_in=False, pit_out=False, team="Red Bull Racing"):
    return {
        "LapNumber": lap_number,
        "Stint": stint,
        "Compound": compound,
        "LapTime": pd.Timedelta(seconds=lap_time_s),
        "Position": position,
        "PitInTime": pd.Timedelta(seconds=1) if pit_in else pd.NaT,
        "PitOutTime": pd.Timedelta(seconds=1) if pit_out else pd.NaT,
        "Team": team,
        "Driver": "VER",
    }


def test_slugify_lowercases_and_dashes_spaces():
    assert slugify("Belgian Grand Prix") == "belgian-grand-prix"


def test_make_doc_id_format():
    assert make_doc_id(2023, "Belgian Grand Prix", "Race", "VER") == "2023_belgian-grand-prix_race_ver"


def test_single_stint_no_pit_stop():
    laps = pd.DataFrame([
        _lap(1, 1, "MEDIUM", 95.0),
        _lap(2, 1, "MEDIUM", 95.2),
        _lap(3, 1, "MEDIUM", 95.5),
        _lap(4, 1, "MEDIUM", 95.7, position=1),
    ])
    text, meta = build_driver_session_summary(laps, "VER", "Belgian Grand Prix", 2023, "Race")

    assert "Max Verstappen" not in text  # we don't have full names here, code-based is fine
    assert "VER" in text
    assert "Red Bull Racing" in text
    assert "MEDIUM" in text
    assert "1 pit stop" not in text
    assert "0 pit stops" in text
    assert meta == {
        "year": 2023,
        "event": "Belgian Grand Prix",
        "session": "Race",
        "driver_code": "VER",
        "team": "Red Bull Racing",
    }


def test_multi_stint_with_pit_stop_excludes_out_lap_from_trend():
    laps = pd.DataFrame([
        _lap(1, 1, "MEDIUM", 95.0),
        _lap(2, 1, "MEDIUM", 95.2),
        _lap(3, 1, "MEDIUM", 95.6),
        _lap(4, 1, "MEDIUM", 96.0, pit_in=True),
        _lap(5, 2, "HARD", 97.5, pit_out=True),  # out-lap, excluded from trend
        _lap(6, 2, "HARD", 96.0),
        _lap(7, 2, "HARD", 96.1),
        _lap(8, 2, "HARD", 96.3, position=1),
    ])
    text, _ = build_driver_session_summary(laps, "VER", "Belgian Grand Prix", 2023, "Race")

    assert "1 pit stop" in text
    assert "MEDIUM" in text and "HARD" in text
    # Stint 1's clean laps are 1-3 (lap 4 is the in-lap, excluded); stint 2's clean lap is just 6-7
    # (lap 5 is the out-lap, excluded) plus lap 8 — either way, a trend gets computed for stint 1.
    assert "s/lap" in text


def test_stint_with_fewer_than_three_clean_laps_reports_insufficient_data():
    laps = pd.DataFrame([
        _lap(1, 1, "SOFT", 95.0, pit_out=True),  # out-lap, excluded
        _lap(2, 1, "SOFT", 94.0, position=1),
    ])
    text, _ = build_driver_session_summary(laps, "VER", "Belgian Grand Prix", 2023, "Race")

    assert "insufficient laps for a trend" in text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest app/tests/test_history_summarizer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.history_summarizer'`

- [ ] **Step 3: Implement the module**

```python
# backend/app/services/history_summarizer.py
import re
from typing import Any, Dict, Optional, Tuple

import pandas as pd


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def make_doc_id(year: int, event: str, session: str, driver_code: str) -> str:
    return f"{year}_{slugify(event)}_{slugify(session)}_{driver_code.lower()}"


def _clean_laps_for_trend(stint_laps: pd.DataFrame) -> pd.DataFrame:
    """Exclude the in-lap/out-lap (and any lap FastF1 flags as inaccurate) from a degradation calc."""
    mask = stint_laps["PitInTime"].isna() & stint_laps["PitOutTime"].isna()
    if "IsAccurate" in stint_laps.columns:
        mask &= stint_laps["IsAccurate"].fillna(True)
    return stint_laps[mask]


def _describe_stint(stint_number: int, stint_laps: pd.DataFrame) -> str:
    compound = stint_laps["Compound"].iloc[0]
    lap_start = int(stint_laps["LapNumber"].min())
    lap_end = int(stint_laps["LapNumber"].max())
    clean = _clean_laps_for_trend(stint_laps)

    if len(clean) < 3:
        trend = "insufficient laps for a trend"
    else:
        clean = clean.sort_values("LapNumber")
        first_time = clean["LapTime"].iloc[0].total_seconds()
        last_time = clean["LapTime"].iloc[-1].total_seconds()
        num_laps = len(clean)
        rate = (last_time - first_time) / (num_laps - 1)
        trend = f"degrading ~{rate:.2f}s/lap"

    return f"{compound} (laps {lap_start}-{lap_end}, {trend})"


def build_driver_session_summary(
    laps: pd.DataFrame,
    driver_code: str,
    event_name: str,
    year: int,
    session_name: str,
    race_control_messages: Optional[pd.DataFrame] = None,
) -> Tuple[str, Dict[str, Any]]:
    driver_laps = laps[laps["Driver"] == driver_code].sort_values("LapNumber")
    team = driver_laps["Team"].iloc[0] if not driver_laps.empty else "Unknown"

    stint_descriptions = []
    for stint_number, stint_laps in driver_laps.groupby("Stint"):
        stint_descriptions.append(_describe_stint(int(stint_number), stint_laps))
    num_pit_stops = max(0, len(stint_descriptions) - 1)

    fastest = driver_laps.loc[driver_laps["LapTime"].idxmin()] if driver_laps["LapTime"].notna().any() else None
    finishing_position = driver_laps["Position"].iloc[-1] if not driver_laps.empty and pd.notna(driver_laps["Position"].iloc[-1]) else None

    lines = []
    result_clause = f"finished P{int(finishing_position)}" if finishing_position is not None else "result unknown"
    lines.append(f"{driver_code} ({team}) {result_clause} at the {year} {event_name} ({session_name}).")
    lines.append(f"Strategy: {' then '.join(stint_descriptions)}.")
    lines.append(f"{num_pit_stops} pit stop{'s' if num_pit_stops != 1 else ''}.")

    if fastest is not None:
        fastest_lap_time = fastest["LapTime"].total_seconds()
        minutes = int(fastest_lap_time // 60)
        seconds = fastest_lap_time % 60
        lines.append(
            f"Fastest lap: {minutes}:{seconds:06.3f} on lap {int(fastest['LapNumber'])} ({fastest['Compound']} tire)."
        )

    if race_control_messages is not None and not race_control_messages.empty:
        messages = race_control_messages["Message"].dropna().unique().tolist()
        if messages:
            lines.append("Race control: " + "; ".join(messages[:5]) + ".")

    text = " ".join(lines)
    metadata = {
        "year": year,
        "event": event_name,
        "session": session_name,
        "driver_code": driver_code,
        "team": team,
    }
    return text, metadata
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest app/tests/test_history_summarizer.py -v`
Expected: PASS (6 tests). If the pit-stop-count assertion phrasing doesn't match exactly, adjust the f-string in `build_driver_session_summary`, not the test.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/history_summarizer.py backend/app/tests/test_history_summarizer.py
git commit -m "feat: add pure FastF1 session-summary builder for RAG ingestion"
```

---

### Task 3: RAG retrieval service

**Files:**
- Create: `backend/app/services/rag_service.py`
- Test: `backend/app/tests/test_rag_service.py`

**Interfaces:**
- Consumes: `settings.CHROMA_CONNECTION_HOST`, `settings.CHROMA_CONNECTION_PORT` (Task 1)
- Produces:
  - `get_collection() -> chromadb.Collection` (used by Task 4's ingestion script)
  - `query_historical_context(question: str, n_results: int = 5) -> str` (used by Task 5)
  - Module-level constant `COLLECTION_NAME = "f1_race_history"`

- [ ] **Step 1: Write the failing tests**

```python
# backend/app/tests/test_rag_service.py
import chromadb
import pytest
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

from app.services import rag_service


class FakeEmbeddingFunction(EmbeddingFunction):
    """Deterministic, dependency-free stand-in so tests never download the real model."""

    def __call__(self, input: Documents) -> Embeddings:
        return [[float(len(doc) % 7), float(sum(ord(c) for c in doc) % 13)] for doc in input]


@pytest.fixture
def fake_collection():
    client = chromadb.EphemeralClient()
    return client.get_or_create_collection(
        rag_service.COLLECTION_NAME, embedding_function=FakeEmbeddingFunction()
    )


def test_query_historical_context_formats_hits(monkeypatch, fake_collection):
    fake_collection.upsert(
        ids=["2023_belgian-grand-prix_race_ver"],
        documents=["Max Verstappen won at Spa in 2023 on a two-stop strategy."],
        metadatas=[{"year": 2023, "event": "Belgian Grand Prix", "session": "Race", "driver_code": "VER", "team": "Red Bull Racing"}],
    )
    monkeypatch.setattr(rag_service, "get_collection", lambda: fake_collection)

    result = rag_service.query_historical_context("How did Verstappen do at Spa?", n_results=5)

    assert "## Historical Context (RAG)" in result
    assert "2023 Belgian Grand Prix" in result
    assert "VER" in result
    assert "two-stop strategy" in result


def test_query_historical_context_empty_collection_returns_empty_string(monkeypatch, fake_collection):
    monkeypatch.setattr(rag_service, "get_collection", lambda: fake_collection)
    result = rag_service.query_historical_context("Anything about 1994?")
    assert result == ""


def test_query_historical_context_swallows_connection_errors(monkeypatch):
    def _raise():
        raise ConnectionError("chromadb unreachable")

    monkeypatch.setattr(rag_service, "get_collection", _raise)
    result = rag_service.query_historical_context("How did Verstappen do at Spa?")
    assert result == ""
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest app/tests/test_rag_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.rag_service'`

- [ ] **Step 3: Implement the module**

```python
# backend/app/services/rag_service.py
from typing import Optional

import chromadb

from app.core.config import settings

COLLECTION_NAME = "f1_race_history"

_client: Optional["chromadb.ClientAPI"] = None


def _get_client() -> "chromadb.ClientAPI":
    global _client
    if _client is None:
        _client = chromadb.HttpClient(
            host=settings.CHROMA_CONNECTION_HOST,
            port=settings.CHROMA_CONNECTION_PORT,
        )
    return _client


def get_collection():
    """Get-or-create the historical race collection. Raises on connection failure —
    callers that must never break (like query_historical_context) catch around this."""
    return _get_client().get_or_create_collection(COLLECTION_NAME)


def query_historical_context(question: str, n_results: int = 5) -> str:
    """Returns a markdown section of relevant historical race summaries, or "" if
    Chroma is unreachable or nothing relevant has been ingested yet. Never raises."""
    try:
        collection = get_collection()
        results = collection.query(query_texts=[question], n_results=n_results)
    except Exception as e:
        print(f"RAG retrieval unavailable, continuing live-only: {e}")
        return ""

    documents = results.get("documents") or [[]]
    metadatas = results.get("metadatas") or [[]]
    documents = documents[0] if documents else []
    metadatas = metadatas[0] if metadatas else []

    if not documents:
        return ""

    lines = ["## Historical Context (RAG)"]
    for doc, meta in zip(documents, metadatas):
        meta = meta or {}
        tag = f"{meta.get('year', '?')} {meta.get('event', 'Unknown Event')} — {meta.get('session', '?')} — {meta.get('driver_code', '?')}"
        lines.append(f"- [{tag}]: {doc}")

    return "\n".join(lines)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest app/tests/test_rag_service.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (10 + 6 + 3 = 19)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/rag_service.py backend/app/tests/test_rag_service.py
git commit -m "feat: add RAG retrieval service with fail-safe degradation"
```

---

### Task 4: Ingestion CLI script

**Files:**
- Create: `backend/app/scripts/ingest_history.py`
- Test: `backend/app/tests/test_ingest_history.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: `rag_service.get_collection()`, `history_summarizer.build_driver_session_summary`, `history_summarizer.make_doc_id` (Tasks 2, 3)
- Produces: `parse_years_arg(raw: list[str]) -> list[int]`, `session_already_ingested(collection, year: int, event: str, session: str) -> bool` — both pure/testable in isolation from FastF1; `main()` — the FastF1-dependent orchestration, verified by manual run (see Step 6), not by an automated test (no FastF1 network/cache fixture exists in this repo to mock against safely).

- [ ] **Step 1: Write the failing tests (for the testable pure pieces)**

```python
# backend/app/tests/test_ingest_history.py
import chromadb
import pytest
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

from app.scripts.ingest_history import parse_years_arg, session_already_ingested


class FakeEmbeddingFunction(EmbeddingFunction):
    def __call__(self, input: Documents) -> Embeddings:
        return [[float(len(doc) % 7)] for doc in input]


def test_parse_years_arg_expands_range():
    assert parse_years_arg(["2018-2020"]) == [2018, 2019, 2020]


def test_parse_years_arg_accepts_individual_years():
    assert parse_years_arg(["2018", "2020"]) == [2018, 2020]


def test_parse_years_arg_mixes_ranges_and_singles():
    assert parse_years_arg(["2018-2019", "2023"]) == [2018, 2019, 2023]


def test_session_already_ingested_true_when_docs_exist():
    client = chromadb.EphemeralClient()
    collection = client.get_or_create_collection("test", embedding_function=FakeEmbeddingFunction())
    collection.upsert(
        ids=["2023_belgian-grand-prix_race_ver"],
        documents=["placeholder"],
        metadatas=[{"year": 2023, "event": "Belgian Grand Prix", "session": "Race", "driver_code": "VER", "team": "Red Bull Racing"}],
    )
    assert session_already_ingested(collection, 2023, "Belgian Grand Prix", "Race") is True


def test_session_already_ingested_false_when_absent():
    client = chromadb.EphemeralClient()
    collection = client.get_or_create_collection("test2", embedding_function=FakeEmbeddingFunction())
    assert session_already_ingested(collection, 2022, "Belgian Grand Prix", "Race") is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest app/tests/test_ingest_history.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.scripts.ingest_history'`

- [ ] **Step 3: Implement the script**

```python
# backend/app/scripts/ingest_history.py
"""
Manual, one-time (or periodic) ingestion of historical FastF1 data into the
f1_race_history Chroma collection used by the AI Race Engineer's RAG retrieval.

Usage:
    python -m app.scripts.ingest_history --years 2018-2025
    python -m app.scripts.ingest_history --years 2026

Safe to interrupt and rerun: already-ingested sessions are skipped (checked via
Chroma metadata, before the slow FastF1 session load), so a rerun only picks up
new or previously-failed sessions.
"""
import argparse
import sys
from typing import List

from app.services import rag_service
from app.services.history_summarizer import build_driver_session_summary, make_doc_id


def parse_years_arg(raw: List[str]) -> List[int]:
    years = []
    for token in raw:
        if "-" in token:
            start, end = token.split("-", 1)
            years.extend(range(int(start), int(end) + 1))
        else:
            years.append(int(token))
    return years


def session_already_ingested(collection, year: int, event: str, session: str) -> bool:
    result = collection.get(
        where={
            "$and": [
                {"year": {"$eq": year}},
                {"event": {"$eq": event}},
                {"session": {"$eq": session}},
            ]
        },
        limit=1,
    )
    return len(result.get("ids", [])) > 0


SESSION_TYPES = ["FP1", "FP2", "FP3", "Q", "Sprint", "SQ", "R"]
SESSION_DISPLAY_NAMES = {
    "FP1": "Practice 1", "FP2": "Practice 2", "FP3": "Practice 3",
    "Q": "Qualifying", "Sprint": "Sprint", "SQ": "Sprint Qualifying", "R": "Race",
}


def ingest_year(year: int, collection) -> None:
    import fastf1

    schedule = fastf1.get_event_schedule(year)
    ingested, skipped, failed = 0, 0, 0

    for _, event_row in schedule.iterrows():
        if str(event_row["EventFormat"]) == "testing":
            continue
        event_name = str(event_row["EventName"])

        for session_type in SESSION_TYPES:
            session_display = SESSION_DISPLAY_NAMES[session_type]

            if session_already_ingested(collection, year, event_name, session_display):
                skipped += 1
                continue

            try:
                session = fastf1.get_session(year, event_name, session_type)
                session.load(laps=True, weather=False, telemetry=False)
                laps = session.laps
                if laps.empty:
                    continue

                race_control = None
                try:
                    race_control = session.race_control_messages
                except Exception:
                    pass

                ids, documents, metadatas = [], [], []
                for driver_code in laps["Driver"].unique():
                    text, meta = build_driver_session_summary(
                        laps, driver_code, event_name, year, session_display, race_control
                    )
                    ids.append(make_doc_id(year, event_name, session_display, driver_code))
                    documents.append(text)
                    metadatas.append(meta)

                collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
                ingested += 1
                print(f"Ingested {year} {event_name} ({session_display}): {len(ids)} drivers")
            except Exception as e:
                failed += 1
                print(f"Skipping {year} {event_name} ({session_display}) — {e}")

    print(f"Year {year} done: {ingested} sessions ingested, {skipped} skipped (already indexed), {failed} failed")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Ingest historical FastF1 data for AI Engineer RAG")
    parser.add_argument("--years", nargs="+", required=True, help="e.g. --years 2018-2025 2026")
    args = parser.parse_args(argv)

    years = parse_years_arg(args.years)
    collection = rag_service.get_collection()

    for year in years:
        ingest_year(year, collection)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest app/tests/test_ingest_history.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (19 + 5 = 24)

- [ ] **Step 6: Document the manual seeding step in README**

In `README.md`, after the "Running Locally" section, add:

```markdown
## Seeding historical data for the AI Race Engineer (optional)

The AI Race Engineer can answer cross-season questions ("how did Verstappen's
strategy at Spa compare across recent years") if its historical corpus has been
built. This is a manual, one-time (or periodic) step — it's not required for
the app to run, and the AI Engineer works live-session-only until you do this:

```bash
docker compose exec backend python -m app.scripts.ingest_history --years 2018-2025
```

This can take several hours the first time (FastF1 loads each session fresh).
It's safe to interrupt (Ctrl-C) and rerun later — already-ingested sessions are
skipped. Rerun periodically with just the new year (`--years 2026`) to pick up
newly-completed race weekends.
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/scripts/ backend/app/tests/test_ingest_history.py README.md
git commit -m "feat: add resumable FastF1 history ingestion CLI for RAG"
```

---

### Task 5: Wire retrieval into the AI Engineer's LangGraph flow

**Files:**
- Modify: `backend/app/services/ai_engineer.py`
- Test: `backend/app/tests/test_ai_engineer.py` (new file)

**Interfaces:**
- Consumes: `rag_service.query_historical_context` (Task 3)
- Modifies: `AgentState` TypedDict gains `historical_md: str`; `generate_response_node` now reads both `context_md` and `historical_md`

- [ ] **Step 1: Write the failing tests**

```python
# backend/app/tests/test_ai_engineer.py
from unittest.mock import AsyncMock, patch

import pytest

from app.services import ai_engineer


@pytest.mark.asyncio
async def test_answer_question_includes_historical_context_when_available():
    with patch.object(
        ai_engineer.ai_engineer, "retrieve_race_context", new=AsyncMock(return_value={
            "drivers": [], "timing": {}, "weather": None, "race_control": [],
        })
    ), patch(
        "app.services.rag_service.query_historical_context",
        return_value="## Historical Context (RAG)\n- [2023 Belgian Grand Prix — Race — VER]: some summary",
    ), patch.object(
        ai_engineer.ai_engineer, "call_llm", new=AsyncMock(return_value="final answer")
    ) as mock_call_llm:
        response = await ai_engineer.answer_question("How did VER do at Spa?", session_key=123)

    assert response == "final answer"
    call_args = mock_call_llm.call_args
    context_md_arg = call_args.args[1] if len(call_args.args) > 1 else call_args.kwargs["context_md"]
    assert "Historical Context (RAG)" in context_md_arg
    assert "some summary" in context_md_arg


@pytest.mark.asyncio
async def test_answer_question_works_when_historical_context_unavailable():
    with patch.object(
        ai_engineer.ai_engineer, "retrieve_race_context", new=AsyncMock(return_value={
            "drivers": [], "timing": {}, "weather": None, "race_control": [],
        })
    ), patch(
        "app.services.rag_service.query_historical_context", return_value=""
    ), patch.object(
        ai_engineer.ai_engineer, "call_llm", new=AsyncMock(return_value="final answer")
    ) as mock_call_llm:
        response = await ai_engineer.answer_question("Any question", session_key=123)

    assert response == "final answer"
    call_args = mock_call_llm.call_args
    context_md_arg = call_args.args[1] if len(call_args.args) > 1 else call_args.kwargs["context_md"]
    assert "Historical Context (RAG)" not in context_md_arg
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest app/tests/test_ai_engineer.py -v`
Expected: FAIL — `call_llm` currently only receives `context_md` without historical content merged in (the node doesn't exist yet), so the "Historical Context (RAG)" assertion fails.

- [ ] **Step 3: Modify `ai_engineer.py`**

Change the `AgentState` TypedDict:

```python
class AgentState(TypedDict):
    question: str
    session_key: int
    context_md: str
    historical_md: str
    response: str
```

Add the import at the top (alongside the existing `from app.services.f1_data_service import f1_service`):

```python
from app.services import rag_service
```

Add a new node function and update `generate_response_node`, replacing this block:

```python
async def retrieve_context_node(state: AgentState) -> Dict[str, Any]:
    context = await ai_engineer.retrieve_race_context(state["session_key"])
    context_md = ai_engineer.format_context_as_markdown(context)
    return {"context_md": context_md}

async def generate_response_node(state: AgentState) -> Dict[str, Any]:
    response = await ai_engineer.call_llm(state["question"], state["context_md"])
    return {"response": response}

# Compile Workflow Graph
workflow = StateGraph(AgentState)
workflow.add_node("retrieve_context", retrieve_context_node)
workflow.add_node("generate_response", generate_response_node)

workflow.add_edge(START, "retrieve_context")
workflow.add_edge("retrieve_context", "generate_response")
workflow.add_edge("generate_response", END)
```

with:

```python
async def retrieve_context_node(state: AgentState) -> Dict[str, Any]:
    context = await ai_engineer.retrieve_race_context(state["session_key"])
    context_md = ai_engineer.format_context_as_markdown(context)
    return {"context_md": context_md}

async def retrieve_historical_node(state: AgentState) -> Dict[str, Any]:
    import asyncio
    historical_md = await asyncio.to_thread(rag_service.query_historical_context, state["question"])
    return {"historical_md": historical_md}

async def generate_response_node(state: AgentState) -> Dict[str, Any]:
    combined_context = state["context_md"]
    if state.get("historical_md"):
        combined_context = f"{combined_context}\n\n{state['historical_md']}"
    response = await ai_engineer.call_llm(state["question"], combined_context)
    return {"response": response}

# Compile Workflow Graph
workflow = StateGraph(AgentState)
workflow.add_node("retrieve_context", retrieve_context_node)
workflow.add_node("retrieve_historical", retrieve_historical_node)
workflow.add_node("generate_response", generate_response_node)

workflow.add_edge(START, "retrieve_context")
workflow.add_edge(START, "retrieve_historical")
workflow.add_edge("retrieve_context", "generate_response")
workflow.add_edge("retrieve_historical", "generate_response")
workflow.add_edge("generate_response", END)
```

Update `answer_question` to seed the new state key so LangGraph doesn't choke on a missing key if a node is skipped:

```python
async def answer_question(question: str, session_key: int) -> str:
    res = await graph.ainvoke({"question": question, "session_key": session_key, "context_md": "", "historical_md": ""})
    return res["response"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest app/tests/test_ai_engineer.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (24 + 2 = 26)

- [ ] **Step 6: Compile-check and import-check**

Run:
```bash
cd backend
python -m py_compile app/services/ai_engineer.py app/services/rag_service.py app/services/history_summarizer.py app/scripts/ingest_history.py
SECRET_KEY=test RUNNING_LOCALLY=true python -c "from app.main import app; print('OK')"
```
Expected: no output from py_compile, `OK` printed by the import check.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/ai_engineer.py backend/app/tests/test_ai_engineer.py
git commit -m "feat: wire historical RAG retrieval into AI Engineer chat flow"
```

---

## Post-plan manual verification (not automated — documents expected behavior)

Once a developer has Docker running and has populated `.env`:

1. `docker compose up --build -d`
2. `docker compose exec backend python -m app.scripts.ingest_history --years 2024` (single recent year, faster smoke test than the full 2018-2025 backfill)
3. Confirm log output shows sessions ingested (not all skipped/failed)
4. `curl -X POST localhost:8000/api/v1/ai/chat -H "Content-Type: application/json" -d '{"session_key": 1, "question": "How did the 2024 season go for Verstappen?"}'` — response should reference the ingested 2024 data if an LLM key is configured, or show the historical context in the fallback message if not.
