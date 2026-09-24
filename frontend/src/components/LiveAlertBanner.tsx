"use client";

import React, { useEffect } from "react";
import { AlertTriangle, Flag, Info, X } from "lucide-react";
import IconButton from "@/components/ui/IconButton";
import { cn } from "@/lib/cn";
import { useF1Store } from "@/store/useTelemetryStore";

const AUTO_DISMISS_MS = 12000;

// Colour is the severity, and it is flown as a bar down the left edge, the way a marshal's flag
// reads from the trackside: red for critical, yellow for caution, neutral for information.
const SEVERITY_STYLES: Record<string, { border: string; bar: string; text: string; Icon: typeof Info }> = {
  critical: { border: "border-live/60", bar: "bg-live", text: "text-live-text", Icon: AlertTriangle },
  warning: { border: "border-timing-yellow/60", bar: "bg-timing-yellow", text: "text-timing-yellow", Icon: Flag },
  info: { border: "border-edge", bar: "bg-edge", text: "text-chalk", Icon: Info },
};

function AlertCard({ id, severity, message }: { id: string; severity: string; message: string; timestamp: number }) {
  const dismissAlert = useF1Store((s) => s.dismissAlert);
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;
  const { Icon } = style;

  useEffect(() => {
    const timer = setTimeout(() => dismissAlert(id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [id, dismissAlert]);

  return (
    <div
      className={cn("pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-panel border bg-kerb p-3 pl-4 pr-2", style.border)}
      role="alert"
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", style.bar)} />
      <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", style.text)} />
      <p className={cn("flex-1 text-sm font-medium leading-snug", style.text)}>{message}</p>
      <IconButton label="Dismiss alert" onClick={() => dismissAlert(id)}>
        <X aria-hidden className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

export default function LiveAlertBanner() {
  const alerts = useF1Store((s) => s.alerts);

  if (alerts.length === 0) return null;

  // top-16 sits below the 48px top bar, so toasts never cover Search, Log in or page actions.
  return (
    <div className="pointer-events-none fixed left-4 right-4 top-16 z-50 flex flex-col gap-2 sm:left-auto sm:w-full sm:max-w-sm">
      {alerts.map((alert) => (
        <AlertCard key={alert.id} {...alert} />
      ))}
    </div>
  );
}
