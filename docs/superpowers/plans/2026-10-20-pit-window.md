# Pit Window and Undercut Predictor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "Pit window" page. You pick any lap of a past race or sprint. It shows, as the pit wall could have known it then, each driver's best remaining strategy and pit window, which close fights an undercut would win, and the tyre model behind both.

**Architecture:**
- **Pure core (`pit_strategy.py`).** It takes per-driver state plus a fitted tyre model and returns plans, windows and undercut estimates. The live-timing branch can later call it unchanged.
- **Replay adapter (`pit_window.py`).** It loads a session's laps through the existing loader, cuts them at the chosen lap, fits the model with `strategy_simulator.compute_compound_stats` and `estimate_pit_loss_seconds` on those laps only, builds the state and calls the core.
- **Endpoint.** One POST endpoint, with a 600 s memo on the loaded laps.
- **Frontend.** A new `/pitwindow` module with a lap stepper and three panels.

**Tech Stack:** FastAPI, FastF1 3.8.3, numpy, pandas, pytest; Next.js 14, React 18, TypeScript, Tailwind, Vitest, Testing Library.

**Spec:** None. The user asked for a "live pit-window/undercut predictor" (feature 1 of 8). On 2026-10-19 they chose "Build on race replays": the model runs on any lap of a past race, as a clean function the live-timing code can call later, and their uncommitted live-timing work stays untouched. The Definitions below are the authority.

## Definitions

**Scope.**
- **Session:** a race (`R`) or sprint (`S`). Anything else is a 422 with `The pit window needs a race or a sprint.`
- **Cut-off lap N:** an integer from 1 to `total_laps − 1`. Otherwise the response is a 422 with `Pick a lap from 1 to {total_laps − 1}.`
- **Known laps:** the session's laps with `LapNumber <= N`. Everything is computed from these, so a later lap never leaks into the model.
- **Total laps:** `session.total_laps` when it is a positive int ≥ laps run, else `int(laps.LapNumber.max())`. This is the race-pace rule.
- **Laps remaining:** `R = total_laps − N`.

**The model, fitted on the known laps.**
- Use `stats = compute_compound_stats(known)` and `pit_loss = estimate_pit_loss_seconds(known, stats)` from `strategy_simulator`. With no stops yet, `pit_loss` falls back to `DEFAULT_PIT_LOSS_SECONDS = 22`.
- **Lap time on compound c at tyre age t:** `base_c + deg_c · t`. Fuel burn is the same whatever the plan, so it cancels and is ignored.
- **Fitted compound:** a compound whose `sample_size >= MIN_SAMPLES_FOR_FIT`. Others use the fallback numbers, marked `"fitted": false`.
- **Fresh-tyre choices:** `SOFT`, `MEDIUM` and `HARD`.
  - The base for a compound that is not fitted is `base_c` from stats when present. Otherwise it is the slowest fitted base plus `UNFITTED_BASE_PENALTY_S = 0.3`, so that an unknown compound never looks magically fast.

**Driver state at lap N**, for drivers with a lap N row:
- `code`, `position` (Position on lap N), `compound` (Compound on lap N, upper case) and `tyre_age` (TyreLife on lap N, int).
- `used`: the set of compounds on the driver's known laps.
- `gap_ahead`: the lap-end `Time` minus the lap-end `Time` of the car one position ahead on lap N, in seconds, or None. This is the `race_battles` rule.
- `neutralised`: lap N's TrackStatus contains 4, 5, 6 or 7. Use `session_info.neutralised_laps`.
- Drivers with no lap N row (retired) are left out.

**Plan search, per driver.** Plans have 0, 1 or 2 more stops. Stop laps are given as race laps `N + k`.
- **Legal plans in a dry race:** the set of compounds the driver has used, plus every compound in the plan, must hold at least two distinct dry compounds. A driver who has used `INTERMEDIATE` or `WET` on any known lap is exempt.
- **No-stop plan:** costs `Σ_{j=1..R} lap(c, a + j)`.
- **Stops:** each stop adds `pit_loss`, and the new stint starts at tyre age 1.
- **One-stop:** stop at `N + k` for `k` in `1..R−1`, onto `c'`.
- **Two-stop:** stops at `N + k1` and `N + k2`, with `1 <= k1 < k2 <= R − 1`, onto `c'` and then `c''`. Each stint must be at least `MIN_STINT_LAPS = 5` laps, except the stint already running.
- Sums use the closed form: `Σ_{j=1..m} (base + deg·(t0 + j)) = m·base + deg·(m·t0 + m(m+1)/2)`.
- **Best plan:** the lowest cost. A tie goes to fewer stops, then the earlier stop.
- **Pit window:** for each first-stop lap `s`, take the cheapest legal plan whose first stop is at `s`. The window is the contiguous range of `s` around the best plan's first stop whose cost is within `WINDOW_S = 2.0` s of the best. It is None when the best plan has no stop.
- **Status:**
  - `"stay out"` when the best plan has no stop;
  - `"box now"` when the window contains `N + 1`;
  - `"window open"` when the window has opened (its start ≤ N + 1) but the best stop is later;
  - `"window opens"` when the window starts after `N + 1`;
  - `"wet"` when the driver is on `INTERMEDIATE` or `WET`. No plan is computed for a wet driver, because the model has no crossover logic.

