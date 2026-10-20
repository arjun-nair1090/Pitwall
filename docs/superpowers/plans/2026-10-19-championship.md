# Championship Odds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "Championship odds" page. For any season since 2018, it gives every driver's and team's chance of winning the title after any round. Odds come from a Monte Carlo simulation of the races still to run, with a chart of how the odds moved round by round.

**Architecture:**
- A loader (`championship_data.py`) pages through the Ergast mirror for a season's race results, sprint results and schedule, and returns tidy DataFrames.
- A pure numpy/pandas simulator (`championship_sim.py`) turns those into one payload: points so far, title odds, expected points, clinched/eliminated status and odds history.
- One POST endpoint serves it with a 600 s memo.
- The frontend is a new `/championship` module with four panels: odds table, odds-through-the-season chart, constructors table and races still to run.

**Tech Stack:** FastAPI, FastF1 3.8.3 (`fastf1.ergast`), numpy, pandas, pytest; Next.js 14, React 18, TypeScript, Tailwind, Recharts 3, Vitest, Testing Library.

**Spec:** None. The user asked for a "championship Monte Carlo simulator" (feature 3 of 8) and skipped the design conversation. The Definitions below are the authority.

## Definitions

**Data source.** All data comes from the Ergast mirror through `fastf1.ergast.Ergast`. The mirror works; FastF1 live timing does not.
- The mirror returns at most 100 rows per request, so every results call pages with `limit=100, offset=k` until `offset >= response.total_results`.
- A season has 400–530 race rows.

**Coverage.**
- **Seasons:** 2018 to the current calendar year.
  - Any other year is a 422 with `Championship odds cover 2018 to {current}.`
- **Completed rounds:** rounds with at least one race result row. If there are none, the response is a 404 with `No races have been run in {year} yet.`
- **`after_round`:** an integer from 1 to the last completed round. It defaults to the last completed round.
  - Above that, the response is a 422 with `Round {n} of {year} hasn't been run yet.`
  - Below 1, the response is a 422 with `Pick a round from 1.`
- **Remaining rounds:** schedule rounds greater than `after_round`.
  - A round is a sprint weekend when the schedule's `sprintDate` is not null and the year is 2021 or later.

**Points.**
- **Points so far:** the sum of the Ergast `points` column over the race and sprint results of rounds ≤ `after_round`, per driver code.
  - Fractional points are kept as floats (Spa 2021 paid half points).
  - Ergast's points already include fastest-lap points and disqualifications.
- **Wins so far:** race results with `position == 1` in rounds ≤ `after_round`. Sprints don't count. The same rule gives seconds so far.
- **Team of a driver:** the `constructorName` of their latest race row at or before `after_round`.
- **Constructor points so far:** the sum of points by `constructorName`, over the race and sprint rows of rounds ≤ `after_round`.
- **Points tables:**
  - `RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]`.
  - `SPRINT_POINTS`: `{2021: [3, 2, 1]}`, otherwise `[8, 7, 6, 5, 4, 3, 2, 1]`.
  - `FASTEST_LAP_YEARS = range(2019, 2025)`.
- **Max remaining points (per driver):**
  - 25 per remaining race, plus 1 more per remaining race in a `FASTEST_LAP_YEARS` season;
  - plus the year's sprint winner's points per remaining sprint.
- **Max remaining points (per constructor):**
  - 43 (25 + 18) per remaining race, plus 1 more per remaining race in a `FASTEST_LAP_YEARS` season;
  - plus the sum of the year's top two sprint scores per remaining sprint (5 in 2021, 15 otherwise).
- **Clinched:** the driver's points so far are greater than every other driver's points so far plus max remaining. A tie is not clinched, because countback could still decide it. Constructors use the same rule with their own max remaining.
- **Eliminated:** points so far + max remaining < the leader's points so far.
- **Not racing:** the driver is not in the race results of round `after_round`. They keep their points but score nothing in the simulation.

