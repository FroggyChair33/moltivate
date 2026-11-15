"""Port of the normalized 2D squat rule from cc16424 (pose-squat-counter.ts)."""
import math
from collections import Counter

from motion_core import angle

LEFT_LEG = (23, 25, 27)


def torso_signature(pose):
    if any(len(values) <= 24 for values in (pose.image, pose.visibility, pose.presence)):
        return None
    centers = []
    for pair in ((11, 12), (23, 24)):
        visible = [pose.image[i][:2] for i in pair
                   if pose.visibility[i] >= 0.5 and pose.presence[i] >= 0.5
                   and all(0 <= coordinate <= 1 for coordinate in pose.image[i][:2])]
        if not visible:
            return None
        centers.append(tuple(sum(axis) / len(visible) for axis in zip(*visible)))
    shoulder, hip = centers
    size = math.dist(shoulder, hip)
    if size < 0.01:
        return None
    center = tuple((a + b) / 2 for a, b in zip(shoulder, hip))
    return center, size, hip[1] - shoulder[1] >= 0.7 * size


def squat_ready(pose):
    torso = torso_signature(pose)
    return (torso is not None and torso[2] and squat_state([pose])[0] == "neutral"
            and pose.image[27][1] - pose.image[23][1] >= 0.08)


class PrimarySquatPose:
    """Follow the main torso within one call, with no fallback to a bystander."""

    def __init__(self):
        self.target = None

    def select(self, poses):
        ranked = []
        for pose in poses:
            signature = torso_signature(pose)
            if signature is None:
                continue
            center, size, _ = signature
            if self.target is None:
                if size < 0.08:
                    continue
                # Prefer a large, centrally framed torso over a picture-in-picture preview.
                score = -size / (1 + 2 * math.dist(center, (0.5, 0.5)))
            else:
                previous_center, previous_size, _ = self.target
                distance = math.dist(center, previous_center)
                ratio = size / previous_size
                if distance > max(0.10, 0.85 * previous_size) or not 0.55 <= ratio <= 1.8:
                    continue
                score = distance / previous_size + 0.25 * abs(math.log(ratio))
            ranked.append((score, pose, signature))
        if not ranked:
            return None
        ranked.sort(key=lambda item: item[0])
        best_score, pose, signature = ranked[0]
        if len(ranked) > 1:
            margin = abs(best_score) * 0.2 if self.target is None else 0.20
            if ranked[1][0] - best_score < margin:
                return None
        if self.target is not None or squat_ready(pose):
            self.target = signature
        return pose


def squat_state(poses):
    if len(poses) != 1:
        return None, "multiple_people_detected" if poses else "no_person_detected"
    pose = poses[0]
    if any(len(values) <= LEFT_LEG[-1] for values in (pose.image, pose.visibility, pose.presence)):
        return None, "missing_landmarks"
    points = [pose.image[i][:2] for i in LEFT_LEG]
    if any(not 0 <= coordinate <= 1 for point in points for coordinate in point):
        return None, "joints_out_of_frame"
    if any(not (pose.visibility[i] >= 0.5 and pose.presence[i] >= 0.5) for i in LEFT_LEG):
        return None, "low_landmark_confidence"
    try:
        degrees = angle(*points)
    except ValueError:
        return None, "degenerate_joint_geometry"
    # Keep the browser rule's strict inequalities and normalized x/y geometry.
    return ("active" if degrees < 110 else "neutral" if degrees > 160 else "middle"), None


class ImageSquatSession:
    exercise = "squats"

    def __init__(self):
        self.state = None
        self.complete_cycles = self.frames = self.usable = self.interruptions = 0
        self.in_gap = False
        self.reasons = Counter()

    def interrupt(self):
        self.state = None
        if not self.in_gap:
            self.interruptions += 1
        self.in_gap = True

    def update(self, _seconds, poses):
        self.frames += 1
        state, reason = squat_state(poses)
        if state is None:
            self.reasons[reason] += 1
            self.interrupt()
            return
        self.usable += 1
        self.in_gap = False
        if self.state == "up" and state == "active":
            self.state = "down"
        elif state == "neutral":
            if self.state == "down":
                self.complete_cycles += 1
            self.state = "up"

    def result(self):
        coverage = self.usable / self.frames if self.frames else 0
        retry = []
        if self.usable < 10:
            retry.append("too_few_usable_frames")
        if coverage < 0.75:
            retry.append("insufficient_tracking_coverage")
        if self.reasons["multiple_people_detected"]:
            retry.append("multiple_people_in_set")
        return {
            "status": "needs_retry" if retry else "experimental_only",
            "payout_eligible": False,
            "complete_cycles": self.complete_cycles,
            "frames_analyzed": self.frames,
            "usable_fraction": round(coverage, 3),
            "tracking_interruptions": self.interruptions,
            "retry_reasons": retry,
            "rejected_frame_reasons": dict(self.reasons),
        }
