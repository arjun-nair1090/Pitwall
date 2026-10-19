import type { PitDriver, PitWindowResult } from "@/lib/pitwindow";

// A driver with every field filled in; tests override what they care about.
export const driver = (o: Partial<PitDriver>): PitDriver => ({
  code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6", position: 1, compound: "MEDIUM",
  tyre_age: 12, used: ["MEDIUM"], gap_ahead: null, status: "stay out", best: null, window: null, cheap_stop: false,
  rule_breach: false, ...o,
});

// Lap 18 of 44, so 26 laps remain and a stop can be on laps 19 to 43. Positions, gaps and undercuts
// agree: each undercut's gap is its chaser's gap_ahead and margin is gain minus gap. The drivers are
// in position order and not alphabetical, and the undercuts are in margin order and not alphabetical
// by chaser, so a page that re-sorts either list is caught.
export const PIT_WINDOW: PitWindowResult = {
  year: 2024, round: 14, session: "R", lap: 18, total_laps: 44, laps_remaining: 26, pit_loss: 21.4, sc_lap: false,
  model: [
    { compound: "MEDIUM", base: 107.21, deg_per_lap: 0.0814, fitted: true, laps: 34 },
    { compound: "HARD", base: 107.9, deg_per_lap: 0.052, fitted: true, laps: 29 },
    { compound: "SOFT", base: 106.8, deg_per_lap: 0.12, fitted: false, laps: 4 },
  ],
  drivers: [
    driver({
      code: "VER", name: "Max Verstappen", position: 1, compound: "MEDIUM", tyre_age: 12, used: ["MEDIUM"], gap_ahead: null,
      status: "box now", best: { stops: [{ lap: 19, compound: "HARD" }], cost: 2851.3 }, window: { open: 19, close: 23 },
    }),
    driver({
      code: "NOR", name: "Lando Norris", team: "McLaren", color: "#FF8000", position: 2, compound: "MEDIUM", tyre_age: 15, used: ["MEDIUM"],
      gap_ahead: 1.2, status: "window opens", best: { stops: [{ lap: 23, compound: "HARD" }], cost: 2852.9 }, window: { open: 21, close: 25 },
    }),
    driver({
      code: "HAM", name: "Lewis Hamilton", team: "Mercedes", color: "#27F4D2", position: 3, compound: "HARD", tyre_age: 3, used: ["MEDIUM", "HARD"],
      gap_ahead: 2, status: "stay out", best: { stops: [], cost: 2860.1 }, window: null,
    }),
    driver({
      code: "ALO", name: "Fernando Alonso", team: "Aston Martin", color: "#229971", position: 4, compound: "SOFT", tyre_age: 6, used: ["SOFT"],
      gap_ahead: 2.8, status: "window opens",
      best: { stops: [{ lap: 22, compound: "MEDIUM" }, { lap: 40, compound: "HARD" }], cost: 2870.4 }, window: { open: 21, close: 24 },
    }),
    driver({
      code: "LEC", name: "Charles Leclerc", team: "Ferrari", color: "#E8002D", position: 5, compound: "INTERMEDIATE", tyre_age: 2,
      used: ["MEDIUM", "INTERMEDIATE"], gap_ahead: 9.1, status: "wet", best: null, window: null,
    }),
  ],
  undercuts: [
    { chaser: "NOR", leader: "VER", gap: 1.2, gain: 1.9, margin: 0.7, verdict: "likely", compound: "HARD" },
    { chaser: "HAM", leader: "NOR", gap: 2, gain: 2.1, margin: 0.1, verdict: "possible", compound: "MEDIUM" },
    { chaser: "ALO", leader: "HAM", gap: 2.8, gain: 1.4, margin: -1.4, verdict: "unlikely", compound: "MEDIUM" },
  ],
};

// Lap 18 behind a safety car: every dry car gets the cheap stop, and a stop costs half of 21.4 s.
export const PIT_WINDOW_SC: PitWindowResult = {
  ...PIT_WINDOW,
  sc_lap: true,
  drivers: [
    driver({
      code: "VER", position: 1, status: "box now", cheap_stop: true,
      best: { stops: [{ lap: 19, compound: "HARD" }], cost: 2840.2 }, window: { open: 19, close: 20 },
    }),
    driver({
      code: "NOR", name: "Lando Norris", team: "McLaren", color: "#FF8000", position: 2, gap_ahead: 0.8, status: "box now", cheap_stop: true,
      best: { stops: [{ lap: 19, compound: "HARD" }], cost: 2841.5 }, window: { open: 19, close: 21 },
    }),
  ],
  undercuts: [],
};

// Lap 43 of 44: one lap left, so no stop is possible, and a car that has only used one dry
// compound can't meet the two-compound rule.
export const PIT_WINDOW_LAST: PitWindowResult = {
  ...PIT_WINDOW,
  lap: 43, laps_remaining: 1,
  drivers: [
    driver({ code: "PIA", name: "Oscar Piastri", team: "McLaren", color: "#FF8000", position: 1, compound: "HARD", tyre_age: 40, used: ["HARD"],
      status: "stay out", best: null, window: null, rule_breach: true }),
    driver({ code: "RUS", name: "George Russell", team: "Mercedes", color: "#27F4D2", position: 2, compound: "MEDIUM", tyre_age: 30,
      used: ["HARD", "MEDIUM"], gap_ahead: 3.4, status: "stay out", best: { stops: [], cost: 107.3 }, window: null }),
  ],
  undercuts: [],
};
