from datetime import datetime
from typing import Optional, Tuple

import pandas as pd

from app.services.f1_data_service import FALLBACK_2024_DRIVERS

KNOWN_DRIVER_CODES = {d["code"] for d in FALLBACK_2024_DRIVERS}

EXACT_MATCH_POINTS = 25
PARTIAL_MATCH_POINTS_PER_DRIVER = 10


def validate_prediction(predicted_p1: str, predicted_p2: str, predicted_p3: str) -> Optional[str]:
    codes = [predicted_p1, predicted_p2, predicted_p3]
    for code in codes:
        if code.upper() not in KNOWN_DRIVER_CODES:
            return f"Unknown driver code '{code}'."
    if len(set(codes)) != 3:
        return "Predictions must name three distinct drivers."
    return None


def race_has_started(event_schedule_row: pd.Series, now: datetime) -> bool:
    for i in range(1, 6):
        if event_schedule_row.get(f"Session{i}") == "Race":
            race_date = event_schedule_row.get(f"Session{i}Date")
            if race_date is None or pd.isna(race_date):
                return False
            race_date_naive = pd.Timestamp(race_date).tz_localize(None)
            return race_date_naive <= pd.Timestamp(now)
    return False


def score_prediction(predicted: Tuple[str, str, str], actual_top3: Tuple[str, str, str]) -> int:
    if tuple(predicted) == tuple(actual_top3):
        return EXACT_MATCH_POINTS
    correct_drivers = set(predicted) & set(actual_top3)
    return len(correct_drivers) * PARTIAL_MATCH_POINTS_PER_DRIVER
