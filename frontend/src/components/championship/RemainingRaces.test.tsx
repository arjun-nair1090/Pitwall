import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RemainingRaces from "./RemainingRaces";
import { REMAINING } from "./fixtures";

describe("RemainingRaces", () => {
  it("lists each race with its round and date", () => {
    render(<RemainingRaces remaining={REMAINING} pointsLeft={166} />);
    expect(screen.getByText("Round 18 · United States Grand Prix · 25 Oct")).toBeInTheDocument();
    expect(screen.getByText("Round 23 · Abu Dhabi Grand Prix · 6 Dec")).toBeInTheDocument();
  });

  it("marks the sprint weekends only", () => {
    render(<RemainingRaces remaining={REMAINING} pointsLeft={166} />);
    expect(screen.getAllByText("Sprint")).toHaveLength(2);
  });

  it("says how many points are still available", () => {
    render(<RemainingRaces remaining={REMAINING} pointsLeft={166} />);
    expect(screen.getByText("Up to 166 points still available to each driver")).toBeInTheDocument();
  });

  it("says the season is over when nothing is left", () => {
    render(<RemainingRaces remaining={[]} pointsLeft={0} />);
    expect(screen.getByText("The season is over.")).toBeInTheDocument();
    expect(screen.queryByText(/still available/)).not.toBeInTheDocument();
  });
});
