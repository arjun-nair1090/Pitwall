import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import StintEditor from "./StintEditor";
import { totalLaps, type Stint } from "@/lib/strategy";

const plan = (...pairs: [Stint["compound"], number][]): Stint[] => pairs.map(([compound, laps]) => ({ compound, laps }));

function Harness({ start, raceLaps = 44 }: { start: Stint[]; raceLaps?: number | null }) {
  const [stints, setStints] = useState(start);
  return (
    <>
      <StintEditor stints={stints} raceLaps={raceLaps} onChange={setStints} />
      <output aria-label="plan">{stints.map((s) => `${s.compound}:${s.laps}`).join(",")}</output>
      <output aria-label="total">{totalLaps(stints)}</output>
    </>
  );
}
const state = () => screen.getByLabelText("plan").textContent;
const laps = (n: number) => screen.getByLabelText(`Stint ${n} laps`) as HTMLInputElement;

describe("StintEditor", () => {
  it("shows each stint with the laps it covers", () => {
    render(<Harness start={plan(["MEDIUM", 20], ["HARD", 24])} />);
    const first = screen.getByRole("group", { name: "Stint 1" });
    const second = screen.getByRole("group", { name: "Stint 2" });
    expect(within(first).getByText("Laps 1 to 20")).toBeInTheDocument();
    expect(within(second).getByText("Laps 21 to 44")).toBeInTheDocument();
  });

  it("changes a stint's tyre", async () => {
    render(<Harness start={plan(["MEDIUM", 20], ["HARD", 24])} />);
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Stint 2 tyre" })).getByRole("radio", { name: /soft/i }));
    expect(state()).toBe("MEDIUM:20,SOFT:24");
  });

  it("marks the chosen tyre for assistive technology", () => {
    render(<Harness start={plan(["MEDIUM", 20], ["HARD", 24])} />);
    const tyres = screen.getByRole("radiogroup", { name: "Stint 1 tyre" });
    expect(within(tyres).getByRole("radio", { name: /medium/i })).toBeChecked();
    expect(within(tyres).getByRole("radio", { name: /hard/i })).not.toBeChecked();
  });

  it("changes laps by typing, but never beyond the race", () => {
    render(<Harness start={plan(["MEDIUM", 20], ["HARD", 20])} />);
    fireEvent.change(laps(1), { target: { value: "40" } });
    expect(state()).toBe("MEDIUM:24,HARD:20");   // only 4 laps were free
  });

  it("changes laps with the stepper buttons and stops at the limits", async () => {
    render(<Harness start={plan(["MEDIUM", 43], ["HARD", 1])} />);
    expect(screen.getByRole("button", { name: "More laps in stint 1" })).toBeDisabled();   // no laps left to plan
    await userEvent.click(screen.getByRole("button", { name: "Fewer laps in stint 1" }));
    expect(state()).toBe("MEDIUM:42,HARD:1");
    expect(screen.getByRole("button", { name: "Fewer laps in stint 2" })).toBeDisabled();   // a stint is at least one lap
    await userEvent.click(screen.getByRole("button", { name: "More laps in stint 1" }));
    expect(state()).toBe("MEDIUM:43,HARD:1");
  });

  it("gives each lap control a limit that leaves the plan inside the race", () => {
    render(<Harness start={plan(["MEDIUM", 20], ["HARD", 15])} />);   // 9 laps free
    expect(laps(1).max).toBe("29");
    expect(laps(2).max).toBe("24");
    expect(laps(1).min).toBe("1");
  });

  it("adds a stint that takes the laps still to plan", async () => {
    render(<Harness start={plan(["MEDIUM", 20])} />);
    await userEvent.click(screen.getByRole("button", { name: "Add stint" }));
    expect(state()).toBe("MEDIUM:20,HARD:24");
  });

  it("removes a stint, but keeps the last one", async () => {
    render(<Harness start={plan(["MEDIUM", 20], ["HARD", 24])} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove stint 1" }));
    expect(state()).toBe("HARD:24");
    expect(screen.queryByRole("button", { name: /remove stint/i })).not.toBeInTheDocument();
  });

  it("offers ready-made plans that fill the race", async () => {
    render(<Harness start={plan(["MEDIUM", 44])} />);
    await userEvent.click(screen.getByRole("button", { name: "2 stops" }));
    expect(screen.getByLabelText("total").textContent).toBe("44");
    expect(screen.getAllByRole("group", { name: /^Stint \d$/ })).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "No stop" }));
    expect(state()).toBe("HARD:44");
  });

  it("offers to fill the laps still unplanned, on the last stint", async () => {
    render(<Harness start={plan(["MEDIUM", 20], ["HARD", 15])} />);
    await userEvent.click(screen.getByRole("button", { name: "Use the 9 unplanned laps on stint 2" }));
    expect(state()).toBe("MEDIUM:20,HARD:24");
    expect(screen.queryByRole("button", { name: /unplanned laps/i })).not.toBeInTheDocument();
  });

  it("offers to trim an over-long plan from the last stint", async () => {
    render(<Harness start={plan(["MEDIUM", 30], ["HARD", 20])} />);
    await userEvent.click(screen.getByRole("button", { name: "Trim stint 2 by 6 laps" }));
    expect(state()).toBe("MEDIUM:30,HARD:14");
  });

  it("is switched off until the race distance is known", () => {
    render(<Harness start={plan(["MEDIUM", 20])} raceLaps={null} />);
    expect(screen.getByRole("button", { name: "Add stint" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1 stop" })).toBeDisabled();
    expect(laps(1)).toBeDisabled();
  });
});
