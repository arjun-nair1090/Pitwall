"use client";

import { useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Select from "@/components/ui/Select";
import Tabs, { tabPanelProps } from "@/components/ui/Tabs";
import { seasonYears, type CalendarRace } from "@/lib/season";
import CalendarView from "./CalendarView";
import RaceDetail from "./RaceDetail";
import StandingsView from "./StandingsView";

type OpenRace = CalendarRace & { round: number };
const TABS = [
  { id: "standings", label: "Standings" },
  { id: "calendar", label: "Calendar" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// Standings, the race calendar and each race's classification for any season since 2018. Everything
// comes from our own API, so a failure is reported here instead of leaving an empty list.
export default function SeasonArchive({ initialYear }: { initialYear?: number }) {
  const [year, setYear] = useState(initialYear ?? new Date().getFullYear());
  const [tab, setTab] = useState<TabId>("standings");
  const [race, setRace] = useState<OpenRace | null>(null);

  const changeYear = (next: number) => {
    setYear(next);
    setRace(null); // a race belongs to its season
  };

  return (
    <>
      <PageHeader
        title="Archive"
        description="Standings, calendars and race results for every season since 2018."
        actions={
          <Select label="Season" value={year} onChange={(e) => changeYear(Number(e.target.value))} className="w-40">
            {seasonYears().map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
        }
      />
      <Tabs
        idBase="archive"
        label="Archive views"
        className="mb-4"
        value={tab}
        onChange={(id) => {
          setTab(id as TabId);
          setRace(null);
        }}
        tabs={TABS}
      />
      <div {...tabPanelProps("archive", tab)}>
        {tab === "standings" ? (
          <StandingsView year={year} />
        ) : race ? (
          <RaceDetail year={year} race={race} onBack={() => setRace(null)} />
        ) : (
          <CalendarView year={year} onOpen={setRace} />
        )}
      </div>
    </>
  );
}
