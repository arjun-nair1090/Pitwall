"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";
import { Radio, Flag, Megaphone } from "lucide-react";

interface RadioPacket {
  driver_number: number;
  timestamp: string;
  recording_url: string;
}

export default function TeamRadioConsole() {
  const { activeSession, raceControl, drivers } = useF1Store();
  const [radios, setRadios] = useState<RadioPacket[]>([]);
  const [loadingRadios, setLoadingRadios] = useState(false);

  const driversMap = React.useMemo(() => {
    return new Map(drivers.map((d) => [d.driver_number, d]));
  }, [drivers]);

  // Load team radios
  const fetchRadios = () => {
    if (!activeSession) return;
    setLoadingRadios(true);
    axios
      .get(`/api/v1/sessions/${activeSession.session_key}/radios`)
      .then((res) => {
        setRadios(res.data);
      })
      .catch((err) => {
        console.error("Failed to load team radios", err);
      })
      .finally(() => {
        setLoadingRadios(false);
      });
  };

  useEffect(() => {
    if (activeSession) {
      fetchRadios();
      // Poll every 30 seconds for new radio packets
      const interval = setInterval(fetchRadios, 30000);
      return () => clearInterval(interval);
    }
  }, [activeSession]);

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      {/* Race Control Panel */}
      <div className="glass-panel rounded-lg p-4 flex flex-col h-full overflow-hidden border border-white/5 bg-black/25">
        <h2 className="text-sm font-semibold tracking-wider text-f1-yellow uppercase flex items-center gap-2 mb-3">
          <Megaphone className="h-4 w-4 text-f1-yellow" />
          Race Control Ticker
        </h2>
        <div className="flex-1 overflow-y-auto space-y-2 max-h-[220px] pr-1">
          {raceControl.length > 0 ? (
            raceControl.map((msg, idx) => {
              // Custom flag tag rendering
              let flagColor = "border-white/10 text-white/50";
              if (msg.flag === "RED") flagColor = "bg-f1-red/10 border-f1-red/45 text-f1-red";
              if (msg.flag === "YELLOW") flagColor = "bg-f1-yellow/10 border-f1-yellow/45 text-f1-yellow";
              if (msg.flag === "GREEN") flagColor = "bg-f1-green/10 border-f1-green/45 text-f1-green";

              return (
                <div
                  key={idx}
                  className="bg-white/5 border border-white/5 rounded p-2 text-xs font-mono-f1"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[9px] text-white/35">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    {msg.flag && (
                      <span className={`text-[8px] px-1.5 py-0.5 border rounded font-bold ${flagColor}`}>
                        {msg.flag} FLAG
                      </span>
                    )}
                  </div>
                  <p className="text-white/85 leading-relaxed">{msg.message}</p>
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-white/20 text-xs font-mono-f1">
              NO INCIDENTS LOGGED FOR ACTIVE SESSION.
            </div>
          )}
        </div>
      </div>

      {/* Team Radio Panel */}
      <div className="glass-panel rounded-lg p-4 flex flex-col h-full overflow-hidden border border-white/5 bg-black/25">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-wider text-f1-red uppercase flex items-center gap-2">
            <Radio className="h-4 w-4 text-f1-red" />
            Team Radio Audio Feed
          </h2>
          <button
            onClick={fetchRadios}
            className="text-[9px] text-white/40 hover:text-white/85 hover:underline font-mono-f1"
          >
            REFRESH
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 max-h-[220px] pr-1">
          {loadingRadios ? (
            <div className="text-center py-8 text-white/30 text-xs font-mono-f1">
              POLLING RADIO RECORDS...
            </div>
          ) : radios.length > 0 ? (
            radios.map((pkt, idx) => {
              const driver = driversMap.get(pkt.driver_number);
              return (
                <div
                  key={idx}
                  className="bg-white/5 border border-white/5 rounded p-2.5 flex items-center justify-between font-mono-f1 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-1 h-3"
                      style={{ backgroundColor: driver?.team_color || "#7f7f7f" }}
                    />
                    <div>
                      <span className="font-bold text-white">
                        {driver?.code || `#${pkt.driver_number}`}
                      </span>
                      <p className="text-[9px] text-white/40 mt-0.5">
                        {new Date(pkt.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                  {pkt.recording_url ? (
                    <audio
                      src={pkt.recording_url}
                      controls
                      className="h-6 w-36 opacity-75 hover:opacity-100 transition-opacity"
                    />
                  ) : (
                    <span className="text-[9px] text-white/30">NO STREAM AVAILABLE</span>
                  )}
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-white/20 text-xs font-mono-f1">
              NO TEAM RADIO PACKETS TRANSLATED IN THIS SPLIT.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
