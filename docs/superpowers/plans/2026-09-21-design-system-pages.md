# Design System Pages Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every page on the Timing Screen design system from Plan 1: a landing page whose hero is a real race tower with a start-lights intro, a draggable `/live` workspace, every other page restyled with the primitives, then remove all legacy styling and the 3D scene.

**Architecture:** New presentational components (`landing/`, `workspace/`) are built test-first around small pure modules. Existing pages keep their data flow untouched and only swap presentation onto `Panel`/`PageHeader`/`DataTable`/`Select`/`Tabs` and the design tokens. An objective grep gate (`scripts/check-legacy.mjs`) and the CDP sweep decide when a page is done.

**Tech Stack:** Next.js 14, React 18, Tailwind 3.4, framer-motion, react-grid-layout 1.5.4, Vitest + Testing Library, Recharts, Chrome DevTools Protocol scripts.

**Spec:** `docs/superpowers/specs/2026-09-21-design-system-and-shell-design.md`. **Foundation:** `docs/superpowers/plans/2026-09-21-design-system-foundation.md` (Plan 1 must be complete: tokens, `lib/timing`, `lib/modules`, `lib/layoutStore`, `components/ui/*`, shell, `GET /api/v1/races/latest-result`).

## Global Constraints

Every task's requirements implicitly include this section. It repeats Plan 1's constraints and adds the migration rules.

- Palette tokens exactly: tarmac `#13161B`, kerb `#1B1F26`, raised `#232832`, gantry `#2A303A`, edge `#6C7789`, chalk `#E8EBEF`, mute `#A6AEBB`, faint `#8790A0`, timing purple `#B57BFF` / green `#35D07F` / yellow `#F6C945`, F1 red `#E10600` (non-text only), F1 red text `#FF6B60`.
- Colour only carries meaning (timing semantics, live/danger, tyre compounds, team colours). No cyan, no brand accent, no all-caps labels, no monospace data labels. Sentence-case copy.
- Numerals: `font-display` (Big Shoulders) has proportional digits (measured), so use it only for single values (headlines, one big number) or centred in a fixed-width cell (position numerals). Every aligned column of digits (times, gaps, points) uses the UI face with `tabular-nums`.
- Shape: panels `rounded-panel` (6px), controls `rounded-control` (4px), pills full; hairline borders, no shadows for hierarchy.
- Motion: only the start-lights intro, live-tower row reordering, and interaction feedback; honour `prefers-reduced-motion`.
- Accessibility floor: `:focus-visible` ring on every control (never `outline-none` without a `focus-visible:` replacement), AA contrast, labelled controls, exactly one `h1` per page, 40px touch targets on mobile, no horizontal scroll at 390px.
- Every data area renders one of four states: loading (`Loading` + `Skeleton`), empty (`EmptyState` with the next action), error (`ErrorState` with retry, message via `getApiErrorMessage(err, fallback)`), or data.
- Copy: errors say what happened and what to do, never apologise; one name per action across a flow.
- **Do not change data fetching, state, handlers or API contracts in any migrated page.** Presentation only.
- In Git Bash on Windows, prefix any command that takes a `/route` argument (`ui-sweep.mjs --routes /stats`) with `MSYS_NO_PATHCONV=1`, or the shell rewrites it into a Windows path.
- Frontend commands run from `C:\Users\arjun\f1-pitwall\frontend`. `next dev` is running on :3000; never run `next build` while it runs (Task 12 stops it first). `tsc`, `vitest` and the sweep are safe alongside it.
- Never stage `frontend/tsconfig.tsbuildinfo` or `backend/app/services/f1_data_service.py`. Use explicit `git add` paths. Commit trailer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

### Standard migration mapping

| Legacy | Replace with |
|---|---|
| `text-white`, `text-white/90`+ | `text-chalk` |
| `text-white/60`..`/80` | `text-mute` |
| `text-white/30`..`/50` | `text-faint` for non-essential meta only; readable body text is `text-mute` |
| `glass-panel`, `bg-black/*`, `bg-white/5`, `bg-f1-dark` | `Panel` (surface `bg-kerb`), nested/hover/input surfaces `bg-raised` |
| `border-white/5`, `border-white/10` | `border-gantry` (structure), `border-edge` (form controls) |
| `text-f1-cyan`, `neon-*`, `bg-f1-cyan/*` | `text-chalk`, unless it encodes timing meaning (then the timing colours) |
| `text-f1-red`, `bg-f1-red` | live/alert/danger only: `text-live-text`, `bg-live`; primary actions use `Button variant="primary"` |
| `text-f1-green`, `text-f1-yellow` | timing meaning only: `text-timing-green`, `text-timing-yellow`; otherwise `text-chalk` |
| `font-mono-f1`, `font-mono` | `tabular-nums` |
| `uppercase`, `tracking-wider`, `tracking-widest` | remove; rewrite the label in sentence case |
| `text-4xl font-black italic uppercase` headings | `PageHeader` |
| `rounded`, `rounded-sm` / `rounded-lg`, `rounded-xl` | `rounded-control` / `rounded-panel` |
| `font-titillium` | remove (body is `font-sans`) |
| raw `<select>`, `<input>` | `Select`, `Input` (real labels) |
| hand-rolled tab buttons | `Tabs` + `tabPanelProps` |
| hand-rolled `<table>` | `DataTable` (keep custom cells) |
| hard-coded hex in JSX/SVG/Recharts | tokens or `CHART` / `seriesColor` from `components/charts/chartTheme` |
| page wrapper `p-8`, `max-w-*`, `animate-fade-in` | `<>` fragment or `mx-auto w-full max-w-7xl`; `AppShell` supplies the padding |

Standard page skeleton (data logic stays exactly as it is):
```tsx
<>
  <PageHeader title="Season stats" description="Championship standings since 2018." actions={<Select label="Season" … />} />
  <Panel title="Driver standings" meta={String(year)}>
    {loading ? (
      <Loading label="Loading standings"><TableSkeleton /></Loading>
    ) : error ? (
      <ErrorState title="Couldn't load standings" message={error} onRetry={fetchStandings} />
    ) : rows.length === 0 ? (
      <EmptyState title="No standings yet" description="Pick an earlier season." />
    ) : (
      <DataTable caption="Driver standings" columns={columns} rows={rows} rowKey={(r) => r.driver_code} accent={(r) => teamColor(r.team_name)} />
    )}
  </Panel>
</>
```

**How Tasks 4 to 10 work.** Their files already exist and their data logic must survive verbatim, so those tasks specify the target structure, the class mapping and the acceptance gates; the executor reads each file first and applies them. New code (Tasks 1 to 3, the `ErrorState` rewrite, the live page, and the landing page) is given in full.

### Definition of done for every page task

1. `node scripts/check-legacy.mjs <files>` prints nothing (exit 0).
2. `npx tsc --noEmit && npx vitest run` clean.
3. `node scripts/ui-sweep.mjs --routes <route> --shots <scratch>/shots` prints `ok` for 390, 768 and 1280.
4. Screenshots reviewed with the **critique checklist**: (a) one clear hierarchy, one memorable element; (b) no leftover cyan, all-caps or monospace labels; (c) numbers align (tabular) and use the timing colours only for timing meaning; (d) consistent radii and hairlines; (e) tab through the page once and confirm a visible focus ring on every stop; (f) loading, empty and error states each seen at least once (force one by stopping the backend or passing a bad query). Fix, re-shoot, then commit.
5. Commit.

## File Structure

```
frontend/
  scripts/check-legacy.mjs
  src/lib/latestResult.ts, latestResult.test.ts
  src/components/landing/{introPreference.ts,introPreference.test.ts,useStartSequence.ts,useStartSequence.test.ts,
                          StartLights.tsx,RaceTower.tsx,useLatestResult.ts,HeroTower.tsx}
  src/components/workspace/{Workspace.tsx,Workspace.test.tsx,WorkspaceSkeleton.tsx}
  src/app/page.tsx, live/page.tsx (rewritten); every other page and component restyled in place
  src/app/globals.css (react-grid-layout overrides; later, legacy removal)
```

---

### Task 1: Legacy-style gate script

