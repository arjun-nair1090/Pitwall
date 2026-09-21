"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { RotateCw, ShieldAlert } from "lucide-react";
import { useF1Store } from "@/store/useTelemetryStore";
import CompoundBadge from "@/components/CompoundBadge";
import Button from "@/components/ui/Button";
import DataTable, { type Column } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import Tabs, { tabPanelProps } from "@/components/ui/Tabs";
import { cn } from "@/lib/cn";

interface UndercutThreat {
  leader: string;
  chaser: string;
  gap: number;
  severity: string;
  reason: string;
}

interface PitWindow {
  driver_code: string;
  team_name: string;
  compound: string;
  tyre_age: number;
  estimated_deg_loss_seconds: number;
  laps_remaining_in_window: string;
  status: string;
}

interface StrategyData {
  undercut_threats: UndercutThreat[];
  pit_windows: Record<string, PitWindow>;
  safety_car_opportunity: {
    active: boolean;
    reason: string;
    recommendation: string;
  };
  weather_warning: {
    rain_risk: string;
    recommendation: string;
  };
}

type Tab = "engineer" | "strategist";
const TABS = [
  { id: "engineer", label: "Race engineer" },
  { id: "strategist", label: "Strategist" },
] as const;

// Pit-window status is a warning scale: critical is danger red, open is caution yellow.
const STATUS_CLASS: Record<string, string> = {
  CRITICAL: "text-live-text",
  OPEN: "text-timing-yellow",
};

const WINDOW_COLUMNS: Column<PitWindow>[] = [
  { key: "driver", header: "Driver", cell: (w) => <span className="font-semibold">{w.driver_code}</span> },
  { key: "tyre", header: "Tyre", cell: (w) => <CompoundBadge compound={w.compound} showLabel /> },
  { key: "age", header: "Age", align: "right", cell: (w) => `${w.tyre_age} laps` },
  { key: "deg", header: "Degradation", align: "right", cell: (w) => `+${w.estimated_deg_loss_seconds}s` },
  {
    key: "status",
    header: "Status",
    cell: (w) => <span className={cn("font-semibold", STATUS_CLASS[w.status] ?? "text-mute")}>{w.status}</span>,
  },
];

export default function AIEngineerConsole() {
  const { activeSession } = useF1Store();
  const [activeTab, setActiveTab] = useState<Tab>("engineer");

  // AI Engineer State
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<Array<{ sender: "user" | "ai"; text: string }>>([
    {
      sender: "ai",
      text: "Copy, pit wall active. Ask me any question about the session telemetry, sector speeds, weather, or driver intervals.",
    },
  ]);
  const [chatLoading, setChatLoading] = useState(false);

  // AI Strategist State
  const [strategyData, setStrategyData] = useState<StrategyData | null>(null);
  const [stratLoading, setStratLoading] = useState(false);

  // Fetch AI Strategy data
  const fetchStrategy = () => {
    if (!activeSession) return;
    setStratLoading(true);
    axios
      .get(`/api/v1/sessions/${activeSession.session_key}/strategy`)
      .then((res) => {
        setStrategyData(res.data);
      })
      .catch((err) => {
        console.error("Failed to load AI strategy", err);
      })
      .finally(() => {
        setStratLoading(false);
      });
  };

  useEffect(() => {
    if (activeTab === "strategist") {
      fetchStrategy();
    }
  }, [activeTab, activeSession]);

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeSession || chatLoading) return;

    const userQuestion = chatInput;
    setChatLog((prev) => [...prev, { sender: "user", text: userQuestion }]);
    setChatInput("");
    setChatLoading(true);

    axios
      .post("/api/v1/ai/chat", {
        session_key: activeSession.session_key,
        question: userQuestion,
      })
      .then((res) => {
        setChatLog((prev) => [...prev, { sender: "ai", text: res.data.response }]);
      })
      .catch((err) => {
        setChatLog((prev) => [
          ...prev,
          {
            sender: "ai",
            text: "Couldn't reach the race engineer. Check that the backend is running and that an AI key (ANTHROPIC_API_KEY or OPENAI_API_KEY) is set.",
          },
        ]);
      })
      .finally(() => {
        setChatLoading(false);
      });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs tabs={TABS} value={activeTab} onChange={(id) => setActiveTab(id as Tab)} idBase="engineer" label="Race engineer views" className="shrink-0 px-2" />

      {activeTab === "engineer" ? (
        <div {...tabPanelProps("engineer", "engineer")} className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <div role="log" aria-live="polite" aria-label="Conversation" className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {chatLog.map((chat, idx) => (
              <div
                key={idx}
                className={cn(
                  "max-w-[85%] rounded-panel px-3 py-2 text-sm leading-relaxed",
                  chat.sender === "user" ? "ml-auto bg-raised text-chalk" : "mr-auto border border-gantry text-chalk",
                )}
              >
                <p className="mb-0.5 text-xs font-medium text-mute">{chat.sender === "user" ? "You" : "Race engineer"}</p>
                <div className="whitespace-pre-wrap">{chat.text}</div>
              </div>
            ))}
            {chatLoading && (
              <p role="status" className="text-xs text-mute">Reading telemetry…</p>
            )}
          </div>

          <form onSubmit={handleSendChat} className="flex shrink-0 gap-2">
            <input
              type="text"
              aria-label="Ask the race engineer"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask the pit wall, e.g. Why is VER losing time?"
              className="h-10 min-w-0 flex-1 rounded-control border border-edge bg-raised px-3 text-sm text-chalk placeholder:text-faint"
            />
            <Button type="submit" variant="primary" disabled={chatLoading || !activeSession}>
              Send
            </Button>
          </form>
          {!activeSession && <p className="shrink-0 text-xs text-faint">The race engineer needs a live session to answer.</p>}
        </div>
      ) : (
        <div {...tabPanelProps("engineer", "strategist")} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-mute">Live pit predictions</h3>
            <Button size="sm" variant="ghost" onClick={fetchStrategy} disabled={!activeSession}>
              <RotateCw aria-hidden className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          {stratLoading ? (
            <p role="status" className="py-8 text-center text-sm text-mute">Running degradation models…</p>
          ) : strategyData ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-panel border border-gantry p-3">
                  <dt className="text-xs text-mute">Safety car opportunity</dt>
                  <dd className="mt-1 font-semibold text-chalk">{strategyData.safety_car_opportunity.recommendation}</dd>
                </div>
                <div className="rounded-panel border border-gantry p-3">
                  <dt className="text-xs text-mute">Rain risk</dt>
                  <dd className="mt-1 font-semibold text-chalk">{strategyData.weather_warning.recommendation}</dd>
                </div>
              </dl>

              {strategyData.undercut_threats.length > 0 && (
                <div className="rounded-panel border border-live/40 p-3 text-live-text">
                  <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                    <ShieldAlert aria-hidden className="h-4 w-4" />
                    Undercut threats
                  </p>
                  <ul className="list-inside list-disc space-y-1 text-sm">
                    {strategyData.undercut_threats.map((threat, idx) => (
                      <li key={idx}>{threat.reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="mb-1 text-xs font-medium text-mute">Tyre life estimates</h3>
                <DataTable
                  caption="Tyre life estimates"
                  columns={WINDOW_COLUMNS}
                  rows={Object.values(strategyData.pit_windows).slice(0, 10)}
                  rowKey={(w) => w.driver_code}
                  dense
                />
              </div>
            </div>
          ) : (
            <EmptyState title="No strategy data yet" description="Predictions appear once a live session is connected." />
          )}
        </div>
      )}
    </div>
  );
}
