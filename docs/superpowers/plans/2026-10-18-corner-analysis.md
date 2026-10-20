# Corner-by-Corner Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break a lap down turn by turn. Head to head shows, for each corner, who gained time and how (braking point, minimum speed, exit speed). Advanced analytics gets a consistency view: one driver's clean laps, corner by corner, as a heatmap, plus an "ideal lap" built from their best corners.

**Architecture:** All corner maths lives in one new backend module, `app/services/corner_analysis.py`, as pure functions over FastF1 telemetry frames, so there is a single tested implementation. The official corner list comes from FastF1's `session.get_circuit_info()`. Head to head gets the per-corner comparison as a new `corners` field on the existing `POST /api/v1/telemetry/compare` response. Consistency gets its own endpoint, `POST /api/v1/telemetry/corner-consistency`. The frontend only formats and draws.

**Tech Stack:** FastAPI, FastF1, pandas, numpy, pytest; Next.js 14, React 18, TypeScript, Tailwind, Vitest + Testing Library.

**Spec:** None. The user opted out of the design conversation, so the design decisions are recorded here under "Definitions".

## Global Constraints

- Every figure is computed by ordinary code over FastF1 data. No AI involvement.
- Corner data may be missing (FastF1 can't build circuit info for some sessions, e.g. 2018 round 1). The comparison must still work, and the UI says "Corner data isn't available for this session".
- Copy follows the house style that `frontend/scripts/check-legacy.mjs --all` enforces: sentence case, `uppercase` only with `font-display`, and no `text-white` outside `Button.tsx`/`TopBar.tsx`.
- Run backend tests from `backend/` with `SECRET_KEY=ci-test-secret-key RUNNING_LOCALLY=true python -m pytest -q -p no:cacheprovider`. Run frontend gates from `frontend/` with `npx tsc --noEmit`, `npx vitest run` and `node scripts/check-legacy.mjs --all`.
- Commit as `git -c user.name="Arjun Nair" -c user.email=headhunter10900@gmail.com commit ...`. No co-author trailers, and no mention of AI anywhere.
- Write code the way the surrounding code is written: comment density, plain-English error messages written for the person using the app, `SessionDataError` for "can't answer this request".

## Definitions (the design decisions)

- **Corner list:** `circuit_corners(session)` returns one dict per row of `session.get_circuit_info().corners`, sorted by `Distance`: `{"number": int, "letter": str, "label": f"T{number}{letter}", "x": float, "y": float, "angle": float, "distance": float}`. Any exception gives `[]`.
- **Corner marker on a lap:** for each corner, take the sample nearest in X/Y to the corner's `(x, y)`, searching only samples whose `Distance` is within `MARKER_WINDOW_M = 300` of the corner's reference `distance`. If no sample is in the window, use the reference distance clamped to the lap's range. Markers are forced non-decreasing: `marker[i] = max(marker[i], marker[i-1])`.
- **Corner zone:** zones split the lap halfway between consecutive markers. The first zone starts at the lap's first sample and the last ends at its last, so the zone times add up to the lap.
- **Per-zone metrics** for one lap, `zone = [start, end]`:
  - `zone_time`: time at `end` minus time at `start`, linearly interpolated on Distance→Time, in seconds.
  - `apex_speed`: lowest `Speed` among samples in the zone. If the zone holds no samples, use the sample nearest the marker. In km/h.
  - `entry_speed`: highest `Speed` from the zone start up to the apex sample.
  - `exit_speed`: `Speed` interpolated at `end`.
  - `brake_before_m`: take the last braking sample at or before the apex, walk back to the start of that continuous braking run, and return `marker − that distance`. Negative means braking began past the marker. `None` when there's no braking in the zone up to the apex.
- **Duel corner row:** `{"label", "number", "letter", "x", "y", "angle", "driver1": metrics, "driver2": metrics, "time_delta": driver2.zone_time − driver1.zone_time}`. Positive means driver 1 gained there, matching the existing gap convention.
- **Clean lap (consistency):** `LapTime` present, `PitInTime` and `PitOutTime` both NaT, not `Deleted` (when that column exists), and `LapTime ≤ 1.07 ×` the driver's best `LapTime`. Fewer than `MIN_CLEAN_LAPS = 3` raises `SessionDataError("{code} has only {n} clean laps in this session; at least 3 are needed to judge consistency.")`.
- **Consistency summary:** standard deviations use `ddof=1`. `best_lap` is the lowest sum of zone times over the clean laps, which is the telemetry lap duration. `ideal_lap` is the sum, over corners, of each corner's best zone time. Both are on the telemetry basis so they compare like with like.
- **Ties (frontend):** braking points within `BRAKE_TIE_M = 10` m are "the same", since telemetry is sampled roughly every 10 m at top speed. Time deltas that round to 0.000 are "level".

## Review Focus

1. **A session whose circuit info can't be loaded:** the compare response still returns both drivers, with `corners: []`, and the panel says corner data isn't available. Tests are in Task 2 and Task 4.
2. **Corners close together (Spa T3/T4 are ~100 m apart) or a zone with no samples in it:** metrics are still produced and nothing raises. Test in Task 1.
3. **A corner taken flat out (no braking):** `brake_before_m` is `None` and the UI shows "No braking", never "0 m". Tests in Task 1 and Task 4.
4. **A driver with too few clean laps** (e.g. a qualifying session with two flying laps): the endpoint returns a 404 with the plain message above, and the panel shows it. Tests in Task 3 and Task 6.
5. **The corner comparison should agree with the lap times:** the zone deltas sum to driver2's telemetry lap duration minus driver1's. Test in Task 2.

---

### Task 1: Corner zones and per-corner metrics (backend, pure)

**Files:**
- Create: `backend/app/services/corner_analysis.py`
- Test: `backend/app/tests/test_corner_analysis.py`

**Interfaces:**
- Produces:
  - `MARKER_WINDOW_M: float = 300.0`
  - `circuit_corners(session) -> List[Dict[str, Any]]` (see Definitions)
  - `corner_markers(tel: pd.DataFrame, corners: List[Dict]) -> List[float]`
  - `corner_metrics(tel: pd.DataFrame, corners: List[Dict]) -> List[Dict[str, Optional[float]]]`. The list is in corner order, and each dict has the keys `zone_time, apex_speed, entry_speed, exit_speed, brake_before_m`. `[]` when `corners` is empty.

- [ ] **Step 1: Write the failing tests.** Build telemetry with a helper like `test_duel_telemetry._tel`: columns `Time` (timedelta), `Distance`, `Speed`, `Brake` (bool), `X`, `Y`. Place the car on a straight line with X = Distance and Y = 0, and corners at `(x=distance, y=0)`.
  - `test_circuit_corners_reads_the_official_list_in_lap_order`: a fake session whose `get_circuit_info()` returns an object with `.corners` holding rows out of order, with numbers 2 and 1 and letters `""` and `"a"`. Assert the labels `["T1a", "T2"]` come back sorted by distance, with every key present.
  - `test_circuit_corners_is_empty_when_fastf1_cannot_build_it`: `get_circuit_info` raises → `[]`.
  - `test_markers_snap_to_the_nearest_point_within_the_window`: a corner at reference distance 500 whose x/y is nearest the sample at 520 → marker 520.
  - `test_markers_ignore_a_closer_point_outside_the_window`: an XY-nearer sample 900 m away along the lap (a track crossing) is ignored.
  - `test_zone_times_add_up_to_the_lap`: three corners on a 3000 m lap at 30 m/s → `sum(zone_time) ≈ lap duration` to 1e-6.
  - `test_apex_entry_and_exit_speeds`: in one zone the speed falls 300 → 90 → 250. Assert `apex_speed == 90`, `entry_speed == 300`, and `exit_speed` equals the interpolated speed at the zone end.
  - `test_brake_point_is_the_start_of_the_braking_run_before_the_apex`: braking is on from 380 m to 470 m with the marker at 500 → `brake_before_m == 120`. An earlier dab at 100 m doesn't count.
  - `test_flat_out_corner_has_no_brake_point`: no braking → `brake_before_m is None`.
  - `test_corners_closer_than_the_sample_spacing_still_get_metrics`: samples every 100 m, corners at 1000 and 1040 → two metric dicts, with every value finite except a `None` brake.

- [ ] **Step 2: Run the tests and confirm they fail** (`ModuleNotFoundError: app.services.corner_analysis`).
  Run: `SECRET_KEY=ci-test-secret-key RUNNING_LOCALLY=true python -m pytest app/tests/test_corner_analysis.py -q -p no:cacheprovider`

- [ ] **Step 3: Implement the three functions** in `corner_analysis.py`, exactly as Definitions says. Interpolate with `numpy.interp` over `Distance` (telemetry distance increases monotonically). Give the module a docstring in the style of `duel_telemetry.py`.

- [ ] **Step 4: Run the tests and confirm they pass**, then run the full backend suite. Expected: all green, previously 394 passed.

- [ ] **Step 5: Commit:** `feat(api): corner zones and per-corner metrics from official corner data`

### Task 2: Corners in the head-to-head response

**Files:**
- Modify: `backend/app/services/duel_telemetry.py` (`head_to_head_payload`)
- Modify: `backend/app/services/corner_analysis.py` (add `corner_duel`)
- Test: `backend/app/tests/test_corner_analysis.py`, `backend/app/tests/test_duel_telemetry.py`

**Interfaces:**
- Consumes: `circuit_corners`, `corner_metrics` (Task 1)
- Produces: `corner_duel(corners, tel1, tel2) -> List[Dict]` (rows as in "Duel corner row"). `head_to_head_payload(...)` now returns `{"driver1", "driver2", "corners": [...]}`.

- [ ] **Step 1: Write the failing tests.**
  - `test_corner_duel_pairs_each_corner_with_both_drivers_metrics`: two straight-line laps, one 10% slower. The output has a row per corner, with the `label` and `x`/`y`/`angle` copied across and `time_delta > 0` everywhere.
  - `test_corner_duel_deltas_sum_to_the_lap_time_difference`: `sum(time_delta) ≈ lap2 duration − lap1 duration`.
  - `test_corner_duel_is_empty_without_corners`: `corner_duel([], tel1, tel2) == []`.
  - In `test_duel_telemetry.py`, `test_head_to_head_includes_corners_and_survives_missing_circuit_info`: monkeypatch `dt._duel` to return a fake session plus two laps and their telemetry, and `corner_analysis.circuit_corners` to return `[]`. The payload has `driver1`, `driver2` and `corners == []`.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement `corner_duel`, and add `"corners": corner_duel(circuit_corners(session), tel1, tel2)` to `head_to_head_payload`.** Keep the existing keys unchanged.

- [ ] **Step 4: Run the tests and confirm they pass, then run the full backend suite.**

- [ ] **Step 5: Commit:** `feat(api): per-corner comparison in the head-to-head response`

### Task 3: Corner consistency endpoint

**Files:**
- Modify: `backend/app/services/corner_analysis.py` (add `clean_laps`, `summarise_consistency`, `corner_consistency_payload`, plus a 600 s in-process memo like `session_info._cache`)
- Modify: `backend/app/api/v1/endpoints.py` (new request model + route)
- Test: `backend/app/tests/test_corner_analysis.py`, `backend/app/tests/test_analysis_endpoints.py`

**Interfaces:**
- Consumes: Task 1 functions; `session_info.load_session`, `driver_laps`, `driver_profile`, `SessionDataError`; `duel_telemetry._lap_telemetry`
- Produces:
  - `MIN_CLEAN_LAPS = 3`
  - `clean_laps(laps: pd.DataFrame) -> pd.DataFrame` (one driver's laps in, clean ones out)
  - `summarise_consistency(corners, per_lap: Dict[int, List[Dict]]) -> Dict` → `{"laps": [lap numbers ascending], "corners": [{"label", "number", "letter", "apex_speed": {"mean", "sd"}, "brake_before_m": {"mean", "sd"} | None, "zone_time": {"best", "mean", "sd"}, "per_lap": [{"lap", "zone_time", "delta_to_best", "apex_speed", "brake_before_m"}]}], "best_lap": float, "ideal_lap": float}`. `brake_before_m` is None when the driver never braked for that corner on any clean lap. When only some laps braked, use those laps.
  - `corner_consistency_payload(year, gp, session_name, driver, round_number=None) -> Dict`: the summary plus `"driver": {"code", "name", "team", "color"}`. Raises `SessionDataError("Corner data isn't available for this session.")` when `circuit_corners` is empty, and the clean-lap error from Definitions.
  - Route: `POST /api/v1/telemetry/corner-consistency`, body `{year: int, gp: str = "", round: Optional[int], session: str = "R", driver: str}` (driver upper-cased; needs gp or round, as `PedalBehaviorRequest` does). Errors go through `_analysis_error(e, "the corner consistency analysis")`.

- [ ] **Step 1: Write the failing tests.**
  - `test_clean_laps_drop_pit_deleted_and_slow_laps`: a frame with an in-lap, an out-lap, a deleted lap, one lap at 110% of best and three good laps → only the three remain.
  - `test_summary_finds_best_mean_spread_and_ideal_lap`: three laps over two corners with hand-picked zone times. Assert `best`, `mean`, the `sd` (ddof=1), `delta_to_best`, `ideal_lap = sum of per-corner bests`, and `best_lap = min lap sum`.
  - `test_summary_leaves_brake_point_out_for_a_corner_never_braked_for`
  - `test_payload_refuses_too_few_clean_laps`: monkeypatch `load_session` with a fake session where the driver has 2 clean laps → `SessionDataError` containing "at least 3".
  - `test_payload_refuses_when_corner_data_is_missing`
  - In `test_analysis_endpoints.py`: `test_corner_consistency_reports_missing_data_as_404` (monkeypatch the payload function to raise `SessionDataError`) and `test_corner_consistency_needs_a_race` (no gp and no round → 422).

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.** Iterate the clean laps with `laps.iterlaps()` and call `_lap_telemetry` on each. Skip (don't fail on) a lap whose telemetry raises `SessionDataError`, then re-check `MIN_CLEAN_LAPS` after skipping. Run the endpoint with `asyncio.to_thread`, as the neighbouring routes do.

- [ ] **Step 4: Run the tests and confirm they pass, then run the full backend suite.**

- [ ] **Step 5: Commit:** `feat(api): corner consistency over a driver's clean laps`

### Task 4: Corner table in Head to head

**Files:**
- Create: `frontend/src/lib/corners.ts`, `frontend/src/lib/corners.test.ts`
- Create: `frontend/src/components/compare/CornerTable.tsx`, `frontend/src/components/compare/CornerTable.test.tsx`
- Modify: `frontend/src/lib/duel.ts` (`DuelResult` gains `corners: CornerDuelRow[]`)
- Modify: `frontend/src/components/compare/CompareTool.tsx` (a full-width `Panel title="Corner by corner"` under the existing grid)

**Interfaces:**
- Consumes: the Task 2 response shape
- Produces (in `lib/corners.ts`):
  - `interface CornerMetrics { zone_time: number; apex_speed: number; entry_speed: number; exit_speed: number; brake_before_m: number | null }`
  - `interface CornerDuelRow { label: string; number: number; letter: string; x: number; y: number; angle: number; driver1: CornerMetrics; driver2: CornerMetrics; time_delta: number }`
  - `BRAKE_TIE_M = 10`
  - `brakeVerdict(a: number | null, b: number | null, codeA: string, codeB: string): string`. It returns `"No braking"` (neither braked), `"Only {code} braked"`, `"Same braking point"` (|a−b| < 10), or `"{code} brakes {n} m later"`. The later braker has the smaller `brake_before_m`, and `n` is rounded to whole metres.
  - `biggestGains(rows: CornerDuelRow[]): { first: CornerDuelRow | null; second: CornerDuelRow | null }`: the corner where each driver gained most (`first` = largest positive delta, `second` = most negative). Null when that driver gained nowhere.

- [ ] **Step 1: Write the failing tests.**
  - `corners.test.ts`: `brakeVerdict` returns each of its four outcomes, and `(120, 108)` gives `"Same braking point"` while `(120, 100)` gives `"NOR brakes 20 m later"` for codes VER/NOR. `biggestGains` picks the right rows, and returns nulls for an empty list.
  - `CornerTable.test.tsx`: renders one row per corner with its label. The time cell shows the gainer's code and `formatDelta`-style magnitude (e.g. `VER 0.123`). A flat-out corner reads "No braking", never "0 m". The summary line reads `"VER gained most at T5 (0.123 s); NOR at T9 (0.045 s)"`. With `rows=[]` it shows the EmptyState "Corner data isn't available for this session".

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.** `CornerTable({ rows, code1, code2, style }: { rows: CornerDuelRow[]; code1: string; code2: string; style: DuelStyle })` uses `DataTable` with these columns: Turn; Time (the gainer's code with a team-colour dot, then the 3-dp magnitude, or "Level"); Min speed (A / B, km/h, rounded); Braking (`brakeVerdict`); Exit speed (A / B). `accent` is the gainer's colour. Wire it into `CompareTool` under the grid with `meta="Each turn runs halfway to the next"`.

- [ ] **Step 4: Run the tests and confirm they pass, then run tsc + the full vitest suite + check-legacy.**

- [ ] **Step 5: Commit:** `feat(compare): corner-by-corner table`

### Task 5: Turn numbers on the dominance map

**Files:**
- Modify: `frontend/src/components/compare/DominanceMap.tsx` (new optional prop `corners?: readonly Pick<CornerDuelRow, "label" | "x" | "y" | "angle">[]`)
- Modify: `frontend/src/components/compare/CompareTool.tsx` (pass `result.corners`)
- Test: `frontend/src/components/compare/DominanceMap.test.tsx`

**Interfaces:**
- Consumes: `CornerDuelRow` (Task 4)

- [ ] **Step 1: Write the failing tests.** `test("labels each turn on the map")`: pass two corners and assert `svg text` elements contain "1" and "2". Show the turn number without its "T", plus any letter. `test("draws no turn labels without corner data")`: no `[data-turn]` elements.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.** Project the corner point and the point one unit along `angle` (degrees, in circuit coordinates, as FastF1's own corner-label example does). Normalise that direction in screen space and place the label 16 px out along it. Draw small, muted text (`fill` = the existing mute token colour, `fontSize={10}`) with a `data-turn` attribute, behind the car markers.

- [ ] **Step 4: Run the tests and confirm they pass, then run tsc + vitest.**

- [ ] **Step 5: Commit:** `feat(compare): turn numbers on the dominance map`

### Task 6: Corner consistency panel on Advanced analytics

**REQUIRED SKILL for this task:** load `dataviz` before writing the heatmap. It fixes the sequential palette and the legend.

**Files:**
- Modify: `frontend/src/lib/corners.ts` (consistency types)
- Create: `frontend/src/components/advanced/CornerConsistency.tsx`, `CornerConsistency.test.tsx`, `CornerHeatmap.tsx`, `CornerHeatmap.test.tsx`
- Modify: `frontend/src/components/advanced/PedalAnalysis.tsx` (render `<CornerConsistency sel={sel} />` under the pedal panel)

**Interfaces:**
- Consumes: the Task 3 response; `useSessionInfo` (drivers for the picker); `useAsync`; `Select`
- Produces: `interface CornerConsistencyResult` (mirrors the Task 3 payload).

- [ ] **Step 1: Write the failing tests.**
  - `CornerHeatmap.test.tsx`: renders a cell per lap × corner (`[data-cell]` count = laps × corners). Every cell has an accessible name like "Lap 12, T5: 0.084 s off best". The best cell in each column is marked `data-best`.
  - `CornerConsistency.test.tsx` (mock axios as `PedalAnalysis.test.tsx` does): the picker offers the session's drivers, defaulting to the first. It posts `{year, round, session, driver}` to `/api/v1/telemetry/corner-consistency`. It renders the heatmap and the line "Ideal lap from best corners: 1:44.912, 0.418 s quicker than the best lap" (use `formatLapTime`). A 404 with the clean-laps message shows that message.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement.** The heatmap is a responsive SVG: rows are laps, columns are corners, and the colour is `delta_to_best` on the dataviz sequential scale, capped at the 95th percentile so one bad lap doesn't wash the rest out. A legend shows the scale. Under it, a `DataTable` ranks corners by `zone_time.sd` (the most inconsistent first): Turn; Spread (sd, 3 dp); Min speed (mean ± sd); Braking point (mean ± sd m, or "No braking"). The panel title is "Corner consistency", with `meta` = the driver's name and how many clean laps were used. Loading copy: "Analysing every clean lap. The first time a race is opened this can take up to a minute."

- [ ] **Step 4: Run the tests and confirm they pass, then run tsc + vitest + check-legacy.**

- [ ] **Step 5: Commit:** `feat(advanced): corner consistency heatmap and ideal lap`

### Task 7: Real-data verification and changelog

**Files:**
- Modify: `frontend/src/app/changelog/page.tsx` (add items to the existing 2026-10-18 "Deeper analysis" entry)

- [ ] **Step 1:** Add two changelog items, one for the corner table and turn numbers and one for corner consistency, in the voice of the existing entries.
- [ ] **Step 2:** Start the backend with the scratchpad `run_local.py` and run `next dev`. Check against real data:
  - `/compare?year=2024&round=14&session=Q&d1=VER&d2=NOR` shows 19 turns. The time column sums to the 0.822 s gap within 0.01 s.
  - `/advanced?year=2024&round=14&session=R`, VER: a heatmap of roughly 39 laps.
  - A 2018 round 1 comparison shows the "not available" state, and the rest of the page still works.
  - No console errors or warnings, and no horizontal overflow at 390 px.
- [ ] **Step 3:** Stop `next dev`, run `npx next build` (it must succeed), then run `node scripts/ui-sweep.mjs` with the API up and restart dev afterwards.
- [ ] **Step 4:** Run the full backend and frontend suites one final time.
- [ ] **Step 5: Commit:** `docs: changelog for corner analysis`
