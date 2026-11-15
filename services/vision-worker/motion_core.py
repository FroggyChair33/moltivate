"""Pure-Python experimental movement rules. No inference, I/O, or payout logic."""
from collections import Counter
from dataclasses import dataclass, field
import math

VERSION = "motion-experiment-0.3.0"
EXERCISES = ("squats", "pushups", "situps", "jumping_jacks")
SIDES = {"left": (11, 13, 15, 23, 25, 27), "right": (12, 14, 16, 24, 26, 28)}
RULES = {
    "squats": {"knee_bent_max": 110, "knee_extended_min": 160},
    "pushups": {"elbow_bent_max": 100, "elbow_extended_min": 155,
                "body_alignment_min": 150, "knee_extended_min": 150},
    "situps": {"torso_raised_min": 0.70, "torso_lowered_max": 0.30,
               "knee_bent_min": 35, "knee_bent_max": 140},
    "jumping_jacks": {"arm_open_min": 135, "arm_closed_max": 35,
                      "feet_open_min": 0.85, "feet_closed_max": 0.50},
}


def sub(a, b):
    return tuple(x - y for x, y in zip(a[:3], b[:3]))


def norm(v):
    return math.sqrt(sum(x * x for x in v))


def distance(a, b):
    return norm(sub(a, b))


def angle(a, b, c):
    u, v = sub(a, b), sub(c, b)
    denominator = norm(u) * norm(v)
    if not math.isfinite(denominator) or denominator < 1e-8:
        raise ValueError("Degenerate joint geometry")
    cosine = sum(x * y for x, y in zip(u, v)) / denominator
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


@dataclass
class Pose:
    # Image x/y are normalized to a SQUARE decoded frame (pixel aspect corrected).
    image: list
    world: list
    visibility: list
    presence: list


@dataclass
class Feature:
    state: str | None = None
    confidence: float = 0.0
    reason: str | None = None
    values: dict = field(default_factory=dict)


def check_points(pose, indices, minimum=0.65):
    if any(len(x) != 33 for x in (pose.image, pose.world, pose.visibility, pose.presence)):
        return "missing_landmarks", 0.0
    confidence = []
    for i in indices:
        numbers = (*pose.image[i], *pose.world[i], pose.visibility[i], pose.presence[i])
        if not all(math.isfinite(x) for x in numbers):
            return "nonfinite_landmarks", 0.0
        confidence.append(min(pose.visibility[i], pose.presence[i]))
        if not 0.015 <= pose.image[i][0] <= 0.985 or not 0.015 <= pose.image[i][1] <= 0.985:
            return "joints_out_of_frame", min(confidence)
    score = min(confidence)
    return ("low_landmark_confidence" if score < minimum else None), score


