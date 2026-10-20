import type { ChampionDriver, ChampionTeam, ChampionshipResult, HistoryPoint, RemainingRound } from "@/lib/championship";

// 2026 after round 17 of 23. Six races are left, two of them sprints, so a driver can still add
// 6 x 25 + 2 x 8 = 166 points.
function driver(
  code: string, name: string, team: string, points: number, wins: number, odds: number,
  expected: number, p10: number, p90: number, status: ChampionDriver["status"] = "contender",
  racing = true,
): ChampionDriver {
  return {
    code, name, team, points, wins, title_probability: odds, expected_points: expected,
    points_p10: p10, points_p90: p90, max_points: racing ? points + 166 : points, status,
  };
}

export const DRIVERS: ChampionDriver[] = [
  driver("ANT", "Kimi Antonelli", "Mercedes", 340, 6, 0.8412, 345.2, 318, 372),
  driver("RUS", "George Russell", "Mercedes", 238, 3, 0.0931, 263.4, 232, 296),
  driver("HAM", "Lewis Hamilton", "Ferrari", 229, 2, 0.0412, 255.1, 224, 288),
  driver("VER", "Max Verstappen", "Red Bull", 221, 3, 0.0188, 248.9, 214, 281),
  driver("LEC", "Charles Leclerc", "Ferrari", 215, 1, 0.0049, 240.3, 207, 274),
  driver("NOR", "Lando Norris", "McLaren", 201, 1, 0.0008, 229.6, 195, 262),
  driver("ALB", "Alexander Albon", "Williams", 40.5, 0, 0, 52.3, 38.5, 68, "eliminated"),
  driver("LAW", "Liam Lawson", "RB F1 Team", 30, 0, 0, 30, 30, 30, "not racing", false),
];

export const CONSTRUCTORS: ChampionTeam[] = [
  { team: "Mercedes", points: 578, title_probability: 0.9981, expected_points: 608.6, status: "contender" },
  { team: "Ferrari", points: 444, title_probability: 0.0019, expected_points: 495.4, status: "contender" },
  { team: "Red Bull", points: 311, title_probability: 0, expected_points: 352.1, status: "eliminated" },
  { team: "Audi", points: 120, title_probability: 0, expected_points: 138.7, status: "eliminated" },
];

export const REMAINING: RemainingRound[] = [
  { round: 18, name: "United States Grand Prix", date: "2026-10-25", sprint: true },
  { round: 19, name: "Mexico City Grand Prix", date: "2026-11-01", sprint: false },
  { round: 20, name: "Sao Paulo Grand Prix", date: "2026-11-08", sprint: true },
  { round: 21, name: "Las Vegas Grand Prix", date: "2026-11-21", sprint: false },
  { round: 22, name: "Qatar Grand Prix", date: "2026-11-29", sprint: false },
  { round: 23, name: "Abu Dhabi Grand Prix", date: "2026-12-06", sprint: false },
];

export const CHAMPIONSHIP: ChampionshipResult = {
  year: 2026,
  after_round: 17,
  completed_rounds: 17,
  total_rounds: 23,
  simulations: 10000,
  points_available: 166,
  rounds: [
    { round: 16, name: "Italian Grand Prix" },
    { round: 17, name: "Singapore Grand Prix" },
  ],
  remaining: REMAINING,
  drivers: DRIVERS,
  constructors: CONSTRUCTORS,
  history: [
    { round: 16, name: "Italian Grand Prix", odds: { ANT: 0.71, RUS: 0.2, HAM: 0.09 } },
    { round: 17, name: "Singapore Grand Prix", odds: { ANT: 0.8412, RUS: 0.0931, HAM: 0.0412 } },
  ],
};

// The season is over: the champion is clinched and nobody is left to race.
export const SEASON_OVER: ChampionshipResult = {
  ...CHAMPIONSHIP,
  after_round: 23,
  completed_rounds: 23,
  points_available: 0,
  remaining: [],
  drivers: [
    { ...DRIVERS[0], points: 410, max_points: 410, title_probability: 1, status: "clinched" },
    { ...DRIVERS[1], points: 372, max_points: 372, title_probability: 0, status: "eliminated" },
  ],
  constructors: [{ ...CONSTRUCTORS[0], title_probability: 1, status: "clinched" }],
};

// A season in four rounds, in the shape of a real history: only drivers with non-zero odds appear,
// the lead changes hands, and each round sums to about 1. The drivers are listed in an order that is
// neither alphabetical nor the order they first appear in the history. LEC never reaches 1%.
function seasonDriver(code: string, name: string, team: string): ChampionDriver {
  return { ...DRIVERS[0], code, name, team };
}

export const HISTORY_DRIVERS: ChampionDriver[] = [
  seasonDriver("HAM", "Lewis Hamilton", "Ferrari"),
  seasonDriver("VER", "Max Verstappen", "Red Bull"),
  seasonDriver("NOR", "Lando Norris", "McLaren"),
  seasonDriver("PIA", "Oscar Piastri", "McLaren"),
  seasonDriver("LEC", "Charles Leclerc", "Ferrari"),
];

export const SEASON_HISTORY: HistoryPoint[] = [
  { round: 1, name: "Australian Grand Prix", odds: { VER: 0.4, NOR: 0.3, PIA: 0.2, HAM: 0.096, LEC: 0.004 } },
  { round: 2, name: "Chinese Grand Prix", odds: { NOR: 0.45, VER: 0.3, PIA: 0.15, HAM: 0.1 } },
  { round: 3, name: "Japanese Grand Prix", odds: { PIA: 0.5, NOR: 0.25, HAM: 0.15, VER: 0.1 } },
  { round: 4, name: "Bahrain Grand Prix", odds: { NOR: 0.6, PIA: 0.3, HAM: 0.1 } },
];
