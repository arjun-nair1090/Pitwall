import type { RacePaceResult } from "@/lib/pace";

const lap = { lap: 2, time: 108.9, corrected: 106.3, tyre_life: 2 };
const fit = { from: { lap: 2, time: 106.2 }, to: { lap: 10, time: 107 } };

// A small field for the pace tests: two ranked drivers and two who retired too early to rank.
export const PACE: RacePaceResult = {
  fuel: { start_kg: 110, kg_per_lap: 2.5, seconds_per_kg: 0.03, seconds_per_lap: 0.075, total_laps: 44 },
  drivers: [
    {
      code: "NOR", name: "Lando Norris", team: "McLaren", color: "#FF8000", pace: 106.3, gap: 0, clean_laps: 39,
      stints: [
        { stint: 1, compound: "MEDIUM", start_lap: 1, end_lap: 20, deg_per_lap: 0.106, fit, laps: [lap, { lap: 10, time: 109.6, corrected: 107, tyre_life: 10 }] },
        { stint: 2, compound: "UNKNOWN", start_lap: 21, end_lap: 44, deg_per_lap: null, fit: null, laps: [] },
      ],
    },
    {
      code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6", pace: 106.6124, gap: 0.3124, clean_laps: 37,
      stints: [{ stint: 1, compound: "HARD", start_lap: 1, end_lap: 44, deg_per_lap: -0.012, fit, laps: [lap] }],
    },
    {
      code: "SAR", name: "Logan Sargeant", team: "Williams", color: "#64C4FF", pace: null, gap: null, clean_laps: 2,
      stints: [{ stint: 1, compound: "SOFT", start_lap: 1, end_lap: 8, deg_per_lap: null, fit: null, laps: [] }],
    },
    { code: "ZHO", name: "Zhou Guanyu", team: "Kick Sauber", color: "#52E252", pace: null, gap: null, clean_laps: 0, stints: [] },
  ],
  compounds: [
    { compound: "MEDIUM", deg_per_lap: 0.11, stints: 12, laps: 260, curve: [{ tyre_life: 2, loss: 0.21, laps: 18 }, { tyre_life: 9, loss: 0.98, laps: 7 }] },
    { compound: "HARD", deg_per_lap: -0.004, stints: 9, laps: 310, curve: [{ tyre_life: 2, loss: -0.53, laps: 9 }, { tyre_life: 14, loss: 0.1, laps: 5 }] },
  ],
};
