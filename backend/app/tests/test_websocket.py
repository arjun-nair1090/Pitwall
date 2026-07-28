import pytest
from unittest.mock import AsyncMock
from app.websocket.manager import ConnectionManager
from fastapi import WebSocket

@pytest.mark.asyncio
async def test_send_personal_message_success():
    manager = ConnectionManager()
    client_id = "test_user"

    # Mock WebSocket object
    mock_ws = AsyncMock(spec=WebSocket)
    manager.active_connections[client_id] = mock_ws

    message = "Hello Test"
    await manager.send_personal_message(message, client_id=client_id)

    # Verify send_text was called with the correct message
    mock_ws.send_text.assert_called_once_with(message)

@pytest.mark.asyncio
async def test_send_personal_message_no_connection():
    manager = ConnectionManager()
    client_id = "non_existent"

    # Should not raise an error even if client is not in connections
    await manager.send_personal_message("Hello", client_id)

@pytest.mark.asyncio
async def test_send_personal_message_wrong_client():
    manager = ConnectionManager()
    actual_id = "user_a"
    wrong_id = "user_b"

    mock_ws = AsyncMock(spec=WebSocket)
    manager.active_connections[actual_id] = mock_ws

    await manager.send_personal_message("Hello", client_id=wrong_id)

    # Should not have called send_text for user_b since it's not in connections
    mock_ws.send_text.assert_not_called()
