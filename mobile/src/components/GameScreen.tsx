import { useEffect, useRef, useState } from 'react';
import { useCamera } from '../hooks/useCamera';
import { usePose } from '../hooks/usePose';
import { useCalibration } from '../hooks/useCalibration';
import { CameraView } from './CameraView';
import { CalibrationOverlay } from './CalibrationOverlay';
import { HitFlash } from './HitFlash';
import { PoseOverlay } from './PoseOverlay';
import { MatchEndScreen } from './MatchEndScreen';
import { StatusBar } from './StatusBar';
import type { GamePhase, MatchEnd, SocketStatus } from '../hooks/useGameSocket';
import type { OutboundMobileMsg, PoseKeypoint } from '@shared/protocol';

interface GameScreenProps {
  status: SocketStatus;
  phase: GamePhase;
  roundNumber: number;
  roomCode: string;
  playerSlot: 1 | 2;
  rttMs: number;
  highLatency: boolean;
  opponentConnected: boolean;
  lastHit: { region: string; damage: number } | null;
  matchEnd: MatchEnd | null;
  gameType: string | null;
  isSolo?: boolean;
  send: (msg: OutboundMobileMsg) => void;
  onDisconnect: () => void;
  onPlayAgain: () => void;
}

// 60Hz send rate so the overlay updates at the camera capture rate. The
// previous 30Hz throttle halved the data rate on devices where MediaPipe
// already produces ~60Hz, baking up to 33ms of jitter into every punch.
const POSE_FRAME_INTERVAL_MS = 1000 / 60;

