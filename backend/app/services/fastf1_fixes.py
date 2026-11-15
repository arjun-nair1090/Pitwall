"""Patches for F1 timing archive quirks that FastF1 doesn't handle yet. Imported for its side effect.

The 2026 Mexico City race feed opened a day early, so its lines run past 24 hours and are stamped
"[D]D.HH:MM:SS.mmm". FastF1 3.9.1 handles that for timing data, but its car data and position
parsers still slice a fixed 12-character "HH:MM:SS.mmm" off each line, so everything after the
first day is lost. Dropping the day part matches what 3.9.1 does for timing data.
"""
import functools

import fastf1._api
import fastf1.core

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


# F1's driver list can hold the text "None" for a stand-in's name, team and colour (Hirakawa at the
# 2026 Mexico City GP: "None None", "None", "None"), which every page and the assistant then show.
_PLACEHOLDERS = {"None", "None None", "nan", ""}
_TEXT_COLUMNS = ("FirstName", "LastName", "FullName", "TeamName", "TeamColor")


def fill_placeholders(results):
    """Blank the "None" text, then take the team and its colour from a team-mate with the same TeamId.
    A blanked name stays blank, so pages fall back to the driver's code."""
    if results is None or results.empty:
        return results
    for col in _TEXT_COLUMNS:
        if col in results:
            results[col] = results[col].where(~results[col].astype(str).str.strip().isin(_PLACEHOLDERS))
    if "TeamId" in results:
        for col in ("TeamName", "TeamColor"):
            if col in results:
                results[col] = results[col].fillna(results.groupby("TeamId")[col].transform("first"))
    return results


def cleaned_results(load):
    @functools.wraps(load)
    def _load_drivers_results(self, *args, **kwargs):
        load(self, *args, **kwargs)
        fill_placeholders(self._results)
    _load_drivers_results.pitwall_cleaned = True
    return _load_drivers_results


# FastF1 decorates this method itself, so __wrapped__ can't tell whether it is patched already
if not getattr(fastf1.core.Session._load_drivers_results, "pitwall_cleaned", False):
    fastf1.core.Session._load_drivers_results = cleaned_results(fastf1.core.Session._load_drivers_results)
