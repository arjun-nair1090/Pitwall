import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReorderAnimation } from "./useReorderAnimation";

const ROW = 40;

// jsdom has no layout, so each row's top comes from its place in the list and `animate` is a spy.
const animate = vi.fn();
Object.defineProperty(HTMLElement.prototype, "offsetTop", {
  configurable: true,
  get(this: HTMLElement) {
    return this.parentElement ? Array.from(this.parentElement.children).indexOf(this) * ROW : 0;
  },
});
HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];

function Tower({ order, enabled = true }: { order: string[]; enabled?: boolean }) {
  const rowRef = useReorderAnimation<HTMLLIElement>(order, enabled);
  return (
    <ol>
      {order.map((code) => (
        <li key={code} ref={rowRef(code)}>{code}</li>
      ))}
    </ol>
  );
}

function moves() {
  return animate.mock.calls.map(([frames]) => (frames as Keyframe[])[0].transform);
}

describe("useReorderAnimation", () => {
  afterEach(() => animate.mockClear());

  it("does not animate the first render", () => {
    render(<Tower order={["VER", "NOR", "LEC"]} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("slides each car that changed place from its old row to its new one", () => {
    const { rerender } = render(<Tower order={["VER", "NOR", "LEC"]} />);
    rerender(<Tower order={["NOR", "VER", "LEC"]} />);
    // NOR moved up a row (starts one row lower), VER down a row; LEC stayed put.
    expect(moves().sort()).toEqual([`translateY(${-ROW}px)`, `translateY(${ROW}px)`].sort());
  });

  it("does not animate a car that just appeared", () => {
    const { rerender } = render(<Tower order={["VER", "NOR"]} />);
    rerender(<Tower order={["VER", "NOR", "LEC"]} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("stays still when motion is turned off", () => {
    const { rerender } = render(<Tower order={["VER", "NOR"]} enabled={false} />);
    rerender(<Tower order={["NOR", "VER"]} enabled={false} />);
    expect(animate).not.toHaveBeenCalled();
  });
});
