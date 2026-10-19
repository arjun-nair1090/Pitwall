# Win Probability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "Win probability" page. For any race or sprint since 2018 it charts every driver's chance of winning, lap by lap, as the pit wall could have estimated it at the time. A lap stepper shows the table behind any lap: position, gap, projected gap at the flag, and win chance.

**Architecture:**
- **Service (`win_probability.py`).** It reuses the pit-window replay adapter (feature 1, `pit_window.py`) to get, for each lap N, the driver states and the tyre model fitted on laps ≤ N. It projects each driver's finish as current race time + best remaining plan cost (from `pit_strategy`). Then it runs a seeded Monte Carlo of pace noise, retirements and safety cars to turn the projections into win probabilities.
- **Endpoint.** One POST endpoint returns every lap's odds, with a 600 s memo.
- **Frontend.** A new `/winprob` module with a chart, safety-car shading and a lap table.

**Tech Stack:** FastAPI, FastF1 3.8.3, numpy, pandas, pytest; Next.js 14, React 18, TypeScript, Tailwind, Recharts 3, Vitest.

**Spec:** None. The user asked for a "live win-probability model + chart" (feature 2 of 8). As with feature 1, they chose to build on race replays (2026-10-19), because live timing is unavailable (401) and their live-timing work stays untouched. The Definitions below are the authority.

## Definitions

**Scope.**
- **Session:** a race (`R`) or sprint (`S`) only. Otherwise the response is a 422 with `Win probability needs a race or a sprint.`
- **Laps evaluated:** every N from 1 to `total_laps`, using feature 1's total-laps rule.

**State at lap N.** This comes from feature 1's adapter: states, model and pit loss, all from known laps (≤ N).
- **Race time** `t_i`: driver i's lap-end `Time` on lap N, in seconds. A driver with no lap-N row has retired and is out.
- **Remaining laps:** `R = total_laps − N`.
- **Projected remaining time** `C_i`:
  - the cost of the driver's best plan from `pit_strategy.pit_window`;
  - if it has no best plan (wet, unknown compound or a rule breach), `R × m_i`, where `m_i` is the median of the driver's last 5 known clean lap times, and the field median when the driver has none;
  - when R = 0, `C_i = 0`.
- **Projected finish:** `F_i = t_i + C_i`. Lapped cars need no special case. Their lap-N `Time` already includes the lap they've lost, and `F` compares the same lap count.

