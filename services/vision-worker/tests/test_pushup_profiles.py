"""Synthetic flexible-profile tests. No private workout trace is committed."""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from motion_core import CycleCounter, MotionSession, PUSHUP_PROFILES, extract, pushup_state
from test_motion import fixture


def elbow_pose(degrees):
    pose = fixture("pushups")
    for elbow, wrist in ((13, 15), (14, 16)):
        x, y, z = pose.world[elbow]
        t = math.radians(degrees)
        pose.world[wrist] = (x + .3 * math.sin(t), y - .3 * math.cos(t), z)
        x, y, z = pose.world[wrist]
        pose.image[wrist] = (.5 + .25*x, .15 + .3*y, z)
    return pose


def run_angles(angles, profile="flexible", step=.1):
    session = MotionSession("pushups", pushup_profile=profile)
    for i, angle in enumerate(angles):
        session.update(i*step, [] if angle is None else [elbow_pose(angle)])
    return session.result()


class PushupProfileTests(unittest.TestCase):
    def test_flexible_top_and_separate_bottom_hold(self):
        session = MotionSession("pushups")
        self.assertEqual(session.counter.neutral_dwell, .10)
        self.assertEqual(session.counter.dwell, .15)
        self.assertEqual(session.result()["rules"]["profile"], "flexible")
        self.assertEqual(session.result()["rules"]["elbow_extended_min"], 145)
        self.assertEqual(extract(elbow_pose(148), "pushups").state, "neutral")
        self.assertEqual(extract(elbow_pose(148), "pushups", pushup_profile="strict").state, "middle")

    def test_distinct_returns_count_without_full_lockout(self):
        # Artificial angles, not a copy of a user's trace; test variable rep counts.
        for count in (1, 2, 5, 8):
            for top in (146, 148, 152, 165):
                sequence = [165]*4 + ([120]*2 + [85]*3 + [120]*2 + [top]*2)*count
                with self.subTest(count=count, top=top):
                    result = run_angles(sequence)
                    self.assertEqual(result["complete_cycles"], count)
                    for flag in ("form_assessed", "payout_eligible", "identity_verified",
                                 "liveness_verified", "exercise_identity_verified"):
                        self.assertFalse(result[flag])

    def test_strict_profile_preserves_old_endpoint(self):
        sequence = [165]*4 + [85]*4 + [148]*3
        self.assertEqual(run_angles(sequence)["complete_cycles"], 1)
        strict = run_angles(sequence, "strict")
        self.assertEqual(strict["complete_cycles"], 0)
        self.assertEqual(strict["rules"]["elbow_extended_min"], 155)
        self.assertEqual(strict["rules"]["top_dwell_seconds"], .15)

    def test_one_frame_top_spike_does_not_finish(self):
        result = run_angles([165]*4 + [85]*4 + [148] + [120]*4)
        self.assertEqual(result["complete_cycles"], 0)

    def test_one_frame_bottom_spike_does_not_count(self):
        self.assertEqual(run_angles([165]*4 + [85] + [165]*4)["complete_cycles"], 0)

    def test_shallow_bends_and_low_returns_do_not_count(self):
        for sequence in ([165]*4 + ([120]*5 + [148]*3)*4,
                         [165]*4 + [85]*4 + [144]*5):
            self.assertEqual(run_angles(sequence)["complete_cycles"], 0)

    def test_no_double_count_during_hold(self):
        self.assertEqual(run_angles([165]*4 + [85]*4 + [148]*40)["complete_cycles"], 1)

    def test_gap_inside_movement_still_invalidates_cycle(self):
        sequence = [165]*4 + [85]*3 + [None] + [85]*3 + [148]*3
        self.assertEqual(run_angles(sequence)["complete_cycles"], 0)

    def test_reacquire_top_after_gap_before_descent(self):
        sequence = [165]*4 + [None] + [148]*2 + [120]*2 + [85]*4 + [120]*2 + [148]*2
        result = run_angles(sequence)
        self.assertEqual(result["complete_cycles"], 1)
        self.assertEqual(result["tracking_interruptions"], 1)

    def test_initial_partial_remains_separate(self):
        result = run_angles([85]*4 + [120]*2 + [148]*3)
        self.assertEqual((result["complete_cycles"], result["initial_partial_cycles"]), (0, 1))

    def test_minimum_duration_still_enforced(self):
        # Endpoint evidence is adequate, but the 0.35-second cycle is too short.
        counter = CycleCounter(neutral_dwell=.1)
        for t, state in [(0,"neutral"),(.1,"neutral"),(.15,"active"),
                         (.3,"active"),(.35,"neutral"),(.45,"neutral")]:
            counter.update(t, state)
        self.assertEqual(counter.result()["complete_cycles"], 0)

    def test_profile_cannot_change_other_exercises(self):
        for exercise in ("squats", "situps", "jumping_jacks"):
            with self.assertRaises(ValueError):
                MotionSession(exercise, pushup_profile="flexible")
            self.assertEqual(MotionSession(exercise).counter.neutral_dwell, .15)

    def test_boundaries_and_invalid_angles(self):
        self.assertEqual(pushup_state(145), "neutral")
        self.assertEqual(pushup_state(144.999), "middle")
        self.assertEqual(pushup_state(100), "active")
        self.assertEqual(pushup_state(100.001), "middle")
        for value in (-1, 181, float("nan"), float("inf")):
            with self.assertRaises(ValueError): pushup_state(value)
        with self.assertRaises(ValueError): MotionSession("pushups", pushup_profile="unknown")

    def test_posture_and_coverage_checks_are_unchanged(self):
        session = MotionSession("pushups")
        for i in range(30):
            session.update(i*.1, [elbow_pose(148)] if 5 <= i < 20 else [])
        self.assertIn("insufficient_tracking_coverage", session.result()["retry_reasons"])
        self.assertIsNone(extract(fixture(), "pushups").state)
        bent = elbow_pose(148)
        bent.world[27] = bent.world[23]
        self.assertIsNone(extract(bent, "pushups").state)


if __name__ == "__main__":
    unittest.main()
