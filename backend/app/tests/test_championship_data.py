import pandas as pd

from app.services import championship_data as cd


class FakeResponse:
    def __init__(self, description, content, total):
        self.description = description
        self.content = content
        self.total_results = total


def _rows(n, offset, code="AAA"):
    return pd.DataFrame({
        "position": [1] * n, "positionText": ["1"] * n, "points": [25.0] * n,
        "driverCode": [code] * n, "givenName": ["Ann"] * n, "familyName": ["Able"] * n,
        "constructorName": ["Team"] * n, "status": ["Finished"] * n,
    })


class FakeErgast:
    def __init__(self, race_total=250, sprint_rows=0, sprint_dates=None):
        self.race_total = race_total
        self.sprint_rows = sprint_rows
        self.offsets = []
        self.sprint_calls = 0
        self.sprint_dates = sprint_dates

    def get_race_results(self, season, limit, offset):
        self.offsets.append(offset)
        n = min(limit, self.race_total - offset)
        # one race (round 1) per page, to prove the round comes from the description row
        desc = pd.DataFrame({"round": [offset // 100 + 1], "raceName": [f"GP {offset // 100 + 1}"]})
        return FakeResponse(desc, [_rows(n, offset)], self.race_total)

    def get_sprint_results(self, season, limit, offset):
        self.sprint_calls += 1
        desc = pd.DataFrame({"round": [2], "raceName": ["GP 2"]})
        if self.sprint_rows == 0:
            return FakeResponse(pd.DataFrame(columns=["round", "raceName"]), [], 0)
        return FakeResponse(desc, [_rows(self.sprint_rows, offset, "BBB")], self.sprint_rows)

    def get_race_schedule(self, season):
        return pd.DataFrame({
            "round": [1, 2, 3],
            "raceName": ["GP 1", "GP 2", "GP 3"],
            "raceDate": pd.to_datetime(["2024-03-02", "2024-03-09", "2024-03-16"]),
            "sprintDate": pd.to_datetime([None, "2024-03-08", None]),
        })


def test_load_season_pages_until_total_results():
    fake = FakeErgast(race_total=250)
    races, _, _ = cd.load_season(2024, fake)
    assert len(races) == 250
    assert fake.offsets == [0, 100, 200]


def test_load_season_maps_ergast_columns():
    fake = FakeErgast(race_total=100, sprint_rows=3)
    races, sprints, schedule = cd.load_season(2024, fake)
    row = races.iloc[0]
    assert row["code"] == "AAA"
    assert row["name"] == "Ann Able"
    assert row["team"] == "Team"
    assert row["position_text"] == "1"
    assert row["round"] == 1
    assert list(sprints["round"].unique()) == [2]
    assert sprints.iloc[0]["code"] == "BBB"
    assert list(schedule["round"]) == [1, 2, 3]
    assert list(schedule["name"]) == ["GP 1", "GP 2", "GP 3"]
    assert [str(d) for d in schedule["date"]][0].startswith("2024-03-02")
    assert list(schedule["sprint"]) == [False, True, False]


def test_load_season_before_2021_has_no_sprints():
    fake = FakeErgast(race_total=100)
    _, sprints, schedule = cd.load_season(2019, fake)
    assert fake.sprint_calls == 0
    assert len(sprints) == 0
    assert not schedule["sprint"].any()


def test_load_season_with_no_races_returns_empty_frames():
    fake = FakeErgast(race_total=0)
    fake.get_race_results = lambda season, limit, offset: FakeResponse(
        pd.DataFrame(columns=["round", "raceName"]), [], 0)
    races, _, _ = cd.load_season(2024, fake)
    assert len(races) == 0
    assert list(races.columns) == ["round", "code", "name", "team", "position", "position_text", "points"]
