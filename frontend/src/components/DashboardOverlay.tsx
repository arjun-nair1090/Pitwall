"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";
import LiveTiming from "./LiveTiming";
import TrackMap from "./TrackMap";
import TelemetryConsole from "./TelemetryConsole";
import AIEngineerConsole from "./AIEngineerConsole";
import TeamRadioConsole from "./TeamRadioConsole";
import TelemetryComparison from "./TelemetryComparison";
import HistoricalArchive from "./HistoricalArchive";

// Configure default base URL for Axios to communicate with backend
axios.defaults.baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function DashboardOverlay() {
  const {
    activeSession,
    setActiveSession,
    setDrivers,
    updateLeaderboard,
    setWeather,
    setRaceControlMessages,
    addRaceControlMessage,
    updateTelemetryPoint,
    isConnected,
    setIsConnected,
    weather,
  } = useF1Store();

  const [ws, setWs] = useState<WebSocket | null>(null);
  const [leftTab, setLeftTab] = useState<"timing" | "archive">("timing");

  // Initial Rest sync
  useEffect(() => {
    // 1. Fetch active session metadata
    axios
      .get("/api/v1/sessions/active")
      .then((res) => {
        const sess = res.data;
        setActiveSession(sess);

        // 2. Fetch session drivers
        axios.get(`/api/v1/sessions/${sess.session_key}/drivers`).then((resD) => {
          setDrivers(resD.data);
        });

        // 3. Fetch timing boards
        axios.get(`/api/v1/sessions/${sess.session_key}/timing`).then((resT) => {
          updateLeaderboard(resT.data);
        });

        // 4. Fetch weather conditions
        axios.get(`/api/v1/sessions/${sess.session_key}/weather`).then((resW) => {
          setWeather(resW.data);
        });

        // 5. Fetch race control feed
        axios.get(`/api/v1/sessions/${sess.session_key}/race-control`).then((resR) => {
          setRaceControlMessages(resR.data);
        });
      })
      .catch((err) => {
        console.error("Initialization sync failed", err);
      });
  }, []);

  // Connect WebSockets
  useEffect(() => {
    if (!activeSession) return;

    // Use NEXT_PUBLIC_API_URL if configured, otherwise fallback to window locations
    const apiHost = process.env.NEXT_PUBLIC_API_URL 
      ? process.env.NEXT_PUBLIC_API_URL.replace("http://", "").replace("https://", "")
      : (window.location.hostname === "localhost" ? "localhost:8000" : window.location.host);
    const wsUrl = `ws://${apiHost}/ws/pitwall-client-${Math.random().toString(36).substring(2, 6)}`;
    
    console.log(`Connecting to F1 WebSocket gateway: ${wsUrl}`);
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("WebSocket connection established");
      setIsConnected(true);
    };

    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        // Dispatch live packets
        if (frame.driver_number !== undefined) {
          // Telemetry packet containing speed, throttle, x, y, z
          updateTelemetryPoint(frame);
        } else if (frame.message !== undefined) {
          // Race Control / Flags packet
          addRaceControlMessage(frame);
        } else if (frame.air_temperature !== undefined) {
          // Weather packet
          setWeather(frame);
        }
      } catch (err) {
        // Echo logs
        console.log("WebSocket frame message", event.data);
      }
    };

    socket.onclose = () => {
      console.log("WebSocket connection lost");
      setIsConnected(false);
    };

    setWs(socket);

    return () => {
      socket.close();
    };
  }, [activeSession]);

  return (
    <div className="min-h-screen bg-carbon p-4 flex flex-col justify-between select-text text-white">
      {/* Top Navigation Headers */}
      <header className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-widest text-white uppercase flex items-center gap-2">
            <span className="text-f1-red">F1</span> PIT WALL
          </h1>
          <span className="text-[10px] bg-f1-red text-white font-bold px-1.5 py-0.5 rounded font-mono-f1 uppercase">
            RACE CONTROLLER
          </span>
          <span className="text-[10px] text-white/50 font-mono-f1">
            {activeSession ? `${activeSession.year} ${activeSession.circuit_short_name} - ${activeSession.session_name}` : "SYNCING SESSIONS..."}
          </span>
        </div>

        {/* Live status indicators */}
        <div className="flex items-center gap-4 text-xs font-mono-f1">
          {weather && (
            <div className="flex items-center gap-3 text-white/60 text-[11px] border-r border-white/10 pr-4">
              <span>AIR: {weather.air_temperature}°C</span>
              <span>TRACK: {weather.track_temperature}°C</span>
              <span>RAIN: {weather.rainfall === 1 ? "WET" : "DRY"}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isConnected ? "bg-f1-green animate-pulse" : "bg-f1-red animate-status-blink"
              }`}
            />
            <span className="uppercase text-[11px]">
              {isConnected ? "TELEMETRY LINK STABLE" : "TELEMETRY DISCONNECTED"}
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid Dashboards */}
      <main className="flex-1 grid grid-cols-12 gap-4">
        {/* Left Side Timing Boards (3 cols) */}
        <div className="col-span-12 xl:col-span-4 flex flex-col gap-4">
          <div className="flex bg-white/5 border border-white/10 rounded overflow-hidden p-0.5">
            <button
              onClick={() => setLeftTab("timing")}
              className={`flex-1 py-1.5 text-xs font-bold uppercase transition-colors rounded-sm ${
                leftTab === "timing" ? "bg-f1-red text-white" : "text-white/40 hover:text-white"
              }`}
            >
              Live Monitor
            </button>
            <button
              onClick={() => setLeftTab("archive")}
              className={`flex-1 py-1.5 text-xs font-bold uppercase transition-colors rounded-sm ${
                leftTab === "archive" ? "bg-f1-red text-white" : "text-white/40 hover:text-white"
              }`}
            >
              Season Archives
            </button>
          </div>
          <div className="flex-1">
            {leftTab === "timing" ? <LiveTiming /> : <HistoricalArchive />}
          </div>
        </div>

        {/* Center Visualizers & Overlays (5 cols) */}
        <div className="col-span-12 xl:col-span-5 flex flex-col gap-4">
          <div className="h-[280px]">
            <TrackMap />
          </div>
          <div className="flex-1">
            <TelemetryComparison />
          </div>
        </div>

        {/* Right Columns: AI & Radios (3 cols) */}
        <div className="col-span-12 xl:col-span-3 flex flex-col gap-4">
          <div className="h-[170px]">
            <TelemetryConsole />
          </div>
          <div className="flex-1">
            <AIEngineerConsole />
          </div>
        </div>
      </main>

      {/* Bottom Footer Incident feeds */}
      <footer className="mt-4 pt-3 border-t border-white/10">
        <TeamRadioConsole />
      </footer>
    </div>
  );
}
