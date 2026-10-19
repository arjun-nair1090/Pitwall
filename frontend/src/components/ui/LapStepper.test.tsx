import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LapStepper from "./LapStepper";

describe("LapStepper", () => {
  it("shows the lap out of the total and steps by one", () => {
    const onChange = vi.fn();
    render(<LapStepper lap={12} total={44} onChange={onChange} />);
    expect(screen.getByText("Lap 12 of 44")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next lap" }));
    expect(onChange).toHaveBeenLastCalledWith(13);
    fireEvent.click(screen.getByRole("button", { name: "Previous lap" }));
    expect(onChange).toHaveBeenLastCalledWith(11);
  });

  it("has a range input named Lap that runs from 1 to the lap before the last", () => {
    const onChange = vi.fn();
    render(<LapStepper lap={12} total={44} onChange={onChange} />);
    const range = screen.getByRole("slider", { name: "Lap" });
    expect(range).toHaveAttribute("min", "1");
    expect(range).toHaveAttribute("max", "43");
    expect(range).toHaveValue("12");
    fireEvent.change(range, { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith(30);
  });

  it("disables previous on lap 1", () => {
    render(<LapStepper lap={1} total={44} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Previous lap" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next lap" })).toBeEnabled();
  });

  it("disables next on the lap before the last", () => {
    render(<LapStepper lap={43} total={44} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Next lap" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous lap" })).toBeEnabled();
  });

  it("shows only the lap, with every control disabled, until the total is known", () => {
    render(<LapStepper lap={10} total={null} onChange={() => {}} />);
    expect(screen.getByText("Lap 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous lap" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next lap" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Lap" })).toBeDisabled();
  });

  it("uses a custom label for the readout, the range and the buttons", () => {
    render(<LapStepper lap={5} total={20} label="Replay lap" onChange={() => {}} />);
    expect(screen.getByText("Replay lap 5 of 20")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Replay lap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous replay lap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next replay lap" })).toBeInTheDocument();
  });
});