**Monte Carlo.** `N_SIMS = 4_000` for the chosen display and `HISTORY_SIMS = 1_500` for every lap's chart point. The RNG seed is `year * 100_000 + round * 1_000 + N`.
- **Pace noise:**
  - `F_i += σ_lap · sqrt(R) · Z1_i + OFFSET_SD · R · Z2_i`, where Z1 and Z2 are standard normal;
  - `σ_lap` is the pooled standard deviation of (known clean lap time − that lap's model prediction `base_c + deg_c · TyreLife`) over all drivers, floored at `SIGMA_LAP_FLOOR = 0.3` s;
  - `OFFSET_SD = 0.08` s per lap, the unknown true pace difference.
  - Clean laps follow `corner_analysis.clean_laps`.
- **Retirement:** each driver retires before the flag with probability `1 − (1 − HAZARD)^R`, with `HAZARD = 0.0015` per car per lap. A retired driver can't win.
- **Safety car:**
  - With probability `1 − (1 − SC_RATE)^R`, where `SC_RATE = 0.012` per lap, a safety car falls on a lap `N + u`, with u uniform on 1..R.
  - At that point each car's projected gap to the projected leader, `g_i = (F_i − min F) · u / R`, is compressed to `min(g_i, SC_GAP_S · rank_i)`, where `rank_i` is the car's 0-based order by `g_i` and `SC_GAP_S = 0.8`.
  - Then `F_i = min F + compressed g_i + (F_i − min F) · (1 − u/R)`.
  - Only one safety car is simulated per run.
- **Winner:** the non-retired driver with the lowest `F_i`. A run where everyone retires counts for nobody.
- **Win probability:** the share of runs a driver wins.
- **Final lap (N = total_laps):** R = 0, so the order is decided. The leader on the road gets 1.0. The model predicts the first car across the line. A post-race disqualification (Spa 2024, RUS) is not known to it, and the page says so.

**Payload.** It is returned bare.

```
{
  year, round, session, total_laps, sims,
  sc_laps: [lap numbers where the leader's lap is neutralised],
  laps: [{lap, odds: {CODE: p}}],   // N = 1..total_laps, zeros dropped, p rounded to 4 dp
  drivers: [{code, name, team, color}],   // every driver who started, in lap-1 order
  at: {lap, rows: [{code, position, gap, projected_gap, probability, status}]}
}
```

- `at` is the detail for the requested lap: `lap` in the request body, defaulting to `floor(total_laps / 2)`.
  - `gap` is `t_i − t_leader`.
  - `projected_gap` is `F_i − min F`, before noise.
  - `status` is that driver's pit-window status at that lap.
  - Rows are in position order.
- **Request:** `POST /api/v1/telemetry/win-probability` with `{year, round, session, lap?}`.
  - A `lap` outside 1..total_laps is a 422 with `Pick a lap from 1 to {total_laps}.`
- **Memo:** the per-lap odds are memoised on `(year, round, session)` for 600 s. A request that changes only `lap` recomputes just `at`.

**Rulings made in this plan:**
- **P1:** the constants (`HAZARD`, `SC_RATE`, `SC_GAP_S`, `OFFSET_SD` and the σ floor) are fixed values, roughly in line with modern F1: about 2 retirements per 20 cars per 60 laps, and about half to one safety car per race. Six cached races are too few to fit them. The back-test reports calibration but doesn't tune on it.
- **P2:** the model predicts first across the line. Penalties and disqualifications applied after the flag are out of scope.
- **P3:** a single simulated safety car, and no VSC distinction. That's a deliberate simplification, disclosed in the caveat.

## Global Constraints

- **Commits:** `git -c user.name="Arjun Nair" -c user.email=headhunter10900@gmail.com commit …`. No Co-Authored-By trailers, and never mention Claude or AI in commits or code comments.
- **Push:** after every commit, run `git push -q`, after checking that `git log -1 --format='%an <%ae> | %cn <%ce>'` shows only Arjun Nair.
- **Backend tests:** from `backend/`, run `SECRET_KEY=ci-test-secret-key RUNNING_LOCALLY=true python -m pytest -q -p no:cacheprovider` with the system python. Unit tests use synthetic laps.
- **Frontend checks:** from `frontend/`, run `npx vitest run`, `npx tsc --noEmit` and `node scripts/check-legacy.mjs --all`.
- **House style:**
  - sentence case;
  - `uppercase` only with `font-display`;
  - no `text-white`;
  - Tailwind tokens, never hex.
- **Axios mocks:** resolve `{ data: PAYLOAD }`, and the component reads `res.data`.
- **Recharts:** no `Scatter` in a `LineChart`. Use custom dots or `ReferenceArea`. Hover tests follow `LapChart.test.tsx`.
- **Real data:** only cached sessions load. Use a scratch copy of the cache. Never write to `C:\Users\arjun\f1-pitwall`.

## Review Focus

1. **Lap 1.** Few laps are known, so σ sits at its floor and the model uses fallbacks. Odds must still sum to 1 (or slightly less, when everyone can retire), with no NaN.
2. **A safety car period** (Silverstone 2022's red flag, then the restart). `sc_laps` is shaded, nothing crashes on missing `Time` values, and the odds tighten after the restart.
3. **Lapped cars and retirements mid-race.** A retired driver drops out from the lap after they stop. A lapped car stays near 0.
4. **The final lap.** The road leader is at 100%. For Spa 2024 that is RUS, and the caveat explains the disqualification case.
5. **Speed.** All laps of a 78-lap race (Monaco 2021) must compute in under 15 s cold. A lap-only change must return in under 1 s from the memo.

---

### Task 1: The model and the endpoint

**Files:**
- Create: `backend/app/services/win_probability.py`
- Modify: `backend/app/api/v1/endpoints.py`
- Test: `backend/app/tests/test_win_probability.py`, plus endpoint tests in `backend/app/tests/test_analysis_endpoints.py`

**Interfaces:**
- **Consumes:** feature 1's `pit_window.py` adapter (read it for the function that builds states, model and pit loss at lap N; refactor it to expose that function if it isn't already public, without changing its payload) and `pit_strategy.pit_window`.
- **Produces:**
  - `project_finish(times, costs) -> ndarray`.
  - `simulate_winner(F, R, sigma_lap, rng, sims) -> ndarray` of win probabilities.
  - `win_probability_payload(session, lap) -> dict`.
  - The endpoint.

- [ ] **Step 1: Write the failing tests.**
  - `test_a_big_lead_late_is_near_certain`: 20 s ahead with 3 laps left gives more than 0.98.
  - `test_a_close_fight_is_near_even`: equal F and equal pace give 0.4–0.6 each.
  - `test_more_laps_left_means_less_certainty`: the same gap with R = 40 against R = 5.
  - `test_safety_car_compression_helps_the_chaser`: for a 15 s gap with R = 30, P(chaser) with SC_RATE = 0.012 is greater than with SC_RATE = 0. Monkeypatch the rate.
  - `test_retired_driver_has_zero`.
  - `test_final_lap_is_decided`.
  - `test_odds_sum_to_at_most_one_and_seeded_runs_repeat`.
  - `test_projected_finish_uses_best_plan_cost_and_falls_back_to_recent_laps`.
  - `test_only_known_laps_feed_lap_n`: changing lap N+1 doesn't change lap N's odds.
  - `test_sc_laps_from_the_leader`.
  - `test_lap_out_of_range_is_a_422`, `test_qualifying_is_a_422`, and the endpoint 200/502 tests.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Vectorise across sims. The history loop reuses the adapter per lap. Fitting per lap is the cost, so measure it.
- [ ] **Step 4: Run the full suite.**
  - Then run the cached races on a scratch copy of the cache: 2024 R1, R12, R14 and R15; 2022 R10; 2021 R5.
  - **Back-test:** for each race, report the eventual road winner's probability at 25%, 50% and 75% distance, and the mean log-loss of the road winner over all laps.
  - Report the cold time per race.
- [ ] **Step 5: Commit and push**: `feat(winprob): lap-by-lap win probability from the pit-window model`.

### Task 2: The page

**Files:**
- Create:
  - `frontend/src/lib/winprob.ts` and `.test.ts`;
  - `frontend/src/components/winprob/WinProbPage.tsx`, `WinChart.tsx`, `LapOdds.tsx`, `fixtures.ts`, and tests for each;
  - `frontend/src/app/winprob/page.tsx`.
- Modify: `frontend/src/lib/modules.ts` and its test.

**Interfaces:**
- **Consumes:** the payload; `SessionPicker allowedSessions={["R","S"]}`; `useAsync`; `DataTable` with `accent`; `chartTheme`; feature 1's lap stepper. Reuse it if it was built as a component; otherwise extract it into `components/ui/LapStepper.tsx` and use it on both pages.
- **Produces:** `WinProbPage({ initial })`.

- [ ] **Step 1: Write the failing tests.**
  - **WinChart:** a `LineChart` 360 px tall, x = lap and y = 0–1 as a percentage.
    - One line per driver whose odds reach 5% on some lap, in team colours, with the second car of a team dashed.
    - `sc_laps` are shaded with `ReferenceArea`, merging consecutive laps into one area.
    - A vertical `ReferenceLine` marks the selected lap.
    - Clicking the chart selects that lap.
    - The tooltip shows "Lap N", then the chances highest first (`formatChance` without status, from `lib/championship.ts`; reuse it).
    - The hover test asserts a lap whose ranking is unique.
  - **LapOdds table:** Pos, Driver (accent), Gap ("+3.4 s", "—" for the leader), At the flag ("+1.2 s" projected), Win chance, Strategy (the pit-window status label, reusing feature 1's label helper).
  - **Page:**
    - The session picker and lap stepper drive `{year, round, session, lap}`.
    - A lap change refetches with the same key prefix, and the memo makes it fast.
    - The loading copy: "Working out every lap of the race… The first time a race is opened this can take up to a minute."
    - A 404 shows its message with no retry.
  - **Caveat, verbatim:** `"Each lap is worked out only from the laps run so far: every driver's best remaining strategy, plus thousands of simulated finishes with random pace, retirements and a possible safety car. It predicts who crosses the line first, so a later penalty or disqualification isn't known to it."`
  - **Module:** `{ id: "winprob", label: "Win probability", href: "/winprob", group: "Race", icon: TrendingUp }`, after `pitwindow`. Keep five `mobilePrimary` modules.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run vitest, tsc and check-legacy.**
- [ ] **Step 5: Commit and push**: `feat(winprob): win probability page`.

### Task 3: Changelog and real check

- [ ] **Step 1: Changelog and sweep.**
  - Add this item to the "Deeper analysis" changelog entry: `"Win probability: every driver's chance of winning, lap by lap through any race or sprint since 2018, worked out from only the laps run so far, with safety-car periods marked and the numbers behind any lap."`
  - Add `/winprob` to `frontend/scripts/ui-sweep.mjs`.
- [ ] **Step 2: Controller check.** Run the scratch backend and `cdp.mjs` on Spa 2024, Silverstone 2022, Monaco 2021 and Bahrain 2024:
  - no console errors at 390, 768 and 1280;
  - no overflow;
  - the chart's shape is sensible against what happened;
  - ui-sweep clean apart from the known issues;
  - `next build` passes.
- [ ] **Step 3: Commit and push**: `docs(changelog): win probability`.
