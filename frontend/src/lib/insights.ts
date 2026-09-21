// Response shapes for GET /api/v1/debrief and POST /api/v1/whatif.

export interface Stint {
  compound: string;
  laps: number;
}

export interface PodiumEntry {
  position: number;
  code: string;
  name: string;
  team: string;
  grid: number;
  positions_gained: number;
  points: number;
  gap: string | null;
}

export interface DebriefFacts {
  event: string;
  year: number;
  session: string;
  total_laps: number | null;
  winner: PodiumEntry & { race_time: string | null };
  podium: PodiumEntry[];
  fastest_lap: { code: string; name: string; lap: number; time: string; compound: string | null } | null;
  strategies: { code: string; stops: number; stints: Stint[] }[];
  biggest_gainers: { code: string; name: string; positions_gained: number }[];
  retirements: { code: string; name: string; team: string; status: string; laps_completed: number | null }[];
  neutralisations: { safety_cars: number; virtual_safety_cars: number; red_flags: number };
}

export interface DebriefResponse {
  facts: DebriefFacts;
  summary: string;
  source: "ai" | "template";
}

export type WhatIfChange =
  | { type: "shift_stop"; stop: number; laps: number }
  | { type: "change_compound"; stint: number; compound: string };

export interface WhatIfResponse {
  driver: string;
  changes: string[];
  actual_stints: Stint[];
  modified_stints: Stint[];
  actual_pit_laps: number[];
  modified_pit_laps: number[];
  baseline_seconds: number;
  modified_seconds: number;
  delta_seconds: number;
  actual_seconds: number | null;
  model_error_seconds: number | null;
  confidence: "low" | "medium";
  notes: string[];
  explanation: string;
  explanation_source: "ai" | "template";
  event: string;
  year: number;
  session: string;
}
