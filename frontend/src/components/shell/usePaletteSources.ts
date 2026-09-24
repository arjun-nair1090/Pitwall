"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { driverItems, raceItems, type PaletteItem } from "./paletteItems";

interface StandingsDriver { driver_code: string; driver_name: string; team_name: string }

let cached: Promise<PaletteItem[]> | null = null;

async function load(): Promise<PaletteItem[]> {
  const year = new Date().getFullYear();
  const [standings, thisYear, lastYear] = await Promise.allSettled([
    axios.get(`/api/v1/stats/standings?year=${year}`),
    axios.get(`/api/v1/races/historical?year=${year}`),
    axios.get(`/api/v1/races/historical?year=${year - 1}`),
  ]);
  const items: PaletteItem[] = [];
  if (standings.status === "fulfilled") {
    items.push(
      ...driverItems(
        (standings.value.data.driver_standings as StandingsDriver[]).map((d) => ({
          code: d.driver_code, name: d.driver_name, team: d.team_name,
        })),
      ),
    );
  }
  // Newest race first: the schedule is chronological, so reverse each season.
  for (const [result, y] of [[thisYear, year], [lastYear, year - 1]] as const) {
    if (result.status === "fulfilled") items.push(...raceItems(result.value.data, y).reverse());
  }
  return items;
}

// Fetched once, the first time the palette opens. A total failure is not cached,
// so the next open retries; pages stay searchable either way.
export function usePaletteSources(enabled: boolean): PaletteItem[] {
  const [items, setItems] = useState<PaletteItem[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const request = (cached ??= load());
    let live = true;
    request.then((result) => {
      if (result.length === 0) cached = null;
      if (live) setItems(result);
    });
    return () => { live = false; };
  }, [enabled]);
  return items;
}
