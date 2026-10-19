import { describe, expect, it } from "vitest";
import { sourceLabel, sourceLink, type AskSource } from "./ask";

const s = (tool: string, input: Record<string, unknown>, ok = true): AskSource => ({ tool, input, ok });

describe("sourceLink", () => {
  it("links race pace, overtakes and pit window with their session", () => {
    expect(sourceLink(s("race_pace", { year: 2024, round: 14, session: "R" }))).toBe("/pace?year=2024&round=14&session=R");
    expect(sourceLink(s("overtakes", { year: 2024, round: 14, session: "S" }))).toBe("/battles?year=2024&round=14&session=S");
    expect(sourceLink(s("pit_window", { year: 2024, round: 14, session: "R", lap: 20 }))).toBe("/pitwindow?year=2024&round=14&session=R&lap=20");
  });
  it("links championship odds, leaving out the round when there is none", () => {
    expect(sourceLink(s("championship_odds", { year: 2024, after_round: 19 }))).toBe("/championship?year=2024&round=19");
    expect(sourceLink(s("championship_odds", { year: 2024 }))).toBe("/championship?year=2024");
  });
  it("links win probability, with the lap only when present", () => {
    expect(sourceLink(s("win_probability", { year: 2024, round: 14, session: "R", lap: 22 }))).toBe("/winprob?year=2024&round=14&session=R&lap=22");
    expect(sourceLink(s("win_probability", { year: 2024, round: 14, session: "R" }))).toBe("/winprob?year=2024&round=14&session=R");
  });
  it("links a race result to the archive and gives the calendar no link", () => {
    expect(sourceLink(s("race_result", { year: 2024, round: 14 }))).toBe("/archive?year=2024");
    expect(sourceLink(s("season_schedule", { year: 2024 }))).toBeNull();
  });
  it("gives an unknown tool no link", () => expect(sourceLink(s("mystery", { year: 2024 }))).toBeNull());
});

describe("sourceLabel", () => {
  it("labels each tool", () => {
    expect(sourceLabel(s("race_pace", { year: 2024, round: 14, session: "R" }))).toBe("Race pace · 2024 round 14");
    expect(sourceLabel(s("overtakes", { year: 2024, round: 14, session: "R" }))).toBe("Overtakes · 2024 round 14");
    expect(sourceLabel(s("championship_odds", { year: 2024, after_round: 19 }))).toBe("Championship odds · 2024 after round 19");
    expect(sourceLabel(s("championship_odds", { year: 2024 }))).toBe("Championship odds · 2024");
    expect(sourceLabel(s("pit_window", { year: 2024, round: 14, session: "R", lap: 20 }))).toBe("Pit window · 2024 round 14, lap 20");
    expect(sourceLabel(s("win_probability", { year: 2024, round: 14, session: "R", lap: 22 }))).toBe("Win probability · 2024 round 14, lap 22");
    expect(sourceLabel(s("win_probability", { year: 2024, round: 14, session: "R" }))).toBe("Win probability · 2024 round 14");
    expect(sourceLabel(s("race_result", { year: 2024, round: 14 }))).toBe("Result · 2024 round 14");
    expect(sourceLabel(s("season_schedule", { year: 2024 }))).toBe("Calendar · 2024");
  });
  it("falls back to the tool name for an unknown tool", () => expect(sourceLabel(s("mystery", {}))).toBe("mystery"));
});
