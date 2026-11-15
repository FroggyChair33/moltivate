"""Explicit, operator-labeled standing reference for experimental squat counts.

Never infer a neutral reference from the clip's maximum or desired rep count.
This only adapts to estimated 3D angle bias; it cannot prove the pose is standing.
"""
import math
import statistics


def squat_reference(rows, start, end):
    if not all(math.isfinite(v) for v in (start, end)) or not 0 <= start < end <= 60:
        raise ValueError("Standing reference must be a finite interval within 0–60 seconds")
    if not 0.4 - 1e-8 <= end - start <= 3:
        raise ValueError("Choose a 0.4–3 second interval visibly held fully standing")
    selected = [r for r in rows if start - 1e-8 <= r["seconds"] <= end + 1e-8]
    if (len(selected) < 5 or selected[0]["seconds"] > start + 0.11
            or selected[-1]["seconds"] < end - 0.11):
        raise ValueError("Standing reference is too short or outside the decoded clip")
    sides = {r.get("side") for r in selected}
    if len(sides) != 1 or not sides <= {"left", "right"}:
        raise ValueError("Standing reference must track one consistent side")
    values = []
    for i, row in enumerate(selected):
        if (row.get("state") is None or row.get("reason") or row.get("confidence", 0) < 0.65
                or i and row["seconds"] - selected[i-1]["seconds"] > 0.11):
            raise ValueError("Standing reference has missing or unreliable frames")
        value = row.get("knee_degrees", float("nan"))
        if not math.isfinite(value) or not 0 <= value <= 180:
            raise ValueError("Invalid knee angle in standing reference")
        values.append(value)
    median = statistics.median(values)
    if median < 145 or max(values) - min(values) > 12:
        raise ValueError("Reference is too bent or unstable; inspect the overlay and choose a held standing interval")
    # Lower decile minus a fixed 5-degree noise allowance, bounded independently
    # of this clip's squat depth. A minimum 30-degree gap to bent=110 remains.
    ordered = sorted(values)
    pos = (len(ordered) - 1) * .1
    low = ordered[int(pos)] * (1 - pos % 1) + ordered[math.ceil(pos)] * (pos % 1)
    threshold = round(max(140, min(175, low - 5)), 3)
    return {"method": "operator_labeled_standing_window_v1", "standing_pose_verified": False,
            "window_seconds": [start, end], "samples": len(values), "side": next(iter(sides)),
            "reference_median_degrees": round(median, 3),
            "reference_range_degrees": [min(values), max(values)],
            "knee_extended_min": threshold, "noise_allowance_degrees": 5}
