import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DuelHeader, { type DuelDriver } from "./DuelHeader";
import { duelStyle } from "@/lib/duel";

const driver = (over: Partial<DuelDriver>): DuelDriver => ({
  code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6",
  lap_number: 32, lap_time: 106.128, compound: "MEDIUM", telemetry: [], ...over,
});

const ver = driver({});
const nor = driver({ code: "NOR", name: "Lando Norris", team: "McLaren", color: "#FF8000", lap_number: 33, lap_time: 105.816, compound: "SOFT" });
const base = { year: 2024, eventName: "Belgian Grand Prix", session: "R" as const };

describe("DuelHeader", () => {
  it("shows each driver's name, team, lap, tyre and lap time", () => {
    render(<DuelHeader driver1={ver} driver2={nor} style={duelStyle(ver.color, nor.color)} {...base} />);
    expect(screen.getByText("Max Verstappen")).toBeInTheDocument();
    expect(screen.getByText("Lando Norris")).toBeInTheDocument();
    expect(screen.getByText("Red Bull Racing")).toBeInTheDocument();
    expect(screen.getByText("1:46.128")).toBeInTheDocument();
    expect(screen.getByText("1:45.816")).toBeInTheDocument();
    expect(screen.getByText("Lap 32")).toBeInTheDocument();
    expect(screen.getByText("Lap 33")).toBeInTheDocument();
    expect(screen.getByText("Soft")).toBeInTheDocument();
  });

  it("says who was faster and by how much", () => {
    render(<DuelHeader driver1={ver} driver2={nor} style={duelStyle(ver.color, nor.color)} {...base} />);
    expect(screen.getByText("NOR was 0.312 s faster")).toBeInTheDocument();
  });

  it("says so when the laps were equal", () => {
    render(<DuelHeader driver1={ver} driver2={{ ...nor, lap_time: 106.128 }} style={duelStyle(ver.color, nor.color)} {...base} />);
    expect(screen.getByText("Identical lap times")).toBeInTheDocument();
  });

  it("makes no claim when a lap has no time", () => {
    render(<DuelHeader driver1={ver} driver2={{ ...nor, lap_time: null }} style={duelStyle(ver.color, nor.color)} {...base} />);
    expect(screen.queryByText(/was .* faster/)).not.toBeInTheDocument();
    expect(screen.getByText("Lap time unavailable")).toBeInTheDocument();
  });

  it("explains how teammates are told apart", () => {
    const per = driver({ code: "PER", name: "Sergio Perez", lap_number: 44, lap_time: 104.701 });
    render(<DuelHeader driver1={ver} driver2={per} style={duelStyle(ver.color, per.color)} {...base} />);
    expect(screen.getByText(/teammates/i)).toHaveTextContent(/lighter and dashed/i);
  });

  it("does not mention teammates for different teams", () => {
    render(<DuelHeader driver1={ver} driver2={nor} style={duelStyle(ver.color, nor.color)} {...base} />);
    expect(screen.queryByText(/teammates/i)).not.toBeInTheDocument();
  });

  it("offers a result card for each driver in a race, opening in a new tab", () => {
    render(<DuelHeader driver1={ver} driver2={nor} style={duelStyle(ver.color, nor.color)} {...base} />);
    const link = screen.getByRole("link", { name: /result card for VER/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("href")).toContain("/api/v1/share/result-card?");
    expect(link.getAttribute("href")).toContain("driver=VER");
    expect(link.getAttribute("href")).toContain("year=2024");
    expect(link.getAttribute("href")).toContain("gp=Belgian+Grand+Prix");
  });

  it("offers no result card outside a race", () => {
    render(<DuelHeader driver1={ver} driver2={nor} style={duelStyle(ver.color, nor.color)} {...base} session="Q" />);
    expect(screen.queryByRole("link", { name: /result card/i })).not.toBeInTheDocument();
  });
});
