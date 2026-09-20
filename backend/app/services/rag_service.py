from typing import Optional

import chromadb

from app.core.config import settings

COLLECTION_NAME = "f1_race_history"

_client: Optional["chromadb.ClientAPI"] = None


def _get_client() -> "chromadb.ClientAPI":
    global _client
    if _client is None:
        _client = chromadb.HttpClient(
            host=settings.CHROMA_CONNECTION_HOST,
            port=settings.CHROMA_CONNECTION_PORT,
        )
    return _client


def get_collection():
    """Get-or-create the historical race collection. Raises on connection failure --
    callers that must never break (like query_historical_context) catch around this."""
    return _get_client().get_or_create_collection(COLLECTION_NAME)


def query_historical_context(question: str, n_results: int = 5) -> str:
    """Returns a markdown section of relevant historical race summaries, or "" if
    Chroma is unreachable or nothing relevant has been ingested yet. Never raises."""
    try:
        collection = get_collection()
        results = collection.query(query_texts=[question], n_results=n_results)
    except Exception as e:
        print(f"RAG retrieval unavailable, continuing live-only: {e}")
        return ""

    documents = results.get("documents") or [[]]
    metadatas = results.get("metadatas") or [[]]
    documents = documents[0] if documents else []
    metadatas = metadatas[0] if metadatas else []

    if not documents:
        return ""

    lines = ["## Historical Context (RAG)"]
    for doc, meta in zip(documents, metadatas):
        meta = meta or {}
        tag = f"{meta.get('year', '?')} {meta.get('event', 'Unknown Event')} — {meta.get('session', '?')} — {meta.get('driver_code', '?')}"
        lines.append(f"- [{tag}]: {doc}")

    return "\n".join(lines)
