"use client";

import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/apiError";
import type { LatestResult } from "@/lib/latestResult";

export type LatestState =
  | { status: "loading" }
  | { status: "ready"; data: LatestResult }
  | { status: "error"; message: string; empty: boolean };

export function useLatestResult(): LatestState & { retry: () => void } {
  const [state, setState] = useState<LatestState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    axios
      .get<LatestResult>("/api/v1/races/latest-result")
      .then((res) => live && setState({ status: "ready", data: res.data }))
      .catch((err) => {
        if (!live) return;
        const empty = err?.response?.status === 404;
        setState({
          status: "error",
          empty,
          message: empty
            ? "No race has been classified yet this season."
            : getApiErrorMessage(err, "Couldn't load the latest race. Check your connection and try again."),
        });
      });
    return () => { live = false; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
