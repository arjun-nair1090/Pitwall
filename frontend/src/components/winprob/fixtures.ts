import type { WinProbResult } from "@/lib/winprob";

// A 6-lap race. The drivers are in lap-1 order, which is neither alphabetical nor finishing order, and
// VER is the later of the two Red Bulls. ALB never reaches 5%, so he has no line. Lap 3 is the only lap
// LEC leads; lap 4 (the selected lap) is the only one VER leads before the end, and its row in `laps`
// is the same as `at`. Laps 2, 4 and 5 are safety-car laps, so the shading is two areas, not three.
// Lap 1 sums to 0.99 and lap 3 to 0.98: a lap needn't sum to 1.
export const WIN_PROB: WinProbResult = {
  year: 2024, round: 14, session: "R", total_laps: 6, sims: 1500,
  sc_laps: [2, 4, 5],
  laps: [
    { lap: 1, odds: { NOR: 0.3, PER: 0.25, LEC: 0.25, VER: 0.15, ALB: 0.04 } },
    { lap: 2, odds: { NOR: 0.45, LEC: 0.3, PER: 0.12, VER: 0.1, ALB: 0.03 } },
    { lap: 3, odds: { LEC: 0.4, NOR: 0.33, VER: 0.15, PER: 0.08, ALB: 0.02 } },
    { lap: 4, odds: { VER: 0.55, LEC: 0.25, NOR: 0.12, PER: 0.06, ALB: 0.01 } },
    { lap: 5, odds: { VER: 0.7, LEC: 0.15, NOR: 0.1, PER: 0.05 } },
    { lap: 6, odds: { VER: 1 } },
  ],
  drivers: [
    { code: "NOR", name: "Lando Norris", team: "McLaren", color: "#FF8000" },
    { code: "PER", name: "Sergio Perez", team: "Red Bull Racing", color: "#3671C6" },
    { code: "LEC", name: "Charles Leclerc", team: "Ferrari", color: "#E80020" },
    { code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6" },
    { code: "ALB", name: "Alexander Albon", team: "Williams", color: "#64C4FF" },
  ],
  at: {
    lap: 4,
    rows: [
      { code: "LEC", position: 1, gap: 0, projected_gap: 3.4, probability: 0.25, status: "stay out", rule_breach: false, window_open: null },
      { code: "VER", position: 2, gap: 3.4, projected_gap: 0, probability: 0.55, status: "window opens", rule_breach: false, window_open: 21 },
      { code: "NOR", position: 3, gap: 5.1, projected_gap: 1.2, probability: 0.12, status: "box now", rule_breach: false, window_open: 19 },
      { code: "PER", position: 4, gap: 9.8, projected_gap: 6.7, probability: 0.06, status: "stay out", rule_breach: true, window_open: null },
      { code: "ALB", position: 5, gap: 14.25, projected_gap: 11, probability: 0.01, status: "wet", rule_breach: false, window_open: null },
    ],
  },
};
