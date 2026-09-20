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
                print(f"Skipping {year} {event_name} ({session_display}) -- {e}")

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
