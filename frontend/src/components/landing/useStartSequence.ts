import { useCallback, useEffect, useState } from "react";

export type StartStage = "lights" | "go" | "done";
export interface StartOptions {
  instant: boolean;
  lightMs?: number;
  holdMs?: number;
  afterMs?: number;
}

const LAMPS = 5;

// Five lamps light one by one, hold, go out (lights out = "go"), then settle.
export function useStartSequence({ instant, lightMs = 550, holdMs = 800, afterMs = 1200 }: StartOptions) {
  const [lit, setLit] = useState(0);
  const [stage, setStage] = useState<StartStage>(instant ? "done" : "lights");

  useEffect(() => {
    if (stage !== "lights") return;
    if (lit < LAMPS) {
      const t = setTimeout(() => setLit(lit + 1), lightMs);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setLit(0);
      setStage("go");
    }, holdMs);
    return () => clearTimeout(t);
  }, [stage, lit, lightMs, holdMs]);

  useEffect(() => {
    if (stage !== "go") return;
    const t = setTimeout(() => setStage("done"), afterMs);
    return () => clearTimeout(t);
  }, [stage, afterMs]);

  const skip = useCallback(() => {
    setLit(0);
    setStage("done");
  }, []);

  return { lit, stage, skip };
}