def extract(pose, exercise, side="left"):
    """World joint angles + conservative image posture gates. Requires a level camera.

    Posture gates are movement filters, NOT biomechanical form assessment.
    No silent 2D fallback: unreliable world coordinates must be inspected/retried.
    """
    if exercise not in EXERCISES or side not in SIDES:
        raise ValueError("Unsupported exercise or side")
    s, e, w, h, k, a = SIDES[side]
    indices = (s, h, k, a) if exercise in ("squats", "situps") else (s, e, w, h, k, a)
    if exercise == "jumping_jacks":
        indices = tuple(i for ids in SIDES.values() for i in ids)
    reason, confidence = check_points(pose, indices)
    if reason:
        return Feature(confidence=confidence, reason=reason)
    q, p = pose.world, pose.image
    # Reject collapsed or implausible estimated segments before angle computation.
    segments = [(s, h), (h, k), (k, a)]
    if exercise in ("pushups", "jumping_jacks"):
        segments += [(s, e), (e, w)]
    if exercise == "jumping_jacks":
        segments += [(12, 24), (24, 26), (26, 28), (12, 14), (14, 16)]
    if any(not 0.04 <= distance(q[i], q[j]) <= 1.2 for i, j in segments):
        return Feature(confidence=confidence, reason="unreliable_world_geometry")
    torso = distance((*p[s][:2], 0), (*p[h][:2], 0))
    if torso < 0.04:
        return Feature(confidence=confidence, reason="torso_foreshortened")
    elevation = (p[h][1] - p[s][1]) / torso
    try:
        knee = angle(q[h], q[k], q[a])
        values = {"knee_degrees": knee, "torso_elevation": elevation}
        if exercise == "squats":
            if elevation < 0.25 or p[a][1] - p[h][1] < 0.04:
                return Feature(confidence=confidence, reason="squat_posture_not_visible", values=values)
            state = "neutral" if knee >= 160 else "active" if knee <= 110 else "middle"
        elif exercise == "pushups":
            elbow = angle(q[s], q[e], q[w])
            body = angle(q[s], q[h], q[a])
            values.update(elbow_degrees=elbow, body_alignment_degrees=body)
            if abs(elevation) > 0.70 or body < 150 or knee < 150:
                return Feature(confidence=confidence, reason="pushup_posture_not_visible", values=values)
            state = "neutral" if elbow >= 155 else "active" if elbow <= 100 else "middle"
        elif exercise == "situps":
            projected_leg = distance((*p[h][:2], 0), (*p[k][:2], 0)) + distance((*p[k][:2], 0), (*p[a][:2], 0))
            values["hip_degrees"] = angle(q[s], q[h], q[k])
            # Bent knees, hips near ankle height, knees above hips distinguish this
            # floor movement from standing bends. Side/oblique floor views preferred.
            if (projected_leg < 0.08 or not 35 <= knee <= 140
                    or abs(p[h][1] - p[a][1]) > 0.30 * projected_leg
                    or p[k][1] > p[h][1] - 0.02):
                return Feature(confidence=confidence, reason="situp_floor_posture_not_visible", values=values)
            state = "neutral" if abs(elevation) <= 0.30 else "active" if elevation >= 0.70 else "middle"
        else:
            arm_l, arm_r = angle(q[23], q[11], q[13]), angle(q[24], q[12], q[14])
            leg_length = sum(distance(q[x], q[y]) for x, y in ((23,25),(25,27),(24,26),(26,28))) / 2
            spread = distance(q[27], q[28]) / leg_length
            values.update(arm_left_degrees=arm_l, arm_right_degrees=arm_r, feet_spread=spread)
            if elevation < 0.65 or min(knee, angle(q[24],q[26],q[28])) < 145:
                return Feature(confidence=confidence, reason="jack_posture_not_visible", values=values)
            # Both arms AND feet must agree. Arm-only waving cannot complete a jack.
            opened = min(arm_l, arm_r) >= 135 and spread >= 0.85
            closed = max(arm_l, arm_r) <= 35 and spread <= 0.50
            state = "active" if opened else "neutral" if closed else "middle"
        return Feature(state, confidence, values=values)
    except (ValueError, ZeroDivisionError):
        return Feature(confidence=confidence, reason="degenerate_geometry")


class CycleCounter:
    def __init__(self, dwell=0.15, min_seconds=0.5, max_seconds=12.0):
        self.dwell, self.min_seconds, self.max_seconds = dwell, min_seconds, max_seconds
        self.phase = "seeking_neutral"
        self.initial = True
        self.last_t = self.neutral_since = self.active_since = self.started = self.last_neutral = None
        self.events = []

    def reset(self):
        self.phase, self.initial = "seeking_neutral", False
        self.neutral_since = self.active_since = self.started = self.last_neutral = None

    def update(self, t, state):
        if not math.isfinite(t) or t < 0 or self.last_t is not None and t <= self.last_t:
            raise ValueError("Timestamps must be finite, nonnegative and strictly increasing")
        if state not in (None, "neutral", "active", "middle"):
            raise ValueError("Unknown motion state")
        if self.last_t is not None and t - self.last_t > 0.35:
            self.reset()
        self.last_t = t
        if state is None:
            self.reset()
            return
        self.neutral_since = (t if self.neutral_since is None else self.neutral_since) if state == "neutral" else None
        self.active_since = (t if self.active_since is None else self.active_since) if state == "active" else None
        neutral = self.neutral_since is not None and t - self.neutral_since >= self.dwell - 1e-8
        active = self.active_since is not None and t - self.active_since >= self.dwell - 1e-8
        if self.started is not None and t - self.started > self.max_seconds:
            self.reset()
            return
        if self.phase == "seeking_neutral":
            if neutral:
                self.phase, self.initial, self.last_neutral = "ready", False, t
            elif active and self.initial:
                self.phase, self.started = "initial_partial", self.active_since
        elif self.phase == "ready":
            if state == "neutral":
                self.last_neutral, self.started = t, None
            elif self.started is None:
                self.started = self.last_neutral
            if active:
                self.phase = "active"
        elif neutral:
            duration = t - self.started
            kind = "initial_partial" if self.phase == "initial_partial" else "complete_cycle"
            if duration >= self.min_seconds:
                self.events.append({"type": kind, "start_seconds": round(self.started, 3),
                                    "end_seconds": round(t, 3)})
            self.phase, self.initial, self.last_neutral, self.started = "ready", False, t, None

    def result(self):
        return {"complete_cycles": sum(e["type"] == "complete_cycle" for e in self.events),
                "initial_partial_cycles": sum(e["type"] == "initial_partial" for e in self.events),
                "unfinished_cycle": self.phase in ("active", "initial_partial") or self.started is not None,
                "events": self.events}


