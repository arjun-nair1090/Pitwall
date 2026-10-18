import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DriverMoves from "./DriverMoves";
import { BATTLES } from "./fixtures";

const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

describe("DriverMoves", () => {
  it("has the columns, in order", () => {
    render(<DriverMoves drivers={BATTLES.drivers} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Driver", "Grid", "Finish", "Start", "Passes made", "Passes lost",
    ]);
  });

  it("lists rows in payload order with code and team", () => {
    render(<DriverMoves drivers={BATTLES.drivers} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => cellsOf(r)[0])).toEqual(["NORMcLaren", "VERRed Bull Racing", "SARWilliams", "ZHOKick Sauber"]);
    expect(cellsOf(rows[0]).slice(1)).toEqual(["3", "1", "+2", "4", "0"]);
  });

  it("shows a pit-lane starter as Pit lane in grid and start", () => {
    render(<DriverMoves drivers={BATTLES.drivers} />);
    const cells = cellsOf(screen.getAllByRole("row")[3]);
    expect(cells[1]).toBe("Pit lane");
    expect(cells[3]).toBe("Pit lane");
  });

  it("dashes a non-finisher's finish", () => {
    render(<DriverMoves drivers={BATTLES.drivers} />);
    expect(cellsOf(screen.getAllByRole("row")[4])[2]).toBe("—");
  });
});
