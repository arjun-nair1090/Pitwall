import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { PACE } from "./fixtures";
import type { PaceDriver } from "@/lib/pace";
import StintChart from "./StintChart";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 320 }) };
});

// Two stints with laps, so a tooltip that looks points up by index instead of by lap shows the
// first stint's lap when the second stint's point is hovered.
const twoStints: PaceDriver = {
  code: "PIA", name: "Oscar Piastri", team: "McLaren", color: "#FF8000", pace: 106.4, gap: 0, clean_laps: 6,
  stints: [
    {
      stint: 1, compound: "MEDIUM", start_lap: 1, end_lap: 5, deg_per_lap: null, fit: null,
      laps: [2, 3, 4].map((lap) => ({ lap, time: 108 + lap / 10, corrected: 106 + lap / 10, tyre_life: lap })),
    },
    {
      stint: 2, compound: "HARD", start_lap: 6, end_lap: 9, deg_per_lap: null, fit: null,
      laps: [7, 8, 9].map((lap) => ({ lap, time: 109 + lap / 10, corrected: 107 + lap / 10, tyre_life: lap - 6 })),
    },
  ],
};

const legend = () => within(screen.getByRole("list", { name: "Stints" })).getAllByRole("listitem").map((li) => li.textContent);

describe("StintChart", () => {
  it("lists the drivers with clean laps, fastest first", () => {
    render(<StintChart drivers={PACE.drivers} />);
    const options = within(screen.getByLabelText("Driver")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Lando Norris (NOR)", "Max Verstappen (VER)"]);
    expect(screen.getByLabelText("Driver")).toHaveValue("NOR");
  });

  it("gives every stint a legend item, with no clean laps said plainly", () => {
    render(<StintChart drivers={PACE.drivers} />);
    expect(legend()).toEqual(["Stint 1 · Medium · laps 1–20 · +0.106 s/lap", "Stint 2 · Unknown · laps 21–44 · no clean laps"]);
  });

  it("changes the legend with the driver", async () => {
    render(<StintChart drivers={PACE.drivers} />);
    await userEvent.selectOptions(screen.getByLabelText("Driver"), "VER");
    expect(legend()).toEqual(["Stint 1 · Hard · laps 1–44 · −0.012 s/lap"]);
  });

  it("shows the hovered point's own lap in the tooltip", () => {
    const { container } = render(<StintChart drivers={[twoStints]} />);
    const symbols = container.querySelectorAll(".recharts-scatter-symbol");
    expect(symbols).toHaveLength(6);
    fireEvent.mouseEnter(symbols[4]);
    const tooltip = container.querySelector(".recharts-tooltip-wrapper") as HTMLElement;
    expect(within(tooltip).getByText("Lap 8")).toBeInTheDocument();
    expect(within(tooltip).getByText("1:47.800")).toBeInTheDocument();
    expect(within(tooltip).getByText("1:49.800")).toBeInTheDocument();
    expect(within(tooltip).getByText("2")).toBeInTheDocument();
  });

  it("draws a dashed wear line for each stint with a slope", () => {
    const { container } = render(<StintChart drivers={PACE.drivers} />);
    const lines = container.querySelectorAll(".recharts-reference-line line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveAttribute("stroke-dasharray", "6 4");
  });

  it("describes the chart for screen readers", () => {
    render(<StintChart drivers={PACE.drivers} />);
    expect(screen.getByRole("img", { name: "Lap times for Lando Norris, fuel-corrected, by stint" })).toBeInTheDocument();
  });

  it("says so when nobody has a clean lap", () => {
    render(<StintChart drivers={PACE.drivers.filter((d) => d.code === "SAR" || d.code === "ZHO")} />);
    expect(screen.getByText("No clean laps")).toBeInTheDocument();
  });
});
