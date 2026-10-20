import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TopBar from "./TopBar";
import { useF1Store } from "@/store/useTelemetryStore";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => {
  useF1Store.setState({ activeSession: null, isConnected: false, apiStatus: "unknown", weather: null, currentUser: null } as any);
});

describe("TopBar connection status", () => {
  it("says the app is connecting until the API has answered", () => {
    render(<TopBar />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  });

  it("calls a healthy API with no session a normal standby, not an outage", () => {
    useF1Store.setState({ apiStatus: "ok" } as any);
    render(<TopBar />);
    expect(screen.getByText("No live session right now")).toBeInTheDocument();
    expect(screen.getByText("Standby")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports an unreachable API as a real problem with a way to retry", () => {
    useF1Store.setState({ apiStatus: "unreachable" } as any);
    render(<TopBar />);
    expect(screen.getByRole("alert")).toHaveTextContent("Can't reach the API");
    expect(screen.getByText("API offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry connection" })).toBeInTheDocument();
  });

  it("shows Live while the session is running", () => {
    useF1Store.setState({
      apiStatus: "ok", isConnected: true,
      activeSession: { meeting_name: "Italian Grand Prix", circuit_short_name: "Monza", session_name: "Race", year: 2026, live: true },
    } as any);
    render(<TopBar />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Italian Grand Prix")).toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
  });

  it("labels a finished session as the latest one, never Live, even with the feed connected", () => {
    useF1Store.setState({
      apiStatus: "ok", isConnected: true,
      activeSession: { meeting_name: "Singapore Grand Prix", circuit_short_name: "Singapore", session_name: "Race", year: 2026, live: false },
    } as any);
    render(<TopBar />);
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.getByText("Latest")).toBeInTheDocument();
    expect(screen.getByText("Singapore Grand Prix")).toBeInTheDocument();
    expect(screen.getByText("Standby")).toBeInTheDocument();
  });

  it("falls back to the circuit name when the meeting name is missing", () => {
    useF1Store.setState({ apiStatus: "ok", activeSession: { circuit_short_name: "Monza", session_name: "Race", year: 2026, live: true } } as any);
    render(<TopBar />);
    expect(screen.getByText("Monza")).toBeInTheDocument();
  });
});
