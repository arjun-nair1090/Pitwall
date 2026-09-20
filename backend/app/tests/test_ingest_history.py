import chromadb
import pytest
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

from app.scripts.ingest_history import parse_years_arg, session_already_ingested


class FakeEmbeddingFunction(EmbeddingFunction):
    def __init__(self):
        pass

    def __call__(self, input: Documents) -> Embeddings:
        return [[float(len(doc) % 7)] for doc in input]

    @staticmethod
    def name() -> str:
        return "fake"


def test_parse_years_arg_expands_range():
    assert parse_years_arg(["2018-2020"]) == [2018, 2019, 2020]


def test_parse_years_arg_accepts_individual_years():
    assert parse_years_arg(["2018", "2020"]) == [2018, 2020]


def test_parse_years_arg_mixes_ranges_and_singles():
    assert parse_years_arg(["2018-2019", "2023"]) == [2018, 2019, 2023]


def test_session_already_ingested_true_when_docs_exist():
    client = chromadb.EphemeralClient()
    collection = client.get_or_create_collection("test_already_ingested_true", embedding_function=FakeEmbeddingFunction())
    collection.upsert(
        ids=["2023_belgian-grand-prix_race_ver"],
        documents=["placeholder"],
        metadatas=[{"year": 2023, "event": "Belgian Grand Prix", "session": "Race", "driver_code": "VER", "team": "Red Bull Racing"}],
    )
    assert session_already_ingested(collection, 2023, "Belgian Grand Prix", "Race") is True


def test_session_already_ingested_false_when_absent():
    client = chromadb.EphemeralClient()
    collection = client.get_or_create_collection("test_already_ingested_false", embedding_function=FakeEmbeddingFunction())
    assert session_already_ingested(collection, 2022, "Belgian Grand Prix", "Race") is False
