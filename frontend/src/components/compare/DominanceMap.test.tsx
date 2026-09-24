import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import DominanceMap from "./DominanceMap";
import { duelStyle, type TelemetryPoint } from "@/lib/duel";

// A rectangular circuit, one sample every 10 m, 1 s per 10 m of "A" and a touch slower for "B".
function lap(speed: (d: number) => number, secondsPerSample = 1): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  for (let i = 0; i <= 100; i++) {
    const d = i * 10;
    const t = i / 100;
    const x = t < 0.25 ? t * 4 * 400 : t < 0.5 ? 400 : t < 0.75 ? 400 - (t - 0.5) * 4 * 400 : 0;
    const y = t < 0.25 ? 0 : t < 0.5 ? (t - 0.25) * 4 * 200 : t < 0.75 ? 200 : 200 - (t - 0.75) * 4 * 200;
    points.push({ distance: d, speed: speed(d), throttle: 100, brake: 0, gear: 5, rpm: 10000, drs: 0, time: i * secondsPerSample, x, y, acceleration: 0 });
  }
  return points;
}

const fastFirstHalf = lap((d) => (d < 500 ? 300 : 200));
const fastSecondHalf = lap((d) => (d < 500 ? 200 : 300), 1.1);

describe("DominanceMap", () => {
  it("draws the circuit in sectors coloured by who was faster", () => {
    const { container } = render(<DominanceMap lap1={fastFirstHalf} lap2={fastSecondHalf} code1="VER" code2="NOR" style={duelStyle("#3671C6", "#FF8000")} />);
    expect(screen.getByRole("group", { name: /track dominance map/i })).toBeInTheDocument();
    const strokes = new Set(Array.from(container.querySelectorAll("polyline[data-sector]")).map((el) => el.getAttribute("stroke")));
    expect(strokes).toEqual(new Set(["#3671C6", "#FF8000"]));
  });

  it("tells teammates apart with a lighter second colour", () => {
    const { container } = render(<DominanceMap lap1={fastFirstHalf} lap2={fastSecondHalf} code1="VER" code2="PER" style={duelStyle("#3671C6", "#3671C6")} />);
    const strokes = new Set(Array.from(container.querySelectorAll("polyline[data-sector]")).map((el) => el.getAttribute("stroke")));
    expect(strokes.size).toBe(2);
  });

  it("states how much of the lap each driver was faster through", () => {
    // 20 sectors of 50 m: the first 300 m (6 sectors) go to VER, the rest to NOR
    const lap1 = lap((d) => (d < 300 ? 300 : 200));
    const lap2 = lap((d) => (d < 300 ? 200 : 300), 1.1);
    render(<DominanceMap lap1={lap1} lap2={lap2} code1="VER" code2="NOR" style={duelStyle("#3671C6", "#FF8000")} />);
    expect(screen.getByText(/VER faster through 30% of the lap/)).toBeInTheDocument();
    expect(screen.getByText(/NOR faster through 70% of the lap/)).toBeInTheDocument();
  });

  it("shows both cars, labelled", () => {
    const { container } = render(<DominanceMap lap1={fastFirstHalf} lap2={fastSecondHalf} code1="VER" code2="NOR" style={duelStyle("#3671C6", "#FF8000")} />);
    const labels = Array.from(container.querySelectorAll("svg text")).map((t) => t.textContent);
    expect(labels).toContain("VER");
    expect(labels).toContain("NOR");
  });

  it("scrubs across the longer of the two laps", () => {
    render(<DominanceMap lap1={fastFirstHalf} lap2={fastSecondHalf} code1="VER" code2="NOR" style={duelStyle("#3671C6", "#FF8000")} />);
    const slider = screen.getByRole("slider", { name: /lap position/i });
    expect(Number(slider.getAttribute("max"))).toBeCloseTo(110, 0);
  });

  it("plays and pauses the two cars", async () => {
    render(<DominanceMap lap1={fastFirstHalf} lap2={fastSecondHalf} code1="VER" code2="NOR" style={duelStyle("#3671C6", "#FF8000")} />);
    const play = screen.getByRole("button", { name: /play both laps/i });
    await userEvent.click(play);
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(screen.getByRole("button", { name: /play both laps/i })).toBeInTheDocument();
  });

  it("says so when there is no track data", () => {
    render(<DominanceMap lap1={[]} lap2={[]} code1="VER" code2="NOR" style={duelStyle("#3671C6", "#FF8000")} />);
    expect(screen.getByText(/no track data/i)).toBeInTheDocument();
  });
});
