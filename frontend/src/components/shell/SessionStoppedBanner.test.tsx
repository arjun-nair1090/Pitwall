import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionStoppedBanner from "@/components/shell/SessionStoppedBanner";
import { useF1Store } from "@/store/useTelemetryStore";

const localTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

describe("SessionStoppedBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:42:30Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    useF1Store.setState({ sessionStatus: null });
  });

  it("shows nothing while the session is running", () => {
    useF1Store.setState({ sessionStatus: { stopped: false, red_flag: false, announcement: null, resumes_at: null } });
    const { container } = render(<SessionStoppedBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the announced restart in the viewer's local time", () => {
    useF1Store.setState({
      sessionStatus: { stopped: true, red_flag: true, announcement: "SQ1 WILL RESUME AT 20:46", resumes_at: "2026-10-09T12:46:00+00:00" },
    });
    render(<SessionStoppedBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Red flag");
    expect(banner).toHaveTextContent(`Resumes at ${localTime("2026-10-09T12:46:00+00:00")} your time`);
    expect(banner).toHaveTextContent("in 4 min");
    expect(banner).toHaveTextContent("SQ1 WILL RESUME AT 20:46 (track time)");
  });

  it("says when no restart time has been announced", () => {
    useF1Store.setState({ sessionStatus: { stopped: true, red_flag: true, announcement: null, resumes_at: null } });
    render(<SessionStoppedBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Restart time not announced yet");
  });

  it("calls a stop without a red flag a stopped session", () => {
    useF1Store.setState({
      sessionStatus: { stopped: true, red_flag: false, announcement: "START OF SQ2 WILL BE DELAYED", resumes_at: null },
    });
    render(<SessionStoppedBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Session stopped");
    expect(banner).toHaveTextContent("START OF SQ2 WILL BE DELAYED");
  });

  it("says the restart is due once its time has passed", () => {
    vi.setSystemTime(new Date("2026-10-09T12:47:00Z"));
    useF1Store.setState({
      sessionStatus: { stopped: true, red_flag: false, announcement: "SQ1 WILL RESUME AT 20:46", resumes_at: "2026-10-09T12:46:00+00:00" },
    });
    render(<SessionStoppedBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("due now");
  });
});