**Files:**
- Create: `frontend/scripts/check-legacy.mjs`

**Interfaces:**
- Produces: `node scripts/check-legacy.mjs <file...>` or `--all` (scans `src/**/*.tsx` and `src/app/globals.css`); prints `file:line: text` per violation; exit 1 if any.

- [ ] **Step 1: Write the script**
```js
// Objective "is this file migrated?" gate: fails on any legacy style token.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Legacy Tailwind classes only. CSS-variable references such as rgb(var(--f1-red)) are fine.
const LEGACY =
  /\b(text|bg|border|ring|fill|stroke|from|to|via|shadow|divide|outline)-f1-(cyan|red|yellow|green|blue|dark|gray|light)|glass-panel|font-mono-f1|neon-|font-titillium|text-white\/|bg-white\/|border-white|bg-black|\buppercase\b|bg-carbon|animate-status-blink|tracking-(wider|widest)/;
// White text is legitimate only on solid F1 red (4.97:1), i.e. the danger button.
const WHITE = /text-white/;
const WHITE_ALLOWED = new Set(["src/components/ui/Button.tsx"]);

let files = process.argv.slice(2);
if (files[0] === "--all") {
  files = readdirSync("src", { recursive: true })
    .filter((f) => String(f).endsWith(".tsx"))
    .map((f) => join("src", String(f)));
  files.push("src/app/globals.css");
}

let violations = 0;
for (const file of files) {
  const allowWhite = WHITE_ALLOWED.has(file.replace(/\\/g, "/"));
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (LEGACY.test(line) || (!allowWhite && WHITE.test(line))) {
      violations += 1;
      console.log(`${file}:${i + 1}: ${line.trim().slice(0, 110)}`);
    }
  });
}
process.exitCode = violations ? 1 : 0;
```

- [ ] **Step 2: Verify it discriminates**

Run: `node scripts/check-legacy.mjs src/components/ui/Panel.tsx; echo "clean=$?"` then `node scripts/check-legacy.mjs src/app/stats/page.tsx | head -3; echo`
Expected: first prints `clean=0`; second prints legacy lines from the stats page.

- [ ] **Step 3: Commit**
```bash
git add frontend/scripts/check-legacy.mjs
git commit -m "chore(frontend): legacy-style gate for the page migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Landing page (start lights, race tower, module index)

**Files:**
- Create: `frontend/src/lib/latestResult.ts`, `latestResult.test.ts`; under `frontend/src/components/landing/`: `introPreference.ts`, `introPreference.test.ts`, `useStartSequence.ts`, `useStartSequence.test.ts`, `StartLights.tsx`, `RaceTower.tsx`, `useLatestResult.ts`, `HeroTower.tsx`
- Modify: `frontend/src/app/page.tsx` (rewrite)

**Interfaces:**
- Consumes: `GET /api/v1/races/latest-result` (Plan 1 Task 13); `teamColor`, `formatGap` (`@/lib/timing`); `MODULES` (`@/lib/modules`); `Panel`, `Button`/`buttonClass`, `Skeleton`/`Loading`, `EmptyState`, `getApiErrorMessage(err, fallback)`.
- Produces: `ClassificationRow`, `LatestResult`, `gridOrder`, `finishOrder`, `positionsGained`, `formatRaceTime`, `resultLabel`, `winnerCaption` (all from `@/lib/latestResult`); `readIntroPreference(win)`, `markIntroSeen(win)`, `INTRO_KEY`; `useStartSequence({instant, lightMs?, holdMs?, afterMs?}) => {lit: number; stage: "lights"|"go"|"done"; skip(): void}`.

- [ ] **Step 1: Write failing tests for the pure modules**

`frontend/src/lib/latestResult.test.ts`
```ts
import { describe, expect, it } from "vitest";
import {
  finishOrder, formatRaceTime, gridOrder, positionsGained, resultLabel, winnerCaption, type ClassificationRow,
} from "./latestResult";

const row = (over: Partial<ClassificationRow>): ClassificationRow => ({
  position: 1, code: "VER", name: "Max Verstappen", team: "Red Bull Racing", grid: 1, status: "Finished",
  finished: true, race_time_seconds: null, gap_seconds: null, ...over,
});

const field = [
  row({ position: 1, code: "VER", grid: 7, race_time_seconds: 5527.986 }),
  row({ position: 2, code: "NOR", grid: 1, gap_seconds: 3.5 }),
  row({ position: 3, code: "LEC", grid: 5, gap_seconds: 9.25 }),
  row({ position: 4, code: "HAM", grid: 5, status: "+1 Lap" }),
  row({ position: 5, code: "ALO", grid: 2, status: "Engine", finished: false }),
];

describe("ordering", () => {
  it("orders by grid, breaking ties by finishing position, without mutating", () => {
    expect(gridOrder(field).map((r) => r.code)).toEqual(["NOR", "ALO", "LEC", "HAM", "VER"]);
    expect(field[0].code).toBe("VER");
  });
  it("orders by finishing position", () => {
    expect(finishOrder([...field].reverse()).map((r) => r.code)).toEqual(["VER", "NOR", "LEC", "HAM", "ALO"]);
  });
  it("counts positions gained from the grid", () => {
    expect(positionsGained(field[0])).toBe(6);
    expect(positionsGained(field[4])).toBe(-3);
  });
});

describe("labels", () => {
  it("formats a race time as h:mm:ss.mmm", () => {
    expect(formatRaceTime(5400)).toBe("1:30:00.000");
    expect(formatRaceTime(5527.986)).toBe("1:32:07.986");
  });
  it("labels the winner with the race time and others with the gap", () => {
    expect(resultLabel(field[0])).toBe("1:32:07.986");
    expect(resultLabel(field[1])).toBe("+3.500");
  });
  it("falls back to the status for lapped and retired cars, then a dash", () => {
    expect(resultLabel(field[3])).toBe("+1 Lap");
    expect(resultLabel(field[4])).toBe("Engine");
    expect(resultLabel(row({ position: 9, status: null }))).toBe("–");
  });
  it("captions the winner from the grid", () => {
    expect(winnerCaption(field)).toBe("Max Verstappen won from P7, up 6 places.");
    expect(winnerCaption([row({ grid: 1 })])).toBe("Max Verstappen won from pole.");
    expect(winnerCaption([row({ grid: 2 })])).toBe("Max Verstappen won from P2, up 1 place.");
  });
});
```
`frontend/src/components/landing/introPreference.test.ts`
```ts
import { describe, expect, it } from "vitest";
import { INTRO_KEY, markIntroSeen, readIntroPreference } from "./introPreference";

function fakeWindow({ reduced = false, seen = false, broken = false } = {}) {
  const store = new Map<string, string>(seen ? [[INTRO_KEY, "1"]] : []);
  return {
    matchMedia: () => ({ matches: reduced }),
    sessionStorage: {
      getItem: (k: string) => { if (broken) throw new Error("blocked"); return store.get(k) ?? null; },
      setItem: (k: string, v: string) => { if (broken) throw new Error("blocked"); store.set(k, v); },
    },
    store,
  } as any;
}

describe("intro preference", () => {
  it("plays on a first visit", () => expect(readIntroPreference(fakeWindow())).toBe("play"));
  it("skips under reduced motion", () => expect(readIntroPreference(fakeWindow({ reduced: true }))).toBe("skip"));
  it("skips once seen this session", () => {
    const w = fakeWindow();
    markIntroSeen(w);
    expect(readIntroPreference(w)).toBe("skip");
  });
  it("plays (once per page view) when storage is blocked, and never throws", () => {
    const w = fakeWindow({ broken: true });
    expect(() => markIntroSeen(w)).not.toThrow();
    expect(readIntroPreference(w)).toBe("play");
  });
});
```
`frontend/src/components/landing/useStartSequence.test.ts`
```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStartSequence } from "./useStartSequence";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// Each timer is scheduled by an effect after the previous state update, so advance one step per act().
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const opts = { lightMs: 100, holdMs: 200, afterMs: 300 };

