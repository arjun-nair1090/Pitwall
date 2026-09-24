import { describe, expect, it } from "vitest";
import {
  finishOrder, formatRaceTime, gridOrder, positionsGained, resultLabel, winnerCaption, type ClassificationRow,
} from "./latestResult";

const row = (over: Partial<ClassificationRow>): ClassificationRow => ({
  position: 1, code: "VER", name: "Max Verstappen", team: "Red Bull Racing", grid: 1, status: "Finished",
  finished: true, race_time_seconds: null, gap_seconds: null, ...over,
});

const field = [
  row({ position: 1, code: "VER", grid: 7, race_time_seconds: 5527.986 }),
  row({ position: 2, code: "NOR", grid: 1, gap_seconds: 3.5 }),
  row({ position: 3, code: "LEC", grid: 5, gap_seconds: 9.25 }),
  row({ position: 4, code: "HAM", grid: 5, status: "+1 Lap" }),
  row({ position: 5, code: "ALO", grid: 2, status: "Engine", finished: false }),
];

describe("ordering", () => {
  it("orders by grid, breaking ties by finishing position, without mutating", () => {
    expect(gridOrder(field).map((r) => r.code)).toEqual(["NOR", "ALO", "LEC", "HAM", "VER"]);
    expect(field[0].code).toBe("VER");
  });
  it("orders by finishing position", () => {
    expect(finishOrder([...field].reverse()).map((r) => r.code)).toEqual(["VER", "NOR", "LEC", "HAM", "ALO"]);
  });
  it("counts positions gained from the grid", () => {
    expect(positionsGained(field[0])).toBe(6);
    expect(positionsGained(field[4])).toBe(-3);
  });
});

describe("labels", () => {
  it("formats a race time as h:mm:ss.mmm", () => {
    expect(formatRaceTime(5400)).toBe("1:30:00.000");
    expect(formatRaceTime(5527.986)).toBe("1:32:07.986");
  });
  it("labels the winner with the race time and others with the gap", () => {
    expect(resultLabel(field[0])).toBe("1:32:07.986");
    expect(resultLabel(field[1])).toBe("+3.500");
  });
  it("falls back to the status for lapped and retired cars, then a dash", () => {
    expect(resultLabel(field[3])).toBe("+1 Lap");
    expect(resultLabel(field[4])).toBe("Engine");
    expect(resultLabel(row({ position: 9, status: null }))).toBe("–");
  });
  it("captions the winner from the grid", () => {
    expect(winnerCaption(field)).toBe("Max Verstappen won from P7, up 6 places.");
    expect(winnerCaption([row({ grid: 1 })])).toBe("Max Verstappen won from pole.");
    expect(winnerCaption([row({ grid: 2 })])).toBe("Max Verstappen won from P2, up 1 place.");
  });
});
