import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ConstructorsTable from "./ConstructorsTable";
import { CONSTRUCTORS } from "./fixtures";

const rowOf = (team: string) => screen.getByText(team).closest("tr") as HTMLElement;
const cells = (team: string) => within(rowOf(team)).getAllByRole("cell").map((c) => c.textContent);

describe("ConstructorsTable", () => {
  it("has the columns in order", () => {
    render(<ConstructorsTable teams={CONSTRUCTORS} />);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Pos", "Team", "Points", "Title chance", "Expected"]);
  });

  it("reads each team's row", () => {
    render(<ConstructorsTable teams={CONSTRUCTORS} />);
    expect(cells("Mercedes")).toEqual(["1", "Mercedes", "578", "99.8%", "608.6"]);
    expect(cells("Ferrari")).toEqual(["2", "Ferrari", "444", "0.2%", "495.4"]);
  });

  it("fades an eliminated team's chance", () => {
    render(<ConstructorsTable teams={CONSTRUCTORS} />);
    expect(within(rowOf("Red Bull")).getByText("0%")).toHaveClass("text-faint");
  });

  it("draws the team's colour, and leaves a team with none neutral", () => {
    render(<ConstructorsTable teams={CONSTRUCTORS} />);
    const spine = (team: string) => within(rowOf(team)).getAllByRole("cell")[0];
    expect(spine("Ferrari")).toHaveStyle({ boxShadow: "inset 4px 0 0 #E8002D" });
    expect(spine("Audi")).toHaveStyle({ boxShadow: "inset 4px 0 0 #8790A0" });
  });
});
