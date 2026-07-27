"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";
import { Calendar, Users, Trophy, Search } from "lucide-react";

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

export default function HistoricalArchive() {
  const { setActiveSession } = useF1Store();
  const [tab, setTab] = useState<"standings" | "calendar" | "search">("standings");
  
  // Dynamically compute years up to current year (2026)
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [driverStandings, setDriverStandings] = useState<DriverStanding[]>([]);
  const [constructorStandings, setConstructorStandings] = useState<ConstructorStanding[]>([]);
  const [races, setRaces] = useState<RaceEvent[]>([]);
  const [loading, setLoading] = useState(false);

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
          setRaces(calRes.data.MRData.RaceTable.Races);
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
  }, [year]);

  return (
    <div className="glass-panel rounded-lg p-4 h-full flex flex-col justify-between border border-white/5 bg-black/20 text-xs font-mono-f1">
      <div>
        <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
          <h2 className="text-sm font-semibold tracking-wider text-f1-cyan uppercase flex items-center gap-2">
            <Trophy className="h-4 w-4" />
            Season Archive & Standings
          </h2>
          
          {/* Season Year selector */}
          <select
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            className="bg-black border border-white/15 text-white p-1 rounded focus:outline-none"
          >
            {yearsList.map((y) => (
              <option key={y} value={y}>{y} SEASON</option>
            ))}
          </select>
        </div>

        {/* Sub-tabs */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setTab("standings")}
            className={`px-3 py-1 rounded border transition-colors ${
              tab === "standings"
                ? "bg-f1-cyan text-black border-f1-cyan"
                : "border-white/10 text-white/50 hover:text-white"
            }`}
          >
            STANDINGS
          </button>
          <button
            onClick={() => setTab("calendar")}
            className={`px-3 py-1 rounded border transition-colors ${
              tab === "calendar"
                ? "bg-f1-cyan text-black border-f1-cyan"
                : "border-white/10 text-white/50 hover:text-white"
            }`}
          >
            CALENDAR
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-white/40">QUERYING ERGAST ARCHIVE...</div>
        ) : tab === "standings" ? (
          /* Standings View */
          <div className="grid grid-cols-2 gap-4 max-h-[220px] overflow-y-auto">
            {/* Drivers Standings */}
            <div>
              <div className="text-[9px] text-white/40 uppercase mb-1.5 font-bold">DRIVERS</div>
              <ul className="space-y-1">
                {driverStandings.slice(0, 10).map((st) => (
                  <li key={st.Driver.code} className="flex justify-between border-b border-white/5 pb-1">
                    <span>
                      {st.position}. {st.Driver.givenName[0]}. {st.Driver.familyName} ({st.Driver.code})
                    </span>
                    <span className="font-bold text-white">{st.points} PTS</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Constructors Standings */}
            <div>
              <div className="text-[9px] text-white/40 uppercase mb-1.5 font-bold">CONSTRUCTORS</div>
              <ul className="space-y-1">
                {constructorStandings.slice(0, 10).map((st) => (
                  <li key={st.Constructor.name} className="flex justify-between border-b border-white/5 pb-1">
                    <span>
                      {st.position}. {st.Constructor.name}
                    </span>
                    <span className="font-bold text-white">{st.points} PTS</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          /* Calendar View */
          <div className="max-h-[220px] overflow-y-auto space-y-1">
            {races.map((r) => (
              <div
                key={r.round}
                onClick={() => {
                  // Connect dashboard to this historical event key mapping
                  // We simulate a session key for historical replay
                  setActiveSession({
                    session_key: 9500 + parseInt(r.round), // Simulated mapping
                    year: year,
                    location: r.Circuit.Location.locality,
                    country: r.Circuit.Location.country,
                    circuit_name: r.Circuit.circuitName,
                    circuit_short_name: r.raceName.replace("Grand Prix", "GP"),
                    session_name: "Race",
                    date_start: new Date(r.date),
                    date_end: new Date(r.date),
                  });
                }}
                className="bg-white/5 border border-white/5 rounded p-2 hover:bg-white/10 cursor-pointer flex justify-between items-center transition-colors"
              >
                <div>
                  <span className="font-bold text-white">RND {r.round}: {r.raceName}</span>
                  <p className="text-[10px] text-white/40 mt-0.5">{r.Circuit.circuitName}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/70">
                    LOAD
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
