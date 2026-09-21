import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import PedalChart from "./PedalChart";
import type { PedalRow } from "@/lib/pedals";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 400 }) };
});

const row = (code: string, name: string, lap: number, over: Partial<PedalRow> = {}): PedalRow => ({
  driver_code: code, name, team: "Team " + code, color: "#3671C6", lap_time: lap,
  throttle_pct: 80.27, brake_pct: 12.4, both_pct: 0.3, coast_pct: 7.03, ...over,
});

const rows = [
  row("VER", "Max Verstappen", 106.1, { brake_pct: 11.0, coast_pct: 9.0, throttle_pct: 79.5 }),
  row("NOR", "Lando Norris", 105.8, { brake_pct: 14.2, coast_pct: 5.0, throttle_pct: 80.5 }),
  row("HAM", "Lewis Hamilton", 107.0, { brake_pct: 12.5, coast_pct: 7.0, throttle_pct: 80.0 }),
];

const tableOrder = () =>
  within(screen.getByRole("table", { name: /pedal behaviour by driver/i }))
    .getAllByRole("row").slice(1)
    .map((r) => within(r).getAllByRole("cell")[1].textContent?.match(/[A-Z]{3}$/)?.[0]);

describe("PedalChart", () => {
  it("opens on all four states, quickest lap first", () => {
    render(<PedalChart rows={rows} />);
    expect(screen.getByRole("tab", { name: "All states", selected: true })).toBeInTheDocument();
    expect(tableOrder()).toEqual(["NOR", "VER", "HAM"]);
  });

  it("shows exact shares with one decimal in the table", () => {
    render(<PedalChart rows={rows} />);
    expect(screen.getAllByText("80.5%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("14.2%").length).toBeGreaterThan(0);
  });

  it("names each driver's team and fastest lap", () => {
    render(<PedalChart rows={rows} />);
    expect(screen.getByText("Team NOR")).toBeInTheDocument();
    expect(screen.getByText("1:45.800")).toBeInTheDocument();
  });

  it("can focus on one state and ranks drivers by it", async () => {
    render(<PedalChart rows={rows} />);
    await userEvent.click(screen.getByRole("tab", { name: "Brake only" }));
    expect(screen.getByRole("tab", { name: "Brake only", selected: true })).toBeInTheDocument();
    expect(tableOrder()).toEqual(["NOR", "HAM", "VER"]);   // 14.2, 12.5, 11.0
    expect(screen.getByText(/braking with the throttle closed/i, { selector: "p" })).toBeInTheDocument();
  });

  it("ranks by coasting the other way round", async () => {
    render(<PedalChart rows={rows} />);
    await userEvent.click(screen.getByRole("tab", { name: "Coasting" }));
    expect(tableOrder()).toEqual(["VER", "HAM", "NOR"]);   // 9.0, 7.0, 5.0
  });

  it("explains every pedal state in plain language", () => {
    render(<PedalChart rows={rows} />);
    const glossary = screen.getByRole("list", { name: /what the pedal states mean/i });
    for (const label of ["Throttle only", "Brake only", "Trail braking", "Coasting"]) {
      expect(within(glossary).getByText(label)).toBeInTheDocument();
    }
    expect(within(glossary).getByText(/both pedals at once/i)).toBeInTheDocument();
  });

  it("draws a bar per driver", () => {
    const { container } = render(<PedalChart rows={rows} />);
    expect(container.querySelectorAll(".recharts-bar-rectangle").length).toBe(3 * 4);   // 4 stacked states each
  });

  it("gives every driver's bar the driver's team colour when focused on one state", async () => {
    const mixed = [row("VER", "Max", 106, { color: "#3671C6" }), row("NOR", "Lando", 105, { color: "#FF8000" })];
    const { container } = render(<PedalChart rows={mixed} />);
    await userEvent.click(screen.getByRole("tab", { name: "Brake only" }));
    const fills = Array.from(container.querySelectorAll(".recharts-bar-rectangle path")).map((p) => p.getAttribute("fill"));
    expect(new Set(fills)).toEqual(new Set(["#3671C6", "#FF8000"]));
  });

  it("says so when there is nothing to show", () => {
    render(<PedalChart rows={[]} />);
    expect(screen.getByText(/no pedal data/i)).toBeInTheDocument();
  });
});
