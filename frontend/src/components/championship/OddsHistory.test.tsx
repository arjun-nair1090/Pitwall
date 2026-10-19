import { fireEvent, render, screen, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import OddsHistory, { OddsTooltipContent } from "./OddsHistory";
import { HISTORY_DRIVERS, SEASON_HISTORY } from "./fixtures";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 320 }) };
});

const legend = () => within(screen.getByRole("list", { name: "Drivers on the chart" })).getAllByRole("listitem");
const swatch = (li: HTMLElement) => li.querySelector("[data-swatch]") as HTMLElement;

describe("OddsHistory", () => {
  it("charts only drivers who reached 1%, in the order of the drivers list", () => {
    // History key order is VER, NOR, PIA, HAM and alphabetical is HAM, NOR, PIA, VER; LEC never reaches 1%.
    const { container } = render(<OddsHistory history={SEASON_HISTORY} drivers={HISTORY_DRIVERS} />);
    expect(legend().map((li) => li.textContent)).toEqual(["HAM", "VER", "NOR", "PIA"]);
    expect(container.querySelectorAll("path.recharts-line-curve")).toHaveLength(4);
  });

  it("colours each swatch by team and dashes the second driver of a team", () => {
    render(<OddsHistory history={SEASON_HISTORY} drivers={HISTORY_DRIVERS} />);
    const items = legend();
    expect(swatch(items[0]).style.backgroundColor).toBe("rgb(232, 0, 45)");
    expect(swatch(items[1]).style.backgroundColor).toBe("rgb(54, 113, 198)");
    expect(items.map((li) => swatch(li).getAttribute("data-dashed"))).toEqual(["false", "false", "false", "true"]);
  });

  it("draws no scatter series", () => {
    const { container } = render(<OddsHistory history={SEASON_HISTORY} drivers={HISTORY_DRIVERS} />);
    expect(container.querySelector(".recharts-scatter")).toBeNull();
  });

  it("still renders, with its legend, for a single round", () => {
    render(<OddsHistory history={SEASON_HISTORY.slice(0, 1)} drivers={HISTORY_DRIVERS} />);
    expect(legend().map((li) => li.textContent)).toEqual(["HAM", "VER", "NOR", "PIA"]);
  });

  it("names the hovered round and ranks the drivers on it", async () => {
    const { container } = render(<OddsHistory history={SEASON_HISTORY} drivers={HISTORY_DRIVERS} />);
    const surface = container.querySelector(".recharts-wrapper") as HTMLElement;
    surface.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 320, width: 800, height: 320, toJSON: () => ({}) });
    Object.defineProperty(surface, "offsetWidth", { value: 800 });
    Object.defineProperty(surface, "offsetHeight", { value: 320 });
    // The plot spans roughly x = 50 to 784, so round 3 of 4 sits two thirds of the way along.
    fireEvent.mouseMove(surface, { clientX: 50 + (734 * 2) / 3, clientY: 100 });
    const tooltip = container.querySelector(".recharts-tooltip-wrapper") as HTMLElement;
    expect(await within(tooltip).findByText("After round 3: Japanese Grand Prix")).toBeInTheDocument();
    // PIA, NOR, HAM, VER is the order of round 3 alone: every other round ranks them differently.
    expect(within(tooltip).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "PIA50.0%", "NOR25.0%", "HAM15.0%", "VER10.0%",
    ]);
  });
});

describe("OddsTooltipContent", () => {
  const charted = HISTORY_DRIVERS.slice(0, 4);

  it("reads a driver missing from the round as 0%, last", () => {
    render(<OddsTooltipContent active payload={[{ payload: SEASON_HISTORY[3] }]} drivers={charted} />);
    expect(screen.getByText("After round 4: Bahrain Grand Prix")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["NOR60.0%", "PIA30.0%", "HAM10.0%", "VER0%"]);
  });

  it("writes a certainty as 100%", () => {
    render(<OddsTooltipContent active payload={[{ payload: { round: 9, name: "Last", odds: { NOR: 1 } } }]} drivers={charted} />);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("NOR100%");
  });

  it("renders nothing when inactive", () => {
    const { container } = render(<OddsTooltipContent active={false} payload={[{ payload: SEASON_HISTORY[0] }]} drivers={charted} />);
    expect(container).toBeEmptyDOMElement();
  });
});
