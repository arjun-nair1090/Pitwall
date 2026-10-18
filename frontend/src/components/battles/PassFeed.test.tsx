import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import PassFeed from "./PassFeed";
import { BATTLES } from "./fixtures";

const lines = () => screen.getAllByRole("listitem").map((li) => li.textContent);

describe("PassFeed", () => {
  it("lists every pass in payload order", () => {
    render(<PassFeed overtakes={BATTLES.overtakes} drivers={BATTLES.drivers} />);
    expect(lines()).toEqual([
      "Lap 2 · VER passed MAG for P10",
      "Lap 3 · NOR passed VER for P1",
      "Lap 4 · VER passed SAR for P2",
    ]);
  });

  it("defaults to all drivers", () => {
    render(<PassFeed overtakes={BATTLES.overtakes} drivers={BATTLES.drivers} />);
    expect(screen.getByLabelText("Driver")).toHaveValue("");
    expect(screen.getByRole("option", { name: "All drivers" })).toBeInTheDocument();
  });

  it("filters to passes a driver made or suffered", async () => {
    render(<PassFeed overtakes={BATTLES.overtakes} drivers={BATTLES.drivers} />);
    await userEvent.selectOptions(screen.getByLabelText("Driver"), "NOR");
    expect(lines()).toEqual(["Lap 3 · NOR passed VER for P1"]);
    await userEvent.selectOptions(screen.getByLabelText("Driver"), "SAR");
    expect(lines()).toEqual(["Lap 4 · VER passed SAR for P2"]);
  });

  it("says so when there were no passes", () => {
    render(<PassFeed overtakes={[]} drivers={BATTLES.drivers} />);
    expect(screen.getByText("No on-track passes")).toBeInTheDocument();
  });
});
