import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Wordmark, { Mark } from "./Wordmark";

describe("Wordmark", () => {
  it("draws PIT and WALL in the text colour, split by a red slash", () => {
    const { container } = render(<Wordmark />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden");
    expect(svg.querySelectorAll('path[fill="currentColor"]')).toHaveLength(2);
    expect(svg.querySelector("polygon")).toHaveAttribute("fill", "rgb(var(--f1-red))");
  });

  it("lays the slash between the two words", () => {
    const { container } = render(<Wordmark />);
    const [pit, wall] = Array.from(container.querySelectorAll("path")).map((p) => Number(p.getAttribute("d")!.match(/^M([\d.]+)/)![1]));
    const slashX = Number(container.querySelector("polygon")!.getAttribute("points")!.split(",")[0]);
    expect(pit).toBeLessThan(slashX);
    expect(slashX).toBeLessThan(wall);
  });
});

describe("Mark", () => {
  it("is P with the red slash, sized by height", () => {
    const { container } = render(<Mark className="h-8" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveClass("h-8", "w-auto");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(svg.querySelector("polygon")).toHaveAttribute("fill", "rgb(var(--f1-red))");
  });
});
