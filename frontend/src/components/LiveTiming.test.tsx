import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveTiming from "./LiveTiming";
import { useF1Store } from "@/store/useTelemetryStore";

const drivers = [
  { driver_number: 1, code: "VER", full_name: "Max Verstappen", team_name: "Red Bull Racing", team_color: "#3671C6" },
  { driver_number: 4, code: "NOR", full_name: "Lando Norris", team_name: "McLaren", team_color: "#FF8000" },
];

function board(verLap: number, norLap: number) {
  return {
    "1": { position: 1, gap_to_leader: 0, gap_to_next: 0, last_lap_time: verLap, s1: 30.1, s2: 30.2, s3: 28.7, compound: "MEDIUM", tyre_age: 6 },
    "4": { position: 2, gap_to_leader: 1.234, gap_to_next: 1.234, last_lap_time: norLap, s1: 30.4, s2: 30.6, s3: 29.0, compound: "HARD", tyre_age: 6 },
  };
}

const lapCell = (code: string, text: string) => {
  const row = screen.getAllByRole("row").find((r) => within(r).queryByRole("button", { name: code }));
  return within(row!).getByText(text);
};

beforeEach(() => {
  useF1Store.setState({ drivers, leaderboard: {}, selectedDriverNum: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("LiveTiming", () => {
  it("shows a waiting state before any timing data arrives", () => {
    render(<LiveTiming />);
    expect(screen.getByText("Waiting for timing data")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("lists drivers by position with gap and interval", () => {
    useF1Store.setState({ leaderboard: board(89.0, 90.0) });
    render(<LiveTiming />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2 drivers
    expect(within(rows[1]).getByRole("button", { name: "VER" })).toBeInTheDocument();
    expect(within(rows[1]).getByText("Leader")).toBeInTheDocument();
    expect(within(rows[2]).getByText("+1.234", { selector: "[role=cell].text-chalk" })).toBeInTheDocument();
  });

  it("claims only the overall best on a first snapshot: no personal best without history", () => {
    useF1Store.setState({ leaderboard: board(89.0, 90.0) });
    render(<LiveTiming />);
    expect(lapCell("VER", "1:29.000")).toHaveClass("text-timing-purple");
    expect(lapCell("NOR", "1:30.000")).toHaveClass("text-chalk");
  });

  it("calls a repeated best a personal best once the driver has history", () => {
    useF1Store.setState({ leaderboard: board(89.0, 90.0) });
    render(<LiveTiming />);
    act(() => useF1Store.setState({ leaderboard: board(89.0, 90.0) }));
    expect(lapCell("NOR", "1:30.000")).toHaveClass("text-timing-green");
    expect(lapCell("VER", "1:29.000")).toHaveClass("text-timing-purple");
  });

  it("turns a slower lap yellow, and a new overall best purple, as the feed updates", () => {
    useF1Store.setState({ leaderboard: board(89.0, 90.0) });
    render(<LiveTiming />);

    act(() => useF1Store.setState({ leaderboard: board(89.0, 90.0) }));
    act(() => useF1Store.setState({ leaderboard: board(89.0, 91.0) }));
    expect(lapCell("NOR", "1:31.000")).toHaveClass("text-timing-yellow");

    act(() => useF1Store.setState({ leaderboard: board(89.0, 88.5) }));
    expect(lapCell("NOR", "1:28.500")).toHaveClass("text-timing-purple");
    expect(lapCell("VER", "1:29.000")).toHaveClass("text-timing-green"); // his own best, no longer the field's
  });

  it("selects a driver from the keyboard-operable driver button", async () => {
    const user = userEvent.setup();
    useF1Store.setState({ leaderboard: board(89.0, 90.0) });
    render(<LiveTiming />);
    const ver = screen.getByRole("button", { name: "VER" });
    expect(ver).toHaveAttribute("aria-pressed", "false");
    await user.click(ver);
    expect(useF1Store.getState().selectedDriverNum).toBe(1);
    expect(screen.getByRole("button", { name: "VER" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "VER" }));
    expect(useF1Store.getState().selectedDriverNum).toBeNull();
  });

  it("hides the sector columns in a narrow panel and shows them in a wide one", () => {
    useF1Store.setState({ leaderboard: board(89.0, 90.0) });
    const { unmount } = render(<LiveTiming />);
    expect(screen.queryByRole("columnheader", { name: "S1" })).not.toBeInTheDocument();
    unmount();

    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: ResizeObserverCallback) {}
        observe() { this.cb([{ contentRect: { width: 900 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
        unobserve() {}
        disconnect() {}
      },
    );
    render(<LiveTiming />);
    expect(screen.getByRole("columnheader", { name: "S1" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "S3" })).toBeInTheDocument();
  });
});
