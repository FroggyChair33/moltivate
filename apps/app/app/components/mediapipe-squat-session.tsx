"use client";

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  SquatCounter,
  handRaised,
  randomLivenessPrompt,
  type LivenessPrompt,
} from "@/lib/pose-squat-counter";

// Real in-browser MediaPipe fallback capture (see MVP doc "Workout CV
// (fallback)" and AGENTS.md's technical-direction table). Reps are counted
// client-side from live webcam pose landmarks -- lower trust than the
// Chert/server-CV primary path, which is why /api/workout-sessions forces
// every unauthenticated caller (this one included) to trust_level
// 'unverified' regardless of what's reported here. The liveness check below
// is a local demo signal only, not a cryptographic assertion sent to the
// backend as authoritative.
//
// shortcut: pose model and wasm runtime load from Google's/jsDelivr's CDN at
// runtime (no bundled/self-hosted model file) -- fine for a hackathon demo
// with working wifi, but a flaky venue network would break this; self-host
// the .task model and wasm assets if that becomes a problem.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

type Phase = "idle" | "loading" | "running" | "submitting" | "done" | "error";

type LoopRefs = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  landmarkerRef: React.RefObject<PoseLandmarker | null>;
  counterRef: React.RefObject<SquatCounter>;
  rafRef: React.RefObject<number | null>;
  livenessDeadlineRef: React.RefObject<number | null>;
  promptRef: React.RefObject<LivenessPrompt | null>;
  livenessPassedRef: React.RefObject<boolean | null>;
  onReps: (reps: number) => void;
  onLivenessPassed: (passed: boolean) => void;
};

// Module-level (not a nested closure inside the component) so impure calls
// like performance.now() aren't flagged as happening "during render" by the
// React Compiler purity lint -- this only ever runs from a rAF callback or
// an event handler, never from render itself.
function detectionLoop(refs: LoopRefs) {
  const video = refs.videoRef.current;
  const landmarker = refs.landmarkerRef.current;
  if (!video || !landmarker || video.readyState < 2) {
    refs.rafRef.current = requestAnimationFrame(() => detectionLoop(refs));
    return;
  }

  const result = landmarker.detectForVideo(video, performance.now());
  const landmarks = result.landmarks[0];
  if (landmarks) {
    const repJustCompleted = refs.counterRef.current.update(landmarks);
    const prompt = refs.promptRef.current;
    if (repJustCompleted) {
      const nextReps = refs.counterRef.current.reps;
      refs.onReps(nextReps);
      if (prompt && nextReps === prompt.afterRep) {
        refs.livenessDeadlineRef.current = performance.now() + 3000;
      }
    }

    if (refs.livenessDeadlineRef.current !== null && refs.livenessPassedRef.current === null) {
      if (prompt && handRaised(landmarks, prompt.hand)) {
        refs.livenessPassedRef.current = true;
        refs.onLivenessPassed(true);
        refs.livenessDeadlineRef.current = null;
      } else if (performance.now() > refs.livenessDeadlineRef.current) {
        refs.livenessPassedRef.current = false;
        refs.onLivenessPassed(false);
        refs.livenessDeadlineRef.current = null;
      }
    }
  }

  refs.rafRef.current = requestAnimationFrame(() => detectionLoop(refs));
}

export function MediaPipeSquatSession({
  challengePubkey,
  teamMemberPubkey,
}: {
  challengePubkey: string;
  teamMemberPubkey: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const counterRef = useRef(new SquatCounter());
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const livenessDeadlineRef = useRef<number | null>(null);
  const promptRef = useRef<LivenessPrompt | null>(null);
  const livenessPassedRef = useRef<boolean | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reps, setReps] = useState(0);
  const [prompt, setPrompt] = useState<LivenessPrompt | null>(null);
  const [livenessPassed, setLivenessPassed] = useState<boolean | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      // These are mutable instance refs (camera stream, rAF handle, pose
      // model), not DOM node refs -- reading .current at unmount time is
      // exactly what's wanted here, not the stale-DOM-ref case this rule
      // normally guards against.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const raf = rafRef.current;
      const stream = streamRef.current;
      const landmarker = landmarkerRef.current;
      if (raf !== null) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
    };
  }, []);

  const submissionKey = useRef<string | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);

  async function start() {
    submissionKey.current = crypto.randomUUID();
    setSubmitFailed(false);
    setResult(null);
    setPhase("loading");
    setError(null);
    setReps(0);
    setLivenessPassed(null);
    livenessDeadlineRef.current = null;
    livenessPassedRef.current = null;
    counterRef.current = new SquatCounter();
    const newPrompt = randomLivenessPrompt();
    promptRef.current = newPrompt;
    setPrompt(newPrompt);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: "VIDEO",
          numPoses: 1,
        });
      }

      setPhase("running");
      detectionLoop({
        videoRef,
        landmarkerRef,
        counterRef,
        rafRef,
        livenessDeadlineRef,
        promptRef,
        livenessPassedRef,
        onReps: setReps,
        onLivenessPassed: setLivenessPassed,
      });
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function finish() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setPhase("submitting");
    setError(null);
    try {
      const res = await fetch("/api/workout-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengePubkey,
          teamMemberPubkey,
          source: "browser_mediapipe",
          reps,
          idempotencyKey: submissionKey.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save your workout. Retry submission.");
      window.dispatchEvent(new Event("moltivate:updated"));
      setSubmitFailed(false);
      setResult(data.status ? `${data.status} (reps: ${reps}, unverified)` : `HTTP ${res.status}`);
      setPhase("done");
    } catch (err) {
      setSubmitFailed(true);
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/15 p-4 text-sm dark:border-white/20">
      <p className="font-medium">Squat workout</p>

      <p className="text-muted">Browser camera · Unverified counts. Keep your whole body visible, turn sideways, and allow camera access. This result is not payout verification.</p>
      {(phase === "idle" || (phase === "error" && !submitFailed)) && (
        <button
          type="button"
          onClick={start}
          className="w-fit rounded-full border border-black/10 px-4 py-1.5 dark:border-white/15"
        >
          Start squat session
        </button>
      )}

      {(phase === "loading" || phase === "running") && (
        <div className="flex flex-col gap-2">
          <video ref={videoRef} muted playsInline className="w-full max-w-xs rounded-lg -scale-x-100" />
          {phase === "loading" && <p className="text-xs text-zinc-500">Loading camera and pose model...</p>}
          {phase === "running" && (
            <>
              <p className="font-serif text-5xl" aria-live="polite">{reps} <span className="font-sans text-sm">squats</span></p>
              {prompt && (
                <p className="text-xs text-zinc-500">
                  Liveness prompt: {prompt.text}{" "}
                  {livenessPassed === true && "Detected"}
                  {livenessPassed === false && "Not detected in time"}
                </p>
              )}
              <button
                type="button"
                onClick={finish}
                className="w-fit rounded-full bg-foreground px-4 py-1.5 text-background"
              >
                Finish & submit
              </button>
            </>
          )}
        </div>
      )}

      {phase === "submitting" && <p className="text-xs text-zinc-500">Submitting...</p>}
      {submitFailed && phase === "error" && <button onClick={finish} className="underline">Retry saving this workout</button>}
      {result && <p className="text-xs text-zinc-500">{result}</p>}
      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