describe("useStartSequence", () => {
  it("lights the five lamps one at a time, holds, goes, then finishes", () => {
    const { result } = renderHook(() => useStartSequence({ instant: false, ...opts }));
    expect(result.current).toMatchObject({ lit: 0, stage: "lights" });
    for (let i = 1; i <= 5; i++) {
      tick(100);
      expect(result.current.lit).toBe(i);
    }
    tick(199);
    expect(result.current).toMatchObject({ lit: 5, stage: "lights" });
    tick(1);
    expect(result.current).toMatchObject({ lit: 0, stage: "go" });
    tick(300);
    expect(result.current.stage).toBe("done");
  });
  it("is done immediately when instant", () => {
    const { result } = renderHook(() => useStartSequence({ instant: true, ...opts }));
    expect(result.current).toMatchObject({ lit: 0, stage: "done" });
  });
  it("can be skipped mid-sequence", () => {
    const { result } = renderHook(() => useStartSequence({ instant: false, ...opts }));
    tick(100);
    act(() => result.current.skip());
    expect(result.current).toMatchObject({ lit: 0, stage: "done" });
    tick(1000);
    expect(result.current.stage).toBe("done");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/latestResult.test.ts src/components/landing`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the pure modules**

`frontend/src/lib/latestResult.ts`
```ts
import { formatGap } from "./timing";

// Shape of GET /api/v1/races/latest-result.
export interface ClassificationRow {
  position: number;
  code: string;
  name: string;
  team: string;
  grid: number;
  status: string | null;
  finished: boolean;
  race_time_seconds: number | null;
  gap_seconds: number | null;
}
export interface LatestResult {
  event: string;
  year: number;
  country: string;
  classification: ClassificationRow[];
}

export const gridOrder = (rows: readonly ClassificationRow[]): ClassificationRow[] =>
  [...rows].sort((a, b) => a.grid - b.grid || a.position - b.position);

export const finishOrder = (rows: readonly ClassificationRow[]): ClassificationRow[] =>
  [...rows].sort((a, b) => a.position - b.position);

export const positionsGained = (row: ClassificationRow): number => row.grid - row.position;

const pad = (n: number, width: number) => String(n).padStart(width, "0");

export function formatRaceTime(seconds: number): string {
  const total = Math.round(seconds * 1000);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1000);
  return `${hours}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(total % 1000, 3)}`;
}

export function resultLabel(row: ClassificationRow): string {
  if (row.position === 1 && row.race_time_seconds != null) return formatRaceTime(row.race_time_seconds);
  if (row.gap_seconds != null) return formatGap(row.gap_seconds);
  return row.status ?? "–";
}

export function winnerCaption(rows: readonly ClassificationRow[]): string {
  const winner = finishOrder(rows)[0];
  if (!winner) return "";
  if (winner.grid === 1) return `${winner.name} won from pole.`;
  const gained = positionsGained(winner);
  const up = gained > 0 ? `, up ${gained} ${gained === 1 ? "place" : "places"}` : "";
  return `${winner.name} won from P${winner.grid}${up}.`;
}
```
`frontend/src/components/landing/introPreference.ts`
```ts
export const INTRO_KEY = "pitwall.intro.seen";

type WindowLike = Pick<Window, "matchMedia" | "sessionStorage">;

// The start-lights intro plays once per browser session, and never under reduced motion.
export function readIntroPreference(win: WindowLike): "play" | "skip" {
  try {
    if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) return "skip";
    if (win.sessionStorage.getItem(INTRO_KEY)) return "skip";
  } catch {
    // storage blocked: play once per page view
  }
  return "play";
}

export function markIntroSeen(win: WindowLike): void {
  try {
    win.sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    // nothing to remember it with
  }
}
```
`frontend/src/components/landing/useStartSequence.ts`
```ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/latestResult.test.ts src/components/landing && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Implement the components**

`StartLights.tsx`
```tsx
import { cn } from "@/lib/cn";

// Decorative: the real content (the classification) is below it and the Skip button
// is the accessible control, so the lamps are hidden from assistive tech.
export default function StartLights({ lit }: { lit: number }) {
  return (
    <div aria-hidden className="inline-flex items-center gap-3 rounded-full border border-gantry bg-tarmac px-4 py-2.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-6 w-6 rounded-full border border-gantry transition-colors duration-100",
            i < lit ? "bg-live shadow-[0_0_14px_rgb(var(--f1-red)/0.7)]" : "bg-kerb",
          )}
        />
      ))}
    </div>
  );
}
```
`RaceTower.tsx`
```tsx
"use client";

import { motion } from "framer-motion";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  finishOrder, gridOrder, positionsGained, resultLabel, type ClassificationRow,
} from "@/lib/latestResult";
import { teamColor } from "@/lib/timing";

const ROW_HEIGHT = 44;

interface RaceTowerProps {
  rows: readonly ClassificationRow[];
  phase: "grid" | "finish";
  reducedMotion: boolean;
  label: string;
  visibleRows?: number;
}

// The full field is always rendered so cars can visibly overtake into the visible
// window (the rest is clipped), which is the whole point of the reveal.
export default function RaceTower({ rows, phase, reducedMotion, label, visibleRows = 10 }: RaceTowerProps) {
  const ordered = phase === "grid" ? gridOrder(rows) : finishOrder(rows);
  return (
    <ol aria-label={label} className="relative overflow-hidden" style={{ height: visibleRows * ROW_HEIGHT }}>
      {ordered.map((row, index) => {
        const gained = positionsGained(row);
        return (
          <motion.li
            key={row.code}
            layout={!reducedMotion}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            className="grid items-center border-b border-gantry/60 pr-3 text-sm tabular-nums"
            style={{ height: ROW_HEIGHT, gridTemplateColumns: "2.75rem 4px minmax(0,1fr) auto auto" }}
          >
            <span className="text-center font-display text-2xl font-extrabold leading-none text-chalk">{index + 1}</span>
            <span aria-hidden className="h-6 w-1 rounded-sm" style={{ background: teamColor(row.team) }} />
            <span className="min-w-0 truncate pl-3">
              <span className="font-semibold text-chalk">{row.code}</span>{" "}
              <span className="hidden text-mute sm:inline">{row.name}</span>
            </span>
            <span className={row.finished || phase === "grid" ? "pl-3 text-right text-mute" : "pl-3 text-right text-live-text"}>
              {phase === "finish" ? resultLabel(row) : ""}
            </span>
            <span className="w-12 pl-2 text-right text-xs">
              {phase === "finish" && row.finished && gained !== 0 ? (
                gained > 0 ? (
                  <span className="inline-flex items-center text-timing-green">
                    <ChevronUp aria-hidden className="h-3.5 w-3.5" />+{gained}
                    <span className="sr-only"> places gained</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center text-mute">
                    <ChevronDown aria-hidden className="h-3.5 w-3.5" />{Math.abs(gained)}
                    <span className="sr-only"> places lost</span>
                  </span>
                )
              ) : null}
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}
```
`useLatestResult.ts`
```ts
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
```
`HeroTower.tsx`
```tsx
"use client";

import { useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import Button, { buttonClass } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import Skeleton, { Loading } from "@/components/ui/Skeleton";
import { winnerCaption, type LatestResult } from "@/lib/latestResult";
import { markIntroSeen, readIntroPreference } from "./introPreference";
import RaceTower from "./RaceTower";
import StartLights from "./StartLights";
import { useLatestResult } from "./useLatestResult";
import { useStartSequence } from "./useStartSequence";

function Sequence({ data, instant }: { data: LatestResult; instant: boolean }) {
  const reduced = useReducedMotion() ?? false;
  const { lit, stage, skip } = useStartSequence({ instant });
  useEffect(() => {
    if (!instant) markIntroSeen(window);
  }, [instant]);

  return (
    <Panel
      title={`${data.event} ${data.year}`}
      meta="Final classification"
      actions={stage !== "done" ? <Button size="sm" variant="ghost" onClick={skip}>Skip intro</Button> : undefined}
    >
      <div className="flex h-16 items-center border-b border-gantry px-4">
        {stage === "done" ? (
          <p className="text-sm text-mute">{winnerCaption(data.classification)}</p>
        ) : (
          <StartLights lit={lit} />
        )}
      </div>
      <RaceTower
        rows={data.classification}
        phase={stage === "lights" ? "grid" : "finish"}
        reducedMotion={reduced || instant}
        label={`Final classification, ${data.event} ${data.year}`}
      />
      <div className="border-t border-gantry px-4 py-3">
        <Link
          href={`/debrief?year=${data.year}&race=${encodeURIComponent(data.event)}`}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          Read the race debrief
        </Link>
      </div>
    </Panel>
  );
}

export default function HeroTower() {
  const latest = useLatestResult();
  const [preference, setPreference] = useState<"pending" | "play" | "skip">("pending");
  useEffect(() => setPreference(readIntroPreference(window)), []);

  if (latest.status === "error") {
    return (
      <Panel title="Latest race" meta="Final classification">
        <EmptyState
          title={latest.empty ? "No results yet" : "Couldn't load the latest race"}
          description={latest.message}
          action={latest.empty ? undefined : <Button onClick={latest.retry}>Try again</Button>}
        />
      </Panel>
    );
  }
  if (latest.status === "loading" || preference === "pending") {
    return (
      <Panel title="Latest race" meta="Loading">
        <Loading label="Loading the latest race">
          <div className="space-y-2 p-4">
            {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        </Loading>
      </Panel>
    );
  }
  return <Sequence data={latest.data} instant={preference === "skip"} />;
}
```
`frontend/src/app/page.tsx` (rewrite; module descriptions come from the registry)
```tsx
import Link from "next/link";
import HeroTower from "@/components/landing/HeroTower";
import { buttonClass } from "@/components/ui/Button";
import { MODULES } from "@/lib/modules";

const INDEX = MODULES.filter((m) => m.group !== "More");

export default function LandingPage() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-16 py-4 md:py-10">
      <section className="grid items-center gap-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h1 className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-chalk md:text-7xl">
            The pit wall, in your browser.
          </h1>
          <p className="mt-5 max-w-md text-base text-mute md:text-lg">
            Live timing, telemetry and race analysis for every Grand Prix since 2018.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/live" className={buttonClass({ variant: "primary" })}>Open live timing</Link>
            <Link href="/compare" className={buttonClass({ variant: "secondary" })}>Compare two drivers</Link>
          </div>
        </div>
        <div className="lg:col-span-7">
          <HeroTower />
        </div>
      </section>

      <section aria-labelledby="inside-heading">
        <h2 id="inside-heading" className="font-display text-3xl font-extrabold text-chalk">What's inside</h2>
        <ul className="mt-6 grid gap-x-10 md:grid-cols-2">
          {INDEX.map((m) => {
            const Icon = m.icon;
            return (
              <li key={m.id} className="border-t border-gantry">
                <Link href={m.href} className="flex items-start gap-4 py-5 transition-colors hover:bg-raised/50">
                  <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-mute" />
                  <span>
                    <span className="block font-semibold text-chalk">{m.label}</span>
                    <span className="mt-1 block text-sm text-mute">{m.description}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```
Remove any import of `RacingScene`/`BackgroundScene` from this page (the file is rewritten, so none remain). `app/page.tsx` stays a server component (only client children).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx vitest run && node scripts/check-legacy.mjs src/app/page.tsx src/components/landing/*.tsx src/lib/latestResult.ts`
Then restart the backend (TaskStop the old task, relaunch `run_local.py`) so `/races/latest-result` exists, `curl -s localhost:8000/api/v1/races/latest-result | head -c 300`, then in Chrome (fresh profile via the CDP driver, so sessionStorage is empty): load `/`, take screenshots at t=0.5s, 2s, 4.5s, 7s to see lights, hold, reorder, settled; reload and confirm no intro (instant). Run the sweep on `/` for 390/768/1280. Also verify the failure states by stopping the backend: the hero must show "Couldn't load the latest race" with a Try again button (no crash). If the real FastF1 data is unavailable in this sandbox, verify the reveal against a locally mocked response by intercepting the request in the CDP driver (`Fetch.enable` + `Fetch.fulfillRequest`) with a 20-row fixture, and say so in the commit message.

- [ ] **Step 7: Commit**
```bash
git add frontend/src/lib/latestResult.ts frontend/src/lib/latestResult.test.ts frontend/src/components/landing frontend/src/app/page.tsx
git commit -m "feat(ui): landing page with a live-data race tower and start-lights intro

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Workspace (draggable, resizable panels with full-screen expand)

**Files:**
- Create: `frontend/src/components/workspace/Workspace.tsx`, `Workspace.test.tsx`, `WorkspaceSkeleton.tsx`
- Modify: `frontend/src/app/globals.css` (append react-grid-layout overrides)

**Interfaces:**
- Consumes: `Layouts`, `loadLayouts`, `saveLayouts`, `resetLayouts` (`@/lib/layoutStore`); `Panel`, `IconButton`.
- Produces: `interface WorkspacePanelDef { id: string; title: string; meta?: ReactNode; render: () => ReactNode }`; default export `Workspace({ name, panels, defaults, rowHeight?, resetKey? })` (client-only; load it with `next/dynamic` and `ssr: false`); `WorkspaceSkeleton()`. Expanding a panel moves its DOM into a full-screen overlay **without remounting its content**, so component state (a chat log, a typed input) survives.

- [ ] **Step 1: Write the failing test** `Workspace.test.tsx`
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import Workspace, { type WorkspacePanelDef } from "./Workspace";
import type { Layouts } from "@/lib/layoutStore";

function Chat() {
  const [text, setText] = useState("");
  return <input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} />;
}

const panels: WorkspacePanelDef[] = [
  { id: "a", title: "Race tower", render: () => <p>tower body</p> },
  { id: "b", title: "Race engineer", render: () => <Chat /> },
];
const defaults: Layouts = {
  lg: [{ i: "a", x: 0, y: 0, w: 6, h: 4 }, { i: "b", x: 6, y: 0, w: 6, h: 4 }],
  sm: [{ i: "a", x: 0, y: 0, w: 1, h: 4 }, { i: "b", x: 0, y: 4, w: 1, h: 4 }],
};

beforeEach(() => window.localStorage.clear());

describe("Workspace", () => {
  it("renders every panel as a titled region", () => {
    render(<Workspace name="t" panels={panels} defaults={defaults} />);
    expect(screen.getByRole("region", { name: "Race tower" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Race engineer" })).toBeInTheDocument();
  });

  it("expands a panel full screen and closes it with Escape, restoring focus", async () => {
    const user = userEvent.setup();
    render(<Workspace name="t" panels={panels} defaults={defaults} />);
    const expand = screen.getByRole("button", { name: "Expand Race tower" });
    await user.click(expand);
    const dialog = screen.getByRole("dialog", { name: "Race tower" });
    expect(dialog).toHaveTextContent("tower body");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(expand).toHaveFocus();
  });

  it("keeps a panel's state when it is expanded and collapsed", async () => {
    const user = userEvent.setup();
    render(<Workspace name="t" panels={panels} defaults={defaults} />);
    await user.type(screen.getByLabelText("Message"), "box box");
    await user.click(screen.getByRole("button", { name: "Expand Race engineer" }));
    expect(screen.getByRole("dialog", { name: "Race engineer" })).toContainElement(screen.getByLabelText("Message"));
    expect(screen.getByLabelText("Message")).toHaveValue("box box");
    await user.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(screen.getByLabelText("Message")).toHaveValue("box box");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/workspace`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `Workspace.tsx`
```tsx
"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import IconButton from "@/components/ui/IconButton";
import Panel from "@/components/ui/Panel";
import { loadLayouts, resetLayouts, saveLayouts, type Layouts } from "@/lib/layoutStore";

export interface WorkspacePanelDef {
  id: string;
  title: string;
  meta?: ReactNode;
  render: () => ReactNode;
}

interface WorkspaceProps {
  name: string;
  panels: WorkspacePanelDef[];
  defaults: Layouts;
  rowHeight?: number;
  /** Increment to reset to the default layout. */
  resetKey?: number;
}

const Grid = WidthProvider(Responsive);

// Each panel's content lives in a detached host element that is *moved* between the
// grid cell and the full-screen overlay. The content is rendered once, through a
// portal into that host, so expanding never remounts it (chat logs and typed input survive).
function WorkspacePanel({
  def, expanded, overlay, onToggle,
}: { def: WorkspacePanelDef; expanded: boolean; overlay: HTMLElement | null; onToggle: () => void }) {
  const slot = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.className = "h-full min-h-0";
    return el;
  });

  useLayoutEffect(() => {
    const target = expanded ? overlay : slot.current;
    if (target && host.parentElement !== target) target.appendChild(host);
  }, [expanded, overlay, host]);

  return (
    <>
      {createPortal(def.render(), host)}
      <Panel
        title={def.title}
        meta={def.meta}
        className="h-full"
        headerClassName="panel-drag-handle cursor-grab active:cursor-grabbing"
        actions={
          <IconButton label={`Expand ${def.title}`} onClick={onToggle}>
            <Maximize2 aria-hidden className="h-4 w-4" />
          </IconButton>
        }
      >
        <div ref={slot} className="h-full min-h-0" />
      </Panel>
    </>
  );
}

