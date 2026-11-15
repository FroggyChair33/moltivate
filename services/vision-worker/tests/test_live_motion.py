"""Synthetic pose events exercise the live set boundaries and discontinuities."""
from dataclasses import replace
import unittest

from test_motion import fixture
from image_squats import ImageSquatSession
from live_motion import LiveSet


class LiveSetTests(unittest.TestCase):
    @staticmethod
    def preview(pose):
        return replace(pose, image=[(0.74 + x * 0.24, 0.01 + y * 0.24, z) for x, y, z in pose.image])

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

    def test_squats_ignore_preview_even_if_detection_order_changes(self):
        session = LiveSet("squats", prep_seconds=1, set_seconds=15)
        up = fixture("squats", yaw=90)
        down = fixture("squats", active=True, yaw=90)
        preview = self.preview(up)
        for ms in range(0, 1500, 100):
            session.observe(ms, 1, [preview, up])
        self.assertEqual(session.phase, "active")
        for ms in range(1500, 2700, 100):
            poses = [down, preview] if ms in (1800, 2200) else [preview, up]
            session.observe(ms, 1, poses)
        result = session.snapshot()
        self.assertEqual(result["count"], 2)
        self.assertEqual(result["ignored_secondary_pose_frames"], 12)
        self.assertEqual(result["status"], "experimental_only")

    def test_missing_primary_never_switches_to_the_preview(self):
        session, up, down = self.start("squats")
        preview_up = self.preview(up[0])
        preview_down = self.preview(down[0])
        for ms, poses in enumerate((up, down, [preview_up], [preview_down], [preview_up], up), 15):
            session.observe(ms * 100, 1, poses)
        self.assertEqual(session.snapshot()["count"], 0)

    def test_ambiguous_pose_cannot_complete_an_unfinished_squat(self):
        session, up, down = self.start("squats")
        for ms, poses in enumerate((up, down, up + up, up), 15):
            session.observe(ms * 100, 1, poses)
        result = session.snapshot()
        self.assertEqual(result["count"], 0)
        self.assertIn("multiple_people_in_set", result["retry_reasons"])

    def test_straight_legs_while_lying_down_do_not_start_a_squat_set(self):
        session = LiveSet("squats", prep_seconds=1, set_seconds=15)
        upright = fixture("squats")
        lying = replace(upright, image=[(y, x, z) for x, y, z in upright.image])
        for ms in range(0, 1800, 100):
            self.assertIsNone(session.observe(ms, 1, [lying]))
        self.assertEqual(session.phase, "preparing")

    def test_cropped_body_blocks_countdown_and_go(self):
        for exercise, cropped_region in (("squats", (0, 7, 8)), ("pushups", (31, 32))):
            with self.subTest(exercise=exercise):
                session = LiveSet(exercise, prep_seconds=1, set_seconds=15)
                up = fixture(exercise)
                cropped = replace(up, image=[(-0.1, y, z) if i in cropped_region else (x, y, z)
                                             for i, (x, y, z) in enumerate(up.image)])
                for ms in range(0, 1000, 100):
                    self.assertIsNone(session.observe(ms, 1, [cropped]))
                self.assertEqual(session.phase, "preparing")
                for ms in range(1000, 2400, 100):
                    session.observe(ms, 1, [up])
                self.assertEqual(session.phase, "countdown")
                self.assertNotEqual(session.observe(2400, 1, [cropped]), "Go")
                self.assertEqual(session.snapshot()["frames_analyzed"], 0)
                self.assertEqual(session.observe(2500, 1, [up]), "Go")
