"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { useF1Store } from "@/store/useTelemetryStore";
import { Brain, ShieldAlert, Zap } from "lucide-react";

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

export default function AIEngineerConsole() {
  const { activeSession } = useF1Store();
  const [activeTab, setActiveTab] = useState<"engineer" | "strategist">("engineer");
  
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
            text: "Error: Unable to connect to Race Engineering context. Please verify OpenAI API key settings.",
          },
        ]);
      })
      .finally(() => {
        setChatLoading(false);
      });
  };

  return (
    <div className="glass-panel rounded-lg flex flex-col h-full overflow-hidden border border-white/5 bg-black/30">
      {/* Tabs Headers */}
      <div className="flex border-b border-white/10 bg-white/5">
        <button
          onClick={() => setActiveTab("engineer")}
          className={`flex-1 py-2.5 text-xs font-semibold tracking-wider uppercase flex items-center justify-center gap-2 transition-colors border-r border-white/5 ${
            activeTab === "engineer"
              ? "text-f1-cyan bg-black/40 border-b-2 border-b-f1-cyan"
              : "text-white/40 hover:text-white/80"
          }`}
        >
          <Brain className="h-3.5 w-3.5" />
          AI Race Engineer
        </button>
        <button
          onClick={() => setActiveTab("strategist")}
          className={`flex-1 py-2.5 text-xs font-semibold tracking-wider uppercase flex items-center justify-center gap-2 transition-colors ${
            activeTab === "strategist"
              ? "text-f1-red bg-black/40 border-b-2 border-b-f1-red"
              : "text-white/40 hover:text-white/80"
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          AI Strategist
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-auto p-4 flex flex-col justify-between">
        {activeTab === "engineer" ? (
          /* Tab: AI Engineer Chat */
          <div className="flex flex-col h-full justify-between">
            <div className="flex-1 overflow-y-auto space-y-3 mb-4 max-h-[300px]">
              {chatLog.map((chat, idx) => (
                <div
                  key={idx}
                  className={`text-xs p-2.5 rounded-lg max-w-[85%] leading-relaxed ${
                    chat.sender === "user"
                      ? "ml-auto bg-f1-cyan/15 text-f1-cyan border border-f1-cyan/20"
                      : "mr-auto bg-white/5 text-white/95 border border-white/5"
                  }`}
                >
                  <p className="font-bold text-[9px] uppercase tracking-wider mb-0.5 text-white/50">
                    {chat.sender === "user" ? "RACE ENGINEERING" : "CO-DRIVERS / ENGINE ROOM"}
                  </p>
                  <div className="whitespace-pre-wrap font-mono-f1">{chat.text}</div>
                </div>
              ))}
              {chatLoading && (
                <div className="text-[10px] text-f1-cyan font-mono-f1 animate-pulse">
                  INGESTING TELEMETRY & PROCESSING INFERENCE CLUSTER...
                </div>
              )}
            </div>

            <form onSubmit={handleSendChat} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask pit wall: e.g. Why is VER losing time?"
                className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-f1-cyan font-mono-f1"
              />
              <button
                type="submit"
                disabled={chatLoading}
                className="bg-f1-cyan hover:bg-f1-cyan/80 text-black text-xs font-bold px-4 py-2 rounded transition-colors uppercase disabled:opacity-50"
              >
                ASK
              </button>
            </form>
          </div>
        ) : (
          /* Tab: AI Strategist */
          <div className="space-y-4 text-xs font-mono-f1 h-full overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-white/10">
              <span className="text-[10px] text-white/40 uppercase">LIVE PIT PREDICTIONS</span>
              <button
                onClick={fetchStrategy}
                className="text-[10px] text-f1-red hover:underline uppercase"
              >
                REFRESH LOGS
              </button>
            </div>

            {stratLoading ? (
              <div className="animate-pulse text-center py-8 text-white/40">
                RUNNING DEGRADATION MODELS...
              </div>
            ) : strategyData ? (
              <div className="space-y-4">
                {/* Safety Car / Weather Alerts */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 p-2 rounded border border-white/5">
                    <div className="text-[9px] text-white/40 uppercase">SAFETY CAR OPPS</div>
                    <div className="font-bold mt-1 text-white/95">
                      {strategyData.safety_car_opportunity.recommendation}
                    </div>
                  </div>
                  <div className="bg-white/5 p-2 rounded border border-white/5">
                    <div className="text-[9px] text-white/40 uppercase">RAIN DEVIATION RISK</div>
                    <div className="font-bold mt-1 text-white/95">
                      {strategyData.weather_warning.recommendation}
                    </div>
                  </div>
                </div>

                {/* Undercut Warnings */}
                {strategyData.undercut_threats.length > 0 && (
                  <div className="bg-f1-red/10 border border-f1-red/35 rounded p-3 text-f1-red">
                    <div className="flex items-center gap-2 mb-1.5 font-bold uppercase text-[10px]">
                      <ShieldAlert className="h-4 w-4" />
                      Undercut Threat Warnings
                    </div>
                    <ul className="space-y-1 text-[11px] list-disc list-inside">
                      {strategyData.undercut_threats.map((threat, idx) => (
                        <li key={idx}>{threat.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Pit Window Table */}
                <div>
                  <div className="text-[9px] text-white/40 uppercase mb-2">TYRE LIFE ESTIMATES</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="text-white/30 border-b border-white/5">
                          <th className="pb-1 font-normal">DRV</th>
                          <th className="pb-1 font-normal">TYRE</th>
                          <th className="pb-1 font-normal">AGE</th>
                          <th className="pb-1 font-normal">DEG LOSS</th>
                          <th className="pb-1 font-normal">STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.values(strategyData.pit_windows).slice(0, 10).map((window) => (
                          <tr key={window.driver_code} className="border-b border-white/5">
                            <td className="py-1.5 font-bold text-white">{window.driver_code}</td>
                            <td className="py-1.5">{window.compound}</td>
                            <td className="py-1.5">{window.tyre_age} laps</td>
                            <td className="py-1.5 text-f1-yellow">+{window.estimated_deg_loss_seconds}s</td>
                            <td className="py-1.5 font-bold">
                              <span
                                className={
                                  window.status === "CRITICAL"
                                    ? "text-f1-red"
                                    : window.status === "OPEN"
                                    ? "text-f1-yellow"
                                    : "text-f1-green"
                                }
                              >
                                {window.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-white/30">
                NO STRATEGY DATA GENERATED. CONNECT CLIENT TO START DATA INGESTION.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
