import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TyreModel from "./TyreModel";
import { PIT_WINDOW } from "./fixtures";

describe("TyreModel", () => {
  it("has a row per compound in payload order", () => {
    render(<TyreModel model={PIT_WINDOW.model} pitLoss={PIT_WINDOW.pit_loss} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["MMedium", "HHard", "SSoft"]);
  });

  it("gives the base lap, the wear and the evidence for a fitted compound", () => {
    render(<TyreModel model={PIT_WINDOW.model} pitLoss={PIT_WINDOW.pit_loss} />);
    const medium = within(screen.getAllByRole("row")[1]);
    expect(medium.getByText("1:47.210")).toBeInTheDocument();
    expect(medium.getByText("+0.081 s a lap")).toBeInTheDocument();
    expect(medium.getByText("From 34 laps")).toBeInTheDocument();
  });

  it("marks a compound that isn't fitted as an estimate", () => {
    render(<TyreModel model={PIT_WINDOW.model} pitLoss={PIT_WINDOW.pit_loss} />);
    const soft = within(screen.getAllByRole("row")[3]);
    expect(soft.getByText("Estimate, not enough laps yet")).toBeInTheDocument();
    expect(soft.queryByText(/From/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/^From \d+ laps$/)).toHaveLength(2);
  });

  it("states what a pit stop costs", () => {
    render(<TyreModel model={PIT_WINDOW.model} pitLoss={PIT_WINDOW.pit_loss} />);
    expect(screen.getByText("Pit stop costs 21.4 s")).toBeInTheDocument();
  });
});
