import { describe, expect, it } from "vitest";
import {
  cheapStopText, defaultLap, lapsText, lastLapFromError, planText, statusText, undercutLead, wearText, windowText,
  type PitDriver,
} from "./pitwindow";

const base: PitDriver = {
  code: "VER", name: "Max Verstappen", team: "Red Bull Racing", color: "#3671C6", position: 1, compound: "MEDIUM",
  tyre_age: 12, used: ["MEDIUM"], gap_ahead: null, status: "box now", best: null, window: null, cheap_stop: false, rule_breach: false,
  early: false,
};
const d = (o: Partial<PitDriver>): PitDriver => ({ ...base, ...o });

describe("planText", () => {
  it("names a single stop", () => expect(planText(d({ best: { stops: [{ lap: 23, compound: "HARD" }], cost: 1 } }))).toBe("Box lap 23 → Hard"));
  it("chains two stops", () =>
    expect(planText(d({ best: { stops: [{ lap: 18, compound: "MEDIUM" }, { lap: 40, compound: "HARD" }], cost: 1 } }))).toBe(
      "Box lap 18 → Medium, lap 40 → Hard",
    ));
  it("says stay out for a plan with no stops", () => expect(planText(d({ best: { stops: [], cost: 1 } }))).toBe("Stay out"));
  it("shows a dash when there is no plan", () => expect(planText(d({ best: null }))).toBe("—"));
});

describe("windowText", () => {
  it("gives the range", () => expect(windowText(d({ window: { open: 21, close: 25 } }))).toBe("Laps 21–25"));
  it("shows a dash without one", () => expect(windowText(d({ window: null }))).toBe("—"));
});

describe("statusText", () => {
  it("labels each status", () => {
    expect(statusText(d({ status: "box now" }))).toBe("Box now");
    expect(statusText(d({ status: "window open" }))).toBe("Window open");
    expect(statusText(d({ status: "window opens", window: { open: 21, close: 25 } }))).toBe("Window opens lap 21");
    expect(statusText(d({ status: "stay out" }))).toBe("Stay out");
    expect(statusText(d({ status: "wet" }))).toBe("Wet tyres");
  });
  it("puts the two-compound rule above whatever the status says", () =>
    expect(statusText(d({ status: "stay out", rule_breach: true }))).toBe("Can't meet the two-compound rule"));
});

describe("small formatters", () => {
  it("counts laps", () => {
    expect(lapsText(12)).toBe("12 laps");
    expect(lapsText(1)).toBe("1 lap");
  });
  it("says a neutralised lap is a cheap time to stop, with no number (a red flag makes it free)", () => {
    expect(cheapStopText()).toBe("Safety car or red flag: a cheap time to stop");
  });
  it("signs the wear", () => {
    expect(wearText(0.0814)).toBe("+0.081 s a lap");
    expect(wearText(-0.02)).toBe("-0.020 s a lap");
  });
  it("describes an undercut", () => {
    const u = { chaser: "NOR", leader: "VER", gap: 1.2, gain: 1.9, margin: 0.7, verdict: "likely" as const, compound: "HARD" };
    expect(undercutLead(u)).toBe("NOR on VER · 1.2 s behind · undercut gains 1.9 s → ");
    expect(undercutLead({ ...u, gain: -0.34 })).toBe("NOR on VER · 1.2 s behind · undercut loses 0.3 s → ");
  });
});

describe("laps", () => {
  it("starts a third of the way in, never on the last lap", () => {
    expect(defaultLap(57)).toBe(19);
    expect(defaultLap(2)).toBe(1);
    expect(defaultLap(1)).toBe(1);
  });
  it("reads the last lap from the server's message", () => {
    expect(lastLapFromError("Pick a lap from 1 to 43.")).toBe(43);
    expect(lastLapFromError("There's no data for round 14 2024 yet.")).toBeNull();
  });
});
