"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorMessage } from "@/lib/apiError";

export type AsyncState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string; notFound: boolean };

// Runs `load` whenever `key` changes (or retry is called) and reports where it got to. A response
// that arrives after the key has moved on is dropped, so a slow request never overwrites a newer
// one. `load` is null while there is nothing to fetch yet.
export function useAsync<T>(load: (() => Promise<T>) | null, key: string): AsyncState<T> & { retry: () => void } {
  const [state, setState] = useState<AsyncState<T>>(load ? { status: "loading" } : { status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const enabled = load !== null;

  useEffect(() => {
    const run = loadRef.current;
    if (!enabled || !run) {
      setState({ status: "idle" });
      return;
    }
    let current = true;
    setState({ status: "loading" });
    run()
      .then((data) => current && setState({ status: "ready", data }))
      .catch((err) => {
        if (!current) return;
        setState({
          status: "error",
          message: getApiErrorMessage(err, "Something went wrong. Please try again."),
          notFound: err?.response?.status === 404,
        });
      });
    return () => { current = false; };
  }, [key, attempt, enabled]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
