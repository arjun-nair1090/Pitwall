import type { RaceBattlesResult } from "@/lib/battles";

// A small race for the battles tests: a finisher who gained at the start, a pit-lane starter, and a
// driver who retired, so every "no value" case is covered.
export const BATTLES: RaceBattlesResult = {
  total_laps: 4,
  drivers: [
    { code: "NOR", name: "Lando Norris", team: "McLaren", color: "#FF8000", grid: 3, finish: 1, finish_note: null, start_gain: 2, made: 4, lost: 0, positions: [1, 1, 1, 1] },
    { code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6", grid: 11, finish: 2, finish_note: null, start_gain: -2, made: 3, lost: 1, positions: [13, 8, 7, 2] },
    { code: "SAR", name: "Logan Sargeant", team: "Williams", color: "#64C4FF", grid: null, finish: 15, finish_note: null, start_gain: null, made: 0, lost: 2, positions: [19, 18, 17, 15] },
    { code: "ZHO", name: "Zhou Guanyu", team: "Kick Sauber", color: "#52E252", grid: 5, finish: null, finish_note: "DNF", start_gain: 0, made: 0, lost: 0, positions: [5, 6, null, null] },
  ],
  overtakes: [
    { lap: 2, driver: "VER", passed: "MAG", position: 10 },
    { lap: 3, driver: "NOR", passed: "VER", position: 1 },
    { lap: 4, driver: "VER", passed: "SAR", position: 2 },
  ],
  battles: [
    { chaser: "NOR", leader: "VER", start_lap: 35, end_lap: 44, laps: 10, min_gap: 0.426, outcome: "flag", outcome_lap: 44 },
    { chaser: "HAM", leader: "RUS", start_lap: 12, end_lap: 15, laps: 4, min_gap: 0.8, outcome: "passed", outcome_lap: 16 },
    { chaser: "ALO", leader: "STR", start_lap: 20, end_lap: 22, laps: 3, min_gap: 0.5, outcome: "dropped", outcome_lap: null },
  ],
};

// A race whose positions, overtakes and lap count agree, for the lap chart: the lead changing hands
// on laps 2, 3 and 4 (so each lap's leader differs from its neighbours'), a pit-lane starter,
// teammates sharing a colour, and a driver who retires on the last lap.
export const LAP_CHART: RaceBattlesResult = {
  total_laps: 4,
  drivers: [
    { code: "NOR", name: "Lando Norris", team: "McLaren", color: "#FF8000", grid: 3, finish: 1, finish_note: null, start_gain: 1, made: 2, lost: 1, positions: [2, 1, 2, 1] },
    { code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6", grid: 1, finish: 2, finish_note: null, start_gain: 0, made: 1, lost: 2, positions: [1, 2, 1, 2] },
    { code: "PIA", name: "Oscar Piastri", team: "McLaren", color: "#FF8000", grid: null, finish: 3, finish_note: null, start_gain: null, made: 1, lost: 0, positions: [4, 4, 3, 3] },
    { code: "HAM", name: "Lewis Hamilton", team: "Mercedes", color: "#27F4D2", grid: 4, finish: null, finish_note: "DNF", start_gain: 1, made: 0, lost: 1, positions: [3, 3, 4, null] },
  ],
  overtakes: [
    { lap: 2, driver: "NOR", passed: "VER", position: 1 },
    { lap: 3, driver: "VER", passed: "NOR", position: 1 },
    { lap: 3, driver: "PIA", passed: "HAM", position: 3 },
    { lap: 4, driver: "NOR", passed: "VER", position: 1 },
  ],
  battles: [],
};
