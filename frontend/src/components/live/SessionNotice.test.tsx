import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useF1Store } from "@/store/useTelemetryStore";
import SessionNotice from "./SessionNotice";

beforeEach(() => useF1Store.setState({ activeSession: null } as any));

describe("SessionNotice", () => {
  it("says nothing is live and names the session being shown", () => {
    useF1Store.setState({
      activeSession: { meeting_name: "Singapore Grand Prix", session_name: "Race", date_start: "2026-10-11T12:00:00+00:00", live: false },
    } as any);
    render(<SessionNotice />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No session is live right now. Showing the latest: Singapore Grand Prix, Race, 11 Oct 2026.",
    );
  });

  it("stays out of the way while a session is live", () => {
    useF1Store.setState({ activeSession: { meeting_name: "United States Grand Prix", session_name: "Race", live: true } } as any);
    const { container } = render(<SessionNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays out of the way before a session has loaded", () => {
    const { container } = render(<SessionNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});
