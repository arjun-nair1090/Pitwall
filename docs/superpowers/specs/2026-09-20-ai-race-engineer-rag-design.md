# AI Race Engineer — Real RAG (Historical Retrieval)

Status: approved, not yet implemented
Date: 2026-09-20
Relates to: `PITWALL_FIX_AND_FEATURE_ROADMAP.md` Part 1 item 2, Part 3 Phase 1 ("Real RAG")

## Problem

The README no longer claims RAG/ChromaDB (that mismatch was already fixed), but the underlying
gap is still real: `ai_engineer.py` only ever sees the *current live session* (timing, weather,
race control). It has no way to answer cross-season questions ("how did Verstappen's tire
strategy at Spa compare across the last few years") because there is no historical corpus and
no retrieval step. `chromadb` is already in `backend/requirements.txt` and already provisioned
as a service in `docker-compose.yml` — nothing in the backend uses it yet.

This spec covers making that real: an offline ingestion pipeline that builds a historical corpus
from FastF1 data, and a retrieval step wired into the existing LangGraph flow in `ai_engineer.py`.

## Goals

- Answer questions across seasons, not just the live session, by retrieving relevant historical
  race documents and feeding them into the same LLM call the AI Engineer already makes.
- Never make live chat depend on Chroma being up or the corpus existing — retrieval failure
  degrades to today's live-only behavior, not an error.
- No new hard API-key requirement (embeddings run locally).
- Ingestion must be resumable: a multi-hour first run (full history since 2018) will get
  interrupted, and re-running it must not restart from scratch or re-embed already-indexed
  sessions.

## Non-goals (deferred to later work)

- **AI Race Debrief** (auto-generated post-session summary) and **what-if counterfactuals**
  (hypothetical strategy reasoning) — these are the other two bullets under Phase 1 in the
  roadmap. They can reuse the summary-formatting building blocks this spec introduces, but are
  separate features with their own design pass.
- A UI for browsing/inspecting the historical corpus.
- Re-embedding/versioning if the summary format changes later (out of scope for v1; would be a
  "bump a schema version in the doc id and re-ingest" problem when it comes up).

## Architecture

Two new pieces, both additive to the existing codebase:

```
                        ┌─────────────────────────┐
  CLI (manual run)  ──▶ │ scripts/ingest_history.py│──▶ FastF1 (per session)
                        └───────────┬─────────────┘
                                    │ upsert (id, document, metadata)
                                    ▼
                        ┌─────────────────────────┐
                        │   ChromaDB collection    │
                        │     "f1_race_history"    │
                        └───────────┬─────────────┘
                                    │ query (top-k)
                                    ▼
                        ┌─────────────────────────┐
  /api/v1/ai/chat   ──▶ │  ai_engineer.py graph:    │
                        │  retrieve_context (live) │
                        │  retrieve_historical (RAG)│──▶ generate_response ──▶ response
                        └─────────────────────────┘
```

`retrieve_context` (live) and `retrieve_historical` (RAG) are independent LangGraph nodes that
both feed `generate_response`; neither depends on the other, and either can fail without taking
down the other.

## Data model

**Collection**: `f1_race_history` (single collection, no per-year sharding — Chroma handles
this scale fine, and a single collection keeps queries simple).

**Document granularity**: one document per (year, event, session, driver) — a prose summary, not
raw lap rows. Example:

```
Max Verstappen (Red Bull Racing) finished P1 at the 2023 Belgian Grand Prix (Race).
Strategy: started on MEDIUM (laps 1-13, degrading ~0.08s/lap average), pitted lap 13
for HARD (laps 14-44, degrading ~0.05s/lap average). 1 pit stop, ~2.3s stationary.
Fastest lap: 1:47.291 on lap 40 (HARD tire).
Race control: no safety car periods, no rainfall recorded.
```

**Metadata** (Chroma metadata dict, used for citation and for the doc id — not for filtering
in v1, though it's there if a future feature wants `where=` filters):
```python
{
  "year": 2023,
  "event": "Belgian Grand Prix",   # session.event['EventName']
  "session": "Race",               # R/Q/FP1/FP2/FP3/Sprint/SQ, normalized to full name
  "driver_code": "VER",
  "team": "Red Bull Racing",
}
```

**Document id** (deterministic, for `upsert` idempotency and for the "already ingested, skip"
check): `f"{year}_{event_slug}_{session_slug}_{driver_code}"`, e.g. `2023_belgian-gp_race_ver`.
`event_slug`/`session_slug` are lowercased, spaces replaced with `-`.

## Ingestion pipeline — `backend/app/scripts/ingest_history.py`

Run manually (not on app startup — a multi-hour job has no business running in a web server's
lifespan):

```bash
python -m app.scripts.ingest_history --years 2018-2025
python -m app.scripts.ingest_history --years 2026          # pick up a newly-completed season later
```

Per (year, event) from `fastf1.get_event_schedule(year)` (reusing the same testing-event filter
already used in `endpoints.py`'s `/races/historical`), for each real session type:

1. **Skip check first, before loading the session**: query Chroma for any doc id matching
   `{year}_{event_slug}_{session_slug}_*`. If results exist, skip — this is what makes reruns
   fast, since a FastF1 `session.load()` is the ~30s+ expensive part, not the embedding.
2. Otherwise `fastf1.get_session(year, event, session_type)`, `session.load(laps=True,
   weather=False, telemetry=False)` (telemetry is not needed for summaries — much faster/lighter
   than the per-lap telemetry loads elsewhere in the codebase).
3. For each driver in `session.laps['Driver'].unique()`, build the summary via a **pure function**
   `build_driver_session_summary(laps_df, driver_code, event_name, year, session_name) -> tuple[str, dict]`
   (text, metadata) that only takes already-loaded FastF1 dataframes — no I/O. This is the
   function unit tests exercise directly, without touching FastF1 or Chroma.
   - Stints: group by FastF1's `Stint` column, compound = first row's `Compound` per stint.
     Degradation trend = `(last_lap_time - first_lap_time) / (num_laps_in_stint - 1)` seconds/lap
     for that stint, using only clean laps (exclude the in-lap/out-lap, i.e. rows where
     `PitInTime`/`PitOutTime` is not null, and any lap FastF1 flags via `IsAccurate == False` if
     that column is present). Stints with fewer than 3 clean laps report "insufficient laps for
     a trend" instead of a computed number rather than dividing by a near-zero denominator.
   - Pit stops: count of stints minus 1; stationary time approximated from the existing
     `PitInTime`/`PitOutTime` columns already used in `_get_historical_replay_sync`.
   - Fastest lap: `laps.pick_fastest()`, same pattern as `_get_head_to_head_telemetry_sync`.
   - Result/position: last lap's `Position`, or `session.results` if loaded and available.
   - Race control: reuse whatever's cheaply available from `session.race_control_messages` if
     loaded; if empty/unavailable, omit that line rather than guessing.
4. `collection.upsert(ids=[...], documents=[...], metadatas=[...])` — one batch per session
   (all drivers for that session in one call).
5. Catch and log (print + continue) any exception per-session — a corrupt/missing season for one
   old event must not abort the whole run. Track and print a final summary (sessions ingested /
   skipped / failed) at the end.

**Embedding function**: Chroma's default (`chromadb.utils.embedding_functions
.DefaultEmbeddingFunction`, sentence-transformers `all-MiniLM-L6-v2` under the hood, ONNX
runtime — no `sentence-transformers` package needed, it's bundled via `chromadb`'s own
dependency). Downloaded once (~80MB) and cached under Chroma's persistence dir on first use.

## Retrieval integration — `ai_engineer.py`

New function in a new `rag_service.py` (kept separate from `ai_engineer.py` so the engineer
module doesn't grow a second responsibility):

```python
def query_historical_context(question: str, n_results: int = 5) -> str:
    """Returns a markdown section, or "" if Chroma is unreachable or the corpus is empty."""
```

Internally: get-or-create the `f1_race_history` collection via a lazily-constructed
`chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)`, `collection.query
(query_texts=[question], n_results=n_results)`, format hits as:

```
## Historical Context (RAG)
- [2023 Belgian Grand Prix — Race — VER]: <document text>
- [2022 Belgian Grand Prix — Race — VER]: <document text>
...
```

Any exception (connection refused, collection doesn't exist yet, etc.) is caught and logged;
the function returns `""` in that case.

**LangGraph wiring** in `ai_engineer.py`: add a `retrieve_historical_node` parallel to the
existing `retrieve_context_node`, both wired `START -> {retrieve_context, retrieve_historical}
-> generate_response -> END`. `generate_response_node` concatenates
`state["context_md"] + "\n\n" + state["historical_md"]` (empty string is a no-op concatenation)
before calling `call_llm`. The existing system prompt in `call_llm` already instructs the model
to only use context it's actually given and say so when something's missing — no prompt changes
needed beyond the added section being present when non-empty.

## Config changes — `core/config.py`

Same pattern as `POSTGRES_HOST`/`REDIS_URL`:

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

Add both vars to `.env.example` with a comment.

## Error handling / degradation behavior

| Failure | Behavior |
|---|---|
| Chroma service down/unreachable | `query_historical_context` catches, returns `""`; chat proceeds live-only |
| Corpus not yet ingested (empty collection) | Chroma returns zero hits; formatted section is empty; same as above |
| One session fails during ingestion (missing FastF1 data, network hiccup) | Logged, skipped, run continues to the next session |
| Ingestion interrupted (Ctrl-C, crash, timeout) | Rerun is safe — already-ingested sessions are skipped via the pre-load id check |

## Testing

- Unit tests for `build_driver_session_summary` using small hand-built FastF1-shaped
  `pandas.DataFrame`s (no real FastF1 call) — covers: single-stint no-pit-stop case, multi-stint
  case, a lap with `PitInTime` correctly excluded from degradation-trend calc.
- Unit tests for `query_historical_context` against Chroma's `EphemeralClient()` (in-memory, no
  server) with a fake/no-op embedding function (`chromadb.utils.embedding_functions
  .DefaultEmbeddingFunction` is skipped in tests to avoid a model download in CI — use a trivial
  hash-based fake embedding function that satisfies Chroma's interface) — covers: hit formatting,
  empty-collection case, and an unreachable-client case (raise inside a monkeypatched client to
  confirm the empty-string fallback).
  - These tests must not require the real `chromadb` docker service or a network-downloaded
    model; the existing `.github/workflows/ci.yml` backend job does not start a Chroma
    container, so any test that needs a live server would fail CI.
- Existing `test_endpoints.py`/`test_f1_data_service.py` are unaffected; no changes to
  already-covered behavior.

## Rollout notes

- First real run (`--years 2018-2025`) is a multi-hour, one-time, manual operation — not part of
  CI, not part of `docker-compose up`. Document the command in the README under a new "Seeding
  historical data (optional)" section.
- Until that script has been run at least once, the AI Engineer behaves exactly as it does
  today (live-only) — this ships safely with an empty corpus.
