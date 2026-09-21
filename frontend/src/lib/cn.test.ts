import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
  it("lets the later Tailwind class win a conflict", () => {
    expect(cn("p-2 text-mute", "p-4")).toBe("text-mute p-4");
  });
});
