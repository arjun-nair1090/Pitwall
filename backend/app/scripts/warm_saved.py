"""Work out ahead of time what each race page and the chatbot open on, so no visitor waits for it.

Runs inside the backend container at the lowest CPU priority, one session at a time, and skips
anything already saved or not synced yet. Sessions that aren't on the server just fail and are skipped.

Usage (in the container):  nice -n 19 python -m app.scripts.warm_saved [YEAR ...]   # default: this season and last
"""
import datetime
import gc
import sys

import app.main  # noqa: F401  configures FastF1's cache exactly as the server does
from app.services import (data_assistant, pit_window, race_battles, race_pace,
                          saved_analyses, win_probability)


def warm(year: int) -> None:
    today = datetime.date.today().isoformat()
    for race in data_assistant._season_schedule(year):
        if race["date"] > today:
            continue
        for session in ["S", "R"] if race["sprint"] else ["R"]:
            rnd = race["round"]
            try:
                race_pace.race_pace_payload(year, "", session, rnd)
                race_battles.race_battles_payload(year, "", session, rnd)
                win_probability.win_probability_replay(year, "", session, rnd, None)
                total = pit_window.pit_window_replay(year, "", session, rnd, 10)["total_laps"]
                # the pit window page asks for lap 10, then opens on a third of the way in
                pit_window.pit_window_replay(year, "", session, rnd, min(max(1, total // 3), max(1, total - 1)))
                print(f"{year} {rnd} {session} ready", flush=True)
            except Exception as e:
                print(f"{year} {rnd} {session} skipped: {e!r}"[:200], flush=True)
            for module in (pit_window, race_pace, race_battles, win_probability):
                module.clear_cache()  # one session in memory at a time on a 1 GB server
            gc.collect()


if __name__ == "__main__":
    saved_analyses.prune_old_versions()
    this_year = datetime.date.today().year
    for y in [int(a) for a in sys.argv[1:]] or [this_year, this_year - 1]:
        warm(y)
