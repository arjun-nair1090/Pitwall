"use client";

import React, { useEffect } from "react";
import { AlertTriangle, Flag, Info, X } from "lucide-react";
import { useF1Store } from "@/store/useTelemetryStore";

const AUTO_DISMISS_MS = 12000;

const SEVERITY_STYLES: Record<string, { border: string; bg: string; text: string; Icon: typeof Info }> = {
  critical: { border: "border-f1-red/50", bg: "bg-f1-red/10", text: "text-f1-red", Icon: AlertTriangle },
  warning: { border: "border-f1-yellow/50", bg: "bg-f1-yellow/10", text: "text-f1-yellow", Icon: Flag },
  info: { border: "border-white/20", bg: "bg-black/70", text: "text-white/90", Icon: Info },
};

function AlertCard({ id, severity, message, timestamp }: { id: string; severity: string; message: string; timestamp: number }) {
  const dismissAlert = useF1Store((s) => s.dismissAlert);
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;
  const { Icon } = style;

  useEffect(() => {
    const timer = setTimeout(() => dismissAlert(id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [id, dismissAlert]);

  return (
    <div
      className={`glass-panel pointer-events-auto flex items-start gap-3 rounded-lg border ${style.border} ${style.bg} p-3 pr-2 shadow-lg backdrop-blur-md animate-fade-in`}
      role="alert"
    >
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${style.text}`} />
      <p className={`flex-1 text-xs font-titillium font-semibold leading-snug ${style.text}`}>{message}</p>
      <button
        onClick={() => dismissAlert(id)}
        aria-label="Dismiss alert"
        className="shrink-0 rounded p-2 md:p-1 text-white/40 hover:text-white/90 hover:bg-white/10 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function LiveAlertBanner() {
  const alerts = useF1Store((s) => s.alerts);

  if (alerts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-4 left-4 right-4 sm:left-auto z-50 flex sm:w-full sm:max-w-sm flex-col gap-2">
      {alerts.map((alert) => (
        <AlertCard key={alert.id} {...alert} />
      ))}
    </div>
  );
}
