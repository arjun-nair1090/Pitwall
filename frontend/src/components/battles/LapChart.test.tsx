import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { LAP_CHART } from "./fixtures";
import LapChart, { LapTooltipContent } from "./LapChart";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 420 }) };
});

const { drivers, overtakes, total_laps } = LAP_CHART;
const renderChart = () => render(<LapChart drivers={drivers} overtakes={overtakes} totalLaps={total_laps} />);
const legend = () => within(screen.getByRole("list", { name: "Drivers on the chart" })).getAllByRole("listitem");
const swatch = (li: HTMLElement) => li.querySelector("[data-swatch]") as HTMLElement;

describe("LapChart", () => {
  it("offers nobody plus every driver, with nobody selected", () => {
    renderChart();
    const select = screen.getByLabelText("Highlight");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Nobody", "Lando Norris (NOR)", "Max Verstappen (VER)", "Oscar Piastri (PIA)", "Lewis Hamilton (HAM)",
    ]);
    expect(select).toHaveValue("");
    expect(screen.queryByTestId("lap-chart-summary")).not.toBeInTheDocument();
  });

  it("summarises the highlighted driver", async () => {
    renderChart();
    await userEvent.selectOptions(screen.getByLabelText("Highlight"), "NOR");
    expect(screen.getByTestId("lap-chart-summary")).toHaveTextContent("NOR: started 3rd, finished 1st, 1 pass made, 0 lost");
  });

  it("says a pit-lane start and a non-finisher plainly", async () => {
    renderChart();
    await userEvent.selectOptions(screen.getByLabelText("Highlight"), "PIA");
    expect(screen.getByTestId("lap-chart-summary")).toHaveTextContent("PIA: started from the pit lane, finished 3rd, 1 pass made, 0 lost");
    await userEvent.selectOptions(screen.getByLabelText("Highlight"), "HAM");
    expect(screen.getByTestId("lap-chart-summary")).toHaveTextContent("HAM: started 4th, did not finish, 0 passes made, 1 lost");
  });

  it("lists every driver in finishing order with a team-coloured swatch", () => {
    renderChart();
    const items = legend();
    expect(items.map((li) => li.textContent)).toEqual(["NOR", "VER", "PIA", "HAM"]);
    expect(swatch(items[0]).style.backgroundColor).toBe("rgb(255, 128, 0)");
    expect(swatch(items[1]).style.backgroundColor).toBe("rgb(54, 113, 198)");
  });

  it("dashes the second driver of a team", () => {
    renderChart();
    expect(legend().map((li) => swatch(li).getAttribute("data-dashed"))).toEqual(["false", "false", "true", "false"]);
  });

  it("draws one line per driver, thicker for the highlighted one and faint for the rest", async () => {
    const { container } = renderChart();
    const paths = () => Array.from(container.querySelectorAll("path.recharts-line-curve"));
    expect(paths()).toHaveLength(4);
    expect(paths().map((p) => p.getAttribute("stroke-width"))).toEqual(["1.5", "1.5", "1.5", "1.5"]);
    await userEvent.selectOptions(screen.getByLabelText("Highlight"), "NOR");
    expect(paths().map((p) => p.getAttribute("stroke-width"))).toEqual(["3", "1.5", "1.5", "1.5"]);
    expect(paths().map((p) => p.getAttribute("stroke-opacity"))).toEqual(["1", "0.2", "0.2", "0.2"]);
  });

  it("marks only the highlighted driver's passes, with no scatter series", async () => {
    const { container } = renderChart();
    expect(container.querySelectorAll("[data-pass-dot]")).toHaveLength(0);
    await userEvent.selectOptions(screen.getByLabelText("Highlight"), "PIA");
    const dots = container.querySelectorAll("[data-pass-dot]");
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute("data-pass-dot", "3");
    expect(container.querySelector(".recharts-scatter")).toBeNull();
  });

  it("names the hovered lap and the leader on it", async () => {
    const { container } = renderChart();
    const surface = container.querySelector(".recharts-wrapper") as HTMLElement;
    surface.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 420, width: 800, height: 420, toJSON: () => ({}) });
    // The plot spans roughly x = 50 to 784, so lap 3 of 4 sits two thirds of the way along.
    Object.defineProperty(surface, "offsetWidth", { value: 800 });
    Object.defineProperty(surface, "offsetHeight", { value: 420 });
    fireEvent.mouseMove(surface, { clientX: 50 + (734 * 2) / 3, clientY: 100 });
    const tooltip = container.querySelector(".recharts-tooltip-wrapper") as HTMLElement;
    expect(await within(tooltip).findByText("Lap 3")).toBeInTheDocument();
    expect(within(tooltip).getAllByRole("listitem")[0]).toHaveTextContent("1NOR");
  });
});

describe("LapTooltipContent", () => {
  const row = { lap: 3, NOR: 1, VER: 2, PIA: 3, HAM: 4 };

  it("lists drivers in position order and bolds the highlighted one", () => {
    render(<LapTooltipContent active payload={[{ payload: row }]} drivers={drivers} highlight="PIA" />);
    expect(screen.getByText("Lap 3")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["1NOR", "2VER", "3PIA", "4HAM"]);
    expect(items[2]).toHaveClass("font-semibold");
    expect(items[0]).not.toHaveClass("font-semibold");
  });

  it("leaves out a driver with no position on the lap", () => {
    render(<LapTooltipContent active payload={[{ payload: { ...row, HAM: null, lap: 4 } }]} drivers={drivers} highlight="" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
