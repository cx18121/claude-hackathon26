/* eslint-disable react-hooks/set-state-in-effect --
 * This hook intentionally drives surface state (stage / progress / counts)
 * from a per-frame keypoints stream and from `active` transitions. Both
 * legitimately require setState inside useEffect: the keypoints stream is
 * the external system this hook synchronizes against, and the active
 * transition is the lifecycle reset point. Refactoring into a reducer or
 * useSyncExternalStore would not change the cascading-render count and
 * would obscure the simple linear stage machine.
 */

import { useEffect, useRef, useState } from 'react';
import type { PoseKeypoint } from '../protocol';
import {
  computeWristVelocity,
  LANDMARK,
  type TimedFrame,
} from '../lib/velocity';

export type CalibrationStage =
  | 'idle'
  | 'tpose'
  | 'punches'
  | 'neutral'
  | 'done';

export interface UseCalibrationResult {
  stage: CalibrationStage;
  punchesRecorded: number;
  tposeProgress: number; // 0..1
  neutralProgress: number; // 0..1
  referenceVelocity: number | null;
  instruction: string;
}

interface UseCalibrationArgs {
  keypoints: PoseKeypoint[] | null;
  active: boolean; // true when phase === 'calibration'
  onComplete: (referenceVelocity: number) => void;
}

const TPOSE_STABLE_FRAMES_NEEDED = 30;
const TPOSE_VISIBILITY_THRESHOLD = 0.5;
const TPOSE_STILLNESS_DELTA = 0.05; // meters per frame
const TPOSE_VISIBILITY_LANDMARKS = [
  LANDMARK.LEFT_SHOULDER,
  LANDMARK.RIGHT_SHOULDER,
  LANDMARK.LEFT_ELBOW,
  LANDMARK.RIGHT_ELBOW,
  LANDMARK.LEFT_WRIST,
  LANDMARK.RIGHT_WRIST,
  LANDMARK.LEFT_HIP,
  LANDMARK.RIGHT_HIP,
];

const PUNCH_PEAK_THRESHOLD = 1.5; // m/s
const PUNCH_RESET_THRESHOLD = 0.8; // m/s, must drop below this between peaks

const NEUTRAL_STILLNESS_THRESHOLD = 0.2; // m/s
const NEUTRAL_FRAMES_NEEDED = 60;

const FRAME_WINDOW = 3;
const FRAME_BUFFER_TS_KEY = 'cap_t';

interface PunchTracker {
  armed: boolean; // true when velocity is currently above threshold
  peakVelocity: number; // running max during the current armed window
}