export default function Workspace({ name, panels, defaults, rowHeight = 56, resetKey = 0 }: WorkspaceProps) {
  const [layouts, setLayouts] = useState<Layouts>(() => loadLayouts(name, defaults));
  const [breakpoint, setBreakpoint] = useState("lg");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const firstReset = useRef(true);

  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    resetLayouts(name);
    setLayouts(defaults);
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setExpandedId(null);
    returnFocus.current?.focus();
  };

  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setExpandedId(null);
        returnFocus.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const expanded = panels.find((p) => p.id === expandedId);
  const desktop = breakpoint === "lg";

  return (
    <>
      <Grid
        layouts={layouts}
        breakpoints={{ lg: 1024, sm: 0 }}
        cols={{ lg: 12, sm: 1 }}
        rowHeight={rowHeight}
        margin={[12, 12]}
        isDraggable={desktop}
        isResizable={desktop}
        draggableHandle=".panel-drag-handle"
        // Buttons in the title strip (Expand) must click, not start a drag.
        draggableCancel="button, a, input, select, textarea"
        onBreakpointChange={(bp: string) => setBreakpoint(bp)}
        onLayoutChange={(_current: unknown, all: Layouts) => {
          setLayouts(all);
          saveLayouts(name, all);
        }}
      >
        {panels.map((def) => (
          <div key={def.id}>
            <WorkspacePanel
              def={def}
              expanded={expandedId === def.id}
              overlay={overlay}
              onToggle={() => {
                returnFocus.current = document.activeElement as HTMLElement | null;
                setExpandedId(def.id);
              }}
            />
          </div>
        ))}
      </Grid>

      {expanded && (
        <div role="dialog" aria-modal="true" aria-label={expanded.title} className="fixed inset-0 z-40 flex flex-col bg-tarmac p-3 md:p-6">
          <div className="flex items-center gap-3 pb-3">
            <h2 className="font-display text-2xl font-extrabold text-chalk">{expanded.title}</h2>
            <IconButton className="ml-auto" label="Exit full screen" onClick={close} autoFocus>
              <Minimize2 aria-hidden className="h-4 w-4" />
            </IconButton>
          </div>
          <div ref={setOverlay} className="min-h-0 flex-1 overflow-auto rounded-panel border border-gantry bg-kerb" />
        </div>
      )}
    </>
  );
}
```
`WorkspaceSkeleton.tsx`
```tsx
import Skeleton, { Loading } from "@/components/ui/Skeleton";

