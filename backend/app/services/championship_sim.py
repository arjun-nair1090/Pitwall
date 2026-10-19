"""Championship title odds from a Monte Carlo of the races and sprints still to run.

Every driver's form is the recency-weighted mean of their classified race finishes, nudged towards
the middle of the field by one pseudo-race. Each remaining event is then drawn independently:
every entrant gets form plus noise, may retire, and the finishers score by their rank. Nothing
here knows about pace, tyres, circuits or car development, and the fastest-lap point is not drawn,
so the odds are a read of the points table and recent results, not a forecast. The odds are
reproducible: the generator is seeded from the year and the cut-off round.

Takes tidy DataFrames (see the column lists below) so it never touches the network.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

FIRST_YEAR = 2018
SPRINT_YEAR_FROM = 2021

RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1]
SPRINT_POINTS_2021 = [3, 2, 1]
FASTEST_LAP_YEARS = range(2019, 2025)

N_SIMS = 10_000
HISTORY_SIMS = 2_000
# A result's weight halves every six rounds.
HALF_LIFE = 6.0
# One pseudo-race at the field midpoint, so a driver with a single result isn't taken at face value.
PRIOR_WEIGHT = 1.0
SIGMA_FLOOR = 2.0
# Pseudo-starts at the field's retirement rate.
RETIREMENT_K = 4

RESULT_COLUMNS = ["round", "code", "name", "team", "position", "position_text", "points"]


class ChampionshipError(Exception):
    """A request the odds can't answer: 404 when nothing has been run, 422 for a bad year or round."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def _current_year() -> int:
    return datetime.now().year


def _sprint_table(year: int) -> List[int]:
    return SPRINT_POINTS_2021 if year == 2021 else SPRINT_POINTS


def _max_remaining(year: int, races_left: int, sprints_left: int) -> Tuple[float, float]:
    """Most points a driver and a constructor can still score: wins, plus the fastest-lap point
    where one is awarded, and a sprint win (or a sprint one-two for a team)."""
    bonus = 1 if year in FASTEST_LAP_YEARS else 0
    sprint = _sprint_table(year)
    driver = races_left * (RACE_POINTS[0] + bonus) + sprints_left * sprint[0]
    team = races_left * (RACE_POINTS[0] + RACE_POINTS[1] + bonus) + sprints_left * (sprint[0] + sprint[1])
    return float(driver), float(team)


def _frame(df: Optional[pd.DataFrame]) -> pd.DataFrame:
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=RESULT_COLUMNS)
    return df


def _classified(rows: pd.DataFrame) -> pd.Series:
    """A finish counts for form only when it is classified: positionText is all digits."""
    return rows["position_text"].astype(str).str.isdigit() & rows["position"].notna()


def _driver_table(races: pd.DataFrame, sprints: pd.DataFrame, cut: int) -> pd.DataFrame:
    """One row per driver seen up to the cut-off: points, wins, seconds, and their latest name and team."""
    r = races[races["round"] <= cut].sort_values("round", kind="stable")
    s = sprints[sprints["round"] <= cut]
    latest = r.drop_duplicates("code", keep="last").set_index("code")
    table = pd.DataFrame({"name": latest["name"], "team": latest["team"]})
    points = pd.concat([f for f in (r, s) if len(f)]).groupby("code")["points"].sum()
    table["points"] = points.reindex(table.index).fillna(0.0).astype(float).round(3)
    for column, place in (("wins", 1), ("seconds", 2)):
        count = r[r["position"] == place].groupby("code").size()
        table[column] = count.reindex(table.index).fillna(0).astype(int)
    return table


def _team_points(races: pd.DataFrame, sprints: pd.DataFrame, cut: int) -> pd.Series:
    rows = pd.concat([f for f in (races[races["round"] <= cut], sprints[sprints["round"] <= cut]) if len(f)])
    return rows.groupby("team")["points"].sum().astype(float).round(3)


def _entrants(races: pd.DataFrame, cut: int) -> List[str]:
    """Whoever raced the cut-off round (the latest earlier one if it left no rows)."""
    upto = races[races["round"] <= cut]
    last = upto[upto["round"] == upto["round"].max()]
    return list(dict.fromkeys(last["code"]))


def _form(races: pd.DataFrame, codes: List[str], cut: int) -> Tuple[np.ndarray, float]:
    """Each entrant's expected finishing position, and the noise around it."""
    n = len(codes)
    midpoint = (n + 1) / 2
    upto = races[(races["round"] <= cut) & races["code"].isin(codes)]
    upto = upto[_classified(upto)]
    weight = 0.5 ** ((cut - upto["round"].to_numpy(dtype=float)) / HALF_LIFE)
    position = upto["position"].to_numpy(dtype=float)
    idx = pd.Index(codes).get_indexer(upto["code"])
    total = np.bincount(idx, weights=weight * position, minlength=n)
    mass = np.bincount(idx, weights=weight, minlength=n)
    mu = (total + PRIOR_WEIGHT * midpoint) / (mass + PRIOR_WEIGHT)
    if weight.sum() == 0:
        return mu, SIGMA_FLOOR
    sigma = float(np.sqrt((weight * (position - mu[idx]) ** 2).sum() / weight.sum()))
    return mu, max(sigma, SIGMA_FLOOR)