**Safety car.** When lap N is neutralised for a driver, that driver's plans use `pit_loss · SC_PIT_LOSS_FACTOR`, with `SC_PIT_LOSS_FACTOR = 0.5`, for a stop at `N + 1` only. The driver gets `cheap_stop: true`.

**Undercut, per pair.** A pair is a chaser with `gap_ahead <= UNDERCUT_RANGE_S = 3.0`, together with the car directly ahead. Both must be on dry compounds with legal one-stop plans, and neither may be on lap 1.
- The chaser stops at the end of lap N + 1 and the leader at the end of lap N + 2, both onto the chaser's best plan's next compound (`c'`).
- **Gain:** `gain = lap(c_L, a_L + 2) − lap(c', 1)`. This is the leader's last old-tyre lap against the chaser's first fresh lap. Pit losses cancel.
- **Margin:** `margin = gain − gap_ahead`.
- **Verdict:** `"likely"` when margin ≥ 0.5, `"possible"` when −0.5 ≤ margin < 0.5, `"unlikely"` otherwise.
- Traffic and out-lap warm-up are not modelled, and the page says so.

**Payload.** It is returned bare.

```
{
  year, round, session, lap, total_laps, laps_remaining, pit_loss, sc_lap,
  model: [{compound, base, deg_per_lap, fitted, laps}],
  drivers: [{code, name, team, color, position, compound, tyre_age, used, gap_ahead, status,
             cheap_stop, rule_breach, best: {stops: [{lap, compound}], cost} | null,
             window: {open, close} | null}],
  undercuts: [{chaser, leader, gap, gain, margin, verdict, compound}]
}
```

- `sc_lap` is a boolean: lap N is neutralised for the leader.
- `drivers` are ordered by position.
- `undercuts` are ordered by margin, descending.
- Seconds are rounded to 3 decimal places and costs to 1.
- `cost` is the predicted time for the rest of the race in seconds. It is only comparable within one driver.
- `rule_breach` is true only when no legal plan exists (see Review Focus 4).
- `name`, `team` and `color` come from session results, as race_battles does it.

**Rulings made in this plan:**
- **W1:** the live strategist (`ai_strategist.py`) is not touched. The user chose replays. The core is the hand-off point for their live-timing branch.
- **W2:** wet races get status "wet" with no plan. Dry crossover modelling is out of scope, and showing a dry plan to a driver on intermediates would be wrong.
- **W3:** the window is defined by cost within 2.0 s rather than by tyre-life limits. The old `optimal_lifespans` heuristic was invented numbers; this one is measured.

## Global Constraints

- **Commits:** `git -c user.name="Arjun Nair" -c user.email=headhunter10900@gmail.com commit …`. No Co-Authored-By trailers, and never mention Claude or AI in commits or code comments.
- **Push:** push the branch after every commit (`git push -q`), after checking that `git log -1 --format='%an <%ae> | %cn <%ce>'` shows only Arjun Nair.
- **Backend tests:** from `backend/`, run `SECRET_KEY=ci-test-secret-key RUNNING_LOCALLY=true python -m pytest -q -p no:cacheprovider` with the system python. Unit tests use synthetic lap DataFrames, never the network.
- **Frontend checks:** from `frontend/`, run `npx vitest run`, `npx tsc --noEmit` and `node scripts/check-legacy.mjs --all`.
- **House style:**
  - sentence case;
  - `uppercase` only with `font-display`;
  - no `text-white`;
  - Tailwind tokens, never hex, in className.
- **Axios mocks:** the mock resolves `{ data: PAYLOAD }`, and the component reads `res.data`.
- **Real data:** only sessions in the FastF1 cache load, because live timing returns 401. The cached races are 2024 R1, R12, R14 and R15, 2022 R10, and 2021 R5.
- **Main checkout:** never touch `C:\Users\arjun\f1-pitwall`. Read its FastF1 cache through a scratch copy only.

## Review Focus

