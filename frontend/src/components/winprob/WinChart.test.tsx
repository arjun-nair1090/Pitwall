import { fireEvent, render, screen, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { WIN_PROB } from "./fixtures";
import WinChart, { ChanceTooltipContent } from "./WinChart";
import { chartDrivers } from "@/lib/winprob";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 360 }) };
});

const renderChart = (props: Partial<{ lap: number; data: typeof WIN_PROB }> = {}) => {
  const onSelect = vi.fn();
  const utils = render(<WinChart data={props.data ?? WIN_PROB} lap={props.lap ?? 4} onSelect={onSelect} />);
  return { ...utils, onSelect };
};
const paths = (c: HTMLElement) => Array.from(c.querySelectorAll("path.recharts-line-curve"));

// The plot runs from about x = 50 to 784, so lap 3 of 6 is two fifths of the way along.
const hover = (container: HTMLElement, lap: number) => {
  const surface = container.querySelector(".recharts-wrapper") as HTMLElement;
  surface.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 360, width: 800, height: 360, toJSON: () => ({}) });
  Object.defineProperty(surface, "offsetWidth", { value: 800 });
  Object.defineProperty(surface, "offsetHeight", { value: 360 });
  const init = { clientX: 50 + (734 * (lap - 1)) / 5, clientY: 100 };
  fireEvent.mouseMove(surface, init);
  return { surface, init };
};

describe("WinChart", () => {
  it("is 360 px tall", () => {
    renderChart();
    expect(screen.getByRole("img", { name: /chance of winning/i })).toHaveStyle({ height: "360px" });
  });

  it("draws a line only for drivers who reach 5%, in team colours", () => {
    const { container } = renderChart();
    const lines = paths(container);
    expect(lines).toHaveLength(4);
    expect(lines.map((p) => p.getAttribute("stroke"))).toEqual(["#FF8000", "#3671C6", "#E80020", "#3671C6"]);
  });

  it("dashes the later Red Bull only", () => {
    const { container } = renderChart();
    expect(paths(container).map((p) => p.getAttribute("stroke-dasharray"))).toEqual([null, null, null, "6 4"]);
  });

  it("shades each run of safety-car laps once", () => {
    const { container } = renderChart();
    expect(container.querySelectorAll(".recharts-reference-area")).toHaveLength(2);
  });

  it("shades nothing when there was no safety car", () => {
    const { container } = renderChart({ data: { ...WIN_PROB, sc_laps: [] } });
    expect(container.querySelectorAll(".recharts-reference-area")).toHaveLength(0);
  });

  it("draws one vertical line at the selected lap, and moves it", () => {
    const x = (container: HTMLElement) => Number(container.querySelector(".recharts-reference-line line")?.getAttribute("x1"));
    const a = renderChart({ lap: 2 });
    expect(a.container.querySelectorAll(".recharts-reference-line")).toHaveLength(1);
    const at2 = x(a.container);
    a.unmount();
    const b = renderChart({ lap: 5 });
    expect(x(b.container)).toBeGreaterThan(at2);
  });

  it("selects the lap that is clicked", async () => {
    const { container, onSelect } = renderChart();
    const { surface, init } = hover(container, 3);
    await within(container.querySelector(".recharts-tooltip-wrapper") as HTMLElement).findByText("Lap 3");
    fireEvent.click(surface, init);
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("names the hovered lap and ranks its chances highest first", async () => {
    const { container } = renderChart();
    hover(container, 3);
    const tooltip = container.querySelector(".recharts-tooltip-wrapper") as HTMLElement;
    expect(await within(tooltip).findByText("Lap 3")).toBeInTheDocument();
    // LEC leads lap 3 only, and lap 3 puts VER above PER where every other lap has them the other way round.
    expect(within(tooltip).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["LEC40.0%", "NOR33.0%", "VER15.0%", "PER8.0%"]);
  });
});

describe("ChanceTooltipContent", () => {
  const drivers = chartDrivers(WIN_PROB);
  it("sorts a lap by chance and formats the ends", () => {
    render(<ChanceTooltipContent active payload={[{ payload: { lap: 6, NOR: 0, PER: 0, LEC: 0, VER: 1 } }]} drivers={drivers} />);
    expect(screen.getByText("Lap 6")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["VER100%", "NOR0%", "PER0%", "LEC0%"]);
  });
  it("renders nothing when inactive", () => {
    const { container } = render(<ChanceTooltipContent active={false} payload={[]} drivers={drivers} />);
    expect(container).toBeEmptyDOMElement();
  });
});