export default function WorkspaceSkeleton() {
  return (
    <Loading label="Loading workspace">
      <div className="grid gap-3 lg:grid-cols-12">
        <Skeleton className="h-[560px] lg:col-span-5" />
        <div className="grid gap-3 lg:col-span-7">
          <Skeleton className="h-[260px]" />
          <Skeleton className="h-[280px]" />
        </div>
      </div>
    </Loading>
  );
}
```
Append to `globals.css` (inside no layer, after existing rules):
```css
/* react-grid-layout: match the design tokens */
.react-grid-item.react-grid-placeholder {
  background: rgb(var(--edge));
  opacity: 0.25;
  border-radius: var(--radius-panel);
}
.react-grid-item > .react-resizable-handle::after {
  border-color: rgb(var(--edge));
}
```
Note: if the "expanded focus restore" test fails because `autoFocus` moves focus but Escape/close restores to `returnFocus`, ensure `returnFocus.current` is the Expand button (it is `document.activeElement` at click time; with `user.click` the button is focused). If the test shows focus on `body`, set focus explicitly: `(e.currentTarget as HTMLElement).focus()` inside `onToggle` before storing.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/workspace && npx tsc --noEmit`
Expected: PASS. If `react-grid-layout` cannot be imported under jsdom, mock only `WidthProvider` to a passthrough in the test file (do not weaken the assertions).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/workspace frontend/src/app/globals.css
git commit -m "feat(ui): workspace with drag, resize and state-preserving full-screen expand

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `/live` on the workspace, and the live panels

**Files:**
- Modify: `frontend/src/app/live/page.tsx` (rewrite), `frontend/src/components/LiveTiming.tsx`, `GapEvolutionChart.tsx`, `TelemetryConsole.tsx`, `AIEngineerConsole.tsx`, `TeamRadioConsole.tsx`, `LiveAlertBanner.tsx`, `CompoundBadge.tsx`, `TableSkeleton.tsx`, `ErrorState.tsx`

**Interfaces:**
- Consumes: `Workspace`, `WorkspacePanelDef`, `WorkspaceSkeleton`, `Layouts`; `classifyTime`, `TIMING_TEXT_CLASS`, `formatLapTime`, `formatSector`, `formatGap`, `teamColor`; `CHART`, `seriesColor`, `seriesDash`; primitives.
- Produces: each live component renders **body content only** (no outer box, no title strip, no shadows): the workspace supplies the chrome and the title. `ErrorState` and `CompoundBadge` keep their props.

- [ ] **Step 1: Rewrite `live/page.tsx`**
```tsx
"use client";

import dynamic from "next/dynamic";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import AIEngineerConsole from "@/components/AIEngineerConsole";
import GapEvolutionChart from "@/components/GapEvolutionChart";
import LiveTiming from "@/components/LiveTiming";
import TeamRadioConsole from "@/components/TeamRadioConsole";
import TelemetryConsole from "@/components/TelemetryConsole";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/ui/PageHeader";
import type { WorkspacePanelDef } from "@/components/workspace/Workspace";
import WorkspaceSkeleton from "@/components/workspace/WorkspaceSkeleton";
import type { Layouts } from "@/lib/layoutStore";

const Workspace = dynamic(() => import("@/components/workspace/Workspace"), { ssr: false, loading: () => <WorkspaceSkeleton /> });

const PANELS: WorkspacePanelDef[] = [
  { id: "timing", title: "Race tower", render: () => <LiveTiming /> },
  { id: "gaps", title: "Gap evolution", render: () => <GapEvolutionChart /> },
  { id: "telemetry", title: "Telemetry", render: () => <TelemetryConsole /> },
  { id: "engineer", title: "Race engineer", render: () => <AIEngineerConsole /> },
  { id: "radio", title: "Team radio and race control", render: () => <TeamRadioConsole /> },
];

const DEFAULT_LAYOUTS: Layouts = {
  lg: [
    { i: "timing", x: 0, y: 0, w: 5, h: 14 },
    { i: "gaps", x: 0, y: 14, w: 5, h: 5 },
    { i: "telemetry", x: 5, y: 0, w: 7, h: 6 },
    { i: "engineer", x: 5, y: 6, w: 7, h: 8 },
    { i: "radio", x: 5, y: 14, w: 7, h: 5 },
  ],
  sm: [
    { i: "timing", x: 0, y: 0, w: 1, h: 9 },
    { i: "gaps", x: 0, y: 9, w: 1, h: 5 },
    { i: "telemetry", x: 0, y: 14, w: 1, h: 6 },
    { i: "engineer", x: 0, y: 20, w: 1, h: 8 },
    { i: "radio", x: 0, y: 28, w: 1, h: 5 },
  ],
};

export default function LiveDashboardPage() {
  const [resetKey, setResetKey] = useState(0);
  return (
    <>
      <PageHeader
        title="Live timing"
        description="Positions, gaps and telemetry as the session runs. Drag a panel by its title to rearrange it."
        actions={
          <Button variant="ghost" onClick={() => setResetKey((k) => k + 1)}>
            <RotateCcw aria-hidden className="h-4 w-4" />
            Reset layout
          </Button>
        }
      />
      <Workspace name="live" panels={PANELS} defaults={DEFAULT_LAYOUTS} resetKey={resetKey} />
    </>
  );
}
```

