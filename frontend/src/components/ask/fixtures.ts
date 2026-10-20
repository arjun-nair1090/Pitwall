import type { AskResponse } from "@/lib/ask";

export const ASK_ANSWER: AskResponse = {
  answer: "Norris had the best race pace at Spa, 0.3 s a lap clear of Verstappen.",
  sources: [
    { tool: "race_pace", input: { year: 2024, round: 14, session: "R" }, ok: true },
    { tool: "season_schedule", input: { year: 2024 }, ok: true },
    { tool: "overtakes", input: { year: 2024, round: 14, session: "R" }, ok: false },
  ],
};
