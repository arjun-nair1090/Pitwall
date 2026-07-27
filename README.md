# F1 Pit Wall Platform: Architecture Blueprint

## Overview
The F1 Pit Wall Platform is an ultra-high-performance, real-time telemetry and strategy engine designed to replicate the professional environments of top-tier Formula 1 teams.

## System Architecture

### 1. High-Level Topology
A distributed, microservice-oriented architecture optimized for low-latency data streaming and heavy computational workloads (ML/AI).

- **Frontend (The Command Center)**: Next.js 15 application utilizing React 19 for high-frequency UI updates. It leverages WebSockets for live telemetry streams and Three.js/R3F for 3D track visualizations.
- **Backend (The Engine Room)**: FastAPI-based Python service cluster handling complex data processing from FastF1 and OpenF1 APIs.
- **Data Layer**: 
    - **PostgreSQL**: Persistent storage for historical race results, driver profiles, and session metadata.
    - **Redis**: High-speed caching layer for real-time telemetry, live position tracking, and WebSocket pub/sub.
    - **ChromaDB**: Vector database powering the RAG (Retrieval-Augmented Generation) architecture for the AI Race Engineer.
- **AI Layer**: LangChain/LangGraph orchestration managing interactions between Claude/OpenAI models and the telemetry datasets.

### 2. Data Flow Pipeline
1.  **Ingestion**: Python workers poll OpenF1 (real-time) and FastF1 (historical) APIs.
2.  **Processing**: Real-time data is parsed, normalized, and enriched with ML-based predictive models (e.g., tire degradation).
3.  **Distribution**: Processed telemetry is pushed to Redis. A WebSocket gateway broadcasts these updates to all connected frontend clients.
4.  **Consumption**: Next.js components react to incoming WebSocket frames to update UI elements (gap times, sector splits) and 3D car positions instantaneously.

### 3. Tech Stack Detail
- **Frontend**: React 19, Next.js 15, TypeScript, Tailwind CSS, Framer Motion, Three.js, React Three Fiber, Shadcn UI, Zustand.
- **Backend**: Python 3.12, FastAPI, SQLAlchemy, Pydantic v2, WebSockets, LangChain, LangGraph.
- **Infrastructure**: Docker, Docker Compose, Redis, PostgreSQL, ChromaDB.

## Directory Structure
See the initialized directory tree in the project root.