- [ ] **Step 2: `LiveTiming.tsx`, the signature component.** Read the file and keep its store wiring (`leaderboard`, `drivers`, `selectedDriverNum`, `setSelectedDriverNum`) and its sort. Remove the outer `glass-panel` box and the title strip. Render the tower as ARIA table semantics on `div`s so rows can animate: a container `role="table" aria-label="Live timing tower"`, a header `role="row"` of `role="columnheader"` cells, and a `role="rowgroup"` of `motion.div role="row"` rows with `layout={!reducedMotion}` and `transition={{ type: "spring", stiffness: 380, damping: 36 }}` keyed by driver number (`useReducedMotion()` from framer-motion), so cars visibly change places. This is the one motion allowed in the workspace. Use a CSS grid (`gridTemplateColumns: "2.75rem 4px minmax(0,1fr) auto auto auto auto auto auto"`) for the cells, each `role="cell"`:
  - position: `font-display text-xl font-extrabold`; a 4px team spine `span` coloured `d.team_colour ? "#" + d.team_colour : teamColor(d.team_name)`;
  - driver: a real `<button>` (keyboard operable) showing the code in `font-semibold text-chalk`, `aria-pressed` for the selected driver, row background `bg-raised` when selected;
  - tyre: `CompoundBadge`; gap to leader: `formatGap`; last lap: `formatLapTime`; S1/S2/S3: `formatSector`.
  Colour each time cell with `TIMING_TEXT_CLASS[classifyTime(value, personalBest, overallBest)]`. Overall best per column = the minimum currently in the field; personal best = the minimum that driver has shown **since the page opened** (keep it in a `useRef<Record<number, {lap:number; s1:number; s2:number; s3:number}>>` updated inside a `useMemo`; add a code comment: "best seen this visit, because the live feed does not include session personal bests"). Empty state: `EmptyState title="Waiting for timing data" description="Live timing appears here when a session is running."`.

- [ ] **Step 3: Restyle the other four panels and shared bits** using the mapping table, body-only:
  - `GapEvolutionChart`: use `CHART.grid/axis/tooltip/legend`; series colour via `seriesColor(team, index)` and `seriesDash(index)`; keep its data hooks.
  - `TelemetryConsole`: numeric readouts as `tabular-nums`; speed/throttle/brake bars use `bg-chalk` for throttle and `bg-live` for brake (brake = danger/attention), gear in `font-display`; no cyan.
  - `AIEngineerConsole`: replace the two hand-rolled tab buttons with `Tabs` (`idBase="engineer"`, labels "Race engineer" / "Strategist", panels via `tabPanelProps`); chat bubbles: user `bg-raised`, engineer `border border-gantry`; the input uses `Input`-style classes with a real `aria-label`; send button `Button variant="primary"` labelled "Send". Undercut/alert block uses `border-live/40 text-live-text`. Rewrite the shouting copy in sentence case ("Ingesting telemetry…" → "Reading telemetry…").
  - `TeamRadioConsole`: rows as a list with time in `text-faint tabular-nums`, race-control flags using `Pill` (`tone` yellow for yellow flags, `live` for red/safety car, `neutral` otherwise).
  - `LiveAlertBanner`: keep behaviour; restyle to `bg-kerb border-gantry`, severity as an icon + `Pill`, dismiss `IconButton label="Dismiss alert"`.
  - `ErrorState`: rewrite on the primitives, same props:
```tsx
import { AlertTriangle, RotateCw } from "lucide-react";
import Button from "@/components/ui/Button";

interface ErrorStateProps { title?: string; message: string; onRetry?: () => void }

export default function ErrorState({ title = "Something went wrong", message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-panel border border-live/40 bg-kerb p-8 text-center">
      <AlertTriangle aria-hidden className="h-6 w-6 text-live-text" />
      <h3 className="font-semibold text-chalk">{title}</h3>
      <p className="max-w-md text-sm text-mute">{message}</p>
      {onRetry && (
        <Button onClick={onRetry}>
          <RotateCw aria-hidden className="h-4 w-4" />
          Try again
        </Button>
      )}
    </div>
  );
}
```
  - `CompoundBadge`: same props; ring colour from `getCompoundStyle`, age in `text-faint tabular-nums`, label `text-mute`; no `font-mono-f1`.
  - `TableSkeleton`: rebuild on `Skeleton` inside `Loading`; keep its props.

