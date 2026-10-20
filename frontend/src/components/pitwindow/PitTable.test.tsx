import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PitTable from "./PitTable";
import { PIT_WINDOW, PIT_WINDOW_LAST, PIT_WINDOW_SC } from "./fixtures";

const rowOf = (code: string) => screen.getByText(code).closest("tr") as HTMLElement;
const statusCell = (code: string) => within(within(rowOf(code)).getAllByRole("cell")[5]);

describe("PitTable", () => {
  it("has the six columns", () => {
    render(<PitTable drivers={PIT_WINDOW.drivers} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Pos", "Driver", "Tyre", "Plan", "Window", "Status"]);
  });

  it("keeps the payload's running order", () => {
    render(<PitTable drivers={PIT_WINDOW.drivers} />);
    const codes = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[1].textContent);
    expect(codes).toEqual(["VER", "NOR", "HAM", "ALO", "LEC"]);
  });

  it("shows the tyre, its age, the plan, the window and the status for a one-stopper", () => {
    render(<PitTable drivers={PIT_WINDOW.drivers} />);
    const nor = within(rowOf("NOR"));
    expect(nor.getByText("Medium")).toBeInTheDocument();
    expect(nor.getByText("15 laps")).toBeInTheDocument();
    expect(nor.getByText("Box lap 23 → Hard")).toBeInTheDocument();
    expect(nor.getByText("Laps 21–25")).toBeInTheDocument();
    expect(nor.getByText("Window opens lap 21")).toBeInTheDocument();
  });

  it("spells out a two-stop plan", () => {
    render(<PitTable drivers={PIT_WINDOW.drivers} />);
    expect(within(rowOf("ALO")).getByText("Box lap 22 → Medium, lap 40 → Hard")).toBeInTheDocument();
  });

  it("says box now, stay out and wet tyres", () => {
    render(<PitTable drivers={PIT_WINDOW.drivers} />);
    expect(within(rowOf("VER")).getByText("Box now")).toBeInTheDocument();
    expect(statusCell("HAM").getByText("Stay out")).toBeInTheDocument();
    const lec = within(rowOf("LEC"));
    expect(lec.getByText("Wet tyres")).toBeInTheDocument();
    expect(lec.getAllByText("—")).toHaveLength(2);
  });

  it("colours the row's left edge with the team colour", () => {
    render(<PitTable drivers={PIT_WINDOW.drivers} />);
    const first = within(rowOf("NOR")).getAllByRole("cell")[0];
    expect(first.style.boxShadow).toContain("#FF8000");
  });

  it("says a neutralised lap is a cheap time to stop, without a number", () => {
    render(<PitTable drivers={PIT_WINDOW_SC.drivers} />);
    expect(within(rowOf("VER")).getByText("Safety car or red flag: a cheap time to stop")).toBeInTheDocument();
    expect(within(rowOf("NOR")).getByText("Safety car or red flag: a cheap time to stop")).toBeInTheDocument();
  });

  it("says nothing about the safety car otherwise", () => {
    render(<PitTable drivers={PIT_WINDOW.drivers} />);
    expect(screen.queryByText(/Safety car/)).not.toBeInTheDocument();
  });

  it("marks a plan built on an unfitted tyre as an early estimate", () => {
    render(<PitTable drivers={PIT_WINDOW.drivers} />);
    expect(within(rowOf("ALO")).getByText("Early estimate")).toBeInTheDocument();
    expect(screen.getAllByText("Early estimate")).toHaveLength(1);
  });

  it("names the driver on the code", () => {
    render(<PitTable drivers={PIT_WINDOW.drivers} />);
    expect(screen.getByText("NOR")).toHaveAttribute("title", "Lando Norris");
  });

  it("reports a car that can't meet the two-compound rule, whatever its status says", () => {
    render(<PitTable drivers={PIT_WINDOW_LAST.drivers} />);
    const pia = within(rowOf("PIA"));
    expect(pia.getByText("Can't meet the two-compound rule")).toBeInTheDocument();
    expect(pia.queryByText("Stay out")).not.toBeInTheDocument();
    expect(statusCell("RUS").getByText("Stay out")).toBeInTheDocument();
  });

  it("reads one lap as one lap", () => {
    const [ver] = PIT_WINDOW.drivers;
    render(<PitTable drivers={[{ ...ver, tyre_age: 1 }]} />);
    expect(screen.getByText("1 lap")).toBeInTheDocument();
  });
});
