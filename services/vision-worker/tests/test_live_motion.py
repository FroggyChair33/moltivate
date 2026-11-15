"""Synthetic pose events exercise the live set boundaries and discontinuities."""
import unittest

from test_motion import fixture
from image_squats import ImageSquatSession
from live_motion import LiveSet


class LiveSetTests(unittest.TestCase):
    def start(self, exercise):
        session = LiveSet(exercise, prep_seconds=1, set_seconds=15)
        neutral = [fixture(exercise)]
        cues = [session.observe(ms, 1, neutral) for ms in range(0, 1500, 100)]
        self.assertEqual([cue for cue in cues if cue], ["1", "Go"])
        self.assertEqual(session.snapshot()["frames_analyzed"], 0)
        return session, neutral, [fixture(exercise, active=True, yaw=90 if exercise == "squats" else 0)]

    def test_both_exercises_count_one_complete_cycle_after_go(self):
        for exercise in ("squats", "pushups"):
            with self.subTest(exercise=exercise):
                session, neutral, bottom = self.start(exercise)
                cues = [session.observe(ms, 1, bottom if 1800 <= ms < 2100 else neutral)
                        for ms in range(1500, 2500, 100)]
                self.assertEqual(session.snapshot()["count"], 1)
                self.assertFalse(session.snapshot()["payout_eligible"])
                self.assertEqual([cue for cue in cues if cue], ["1"])
                self.assertEqual(session.observe(16400, 1, neutral), "Nice work. I counted 1 repetition")
                self.assertIsNone(session.observe(16500, 1, neutral))

    def test_gap_or_replacement_does_not_finish_inflight_rep(self):
        for next_time, next_epoch, sender_gap in ((2400, 1, 0), (2100, 2, 0), (2100, 1, 400)):
            with self.subTest(timestamp=next_time, epoch=next_epoch):
                session, neutral, bottom = self.start("pushups")
                for ms in range(1500, 2100, 100):
                    session.observe(ms, 1, bottom if ms >= 1800 else neutral)
                for ms in range(next_time, next_time + 300, 100):
                    session.observe(ms, next_epoch, neutral, sender_gap if ms == next_time else 0)
                self.assertEqual(session.snapshot()["count"], 0)
                self.assertEqual(session.snapshot()["tracking_interruptions"], 1)

    def test_preparation_restarts_after_gap_and_ignores_old_frame(self):
        session = LiveSet("squats", prep_seconds=1, set_seconds=15)
        neutral = [fixture("squats")]
        for ms in range(0, 500, 100):
            session.observe(ms, 1, neutral)
        self.assertEqual(session.phase, "countdown")
        self.assertIsNone(session.observe(300, 1, []))
        self.assertIsNone(session.observe(1500, 1, neutral))
        self.assertEqual(session.phase, "preparing")
        self.assertEqual(session.snapshot()["frames_analyzed"], 0)

    def test_countdown_tolerates_brief_loss_but_waits_for_neutral_at_go(self):
        session = LiveSet("squats", prep_seconds=1, set_seconds=15)
        neutral = [fixture("squats")]
        bottom = [fixture("squats", active=True, yaw=90)]
        for ms in range(0, 500, 100):
            session.observe(ms, 1, neutral)
        session.observe(900, 1, [])
        self.assertEqual(session.phase, "countdown")
        self.assertEqual(session.observe(1400, 1, bottom),
                         "When you are ready hold the starting position")
        self.assertIsNone(session.observe(1500, 1, bottom))
        self.assertEqual(session.observe(1600, 1, neutral), "Go")
        self.assertEqual(session.snapshot()["frames_analyzed"], 0)

    def test_claude_rule_counts_one_frame_endpoints_without_holds(self):
        session = ImageSquatSession()
        up = [fixture("squats", yaw=90)]
        down = [fixture("squats", active=True, yaw=90)]
        for second, pose in enumerate((up, down, up, up, down, up)):
            session.update(second / 10, pose)
        self.assertEqual(session.result()["complete_cycles"], 2)

    def test_image_squat_tracking_loss_cannot_bridge_a_rep(self):
        session = ImageSquatSession()
        up = [fixture("squats", yaw=90)]
        down = [fixture("squats", active=True, yaw=90)]
        for second, pose in enumerate((down, up, down, [], up, up)):
            session.update(second / 10, pose)
        self.assertEqual(session.result()["complete_cycles"], 0)
        self.assertEqual(session.result()["tracking_interruptions"], 1)