- [ ] **Step 4: Verify** — Definition of done (above) for `/live` with files `src/app/live/page.tsx src/components/{LiveTiming,GapEvolutionChart,TelemetryConsole,AIEngineerConsole,TeamRadioConsole,LiveAlertBanner,CompoundBadge,TableSkeleton,ErrorState}.tsx`. Additionally: drag a panel by its title in real Chrome (use `Input.dispatchMouseEvent` press/move/release on `.panel-drag-handle`), reload, and confirm the layout persisted; click "Reset layout" and confirm it returned; expand the engineer panel, type in its chat box, exit, confirm the text survived. With no live session the timing panel must show its empty state (this is the normal state in this sandbox); to see populated rows, temporarily seed the store from the CDP driver (`window.__zustand`-free approach: call the store's `setState` through a dev-only global is NOT allowed to ship; instead intercept `/api/v1/sessions/*/timing` with `Fetch.fulfillRequest` and a 20-driver fixture) and screenshot it.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/live/page.tsx frontend/src/components/LiveTiming.tsx frontend/src/components/GapEvolutionChart.tsx frontend/src/components/TelemetryConsole.tsx frontend/src/components/AIEngineerConsole.tsx frontend/src/components/TeamRadioConsole.tsx frontend/src/components/LiveAlertBanner.tsx frontend/src/components/CompoundBadge.tsx frontend/src/components/TableSkeleton.tsx frontend/src/components/ErrorState.tsx
git commit -m "feat(ui): /live workspace and restyled live panels

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `/map` (TrackMap, DriverLiveTelemetry)

**Files:** Modify `frontend/src/app/map/page.tsx`, `frontend/src/components/TrackMap.tsx`, `frontend/src/components/DriverLiveTelemetry.tsx`, `frontend/src/components/TelemetryPlayer.tsx` (replay controls live here).

- [ ] **Step 1: Page.** Replace the sr-only `h1` and grid with `PageHeader title="Track map" description="Every car on the circuit in real time, or replay a full race lap by lap."` then a two-column layout: `Panel title="Circuit"` (map, `h-[60dvh] min-h-[340px] xl:h-[calc(100dvh-220px)]`) and `Panel title="Driver telemetry"` (sidebar). Keep the existing responsive stacking rules.
- [ ] **Step 2: `TrackMap.tsx`.** Body-only. Track outline stroke `gantry`/`edge`; car dots filled with the driver's team colour with the 3-letter code beside them in `chalk` (`paint-order: stroke` with a `tarmac` stroke for legibility); selected driver ring `chalk`; corner numbers `faint`; DRS zones as `timing-green` segments only if the data marks them; no SVG filters or pulse animations (kept off for mobile performance). Hit targets stay >= 40px on touch.
- [ ] **Step 3: `DriverLiveTelemetry.tsx` and `TelemetryPlayer.tsx`.** Body-only per the mapping table; readouts `tabular-nums`; replay play/pause and lap controls as `IconButton`s with labels, lap select as `Select hideLabel label="Lap"`, scrubber `<input type="range" aria-label="Replay position">`.
- [ ] **Step 4: Verify** with the Definition of done for `/map` (files above). Also confirm no horizontal overflow at 390px with a car selected.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/map/page.tsx frontend/src/components/TrackMap.tsx frontend/src/components/DriverLiveTelemetry.tsx frontend/src/components/TelemetryPlayer.tsx
git commit -m "feat(ui): restyle /map on the Timing Screen system

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `/stats`, `/archive`, `/drivers/[code]`

**Files:** Modify `frontend/src/app/stats/page.tsx`, `frontend/src/app/archive/page.tsx`, `frontend/src/components/HistoricalArchive.tsx`, `frontend/src/app/drivers/[code]/page.tsx`.

- [ ] **Step 1: `/stats`.** Apply the standard page skeleton: `PageHeader` with the season `Select` (label "Season") as `actions`; a `Tabs` control (`idBase="stats"`, "Drivers" / "Constructors") replacing any hand-rolled toggle; each tab's content is a `DataTable` with `accent={(r) => teamColor(r.team_name)}`, position column in `font-display`, points right-aligned; loading/empty/error states exactly as in the skeleton (keep `fetchStandings` and `ErrorState onRetry`).
- [ ] **Step 2: `/archive` and `HistoricalArchive.tsx`.** `PageHeader` replaces the sr-only h1. Season and race selects become `Select`; the race list becomes a `DataTable` (race, country, date, "Debrief" link column using `buttonClass({variant:"ghost",size:"sm"})` pointing at `/debrief?year=&race=`); the RAG/summary block (if present) sits in a `Panel`. Sentence-case all labels.
- [ ] **Step 3: `/drivers/[code]`.** `PageHeader title={driverCode}` (the code, as before) with the season `Select` in `actions`; the standing summary as a row of plain figures (`font-display text-4xl` value over a `text-mute` label; not identical cards: separate them with `border-l border-gantry` dividers); race-by-race insights in a `DataTable`. Keep the "historical corpus" empty-state message but rewrite it in the mapping's voice (what is missing, what to do).
- [ ] **Step 4: Verify** with the Definition of done for `/stats`, `/archive`, `/drivers/VER?year=2023` (files above). `/stats` must show real standings from the running backend.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/stats/page.tsx frontend/src/app/archive/page.tsx frontend/src/components/HistoricalArchive.tsx "frontend/src/app/drivers/[code]/page.tsx"
git commit -m "feat(ui): restyle stats, archive and driver pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `/compare` (TelemetryComparison, DominanceMap)

**Files:** Modify `frontend/src/app/compare/page.tsx`, `frontend/src/components/TelemetryComparison.tsx`, `frontend/src/components/DominanceMap.tsx`.

- [ ] **Step 1: Page controls.** `PageHeader` with description "Overlay two drivers' fastest laps and see where the time was won." The form (season, race, driver A, driver B, run button) becomes a single row of `Select`s and one `Button variant="primary"` ("Compare laps"), wrapping on mobile. Keep the existing request payload and the share-card link (`result-card`): style it as `buttonClass({variant:"secondary"})` labelled "Save result card".
- [ ] **Step 2: Charts.** Every Recharts chart in this page and `TelemetryComparison.tsx` uses `CHART` for grid/axes/tooltip/legend. Driver A and B strokes come from `seriesColor(teamName, 0/1)` with `strokeDasharray={seriesDash(index)}` so teammates stay distinguishable; add a text legend so colour is never the only cue. Delta chart: positive delta (A slower) in `timing-yellow`, negative in `timing-green`, zero line `edge`.
- [ ] **Step 3: `DominanceMap.tsx`.** Track segments coloured by which driver is faster there, using the two driver series colours (with a pattern or outline difference when teammates share a colour); legend as text swatches.
- [ ] **Step 4: Verify** with the Definition of done for `/compare`. Run a real comparison (e.g. 2023, Belgian Grand Prix, VER vs NOR); the first load can take up to a minute. Confirm the charts render with the new theme and that the error state appears when the backend is stopped.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/compare/page.tsx frontend/src/components/TelemetryComparison.tsx frontend/src/components/DominanceMap.tsx
git commit -m "feat(ui): restyle head-to-head comparison with the shared chart theme

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `/strategy` and `/debrief` (StintBar, WhatIfPanel)

**Files:** Modify `frontend/src/app/strategy/page.tsx`, `frontend/src/app/debrief/page.tsx`, `frontend/src/components/StintBar.tsx`, `frontend/src/components/WhatIfPanel.tsx`.

- [ ] **Step 1: `/strategy`.** `PageHeader "Strategy simulator"`; the stint builder rows use `Select` for compound and a labelled number `Input` for laps; "Add stint" `Button variant="secondary"`, "Run simulation" `Button variant="primary"` with `loading`; the result in a `Panel` with the predicted race time in `font-display text-5xl tabular-nums` and the per-stint breakdown as a `DataTable`; stint bar via `StintBar`.
- [ ] **Step 2: `StintBar`.** Keep its luminance-based label colour, switch the track to `bg-raised`, segment radius `rounded-control`, and add a visible text label ("Soft, 14 laps") in the segment or its tooltip so the compound is never colour-only.
- [ ] **Step 3: `/debrief`.** `PageHeader "Race debrief"`, controls (season, race) as `Select`s; the summary text in a `Panel` with `max-w-prose` body and `Pill tone="neutral"` reading "Auto-generated" or "Written by AI" from the existing `source`; facts (winner, podium, fastest lap, strategies, retirements) as `DataTable`s and figure rows; the shareable-link behaviour (`linked` ref, `?year=&race=`) stays untouched.
- [ ] **Step 4: `WhatIfPanel`.** Sliders keep their labels ("Pit stop 1: lap 17"), plain `Select` for driver and compound, "Run what-if" `Button variant="primary"` with `loading`; the result delta uses `formatDelta` in `timing-green` when faster and `timing-yellow` when slower, with the explanation text in `text-mute`; confidence as a `Pill`.
- [ ] **Step 5: Verify** with the Definition of done for `/strategy` and `/debrief` (files above), including `/debrief?year=2023&race=Belgian%20Grand%20Prix` end to end (VER wins from P6; a what-if of pit stop 1 three laps later gives about -4.8 s), first load up to a minute.
- [ ] **Step 6: Commit**
```bash
git add frontend/src/app/strategy/page.tsx frontend/src/app/debrief/page.tsx frontend/src/components/StintBar.tsx frontend/src/components/WhatIfPanel.tsx
git commit -m "feat(ui): restyle strategy simulator, debrief and what-if panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `/predictions`, `/login`, `/changelog`

**Files:** Modify `frontend/src/app/predictions/page.tsx`, `frontend/src/app/login/page.tsx`, `frontend/src/app/changelog/page.tsx`.

- [ ] **Step 1: `/login`.** Centre a `max-w-md` column with `PageHeader title={mode === "login" ? "Log in" : "Create an account"}` (the page's single `h1`) above a `Panel title="Your details"` containing `Input`s (email `type="email" autoComplete="email"`, password with `hint="At least 8 characters"` in signup mode, display name in signup mode), errors passed through `Input error=` or an `role="alert"` line for form-level errors (message from `getApiErrorMessage`), the mode toggle as a `Button variant="ghost"` ("Need an account? Sign up" / "Have an account? Log in"), submit `Button variant="primary" loading`. Keep every existing `autocomplete`, length limit and the post-login redirect to `/predictions`.
- [ ] **Step 2: `/predictions`.** `PageHeader "Predictions"`; season and race `Select`s; the podium picker as three labelled `Select`s ("First place", "Second place", "Third place") that keep the no-duplicate rule and the real-grid data; the lock state as a `Pill` (`neutral` "Open until lights out", `live` "Locked"); the leaderboard as a `DataTable` (rank in `font-display`); the submit button says "Save prediction" (and "Update prediction" when one exists) and the success toast/line repeats the same verb ("Prediction saved").
- [ ] **Step 3: `/changelog`.** `PageHeader "Changelog"`; entries as a ruled list: date in `text-faint tabular-nums`, title in `text-chalk font-semibold`, notes in `text-mute`. **Add a new top entry dated 2026-09-21** titled "New look" with three plain-language notes: the redesign and command palette (Ctrl+K), the draggable live workspace, and the landing page race tower.
- [ ] **Step 4: Verify** with the Definition of done for `/predictions`, `/login`, `/changelog`. Re-run the signup, log in, save a prediction, log out flow in real Chrome (`scratchpad/e2e_auth.mjs` and `e2e_logout.mjs` exist; if their selectors no longer match the new markup, update the selectors, not the assertions). Confirm the 422 message ("password too short") still renders as a sentence, not `[object Object]`.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/predictions/page.tsx frontend/src/app/login/page.tsx frontend/src/app/changelog/page.tsx
git commit -m "feat(ui): restyle predictions, login and changelog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `/advanced` and `PedalBehaviorChart` (the user's uncommitted work)

**Files:** Modify (and first-time commit) `frontend/src/app/advanced/page.tsx`, `frontend/src/components/PedalBehaviorChart.tsx`. **Do not touch `backend/app/services/f1_data_service.py`.**

- [ ] **Step 1: Snapshot the user's version first.** Commit the two files exactly as they are, unmodified, so the restyle is a reviewable diff:
```bash
git add frontend/src/app/advanced frontend/src/components/PedalBehaviorChart.tsx
git commit -m "wip: advanced analytics page and pedal behaviour chart (as written)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
- [ ] **Step 2: Fix the hardcoded API URL.** In `advanced/page.tsx` replace `axios.post("http://localhost:8000/api/v1/telemetry/pedal-behavior", {...})` with `axios.post("/api/v1/telemetry/pedal-behavior", {...})`: `AppInitializer` already sets `axios.defaults.baseURL` and CSRF/cookie handling, so the absolute URL only breaks deployments.
- [ ] **Step 3: Restyle** per the mapping table: `PageHeader "Advanced analytics"` (drop its own `h1`/`Zap` heading), season/Grand Prix/session `Select`s with real labels (keep the `availableGPs` list and the `handleAnalyze` handler), "Analyse" `Button variant="primary" loading`, error via `ErrorState`, results in a `Panel`. `PedalBehaviorChart`: stacked bars for the four states use meaningful, fixed colours with a text legend: throttle only `chalk`, brake only `live`, trail braking `timing-purple`, coasting `edge`; axes/grid/tooltip from `CHART`; sentence-case labels; driver names in `chalk`.
- [ ] **Step 4: Verify** with the Definition of done for `/advanced` (files above). Run a real analysis (2024, Belgium, Race) and screenshot the chart.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/advanced/page.tsx frontend/src/components/PedalBehaviorChart.tsx
git commit -m "feat(ui): restyle advanced analytics; use the shared API client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Cleanup: remove the 3D scene and every legacy style

**Files:** Delete `frontend/src/components/RacingScene.tsx`, `BackgroundScene.tsx`, `frontend/src/fonts/TitilliumWeb-*.woff2`; modify `frontend/package.json` (+ lockfile), `frontend/tailwind.config.ts`, `frontend/src/app/globals.css`, `frontend/src/app/layout.tsx`.

- [ ] **Step 1: Prove nothing still uses them.**

Run: `grep -rnE "RacingScene|BackgroundScene|from \"three\"|@react-three" src; node scripts/check-legacy.mjs --all`
Expected: the grep prints only the two files' own lines; `check-legacy --all` reports only `globals.css` and nothing in `.tsx`. If any `.tsx` violation remains, migrate it now (mapping table) before continuing.

- [ ] **Step 2: Delete the 3D scene and its dependencies**
```bash
git rm src/components/RacingScene.tsx src/components/BackgroundScene.tsx
npm uninstall three @react-three/fiber @react-three/drei @types/three
```
- [ ] **Step 3: Delete the legacy aliases.** In `tailwind.config.ts` remove `fontFamily.titillium`, `colors.background`, `colors.foreground`, `colors.f1`, and `colors.compound` (first `grep -rn "bg-compound\|text-compound\|border-compound" src`; if any hit, migrate it to `getCompoundStyle` first). In `globals.css` delete `.neon-*`, `.glass-panel`, `.bg-carbon`, `.font-mono-f1`, `.animate-status-blink` and the `blink` keyframes. In `layout.tsx` delete the `titillium` `localFont`, its `variable` in `<html className>`, and `git rm frontend/src/fonts/TitilliumWeb-*.woff2`.
- [ ] **Step 4: Gates**

Run: `node scripts/check-legacy.mjs --all; echo "legacy=$?"; grep -rn "outline-none" src | grep -v "focus-visible:"; npx tsc --noEmit && npx vitest run`
Expected: `legacy=0`; the `outline-none` grep prints nothing except lines that have a `focus-visible:` replacement (the palette input, whose focus indicator is its wrapper's `focus-within:border-chalk`, is the one accepted exception: add a one-line comment above it if absent); tsc and tests clean.

- [ ] **Step 5: Commit**
```bash
git add frontend/package.json frontend/package-lock.json frontend/tailwind.config.ts frontend/src/app/globals.css frontend/src/app/layout.tsx
git commit -m "chore(ui): remove the 3D scene, legacy aliases and Titillium

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
(the `git rm` deletions are already staged by Steps 2 and 3.)

---

### Task 12: Final verification, docs and hand-off

**Files:** Modify `README.md`; verify only otherwise.

- [ ] **Step 1: Full automated gates**

Run: `npx tsc --noEmit && npx vitest run && npm run lint` (frontend) and `SECRET_KEY=test RUNNING_LOCALLY=true python -m pytest -q` (backend, from `backend/`).
Expected: tsc and tests green; backend green (the earlier 295 plus the new latest-result tests). `npm run lint` uses `eslint-config-next` 15-canary against Next 14 and `next.config.mjs` has ignored lint so far: fix every lint error in files this project touched; if lint cannot run at all for a pre-existing configuration reason, record the exact error in the hand-off report instead of hiding it.

- [ ] **Step 2: Production build.** Stop the dev server first (`TaskStop` on the frontend background task, or PowerShell `Get-NetTCPConnection -LocalPort 3000 | % { Stop-Process -Id $_.OwningProcess -Force }`), then:
```bash
rm -rf .next && npx next build
```
Expected: build succeeds and prints every route. Record page sizes; the landing route must not ship three.js any more. Then restart the dev server: `rm -rf .next && PORT=3000 npx next dev` (background).

- [ ] **Step 3: Full sweep with screenshots**

Run: `node scripts/ui-sweep.mjs --shots C:/Users/arjun/AppData/Local/Temp/claude/C--Users-arjun-f1-pitwall/d55088ff-067b-4806-8dde-d1c09bda824a/scratchpad/final-shots`
Expected: every route x viewport prints `ok` (13 routes x 3 viewports). Open a representative screenshot per route with the Read tool and run the critique checklist one last time; fix and re-run for anything below the bar (in particular check that no page still looks like the old design, and that the hierarchy differs between the landing hero, the workspace, and a data table page).

- [ ] **Step 4: Keyboard-only and reduced-motion passes**

Run: `node scripts/palette-check.mjs`; then in Chrome with `Emulation.setEmulatedMedia` `prefers-reduced-motion: reduce`, load `/` and confirm the tower is in finish order immediately with no lights. Tab from the top of `/stats`: the first stop is "Skip to content", then the rail links, then the top bar controls; every stop shows a visible ring (screenshot two of them).

- [ ] **Step 5: Docs.** In `README.md` add a short "Design system" section: the rule that colour only carries meaning, the token file location, the primitives directory, how to add a module (one `MODULES` entry plus a page), and the commands (`npm test`, `npm run typecheck`, `node scripts/ui-sweep.mjs`). Update the README's screenshot/feature lists if they mention the removed 3D landing scene.

- [ ] **Step 6: Commit**
```bash
git add README.md
git commit -m "docs: describe the design system and how to add a module

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hand-off report** to the user, stating plainly: what shipped, what was verified and how, what was not (for example: real live-session data, real Postgres, AI-written text with a real key), and that sub-projects 2 to 5 (the reference repo's modules) are next, each as its own design, plan and verification cycle. The report must list any check that was skipped or failed and why.