1. **Lap 1 and early laps.** Almost nothing is fitted yet. The page must still render, with fallback compounds marked as not fitted, and with no NaN anywhere.
2. **A driver who has already used two compounds.** The no-stop plan is legal. A driver who hasn't used two must never get "stay out" in a dry race.
3. **Safety car laps** (Silverstone 2022, Spa 2024 lap 1). `cheap_stop` is set, and the stop at N + 1 costs half. This is pinned by a test.
4. **No legal plan left** (for example N = total − 1 with one dry compound used, since R = 1 allows no stop). Status is `"stay out"` with `best` None, and `rule_breach: true`. `rule_breach` is false whenever a legal plan exists.
5. **Wet compounds** (Silverstone 2024 has intermediates). Status is "wet", there is no plan, and the driver is left out of undercuts.

---

### Task 1: The strategy core

**Files:**
- Create: `backend/app/services/pit_strategy.py`
- Test: `backend/app/tests/test_pit_strategy.py`

**Interfaces:**
- **Produces:**
  - `DriverState` (a dataclass with the state fields above).
  - `TyreModel` (a dataclass with `compounds: dict[str, (base, deg, fitted, laps)]` and `pit_loss: float`).
  - `best_plan(state, model, laps_remaining, dry=True) -> Plan | None`.
  - `pit_window(state, model, laps_remaining) -> dict`, which returns `{status, best, window, cheap_stop, rule_breach}`.
  - `undercut(chaser: DriverState, leader: DriverState, model, laps_remaining) -> dict | None`.
  - The constants named in the Definitions.

- [ ] **Step 1: Write the failing tests.** Each uses a hand-built `TyreModel` with round numbers, and each expected value is computed by hand in a comment.
  - `test_stint_cost_closed_form_matches_a_loop`.
  - `test_no_stop_is_best_when_tyres_barely_wear_and_two_compounds_used`.
  - `test_no_stop_is_illegal_with_one_dry_compound_used`. A driver on MEDIUM who has only used MEDIUM can't stay out.
  - `test_wet_running_waives_the_two_compound_rule`.
  - `test_one_stop_lap_is_where_wear_balances_pit_loss`. Example: R = 30, current HARD aged 20 with deg 0.10, fresh MEDIUM with deg 0.05 and the same base, pit loss 20. Compute the optimum by brute force in the test and assert equality.
  - `test_two_stop_beats_one_stop_when_wear_is_high`.
  - `test_min_stint_laps_respected`.
  - `test_window_is_contiguous_and_within_two_seconds`.
  - `test_status_box_now_window_open_window_opens_stay_out`.
  - `test_safety_car_halves_the_pit_loss_for_next_lap_only`.
  - `test_last_lap_has_no_stop_and_flags_a_rule_breach`.
  - `test_wet_driver_has_status_wet_and_no_plan`.
  - `test_unfitted_compound_is_never_faster_than_the_slowest_fitted_plus_penalty`.
  - `test_undercut_gain_and_verdicts`, covering likely, possible and unlikely from chosen gaps.
  - `test_no_undercut_beyond_three_seconds_or_for_wet_cars`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - Enumerate plans with numpy over `k1` and `k2`, using the closed-form sums.
  - Search two-stop plans only when `R >= 2 · MIN_STINT_LAPS + 1`.
  - With R up to 78 (Monaco), a 2-stop search over 3 × 3 compounds is about 25k plans per driver. Keep it vectorised, so all 20 drivers take under 0.5 s.
- [ ] **Step 4: Run the file and then the full backend suite.**
- [ ] **Step 5: Commit and push**: `feat(pitwindow): plan, window and undercut core`.

### Task 2: The replay adapter and the endpoint

**Files:**
- Create: `backend/app/services/pit_window.py`
- Modify: `backend/app/api/v1/endpoints.py`
- Test: `backend/app/tests/test_pit_window.py`, plus the endpoint tests in `backend/app/tests/test_analysis_endpoints.py`

**Interfaces:**
- **Consumes:** Task 1's core; `strategy_simulator.compute_compound_stats` and `estimate_pit_loss_seconds`; `session_info.neutralised_laps`; and the session loader and driver-info helpers `race_battles` uses (read `race_battles.py` for how it loads a session and builds name, team and color).
- **Produces:**
  - `pit_window_payload(session, lap: int) -> dict`.
  - `POST /api/v1/telemetry/pit-window`, with body `{year, round, session, lap}` and a 600 s memo on the loaded session, following `race_pace`.
  - Errors use `_analysis_error(e, "the pit window")`.