def _retirement_chances(races: pd.DataFrame, codes: List[str]) -> np.ndarray:
    """Chance each entrant fails to be classified in a race: their own record, pulled towards the field's."""
    if len(races) == 0:
        return np.zeros(len(codes))
    field_rate = 1.0 - _classified(races).mean()
    idx = pd.Index(codes).get_indexer(races["code"])
    known = idx >= 0
    starts = np.bincount(idx[known], minlength=len(codes))
    dnfs = np.bincount(idx[known], weights=(~_classified(races)).to_numpy()[known], minlength=len(codes))
    return (dnfs + RETIREMENT_K * field_rate) / (starts + RETIREMENT_K)


def _event_tables(year: int, schedule: pd.DataFrame, cut: int, n: int) -> Tuple[np.ndarray, np.ndarray]:
    """Points by finishing place for each event still to run, and which of them are races."""
    tables, is_race = [], []
    for _, row in schedule[schedule["round"] > cut].iterrows():
        if bool(row["sprint"]) and year >= SPRINT_YEAR_FROM:
            tables.append(_sprint_table(year))
            is_race.append(False)
        tables.append(RACE_POINTS)
        is_race.append(True)
    padded = np.zeros((len(tables), n))
    for i, t in enumerate(tables):
        padded[i, :min(n, len(t))] = t[:n]
    return padded, np.array(is_race, dtype=bool)


