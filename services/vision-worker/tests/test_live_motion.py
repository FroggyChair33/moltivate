"""Synthetic pose events exercise the live set boundaries and discontinuities."""
import unittest

from test_motion import fixture
from live_motion import LiveSet


class LiveSetTests(unittest.TestCase):
    def start(self, exercise):
        session = LiveSet(exercise, prep_seconds=1, set_seconds=15)
        neutral = [fixture(exercise)]
        cues = [session.observe(ms, 1, neutral) for ms in range(0, 1500, 100)]
        self.assertEqual([cue for cue in cues if cue], ["1", "Go"])
        self.assertEqual(session.snapshot()["frames_analyzed"], 0)
        return session, neutral, [fixture(exercise, active=True)]

    def test_both_exercises_count_one_complete_cycle_after_go(self):
        for exercise in ("squats", "pushups"):
            with self.subTest(exercise=exercise):
                session, neutral, bottom = self.start(exercise)
                cues = [session.observe(ms, 1, bottom if 1800 <= ms < 2100 else neutral)
                        for ms in range(1500, 2500, 100)]
                self.assertEqual(session.snapshot()["count"], 1)
                self.assertFalse(session.snapshot()["payout_eligible"])
                self.assertEqual([cue for cue in cues if cue], ["1"])
                self.assertEqual(session.observe(16400, 1, neutral), "Set complete. 1 repetitions")
                self.assertIsNone(session.observe(16500, 1, neutral))

    def test_gap_or_replacement_does_not_finish_inflight_rep(self):
        for next_time, next_epoch in ((2400, 1), (2100, 2)):
            with self.subTest(timestamp=next_time, epoch=next_epoch):
                session, neutral, bottom = self.start("pushups")
                for ms in range(1500, 2100, 100):
                    session.observe(ms, 1, bottom if ms >= 1800 else neutral)
                for ms in range(next_time, next_time + 300, 100):
                    session.observe(ms, next_epoch, neutral)
                self.assertEqual(session.snapshot()["count"], 0)
                self.assertEqual(session.snapshot()["tracking_interruptions"], 1)

    def test_preparation_restarts_after_gap_and_ignores_old_frame(self):
        session = LiveSet("squats", prep_seconds=1, set_seconds=15)
        neutral = [fixture("squats")]
        for ms in range(0, 500, 100):
            session.observe(ms, 1, neutral)
        self.assertEqual(session.phase, "countdown")
        self.assertIsNone(session.observe(300, 1, []))
        self.assertIsNone(session.observe(900, 1, neutral))
        self.assertEqual(session.phase, "preparing")
        self.assertEqual(session.snapshot()["frames_analyzed"], 0)
