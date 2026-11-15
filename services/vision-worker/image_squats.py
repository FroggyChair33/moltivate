"""Port of the normalized 2D squat rule from cc16424 (pose-squat-counter.ts)."""
import math
from collections import Counter

from motion_core import angle

LEFT_LEG = (23, 25, 27)


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