def _simulate(rng, sims: int, mu: np.ndarray, sigma: float, p: np.ndarray,
              tables: np.ndarray, is_race: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Points, wins and seconds each entrant adds over the events, per simulation: (sims, n) each."""
    events, n = tables.shape
    points = np.zeros((sims, n))
    wins = np.zeros((sims, n))
    seconds = np.zeros((sims, n))
    if events == 0:
        return points, wins, seconds
    rows = np.arange(sims)
    # Drawn one event at a time, so memory stays at (sims, n) however long the season left is.
    for e in range(events):
        draw = mu + sigma * rng.standard_normal((sims, n))
        retired = rng.random((sims, n)) < p
        draw[retired] = np.inf
        order = np.argsort(draw, axis=1)
        scored = np.zeros((sims, n))
        np.put_along_axis(scored, order, np.broadcast_to(tables[e], (sims, n)), axis=1)
        alive = ~retired
        points += scored * alive
        if is_race[e]:
            wins[rows, order[:, 0]] += alive[rows, order[:, 0]]
            if n > 1:
                seconds[rows, order[:, 1]] += alive[rows, order[:, 1]]
    return points, wins, seconds


def _countback_key(points: np.ndarray, wins: np.ndarray, seconds: np.ndarray) -> np.ndarray:
    """One sortable number per driver: points, then wins, then seconds."""
    return np.round(points, 3) * 1e6 + wins * 1e3 + seconds


def _title_share(key: np.ndarray) -> np.ndarray:
    """Share of simulations each column tops; a tie for first is split equally."""
    tied = key == key.max(axis=1, keepdims=True)
    return (tied / tied.sum(axis=1, keepdims=True)).mean(axis=0)


def _status(points: np.ndarray, reach: np.ndarray, i: int) -> str:
    """Clinched beats eliminated; both are about points alone, so ties are neither."""
    others = np.delete(reach, i)
    if len(others) == 0 or points[i] > others.max():
        return "clinched"
    if reach[i] < points.max():
        return "eliminated"
    return "contender"


def _model(year: int, races: pd.DataFrame, sprints: pd.DataFrame, schedule: pd.DataFrame,
           cut: int, sims: int) -> Dict[str, Any]:
    """The whole simulation for one cut-off."""
    upto = races[races["round"] <= cut]
    drivers = _driver_table(races, sprints, cut)
    teams = _team_points(races, sprints, cut)
    entrants = _entrants(races, cut)
    n = len(entrants)

    tables, is_race = _event_tables(year, schedule, cut, n)
    races_left = int(is_race.sum())
    sprints_left = len(is_race) - races_left
    driver_reach, team_reach = _max_remaining(year, races_left, sprints_left)

    mu, sigma = _form(races, entrants, cut)
    p = _retirement_chances(upto, entrants)
    rng = np.random.default_rng(year * 100 + cut)
    gain, win_gain, second_gain = _simulate(rng, sims, mu, sigma, p, tables, is_race)

    codes = list(drivers.index)
    col = pd.Index(codes).get_indexer(entrants)
    final = np.tile(drivers["points"].to_numpy(), (sims, 1))
    final_wins = np.tile(drivers["wins"].to_numpy(dtype=float), (sims, 1))
    final_seconds = np.tile(drivers["seconds"].to_numpy(dtype=float), (sims, 1))
    final[:, col] += gain
    final_wins[:, col] += win_gain
    final_seconds[:, col] += second_gain
    key = _countback_key(final, final_wins, final_seconds)

    team_names = list(teams.index)
    onehot = np.zeros((n, len(team_names)))
    onehot[np.arange(n), pd.Index(team_names).get_indexer(drivers["team"].to_numpy()[col])] = 1
    team_final = teams.to_numpy() + gain @ onehot

    racing = np.isin(codes, entrants)
    points = drivers["points"].to_numpy()
    reach = np.where(racing, points + driver_reach, points)
    return {
        "drivers": drivers, "teams": teams, "racing": racing, "reach": reach,
        "team_reach": teams.to_numpy() + team_reach,
        "driver_odds": _title_share(key),
        "team_odds": _title_share(np.round(team_final, 3)),
        "final": final, "team_final": team_final,
    }


def _history(year, races, sprints, schedule, after_round) -> List[Dict[str, Any]]:
    """Title odds as they stood after each round, from the same model on the results then."""
    names = dict(zip(schedule["round"], schedule["name"]))
    out = []
    for r in range(1, after_round + 1):
        odds: Dict[str, float] = {}
        if (races["round"] <= r).any():
            m = _model(year, races, sprints, schedule, r, HISTORY_SIMS)
            odds = {c: round(float(o), 4) for c, o in zip(m["drivers"].index, m["driver_odds"])}
            odds = {c: o for c, o in odds.items() if o > 0}
        out.append({"round": r, "name": names.get(r, f"Round {r}"), "odds": odds})
    return out


def _prob(x: float) -> float:
    return round(float(x), 4)


def _pts(x: float) -> float:
    return round(float(x), 1) + 0.0


def championship_payload(year: int, races: pd.DataFrame, sprints: pd.DataFrame, schedule: pd.DataFrame,
                         after_round: Optional[int]) -> Dict[str, Any]:
    current = _current_year()
    if year < FIRST_YEAR or year > current:
        raise ChampionshipError(f"Championship odds cover {FIRST_YEAR} to {current}.", 422)
    races, sprints = _frame(races), _frame(sprints)
    completed = sorted(int(r) for r in races["round"].unique())
    if not completed:
        raise ChampionshipError(f"No races have been run in {year} yet.", 404)
    cut = completed[-1] if after_round is None else int(after_round)
    if cut < 1:
        raise ChampionshipError("Pick a round from 1.", 422)
    if cut > completed[-1]:
        raise ChampionshipError(f"Round {cut} of {year} hasn't been run yet.", 422)

    m = _model(year, races, sprints, schedule, cut, N_SIMS)
    drivers, teams = m["drivers"], m["teams"]
    names = dict(zip(schedule["round"], schedule["name"]))
    codes = list(drivers.index)
    points = drivers["points"].to_numpy()

    rows = []
    for i, code in enumerate(codes):
        status = _status(points, m["reach"], i)
        # Someone who isn't on the grid is "not racing", not "eliminated": that is what a fan reads.
        if status != "clinched" and not m["racing"][i]:
            status = "not racing"
        rows.append({
            "code": code,
            "name": drivers.loc[code, "name"],
            "team": drivers.loc[code, "team"],
            "points": _pts(points[i]),
            "wins": int(drivers.loc[code, "wins"]),
            "title_probability": _prob(m["driver_odds"][i]),
            "expected_points": _pts(m["final"][:, i].mean()),
            "points_p10": _pts(np.percentile(m["final"][:, i], 10)),
            "points_p90": _pts(np.percentile(m["final"][:, i], 90)),
            "max_points": _pts(m["reach"][i]),
            "status": status,
            "_sort": (-points[i], -int(drivers.loc[code, "wins"]), code),
        })
    rows.sort(key=lambda d: d["_sort"])
    for d in rows:
        del d["_sort"]

    team_points = teams.to_numpy()
    constructors = [{
        "team": team,
        "points": _pts(team_points[i]),
        "title_probability": _prob(m["team_odds"][i]),
        "expected_points": _pts(m["team_final"][:, i].mean()),
        "status": _status(team_points, m["team_reach"], i),
        "_sort": (-team_points[i], team),
    } for i, team in enumerate(teams.index)]
    constructors.sort(key=lambda c: c["_sort"])
    for c in constructors:
        del c["_sort"]

    left = schedule[schedule["round"] > cut]
    return {
        "year": year,
        "after_round": cut,
        "completed_rounds": len(completed),
        "total_rounds": len(schedule),
        "simulations": N_SIMS,
        "rounds": [{"round": r, "name": names.get(r, f"Round {r}")} for r in completed],
        "remaining": [{
            "round": int(row["round"]), "name": row["name"], "date": str(row["date"])[:10],
            "sprint": bool(row["sprint"]) and year >= SPRINT_YEAR_FROM,
        } for _, row in left.iterrows()],
        "drivers": rows,
        "constructors": constructors,
        "history": _history(year, races, sprints, schedule, cut),
    }
