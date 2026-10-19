import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LapOdds from "./LapOdds";
import { WIN_PROB } from "./fixtures";

const renderTable = () => render(<LapOdds rows={WIN_PROB.at.rows} drivers={WIN_PROB.drivers} />);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

describe("LapOdds", () => {
  it("heads the columns", () => {
    renderTable();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Pos", "Driver", "Gap", "At the flag", "Win chance", "Strategy",
    ]);
  });

  it("lists drivers in the order given, not by chance", () => {
    renderTable();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => cells(r)[1])).toEqual(["LEC", "VER", "NOR", "PER", "ALB"]);
  });

  it("shows gap, projected gap, chance and strategy, with a dash for the leader", () => {
    renderTable();
    const [lec, ver, nor, per, alb] = screen.getAllByRole("row").slice(1);
    expect(cells(lec)).toEqual(["1", "LEC", "—", "+3.4 s", "25.0%", "Stay out"]);
    expect(cells(ver)).toEqual(["2", "VER", "+3.4 s", "—", "55.0%", "Window opens lap 21"]);
    expect(cells(nor)).toEqual(["3", "NOR", "+5.1 s", "+1.2 s", "12.0%", "Box now"]);
    expect(cells(per)[5]).toBe("Can't meet the two-compound rule");
    expect(cells(alb)).toEqual(["5", "ALB", "+14.3 s", "+11.0 s", "1.0%", "Wet tyres"]);
  });

  it("names the driver in the cell's title and accents the row in the team colour", () => {
    renderTable();
    expect(screen.getByText("VER")).toHaveAttribute("title", "Max Verstappen");
    const row = screen.getByText("NOR").closest("tr") as HTMLElement;
    expect(row.innerHTML).toContain("#FF8000");
  });

  it("formats the extremes of a chance", () => {
    const rows = [
      { ...WIN_PROB.at.rows[0], probability: 1 },
      { ...WIN_PROB.at.rows[1], probability: 0 },
      { ...WIN_PROB.at.rows[2], probability: 0.0004 },
    ];
    render(<LapOdds rows={rows} drivers={WIN_PROB.drivers} />);
    const body = screen.getAllByRole("row").slice(1);
    expect(body.map((r) => cells(r)[4])).toEqual(["100%", "0%", "<0.1%"]);
  });
});
