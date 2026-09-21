"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { useF1Store, HistoricalRace } from "@/store/useTelemetryStore";
import { Calendar, Users, Trophy, ChevronRight, X, Play, Flag, Timer } from "lucide-react";
import Select from "@/components/ui/Select";
import Tabs from "@/components/ui/Tabs";

interface DriverStanding {
  position: string;
  points: string;
  wins: string;
  Driver: {
    givenName: string;
    familyName: string;
    code: string;
    nationality: string;
  };
  Constructors: Array<{
    name: string;
  }>;
}

interface ConstructorStanding {
  position: string;
  points: string;
  wins: string;
  Constructor: {
    name: string;
    nationality: string;
  };
}

interface RaceEvent {
  round: string;
  raceName: string;
  Circuit: {
    circuitName: string;
    Location: {
      locality: string;
      country: string;
    };
  };
  date: string;
}

interface RaceResult {
  position: string;
  number: string;
  points: string;
  Driver: {
    givenName: string;
    familyName: string;
    code: string;
  };
  Constructor: {
    name: string;
  };
  grid: string;
  laps: string;
  status: string;
  Time?: {
    time: string;
  };
  FastestLap?: {
    Time: { time: string };
    AverageSpeed: { speed: string };
  };
}

export default function HistoricalArchive() {
  const { setHistoricalRace, historicalRace, setReplaySession } = useF1Store();
  const [tab, setTab] = useState<"standings" | "calendar" | "racedetails">("standings");
  
  // Dynamically compute years up to current year (2026)
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [driverStandings, setDriverStandings] = useState<DriverStanding[]>([]);
  const [constructorStandings, setConstructorStandings] = useState<ConstructorStanding[]>([]);
  const [races, setRaces] = useState<RaceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRace, setSelectedRace] = useState<RaceEvent | null>(null);
  const [raceResults, setRaceResults] = useState<RaceResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);

  // Generate years list descending from currentYear down to 2018
  const yearsList = React.useMemo(() => {
    return Array.from({ length: currentYear - 2018 + 1 }, (_, i) => currentYear - i);
  }, [currentYear]);

  // Load standings & calendar
  const loadData = () => {
    setLoading(true);
    // Use the high-availability community Ergast mirror (jolpi.ca) for 2024, 2025, and 2026 seasons
    const standingsUrl = `https://api.jolpi.ca/ergast/f1/${year}/driverStandings.json`;
    const constructorUrl = `https://api.jolpi.ca/ergast/f1/${year}/constructorStandings.json`;
    const calendarUrl = `https://api.jolpi.ca/ergast/f1/${year}.json`;

    Promise.all([
      axios.get(standingsUrl).catch(() => null),
      axios.get(constructorUrl).catch(() => null),
      axios.get(calendarUrl).catch(() => null),
    ])
      .then(([standingsRes, constRes, calRes]) => {
        if (standingsRes?.data?.MRData?.StandingsTable?.StandingsLists?.[0]) {
          setDriverStandings(
            standingsRes.data.MRData.StandingsTable.StandingsLists[0].DriverStandings
          );
        }
        if (constRes?.data?.MRData?.StandingsTable?.StandingsLists?.[0]) {
          setConstructorStandings(
            constRes.data.MRData.StandingsTable.StandingsLists[0].ConstructorStandings
          );
        }
        if (calRes?.data?.MRData?.RaceTable?.Races) {
          const allRaces = calRes.data.MRData.RaceTable.Races;
          const today = new Date().toISOString().split('T')[0];
          const pastRaces = allRaces.filter((r: any) => r.date <= today);
          setRaces(pastRaces);
        }
      })
      .catch((err) => {
        console.error("Failed to load historical data", err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadData();
    setSelectedRace(null);
    if (tab === "racedetails") setTab("calendar");
  }, [year]);

  const loadRaceDetails = (round: string) => {
    setLoadingResults(true);
    axios.get(`https://api.jolpi.ca/ergast/f1/${year}/${round}/results.json`)
      .then(res => {
        if (res.data?.MRData?.RaceTable?.Races?.[0]?.Results) {
          setRaceResults(res.data.MRData.RaceTable.Races[0].Results);
        } else {
          setRaceResults([]);
        }
      })
      .catch(err => {
        console.error("Failed to load race results", err);
        setRaceResults([]);
      })
      .finally(() => {
        setLoadingResults(false);
      });
  };

  return (
    <div className="rounded-panel border border-gantry bg-kerb p-4 h-full flex flex-col justify-between text-sm shadow-lg">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-4 border-b border-live/40 pb-3">
          <h2 className="text-base font-bold text-chalk flex items-center gap-2">
            <Trophy className="h-5 w-5 text-mute" />
            Season Archive
          </h2>
          
          {/* Season Year selector */}
          <Select label="Season" hideLabel value={year} onChange={(e) => setYear(parseInt(e.target.value))}>
            {yearsList.map((y) => (
              <option key={y} value={y}>{y} season</option>
            ))}
          </Select>
        </div>

        <Tabs
          idBase="archive"
          label="Archive views"
          className="mb-4"
          value={tab}
          onChange={(id) => {
            if (id === "calendar") setSelectedRace(null);
            setTab(id as typeof tab);
          }}
          tabs={[
            { id: "standings", label: "Standings" },
            { id: "calendar", label: "Calendar" },
            ...(selectedRace ? [{ id: "racedetails", label: "Race details" }] : []),
          ]}
        />

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-faint font-bold animate-pulse">Loading the archive…</div>
        ) : tab === "standings" ? (
          /* Standings View */
          <div className="flex-1 grid grid-cols-2 gap-6 overflow-y-auto custom-scrollbar pr-2 pb-4">
            {/* Drivers Standings */}
            <div>
              <div className="text-xs text-live-text mb-2 font-bold border-b border-live/40 pb-1">Drivers</div>
              <ul className="space-y-1">
                {driverStandings.map((st) => (
                  <li key={st.Driver.code || st.Driver.familyName} className="flex justify-between border-b border-gantry py-1.5 hover:bg-raised px-2 transition-colors">
                    <span className="font-semibold">
                      <span className="text-faint inline-block w-6">{st.position}</span>
                      {st.Driver.givenName[0]}. {st.Driver.familyName} <span className="text-faint ml-1 text-xs">({st.Driver.code || st.Driver.nationality})</span>
                    </span>
                    <span className="font-bold text-chalk">{st.points} <span className="text-faint text-xs">PTS</span></span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Constructors Standings */}
            <div>
              <div className="text-xs text-live-text mb-2 font-bold border-b border-live/40 pb-1">Constructors</div>
              <ul className="space-y-1">
                {constructorStandings.map((st) => (
                  <li key={st.Constructor.name} className="flex justify-between border-b border-gantry py-1.5 hover:bg-raised px-2 transition-colors">
                    <span className="font-semibold">
                      <span className="text-faint inline-block w-6">{st.position}</span>
                      {st.Constructor.name}
                    </span>
                    <span className="font-bold text-chalk">{st.points} <span className="text-faint text-xs">PTS</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : tab === "racedetails" && selectedRace ? (
          /* Race Details View */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="bg-gradient-to-r to-transparent border-l-4 border-live/40 p-3 mb-4 rounded-r">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-lg text-chalk">{selectedRace.raceName}</h3>
                  <p className="text-sm text-mute">
                    {selectedRace.Circuit.circuitName} — {selectedRace.Circuit.Location.locality}, {selectedRace.Circuit.Location.country}
                  </p>
                  <p className="text-xs text-faint mt-1">{selectedRace.date}</p>
                </div>
                <button
                  onClick={() => setReplaySession({ year, gp: selectedRace.Circuit.Location.locality })}
                  className="bg-chalk text-tarmac hover:bg-white hover:bg-live/90 px-4 py-2 rounded-control font-bold flex items-center gap-2 transition-colors shadow-[0_0_15px_rgba(225,6,0,0.4)]"
                >
                  <Play className="h-4 w-4 fill-current" />
                  REPLAY TELEMETRY
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
              <h4 className="text-xs text-chalk font-bold mb-2 border-b border-gantry pb-1">Race classification</h4>
              {loadingResults ? (
                <div className="py-8 text-center text-faint animate-pulse font-bold">Loading results…</div>
              ) : raceResults.length === 0 ? (
                <div className="py-8 text-center text-faint">No results for this round yet</div>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="sticky top-0 bg-kerb backdrop-blur z-10 text-faint text-xs">
                    <tr>
                      <th className="py-2 px-2 font-bold">POS</th>
                      <th className="py-2 px-2 font-bold">NO</th>
                      <th className="py-2 px-2 font-bold">Driver</th>
                      <th className="py-2 px-2 font-bold">CAR</th>
                      <th className="py-2 px-2 font-bold">LAPS</th>
                      <th className="py-2 px-2 font-bold">Time or status</th>
                      <th className="py-2 px-2 font-bold">PTS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {raceResults.map(res => (
                      <tr key={res.number} className="border-b border-gantry hover:bg-raised transition-colors">
                        <td className="py-2.5 px-2 font-bold">{res.position}</td>
                        <td className="py-2.5 px-2 text-faint">{res.number}</td>
                        <td className="py-2.5 px-2 font-bold">
                          {res.Driver.givenName} {res.Driver.familyName.toUpperCase()}
                        </td>
                        <td className="py-2.5 px-2 text-mute">{res.Constructor.name}</td>
                        <td className="py-2.5 px-2 text-mute">{res.laps}</td>
                        <td className="py-2.5 px-2 font-medium">
                          {res.Time?.time || res.status}
                        </td>
                        <td className="py-2.5 px-2 font-bold text-timing-yellow">{res.points !== "0" ? res.points : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          /* Calendar View */
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
            {races.map((r) => (
              <div
                key={r.round}
                onClick={() => {
                  const historicalRaceData: HistoricalRace = {
                    year,
                    round: r.round,
                    raceName: r.raceName,
                    circuitName: r.Circuit.circuitName,
                    locality: r.Circuit.Location.locality,
                    country: r.Circuit.Location.country,
                    date: r.date,
                  };
                  setHistoricalRace(historicalRaceData);
                  setSelectedRace(r);
                  setTab("racedetails");
                  loadRaceDetails(r.round);
                }}
                className="bg-raised border border-gantry rounded-control p-3 hover:bg-raised hover:border-live/40 cursor-pointer flex justify-between items-center transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-kerb border border-gantry px-3 py-2 rounded-control text-center min-w-[60px]">
                    <div className="text-[10px] text-faint font-bold">RND</div>
                    <div className="font-bold text-lg text-chalk">{r.round}</div>
                  </div>
                  <div>
                    <h3 className="font-bold text-chalk text-base group-hover:text-chalk transition-colors">{r.raceName}</h3>
                    <p className="text-sm text-faint">{r.Circuit.circuitName}, {r.Circuit.Location.country}</p>
                    <p className="text-xs text-faint mt-1 flex items-center gap-1"><Calendar className="h-3 w-3"/> {r.date}</p>
                  </div>
                </div>
                <div className="text-right flex items-center gap-2">
                  <span className="text-xs font-bold bg-chalk text-tarmac hover:bg-white px-2 py-1 rounded-control opacity-0 group-hover:opacity-100 transition-opacity">
                    DETAILS
                  </span>
                  <ChevronRight className="h-5 w-5 text-faint group-hover:text-chalk transition-colors" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
