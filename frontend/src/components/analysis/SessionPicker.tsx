"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { useSeasonRaces } from "@/hooks/useRaceData";
import { cn } from "@/lib/cn";
import { availableSessions, latestRound, raceLabel, SESSION_LABELS, seasonYears, type SessionCode } from "@/lib/season";

export interface RaceSelection {
  year: number;
  round: number | null;
  session: SessionCode;
}

interface SessionPickerProps {
  value: RaceSelection;
  onChange: (next: RaceSelection) => void;
  // Limit which sessions can be chosen (a tool that only makes sense for races or qualifying).
  allowedSessions?: readonly SessionCode[];
  showSession?: boolean;
  className?: string;
}

// Season, then a race from that season that has actually finished, then one of the sessions that
// weekend ran. Keeps itself consistent: it moves to the newest race when the chosen one isn't in
// the season, and to a session the weekend has when the chosen one wasn't run.
export default function SessionPicker({ value, onChange, allowedSessions, showSession = true, className }: SessionPickerProps) {
  const seasons = useSeasonRaces(value.year);
  const races = seasons.status === "ready" ? seasons.data : null;
  const race = races?.find((r) => r.round === value.round) ?? null;
  const sessions = race ? availableSessions(race).filter((s) => !allowedSessions || allowedSessions.includes(s)) : [];

  useEffect(() => {
    if (!races || race) return;
    if (races.length > 0) {
      onChange({ ...value, round: latestRound(races) });
    } else if (value.year === new Date().getFullYear()) {
      // Early in the year nothing has been raced yet: show last season instead of an empty page.
      onChange({ ...value, year: value.year - 1, round: null });
    }
  }, [races, race, value, onChange]);

  useEffect(() => {
    if (!race || sessions.length === 0 || sessions.includes(value.session)) return;
    onChange({ ...value, session: sessions.includes("R") ? "R" : sessions[0] });
  }, [race, sessions, value, onChange]);

  const empty = races !== null && races.length === 0 && value.year !== new Date().getFullYear();
  const raceDisabled = !races || races.length === 0;

  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-[9rem_minmax(0,1fr)_12rem]", className)}>
      <Select
        label="Season"
        value={value.year}
        onChange={(e) => onChange({ year: Number(e.target.value), round: null, session: value.session })}
      >
        {seasonYears().map((y) => <option key={y} value={y}>{y}</option>)}
      </Select>

      <Select
        label="Race"
        value={value.round ?? ""}
        disabled={raceDisabled}
        onChange={(e) => onChange({ ...value, round: Number(e.target.value) })}
      >
        {!races && <option value="">{seasons.status === "error" ? "Couldn't load races" : "Loading races…"}</option>}
        {races && races.length === 0 && <option value="">No races yet</option>}
        {races?.map((r) => <option key={r.round} value={r.round}>{raceLabel(r)}</option>)}
      </Select>

      {showSession && (
        <Select
          label="Session"
          value={value.session}
          disabled={sessions.length === 0}
          onChange={(e) => onChange({ ...value, session: e.target.value as SessionCode })}
        >
          {sessions.length === 0 && <option value={value.session}>{SESSION_LABELS[value.session]}</option>}
          {sessions.map((s) => <option key={s} value={s}>{SESSION_LABELS[s]}</option>)}
        </Select>
      )}

      {empty && (
        <p className="text-sm text-mute sm:col-span-2 lg:col-span-3">There are no completed races in {value.year} in the data yet. Choose another season.</p>
      )}
      {seasons.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-live-text sm:col-span-2 lg:col-span-3">
          <span>{seasons.message}</span>
          <Button size="sm" variant="secondary" onClick={seasons.retry}>
            <RotateCw aria-hidden className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
