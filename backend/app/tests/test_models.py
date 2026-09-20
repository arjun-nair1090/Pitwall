from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.models import PredictionModel, UserModel


def test_user_and_prediction_models_create_tables_and_round_trip():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    user = UserModel(email="test@example.com", display_name="Tester", password_hash="hashed")
    db.add(user)
    db.commit()
    db.refresh(user)

    prediction = PredictionModel(
        user_id=user.id, year=2026, event_name="Belgian Grand Prix",
        predicted_p1="VER", predicted_p2="NOR", predicted_p3="LEC",
    )
    db.add(prediction)
    db.commit()
    db.refresh(prediction)

    assert prediction.id is not None
    assert prediction.points_awarded is None
    assert prediction.user_id == user.id


def test_prediction_unique_constraint_rejects_duplicate_user_year_event():
    import pytest
    from sqlalchemy.exc import IntegrityError

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    user = UserModel(email="test2@example.com", display_name="Tester2", password_hash="hashed")
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(PredictionModel(user_id=user.id, year=2026, event_name="Belgian Grand Prix", predicted_p1="VER", predicted_p2="NOR", predicted_p3="LEC"))
    db.commit()

    db.add(PredictionModel(user_id=user.id, year=2026, event_name="Belgian Grand Prix", predicted_p1="HAM", predicted_p2="RUS", predicted_p3="ALO"))
    with pytest.raises(IntegrityError):
        db.commit()
