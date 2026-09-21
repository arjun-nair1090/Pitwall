# F1 Pit Wall Historical Telemetry Platform

## Overview
The F1 Pit Wall Platform is an ultra-high-performance historical telemetry and strategy visualization engine. Designed to replicate the professional environments of top-tier Formula 1 teams, this application allows users to deeply analyze past races, compare driver telemetry, and watch historical race replays.

## Key Features

### 🏁 Track Map & Mini Race Replay
- **Professional Aesthetics:** Modern, sleek circuit maps styled like real F1 broadcast graphics, utilizing high-performance SVG rendering.
- **Auto-Lap Progression:** Sit back and watch an entire race unfold. The replay engine automatically fetches and progresses to the next lap when a driver crosses the finish line, pausing gracefully at the end of the race.
- **Playback Controls:** Fully integrated telemetry player with adjustable playback speeds (1x, 2x, 5x, 10x) and scrubbers.

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

The UI follows one rule: **colour only carries meaning.** Chrome is greys and white; colour appears only as
timing semantics (purple overall best, green personal best, yellow off pace), live/danger red, tyre compounds
and team colours.

- Tokens: `frontend/src/design/tokens.css` (checked for WCAG AA contrast by `tokens.test.ts`); Tailwind maps them in `tailwind.config.ts`.
- Primitives: `frontend/src/components/ui/` (Panel, Button, Select, Input, Tabs, DataTable, ...). Shell and command palette: `components/shell/`.
- Type: Big Shoulders Display for headlines and single numerals, Barlow Semi Condensed for UI and data (tabular figures), both self-hosted.
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
