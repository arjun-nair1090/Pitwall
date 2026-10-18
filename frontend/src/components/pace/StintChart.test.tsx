import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { PACE } from "./fixtures";
import StintChart from "./StintChart";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 320 }) };
});

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

  it("says so when nobody has a clean lap", () => {
    render(<StintChart drivers={PACE.drivers.filter((d) => d.code === "SAR" || d.code === "ZHO")} />);
    expect(screen.getByText("No clean laps")).toBeInTheDocument();
  });
});
