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
// Each earlier turn sent back as history is cut to this, as the server allows no more.
export const MAX_HISTORY_TEXT = 2000;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

// A path with a query of only the params that have a value.
function withQuery(path: string, params: [string, number | string | null][]): string {
  const query = params
    .filter((p): p is [string, number | string] => p[1] !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}

// Where a source's analysis lives in the app. The calendar has no page of its own.
export function sourceLink({ tool, input }: AskSource): string | null {
  const year = num(input.year);
  const race: [string, number | string | null][] = [
    ["year", year],
    ["round", num(input.round)],
    ["session", str(input.session)],
  ];
  const lap: [string, number | null] = ["lap", num(input.lap)];
  switch (tool) {
    case "race_pace":
      return withQuery("/pace", race);
    case "overtakes":
      return withQuery("/battles", race);
    case "pit_window":
      return withQuery("/pitwindow", [...race, lap]);
    case "win_probability":
      return withQuery("/winprob", [...race, lap]);
    case "championship_odds":
      return withQuery("/championship", [["year", year], ["round", num(input.after_round)]]);
    case "race_result":
      return withQuery("/archive", [["year", year]]);
    default:
      return null;
  }
}

export function sourceLabel({ tool, input }: AskSource): string {
  const year = num(input.year);
  const round = num(input.round);
  const lap = num(input.lap);
  const after = num(input.after_round);
  const named = (name: string, ...parts: (string | null)[]) => {
    const detail = parts.filter((p): p is string => p !== null).join(" ");
    return detail ? `${name} · ${detail}` : name;
  };
  const yearPart = year === null ? null : String(year);
  const roundPart = round === null ? null : `round ${round}`;
  const race = (name: string, withLap = false) =>
    named(name, yearPart, roundPart) + (withLap && lap !== null ? `, lap ${lap}` : "");
  switch (tool) {
    case "race_pace":
      return race("Race pace");
    case "overtakes":
      return race("Overtakes");
    case "pit_window":
      return race("Pit window", true);
    case "win_probability":
      return race("Win probability", true);
    case "championship_odds":
      return named("Championship odds", yearPart, after === null ? null : `after round ${after}`);
    case "race_result":
      return race("Result");
    case "season_schedule":
      return named("Calendar", yearPart);
    default:
      return tool;
  }
}
