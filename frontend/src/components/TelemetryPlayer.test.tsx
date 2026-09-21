import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import TelemetryPlayer from "./TelemetryPlayer";
import { useF1Store } from "@/store/useTelemetryStore";

beforeEach(() => {
  useF1Store.setState({
    replaySession: { year: 2024, gp: "Belgium", lap: 3 },
    replayPlayback: { isPlaying: false, speed: 1, frame: 50, maxFrame: 200, currentLap: 3, totalLaps: 44 },
  } as any);
});

describe("TelemetryPlayer", () => {
  it("names every control so it is usable without seeing the icons", () => {
    render(<TelemetryPlayer />);
    for (const name of ["Play replay", "Back 100 frames", "Forward 100 frames", "Exit replay"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("slider", { name: "Replay position" })).toHaveValue("50");
    expect(screen.getByLabelText("Lap")).toHaveValue("3");
    expect(screen.getByRole("button", { name: /Playback speed 1x/ })).toBeInTheDocument();
  });

  it("toggles play, cycles speed, and skips by 100 frames within bounds", async () => {
    const user = userEvent.setup();
    render(<TelemetryPlayer />);
    await user.click(screen.getByRole("button", { name: "Play replay" }));
    expect(useF1Store.getState().replayPlayback.isPlaying).toBe(true);
    expect(screen.getByRole("button", { name: "Pause replay" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Playback speed/ }));
    expect(useF1Store.getState().replayPlayback.speed).toBe(2);
    await user.click(screen.getByRole("button", { name: "Forward 100 frames" }));
    expect(useF1Store.getState().replayPlayback.frame).toBe(150);
    await user.click(screen.getByRole("button", { name: "Back 100 frames" }));
    await user.click(screen.getByRole("button", { name: "Back 100 frames" }));
    expect(useF1Store.getState().replayPlayback.frame).toBe(0);
  });

  it("exits the replay", async () => {
    const user = userEvent.setup();
    render(<TelemetryPlayer />);
    await user.click(screen.getByRole("button", { name: "Exit replay" }));
    expect(useF1Store.getState().replaySession).toBeNull();
  });
});
