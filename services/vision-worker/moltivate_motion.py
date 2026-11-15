#!/usr/bin/env python3
"""CPU-only local video experiment; see README.md before using results."""
import argparse
import csv
import fcntl
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

from motion_core import EXERCISES, MotionSession, Pose

SIZE, FPS = 640, 10
MAX_SECONDS, MAX_BYTES, JOB_TIMEOUT = 60, 100 * 1024**2, 180
CONNECTIONS = ((11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),
               (23,24),(23,25),(25,27),(24,26),(26,28),(27,31),(28,32))


def probe_video(path):
    path = Path(path).resolve(strict=True)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("Use a nonempty local video of at most 100 MiB")
    result = subprocess.run([
        "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
        "-format_whitelist", "mov,matroska,webm,avi", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,sample_aspect_ratio:format=duration,format_name",
        "-of", "json", str(path),
    ], check=True, capture_output=True, text=True, timeout=15)
    meta = json.loads(result.stdout)
    if not meta.get("streams"):
        raise ValueError("No video stream found")
    duration = float(meta["format"]["duration"])
    stream = meta["streams"][0]
    if not math.isfinite(duration) or not 0 < duration <= MAX_SECONDS:
        raise ValueError("Use a clip lasting at most 60 seconds; input is never silently truncated")
    if not 0 < stream["width"] <= 4096 or not 0 < stream["height"] <= 4096:
        raise ValueError("Each video dimension must be 1–4096 pixels")
    if stream.get("sample_aspect_ratio", "1:1") not in ("1:1", "0:1", "N/A"):
        raise ValueError("Convert anamorphic video to square pixels before analysis")
    return {"duration_seconds": duration, "source_width": stream["width"],
            "source_height": stream["height"], "container": meta["format"]["format_name"]}


def stop_process(process):
    if process is None:
        return
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
    for stream in (process.stdin, process.stdout):
        if stream:
            try:
                stream.close()
            except BrokenPipeError:
                pass