**Model.** Each remaining race and sprint is simulated independently, `N_SIMS = 10_000` times.
- **Classified finish:** `positionText` is all digits. Anything else (R, D, E, W, F, N) is a non-finish. A disqualification counts as a non-finish for form.
- **Recency weight of round r:** `0.5 ** ((after_round − r) / HALF_LIFE)`, with `HALF_LIFE = 6`.
- **Form μ_d:** the recency-weighted mean of driver d's classified race finishing positions over rounds ≤ `after_round`, plus `PRIOR_WEIGHT = 1.0` pseudo-race at the field midpoint `(n_entrants + 1) / 2`. Sprints don't feed form.
- **Noise σ:** the recency-weighted standard deviation of `(position − μ_d)` over all classified race finishes of all entrants, floored at `SIGMA_FLOOR = 2.0`.
- **Retirement chance p_d:** `(non_finishes_d + K · field_rate) / (starts_d + K)`, with `K = 4`.
  - `field_rate` is the field's non-finishes over starts, over rounds ≤ `after_round`.
  - A start is a race row.
- **One simulated event:**
  1. Each entrant draws `μ_d + σ·Z` and retires with probability p_d.
  2. Finishers are ranked by their draw, lowest first.
  3. Positions 1..k score from the event's points table, and retirements score 0.
  4. A simulated win is a P1 in a race, and the same rule gives a simulated second.

  The fastest-lap point is not simulated (Ruling C1).
- **Entrants:** the drivers in the race results of round `after_round`.
- **RNG:** `numpy.random.default_rng(year * 100 + after_round)`, so the same request always gives the same odds.
- **Title odds:** the share of simulations in which the driver finishes first on points.
  - Ties go to more wins, actual plus simulated, then more seconds.
  - A tie still unbroken after that is split equally among those drivers.
  - Constructors work the same way on summed driver points, with ties split equally.
- **Expected points:** the mean final points.
- **Range:** the 10th and 90th percentiles of final points.
- **Odds history:** for each cut-off `r = 1..after_round`, rerun the whole model on rounds ≤ r with `HISTORY_SIMS = 2_000` and RNG seed `year * 100 + r`. Record driver title odds, dropping zeros.

**Payload.** It is returned bare, not wrapped in `data`.

```
{
  year, after_round, completed_rounds, total_rounds, simulations,
  rounds: [{round, name}],
  remaining: [{round, name, date, sprint}],
  drivers: [{code, name, team, points, wins, title_probability, expected_points, points_p10,
             points_p90, max_points, status}],
  constructors: [{team, points, title_probability, expected_points, status}],
  history: [{round, name, odds: {CODE: probability}}]
}
```

- `rounds` lists every completed round in order, to fill the After round picker.
- `date` is ISO `YYYY-MM-DD`.
- `max_points` = points so far + max remaining, or points so far when not racing.
- `status`:
  - drivers: `"clinched" | "eliminated" | "not racing" | "contender"`, in that precedence;
  - constructors: `"clinched" | "eliminated" | "contender"`.
- Drivers are sorted by points, then wins, both descending. Constructors are sorted by points descending.
- Probabilities are floats in [0, 1], rounded to 4 decimal places.
- Points, expected points and percentiles are rounded to 1 decimal place.

**Rulings made in this plan:**
- **C1 (fastest-lap point):** the fastest-lap point (2019–2024) is not simulated, because it is worth at most 1 point a race and depends on strategy. It is in max remaining, so nobody is eliminated or crowned too early.
- **C2 (form):** form uses race finishing positions only, not qualifying or lap times. Ergast has them for every season, and they are explainable.
- **C3 (entry list):** entrants are whoever raced the cut-off round. A driver replaced mid-season keeps their points as "not racing", and a substitute is simulated from their own few results plus the prior.
- **C4 (team colours):** Ergast's team names are mapped to colours in `frontend/src/lib/timing.ts`. Add `["rb f1 team", "#6692FF"]`, `["racing point", "#F596C8"]`, `["force india", "#F596C8"]` and `["renault", "#FFF500"]`. Audi and Cadillac stay neutral, because no confirmed colour exists.

