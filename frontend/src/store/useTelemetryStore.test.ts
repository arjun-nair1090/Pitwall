import { beforeEach, describe, expect, it } from "vitest";
import { useF1Store } from "./useTelemetryStore";

const alert = (id: string, message = "m") => ({ id, severity: "info" as const, message, timestamp: 1 });

beforeEach(() => useF1Store.setState({ alerts: [] }));

describe("alerts", () => {
  it("shows newest first", () => {
    useF1Store.getState().pushAlert(alert("a"));
    useF1Store.getState().pushAlert(alert("b"));
    expect(useF1Store.getState().alerts.map((a) => a.id)).toEqual(["b", "a"]);
  });

  it("ignores an alert whose id is already showing (React StrictMode runs effects twice)", () => {
    useF1Store.getState().pushAlert(alert("session-9999", "Session live: Race"));
    useF1Store.getState().pushAlert(alert("session-9999", "Session live: Race"));
    expect(useF1Store.getState().alerts).toHaveLength(1);
  });

  it("allows the same id again once it has been dismissed", () => {
    useF1Store.getState().pushAlert(alert("flag-1"));
    useF1Store.getState().dismissAlert("flag-1");
    useF1Store.getState().pushAlert(alert("flag-1"));
    expect(useF1Store.getState().alerts).toHaveLength(1);
  });

  it("keeps at most eight alerts", () => {
    for (let i = 0; i < 12; i++) useF1Store.getState().pushAlert(alert(`x${i}`));
    expect(useF1Store.getState().alerts).toHaveLength(8);
    expect(useF1Store.getState().alerts[0].id).toBe("x11");
  });
});