def decoder_command(video):
    return [
        "ffmpeg", "-nostdin", "-v", "error", "-threads", "2", "-filter_threads", "1",
        "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi",
        "-i", str(video), "-map", "0:v:0", "-an", "-sn", "-dn",
        "-vf", f"setpts=PTS-STARTPTS,fps={FPS},scale={SIZE}:{SIZE}:force_original_aspect_ratio=decrease,pad={SIZE}:{SIZE}:(ow-iw)/2:(oh-ih)/2,setsar=1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ]


def timeout_handler(_signum, _frame):
    raise TimeoutError(f"Job exceeded {JOB_TIMEOUT} seconds; no valid result")


def pose_from_result(result):
    poses = []
    for index, landmarks in enumerate(result.pose_landmarks):
        world = result.pose_world_landmarks[index] if index < len(result.pose_world_landmarks) else []
        poses.append(Pose(
            image=[(v.x, v.y, v.z) for v in landmarks],
            world=[(v.x, v.y, v.z) for v in world],
            visibility=[float(v.visibility or 0) for v in landmarks],
            presence=[float(v.presence or 0) for v in landmarks],
        ))
    return poses


def draw_overlay(pixels, poses, row, count, exercise):
    from PIL import Image, ImageDraw
    image = Image.fromarray(pixels)
    draw = ImageDraw.Draw(image)
    for pose in poses:
        valid = [i for i, p in enumerate(pose.image)
                 if all(math.isfinite(v) for v in p) and 0 <= p[0] <= 1 and 0 <= p[1] <= 1]
        for a, b in CONNECTIONS:
            if a in valid and b in valid:
                color = "#66ff99" if min(pose.visibility[a], pose.visibility[b]) >= 0.65 else "#ffa040"
                draw.line([(pose.image[i][0]*SIZE, pose.image[i][1]*SIZE) for i in (a,b)], fill=color, width=3)
        for i in valid:
            x, y = pose.image[i][0]*SIZE, pose.image[i][1]*SIZE
            draw.ellipse((x-3,y-3,x+3,y+3), fill="white")
    draw.rectangle((0,0,SIZE,72), fill="#0c1d16")
    draw.text((10,8), f"EXPERIMENTAL | {exercise} | cycles {count}", fill="white")
    draw.text((10,29), f"{row['seconds']:.1f}s  {row.get('side')}  {row.get('phase')}", fill="white")
    draw.text((10,50), row.get("reason") or "Pose tracked; form and identity NOT verified", fill="#f5ce82")
    return image.tobytes()


def analyze(args):
    # CPU limits precede inference imports. Keep one concurrent job on the 2-vCPU VM.
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
    video, model = Path(args.video).resolve(strict=True), Path(args.model).resolve(strict=True)
    if not model.is_file() or not 0 < model.stat().st_size < 100 * 1024**2:
        raise ValueError("Invalid model file")
    metadata = probe_video(video)
    directory = Path(args.output_dir).resolve()
    directory.mkdir(parents=True, mode=0o700, exist_ok=False)
    os.chmod(directory, 0o700)
    decoder = encoder = None
    alarm_before = signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(JOB_TIMEOUT)
    started = time.perf_counter()
    session, rows = MotionSession(args.exercise, args.side), []
    try:
        import numpy as np
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode
        options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model), delegate=BaseOptions.Delegate.CPU),
            running_mode=RunningMode.VIDEO, num_poses=2,
            min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5, output_segmentation_masks=False,
        )
        # Temp stderr avoids pipe deadlock and keeps library warnings out of JSON.
        with tempfile.TemporaryFile() as decode_log, tempfile.TemporaryFile() as encode_log:
            decoder = subprocess.Popen(decoder_command(video), stdout=subprocess.PIPE, stderr=decode_log)
            if args.overlay:
                encoder = subprocess.Popen([
                    "ffmpeg", "-nostdin", "-v", "error", "-n", "-f", "rawvideo", "-pixel_format", "rgb24",
                    "-video_size", f"{SIZE}x{SIZE}", "-framerate", str(FPS), "-i", "pipe:0",
                    "-an", "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "24",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(directory / "overlay.partial.mp4"),
                ], stdin=subprocess.PIPE, stderr=encode_log)
            with PoseLandmarker.create_from_options(options) as detector:
                while True:
                    data = decoder.stdout.read(SIZE * SIZE * 3)
                    if not data:
                        break
                    if len(data) != SIZE * SIZE * 3:
                        raise ValueError("Incomplete decoded frame; discard this job")
                    if session.frames >= MAX_SECONDS * FPS:
                        raise ValueError("Decoded video exceeds the duration limit")
                    pixels = np.frombuffer(data, np.uint8).reshape(SIZE, SIZE, 3)
                    stamp = session.frames * 100
                    result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,
                                                               data=np.ascontiguousarray(pixels)), stamp)
                    poses = pose_from_result(result)
                    row = session.update(stamp / 1000, poses)
                    rows.append(row)
                    if encoder:
                        encoder.stdin.write(draw_overlay(pixels, poses, row,
                                                         session.counter.result()["complete_cycles"], args.exercise))
            if decoder.wait(timeout=10) != 0:
                decode_log.seek(0)
                raise ValueError("Decode failed: " + decode_log.read(1500).decode(errors="replace"))
            if encoder:
                encoder.stdin.close()
                encoder.stdin = None
                if encoder.wait(timeout=10) != 0:
                    encode_log.seek(0)
                    raise ValueError("Overlay encoding failed: " + encode_log.read(1500).decode(errors="replace"))
            if not session.frames:
                raise ValueError("No video frames decoded")
        result = session.result()
        with model.open("rb") as model_file:
            model_sha = hashlib.file_digest(model_file, "sha256").hexdigest()
        result.update(input_metadata=metadata, model_sha256=model_sha,
                      mediapipe_version=importlib.metadata.version("mediapipe"),
                      processing_seconds=round(time.perf_counter()-started, 3), sample_fps=FPS,
                      decoded_size=[SIZE, SIZE])
        fields = sorted({key for row in rows for key in row})
        with (directory / "frames.csv").open("x", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        if encoder:
            (directory / "overlay.partial.mp4").rename(directory / "overlay.mp4")
        (directory / "result.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
        return result
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, alarm_before)
        stop_process(decoder)
        stop_process(encoder)
        partial = directory / "overlay.partial.mp4"
        if partial.exists():
            partial.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", help="Local .mp4/.mov/.mkv/.webm/.avi; decoded by FFmpeg")
    parser.add_argument("--exercise", required=True, choices=EXERCISES)
    parser.add_argument("--model", default="models/pose_landmarker_lite.task")
    parser.add_argument("--side", choices=("auto", "left", "right"), default="auto")
    parser.add_argument("--output-dir", required=True, help="New private directory; never overwrites an existing run")
    parser.add_argument("--overlay", action="store_true", help="Save a 10-fps skeleton video for inspection")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        with (Path(__file__).resolve().parent / ".worker.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("This worker is busy; wait for the current job to finish") from None
            print(json.dumps(analyze(args), indent=2, allow_nan=False))
    except (Exception, KeyboardInterrupt) as error:
        print(f"Analysis failed; no valid result: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
