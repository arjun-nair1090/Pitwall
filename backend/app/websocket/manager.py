from fastapi import WebSocket
from typing import Set

# Live timing is a broadcast; past this many viewers new sockets are told to retry (close code 1013).
MAX_CONNECTIONS = 500


class ConnectionManager:
    def __init__(self):
        # Tracked by the socket itself, never by the id in the URL: the client picks that id, so keying
        # on it let one visitor replace (and silence) another's connection.
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> bool:
        """Accepts the socket, or turns it away when the server is full. True if it was accepted."""
        if len(self.active_connections) >= MAX_CONNECTIONS:
            await websocket.close(code=1013)
            return False
        await websocket.accept()
        self.active_connections.add(websocket)
        print(f"Client connected. Total clients: {len(self.active_connections)}")
        return True

    async def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.discard(websocket)
            print(f"Client disconnected. Total clients: {len(self.active_connections)}")

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        """Broadcasts a message to all connected clients."""
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception as e:
                print(f"Error broadcasting to client: {e}")

# Global instance
manager = ConnectionManager()
