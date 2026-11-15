"""LiveKit-to-vision adapter for the manual FaceTime rep test."""
import asyncio
import json
import logging
import time
from pathlib import Path

from livekit import rtc

from live_motion import FRAME_HEADER, MAX_PIXELS

log = logging.getLogger("moltivate.live")
SAMPLE_RATE = 16_000
SAMPLES = 320
BYTES_PER_PACKET = SAMPLES * 2


async def speech(text):
    # Prompts and counts come only from this probe's state machine.
    process = await asyncio.create_subprocess_exec(
        "ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
        f"flite=voice=slt:text='{text}'", "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "pipe:1",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(3):
            pcm, _ = await process.communicate()
        if process.returncode or not pcm:
            raise RuntimeError("Offline speech generation failed")
        return pcm
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


class LiveProbe:
    def __init__(self, exercise, prep_seconds, set_seconds):
        self.exercise, self.prep_seconds, self.set_seconds = exercise, prep_seconds, set_seconds
        self.frames = asyncio.Queue(maxsize=1)
        self.cues = asyncio.Queue(maxsize=1)
        self.introduction_done = asyncio.Event()
        self.video_sid = None
        self.epoch = 0
        self.dropped = 0
        self.last_result = None
        self.worker = None

    async def start(self):
        here = Path(__file__).parent
        self.worker = await asyncio.create_subprocess_exec(
            str(here / ".venv/bin/python"), "-u", str(here / "live_motion.py"),
            self.exercise, str(self.prep_seconds), str(self.set_seconds),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        )
        if json.loads(await asyncio.wait_for(self.worker.stdout.readline(), 12)) != {"ready": True}:
            raise RuntimeError("Vision worker failed its ready handshake")
        log.info("CPU pose model ready for %s", self.exercise)

    async def close(self):
        if self.last_result is not None:
            log.info("experimental set result: exercise=%s dropped=%s %s",
                     self.exercise, self.dropped, json.dumps(self.last_result, sort_keys=True))
        if self.worker is not None and self.worker.returncode is None:
            self.worker.terminate()
            try:
                await asyncio.wait_for(self.worker.wait(), 3)
            except TimeoutError:
                self.worker.kill()
                await self.worker.wait()

    def say(self, cue):
        if self.cues.full():
            self.cues.get_nowait()
        self.cues.put_nowait(cue)

    def track_changed(self, sid):
        if sid == self.video_sid:
            self.epoch += 1
            if self.frames.full():
                self.frames.get_nowait()
                self.dropped += 1
            if self.cues.full():
                self.cues.get_nowait()

    async def video(self, track, publication):
        self.video_sid = publication.sid
        self.track_changed(publication.sid)
        stream = rtc.VideoStream.from_track(track=track, capacity=1, format=rtc.VideoBufferType.RGB24)
        source_ms, received_ms, epoch = None, None, None
        try:
            async for event in stream:
                if not self.introduction_done.is_set() or publication.muted or publication.sid != self.video_sid:
                    continue
                if epoch != self.epoch:
                    epoch = self.epoch
                    source_ms = received_ms = None
                frame = event.frame
                if not 0 < frame.width * frame.height <= MAX_PIXELS:
                    continue
                stamp = event.timestamp_us // 1000
                now = time.monotonic_ns() // 1_000_000
                if source_ms is not None and (stamp - source_ms < 90 or now - received_ms < 80):
                    self.dropped += 1
                    continue
                source_ms, received_ms = stamp, now
                if self.frames.full():
                    self.frames.get_nowait()
                    self.dropped += 1
                self.frames.put_nowait((now, epoch, frame, int(event.rotation) * 90, stamp))
        finally:
            self.track_changed(publication.sid)
            await stream.aclose()

    async def infer(self):
        last_stamp = last_epoch = None
        while True:
            ms, epoch, frame, rotation, stamp = await self.frames.get()
            if epoch != self.epoch or time.monotonic_ns() // 1_000_000 - ms > 350:
                self.dropped += 1
                continue
            # Compute the gap between processed source frames, including dropped frames.
            sender_gap_ms = min(60_000, stamp - last_stamp) if epoch == last_epoch else 0
            last_stamp, last_epoch = stamp, epoch
            async with asyncio.timeout(4):
                self.worker.stdin.write(FRAME_HEADER.pack(
                    ms, epoch, frame.width, frame.height, rotation, sender_gap_ms,
                ))
                self.worker.stdin.write(frame.data)
                await self.worker.stdin.drain()
                result = json.loads(await self.worker.stdout.readline())
            # A frame that completed during track removal cannot produce a cue.
            if epoch != self.epoch:
                continue
            cue = result.pop("cue", None)
            if self.last_result is None or self.last_result["phase"] != result["phase"]:
                log.info("live set phase: %s", result["phase"])
            if self.last_result is not None and result["count"] > self.last_result["count"]:
                log.info("experimental rep: %s", result["count"])
            self.last_result = result
            if cue:
                self.say(cue)

    async def audio(self, source, bridge_seen):
        introduced = False
        synthesis = None
        pcm = b""
        try:
            while True:
                if synthesis is not None and synthesis.done():
                    pcm = synthesis.result()
                    synthesis = None
                if synthesis is None and not pcm and bridge_seen.is_set():
                    if not introduced:
                        introduced = True
                        synthesis = asyncio.create_task(speech(
                            f"Ready for {self.exercise}? Show your whole body from the side. Take your time"
                        ))
                    else:
                        self.introduction_done.set()
                        if not self.cues.empty():
                            synthesis = asyncio.create_task(speech(self.cues.get_nowait()))
                chunk, pcm = pcm[:BYTES_PER_PACKET], pcm[BYTES_PER_PACKET:]
                await source.capture_frame(rtc.AudioFrame(
                    chunk.ljust(BYTES_PER_PACKET, b"\0"), SAMPLE_RATE, 1, SAMPLES,
                ))
                await asyncio.sleep(.02)
        finally:
            if synthesis is not None:
                synthesis.cancel()
                await asyncio.gather(synthesis, return_exceptions=True)
