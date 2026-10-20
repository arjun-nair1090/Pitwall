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

  it("says a retirement or a disqualification instead of a place, and dashes an unknown finish", () => {
    const [nor, , , zho] = BATTLES.drivers;
    const drivers = [
      nor,
      zho,
      { ...zho, code: "RUS", finish_note: "DSQ" as const },
      { ...zho, code: "ALB", finish_note: null },
    ];
    render(<DriverMoves drivers={drivers} />);
    const finishes = screen.getAllByRole("row").slice(1).map((r) => cellsOf(r)[2]);
    expect(finishes).toEqual(["1", "DNF", "DSQ", "—"]);
  });
});
