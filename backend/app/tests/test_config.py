import importlib



def _reload_settings():
    from app.core import config
    importlib.reload(config)
    return config.settings


def test_chroma_connection_defaults_to_docker_service_name(monkeypatch):
    monkeypatch.delenv("RUNNING_LOCALLY", raising=False)
    monkeypatch.delenv("CHROMA_HOST", raising=False)
    monkeypatch.delenv("CHROMA_PORT", raising=False)
    settings = _reload_settings()
    assert settings.CHROMA_CONNECTION_HOST == "chromadb"
    assert settings.CHROMA_CONNECTION_PORT == 8000


def test_chroma_connection_swaps_to_localhost_when_running_locally(monkeypatch):
    monkeypatch.setenv("RUNNING_LOCALLY", "true")
    monkeypatch.delenv("CHROMA_HOST", raising=False)
    monkeypatch.delenv("CHROMA_PORT", raising=False)
    settings = _reload_settings()
    assert settings.CHROMA_CONNECTION_HOST == "localhost"
    assert settings.CHROMA_CONNECTION_PORT == 8001
