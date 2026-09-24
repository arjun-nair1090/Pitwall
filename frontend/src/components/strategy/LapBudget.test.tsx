import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LapBudget from "./LapBudget";
import type { Stint } from "@/lib/strategy";

const plan = (...pairs: [Stint["compound"], number][]): Stint[] => pairs.map(([compound, laps]) => ({ compound, laps }));

describe("LapBudget", () => {
  it("states the race distance and how many laps are planned", () => {
    render(<LapBudget stints={plan(["MEDIUM", 20], ["HARD", 15])} raceLaps={44} />);
    expect(screen.getByText("44 laps")).toBeInTheDocument();
    expect(screen.getByText("35 of 44 laps planned")).toBeInTheDocument();
    expect(screen.getByText("9 laps left to plan.")).toBeInTheDocument();
  });

  it("describes the plan in words for people who can't see the bar", () => {
    render(<LapBudget stints={plan(["MEDIUM", 20], ["HARD", 24])} raceLaps={44} />);
    expect(screen.getByRole("img", { name: /Medium, laps 1 to 20. Hard, laps 21 to 44./ })).toBeInTheDocument();
  });

  it("marks a complete plan", () => {
    render(<LapBudget stints={plan(["MEDIUM", 20], ["HARD", 24])} raceLaps={44} />);
    expect(screen.getByText("All 44 laps planned.")).toBeInTheDocument();
    expect(screen.getByText("44 of 44 laps planned")).toBeInTheDocument();
  });

  it("draws one segment per stint, sized by its laps", () => {
    const { container } = render(<LapBudget stints={plan(["MEDIUM", 11], ["HARD", 33])} raceLaps={44} />);
    const segments = Array.from(container.querySelectorAll("[data-stint]")) as HTMLElement[];
    expect(segments).toHaveLength(2);
    expect(parseFloat(segments[0].style.width)).toBeCloseTo(25, 1);
    expect(parseFloat(segments[1].style.width)).toBeCloseTo(75, 1);
  });

  it("flags a plan that is longer than the race, as an alert", () => {
    render(<LapBudget stints={plan(["MEDIUM", 30], ["HARD", 20])} raceLaps={44} />);
    expect(screen.getByRole("alert")).toHaveTextContent("6 laps over the 44-lap race.");
    expect(screen.getByText("50 of 44 laps planned")).toBeInTheDocument();
  });

  it("scales an over-long plan so the whole plan still fits in the bar", () => {
    const { container } = render(<LapBudget stints={plan(["MEDIUM", 44], ["HARD", 44])} raceLaps={44} />);
    const widths = Array.from(container.querySelectorAll("[data-stint]")).map((el) => parseFloat((el as HTMLElement).style.width));
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    expect(container.querySelector("[data-race-end]")).not.toBeNull();
  });

  it("waits for the race distance", () => {
    render(<LapBudget stints={plan(["MEDIUM", 20])} raceLaps={null} />);
    expect(screen.getByText("Choose a race to see its distance.")).toBeInTheDocument();
    expect(screen.queryByText(/laps planned/)).not.toBeInTheDocument();
  });
});
