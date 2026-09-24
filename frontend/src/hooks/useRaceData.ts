"use client";

import axios from "axios";
import { useAsync } from "@/hooks/useAsync";
import { completedRaces, type CalendarRace, type Race, type SessionCode } from "@/lib/season";

const CALENDAR_TTL_MS = 10 * 60 * 1000;
const calendars = new Map<number, { at: number; data: CalendarRace[] }>();

export function clearCalendarCache() {
  calendars.clear();
}

async function loadCalendar(year: number): Promise<CalendarRace[]> {
  const hit = calendars.get(year);
  if (hit && Date.now() - hit.at < CALENDAR_TTL_MS) return hit.data;
  const res = await axios.get<CalendarRace[]>("/api/v1/races/historical", { params: { year } });
  calendars.set(year, { at: Date.now(), data: res.data });
  return res.data;
}

// Every race on a season's calendar, finished or not, in the order the API returns them.
export function useSeasonCalendar(year: number) {
  return useAsync<CalendarRace[]>(() => loadCalendar(year), `calendar-${year}`);
}

// The races of a season that have finished, in order: the ones worth offering in a picker.
export function useSeasonRaces(year: number) {
  return useAsync<Race[]>(() => loadCalendar(year).then((calendar) => completedRaces(calendar)), `season-${year}`);
}

export interface DriverStanding {
  position: number;
  points: number;
  wins: number;
  driver_name: string;
  driver_code: string;
  driver_number: number | null;
  team_name: string;
}

export interface ConstructorStanding {
  position: number;
  points: number;
  wins: number;
  team_name: string;
}

export interface Standings {
  year: number;
  driver_standings: DriverStanding[];
  constructor_standings: ConstructorStanding[];
}

export function useStandings(year: number) {
  return useAsync<Standings>(
    () => axios.get<Standings>("/api/v1/stats/standings", { params: { year } }).then((res) => res.data),
    `standings-${year}`,
  );
}

// One row of GET /api/v1/races/results.
export interface ResultRow {
  position: number;
  code: string;
  name: string;
  team: string;
  color: string;
  grid: number;
  status: string | null;
  finished: boolean;
  points: number | null;
  race_time_seconds: number | null;
  gap_seconds: number | null;
}

export interface RaceResults {
  year: number;
  round: number;
  classification: ResultRow[];
}

// The final classification of a finished race. Idle until a round is chosen.
export function useRaceResults(year: number, round: number | null) {
  return useAsync<RaceResults>(
    round === null
      ? null
      : () => axios.get<RaceResults>("/api/v1/races/results", { params: { year, round } }).then((res) => res.data),
    `results-${year}-${round}`,
  );
}

// One driver of a session, as returned by GET /api/v1/races/session-info.
export interface SessionDriver {
  code: string;
  name: string;
  team: string;
  color: string;
  position: number | null;
  status: string | null;
  laps: number;
  fastest_lap: number | null;
  fastest_time: number | null;
  stints: { compound: string; laps: number }[];
}

export interface SessionInfo {
  year: number;
  round: number | null;
  event_name: string;
  session: SessionCode;
  total_laps: number;
  drivers: SessionDriver[];
}

// Who took part in a session and how long it ran, so a page only offers drivers and laps that
// exist. Idle until a round has been chosen.
export function useSessionInfo(year: number, round: number | null, session: SessionCode | string) {
  return useAsync<SessionInfo>(
    round === null
      ? null
      : () => axios.get<SessionInfo>("/api/v1/races/session-info", { params: { year, round, session } }).then((res) => res.data),
    `info-${year}-${round}-${session}`,
  );
}
