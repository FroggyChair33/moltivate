// Squat rep counting from MediaPipe Pose landmarks, plus the liveness check
// for the in-browser fallback capture path. MediaPipe pose estimation is a
// measurement input, not a medical assessment or proof of identity/liveness
// (see AGENTS.md "Verification, authentication, and data") -- this is a
// best-effort heuristic, not an anti-cheat guarantee.
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// PoseLandmarker's 33-point BlazePose topology.
const LEFT_HIP = 23;
const LEFT_KNEE = 25;
const LEFT_ANKLE = 27;
const LEFT_SHOULDER = 11;
const LEFT_WRIST = 15;
const RIGHT_SHOULDER = 12;
const RIGHT_WRIST = 16;

// Knee angle (hip-knee-ankle) thresholds, in degrees. A standing leg is
// close to 180 deg; a full squat brings it well under 110 deg. Hysteresis
// between the two avoids double-counting from a single noisy frame.
const DOWN_THRESHOLD_DEG = 110;
const UP_THRESHOLD_DEG = 160;

function angleDeg(a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.hypot(v1.x, v1.y);
  const mag2 = Math.hypot(v2.x, v2.y);
  if (mag1 === 0 || mag2 === 0) return 180;
  const cos = Math.min(1, Math.max(-1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export type SquatState = "up" | "down";

export class SquatCounter {
  reps = 0;
  private state: SquatState = "up";

  // Call once per detected frame. Returns true the instant a rep completes.
  update(landmarks: NormalizedLandmark[]): boolean {
    const hip = landmarks[LEFT_HIP];
    const knee = landmarks[LEFT_KNEE];
    const ankle = landmarks[LEFT_ANKLE];
    if (!hip || !knee || !ankle) return false;

    const kneeAngle = angleDeg(hip, knee, ankle);
    if (this.state === "up" && kneeAngle < DOWN_THRESHOLD_DEG) {
      this.state = "down";
    } else if (this.state === "down" && kneeAngle > UP_THRESHOLD_DEG) {
      this.state = "up";
      this.reps += 1;
      return true;
    }
    return false;
  }
}

export type LivenessHand = "left" | "right";

export type LivenessPrompt = {
  hand: LivenessHand;
  afterRep: number;
  text: string;
};

export function randomLivenessPrompt(): LivenessPrompt {
  const hand: LivenessHand = Math.random() < 0.5 ? "left" : "right";
  const afterRep = 1 + Math.floor(Math.random() * 3); // 1, 2, or 3
  return {
    hand,
    afterRep,
    text: `Right after rep ${afterRep}, raise your ${hand} hand above your shoulder.`,
  };
}

// True if the given hand's wrist is currently above (lower y than) its
// shoulder -- image y grows downward, so "above" is a smaller y value.
export function handRaised(landmarks: NormalizedLandmark[], hand: LivenessHand): boolean {
  const [shoulderIdx, wristIdx] = hand === "left" ? [LEFT_SHOULDER, LEFT_WRIST] : [RIGHT_SHOULDER, RIGHT_WRIST];
  const shoulder = landmarks[shoulderIdx];
  const wrist = landmarks[wristIdx];
  if (!shoulder || !wrist) return false;
  return wrist.y < shoulder.y;
}
