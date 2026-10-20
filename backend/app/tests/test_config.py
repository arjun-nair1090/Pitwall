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


def test_database_url_names_the_installed_psycopg2_driver():
    # SQLAlchemy 2.1 maps a bare postgresql:// to psycopg 3, which isn't installed
    from sqlalchemy.engine import make_url
    settings = _reload_settings()
    assert make_url(settings.DATABASE_URL).drivername == "postgresql+psycopg2"
