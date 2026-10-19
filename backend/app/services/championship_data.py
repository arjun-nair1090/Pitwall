"""Loads a season's race results, sprint results and calendar from the Ergast mirror, and serves
the championship odds built from them. The simulator itself lives in championship_sim."""
import time
from typing import Any, Dict, Optional, Tuple

import pandas as pd

from app.services import championship_sim

_CACHE_TTL_SECONDS = 600
_PAGE_SIZE = 100  # the mirror serves at most 100 rows a request
_RETRY_DELAY_SECONDS = 1.0
_sleep = time.sleep  # swapped out in tests

_season_cache: Dict[int, Tuple[float, Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]]] = {}
_odds_cache: Dict[Tuple[int, int], Tuple[float, Dict[str, Any]]] = {}


def clear_cache() -> None:
    _season_cache.clear()
    _odds_cache.clear()


def _page(fetch, year: int, offset: int):
    """One page of results. The mirror answers 429 when pushed, so a failed page is tried once more
    after a pause; a second failure propagates and nothing is cached."""
    try:
        return fetch(season=year, limit=_PAGE_SIZE, offset=offset)
    except Exception:
        _sleep(_RETRY_DELAY_SECONDS)
        return fetch(season=year, limit=_PAGE_SIZE, offset=offset)


def _results(fetch, year: int) -> pd.DataFrame:
    """Every result row of a season in the simulator's shape.

    The mirror's pagination flags are unreliable, so page on the offset until it passes the total."""
    frames = []
    offset = 0
    while True:
        response = _page(fetch, year, offset)
        for (_, desc), content in zip(response.description.iterrows(), response.content):
            if len(content) == 0:
                continue
            frames.append(pd.DataFrame({
                "round": int(desc["round"]),
                "code": content["driverCode"].to_numpy(),
                "name": (content["givenName"].astype(str) + " " + content["familyName"].astype(str)).to_numpy(),
                "team": content["constructorName"].to_numpy(),
                "position": content["position"].to_numpy(),
                "position_text": content["positionText"].astype(str).to_numpy(),
                "points": content["points"].astype(float).to_numpy(),
            }))
        offset += _PAGE_SIZE
        if offset >= int(response.total_results):
            break
    if not frames:
        return pd.DataFrame(columns=championship_sim.RESULT_COLUMNS)
    return pd.concat(frames, ignore_index=True)


def load_season(year: int, ergast=None) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """(races, sprints, schedule) for a season, in the shapes championship_payload takes."""
    if ergast is None:
        from fastf1.ergast import Ergast
        ergast = Ergast()
    races = _results(ergast.get_race_results, year)
    if year >= championship_sim.SPRINT_YEAR_FROM:
        sprints = _results(ergast.get_sprint_results, year)
    else:
        sprints = pd.DataFrame(columns=championship_sim.RESULT_COLUMNS)
    raw = ergast.get_race_schedule(season=year)
    sprint_dates = raw["sprintDate"] if "sprintDate" in raw else pd.Series([None] * len(raw))
    schedule = pd.DataFrame({
        "round": raw["round"].astype(int).to_numpy(),
        "name": raw["raceName"].to_numpy(),
        "date": raw["raceDate"].to_numpy(),
        "sprint": (sprint_dates.notna() & (year >= championship_sim.SPRINT_YEAR_FROM)).to_numpy(),
    })
    return races, sprints, schedule


def _season(year: int) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    cached = _season_cache.get(year)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]
    season = load_season(year)
    _season_cache[year] = (time.time(), season)
    return season


def championship_odds(year: int, after_round: Optional[int]) -> Dict[str, Any]:
    """The odds payload, memoised for ten minutes once the default round is resolved."""
    if year < championship_sim.FIRST_YEAR or year > championship_sim._current_year():
        # Let the simulator word the error; no point fetching a season it will refuse.
        return championship_sim.championship_payload(year, None, None, None, after_round)
    races, sprints, schedule = _season(year)
    cut = after_round
    if cut is None and len(races):
        cut = int(races["round"].max())
    key = (year, cut)
    if cut is not None:
        cached = _odds_cache.get(key)
        if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]
    payload = championship_sim.championship_payload(year, races, sprints, schedule, cut)
    _odds_cache[key] = (time.time(), payload)
    return payload
