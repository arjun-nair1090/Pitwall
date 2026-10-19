import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OddsTable from "./OddsTable";
import { DRIVERS } from "./fixtures";

const rowOf = (code: string) => screen.getByText(code).closest("tr") as HTMLElement;
const cells = (code: string) => within(rowOf(code)).getAllByRole("cell").map((c) => c.textContent);

describe("OddsTable", () => {
  it("has the columns in order", () => {
    render(<OddsTable drivers={DRIVERS} seasonOver={false} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Pos", "Driver", "Points", "Gap", "Title chance", "Expected", "Range", "Status",
    ]);
  });

  it("reads a leader's row", () => {
    render(<OddsTable drivers={DRIVERS} seasonOver={false} />);
    expect(cells("ANT")).toEqual(["1", "Kimi AntonelliANT", "340", "—", "84.1%", "345.2", "318–372", ""]);
  });

  it("gives everyone else a true minus gap to the leader", () => {
    render(<OddsTable drivers={DRIVERS} seasonOver={false} />);
    expect(cells("RUS")[3]).toBe("−102");
    expect(cells("RUS")[0]).toBe("2");
  });

  it("keeps half points and never rounds a contender to zero", () => {
    render(<OddsTable drivers={DRIVERS} seasonOver={false} />);
    expect(cells("ALB")[2]).toBe("40.5");
    expect(cells("NOR")[4]).toBe("<0.1%");
  });

  it("labels eliminated and not-racing drivers, with faint chance cells", () => {
    render(<OddsTable drivers={DRIVERS} seasonOver={false} />);
    expect(cells("ALB")[7]).toBe("Out of contention");
    expect(cells("LAW")[7]).toBe("Not racing");
    for (const code of ["ALB", "LAW"]) {
      expect(within(rowOf(code)).getByText("0%")).toHaveClass("text-faint");
    }
    expect(within(rowOf("ANT")).getByText("84.1%")).not.toHaveClass("text-faint");
  });

  it("shows a driver who can still be caught as a near certainty, not 100%", () => {
    const drivers = [{ ...DRIVERS[0], title_probability: 1 }, ...DRIVERS.slice(1)];
    render(<OddsTable drivers={drivers} seasonOver={false} />);
    expect(cells("ANT")[4]).toBe(">99.9%");
  });

  it("calls a clinched driver Clinched mid-season and Champion once no races are left", () => {
    const drivers = [{ ...DRIVERS[0], status: "clinched" as const, title_probability: 0.9999 }, ...DRIVERS.slice(1)];
    const { unmount } = render(<OddsTable drivers={drivers} seasonOver={false} />);
    expect(cells("ANT")[7]).toBe("Clinched");
    expect(cells("ANT")[4]).toBe("100%");
    unmount();
    render(<OddsTable drivers={drivers} seasonOver />);
    expect(cells("ANT")[7]).toBe("Champion");
  });

  it("puts a dead heat at no gap", () => {
    const tied = [DRIVERS[0], { ...DRIVERS[1], points: 340 }];
    render(<OddsTable drivers={tied} seasonOver={false} />);
    expect(cells("RUS")[3]).toBe("—");
  });

  it("draws the team's colour down the row", () => {
    render(<OddsTable drivers={DRIVERS} seasonOver={false} />);
    expect(within(rowOf("ANT")).getAllByRole("cell")[0]).toHaveStyle({ boxShadow: "inset 4px 0 0 #27F4D2" });
  });
});
