import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DuelPicker, { type DuelChoice } from "./DuelPicker";
import type { SessionDriver } from "@/hooks/useRaceData";

const driver = (code: string, name: string, over: Partial<SessionDriver> = {}): SessionDriver => ({
  code, name, team: "Team", color: "#3671C6", position: 1, status: "Finished", laps: 44, fastest_lap: 32, fastest_time: 106.1, stints: [], ...over,
});

const drivers = [
  driver("HAM", "Lewis Hamilton", { fastest_lap: 33 }),
  driver("VER", "Max Verstappen", { fastest_lap: 32 }),
  driver("ALO", "Fernando Alonso", { laps: 12, fastest_lap: 9 }),
];

const choice: DuelChoice = { d1: "HAM", l1: "", d2: "VER", l2: "" };
const setup = (over: Partial<Parameters<typeof DuelPicker>[0]> = {}) => {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  render(<DuelPicker drivers={drivers} value={choice} onChange={onChange} onSubmit={onSubmit} loading={false} dirty={false} {...over} />);
  return { onChange, onSubmit };
};

describe("DuelPicker", () => {
  it("offers every driver who ran laps, by name", () => {
    setup();
    const options = within(screen.getByLabelText("Driver 1")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["HAM Lewis Hamilton", "VER Max Verstappen", "ALO Fernando Alonso"]);
  });

  it("shows which lap is the driver's fastest and limits laps to the ones they ran", () => {
    setup();
    const laps = within(screen.getByLabelText("Driver 1 lap")).getAllByRole("option").map((o) => o.textContent);
    expect(laps[0]).toBe("Fastest lap (lap 33)");
    expect(laps).toHaveLength(1 + 44);
    expect(laps[laps.length - 1]).toBe("Lap 44");
  });

  it("gives a short-running driver fewer laps to choose from", () => {
    setup({ value: { ...choice, d1: "ALO" } });
    expect(within(screen.getByLabelText("Driver 1 lap")).getAllByRole("option")).toHaveLength(1 + 12);
  });

  it("reports a changed driver and resets a lap that driver never ran", async () => {
    const { onChange } = setup({ value: { ...choice, l1: "30" } });
    await userEvent.selectOptions(screen.getByLabelText("Driver 1"), "ALO");
    expect(onChange).toHaveBeenCalledWith({ d1: "ALO", l1: "", d2: "VER", l2: "" });
  });

  it("keeps a chosen lap when the new driver ran it too", async () => {
    const { onChange } = setup({ value: { ...choice, l1: "10" } });
    await userEvent.selectOptions(screen.getByLabelText("Driver 1"), "VER");
    expect(onChange).toHaveBeenCalledWith({ d1: "VER", l1: "10", d2: "VER", l2: "" });
  });

  it("reports a chosen lap", async () => {
    const { onChange } = setup();
    await userEvent.selectOptions(screen.getByLabelText("Driver 2 lap"), "7");
    expect(onChange).toHaveBeenCalledWith({ d1: "HAM", l1: "", d2: "VER", l2: "7" });
  });

  it("compares on submit", async () => {
    const { onSubmit } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("says 'Update comparison' once the choices differ from what's on screen", () => {
    setup({ dirty: true });
    expect(screen.getByRole("button", { name: "Update comparison" })).toBeInTheDocument();
  });

  it("won't compare a driver's lap with itself", () => {
    setup({ value: { d1: "VER", l1: "", d2: "VER", l2: "" } });
    expect(screen.getByRole("button", { name: /compare/i })).toBeDisabled();
    expect(screen.getByText(/choose two different drivers, or two different laps/i)).toBeInTheDocument();
  });

  it("allows the same driver on two different laps", () => {
    setup({ value: { d1: "VER", l1: "5", d2: "VER", l2: "9" } });
    expect(screen.getByRole("button", { name: /compare/i })).toBeEnabled();
  });

  it("treats 'fastest' and the fastest lap's own number as the same lap", () => {
    setup({ value: { d1: "VER", l1: "", d2: "VER", l2: "32" } });
    expect(screen.getByRole("button", { name: /compare/i })).toBeDisabled();
  });

  it("shows progress while the comparison loads", () => {
    setup({ loading: true });
    expect(screen.getByRole("button", { name: /compare/i })).toHaveAttribute("aria-busy", "true");
  });

  it("is disabled until the session's drivers are known", () => {
    setup({ drivers: [], value: { d1: "", l1: "", d2: "", l2: "" } });
    expect(screen.getByRole("button", { name: /compare/i })).toBeDisabled();
    expect(screen.getByLabelText("Driver 1")).toBeDisabled();
  });
});
