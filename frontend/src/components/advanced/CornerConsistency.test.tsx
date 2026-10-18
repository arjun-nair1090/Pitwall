import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CornerConsistency from "./CornerConsistency";
import type { SessionDriver } from "@/hooks/useRaceData";
import type { CornerConsistencyResult, CornerConsistencyRow } from "@/lib/corners";

vi.mock("axios");
const post = vi.mocked(axios.post);

const sessionInfo = vi.fn();
vi.mock("@/hooks/useRaceData", () => ({ useSessionInfo: (...args: unknown[]) => sessionInfo(...args) }));

const drv = (code: string, name: string, position: number): SessionDriver => ({
  code, name, team: "Team", color: "#3671C6", position, status: "Finished", laps: 44, fastest_lap: 30, fastest_time: 106, stints: [],
});
const info = {
  year: 2024, round: 14, event_name: "Belgian Grand Prix", session: "R", total_laps: 44,
  drivers: [drv("VER", "Max Verstappen", 1), drv("NOR", "Lando Norris", 2)],
};
const ready = (data: unknown) => ({ status: "ready", data, retry: vi.fn() });

const LAPS = [10, 11, 12];
// `brakes` gives each lap's braking point, null where the lap was taken flat out.
const corner = (label: string, sd: number, brakes: (number | null)[]): CornerConsistencyRow => {
  const braked = brakes.filter((b): b is number => b !== null);
  return {
    label, number: Number(label.slice(1)), letter: "",
    apex_speed: { mean: 112.4, sd: 1.43 },
    brake_before_m: braked.length ? { mean: braked.reduce((a, b) => a + b, 0) / braked.length, sd: braked.length > 1 ? 6.2 : 0 } : null,
    zone_time: { best: 5, mean: 5.1, sd },
    per_lap: LAPS.map((lap, i) => ({ lap, zone_time: 5 + i * 0.05, delta_to_best: i * 0.05, apex_speed: 112, brake_before_m: brakes[i] })),
  };
};
const RESULT: CornerConsistencyResult = {
  driver: { code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6" },
  laps: LAPS,
  corners: [
    corner("T1", 0.021, [80, 86, 92]),
    corner("T2", 0.112, [null, null, null]),
    corner("T3", 0.054, [null, 85, null]),
  ],
  best_lap: 105.33,
  ideal_lap: 104.912,
};

const sel = { year: 2024, round: 14, session: "R" as const };

beforeEach(() => {
  post.mockReset().mockResolvedValue({ data: RESULT });
  sessionInfo.mockReset().mockReturnValue(ready(info));
});

describe("CornerConsistency", () => {
  it("offers the session's drivers and analyses the first one straight away", async () => {
    render(<CornerConsistency sel={sel} />);
    const picker = screen.getByLabelText("Driver") as HTMLSelectElement;
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["VER Max Verstappen", "NOR Lando Norris"]);
    expect(picker.value).toBe("VER");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/telemetry/corner-consistency", { year: 2024, round: 14, session: "R", driver: "VER" });
    expect(sessionInfo).toHaveBeenCalledWith(2024, 14, "R");
  });

  it("runs again for another driver", async () => {
    render(<CornerConsistency sel={sel} />);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await userEvent.selectOptions(screen.getByLabelText("Driver"), "NOR");
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1]).toEqual({ year: 2024, round: 14, session: "R", driver: "NOR" });
  });

  it("shows the heatmap and the ideal lap built from the best corners", async () => {
    const { container } = render(<CornerConsistency sel={sel} />);
    expect(await screen.findByText(/^Ideal lap from best corners: 1:44\.912, 0\.418 s quicker than the best lap/)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-cell]")).toHaveLength(LAPS.length * RESULT.corners.length);
    expect(screen.getByRole("heading", { name: "Corner consistency" })).toBeInTheDocument();
    expect(screen.getByText("Max Verstappen, 3 clean laps")).toBeInTheDocument();
  });

  it("calls the ideal lap a ceiling in a race or sprint, where fuel and tyres change", async () => {
    const caveat = "Fuel, tyres and traffic change through a race, so this is a ceiling rather than a target.";
    const { unmount } = render(<CornerConsistency sel={sel} />);
    expect(await screen.findByText(caveat)).toBeInTheDocument();
    unmount();

    render(<CornerConsistency sel={{ ...sel, session: "S" }} />);
    expect(await screen.findByText(caveat)).toBeInTheDocument();
  });

  it("doesn't call a qualifying ideal lap a ceiling", async () => {
    render(<CornerConsistency sel={{ ...sel, session: "Q" }} />);
    await screen.findByText(/^Ideal lap from best corners/);
    expect(screen.queryByText(/ceiling rather than a target/)).not.toBeInTheDocument();
  });

  it("ranks the corners by their spread, the least consistent first", async () => {
    render(<CornerConsistency sel={sel} />);
    const table = await screen.findByRole("table", { name: /ranked by spread/i });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows.map((r) => r[0])).toEqual(["T2", "T3", "T1"]);
    expect(rows[0][1]).toBe("0.112 s");
    expect(rows[0][2]).toBe("112 ± 1.4 km/h");
  });

  it("shows the braking point's spread only when at least two laps braked there", async () => {
    render(<CornerConsistency sel={sel} />);
    const table = await screen.findByRole("table", { name: /ranked by spread/i });
    const braking = Object.fromEntries(
      within(table).getAllByRole("row").slice(1).map((r) => { const c = within(r).getAllByRole("cell"); return [c[0].textContent, c[3].textContent]; }),
    );
    expect(braking).toEqual({ T1: "86 ± 6 m", T2: "No braking", T3: "85 m" });
  });

  it("says the first analysis can be slow", async () => {
    post.mockReturnValue(new Promise(() => {}));
    render(<CornerConsistency sel={sel} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Analysing every clean lap. The first time a race is opened this can take up to a minute.",
    );
  });

  it("shows the server's message when there aren't enough clean laps, without a retry", async () => {
    const detail = "VER has only 2 clean laps in this session; at least 3 are needed to judge consistency.";
    post.mockRejectedValue({ response: { status: 404, data: { detail } } });
    render(<CornerConsistency sel={sel} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(detail);
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("says so when the session has no corner data", async () => {
    post.mockResolvedValue({ data: { ...RESULT, corners: [] } });
    render(<CornerConsistency sel={sel} />);
    expect(await screen.findByText("Corner data isn't available for this session")).toBeInTheDocument();
  });

  it("doesn't ask for anything until a race is chosen", () => {
    sessionInfo.mockReturnValue({ status: "idle", retry: vi.fn() });
    render(<CornerConsistency sel={{ ...sel, round: null }} />);
    expect(post).not.toHaveBeenCalled();
  });
});
