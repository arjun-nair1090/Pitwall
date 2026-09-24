import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Rail from "./Rail";
import { MODULES } from "@/lib/modules";
import { RAIL_KEY } from "@/lib/railScript";
import { usePaletteStore } from "@/store/usePaletteStore";
import { useF1Store } from "@/store/useTelemetryStore";

let pathname = "/stats";
const calendar = vi.fn();
vi.mock("@/hooks/useRaceData", () => ({ useSeasonCalendar: () => calendar() }));
const UPCOMING = { status: "ready", retry: vi.fn(), data: [
  { round: 1, country: "X", location: "Y", event_name: "Old Grand Prix", race_start_utc: "2020-03-08T04:00:00Z" },
  { round: 2, country: "Italy", location: "Monza", event_name: "Italian Grand Prix", race_start_utc: "2999-09-07T13:00:00Z" },
] };
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => {
  pathname = "/stats";
  delete document.documentElement.dataset.rail;
  localStorage.clear();
  useF1Store.setState({ isConnected: false, activeSession: null } as any);
  usePaletteStore.setState({ open: false });
  calendar.mockReset().mockReturnValue({ status: "loading", retry: vi.fn() });
});

describe("Rail", () => {
  it("links to every page, each with a name a screen reader can announce even when the rail is collapsed", () => {
    render(<Rail />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const m of MODULES) {
      const link = within(nav).getByRole("link", { name: new RegExp(`^${m.label}`) });
      expect(link).toHaveAttribute("href", m.href);
    }
  });

  it("names the group each page belongs to", () => {
    render(<Rail />);
    for (const group of ["Live", "Analysis", "Race", "Play", "More"]) {
      expect(screen.getByRole("group", { name: group })).toBeInTheDocument();
    }
    const analysis = screen.getByRole("group", { name: "Analysis" });
    expect(within(analysis).getByRole("link", { name: /Head to head/ })).toBeInTheDocument();
    expect(within(analysis).queryByRole("link", { name: /Archive/ })).not.toBeInTheDocument();
  });

  it("marks the page you're on", () => {
    render(<Rail />);
    expect(screen.getByRole("link", { name: /Season stats/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Archive/ })).not.toHaveAttribute("aria-current");
  });

  it("keeps a page marked while you're inside it", () => {
    pathname = "/compare/anything";
    render(<Rail />);
    expect(screen.getByRole("link", { name: /Head to head/ })).toHaveAttribute("aria-current", "page");
  });

  it("marks nothing on a page that isn't in the menu", () => {
    pathname = "/login";
    render(<Rail />);
    expect(screen.queryByRole("link", { current: "page" })).toBeNull();
  });

  it("goes home from the brand", () => {
    render(<Rail />);
    expect(screen.getByRole("link", { name: "Pit Wall home" })).toHaveAttribute("href", "/");
  });

  describe("live indicator", () => {
    it("is absent when there is no live session", () => {
      render(<Rail />);
      expect(screen.getByRole("link", { name: /Live timing/ })).not.toHaveTextContent(/live now/i);
    });

    it("appears on Live timing while a session is live, and is announced", () => {
      useF1Store.setState({ isConnected: true } as any);
      render(<Rail />);
      expect(screen.getByRole("link", { name: /Live timing.*live now/i })).toBeInTheDocument();
    });

    it("appears only on Live timing", () => {
      useF1Store.setState({ isConnected: true } as any);
      render(<Rail />);
      for (const link of within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link")) {
        const isLive = /^Live timing/.test(link.textContent ?? "");
        expect(/\(live now\)/.test(link.textContent ?? "")).toBe(isLive);
      }
    });
  });

  describe("collapse toggle", () => {
    it("offers to collapse, and reports the sidebar as expanded", () => {
      render(<Rail />);
      const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
    });

    it("collapses, remembers it, and can expand again", async () => {
      render(<Rail />);
      await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
      expect(document.documentElement.dataset.rail).toBe("collapsed");
      expect(localStorage.getItem(RAIL_KEY)).toBe("collapsed");
      const expand = screen.getByRole("button", { name: "Expand sidebar" });
      expect(expand).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(expand);
      expect(document.documentElement.dataset.rail).toBeUndefined();
      expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    });

    it("reflects a sidebar that was already collapsed when the page loaded", () => {
      document.documentElement.dataset.rail = "collapsed";
      render(<Rail />);
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    });
  });

  describe("search", () => {
    it("opens the command palette from the sidebar", async () => {
      render(<Rail />);
      await userEvent.click(screen.getByRole("button", { name: /^Search/ }));
      expect(usePaletteStore.getState().open).toBe(true);
    });
  });

  describe("status card", () => {
    it("says when the next race is and links to predictions", () => {
      calendar.mockReturnValue(UPCOMING);
      render(<Rail />);
      const card = screen.getByRole("link", { name: /Next race.*Italian Grand Prix/i });
      expect(card).toHaveAttribute("href", "/predictions");
      expect(card).toHaveTextContent(/7 Sep/);
    });

    it("says a session is live and links to live timing", () => {
      calendar.mockReturnValue(UPCOMING);
      useF1Store.setState({ isConnected: true, activeSession: { circuit_short_name: "Monza", session_name: "Race" } } as any);
      render(<Rail />);
      const card = screen.getByRole("link", { name: /Live now.*Monza Race/i });
      expect(card).toHaveAttribute("href", "/live");
      expect(screen.queryByRole("link", { name: /Next race/i })).not.toBeInTheDocument();
    });

    it("stays out of the way until the calendar has loaded", () => {
      render(<Rail />);
      expect(screen.queryByRole("link", { name: /Next race|Live now/i })).not.toBeInTheDocument();
    });

    it("stays out of the way when the season is over", () => {
      calendar.mockReturnValue({ status: "ready", retry: vi.fn(), data: [UPCOMING.data[0]] });
      render(<Rail />);
      expect(screen.queryByRole("link", { name: /Next race/i })).not.toBeInTheDocument();
    });
  });
});