function distancePoints(a: PoseKeypoint, b: PoseKeypoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function useCalibration({
  keypoints,
  active,
  onComplete,
}: UseCalibrationArgs): UseCalibrationResult {
  const [stage, setStage] = useState<CalibrationStage>('idle');
  const [punchesRecorded, setPunchesRecorded] = useState(0);
  const [tposeProgress, setTposeProgress] = useState(0);
  const [neutralProgress, setNeutralProgress] = useState(0);
  const [referenceVelocity, setReferenceVelocity] = useState<number | null>(null);

  const stageRef = useRef<CalibrationStage>('idle');
  const frameWindowRef = useRef<TimedFrame[]>([]);
  const prevFrameRef = useRef<TimedFrame | null>(null);
  const tposeStableCountRef = useRef(0);
  const peakVelocitiesRef = useRef<number[]>([]);
  const leftTrackerRef = useRef<PunchTracker>({ armed: false, peakVelocity: 0 });
  const rightTrackerRef = useRef<PunchTracker>({ armed: false, peakVelocity: 0 });
  const neutralStillCountRef = useRef(0);
  const completedRef = useRef(false);

  // Lifecycle: enter / exit calibration. Refs and surface state are reset
  // together when `active` flips. See the file header for the eslint note.
  useEffect(() => {
    if (active) {
      // Reset all buffers; a fresh calibration always starts from T-pose.
      stageRef.current = 'tpose';
      frameWindowRef.current = [];
      prevFrameRef.current = null;
      tposeStableCountRef.current = 0;
      peakVelocitiesRef.current = [];
      leftTrackerRef.current = { armed: false, peakVelocity: 0 };
      rightTrackerRef.current = { armed: false, peakVelocity: 0 };
      neutralStillCountRef.current = 0;
      completedRef.current = false;
      setStage('tpose');
      setPunchesRecorded(0);
      setTposeProgress(0);
      setNeutralProgress(0);
      setReferenceVelocity(null);
    } else {
      stageRef.current = 'idle';
      setStage('idle');
    }
  }, [active]);

  // Per-frame processing.
  useEffect(() => {
    if (!active || !keypoints || stageRef.current === 'idle' || completedRef.current) return;

    const frame: TimedFrame = { keypoints, t: performance.now() };
    const window = frameWindowRef.current;
    window.push(frame);
    if (window.length > FRAME_WINDOW) window.shift();
    void FRAME_BUFFER_TS_KEY; // keep import shape stable; window.length is the only state needed

    const current = stageRef.current;

    if (current === 'tpose') {
      const prev = prevFrameRef.current;
      let stable = false;
      if (prev) {
        // All required landmarks visible AND keypoint movement small
        let visibleOk = true;
        for (const idx of TPOSE_VISIBILITY_LANDMARKS) {
          if ((keypoints[idx]?.visibility ?? 0) < TPOSE_VISIBILITY_THRESHOLD) {
            visibleOk = false;
            break;
          }
        }
        let stillOk = visibleOk;
        if (visibleOk) {
          for (const idx of TPOSE_VISIBILITY_LANDMARKS) {
            if (distancePoints(prev.keypoints[idx], keypoints[idx]) > TPOSE_STILLNESS_DELTA) {
              stillOk = false;
              break;
            }
          }
        }
        stable = stillOk;
      }

      if (stable) {
        tposeStableCountRef.current += 1;
      } else {
        tposeStableCountRef.current = 0;
      }
      setTposeProgress(
        Math.min(1, tposeStableCountRef.current / TPOSE_STABLE_FRAMES_NEEDED),
      );

      if (tposeStableCountRef.current >= TPOSE_STABLE_FRAMES_NEEDED) {
        stageRef.current = 'punches';
        setStage('punches');
      }
    } else if (current === 'punches') {
      const left = computeWristVelocity(window, 'left');
      const right = computeWristVelocity(window, 'right');

      processPunchTracker(leftTrackerRef.current, left, peakVelocitiesRef);
      processPunchTracker(rightTrackerRef.current, right, peakVelocitiesRef);

      if (peakVelocitiesRef.current.length !== punchesRecorded) {
        setPunchesRecorded(peakVelocitiesRef.current.length);
      }
      if (peakVelocitiesRef.current.length >= 3) {
        stageRef.current = 'neutral';
        setStage('neutral');
        neutralStillCountRef.current = 0;
      }
    } else if (current === 'neutral') {
      const left = computeWristVelocity(window, 'left');
      const right = computeWristVelocity(window, 'right');
      const maxV = Math.max(left, right);
      if (maxV < NEUTRAL_STILLNESS_THRESHOLD) {
        neutralStillCountRef.current += 1;
      } else {
        neutralStillCountRef.current = 0;
      }
      setNeutralProgress(
        Math.min(1, neutralStillCountRef.current / NEUTRAL_FRAMES_NEEDED),
      );
      if (neutralStillCountRef.current >= NEUTRAL_FRAMES_NEEDED) {
        const peaks = peakVelocitiesRef.current.slice(0, 3);
        const ref =
          peaks.reduce((a, b) => a + b, 0) / Math.max(1, peaks.length);
        completedRef.current = true;
        stageRef.current = 'done';
        setStage('done');
        setReferenceVelocity(ref);
        onComplete(ref);
      }
    }

    prevFrameRef.current = frame;
  }, [keypoints, active, punchesRecorded, onComplete]);

  const instruction = instructionFor(stage, punchesRecorded, tposeProgress);
  return {
    stage,
    punchesRecorded,
    tposeProgress,
    neutralProgress,
    referenceVelocity,
    instruction,
  };
}

function processPunchTracker(
  tracker: PunchTracker,
  velocity: number,
  peaksRef: { current: number[] },
) {
  if (!tracker.armed) {
    if (velocity >= PUNCH_PEAK_THRESHOLD) {
      tracker.armed = true;
      tracker.peakVelocity = velocity;
    }
  } else {
    if (velocity > tracker.peakVelocity) tracker.peakVelocity = velocity;
    if (velocity < PUNCH_RESET_THRESHOLD) {
      // peak completed
      if (peaksRef.current.length < 3) {
        peaksRef.current.push(tracker.peakVelocity);
      }
      tracker.armed = false;
      tracker.peakVelocity = 0;
    }
  }
}

function instructionFor(
  stage: CalibrationStage,
  punches: number,
  tposeProgress: number,
): string {
  switch (stage) {
    case 'idle':
      return 'Waiting for server...';
    case 'tpose':
      return `Stand facing camera, arms out wide. Hold still. (${Math.round(
        tposeProgress * 100,
      )}%)`;
    case 'punches':
      return `Throw 3 punches at full speed! (${punches}/3)`;
    case 'neutral':
      return 'Hold a fighting stance, still...';
    case 'done':
      return 'Calibrated! Get ready to fight.';
  }
}
