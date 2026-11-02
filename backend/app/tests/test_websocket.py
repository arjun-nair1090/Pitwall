import pytest
from unittest.mock import AsyncMock
from fastapi import WebSocket
from fastapi.testclient import TestClient

from app.main import app
from app.websocket import manager as manager_module
from app.websocket.manager import ConnectionManager


@pytest.mark.asyncio
async def test_send_personal_message_goes_to_that_socket_only():
    manager = ConnectionManager()
    mine, other = AsyncMock(spec=WebSocket), AsyncMock(spec=WebSocket)
    assert await manager.connect(mine) and await manager.connect(other)

    await manager.send_personal_message("Hello Test", mine)

    mine.send_text.assert_called_once_with("Hello Test")
    other.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_broadcast_reaches_every_socket_and_skips_disconnected_ones():
    manager = ConnectionManager()
    a, b = AsyncMock(spec=WebSocket), AsyncMock(spec=WebSocket)
    await manager.connect(a)
    await manager.connect(b)
    await manager.disconnect(b)
    await manager.disconnect(b)  # twice is harmless

    await manager.broadcast("lap 12")

    a.send_text.assert_called_once_with("lap 12")
    b.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_a_full_server_turns_new_sockets_away(monkeypatch):
    monkeypatch.setattr(manager_module, "MAX_CONNECTIONS", 1)
    manager = ConnectionManager()
    first, second = AsyncMock(spec=WebSocket), AsyncMock(spec=WebSocket)
    assert await manager.connect(first) is True
    assert await manager.connect(second) is False
    second.accept.assert_not_called()
    second.close.assert_called_once_with(code=1013)


def test_two_clients_with_the_same_id_cannot_knock_each_other_off():
    # The id is picked by the client (four random characters), so it must not identify the connection:
    # a second socket using it used to replace the first one's entry and silence it.
    client = TestClient(app)
    with client.websocket_connect("/ws/pitwall-client-abcd") as first, \
            client.websocket_connect("/ws/pitwall-client-abcd") as second:
        first.send_text("one")
        second.send_text("two")
        assert first.receive_text() == "Received: one"
        assert second.receive_text() == "Received: two"
        assert len(manager_module.manager.active_connections) == 2
    assert len(manager_module.manager.active_connections) == 0