## Global Constraints

- Commits: `git -c user.name="Arjun Nair" -c user.email=headhunter10900@gmail.com commit …`. No Co-Authored-By trailers, and never mention Claude or AI anywhere.
- Backend tests run from `backend/`: `SECRET_KEY=ci-test-secret-key RUNNING_LOCALLY=true python -m pytest -q -p no:cacheprovider`, using the system python.
- Unit tests never hit the network. The simulator takes DataFrames, and endpoint tests monkeypatch the loader.
- Frontend checks run from `frontend/`: `npx vitest run`, `npx tsc --noEmit` and `node scripts/check-legacy.mjs --all`.
- House style:
  - sentence case in copy;
  - `uppercase` only together with `font-display`;
  - no `text-white`;
  - colours from Tailwind tokens in className, never hex.
- The axios mock resolves `{ data: PAYLOAD }` and the component reads `res.data`. Check the real shape with curl before trusting a mock.
- Recharts 3: a `LineChart` forces the axis tooltip mode, so never add a `Scatter` to it. Use custom `dot`s.
- `modules.test` keeps exactly five `mobilePrimary` modules.
- Never touch `C:\Users\arjun\f1-pitwall` (the user's main checkout).

## Review Focus

1. **A driver replaced mid-season** (2024: SAR's last race was round 15 and COL raced from round 16; RIC's last was round 18 and LAW raced from round 19). They are listed with their points, status "not racing" and odds of 0, and the page doesn't crash on a substitute with one race.
2. **A dead heat on points.** In 2021 after round 21, VER and HAM are tied on 369.5. The odds must be close to even, and countback must work. Pinned by a unit test with a tie.
3. **Fractional points** (Spa 2021) display as `12.5`, not `12.499999`.
4. **The season is over** (after the last round). No remaining races, the champion is "clinched" at 100%, and everyone else is at 0%. The "still to run" panel says the season is over.
5. **Early season** (after round 1). One race of form, σ at its floor, nobody clinched or eliminated, and odds spread widely.

---

### Task 1: The simulator

**Files:**
- Create: `backend/app/services/championship_sim.py`
- Test: `backend/app/tests/test_championship_sim.py`

**Interfaces:**
- **Consumes:** tidy DataFrames, as produced by Task 2:
  - `races` columns: `round:int, code:str, name:str, team:str, position:int|NaN, position_text:str, points:float`.
  - `sprints`: the same columns, possibly empty.
  - `schedule` columns: `round:int, name:str, date:str, sprint:bool`.
- **Produces:**
  - `championship_payload(year: int, races: DataFrame, sprints: DataFrame, schedule: DataFrame, after_round: int | None) -> dict`, the payload above.
  - Raises `ChampionshipError(message, status)`, with status 404 or 422, for the coverage errors above.

- [ ] **Step 1: Write the failing tests.**
  - Use a `season()` fixture builder that makes `races`, `sprints` and `schedule` from compact per-round finishing orders. One test per bullet:
    - `test_points_so_far_add_races_and_sprints`: race plus sprint points up to the cut-off; rounds after it are ignored.
    - `test_half_points_stay_fractional`: 12.5 stays 12.5.
    - `test_default_cut_off_is_the_last_completed_round`.
    - `test_a_round_not_yet_run_is_a_422`, and `test_round_zero_is_a_422`.
    - `test_no_races_yet_is_a_404`.
    - `test_max_remaining_counts_races_sprints_and_fastest_lap_years`:
      - 2024 with 2 races and 1 sprint left gives 2×26 + 8 = 60;
      - 2025 with the same gives 58;
      - 2021 with 1 sprint gives 3 for the sprint.
    - `test_a_leader_out_of_reach_has_clinched`, with odds exactly 1.0 and everyone else at 0.0.
    - `test_a_driver_who_cannot_catch_the_leader_is_eliminated`, with odds exactly 0.0.
    - `test_equal_on_max_is_not_eliminated_or_clinched`.
    - `test_a_driver_missing_from_the_cut_off_round_is_not_racing`: keeps their points, status "not racing", odds 0, and `max_points == points`.
    - `test_a_dominant_driver_is_the_favourite`: one driver wins every race of a 10-round season with 5 to go, and that driver's odds exceed 0.9.
    - `test_odds_sum_to_one`, for drivers and for constructors, within 1e-6.
    - `test_same_request_same_odds`: two calls give identical payloads.
    - `test_a_tie_on_points_goes_to_more_wins`: the season is over, A and B are level on points, A has more wins, so A gets 1.0.
    - `test_an_unbreakable_tie_is_shared`: the season is over, level on points, wins and seconds, so each gets 0.5.
    - `test_season_over_has_no_remaining_and_crowns_the_leader`.
    - `test_history_has_one_entry_per_round_up_to_the_cut_off`, and it drops zero odds.
    - `test_retirements_score_nothing_and_raise_the_retirement_rate`: compare a driver with many R finishes against a clean one with equal form.
    - `test_constructor_points_sum_their_drivers`, and `test_constructor_max_remaining_counts_two_cars` (2024 with 1 race and 1 sprint left gives 44 + 15 = 59).
    - `test_rounds_lists_every_completed_round`, even when `after_round` is earlier.
    - `test_payload_rounding`: probabilities to 4 decimal places, points to 1.
- [ ] **Step 2: Run them to see them fail** (ImportError).
- [ ] **Step 3: Implement.**
  - Vectorise the draws: shape `(sims, events, entrants)`.
  - Ranking: `argsort` on the draws, with retirements set to `+inf`, then score by position.
  - Countback: compute a key `points * 1e6 + wins * 1e3 + seconds` per simulation. Split ties by counting the maxima per row.
  - The history loop reuses the same function with `HISTORY_SIMS`.
  - Keep each piece a small named function: `_points_so_far`, `_form`, `_simulate`, `_odds`, `_status`.
- [ ] **Step 4: Run the file, then the whole backend suite.**
  - Time a 24-round synthetic season with `after_round = 17`. It should take under 1.5 s, including history.
- [ ] **Step 5: Commit**: `feat(championship): title odds from a Monte Carlo of the races left`.

### Task 2: The Ergast loader and the endpoint

**Files:**
- Create: `backend/app/services/championship_data.py`
- Modify: `backend/app/api/v1/endpoints.py`
- Test: `backend/app/tests/test_championship_data.py`, and `backend/app/tests/test_endpoints.py`

**Interfaces:**
- **Consumes:** `championship_payload` and `ChampionshipError` from Task 1.
- **Produces:**
  - `load_season(year: int, ergast=None) -> tuple[DataFrame, DataFrame, DataFrame]` returns `(races, sprints, schedule)` in Task 1's shapes. The `ergast` parameter is injectable for tests and defaults to `fastf1.ergast.Ergast()`.
  - `championship_odds(year: int, after_round: int | None) -> dict` memoised for 600 s on `(year, after_round)`, keyed after resolving the default round.
  - `POST /api/v1/championship/odds` with body `{year: int, after_round: int | None}`.

- [ ] **Step 1: Write the failing tests.**
  - `test_load_season_pages_until_total_results`. A fake ergast serves 250 race rows in pages of 100 with `total_results = 250`. Assert that all 250 rows arrive and the requested offsets were 0, 100 and 200.
  - `test_load_season_maps_ergast_columns`:
    - `driverCode → code`, `givenName + " " + familyName → name`, `constructorName → team`, `positionText → position_text`;
    - the round comes from the matching `description` row;
    - `sprint` comes from `sprintDate` non-null and year ≥ 2021.
  - `test_load_season_before_2021_has_no_sprints`: no sprint call is made, or an empty frame is returned.
  - Endpoint tests, with `championship_odds` monkeypatched:
    - a 200 with the bare payload;
    - `ChampionshipError` becomes its status and message;
    - any other exception becomes `_analysis_error(e, "the championship odds")`, which is a 502;
    - the year 2017 is a 422 with `Championship odds cover 2018 to {current}.`
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - Check every Ergast column name against a real response first, by running a short script with the real `Ergast()`. Mapping with `fastf1.ergast` returns `ErgastMultiResponse`, whose `.description` rows line up with `.content` frames.
  - The endpoint runs the work in `asyncio.to_thread`.
  - Validate the year in the request model.
- [ ] **Step 4: Run the backend suite. Then make one real call:** `championship_odds(2021, 21)`. VER and HAM must both be on 369.5, with title odds between 0.3 and 0.7 each.
- [ ] **Step 5: Commit**: `feat(championship): odds endpoint over the Ergast mirror`.

### Task 3: The page, the odds table, constructors and races left

**Files:**
- Create:
  - `frontend/src/lib/championship.ts` and `.test.ts`;
  - `frontend/src/components/championship/ChampionshipPage.tsx`, `OddsTable.tsx`, `ConstructorsTable.tsx`, `RemainingRaces.tsx`, `fixtures.ts`, and tests for each component;
  - `frontend/src/app/championship/page.tsx`.
- Modify:
  - `frontend/src/lib/modules.ts` and `modules.test.ts`;
  - `frontend/src/lib/timing.ts` (Ruling C4) and its test.

**Interfaces:**
- **Consumes:** the payload; `Select`, `Panel`, `PageHeader`, `DataTable` (with `accent`), `ErrorState`, `Loading`/`Skeleton`, `useAsync`, `teamColor`.
- **Produces:**
  - Types `ChampionshipResult`, `ChampionDriver`, `ChampionTeam`, `RemainingRound`, `HistoryPoint`.
  - `formatChance(p: number): string`.
  - `ChampionshipPage({ initial }: { initial: { year: number; afterRound: number | null } })`.

- [ ] **Step 1: Write the failing tests.**
  - `formatChance`:
    - 0 → `"0%"`;
    - 0.0004 → `"<0.1%"`;
    - 0.4567 → `"45.7%"`;
    - 0.9996 → `">99.9%"`;
    - 1 → `"100%"`.
  - `formatPoints`: 12.5 → `"12.5"`, 340 → `"340"`.
  - **OddsTable** columns are Pos, Driver (name, code; team accent), Points, Gap, Title chance, Expected, Range and Status.
    - Gap reads `"—"` for the leader and `"−102"` for others. The minus is U+2212.
    - Range reads `"318–372"`.
    - Status reads "Champion" when clinched with no races left, "Clinched", "Out of contention" for eliminated, "Not racing", or blank for contenders.
    - Eliminated and not-racing rows have `text-faint` chance cells.
  - **ConstructorsTable:** Pos, Team (accent), Points, Title chance, Expected.
  - **RemainingRaces** lists "Round 18 · United States Grand Prix · 25 Oct", with a "Sprint" pill on sprint weekends and a line "Up to 166 points still available to each driver". The number is the max remaining for a racing driver, which the frontend gets as `max_points − points` of any racing driver.
    - With nothing left, it reads "The season is over."
  - **ChampionshipPage:**
    - It posts `{year, after_round}` to `/api/v1/championship/odds`.
    - The Season select offers 2018 to the current year.
    - The After round select is filled from the response's `rounds`, as "After round 17: Singapore Grand Prix".
    - Changing the season resets after_round to null, meaning latest.
    - The Odds panel meta reads "10,000 simulations".
    - A 404 shows its message with no retry button.
    - The loading copy says "Simulating the rest of the season… The first time a season is opened this can take up to a minute."
    - A caveat under the odds table reads verbatim: `"Each remaining race and sprint is simulated 10,000 times from every driver's finishing positions this season, weighted towards recent races, with their own retirement rate. It knows nothing about upgrades, grid penalties or team orders."`
  - **Module:** `{ id: "championship", label: "Championship odds", href: "/championship", group: "Analysis", icon: Crown }`, after `stats`, with keywords such as title, odds, monte carlo, standings and simulation.
  - **Team colours:** `teamColor("RB F1 Team")` is `#6692FF`, and `teamColor("Racing Point")` is `#F596C8`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - Follow `frontend/src/components/pace/RacePace.tsx` for the page shell and fetching: `useAsync` keyed on `championship-${year}-${afterRound ?? "latest"}`.
  - Read `?year=&round=` in `app/championship/page.tsx` the way `app/pace/page.tsx` reads its params. The current year is the default, and a bad year falls back to it.
- [ ] **Step 4: Run vitest, tsc and check-legacy.**
- [ ] **Step 5: Commit**: `feat(championship): title odds page`.

### Task 4: The odds-through-the-season chart

**Files:**
- Create: `frontend/src/components/championship/OddsHistory.tsx` and `.test.tsx`
- Modify: `ChampionshipPage.tsx` and its test

**Interfaces:**
- **Consumes:** `HistoryPoint[]`, `ChampionDriver[]`, `CHART`, `seriesColor` and `seriesDash` from `frontend/src/components/charts/chartTheme.ts`.
- **Produces:** `OddsHistory({ history, drivers }: { history: readonly HistoryPoint[]; drivers: readonly ChampionDriver[] })`.

- [ ] **Step 1: Write the failing tests.**
  - Only drivers whose odds reached at least 1% in some round get a line and a legend entry, in the order of the drivers list.
  - A legend swatch is in the team colour, and the second driver of a team gets a dashed swatch.
  - Hovering round 3 shows a tooltip with "After round 3: <name>", then each charted driver's chance on that round as `formatChance`, highest first. A driver absent from that round's `odds` reads 0%.
    - Fire `mouseMove` on the chart as `frontend/src/components/battles/LapChart.test.tsx` does, by stubbing `getBoundingClientRect` and `offsetWidth`/`offsetHeight`.
    - Assert the round, the name and the order.
  - With a single history point, the chart still renders, and the legend is present.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - A Recharts `LineChart` in a `ResponsiveContainer`, 320 px tall.
  - x is the round, with integer ticks. y runs from 0 to 1, with ticks formatted as percentages.
  - One `Line` per charted driver: `type="monotone"`, `dot={false}`, `isAnimationActive={false}`, in the team colour (`seriesColor(team, i)`), with `seriesDash(1)` for the second of a team.
  - A custom tooltip. No Scatter.
  - The panel "Title odds through the season" sits between the odds table and constructors.
- [ ] **Step 4: Run vitest, tsc and check-legacy.**
- [ ] **Step 5: Commit**: `feat(championship): title odds through the season`.

### Task 5: Changelog and real-data check

- [ ] **Step 1: Update the changelog and the sweep.**
  - Add this item to the changelog's "Deeper analysis" entry: `"Championship odds: every driver's and team's chance of the title after any round since 2018, from 10,000 simulations of the races still to run, with who has clinched it, who is out of contention, and how the odds moved through the season."`
  - Add `/championship` to `frontend/scripts/ui-sweep.mjs`'s default routes.
- [ ] **Step 2: Controller check.** Use the scratch backend, `cdp.mjs` and the live Ergast mirror.
  - **2021 after round 21:** VER and HAM are level on 369.5, and each has 30–70%.
  - **2021 after round 22:** VER is "Champion" at 100%.
  - **2023 after round 17** (Qatar, where VER won the title in the sprint): VER is "Clinched".
  - **2024 after round 19:** SAR and RIC are "Not racing", the page renders, and VER is the favourite.
  - **2026 latest:** the current season. Note the odds.
  - **All of them:** no console errors at 390, 768 and 1280, and ui-sweep is clean apart from the known breadcrumb contrast and the `/` 15 px overflow at 390.
  - **Build:** run `next build` with dev stopped.
- [ ] **Step 3: Commit**: `docs(changelog): championship odds`.
