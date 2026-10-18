import { render, screen, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import CompoundCurves from "./CompoundCurves";
import { PACE } from "./fixtures";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 320 }) };
});

describe("CompoundCurves", () => {
  it("tabulates wear, stints and laps per compound in payload order", () => {
    render(<CompoundCurves compounds={PACE.compounds} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    // The first cell is the badge letter followed by the label.
    expect(rows).toEqual([
      ["MMedium", "+0.110 s/lap", "12", "260"],
      ["HHard", "−0.004 s/lap", "9", "310"],
    ]);
  });

  it("explains how the points are measured", () => {
    render(<CompoundCurves compounds={PACE.compounds} />);
    expect(screen.getByText(/Points can sit below zero when drivers push on new tyres/)).toBeInTheDocument();
    expect(screen.queryByText(/time lost/i)).not.toBeInTheDocument();
  });

  it("says so when there are no long runs", () => {
    render(<CompoundCurves compounds={[]} />);
    expect(screen.getByText("Not enough long runs")).toBeInTheDocument();
  });
});
