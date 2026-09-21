"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { RotateCw } from "lucide-react";
import { useF1Store } from "@/store/useTelemetryStore";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Pill from "@/components/ui/Pill";

interface RadioPacket {
  driver_number: number;
  timestamp: string;
  recording_url: string;
}

const FLAG_TONE = { RED: "live", YELLOW: "yellow" } as const;
const flagTone = (flag: string) => FLAG_TONE[flag as keyof typeof FLAG_TONE] ?? "neutral";

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
    <div className="grid h-full min-h-0 grid-cols-1 divide-gantry md:grid-cols-2 md:divide-x">
      <section aria-labelledby="race-control-heading" className="flex min-h-0 flex-col p-3">
        <h3 id="race-control-heading" className="mb-2 shrink-0 text-xs font-medium text-mute">Race control</h3>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {raceControl.length > 0 ? (
            raceControl.map((msg, idx) => (
              <div key={idx} className="rounded-control border border-gantry p-2 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs tabular-nums text-faint">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  {msg.flag && <Pill tone={flagTone(msg.flag)}>{msg.flag.charAt(0) + msg.flag.slice(1).toLowerCase()} flag</Pill>}
                </div>
                <p className="leading-relaxed text-chalk">{msg.message}</p>
              </div>
            ))
          ) : (
            <EmptyState title="No incidents logged" description="Flags, penalties and investigations appear here." />
          )}
        </div>
      </section>

      <section aria-labelledby="team-radio-heading" className="flex min-h-0 flex-col p-3">
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h3 id="team-radio-heading" className="text-xs font-medium text-mute">Team radio</h3>
          <Button size="sm" variant="ghost" onClick={fetchRadios} disabled={!activeSession}>
            <RotateCw aria-hidden className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {loadingRadios ? (
            <p role="status" className="py-8 text-center text-sm text-mute">Loading radio messages…</p>
          ) : radios.length > 0 ? (
            radios.map((pkt, idx) => {
              const driver = driversMap.get(pkt.driver_number);
              const code = driver?.code || `#${pkt.driver_number}`;
              return (
                <div key={idx} className="flex items-center justify-between gap-3 rounded-control border border-gantry p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="h-6 w-1 rounded-sm" style={{ backgroundColor: driver?.team_color || "#8790A0" }} />
                    <div>
                      <span className="font-semibold text-chalk">{code}</span>
                      <p className="text-xs tabular-nums text-faint">{new Date(pkt.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  {pkt.recording_url ? (
                    <audio src={pkt.recording_url} controls aria-label={`Team radio from ${code}`} className="h-8 w-40" />
                  ) : (
                    <span className="text-xs text-faint">No audio available</span>
                  )}
                </div>
              );
            })
          ) : (
            <EmptyState title="No team radio yet" description="Driver radio messages appear here during a session." />
          )}
        </div>
      </section>
    </div>
  );
}
