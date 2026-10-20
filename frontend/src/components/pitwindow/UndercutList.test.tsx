import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import UndercutList from "./UndercutList";
import { PIT_WINDOW } from "./fixtures";

describe("UndercutList", () => {
  it("describes each undercut in margin order", () => {
    render(<UndercutList undercuts={PIT_WINDOW.undercuts} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "NOR on VER · 1.2 s behind · undercut gains 1.9 s → Likely",
      "HAM on NOR · 2.0 s behind · undercut gains 2.1 s → Possible",
      "ALO on HAM · 2.8 s behind · undercut gains 1.4 s → Unlikely",
    ]);
  });

  it("colours the verdicts from the tokens: positive, warning, muted", () => {
    render(<UndercutList undercuts={PIT_WINDOW.undercuts} />);
    expect(screen.getByText("Likely")).toHaveClass("text-timing-green");
    expect(screen.getByText("Possible")).toHaveClass("text-timing-yellow");
    expect(screen.getByText("Unlikely")).toHaveClass("text-mute");
  });

  it("says when nobody is close enough", () => {
    render(<UndercutList undercuts={[]} />);
    expect(screen.getByText("No car within 3 s of the car ahead.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
