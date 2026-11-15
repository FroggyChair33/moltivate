"""One-call Chert/LiveKit transport diagnostic. No recording or rep counting."""
from __future__ import annotations

import asyncio
import fcntl
import hashlib
import logging
import math
import struct
from pathlib import Path

from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, cli

AGENT_NAME = "moltivate-transport"
BRIDGE_PREFIX = "chert-bridge-"
TRACK_KINDS = {
    "facetime-remote-audio": rtc.TrackKind.KIND_AUDIO,
    "facetime-remote-video": rtc.TrackKind.KIND_VIDEO,
}
SAMPLE_RATE = 16_000
FRAME_SECONDS = 0.02
SAMPLES = 320
log = logging.getLogger("moltivate.transport")
server = AgentServer(
    host="127.0.0.1",
    num_idle_processes=1,
    drain_timeout=10,
    log_level="INFO",
)


async def publish_cues(source: rtc.AudioSource, bridge_seen: asyncio.Event) -> None:
    # Queue silence before the bridge joins and three short tones once it arrives.
    tone = struct.pack(
        "<" + "h" * SAMPLES,
        *(int(3500 * math.sin(2 * math.pi * 650 * i / SAMPLE_RATE)) for i in range(SAMPLES)),
    )
    silence = bytes(len(tone))
    remaining = 450
    while True:
        audible = bridge_seen.is_set() and remaining > 0 and remaining % 150 < 15
        if bridge_seen.is_set() and remaining > 0:
            if remaining % 150 == 14:
                log.info("test audio cue queued")
            remaining -= 1
        await source.capture_frame(rtc.AudioFrame(
            data=tone if audible else silence,
            sample_rate=SAMPLE_RATE,
            num_channels=1,
            samples_per_channel=SAMPLES,
        ))
        await asyncio.sleep(FRAME_SECONDS)


async def observe(track: rtc.Track, publication: rtc.RemoteTrackPublication) -> None:
    if track.kind == rtc.TrackKind.KIND_AUDIO:
        stream = rtc.AudioStream.from_track(track=track, capacity=1)
        try:
            async for event in stream:
                log.info("caller audio received: %s Hz, %s channels",
                         event.frame.sample_rate, event.frame.num_channels)
                break
        finally:
            await stream.aclose()
        return

    stream = rtc.VideoStream.from_track(track=track, capacity=1)
    first_digest = None
    first_timestamp = None
    try:
        async for event in stream:
            if publication.muted:
                continue
            frame = event.frame
            if first_digest is None:
                first_digest = hashlib.sha256(frame.data).digest()
                first_timestamp = event.timestamp_us
                log.info("caller frame received: %sx%s rotation=%s format=%s",
                         frame.width, frame.height, event.rotation, frame.type)
            elif event.timestamp_us > first_timestamp:
                if hashlib.sha256(frame.data).digest() != first_digest:
                    log.info("caller video frames changed")
                    break
    finally:
        await stream.aclose()


@server.rtc_session(agent_name=AGENT_NAME)
async def transport(ctx: JobContext) -> None:
    state_dir = Path.home() / ".config" / "moltivate-live"
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state_dir / "transport.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            ctx.shutdown(reason="transport capacity in use")
            return
        await run_call(ctx)


async def run_call(ctx: JobContext) -> None:
    room = ctx.room
    bridge_seen = asyncio.Event()
    stopped = asyncio.Event()
    consumers: dict[str, asyncio.Task[None]] = {}
    bridge_identity = None

    def watch_task(task: asyncio.Task[None]) -> None:
        if not task.cancelled() and task.exception() is not None:
            log.error("transport media task failed: %s", type(task.exception()).__name__)
            stopped.set()

    @room.on("track_published")
    def select(publication, participant):
        nonlocal bridge_identity
        if (not participant.identity.startswith(BRIDGE_PREFIX)
                or TRACK_KINDS.get(publication.name) != publication.kind):
            return
        if bridge_identity is None:
            bridge_identity = participant.identity
            bridge_seen.set()
        if participant.identity == bridge_identity:
            publication.set_subscribed(True)

    @room.on("track_subscribed")
    def subscribed(track, publication, participant):
        if (participant.identity != bridge_identity
                or TRACK_KINDS.get(publication.name) != track.kind
                or publication.sid in consumers):
            return
        task = asyncio.create_task(observe(track, publication))
        consumers[publication.sid] = task
        task.add_done_callback(watch_task)

    @room.on("track_unsubscribed")
    def unsubscribed(_track, publication, participant):
        if participant.identity == bridge_identity:
            task = consumers.get(publication.sid)
            if task and not task.done():
                task.cancel()
                task.add_done_callback(lambda _: consumers.pop(publication.sid, None))
            else:
                consumers.pop(publication.sid, None)
            log.info("caller track unsubscribed")

    @room.on("participant_disconnected")
    def left(participant):
        if participant.identity == bridge_identity:
            log.info("caller bridge disconnected")
            stopped.set()

    @room.on("disconnected")
    def disconnected(_reason):
        stopped.set()

    source = rtc.AudioSource(SAMPLE_RATE, 1, queue_size_ms=100)
    cue_task = None
    try:
        async with asyncio.timeout(120):
            await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_NONE)
            for participant in room.remote_participants.values():
                for publication in participant.track_publications.values():
                    select(publication, participant)
            audio = rtc.LocalAudioTrack.create_audio_track("moltivate-transport-cue", source)
            await room.local_participant.publish_track(audio, rtc.TrackPublishOptions(
                source=rtc.TrackSource.SOURCE_MICROPHONE,
            ))
            log.info("transport ready: agent audio published")
            cue_task = asyncio.create_task(publish_cues(source, bridge_seen))
            cue_task.add_done_callback(watch_task)
            await stopped.wait()
    except TimeoutError:
        log.info("transport test window expired")
    finally:
        tasks = list(consumers.values())
        if cue_task is not None:
            tasks.append(cue_task)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await source.aclose()
        ctx.shutdown(reason="transport diagnostic finished")
        log.info("transport media cleanup complete")


if __name__ == "__main__":
    cli.run_app(server)
