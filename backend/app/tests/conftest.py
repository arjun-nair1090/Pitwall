from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app

# Tests never trigger the app's real lifespan (TestClient is used directly,
# never as a context manager, so Base.metadata.create_all() against the real
# configured engine never runs) -- but endpoints that use Depends(get_db)
# still need *some* working database, so this overrides it with an in-memory
# SQLite shared across the whole test run via StaticPool.
_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

Base.metadata.create_all(bind=_engine)


def _override_get_db():
    db = _TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db
