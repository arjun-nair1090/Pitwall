"""Patches for F1 timing archive quirks that FastF1 doesn't handle yet. Imported for its side effect.

The 2026 Mexico City race feed opened a day early, so its lines run past 24 hours and are stamped
"[D]D.HH:MM:SS.mmm". FastF1 3.9.1 handles that for timing data, but its car data and position
parsers still slice a fixed 12-character "HH:MM:SS.mmm" off each line, so everything after the
first day is lost. Dropping the day part matches what 3.9.1 does for timing data.
"""
import functools

import fastf1._api

_RAW_PAGES = ("car_data", "position")  # the pages FastF1 returns as raw lines


def _strip_day(line: str) -> str:
    return line if line[2:3] == ":" else line[line.index(".") + 1:]


def day_tolerant(fetch):
    @functools.wraps(fetch)
    def fetch_page(path, name):
        result = fetch(path, name)
        if name in _RAW_PAGES and isinstance(result, list):
            return [_strip_day(line) for line in result]
        return result
    return fetch_page


# ponytail: drop once FastF1 parses day-prefixed car/position lines itself (not in 3.9.1).
if not hasattr(fastf1._api.fetch_page, "__wrapped__"):
    fastf1._api.fetch_page = day_tolerant(fastf1._api.fetch_page)