class MotionSession:
    def __init__(self, exercise, side="auto"):
        if exercise not in EXERCISES or side not in ("auto", "left", "right"):
            raise ValueError("Unsupported exercise or side")
        if exercise == "jumping_jacks" and side != "auto":
            raise ValueError("Jumping jacks require both sides; use --side auto")
        self.exercise, self.preference = exercise, side
        self.counter = CycleCounter(min_seconds=0.4 if exercise == "jumping_jacks" else 0.5)
        self.side = None
        self.lost_since = None
        self.frames = self.detected = self.usable = self.interruptions = 0
        self.in_gap = False
        self.reasons = Counter()
        self.side_frames = Counter()
        self.side_events = []
        self.ranges = {}
        self.last_t = None

    def update(self, t, poses):
        if not math.isfinite(t) or t < 0 or self.last_t is not None and t <= self.last_t:
            raise ValueError("Timestamps must increase")
        self.last_t = t
        self.frames += 1
        row = {"seconds": round(t, 3), "side": self.side, "state": None, "reason": None}
        candidates = {}
        if len(poses) != 1:
            feature = Feature(reason="no_person_detected" if not poses else "multiple_people_detected")
        else:
            self.detected += 1
            candidates = {s: extract(poses[0], self.exercise, s) for s in SIDES}
            row.update({s + "_confidence": round(f.confidence, 3) for s, f in candidates.items()})
            row.update({s + "_reason": f.reason for s, f in candidates.items()})
            if self.exercise == "jumping_jacks":
                self.side = "both"
                feature = candidates["left"]
            else:
                if self.side is None:
                    available = [s for s, f in candidates.items() if f.state is not None
                                 and self.preference in ("auto", s)]
                    if available:
                        self.side = max(available, key=lambda s: candidates[s].confidence)
                        self.side_events.append({"seconds": round(t, 3), "side": self.side})
                feature = candidates[self.side] if self.side else Feature(reason="no_usable_side")
        if feature.state is None:
            self.reasons[feature.reason] += 1
            if not self.in_gap:
                self.interruptions += 1
            self.in_gap = True
            self.counter.update(t, None)  # Never bridge an unseen part of a rep.
            if self.lost_since is None:
                self.lost_since = t
            if t - self.lost_since >= 0.3 - 1e-8:
                self.side = None  # Reacquire, then demand a new neutral endpoint.
        else:
            self.in_gap, self.lost_since = False, None
            self.usable += 1
            self.side_frames[self.side] += 1
            self.counter.update(t, feature.state)
            for key, value in feature.values.items():
                lo, hi = self.ranges.get(key, (value, value))
                self.ranges[key] = (min(lo, value), max(hi, value))
        row.update(side=self.side, state=feature.state, reason=feature.reason,
                   confidence=round(feature.confidence, 3), phase=self.counter.phase)
        row.update({k: round(v, 3) for k, v in feature.values.items()})
        return row

    def result(self):
        fraction = self.usable / self.frames if self.frames else 0
        reasons = []
        if self.usable < 10:
            reasons.append("too_few_usable_frames")
        if fraction < 0.75:
            reasons.append("insufficient_tracking_coverage")
        if self.reasons["multiple_people_detected"]:
            reasons.append("multiple_people_in_clip")
        return {
            "verifier_version": VERSION, "exercise": self.exercise,
            "status": "needs_retry" if reasons else "experimental_only",
            "payout_eligible": False, "form_assessed": False,
            "identity_verified": False, "liveness_verified": False,
            "exercise_identity_verified": False,
            "coordinate_mode": "estimated_world_3d_with_image_posture_gates",
            "rules": RULES[self.exercise], "frames_analyzed": self.frames,
            "single_person_frames": self.detected, "usable_joint_frames": self.usable,
            "usable_fraction": round(fraction, 3), "retry_reasons": reasons,
            "rejected_frame_reasons": dict(self.reasons),
            "tracking_interruptions": self.interruptions,
            "side_frame_counts": dict(self.side_frames), "side_acquisitions": self.side_events,
            "feature_ranges": {k: [round(v[0], 3), round(v[1], 3)] for k, v in self.ranges.items()},
            **self.counter.result(),
        }
