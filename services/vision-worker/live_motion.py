"""Private frame pipe for the live agent's separate MediaPipe environment."""
import argparse
import json
import os
import struct
import sys
from pathlib import Path

from motion_core import MotionSession, extract

FRAME_HEADER = struct.Struct("!QIIIII")  # monotonic ms, epoch, width, height, rotation, sender gap ms
MAX_PIXELS = 1920 * 1080
GAP_MS = 350
PREP_GAP_MS = 1000
EXERCISES = ("squats", "pushups")


class LiveSet:
    def __init__(self, exercise, prep_seconds, set_seconds):
        self.motion = MotionSession(exercise)
        self.prep_ms = prep_seconds * 1000
        self.set_ms = set_seconds * 1000
        self.phase = "preparing"
        self.neutral_since = self.countdown_at = self.active_at = self.last_visible = None
        self.last_ms = self.epoch = self.last_cue = None
        self.count = 0

    def interrupt(self):
        if self.phase in ("preparing", "countdown"):
            self.phase = "preparing"
            self.neutral_since = self.countdown_at = self.last_cue = self.last_visible = None
        elif self.phase == "active":
            self.motion.counter.reset()
            self.motion.side = None
            if not self.motion.in_gap:
                self.motion.in_gap = True
                self.motion.interruptions += 1

    def observe(self, ms, epoch, poses, sender_gap_ms=0):
        if self.last_ms is not None and ms <= self.last_ms:
            return None
        gap_limit = GAP_MS if self.phase == "active" else PREP_GAP_MS
        if self.last_ms is not None and (
            epoch != self.epoch or max(ms - self.last_ms, sender_gap_ms) > gap_limit
        ):
            self.interrupt()
        self.epoch, self.last_ms = epoch, ms
        if self.phase == "ended":
            return None

        if self.phase != "active":
            states = [extract(poses[0], self.motion.exercise, side).state
                      for side in ("left", "right")] if len(poses) == 1 else []
            neutral = "neutral" in states
            if any(state is not None for state in states):
                self.last_visible = ms
            if self.phase == "preparing":
                if not neutral:
                    self.neutral_since = None
                    return None
                if self.neutral_since is None:
                    self.neutral_since = ms
                if ms - self.neutral_since < 400:
                    return None
                self.countdown_at = ms
                self.phase = "countdown"
            elif ms - self.last_visible > PREP_GAP_MS:
                self.interrupt()
                return "Take a moment to get back in view"
            remaining = self.prep_ms - (ms - self.countdown_at)
            if remaining > 0:
                number = (remaining + 999) // 1000
                if number != self.last_cue:
                    self.last_cue = number
                    return str(number)
                return None
            if not neutral:
                if self.last_cue != 0:
                    self.last_cue = 0
                    return "When you are ready hold the starting position"
                return None
            self.active_at = ms
            self.phase = "active"
            return "Go"

        if ms >= self.active_at + self.set_ms:
            self.phase = "ended"
            unit = "repetition" if self.count == 1 else "repetitions"
            return f"Nice work. I counted {self.count} {unit}"
        self.motion.update((ms - self.active_at) / 1000, poses)
        events = self.motion.counter.events
        if events and events[-1]["type"] == "complete_cycle":
            count = len(events) - (events[0]["type"] == "initial_partial")
            if count > self.count:
                self.count = count
                return str(count)
        return None

    def snapshot(self):
        result = self.motion.result()
        return {"phase": self.phase, "count": self.count, **{
            key: result[key] for key in (
                "status", "payout_eligible", "frames_analyzed", "usable_fraction",
                "tracking_interruptions", "retry_reasons", "rejected_frame_reasons",
            )
        }}


def run(exercise, prep_seconds, set_seconds):
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    import cv2
    import mediapipe as mp
    import numpy as np
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode
    from moltivate_motion import pose_from_result

    cv2.setNumThreads(1)
    model = Path(__file__).parent / "models" / "pose_landmarker_lite.task"
    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model), delegate=BaseOptions.Delegate.CPU),
        running_mode=RunningMode.VIDEO, num_poses=2,
    )
    live_set = LiveSet(exercise, prep_seconds, set_seconds)
    epoch_seen, last_ms = None, None
    detector = PoseLandmarker.create_from_options(options)
    print('{"ready":true}', flush=True)
    try:
        while header := sys.stdin.buffer.read(FRAME_HEADER.size):
            ms, epoch, width, height, rotation, sender_gap_ms = FRAME_HEADER.unpack(header)
            if not 0 < width * height <= MAX_PIXELS or rotation not in (0, 90, 180, 270):
                raise ValueError("Invalid live frame dimensions or rotation")
            data = sys.stdin.buffer.read(width * height * 3)
            if len(data) != width * height * 3:
                raise ValueError("Incomplete live frame")
            if last_ms is not None and ms <= last_ms:
                print(json.dumps(live_set.snapshot()), flush=True)
                continue
            if epoch_seen is not None and epoch_seen != epoch:
                detector.close()
                detector = PoseLandmarker.create_from_options(options)
            epoch_seen, last_ms = epoch, ms
            pixels = np.frombuffer(data, np.uint8).reshape(height, width, 3)
            scale = min(1, 640 / max(width, height))
            if scale < 1:
                pixels = cv2.resize(pixels, (max(1, round(width * scale)), max(1, round(height * scale))),
                                    interpolation=cv2.INTER_AREA)
            pixels = np.ascontiguousarray(np.rot90(pixels, -rotation // 90))
            result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=pixels), ms)
            cue = live_set.observe(ms, epoch, pose_from_result(result), sender_gap_ms)
            print(json.dumps({"cue": cue, **live_set.snapshot()}), flush=True)
    finally:
        detector.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("exercise", choices=EXERCISES)
    parser.add_argument("prep_seconds", type=int, choices=range(1, 61))
    parser.add_argument("set_seconds", type=int, choices=range(15, 61))
    args = parser.parse_args()
    run(args.exercise, args.prep_seconds, args.set_seconds)
