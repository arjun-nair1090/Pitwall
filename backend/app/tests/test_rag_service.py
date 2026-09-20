import chromadb
import pytest
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

from app.services import rag_service


class FakeEmbeddingFunction(EmbeddingFunction):
    """Deterministic, dependency-free stand-in so tests never download the real model."""

    def __init__(self):
        pass

    def __call__(self, input: Documents) -> Embeddings:
        return [[float(len(doc) % 7), float(sum(ord(c) for c in doc) % 13)] for doc in input]

    @staticmethod
    def name() -> str:
        return "fake"


@pytest.fixture
def fake_collection(request):
    # EphemeralClient() instances share underlying storage per collection name within
    # the same process, so each test needs its own collection name for real isolation.
    client = chromadb.EphemeralClient()
    return client.get_or_create_collection(
        f"test_{request.node.name}", embedding_function=FakeEmbeddingFunction()
    )


def test_query_historical_context_formats_hits(monkeypatch, fake_collection):
    fake_collection.upsert(
        ids=["2023_belgian-grand-prix_race_ver"],
        documents=["Max Verstappen won at Spa in 2023 on a two-stop strategy."],
        metadatas=[{"year": 2023, "event": "Belgian Grand Prix", "session": "Race", "driver_code": "VER", "team": "Red Bull Racing"}],
    )
    monkeypatch.setattr(rag_service, "get_collection", lambda: fake_collection)

    result = rag_service.query_historical_context("How did Verstappen do at Spa?", n_results=5)

    assert "## Historical Context (RAG)" in result
    assert "2023 Belgian Grand Prix" in result
    assert "VER" in result
    assert "two-stop strategy" in result


def test_query_historical_context_empty_collection_returns_empty_string(monkeypatch, fake_collection):
    monkeypatch.setattr(rag_service, "get_collection", lambda: fake_collection)
    result = rag_service.query_historical_context("Anything about 1994?")
    assert result == ""


def test_query_historical_context_swallows_connection_errors(monkeypatch):
    def _raise():
        raise ConnectionError("chromadb unreachable")

    monkeypatch.setattr(rag_service, "get_collection", _raise)
    result = rag_service.query_historical_context("How did Verstappen do at Spa?")
    assert result == ""


def test_get_driver_season_documents_returns_matching_races_sorted_by_event(monkeypatch, fake_collection):
    fake_collection.upsert(
        ids=["2023_dutch-grand-prix_race_ver", "2023_belgian-grand-prix_race_ver", "2023_belgian-grand-prix_race_ham"],
        documents=["Dutch GP summary.", "Belgian GP summary.", "Belgian GP summary for HAM."],
        metadatas=[
            {"year": 2023, "event": "Dutch Grand Prix", "session": "Race", "driver_code": "VER", "team": "Red Bull Racing"},
            {"year": 2023, "event": "Belgian Grand Prix", "session": "Race", "driver_code": "VER", "team": "Red Bull Racing"},
            {"year": 2023, "event": "Belgian Grand Prix", "session": "Race", "driver_code": "HAM", "team": "Mercedes"},
        ],
    )
    monkeypatch.setattr(rag_service, "get_collection", lambda: fake_collection)

    results = rag_service.get_driver_season_documents(2023, "VER")

    assert [r["event"] for r in results] == ["Belgian Grand Prix", "Dutch Grand Prix"]
    assert results[0]["document"] == "Belgian GP summary."


def test_get_driver_season_documents_returns_empty_list_when_uningested(monkeypatch, fake_collection):
    monkeypatch.setattr(rag_service, "get_collection", lambda: fake_collection)
    assert rag_service.get_driver_season_documents(2023, "VER") == []


def test_get_driver_season_documents_swallows_connection_errors(monkeypatch):
    def _raise():
        raise ConnectionError("chromadb unreachable")

    monkeypatch.setattr(rag_service, "get_collection", _raise)
    assert rag_service.get_driver_season_documents(2023, "VER") == []