- [ ] **Step 1: Write the failing tests.** Use a synthetic laps frame of 3 drivers over 12 laps with a stop each, in the style of `test_race_battles.py`.
  - `test_only_known_laps_feed_the_model`. Changing a lap after N must not change the payload.
  - `test_state_reads_position_compound_age_and_used`.
  - `test_gap_ahead_from_lap_end_times`.
  - `test_retired_driver_is_left_out`.
  - `test_total_laps_rule` (scheduled against run).
  - `test_bad_lap_is_a_422` and `test_qualifying_is_a_422`, with the exact messages.
  - `test_payload_rounding_and_order`.
  - Endpoint tests: a 200 with the bare payload, the 422s, and a 502 that doesn't leak internals.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the suite.**
  - Then make real calls on a scratch copy of the cache: Spa 2024 laps 10, 20 and 30; Bahrain 2024 lap 15; Silverstone 2022 lap 20.
  - **Back-test.** For every real green-flag pit stop in the four 2024 cached races (Bahrain, Silverstone, Spa and Zandvoort), compute the window at lap `stop − 3`. Report the share of stops inside the window, ±1 lap. This is a report, not an assertion.
  - Report the timing per call.
- [ ] **Step 5: Commit and push**: `feat(pitwindow): replay any lap of a race`.

### Task 3: The page

**Files:**
- Create:
  - `frontend/src/lib/pitwindow.ts` and `.test.ts`;
  - `frontend/src/components/pitwindow/PitWindowPage.tsx`, `PitTable.tsx`, `UndercutList.tsx`, `TyreModel.tsx`, `fixtures.ts`, and tests for each;
  - `frontend/src/app/pitwindow/page.tsx`.
- Modify: `frontend/src/lib/modules.ts` and its test.

**Interfaces:**
- **Consumes:** the payload; `SessionPicker allowedSessions={["R","S"]}`; `parseRaceParams` (extended with `lap`, or read `?lap=` separately); `useAsync`; `DataTable` with `accent`; `CompoundBadge`; `Panel`; `PageHeader`; `ErrorState`.
- **Produces:** `PitWindowPage({ initial })`.

- [ ] **Step 1: Write the failing tests.**
  - **Lap stepper.** "Lap N of T" with previous and next buttons, plus a range input labelled "Lap".
    - It starts at `?lap=` or at lap `floor(T/3)` once the total is known; for the first request, use lap 10 until the total is known.
    - The ends are disabled at 1 and T − 1.
    - A change refetches (key `pit-${year}-${round}-${session}-${lap}`) and updates the URL with `router.replace`.
  - **PitTable columns:** Pos, Driver (team accent), Tyre (CompoundBadge + "12 laps"), Plan, Window and Status.
    - Plan reads "Box lap 23 → Hard", or "Box lap 18 → Medium, lap 40 → Hard", or "Stay out" or "—".
    - Window reads "Laps 21–25", or "—".
    - Status labels: "Box now", "Window open", "Window opens lap 21", "Stay out", "Wet tyres", "Can't meet the two-compound rule" (rule_breach).
    - A `cheap_stop` row shows "Safety car: a stop costs about 11 s", using `pit_loss/2` rounded.
  - **UndercutList:** "NOR on VER · 1.2 s behind · undercut gains 1.9 s → Likely", with verdict colours from tokens (likely is positive, possible is warning, unlikely is muted). An empty list reads "No car within 3 s of the car ahead."
  - **TyreModel:** one row per compound: CompoundBadge, base lap "1:47.210", wear "+0.081 s a lap", and "From 34 laps", or "Estimate, not enough laps yet" when not fitted. Then "Pit stop costs 21.4 s".
  - **The caveat, verbatim:** `"Worked out from only the laps run so far, as the pit wall would have seen it. Traffic, tyre warm-up and weather changes aren't modelled."`
  - **Module:** `{ id: "pitwindow", label: "Pit window", href: "/pitwindow", group: "Race", icon: Timer }`, after `battles`. Keep exactly five mobilePrimary.
  - A 404 shows its message with no retry. The axios mock is `{ data: PAYLOAD }`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Follow `frontend/src/components/battles/BattlesPage.tsx` for the shell.
- [ ] **Step 4: Run vitest, tsc and check-legacy.**
- [ ] **Step 5: Commit and push**: `feat(pitwindow): pit window page`.

### Task 4: Changelog and real-data check

- [ ] **Step 1: Update the changelog and the sweep.**
  - Add this item to the "Deeper analysis" changelog entry: `"Pit window: pick any lap of a race or sprint since 2018 and see each driver's best strategy from there, when their pit window opens and closes, and which close fights an undercut would win, all worked out from only the laps run so far."`
  - Add `/pitwindow` to `frontend/scripts/ui-sweep.mjs`.
- [ ] **Step 2: Controller check.** Use the scratch backend and `cdp.mjs` on the cached races:
  - Spa 2024 laps 5, 12 and 30;
  - Silverstone 2024 lap 20 (wet tyres);
  - Silverstone 2022 lap 20;
  - Monaco 2021 lap 40.

  Pass criteria:
  - no console errors at 390, 768 and 1280;
  - no overflow;
  - ui-sweep clean apart from the known issues;
  - `next build` passes with dev stopped.
- [ ] **Step 3: Commit and push**: `docs(changelog): pit window`.
