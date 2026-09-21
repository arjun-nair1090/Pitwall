# F1 Pit Wall Historical Telemetry Platform

## Overview
The F1 Pit Wall Platform is an ultra-high-performance historical telemetry and strategy visualization engine. Designed to replicate the professional environments of top-tier Formula 1 teams, this application allows users to deeply analyze past races, compare driver telemetry, and watch historical race replays.

## Key Features

### 🏁 Track Map & Mini Race Replay
- **Professional Aesthetics:** Modern, sleek circuit maps styled like real F1 broadcast graphics, utilizing high-performance SVG rendering.
- **Auto-Lap Progression:** Sit back and watch an entire race unfold. The replay engine automatically fetches and progresses to the next lap when a driver crosses the finish line, pausing gracefully at the end of the race.
- **Playback Controls:** Fully integrated telemetry player with adjustable playback speeds (1x, 2x, 5x, 10x) and scrubbers.

### Pages that work from a real race

Head to head, Advanced analytics, the Strategy simulator and the Track map replay all start from the
same picker: a season, then only races that have finished, then only the sessions that weekend ran.
Races are identified by round number, and any of these pages can be opened on a race from a link, for
example `/compare?year=2024&round=14&d1=VER&d2=NOR`, `/advanced?year=2024&round=14&session=Q`,
`/strategy?year=2024&round=14` or `/map?year=2024&round=14`.

The backend endpoints behind them: `GET /api/v1/races/session-info` (drivers, team colours, race
distance and each driver's real stints), `GET /api/v1/races/results`, `POST /api/v1/telemetry/compare`,
`POST /api/v1/telemetry/pedal-behavior`, `POST /api/v1/strategy/simulate` and `GET /api/v1/telemetry/replay`.

### 🏎️ Telemetry Head-to-Head Comparison
- **High-Fidelity Telemetry:** Compare any two drivers across 6 metrics (Speed, Throttle, Brake, Gear, RPM, DRS) using full 60Hz high-resolution data pulled from FastF1.
- **Custom Lap Selection:** Compare the fastest laps of the session automatically, or specify exact laps for detailed stint analysis.
- **Smooth Visuals:** Recharts-powered graphs using `basis` curve interpolation for buttery-smooth, continuous telemetry curves that look straight off an engineer's monitor.
- **Synchronized Tooltips:** Hover over a braking zone in one chart to instantly see the exact RPM, Gear, Speed, and Throttle the driver was using at that exact moment across all charts.

### 📚 Historical Archive
- **Race Calendar Filtering:** Actively filters the season calendar to only show completed races up to the current date.
- **Dynamic Session Loading:** Easily switch between FP1, FP2, FP3, Qualifying, Sprint, and Race sessions.

### 🧠 AI Race Engineer, Debrief & What-if
- **Race Debrief (`/debrief`):** An auto-written summary of any race since 2018 -- result, podium gaps, fastest lap, tyre strategies, biggest climbers, retirements and safety cars -- with shareable links (`/debrief?year=2023&race=Belgian Grand Prix`).
- **What-if counterfactuals:** Move a real driver's pit stop or change a stint's compound and see what the tyre-degradation model says it would have done to their race time. Implemented as a small LangGraph flow (`simulate` -> `explain`).
- **Grounded by design:** every number comes from deterministic code over the official FastF1 data; the LLM only writes the wording, its output is checked against the real result, and both features fall back to a template if no API key is configured or the model's answer doesn't check out.
- **Historical RAG:** the live AI Race Engineer can also answer cross-season questions from an ingested history corpus (see below).

### 🎯 Accounts & Prediction Game
- Email + password accounts (bcrypt, JWT in an httpOnly cookie, CSRF protection, server-side logout).
- Call the top 3 for an upcoming race; picks lock at lights-out (checked against the official UTC schedule) and are scored against the real result: 25 points for an exact podium, 10 per driver in the real top 3. Public season leaderboard.
- Known gaps, by design: no email verification / password reset, no rate limiting on login and signup, and signup reveals whether an email is registered.

## Design system ("Timing Screen")

The look is the official one: the near-black navy of a Formula 1 broadcast feed, F1 red, and squared-off
graphics cut with a hairline rather than a curve.

The UI follows one rule: **colour only carries meaning.** Chrome is greys and white; colour appears only as
timing semantics (purple overall best, green personal best, yellow off pace), live/danger red, tyre compounds
and team colours. Red has exactly three jobs — the frame (the wordmark, the rule under the top bar, the bar
beside a page title), the primary action, and the on-air state. Nothing else is ever a solid red block.

White marks the thing you are on: the current page in the sidebar and the mobile tab bar, the selected tab,
the channels switched on.

- Tokens: `frontend/src/design/tokens.css` (checked for WCAG AA contrast by `tokens.test.ts`); Tailwind maps them in `tailwind.config.ts`.
- Primitives: `frontend/src/components/ui/` (Panel, Button, Select, Input, Tabs, DataTable, ...). Shell and command palette: `components/shell/`.
- Type: Titillium Web for headlines, captions, labels and single numerals — the squared bowls and flat-cut
  terminals of F1's own (proprietary) broadcast face — and Barlow Semi Condensed for UI and data (tabular
  figures). Both self-hosted.
- Upper case is the display face's voice: page titles, panel captions, column headers, form labels and
  navigation. Prose — descriptions, empty states, errors, buttons — stays in sentence case, and
  `check-legacy.mjs` fails on `uppercase` that isn't paired with `font-display`.
- Tables read as timing towers: the team's colour flush to the left edge of the row, faint banding, tabular
  figures and the position in the display face.
- Adding a page: one entry in `frontend/src/lib/modules.ts` (the rail, mobile tab bar, palette and landing page all read it) plus the page itself.
- Checks: `npm test`, `npm run typecheck`, `node scripts/check-legacy.mjs --all` (no legacy styles), and `node scripts/ui-sweep.mjs`
  (overflow, crashes, labels, heading count and contrast at 390/768/1280px; needs the dev server and API running).

## Tech Stack
- **Frontend**: Next.js 14, React, Tailwind CSS, Recharts, framer-motion, react-grid-layout, Lucide React.
- **Backend**: Python 3.12, FastAPI, FastF1 (Data Engine), SQLAlchemy + PostgreSQL, Redis, ChromaDB, LangGraph.
- **AI**: Anthropic (default `claude-opus-5`) with an OpenAI fallback; both model IDs are configurable via `ANTHROPIC_MODEL` / `OPENAI_MODEL`.
- **Infrastructure**: Docker, Docker Compose.

## Running Locally

Requirements: Docker and Docker Compose.

```bash
# Copy the environment template and fill in real values (SECRET_KEY at minimum)
cp .env.example .env

# Build and start the containers
docker compose up --build -d

# The frontend will be available at http://localhost:3000
# The backend API will be available at http://localhost:8000
```

See `.env.example` for the full list of environment variables (database, Redis, LLM API keys, FastF1 config).

## Seeding historical data for the AI Race Engineer (optional)

The AI Race Engineer can answer cross-season questions ("how did Verstappen's
strategy at Spa compare across recent years") if its historical corpus has been
built. This is a manual, one-time (or periodic) step — it's not required for
the app to run, and the AI Engineer works live-session-only until you do this:

```bash
docker compose exec backend python -m app.scripts.ingest_history --years 2018-2025
```

This can take several hours the first time (FastF1 loads each session fresh).
It's safe to interrupt (Ctrl-C) and rerun later — already-ingested sessions are
skipped. Rerun periodically with just the new year (`--years 2026`) to pick up
newly-completed race weekends.
