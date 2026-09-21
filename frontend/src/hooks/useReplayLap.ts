"use client";

import axios from "axios";
import { useEffect } from "react";
import { useAsync } from "@/hooks/useAsync";
import type { ReplayLap } from "@/lib/replay";

// A replay is watched lap after lap, so a lap that has been asked for is kept (as a promise, so two
// callers share one request) and the next lap is fetched while this one plays.
const MAX_LAPS = 8;
const laps = new Map<string, Promise<ReplayLap>>();

export function clearReplayCache() {
  laps.clear();
}

function loadLap(year: number, round: number, lap: number): Promise<ReplayLap> {
  const key = `${year}-${round}-${lap}`;
  const hit = laps.get(key);
  if (hit) return hit;
  const request = axios
    .get<ReplayLap>("/api/v1/telemetry/replay", { params: { year, round, lap_number: lap } })
    .then((res) => res.data);
  laps.set(key, request);
  request.catch(() => laps.delete(key)); // a failure isn't remembered
  while (laps.size > MAX_LAPS) laps.delete(laps.keys().next().value as string);
  return request;
}

export function useReplayLap(year: number, round: number | null, lap: number, totalLaps: number | null) {
  const state = useAsync<ReplayLap>(round === null ? null : () => loadLap(year, round, lap), `replay-${year}-${round}-${lap}`);

  const ready = state.status === "ready";
  useEffect(() => {
    if (!ready || round === null || totalLaps === null || lap >= totalLaps) return;
    loadLap(year, round, lap + 1).catch(() => {});
  }, [ready, year, round, lap, totalLaps]);

  return state;
}
