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

## Tech Stack
- **Frontend**: Next.js 14, React, Tailwind CSS, Recharts, Lucide React.
- **Backend**: Python 3.12, FastAPI, FastF1 (Data Engine).
- **Infrastructure**: Docker, Docker Compose.

## Running Locally

Requirements: Docker and Docker Compose.

```bash
# Build and start the containers
docker compose up --build -d

# The frontend will be available at http://localhost:3000
# The backend API will be available at http://localhost:8000
```
