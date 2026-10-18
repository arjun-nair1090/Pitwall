"""Corner-by-corner lap analysis over FastF1 telemetry and the official corner list.

The maths lives in small pure functions over telemetry frames so it can be tested without a
network. A lap is cut into one zone per corner (halfway between neighbouring corner markers),
and each zone is summarised by its time, speeds and braking point.
"""
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

# How far along the lap, either side of a corner's reference distance, a sample may sit and
# still be matched to that corner. Keeps a corner from snapping onto a track crossing.
MARKER_WINDOW_M = 300.0


def circuit_corners(session) -> List[Dict[str, Any]]:
    """The official corners in lap order. Empty when FastF1 can't build circuit info."""
    try:
        frame = session.get_circuit_info().corners
        corners = []
        for _, row in frame.iterrows():
            number = int(row["Number"])
            letter = row["Letter"] if isinstance(row["Letter"], str) else ""
            corners.append({
                "number": number,
                "letter": letter,
                "label": f"T{number}{letter}",
                "x": float(row["X"]),
                "y": float(row["Y"]),
                "angle": float(row["Angle"]),
                "distance": float(row["Distance"]),
            })
    except Exception:
        return []
    corners.sort(key=lambda c: c["distance"])
    return corners


def corner_markers(tel: pd.DataFrame, corners: List[Dict[str, Any]]) -> List[float]:
    """Where each corner sits on this lap, as a distance in metres, never going backwards."""
    distance = tel["Distance"].to_numpy(dtype=float)
    x = tel["X"].to_numpy(dtype=float)
    y = tel["Y"].to_numpy(dtype=float)
    markers: List[float] = []
    for corner in corners:
        ref = corner["distance"]
        candidates = np.flatnonzero(np.abs(distance - ref) <= MARKER_WINDOW_M)
        if len(candidates):
            gap = np.hypot(x[candidates] - corner["x"], y[candidates] - corner["y"])
            gap[np.isnan(gap)] = np.inf  # samples without a position can't be nearest
            marker = float(distance[candidates[int(np.argmin(gap))]])
        else:
            marker = float(min(max(ref, distance[0]), distance[-1]))
        if markers:
            marker = max(marker, markers[-1])
        markers.append(marker)
    return markers


def corner_metrics(tel: pd.DataFrame, corners: List[Dict[str, Any]]) -> List[Dict[str, Optional[float]]]:
    """Per-corner time, apex/entry/exit speed and braking distance for one lap, in corner order."""
    if not corners:
        return []
    markers = corner_markers(tel, corners)
    distance = tel["Distance"].to_numpy(dtype=float)
    seconds = tel["Time"].dt.total_seconds().to_numpy(dtype=float)
    speed = tel["Speed"].to_numpy(dtype=float)
    braking = tel["Brake"].to_numpy(dtype=bool)

    bounds = [float(distance[0])]
    bounds += [(a + b) / 2 for a, b in zip(markers, markers[1:])]
    bounds.append(float(distance[-1]))

    rows: List[Dict[str, Optional[float]]] = []
    for i, marker in enumerate(markers):
        start, end = bounds[i], bounds[i + 1]
        in_zone = np.flatnonzero((distance >= start) & (distance <= end))
        if len(in_zone):
            apex = int(in_zone[int(np.argmin(speed[in_zone]))])
            entry = float(speed[in_zone[0]:apex + 1].max())
        else:
            apex = int(np.argmin(np.abs(distance - marker)))
            entry = max(float(np.interp(start, distance, speed)), float(speed[apex]))

        brake_before: Optional[float] = None
        braked = in_zone[(in_zone <= apex) & braking[in_zone]]
        if len(braked):
            first = int(braked[-1])
            while first - 1 >= in_zone[0] and braking[first - 1]:
                first -= 1
            brake_before = float(marker - distance[first])

        rows.append({
            "zone_time": float(np.interp(end, distance, seconds) - np.interp(start, distance, seconds)),
            "apex_speed": float(speed[apex]),
            "entry_speed": entry,
            "exit_speed": float(np.interp(end, distance, speed)),
            "brake_before_m": brake_before,
        })
    return rows