export function GameScreen({
  status,
  phase,
  roundNumber,
  roomCode,
  playerSlot,
  rttMs,
  highLatency,
  opponentConnected,
  lastHit,
  matchEnd,
  gameType,
  isSolo = false,
  send,
  onDisconnect,
  onPlayAgain,
}: GameScreenProps) {
  const [isReady, setIsReady] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);
  const countdownTimersRef = useRef<number[]>([]);
  const lastCountdownRoundRef = useRef<number | null>(null);
  const [directionFaded, setDirectionFaded] = useState(false);
  const directionTimerRef = useRef<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const { error: cameraError, ready: cameraReady } = useCamera(videoRef);
  const { keypoints, imageKeypoints, fps, modelStatus, modelError } = usePose(videoRef, cameraReady);

  // Calibration runs while phase === 'calibration'. When it completes, send
  // calibration_done and wait for the server's match_start to advance the phase.
  // The server only sends match_start once both players have calibrated.
  const calibration = useCalibration({
    keypoints,
    active: phase === 'calibration',
    onComplete: (referenceVelocity) => {
      send({ type: 'calibration_done', reference_velocity: referenceVelocity });
    },
  });

  // Stream pose frames during BOTH calibration and match. The server needs
  // calibration-window frames to derive skeleton metrics (per
  // docs/plans/server-todo.md); only sending during 'match' starves that
  // pipeline and forces fallback hitbox scaling. Throttled to 60fps via the
  // last-send timestamp.
  const lastSendRef = useRef(0);
  useEffect(() => {
    if ((phase !== 'match' && phase !== 'calibration') || !keypoints) return;
    const now = performance.now();
    if (now - lastSendRef.current < POSE_FRAME_INTERVAL_MS) return;
    lastSendRef.current = now;
    send({
      type: 'pose_frame',
      timestamp: now / 1000,
      keypoints: keypoints as PoseKeypoint[],
    });
  }, [keypoints, phase, send]);

  // Best-effort wake lock so the screen stays on during a match.
  useEffect(() => {
    if (phase === 'lobby' || phase === 'ended') return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
    }).wakeLock;
    if (wakeLock?.request) {
      wakeLock.request('screen').then(
        (sentinel) => {
          if (cancelled) {
            void sentinel.release();
            return;
          }
          lock = sentinel;
        },
        () => {
          /* silently ignore: not all browsers support wake lock */
        },
      );
    }
    return () => {
      cancelled = true;
      if (lock) void lock.release();
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'match') return;
    if (lastCountdownRoundRef.current === roundNumber) return;
    lastCountdownRoundRef.current = roundNumber;

    countdownTimersRef.current.forEach(id => window.clearTimeout(id));
    countdownTimersRef.current = [];

    setCountdown('3');
    countdownTimersRef.current.push(window.setTimeout(() => setCountdown('2'), 1000));
    countdownTimersRef.current.push(window.setTimeout(() => setCountdown('1'), 2000));
    countdownTimersRef.current.push(window.setTimeout(() => setCountdown('FIGHT!'), 3000));
    countdownTimersRef.current.push(window.setTimeout(() => setCountdown(null), 3800));
  }, [phase, roundNumber]);

  useEffect(() => {
    return () => { countdownTimersRef.current.forEach(id => window.clearTimeout(id)); };
  }, []);

  useEffect(() => {
    if (phase !== 'match') return;
    setDirectionFaded(false);
    if (directionTimerRef.current !== null) window.clearTimeout(directionTimerRef.current);
    directionTimerRef.current = window.setTimeout(() => setDirectionFaded(true), 10000);
    return () => {
      if (directionTimerRef.current !== null) window.clearTimeout(directionTimerRef.current);
    };
  }, [phase, roundNumber]);

  // Reset the READY gate and countdown ref whenever calibration (re)starts so the
  // player must press READY again — including after a rematch.
  useEffect(() => {
    if (phase !== 'lobby' && phase !== 'calibration') return;
    lastCountdownRoundRef.current = null;
    const timer = window.setTimeout(() => setIsReady(false), 0);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <div className="game-screen">
      <CameraView ref={videoRef} error={cameraError} />
      <PoseOverlay keypoints={imageKeypoints} />

      <StatusBar
        status={status}
        roomCode={roomCode}
        rttMs={rttMs}
        fps={fps}
        highLatency={highLatency}
        playerSlot={playerSlot}
        opponentConnected={opponentConnected}
        isSolo={isSolo}
      />

      {phase === 'lobby' && status === 'connected' && !opponentConnected && !isSolo ? (
        <div className="loading-overlay">Waiting for opponent...</div>
      ) : null}

      {modelStatus === 'loading' ? (
        <div className="loading-overlay">Loading pose model...</div>
      ) : null}

      {modelStatus === 'error' ? (
        <div className="loading-overlay">
          Pose model failed to load: {modelError ?? 'unknown error'}
        </div>
      ) : null}

      {phase === 'calibration' && gameType !== 'dance' && !isReady ? (
        <div className="ready-overlay">
          <p className="ready-title">Spectre</p>
          <p className="ready-hint">
            {playerSlot === 1
              ? 'Face RIGHT and stand in front of your camera.'
              : 'Face LEFT and stand in front of your camera.'}
          </p>
          <button className="ready-button" onClick={() => setIsReady(true)}>
            READY
          </button>
        </div>
      ) : null}

      {phase === 'calibration' && gameType !== 'dance' && isReady && modelStatus === 'ready' ? (
        <CalibrationOverlay
          stage={calibration.stage}
          punchesRecorded={calibration.punchesRecorded}
          tposeProgress={calibration.tposeProgress}
          neutralProgress={calibration.neutralProgress}
          instruction={calibration.instruction}
          playerSlot={playerSlot}
        />
      ) : null}

      {countdown && (
        <div className="mobile-countdown">{countdown}</div>
      )}

      <HitFlash hit={lastHit} />

      {matchEnd ? (
        <MatchEndScreen winner={matchEnd.winner} playerSlot={playerSlot} onPlayAgain={onPlayAgain} />
      ) : null}

      {phase !== 'ended' ? (
        <div
          className={`face-direction face-direction-slot${playerSlot}`}
          style={{ opacity: directionFaded ? 0 : 1, transition: 'opacity 1s ease' }}
        >
          {playerSlot === 1 ? '▶  Face right' : 'Face left  ◀'}
        </div>
      ) : null}

      <button className="leave-button" onClick={onDisconnect} aria-label="Leave match">
        Leave
      </button>
    </div>
  );
}
