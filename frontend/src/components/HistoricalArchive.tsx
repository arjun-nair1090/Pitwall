"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { useF1Store, HistoricalRace } from "@/store/useTelemetryStore";
import { Calendar, Users, Trophy, ChevronRight, X, Play, Flag, Timer } from "lucide-react";

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
    <div className="glass-panel rounded-lg p-4 h-full flex flex-col justify-between border border-white/5 bg-black/40 text-sm font-titillium tracking-wide shadow-lg">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-4 border-b border-f1-red/30 pb-3">
          <h2 className="text-base font-bold tracking-widest text-white uppercase flex items-center gap-2">
            <Trophy className="h-5 w-5 text-f1-yellow" />
            Season Archive
          </h2>
          
          {/* Season Year selector */}
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="bg-black border border-white/20 text-white px-2 py-1 rounded font-bold focus:outline-none focus:border-f1-red"
          >
            {yearsList.map((y) => (
              <option key={y} value={y}>{y} SEASON</option>
            ))}
          </select>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab("standings")}
            className={`px-4 py-1.5 rounded-sm font-bold transition-colors ${
              tab === "standings"
                ? "bg-f1-red text-white"
                : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            STANDINGS
          </button>
          <button
            onClick={() => {
              setTab("calendar");
              setSelectedRace(null);
            }}
            className={`px-4 py-1.5 rounded-sm font-bold transition-colors ${
              tab === "calendar"
                ? "bg-f1-red text-white"
                : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            CALENDAR
          </button>
          {selectedRace && (
            <button
              onClick={() => setTab("racedetails")}
              className={`px-4 py-1.5 rounded-sm font-bold transition-colors flex items-center gap-1 ${
                tab === "racedetails"
                  ? "bg-f1-red text-white"
                  : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Flag className="h-4 w-4" /> RACE DETAILS
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-white/40 font-bold animate-pulse">QUERYING ERGAST ARCHIVE...</div>
        ) : tab === "standings" ? (
          /* Standings View */
          <div className="flex-1 grid grid-cols-2 gap-6 overflow-y-auto custom-scrollbar pr-2 pb-4">
            {/* Drivers Standings */}
            <div>
              <div className="text-xs text-f1-red uppercase mb-2 font-bold tracking-widest border-b border-f1-red/20 pb-1">DRIVERS</div>
              <ul className="space-y-1">
                {driverStandings.map((st) => (
                  <li key={st.Driver.code || st.Driver.familyName} className="flex justify-between border-b border-white/5 py-1.5 hover:bg-white/5 px-2 transition-colors">
                    <span className="font-semibold">
                      <span className="text-white/50 inline-block w-6">{st.position}</span>
                      {st.Driver.givenName[0]}. {st.Driver.familyName} <span className="text-white/40 ml-1 text-xs">({st.Driver.code || st.Driver.nationality})</span>
                    </span>
                    <span className="font-bold text-white">{st.points} <span className="text-white/40 text-xs">PTS</span></span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Constructors Standings */}
            <div>
              <div className="text-xs text-f1-red uppercase mb-2 font-bold tracking-widest border-b border-f1-red/20 pb-1">CONSTRUCTORS</div>
              <ul className="space-y-1">
                {constructorStandings.map((st) => (
                  <li key={st.Constructor.name} className="flex justify-between border-b border-white/5 py-1.5 hover:bg-white/5 px-2 transition-colors">
                    <span className="font-semibold">
                      <span className="text-white/50 inline-block w-6">{st.position}</span>
                      {st.Constructor.name}
                    </span>
                    <span className="font-bold text-white">{st.points} <span className="text-white/40 text-xs">PTS</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : tab === "racedetails" && selectedRace ? (
          /* Race Details View */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="bg-gradient-to-r from-f1-red/20 to-transparent border-l-4 border-f1-red p-3 mb-4 rounded-r">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-lg text-white">{selectedRace.raceName}</h3>
                  <p className="text-sm text-white/70">
                    {selectedRace.Circuit.circuitName} — {selectedRace.Circuit.Location.locality}, {selectedRace.Circuit.Location.country}
                  </p>
                  <p className="text-xs text-white/50 mt-1">{selectedRace.date}</p>
                </div>
                <button
                  onClick={() => setReplaySession({ year, gp: selectedRace.Circuit.Location.locality })}
                  className="bg-f1-red hover:bg-red-700 text-white px-4 py-2 rounded font-bold flex items-center gap-2 transition-colors shadow-[0_0_15px_rgba(225,6,0,0.4)]"
                >
                  <Play className="h-4 w-4 fill-current" />
                  REPLAY TELEMETRY
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
              <h4 className="text-xs text-f1-red font-bold tracking-widest mb-2 border-b border-white/10 pb-1">RACE CLASSIFICATION</h4>
              {loadingResults ? (
                <div className="py-8 text-center text-white/40 animate-pulse font-bold">LOADING RESULTS...</div>
              ) : raceResults.length === 0 ? (
                <div className="py-8 text-center text-white/40">NO RESULTS AVAILABLE FOR THIS ROUND YET</div>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead className="sticky top-0 bg-black/90 backdrop-blur z-10 text-white/40 text-xs">
                    <tr>
                      <th className="py-2 px-2 font-bold">POS</th>
                      <th className="py-2 px-2 font-bold">NO</th>
                      <th className="py-2 px-2 font-bold">DRIVER</th>
                      <th className="py-2 px-2 font-bold">CAR</th>
                      <th className="py-2 px-2 font-bold">LAPS</th>
                      <th className="py-2 px-2 font-bold">TIME/RETIRED</th>
                      <th className="py-2 px-2 font-bold">PTS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {raceResults.map(res => (
                      <tr key={res.number} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-2.5 px-2 font-bold">{res.position}</td>
                        <td className="py-2.5 px-2 text-white/50">{res.number}</td>
                        <td className="py-2.5 px-2 font-bold">
                          {res.Driver.givenName} {res.Driver.familyName.toUpperCase()}
                        </td>
                        <td className="py-2.5 px-2 text-white/70">{res.Constructor.name}</td>
                        <td className="py-2.5 px-2 text-white/70">{res.laps}</td>
                        <td className="py-2.5 px-2 font-medium">
                          {res.Time?.time || res.status}
                        </td>
                        <td className="py-2.5 px-2 font-bold text-f1-yellow">{res.points !== "0" ? res.points : ""}</td>
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
                className="bg-white/5 border border-white/10 rounded p-3 hover:bg-white/10 hover:border-f1-red/50 cursor-pointer flex justify-between items-center transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-black/50 border border-white/10 px-3 py-2 rounded text-center min-w-[60px]">
                    <div className="text-[10px] text-white/50 font-bold tracking-widest">RND</div>
                    <div className="font-bold text-lg text-white">{r.round}</div>
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base group-hover:text-f1-red transition-colors">{r.raceName}</h3>
                    <p className="text-sm text-white/50">{r.Circuit.circuitName}, {r.Circuit.Location.country}</p>
                    <p className="text-xs text-white/30 mt-1 flex items-center gap-1"><Calendar className="h-3 w-3"/> {r.date}</p>
                  </div>
                </div>
                <div className="text-right flex items-center gap-2">
                  <span className="text-xs font-bold bg-f1-red text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    DETAILS
                  </span>
                  <ChevronRight className="h-5 w-5 text-white/30 group-hover:text-white transition-colors" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
