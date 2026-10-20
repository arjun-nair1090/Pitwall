"use client";

import { Info } from "lucide-react";
import { formatRaceDate } from "@/lib/season";
import { useF1Store } from "@/store/useTelemetryStore";

// Between sessions the live page shows the latest one; say so, so finished timing isn't read as live.
export default function SessionNotice() {
  const session = useF1Store((s) => s.activeSession);
  if (!session || session.live) return null;
  const name = session.meeting_name || session.circuit_short_name || session.location;
  return (
    <p role="status" className="mb-4 flex items-start gap-2 rounded-panel border border-gantry bg-kerb px-4 py-3 text-sm text-mute">
      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        No session is live right now. Showing the latest: <span className="text-chalk">{name}, {session.session_name}, {formatRaceDate(session.date_start)}</span>.
      </span>
    </p>
  );
}
