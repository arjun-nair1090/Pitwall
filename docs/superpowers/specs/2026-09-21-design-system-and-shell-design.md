# Design system, app shell and UI redesign ("Timing Screen")

Status: approved by the user on 2026-09-21. Sub-project 1 of 5.

## Context

The reference repo `WarmBed/PITWALL` contains no source code. It is a showcase
(README, screenshots, sample reports) of a closed-source desktop F1 analysis
workstation with about 35 modules. "Include everything from the repo" therefore
means rebuilding those modules on this project's FastAPI + Next.js stack, using
the README as the functional description. No screenshot, report, PDF or video
from that repo is copied into this project.

The work is split into five sub-projects, each with its own design, plan and
verification cycle:

1. **Design system, shell and redesign of all existing pages** (this document)
2. Historical analysis modules: temperature, track, pit stops, accidents and
   flags, tyre strategy, position chart, traffic
3. Telemetry and lap performance: synchronised multi-channel traces, channel
   views, delta, lap table, lap-time box plot, throttle-by-corner, pedal
   behaviour, long-run fuel correction, ideal lap, straight-line speed,
   brake/acceleration, corner classification
4. AI prediction and multi-season: FP to qualifying model, qualifying to race
   model, historical track map with incident overlay, season start reaction
5. Live expansion: circle map, chase strategy, battle insight, pit window,
   tyre life warnings, sector comparison, SF% history, top-speed history, lap
   history heatmaps, lap-time distribution, traffic timeline, race-control
   filters

Sub-projects 2 to 5 depend only on the module registry and UI primitives that
this sub-project delivers.

## Goals

- A distinctive, F1-specific visual identity across every page, not a generic
  dark dashboard.
- One shell (navigation, command palette, mobile tab bar) and one set of
  primitives, so the ~35 future modules drop in without shell changes.
- `/live` becomes a draggable, resizable workspace with per-browser saved
  layouts.
- No regression in behaviour: every existing route keeps working, keeps its
  data flow and keeps or improves its accessibility.

## Non-goals

New analysis modules, backend changes, a light theme, translations.

## Visual language

**Rule: colour only carries meaning.** Chrome is greys and white. Colour appears
only as data: timing semantics, live/danger red, tyre compounds, team colours.
There is no brand accent colour. The former cyan accent, all-caps labels and
monospace data labels are removed.

| Token | Role | Value |
|---|---|---|
| `tarmac` | page ground | `#13161B` |
| `kerb` | panel surface | `#1B1F26` |
| `gantry` | hairlines, dividers | `#2A303A` |
| `chalk` | primary text | `#E8EBEF` |
| `timing-purple` | overall best | `#B57BFF` |
| `timing-green` | personal best | `#35D07F` |
| `timing-yellow` | off pace, caution | `#F6C945` |
| `f1-red` | live indicator and alerts only | `#E10600` |

Tyre compound colours stay as in `lib/compounds.ts`. Team colours come from a
single lookup in `lib/timing.ts`. Every text/background pair is checked against
WCAG AA programmatically; failing pairs are adjusted, not excused.

**Type.** Big Shoulders Display for headlines and position numerals. Barlow
Semi Condensed for UI and data, with tabular numerals so lap times align. Both
via `next/font/google` with system fallbacks. Tabular figures are confirmed by
measuring the rendered glyph widths; if they fail, the data face becomes IBM
Plex Sans Condensed. Labels use sentence case.

**Shape.** Graded radii (panels 6px, controls 4px, pills full). Hairline borders
carry structure; shadows are not used for hierarchy.

**Motion.** One orchestrated moment: on the landing page, on the first visit of
a browser session, five start lights come on and go out, then the race tower
moves from grid order to finish order. Skippable, played once per session,
instant under `prefers-reduced-motion`. The only other motion is row reordering
in the live tower. Interaction feedback (expand, collapse, palette open) is
allowed.

## Shell

- Desktop: left icon rail (56px, expands on hover and focus to show labels), top
  bar with session context, a Ctrl+K trigger and the live indicator.
