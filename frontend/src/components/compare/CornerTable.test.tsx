import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CornerTable from "./CornerTable";
import { duelStyle } from "@/lib/duel";
import type { CornerDuelRow, CornerMetrics } from "@/lib/corners";

const m = (over: Partial<CornerMetrics> = {}): CornerMetrics => ({ zone_time: 3, apex_speed: 120.4, entry_speed: 250, exit_speed: 180.6, brake_before_m: 90, ...over });
const row = (number: number, time_delta: number, d1: Partial<CornerMetrics> = {}, d2: Partial<CornerMetrics> = {}): CornerDuelRow => ({
  label: `T${number}`, number, letter: "", x: 0, y: 0, angle: 0, driver1: m(d1), driver2: m(d2), time_delta,
});

const style = duelStyle("#3671C6", "#FF8000");
const rows = [
  row(1, 0.0004, { brake_before_m: null }, { brake_before_m: null }),
  row(5, 0.123, { apex_speed: 150.2 }, { apex_speed: 148.7 }),
  row(9, -0.045, { brake_before_m: 120 }, { brake_before_m: 100 }),
];
const renderTable = (r = rows) => render(<CornerTable rows={r} code1="VER" code2="NOR" style={style} />);

describe("CornerTable", () => {
  it("renders one row per corner with its label", () => {
    renderTable();
    const body = screen.getAllByRole("row").slice(1);
    expect(body).toHaveLength(3);
    expect(within(body[0]).getByText("T1")).toBeInTheDocument();
    expect(within(body[1]).getByText("T5")).toBeInTheDocument();
    expect(within(body[2]).getByText("T9")).toBeInTheDocument();
  });

  it("shows the gainer's code and the time to three decimals", () => {
    renderTable();
    const body = screen.getAllByRole("row").slice(1);
    expect(within(body[1]).getByText("VER 0.123")).toBeInTheDocument();
    expect(within(body[2]).getByText("NOR 0.045")).toBeInTheDocument();
  });

  it("calls a delta that rounds to nothing level", () => {
    renderTable();
    expect(within(screen.getAllByRole("row")[1]).getByText("Level")).toBeInTheDocument();
  });

  it("reads No braking for a flat-out corner, never 0 m", () => {
    renderTable();
    const first = screen.getAllByRole("row")[1];
    expect(within(first).getByText("No braking")).toBeInTheDocument();
    expect(first).not.toHaveTextContent("0 m");
  });

  it("shows braking verdict, minimum speeds and exit speeds as rounded A / B", () => {
    renderTable();
    const body = screen.getAllByRole("row").slice(1);
    expect(within(body[2]).getByText("NOR brakes 20 m later")).toBeInTheDocument();
    expect(within(body[1]).getByText("150 / 149")).toBeInTheDocument();
    expect(within(body[1]).getByText("181 / 181")).toBeInTheDocument();
  });

  it("summarises where each driver gained most", () => {
    renderTable();
    expect(screen.getByText("VER gained most at T5 (0.123 s); NOR at T9 (0.045 s)")).toBeInTheDocument();
  });

  it("shows only the driver who gained when the other gained nowhere", () => {
    renderTable([row(2, 0.2)]);
    expect(screen.getByText("VER gained most at T2 (0.200 s)")).toBeInTheDocument();
  });

  it("says level when neither driver gained anywhere", () => {
    renderTable([row(2, 0)]);
    expect(screen.getByText("Level through every corner")).toBeInTheDocument();
  });

  it("calls the summary level when the only difference rounds to 0.000", () => {
    renderTable([row(1, 0.0004)]);
    expect(screen.getByText("Level through every corner")).toBeInTheDocument();
    expect(screen.queryByText(/gained most/)).not.toBeInTheDocument();
  });

  it("doesn't credit a level corner as a driver's best", () => {
    renderTable([row(1, 0.0004), row(2, -0.1)]);
    expect(screen.getByText("NOR gained most at T2 (0.100 s)")).toBeInTheDocument();
  });

  it("explains when there is no corner data", () => {
    renderTable([]);
    expect(screen.getByText("Corner data isn't available for this session")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
