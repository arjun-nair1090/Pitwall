from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
from app.websocket.manager import manager
from app.services.f1_data_service import f1_service
from app.services.redis_service import redis_service
from app.api.v1.endpoints import router as api_router
from app.core.database import Base, engine

# Initialize database tables on startup
try:
    Base.metadata.create_all(bind=engine)
    print("Database tables initialized successfully.")
except Exception as e:
    print(f"Error initializing database tables: {e}")

app = FastAPI(title="F1 Pit Wall API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connect api endpoints
app.include_router(api_router, prefix="/api/v1")

@app.get("/")
async def root():
    return {"status": "F1 Pit Wall API is Online", "version": "0.1.0"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            print(f"Message from {client_id}: {data}")
            # Echo message or handle custom subscription requests
            await manager.send_personal_message(f"Received: {data}", client_id)
    except WebSocketDisconnect:
        await manager.disconnect(client_id)
    except Exception as e:
        print(f"WebSocket Error for {client_id}: {e}")
        await manager.disconnect(client_id)

@app.on_event("startup")
async def startup_event():
    # Connect to Redis
    await redis_service.connect()

    # Task 1: Telemetry Streamer - Fetches real OpenF1 telemetry and broadcasts to Redis
    async def telemetry_streamer():
        print("Starting real F1 live telemetry streamer task...")
        while True:
            try:
                session_key = await f1_service.get_latest_session_key()
                await f1_service.stream_live_telemetry(session_key)
            except Exception as e:
                print(f"Error in live telemetry streamer task: {e}")
            await asyncio.sleep(1)

    # Task 2: Redis Subscriber - Listens to Redis pub/sub and broadcasts to WebSockets
    async def redis_subscriber():
        pubsub = await redis_service.subscribe("telemetry:live")
        if pubsub:
            print("Redis Subscriber started for channel 'telemetry:live'")
            try:
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        await manager.broadcast(message["data"])
            except Exception as e:
                print(f"Redis Subscriber Error: {e}")
        else:
            print("Could not subscribe to Redis 'telemetry:live' channel.")

    asyncio.create_task(telemetry_streamer())
    asyncio.create_task(redis_subscriber())