- Mobile: bottom tab bar (five entries plus "More"), slim top bar, palette opens
  as a full-screen sheet. Touch targets are at least 40px.
- Command palette: accessible combobox (`role="combobox"`, `aria-activedescendant`,
  listbox), opens with Ctrl+K and `/`, searches modules, drivers and races,
  fully keyboard operable, focus is trapped and restored.

## Architecture

```
frontend/src/
  design/tokens.css        CSS variables; tailwind.config.ts maps to them
  components/ui/           Panel, Button, IconButton, Select, Tabs, Pill,
                           DataTable, Skeleton, EmptyState, Kbd
  components/shell/        AppShell, Rail, TopBar, MobileTabBar, CommandPalette
  components/charts/       chartTheme.ts shared by every Recharts chart
  lib/modules.ts           module registry: id, title, group, href, keywords, icon
  lib/timing.ts            classifyLap, formatLapTime, formatGap, teamColor
  lib/layoutStore.ts       persisted workspace layouts (localStorage, versioned)
```

- The rail, palette and mobile menu all derive from `modules.ts`. Adding a
  module in a later sub-project is one registry entry plus its page.
- `lib/timing.ts` and the registry search are pure and unit-tested.
- `/live` uses `react-grid-layout` for its five existing panels (timing tower,
  gap evolution, telemetry, AI console, team radio); the alert banner stays a
  fixed strip above the workspace. Each
  panel has expand-to-fullscreen ("pop out" means full-screen overlay; a real
  second window cannot share state cleanly). Layouts are versioned so a future
  panel change does not break saved layouts. Fallback if the dependency cannot
  be installed: fixed responsive layout with expand and collapse, no drag.
- Legacy Tailwind names (`f1-cyan`, `glass-panel`, `font-titillium`) remain as
  aliases until the last page is migrated, then are deleted.
- The 3D `RacingScene`, `BackgroundScene` and the `three`, `@react-three/fiber`,
  `@react-three/drei`, `@types/three` dependencies are removed once the landing
  page no longer uses them.
- The landing hero is a real race tower built from the most recent completed
  race's classification via the existing API; if the API is unavailable it shows
  a clear empty state, not fake data.

## Pages in scope

`/`, `/live`, `/map`, `/stats`, `/compare`, `/strategy`, `/archive`,
`/drivers/[code]`, `/debrief`, `/predictions`, `/login`, `/changelog`, and the
user's uncommitted `/advanced` page with `PedalBehaviorChart`. The `/advanced`
work is a separate commit and replaces its hardcoded `http://localhost:8000`
with the shared API client. `backend/app/services/f1_data_service.py` (the
user's uncommitted change) is not touched.

## Error handling

Every data panel renders one of four explicit states: loading (Skeleton), empty
(EmptyState with the next action), error (ErrorState with retry and a readable
message via `getApiErrorMessage`), or data. Errors say what happened and what to
do; they do not apologise.

## Accessibility floor

Visible `:focus-visible` rings on every control, WCAG AA contrast, all
form controls labelled, one `h1` per page, reduced-motion respected, keyboard
reachable palette and panel actions, no horizontal page scroll at 390px.

## Verification

- `tsc --noEmit`, `next lint` and a production `next build` pass.
- Vitest covers `timing.ts`, registry search and `layoutStore`.
- A Chrome DevTools Protocol sweep runs every route at 390, 768 and 1280px and
  fails on overflow, uncaught exceptions, unlabelled controls, missing `h1`, and
  contrast below AA.
- Screenshots of every page are reviewed and critiqued before each commit.
- A keyboard-only pass covers the palette and the workspace panel actions.
- The existing backend suite (295 tests) still passes; no backend change is made.

## Risks

- Google Fonts fetched at build time need network; fallbacks keep the UI usable
  offline.
- `react-grid-layout` under Next.js SSR needs a client-only wrapper; covered by
  the fallback above.
- Roughly 13 pages are restyled; work proceeds primitives, then shell, then
  pages one at a time, each verified and committed separately.
