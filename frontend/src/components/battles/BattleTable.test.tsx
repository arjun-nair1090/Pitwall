import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BattleTable from "./BattleTable";
import { BATTLES } from "./fixtures";

describe("BattleTable", () => {
  it("has the columns", () => {
    render(<BattleTable battles={BATTLES.battles} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Battle", "Laps", "Closest", "Outcome"]);
  });

  it("describes each battle in payload order", () => {
    render(<BattleTable battles={BATTLES.battles} />);
    const rows = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows).toEqual([
      ["NOR on VER", "35–44 (10)", "0.426 s", "To the flag"],
      ["HAM on RUS", "12–15 (4)", "0.800 s", "HAM passed on lap 16"],
      ["ALO on STR", "20–22 (3)", "0.500 s", "Dropped back"],
    ]);
  });

  it("says so when there were no battles", () => {
    render(<BattleTable battles={[]} />);
    expect(screen.getByText("No sustained battles")).toBeInTheDocument();
  });
});
