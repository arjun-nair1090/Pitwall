import { describe, expect, it } from "vitest";
import { biggestGains, brakeVerdict, type CornerDuelRow, type CornerMetrics } from "./corners";

const metrics: CornerMetrics = { zone_time: 2, apex_speed: 100, entry_speed: 200, exit_speed: 150, brake_before_m: 50 };
const row = (label: string, time_delta: number): CornerDuelRow => ({
  label, number: Number(label.slice(1)), letter: "", x: 0, y: 0, angle: 0, driver1: metrics, driver2: metrics, time_delta,
});

describe("brakeVerdict", () => {
  it("says so when neither driver braked", () => {
    expect(brakeVerdict(null, null, "VER", "NOR")).toBe("No braking");
  });

  it("names the only driver who braked", () => {
    expect(brakeVerdict(80, null, "VER", "NOR")).toBe("Only VER braked");
    expect(brakeVerdict(null, 80, "VER", "NOR")).toBe("Only NOR braked");
  });

  it("treats points within 10 m as the same", () => {
    expect(brakeVerdict(120, 111, "VER", "NOR")).toBe("Same braking point");
    expect(brakeVerdict(111, 120, "VER", "NOR")).toBe("Same braking point");
  });

  it("names the later braker, who has the smaller distance before the corner", () => {
    expect(brakeVerdict(120, 100, "VER", "NOR")).toBe("NOR brakes 20 m later");
    expect(brakeVerdict(100, 120, "VER", "NOR")).toBe("VER brakes 20 m later");
  });
});

describe("biggestGains", () => {
  it("picks each driver's best corner", () => {
    const rows = [row("T1", 0.05), row("T2", 0.2), row("T3", -0.1), row("T4", -0.3)];
    const { first, second } = biggestGains(rows);
    expect(first?.label).toBe("T2");
    expect(second?.label).toBe("T4");
  });

  it("returns null for a driver who gained nowhere", () => {
    expect(biggestGains([row("T1", 0.1)]).second).toBeNull();
    expect(biggestGains([row("T1", -0.1)]).first).toBeNull();
    expect(biggestGains([row("T1", 0)])).toEqual({ first: null, second: null });
  });

  it("returns nulls for an empty list", () => {
    expect(biggestGains([])).toEqual({ first: null, second: null });
  });
});
