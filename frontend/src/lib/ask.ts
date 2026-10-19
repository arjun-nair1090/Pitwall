export interface AskSource {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
}

export interface AskResponse {
  answer: string;
  sources: AskSource[];
}

export interface AskTurn {
  role: "user" | "assistant";
  text: string;
}

export const MAX_QUESTION = 500;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Where a source's analysis lives in the app. The calendar has no page of its own.
export function sourceLink({ tool, input }: AskSource): string | null {
  const year = num(input.year);
  const round = num(input.round);
  const lap = num(input.lap);
  const session = typeof input.session === "string" ? input.session : "R";
  const race = `year=${year}&round=${round}&session=${session}`;
  switch (tool) {
    case "race_pace":
      return `/pace?${race}`;
    case "overtakes":
      return `/battles?${race}`;
    case "pit_window":
      return `/pitwindow?${race}&lap=${lap}`;
    case "win_probability":
      return `/winprob?${race}${lap === null ? "" : `&lap=${lap}`}`;
    case "championship_odds": {
      const after = num(input.after_round);
      return `/championship?year=${year}${after === null ? "" : `&round=${after}`}`;
    }
    case "race_result":
      return `/archive?year=${year}`;
    default:
      return null;
  }
}

export function sourceLabel({ tool, input }: AskSource): string {
  const year = num(input.year);
  const round = num(input.round);
  const lap = num(input.lap);
  const race = `${year} round ${round}`;
  switch (tool) {
    case "race_pace":
      return `Race pace · ${race}`;
    case "overtakes":
      return `Overtakes · ${race}`;
    case "pit_window":
      return `Pit window · ${race}, lap ${lap}`;
    case "win_probability":
      return `Win probability · ${race}${lap === null ? "" : `, lap ${lap}`}`;
    case "championship_odds": {
      const after = num(input.after_round);
      return `Championship odds · ${year}${after === null ? "" : ` after round ${after}`}`;
    }
    case "race_result":
      return `Result · ${race}`;
    case "season_schedule":
      return `Calendar · ${year}`;
    default:
      return tool;
  }
}
