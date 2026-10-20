import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import CornerHeatmap from "./CornerHeatmap";
import type { CornerConsistencyRow } from "@/lib/corners";

// A corner whose zone times are `times`, one per lap in `laps`.
const corner = (label: string, laps: number[], times: number[]): CornerConsistencyRow => {
  const best = Math.min(...times);
  return {
    label, number: Number(label.replace(/\D/g, "")), letter: label.replace(/^T\d+/, ""),
    apex_speed: { mean: 100, sd: 1 },
    brake_before_m: null,
    zone_time: { best, mean: best, sd: 0 },
    per_lap: laps.map((lap, i) => ({ lap, zone_time: times[i], delta_to_best: times[i] - best, apex_speed: 100, brake_before_m: null })),
  };
};

const LAPS = [3, 12, 20];
const CORNERS = [corner("T1", LAPS, [5.1, 5.0, 5.2]), corner("T5", LAPS, [8.0, 8.084, 8.3])];

const cells = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-cell]"));

describe("CornerHeatmap", () => {
  it("draws one cell for every lap through every corner", () => {
    const { container } = render(<CornerHeatmap laps={LAPS} corners={CORNERS} />);
    expect(cells(container)).toHaveLength(LAPS.length * CORNERS.length);
  });

  it("names every cell by its lap, its corner and the time lost to the best", () => {
    const { container } = render(<CornerHeatmap laps={LAPS} corners={CORNERS} />);
    expect(screen.getByRole("img", { name: "Lap 12, T5: 0.084 s off best" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Lap 20, T1: 0.200 s off best" })).toBeInTheDocument();
    for (const cell of cells(container)) {
      expect(cell).toHaveAccessibleName(/^Lap \d+, T\d+[A-Z]?: (\d+\.\d{3} s off best|the best, \d+\.\d{3} s)$/);
    }
  });

  it("marks the best lap through each corner", () => {
    const { container } = render(<CornerHeatmap laps={LAPS} corners={CORNERS} />);
    const best = Array.from(container.querySelectorAll("[data-best]"));
    expect(best).toHaveLength(CORNERS.length);
    expect(best.map((c) => c.getAttribute("aria-label"))).toEqual(["Lap 12, T1: the best, 5.000 s", "Lap 3, T5: the best, 8.000 s"]);
  });

  it("caps the colour scale at the 95th percentile so one bad lap doesn't wash out the rest", () => {
    // 20 laps 0.01 s apart, then one lap 5 s off: the cap lands on the 0.190 s lap, not the outlier
    const laps = Array.from({ length: 21 }, (_, i) => i + 1);
    const times = laps.map((_, i) => (i < 20 ? 10 + i * 0.01 : 15));
    const { container } = render(<CornerHeatmap laps={laps} corners={[corner("T1", laps, times)]} />);
    const fill = (lap: number) => container.querySelector(`[data-cell][aria-label^="Lap ${lap},"]`)?.getAttribute("fill");
    expect(fill(21)).toBe(fill(20)); // the outlier and the 95th percentile share the top of the scale
    expect(fill(1)).not.toBe(fill(20));
    expect(fill(10)).not.toBe(fill(1));
    expect(fill(10)).not.toBe(fill(20));
    expect(screen.getByText("0.190 s or more")).toBeInTheDocument();
  });

  it("explains the scale with a legend", () => {
    render(<CornerHeatmap laps={LAPS} corners={CORNERS} />);
    const legend = screen.getByRole("group", { name: "Colour scale" });
    expect(within(legend).getByText("0.000 s")).toBeInTheDocument();
    expect(within(legend).getByText(/Best lap through the corner/)).toBeInTheDocument();
  });

  it("shows the lap's figures on hover", async () => {
    render(<CornerHeatmap laps={LAPS} corners={CORNERS} />);
    await userEvent.hover(screen.getByRole("img", { name: "Lap 12, T5: 0.084 s off best" }));
    const tip = screen.getByTestId("heatmap-tooltip");
    expect(tip).toHaveTextContent("0.084 s off best");
    expect(tip).toHaveTextContent("Lap 12, T5, 8.084 s");
  });
});
